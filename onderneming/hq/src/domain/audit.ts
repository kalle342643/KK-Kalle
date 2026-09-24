import type { Db } from "../db/index.js";
import type { Actor } from "./context.js";

export async function audit(db: Db, actor: Actor, action: string, details: Record<string, unknown> = {}): Promise<void> {
  await db.query("insert into audit_log (actor, action, details) values ($1, $2, $3)", [
    actor,
    action,
    JSON.stringify(details),
  ]);
}

/** Aantal keer dat een actor een actie deed in de afgelopen `hours` uur (voor rate limits). */
export async function countRecent(db: Db, actor: Actor, actions: string[], hours: number): Promise<number> {
  const rows = await db.query<{ n: string | number }>(
    `select count(*) as n from audit_log
     where actor = $1 and action = any($2::text[]) and at > now() - ($3::int * interval '1 hour')`,
    [actor, actions, hours],
  );
  return Number(rows[0]?.n ?? 0);
}

export interface AuditEntry {
  at: Date;
  actor: string;
  action: string;
  details: Record<string, unknown>;
}

export async function recentAudit(db: Db, limit = 30): Promise<AuditEntry[]> {
  const rows = await db.query<{ at: Date | string; actor: string; action: string; details: Record<string, unknown> }>(
    "select at, actor, action, details from audit_log order by id desc limit $1",
    [limit],
  );
  return rows.map((r) => ({ ...r, at: new Date(r.at) }));
}
