import type { Db } from "./index.js";
import { migrations } from "./migrations.js";

/** Voert ontbrekende migraties uit, elk in een eigen transactie. Geeft de uitgevoerde ids terug. */
export async function migrate(db: Db): Promise<string[]> {
  await db.exec(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const applied = new Set(
    (await db.query<{ id: string }>("select id from schema_migrations")).map((r) => r.id),
  );
  const ran: string[] = [];
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query("insert into schema_migrations (id) values ($1)", [m.id]);
    });
    ran.push(m.id);
  }
  return ran;
}
