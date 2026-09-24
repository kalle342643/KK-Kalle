import type { Db } from "../db/index.js";
import type { CiState, CodeSession } from "../office/types.js";

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
  return rows.map((r) => toSession(r, now));
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
