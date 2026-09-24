import { afterEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/index.js";
import { migrate } from "../src/db/migrate.js";
import { createTestDb } from "./helpers/db.js";

let db: Db | undefined;
afterEach(async () => {
  await db?.close();
  db = undefined;
});

describe("database-schema", () => {
  it("migreert en seedt de holding-tak", async () => {
    db = await createTestDb();
    const branches = await db.query<{ slug: string }>("select slug from branches");
    expect(branches.map((b) => b.slug)).toEqual(["holding"]);
  });

  it("is idempotent: een tweede migrate doet niets", async () => {
    db = await createTestDb();
    expect(await migrate(db)).toEqual([]);
  });

  it("weigert grootboekregels met bron 'agent'", async () => {
    db = await createTestDb();
    await expect(
      db.query(
        `insert into ledger (kind, amount_eur, source, external_id, occurred_at)
         values ('revenue', 10, 'agent', 'x', now())`,
      ),
    ).rejects.toThrow();
  });

  it("weigert negatieve bedragen en dubbele externe ids", async () => {
    db = await createTestDb();
    await expect(
      db.query(
        `insert into ledger (kind, amount_eur, source, external_id, occurred_at)
         values ('revenue', -1, 'stripe', 'x', now())`,
      ),
    ).rejects.toThrow();
    await db.query(
      `insert into ledger (kind, amount_eur, source, external_id, occurred_at)
       values ('revenue', 5, 'stripe', 'ch_1', now())`,
    );
    await expect(
      db.query(
        `insert into ledger (kind, amount_eur, source, external_id, occurred_at)
         values ('revenue', 5, 'stripe', 'ch_1', now())`,
      ),
    ).rejects.toThrow();
  });

  it("kent tijdzones (voor dagrapporten in Europe/Amsterdam)", async () => {
    db = await createTestDb();
    const rows = await db.query<{ d: string }>(
      `select to_char(('2026-09-22T23:30:00Z'::timestamptz at time zone 'Europe/Amsterdam')::date, 'YYYY-MM-DD') as d`,
    );
    expect(rows[0]?.d).toBe("2026-09-23");
  });
});
