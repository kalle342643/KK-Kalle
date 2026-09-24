import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../../src/db/index.js";
import { migrate } from "../../src/db/migrate.js";

/**
 * In-memory Postgres (PGlite) met het volledige HQ-schema.
 * Opstarten kost een paar seconden, dus per testbestand hergebruiken we één instantie
 * en maken we hem tussen tests leeg.
 */
let shared: { pglite: PGlite; db: Db } | undefined;

const RESET_SQL = `
  truncate table branches, experiments, metrics, ledger, lessons, approvals, settings, audit_log, job_runs,
    notifications_sent, office_events, notes, agent_profiles restart identity cascade;
  insert into branches (slug, name, description, status, monthly_budget_eur)
  values ('holding', 'Holding', 'Overhead: CEO, analist en alles wat niet bij een tak hoort.', 'active', 0);
`;

function wrap(pglite: PGlite): Db {
  let queue: Promise<unknown> = Promise.resolve();
  // PGlite heeft één verbinding: serialiseer transacties zodat ze elkaar niet kruisen.
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const res = await pglite.query<T>(sql, params as unknown[]);
      return res.rows;
    },
    async exec(sql: string): Promise<void> {
      await pglite.exec(sql);
    },
    transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return serial(() =>
        pglite.transaction(async (t) => {
          const tx: Db = {
            async query<R>(sql: string, params: unknown[] = []): Promise<R[]> {
              const res = await t.query<R>(sql, params as unknown[]);
              return res.rows;
            },
            async exec(sql: string): Promise<void> {
              await t.exec(sql);
            },
            transaction: (inner) => inner(tx),
            close: async () => {},
          };
          return fn(tx);
        }),
      );
    },
    // De gedeelde instantie blijft open voor de volgende test in dit bestand.
    async close(): Promise<void> {},
  };
  return db;
}

export async function createTestDb(): Promise<Db> {
  if (!shared) {
    const pglite = new PGlite();
    const db = wrap(pglite);
    await migrate(db);
    shared = { pglite, db };
    return db;
  }
  await shared.pglite.exec(RESET_SQL);
  return shared.db;
}
