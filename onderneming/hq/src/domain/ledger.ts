import { num, type Db } from "../db/index.js";
import type { AppContext } from "./context.js";
import { round2 } from "./money.js";

export type LedgerKind = "token_cost" | "spend" | "revenue";

/** Bronnen die omzet mogen boeken. Een agent staat hier bewust niet tussen. */
export const REVENUE_SOURCES = new Set(["stripe", "csv", "crazygames", "affiliate", "owner"]);

export interface LedgerInput {
  kind: LedgerKind;
  amountEur: number;
  source: string;
  externalId: string;
  occurredAt: Date;
  branchId?: number | null;
  experimentId?: number | null;
  description?: string | null;
}

/**
 * Boekt of werkt een grootboekregel bij (idempotent op source + externalId).
 * Omzet mag alleen uit vertrouwde bronnen komen; agents kunnen hier nooit bij.
 * Geeft terug of de regel nieuw was.
 */
export async function recordLedger(db: Db, e: LedgerInput): Promise<{ inserted: boolean }> {
  if (e.kind === "revenue" && !REVENUE_SOURCES.has(e.source)) {
    throw new Error(`Omzet uit bron '${e.source}' is niet toegestaan.`);
  }
  if (!(e.amountEur >= 0)) throw new Error("Bedrag moet 0 of hoger zijn.");
  const rows = await db.query<{ inserted: boolean }>(
    `insert into ledger (branch_id, experiment_id, kind, amount_eur, source, external_id, description, occurred_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (source, external_id) do update set
       amount_eur = excluded.amount_eur,
       branch_id = excluded.branch_id,
       experiment_id = excluded.experiment_id,
       description = excluded.description,
       occurred_at = excluded.occurred_at
     returning (xmax = 0) as inserted`,
    [
      e.branchId ?? null,
      e.experimentId ?? null,
      e.kind,
      round2(e.amountEur),
      e.source,
      e.externalId,
      e.description ?? null,
      e.occurredAt.toISOString(),
    ],
  );
  return { inserted: rows[0]?.inserted === true };
}

/** Boekt omzet en laat hem in het kantoor zien als hij nieuw is (de kassa rinkelt). */
export async function recordRevenue(ctx: AppContext, e: Omit<LedgerInput, "kind">): Promise<{ inserted: boolean }> {
  const res = await recordLedger(ctx.db, { ...e, kind: "revenue" });
  if (res.inserted && e.amountEur > 0) {
    const branch = e.branchId
      ? (await ctx.db.query<{ slug: string }>("select slug from branches where id = $1", [e.branchId]))[0]?.slug ?? null
      : null;
    await ctx.events.emit({
      type: "revenue",
      text: e.description ?? null,
      data: { amountEur: round2(e.amountEur), branch, experimentId: e.experimentId ?? null, source: e.source },
      sourceKey: `revenue:${e.source}:${e.externalId}`,
    });
  }
  return res;
}

export async function ledgerExists(db: Db, source: string, externalId: string): Promise<boolean> {
  const rows = await db.query("select 1 from ledger where source = $1 and external_id = $2", [source, externalId]);
  return rows.length > 0;
}

export interface Totals {
  revenue: number;
  tokenCost: number;
  spend: number;
  /** tokenCost + spend */
  cost: number;
  profit: number;
}

function totalsFrom(rows: Array<{ kind: LedgerKind; total: string | number }>): Totals {
  const t = { revenue: 0, tokenCost: 0, spend: 0 };
  for (const r of rows) {
    if (r.kind === "revenue") t.revenue = num(r.total);
    if (r.kind === "token_cost") t.tokenCost = num(r.total);
    if (r.kind === "spend") t.spend = num(r.total);
  }
  const cost = round2(t.tokenCost + t.spend);
  return { revenue: round2(t.revenue), tokenCost: round2(t.tokenCost), spend: round2(t.spend), cost, profit: round2(t.revenue - cost) };
}

export async function totals(
  db: Db,
  filter: { from?: Date; to?: Date; branchId?: number; experimentId?: number } = {},
): Promise<Totals> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.from) {
    params.push(filter.from.toISOString());
    where.push(`occurred_at >= $${params.length}`);
  }
  if (filter.to) {
    params.push(filter.to.toISOString());
    where.push(`occurred_at < $${params.length}`);
  }
  if (filter.branchId !== undefined) {
    params.push(filter.branchId);
    where.push(`branch_id = $${params.length}`);
  }
  if (filter.experimentId !== undefined) {
    params.push(filter.experimentId);
    where.push(`experiment_id = $${params.length}`);
  }
  const rows = await db.query<{ kind: LedgerKind; total: string }>(
    `select kind, coalesce(sum(amount_eur), 0) as total from ledger
     ${where.length ? `where ${where.join(" and ")}` : ""} group by kind`,
    params,
  );
  return totalsFrom(rows);
}

export async function totalsByBranch(db: Db, from: Date, to: Date): Promise<Map<number | null, Totals>> {
  const rows = await db.query<{ branch_id: number | null; kind: LedgerKind; total: string }>(
    `select branch_id, kind, coalesce(sum(amount_eur), 0) as total from ledger
     where occurred_at >= $1 and occurred_at < $2 group by branch_id, kind`,
    [from.toISOString(), to.toISOString()],
  );
  const grouped = new Map<number | null, Array<{ kind: LedgerKind; total: string }>>();
  for (const r of rows) {
    const list = grouped.get(r.branch_id) ?? [];
    list.push({ kind: r.kind, total: r.total });
    grouped.set(r.branch_id, list);
  }
  const out = new Map<number | null, Totals>();
  for (const [branchId, list] of grouped) out.set(branchId, totalsFrom(list));
  return out;
}

export interface LedgerEntry {
  id: number;
  kind: LedgerKind;
  amountEur: number;
  source: string;
  description: string | null;
  branchId: number | null;
  experimentId: number | null;
  occurredAt: Date;
}

export async function recentLedger(db: Db, limit = 20, kind?: LedgerKind): Promise<LedgerEntry[]> {
  const rows = await db.query<{
    id: number;
    kind: LedgerKind;
    amount_eur: string;
    source: string;
    description: string | null;
    branch_id: number | null;
    experiment_id: number | null;
    occurred_at: string | Date;
  }>(
    `select * from ledger ${kind ? "where kind = $2" : ""} order by occurred_at desc, id desc limit $1`,
    kind ? [limit, kind] : [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    amountEur: num(r.amount_eur),
    source: r.source,
    description: r.description,
    branchId: r.branch_id,
    experimentId: r.experiment_id,
    occurredAt: new Date(r.occurred_at),
  }));
}
