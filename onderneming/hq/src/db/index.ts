import pg from "pg";

/** Minimale database-interface zodat productie (pg) en tests (PGlite) dezelfde code draaien. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Voert meerdere statements zonder parameters uit (voor migraties). */
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 5 });
  return wrapPool(pool);
}

function wrapPool(pool: pg.Pool): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const res = await pool.query(sql, params as unknown[]);
      return res.rows as T[];
    },
    async exec(sql: string): Promise<void> {
      await pool.query(sql);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const tx: Db = {
        async query<R>(sql: string, params: unknown[] = []): Promise<R[]> {
          const res = await client.query(sql, params as unknown[]);
          return res.rows as R[];
        },
        async exec(sql: string): Promise<void> {
          await client.query(sql);
        },
        transaction: (inner) => inner(tx),
        close: async () => {},
      };
      try {
        await client.query("BEGIN");
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

/** Postgres numeric/bigint komen als string terug; zet ze veilig om naar number. */
export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`Geen geldig getal: ${String(value)}`);
  return n;
}

export function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : num(value);
}

export function date(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

export function dateOrNull(value: unknown): Date | null {
  return value === null || value === undefined ? null : date(value);
}
