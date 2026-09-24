import type { Db } from "../db/index.js";
import type { CiState, CodeHelper, CodeSession } from "../office/types.js";

/**
 * Claude Code-sessies in de werkplaats. HQ ziet ze op twee manieren:
 * - aan commits: Claude Code in de cloud zet "Claude-Session: https://claude.ai/code/session_…" onder elk
 *   commitbericht, en werkt op een eigen branch (claude/…);
 * - via hooks (optioneel): Claude Code meldt live wanneer het begint, een opdracht krijgt en tools gebruikt.
 * Sessies op dezelfde branch van hetzelfde project zijn dezelfde sessie.
 */

/** Zo lang na de laatste activiteit heet een sessie nog "bezig" (een cloud-sessie commit niet elke minuut). */
export const WORKING_MS = 45 * 60_000;
/** Zo lang blijft een stille sessie in de werkplaats zitten. */
export const VISIBLE_MS = 36 * 3600_000;

export interface SessionRow {
  id: string;
  project_key: string | null;
  source: "cloud" | "local" | "action";
  url: string | null;
  branch: string | null;
  title: string | null;
  last_action: string | null;
  started_at: string | Date;
  last_activity_at: string | Date;
  ended_at: string | Date | null;
  commits: number;
  pr: { number: number; url: string; state: "open" | "merged" | "closed"; ci: CiState } | null;
}

export const actorIdOf = (sessionId: string) => `cc:${sessionId}`;
/** "~" komt niet voor in een git-branch, dus ook niet in het id van de sessie. */
export const helperActorIdOf = (sessionId: string, agentId: string) => `${actorIdOf(sessionId)}~${agentId}`;

/** Een helper zonder teken van leven verdwijnt na zo lang (als het einde-bericht nooit kwam). */
export const HELPER_STALE_MS = 30 * 60_000;

const HELPER_NAMES: Record<string, string> = {
  explore: "Verkenner",
  plan: "Planner",
  "general-purpose": "Helper",
  onderzoeker: "Onderzoeker",
  reviewer: "Reviewer",
  "claude-code-guide": "Gids",
  "statusline-setup": "Instellingen",
};

/** Leesbare naam voor een soort sub-agent ("plugin:x:security-reviewer" wordt "Security reviewer"). */
export function helperLabel(agentType: string): string {
  const base = agentType.split(":").pop()!.trim();
  const known = HELPER_NAMES[base.toLowerCase()];
  if (known) return known;
  const words = base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1, 40) : "Helper";
}

export interface HelperRow {
  session_id: string;
  agent_id: string;
  agent_type: string;
  task: string | null;
  last_action: string | null;
  tools: number;
  started_at: string | Date;
  last_activity_at: string | Date;
  ended_at: string | Date | null;
}

const toHelper = (r: HelperRow): CodeHelper => ({
  actorId: helperActorIdOf(r.session_id, r.agent_id),
  agentType: r.agent_type,
  label: helperLabel(r.agent_type),
  task: r.task,
  lastAction: r.last_action,
  tools: r.tools,
  startedAt: new Date(r.started_at).toISOString(),
  lastActivityAt: new Date(r.last_activity_at).toISOString(),
});

/** Een sessie zet een helper in (of hij meldde zich pas bij zijn eerste stap). */
export async function startHelper(
  db: Db,
  h: { sessionId: string; agentId: string; agentType: string; task?: string | null; action?: string | null; at: Date; tool?: boolean },
): Promise<{ created: boolean; row: HelperRow }> {
  const rows = await db.query<HelperRow & { inserted: boolean }>(
    `insert into code_helpers (session_id, agent_id, agent_type, task, last_action, tools, started_at, last_activity_at)
     values ($1, $2, $3, $4, $5, $6, $7, $7)
     on conflict (session_id, agent_id) do update set
       task = coalesce(code_helpers.task, excluded.task),
       last_action = coalesce(excluded.last_action, code_helpers.last_action),
       tools = code_helpers.tools + excluded.tools,
       last_activity_at = greatest(code_helpers.last_activity_at, excluded.last_activity_at)
     returning *, (xmax = 0) as inserted`,
    [h.sessionId, h.agentId, h.agentType, h.task ?? null, h.action ?? null, h.tool ? 1 : 0, h.at.toISOString()],
  );
  const { inserted, ...row } = rows[0]!;
  return { created: Boolean(inserted), row };
}

/** De helper is klaar (of de sessie sloot). Geeft de helper terug als hij nog bezig was. */
export async function stopHelper(db: Db, sessionId: string, agentId: string, at: Date): Promise<HelperRow | undefined> {
  const rows = await db.query<HelperRow>(
    `update code_helpers set ended_at = $3, last_activity_at = greatest(last_activity_at, $3)
     where session_id = $1 and agent_id = $2 and ended_at is null returning *`,
    [sessionId, agentId, at.toISOString()],
  );
  return rows[0];
}

export async function stopAllHelpers(db: Db, sessionId: string, at: Date): Promise<void> {
  await db.query("update code_helpers set ended_at = $2 where session_id = $1 and ended_at is null", [sessionId, at.toISOString()]);
}

/** Helpers per sessie: wie nu werkt, en hoeveel er in totaal waren. */
export async function helpersOf(db: Db, sessionIds: string[], now: Date): Promise<Map<string, { active: CodeHelper[]; used: number }>> {
  const out = new Map<string, { active: CodeHelper[]; used: number }>();
  if (!sessionIds.length) return out;
  const rows = await db.query<HelperRow>("select * from code_helpers where session_id = any($1::text[]) order by started_at", [sessionIds]);
  for (const r of rows) {
    const entry = out.get(r.session_id) ?? { active: [], used: 0 };
    entry.used += 1;
    const alive = !r.ended_at && now.getTime() - new Date(r.last_activity_at).getTime() < HELPER_STALE_MS;
    if (alive) entry.active.push(toHelper(r));
    out.set(r.session_id, entry);
  }
  return out;
}

export function toSession(r: SessionRow, now: Date): CodeSession {
  const last = new Date(r.last_activity_at);
  const done = Boolean(r.ended_at) || r.pr?.state === "merged" || r.pr?.state === "closed";
  const state: CodeSession["state"] = done ? "done" : now.getTime() - last.getTime() < WORKING_MS ? "working" : "idle";
  return {
    id: r.id,
    actorId: actorIdOf(r.id),
    projectKey: r.project_key,
    source: r.source,
    url: r.url,
    branch: r.branch,
    title: r.title,
    lastAction: r.last_action,
    startedAt: new Date(r.started_at).toISOString(),
    lastActivityAt: last.toISOString(),
    state,
    commits: r.commits,
    pr: r.pr,
    helpers: [],
    helpersUsed: 0,
  };
}

/** Sessies die nog in de werkplaats horen: recent actief en niet klaar (of net klaar). */
export async function listSessions(db: Db, now: Date, opts: { projectKey?: string; limit?: number } = {}): Promise<CodeSession[]> {
  const since = new Date(now.getTime() - VISIBLE_MS).toISOString();
  const params: unknown[] = [since];
  let where = "last_activity_at >= $1";
  if (opts.projectKey) {
    params.push(opts.projectKey);
    where += ` and project_key = $${params.length}`;
  }
  params.push(opts.limit ?? 24);
  const rows = await db.query<SessionRow>(
    `select * from code_sessions where ${where} order by last_activity_at desc limit $${params.length}`,
    params,
  );
  const sessions = rows.map((r) => toSession(r, now));
  const helpers = await helpersOf(db, sessions.map((s) => s.id), now);
  for (const s of sessions) {
    const h = helpers.get(s.id);
    s.helpersUsed = h?.used ?? 0;
    // Een sessie die klaar is, heeft geen werkende helpers meer.
    s.helpers = s.state === "done" ? [] : (h?.active ?? []);
  }
  return sessions;
}

/** Zoekt de sessie die op deze branch van dit project werkt (de laatste dag). */
export async function sessionOnBranch(db: Db, projectKey: string, branch: string, now: Date): Promise<SessionRow | undefined> {
  const rows = await db.query<SessionRow>(
    `select * from code_sessions where project_key = $1 and branch = $2 and last_activity_at >= $3
     order by last_activity_at desc limit 1`,
    [projectKey, branch, new Date(now.getTime() - 24 * 3600_000).toISOString()],
  );
  return rows[0];
}

export interface SessionTouch {
  id: string;
  projectKey: string | null;
  source: CodeSession["source"];
  url?: string | null;
  branch?: string | null;
  /** Titel als de sessie nieuw is (de opdracht, of de eerste commit). */
  title?: string | null;
  action?: string | null;
  at: Date;
  commit?: boolean;
  ended?: boolean;
  /** Een nieuwe opdracht in een bestaande sessie vervangt de titel. */
  newTask?: boolean;
}

/** Werkt een sessie bij (of maakt hem aan). Geeft terug of hij nieuw was. */
export async function touchSession(db: Db, t: SessionTouch): Promise<{ created: boolean; row: SessionRow }> {
  const rows = await db.query<SessionRow & { inserted: boolean }>(
    `insert into code_sessions (id, project_key, source, url, branch, title, last_action, started_at, last_activity_at, commits, ended_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, case when $10 then $8::timestamptz else null end)
     on conflict (id) do update set
       project_key = coalesce(code_sessions.project_key, excluded.project_key),
       url = coalesce(code_sessions.url, excluded.url),
       branch = coalesce(excluded.branch, code_sessions.branch),
       title = case when $11 or code_sessions.title is null then coalesce(excluded.title, code_sessions.title) else code_sessions.title end,
       last_action = coalesce(excluded.last_action, code_sessions.last_action),
       last_activity_at = greatest(code_sessions.last_activity_at, excluded.last_activity_at),
       started_at = least(code_sessions.started_at, excluded.started_at),
       commits = code_sessions.commits + excluded.commits,
       ended_at = case when $10 then excluded.last_activity_at when excluded.last_activity_at > coalesce(code_sessions.ended_at, 'epoch') then null else code_sessions.ended_at end
     returning *, (xmax = 0) as inserted`,
    [
      t.id,
      t.projectKey,
      t.source,
      t.url ?? null,
      t.branch ?? null,
      t.title ?? null,
      t.action ?? null,
      t.at.toISOString(),
      t.commit ? 1 : 0,
      Boolean(t.ended),
      Boolean(t.newTask),
    ],
  );
  const { inserted, ...row } = rows[0]!;
  return { created: Boolean(inserted), row };
}

export async function setSessionPr(db: Db, id: string, pr: SessionRow["pr"]): Promise<void> {
  await db.query("update code_sessions set pr = $2 where id = $1", [id, pr ? JSON.stringify(pr) : null]);
}
