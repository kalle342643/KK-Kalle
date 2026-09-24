import { z } from "zod";
import type { Db } from "../db/index.js";
import { audit } from "../domain/audit.js";
import { DomainError } from "../domain/branches.js";
import type { Actor, AppContext } from "../domain/context.js";
import type { BacklogItem, CiState, CodeHealth, CodeProject } from "../office/types.js";

/** Wat HQ de vorige keer bij GitHub zag (in code_projects.state). */
export interface ProjectState {
  defaultBranch?: string;
  repoUrl?: string;
  empty?: boolean;
  /** Gevolgde branches → laatst geziene commit. */
  branches?: Record<string, string>;
  /** Commits die al verwerkt zijn (nieuwste achteraan, maximaal 300). */
  seen?: string[];
  lastCommit?: CodeProject["lastCommit"];
  prs?: Array<CodeProject["openPrs"][number] & { sha: string }>;
  ci?: { state: CiState; url: string | null; at: string | null; sha: string };
  deploy?: CodeProject["deploy"] & { id: number };
  backlog?: { path: string; sha: string; updatedAt: string; items: BacklogItem[] };
  error?: string | null;
  polledAt?: string;
}

export interface HealthState {
  state?: CodeHealth["state"];
  status?: number | null;
  ms?: number | null;
  checkedAt?: string;
  since?: string;
  fails?: number;
  note?: string | null;
}

export interface CodeProjectRow {
  key: string;
  name: string;
  repo: string | null;
  url: string | null;
  healthUrl: string | null;
  branch: string | null;
  backlogPath: string;
  description: string | null;
  state: ProjectState;
  health: HealthState;
  archivedAt: Date | null;
}

interface Row {
  key: string;
  name: string;
  repo: string | null;
  url: string | null;
  health_url: string | null;
  branch_slug: string | null;
  backlog_path: string;
  description: string | null;
  state: ProjectState | null;
  health: HealthState | null;
  archived_at: string | Date | null;
}

const toRow = (r: Row): CodeProjectRow => ({
  key: r.key,
  name: r.name,
  repo: r.repo,
  url: r.url,
  healthUrl: r.health_url,
  branch: r.branch_slug,
  backlogPath: r.backlog_path,
  description: r.description,
  state: r.state ?? {},
  health: r.health ?? {},
  archivedAt: r.archived_at ? new Date(r.archived_at) : null,
});

const httpUrl = z.url({ protocol: /^https?$/, message: "een volledig adres met http:// of https://" });

export const codeProjectSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "kleine letters, cijfers en streepjes")
    .optional(),
  name: z.string().trim().min(2).max(40),
  repo: z
    .string()
    .trim()
    .regex(/^[\w.-]+\/[\w.-]+$/, "schrijf de repository als eigenaar/naam, bv. mijnnaam/mijnproject")
    .nullish(),
  url: httpUrl.nullish(),
  healthUrl: httpUrl.nullish(),
  branch: z.string().trim().max(40).nullish(),
  backlogPath: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(300).nullish(),
});

export type CodeProjectInput = z.infer<typeof codeProjectSchema>;

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "project";
}

export async function listCodeProjects(db: Db, opts: { archived?: boolean } = {}): Promise<CodeProjectRow[]> {
  const rows = await db.query<Row>(
    `select * from code_projects ${opts.archived ? "" : "where archived_at is null"} order by created_at, key`,
  );
  return rows.map(toRow);
}

export async function getCodeProject(db: Db, key: string): Promise<CodeProjectRow | undefined> {
  const rows = await db.query<Row>("select * from code_projects where key = $1", [key]);
  return rows[0] ? toRow(rows[0]) : undefined;
}

export async function requireCodeProject(db: Db, key: string): Promise<CodeProjectRow> {
  const p = await getCodeProject(db, key);
  if (!p) throw new DomainError(`Project '${key}' bestaat niet.`, 404);
  return p;
}

/** Nieuw project volgen, of een bestaand bijwerken (op sleutel). */
export async function saveCodeProject(ctx: AppContext, input: CodeProjectInput, actor: Actor): Promise<CodeProjectRow> {
  const key = input.key ?? slugify(input.name);
  const existing = await getCodeProject(ctx.db, key);
  // Een andere repository = opnieuw beginnen met wat HQ zag.
  const resetState = Boolean(existing && (input.repo ?? null) !== existing.repo);
  const rows = await ctx.db.query<Row>(
    `insert into code_projects (key, name, repo, url, health_url, branch_slug, backlog_path, description)
     values ($1, $2, $3, $4, $5, $6, coalesce($7, 'BACKLOG.md'), $8)
     on conflict (key) do update set
       name = excluded.name, repo = excluded.repo, url = excluded.url, health_url = excluded.health_url,
       branch_slug = excluded.branch_slug, backlog_path = coalesce($7, code_projects.backlog_path),
       description = excluded.description, archived_at = null, updated_at = now(),
       state = case when $9 then '{}'::jsonb else code_projects.state end,
       health = case when code_projects.url is distinct from excluded.url or code_projects.health_url is distinct from excluded.health_url
                     then '{}'::jsonb else code_projects.health end
     returning *`,
    [
      key,
      input.name,
      input.repo ?? null,
      input.url ?? null,
      input.healthUrl ?? null,
      input.branch ?? null,
      input.backlogPath ?? null,
      input.description ?? null,
      resetState,
    ],
  );
  await audit(ctx.db, actor, existing ? "code.project.update" : "code.project.add", { key, repo: input.repo ?? null });
  return toRow(rows[0]!);
}

export async function archiveCodeProject(ctx: AppContext, key: string, actor: Actor): Promise<void> {
  await requireCodeProject(ctx.db, key);
  await ctx.db.query("update code_projects set archived_at = now(), updated_at = now() where key = $1", [key]);
  await audit(ctx.db, actor, "code.project.archive", { key });
}

export async function saveState(db: Db, key: string, state: ProjectState): Promise<void> {
  await db.query("update code_projects set state = $2, updated_at = now() where key = $1", [key, JSON.stringify(state)]);
}

export async function saveHealth(db: Db, key: string, health: HealthState): Promise<void> {
  await db.query("update code_projects set health = $2 where key = $1", [key, JSON.stringify(health)]);
}

/** Uptime per project over de laatste 24 uur (0-1), alleen voor projecten met controles. */
export async function uptime24h(db: Db, now: Date): Promise<Map<string, number>> {
  const rows = await db.query<{ project_key: string; up: string | number }>(
    `select project_key, avg(case when ok then 1 else 0 end) as up from code_health
     where at >= $1 group by project_key`,
    [new Date(now.getTime() - 24 * 3600_000).toISOString()],
  );
  return new Map(rows.map((r) => [r.project_key, Math.round(Number(r.up) * 1000) / 1000]));
}

/** Van databaseregel naar wat het kantoor laat zien. */
export function summarize(p: CodeProjectRow, extra: { uptime: number | null; activeSessions: number }): CodeProject {
  const s = p.state;
  const h = p.health;
  const items = s.backlog?.items ?? [];
  return {
    key: p.key,
    name: p.name,
    repo: p.repo,
    repoUrl: s.repoUrl ?? (p.repo ? `https://github.com/${p.repo}` : null),
    url: p.url ?? (s.deploy?.state === "success" ? s.deploy.url : null),
    healthUrl: p.healthUrl,
    branch: p.branch,
    description: p.description,
    defaultBranch: s.defaultBranch ?? null,
    empty: Boolean(s.empty),
    health: {
      state: h.state ?? "unknown",
      status: h.status ?? null,
      ms: h.ms ?? null,
      checkedAt: h.checkedAt ?? null,
      since: h.since ?? null,
      uptime24h: extra.uptime,
      note: h.note ?? null,
    },
    deploy: s.deploy ? { state: s.deploy.state, url: s.deploy.url, at: s.deploy.at, environment: s.deploy.environment, sha: s.deploy.sha } : null,
    ci: s.ci ? { state: s.ci.state, url: s.ci.url, at: s.ci.at } : null,
    lastCommit: s.lastCommit ?? null,
    openPrs: (s.prs ?? []).map(({ sha: _sha, ...pr }) => pr),
    backlog: s.backlog
      ? {
          path: s.backlog.path,
          updatedAt: s.backlog.updatedAt,
          // Eerst wat bij jou ligt: dat is waar het op wacht.
          items: [...items.filter((i) => i.owner), ...items.filter((i) => !i.owner)].slice(0, 40),
          ownerCount: items.filter((i) => i.owner).length,
          totalCount: items.length,
        }
      : null,
    activeSessions: extra.activeSessions,
    error: s.error ?? null,
    polledAt: s.polledAt ?? null,
  };
}
