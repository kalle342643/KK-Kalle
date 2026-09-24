import { num } from "../db/index.js";
import { requestApproval, type ApprovalRecord } from "./approvals.js";
import { audit } from "./audit.js";
import { getBranch, HOLDING_SLUG, listBranches, updateBranch, type Branch } from "./branches.js";
import type { Actor, AppContext } from "./context.js";
import { OPEN_STATUSES } from "./experiments.js";
import { totals, totalsByBranch, type Totals } from "./ledger.js";
import { eurToUsdCents, formatEur, round2 } from "./money.js";
import { addDays } from "./time.js";

export interface BranchStats {
  branch: Branch;
  last30: Totals;
  roi: number | null;
  runningExperiments: number;
  committedEur: number;
  keepsLast60: number;
  currentBudgetEur: number;
  proposedBudgetEur: number;
  note: string;
}

export interface Portfolio {
  branches: BranchStats[];
  holding: Totals;
  revenue30: number;
  revenueShare: number;
  allowanceEur: number;
  totalProposedEur: number;
}

/**
 * Verdeelt het AI-budget over de takken. De regel (uit het bouwplan):
 *   budget = startbudget + 30% van de omzet van de laatste 30 dagen,
 *   nooit minder dan wat al vastligt in lopende experimenten,
 *   bonus van één startbudget voor takken met ROI ≥ 2 én een recente KEEP,
 *   en alles samen nooit meer dan het plafond + 30% van de totale omzet.
 */
export async function computePortfolio(ctx: AppContext): Promise<Portfolio> {
  const money = ctx.config.money;
  const now = ctx.now();
  const from = addDays(now, -30);
  const byBranch = await totalsByBranch(ctx.db, from, now);
  const all = await totals(ctx.db, { from, to: now });
  const committedRows = await ctx.db.query<{ branch_id: number; total: string; running: string }>(
    `select branch_id, coalesce(sum(budget_eur), 0) as total, count(*) filter (where status = 'running') as running
     from experiments where status = any($1::text[]) group by branch_id`,
    [OPEN_STATUSES],
  );
  const keepRows = await ctx.db.query<{ branch_id: number; n: string }>(
    `select branch_id, count(*) as n from experiments
     where status = 'keep' and ended_at > $1 group by branch_id`,
    [addDays(now, -60).toISOString()],
  );
  const empty: Totals = { revenue: 0, tokenCost: 0, spend: 0, cost: 0, profit: 0 };
  const allowanceEur = round2(money.globalMonthlyCapEur + money.revenueShareForAi * all.revenue);

  const branches = (await listBranches(ctx.db)).filter((b) => b.slug !== HOLDING_SLUG);
  const holding = (await listBranches(ctx.db)).find((b) => b.slug === HOLDING_SLUG);
  const stats: BranchStats[] = branches
    .filter((b) => b.status === "active")
    .map((branch) => {
      const last30 = byBranch.get(branch.id) ?? empty;
      const committed = committedRows.find((r) => r.branch_id === branch.id);
      const committedEur = committed ? num(committed.total) : 0;
      const keepsLast60 = num(keepRows.find((r) => r.branch_id === branch.id)?.n ?? 0);
      const roi = last30.cost > 0 ? round2(last30.revenue / last30.cost) : null;
      let proposed = money.experimentBudgetEur + money.revenueShareForAi * last30.revenue;
      const notes: string[] = [];
      if (roi !== null && roi >= 2 && keepsLast60 > 0) {
        proposed += money.experimentBudgetEur;
        notes.push("bonus: ROI ≥ 2× en recente KEEP");
      }
      if (last30.revenue === 0 && keepsLast60 === 0 && last30.cost > 2 * money.experimentBudgetEur) {
        notes.push("veel kosten zonder resultaat: overweeg pauzeren");
      }
      proposed = Math.max(proposed, committedEur);
      return {
        branch,
        last30,
        roi,
        runningExperiments: committed ? num(committed.running) : 0,
        committedEur: round2(committedEur),
        keepsLast60,
        currentBudgetEur: branch.monthlyBudgetEur,
        proposedBudgetEur: round2(proposed),
        note: notes.join("; "),
      };
    });

  // Past het niet binnen het totaal? Schaal het vrije deel naar rato terug (vastgelegd geld blijft staan).
  const total = stats.reduce((s, b) => s + b.proposedBudgetEur, 0);
  if (total > allowanceEur && total > 0) {
    const committedTotal = stats.reduce((s, b) => s + b.committedEur, 0);
    const free = Math.max(0, allowanceEur - committedTotal);
    const wanted = stats.reduce((s, b) => s + (b.proposedBudgetEur - b.committedEur), 0);
    const factor = wanted > 0 ? Math.min(1, free / wanted) : 0;
    for (const b of stats) {
      b.proposedBudgetEur = round2(b.committedEur + (b.proposedBudgetEur - b.committedEur) * factor);
      b.note = [b.note, "teruggeschaald tot het totaalplafond"].filter(Boolean).join("; ");
    }
  }
  return {
    branches: stats,
    holding: holding ? byBranch.get(holding.id) ?? empty : empty,
    revenue30: all.revenue,
    revenueShare: money.revenueShareForAi,
    allowanceEur,
    totalProposedEur: round2(stats.reduce((s, b) => s + b.proposedBudgetEur, 0)),
  };
}

export function formatPortfolio(p: Portfolio): string {
  const lines = p.branches.map((b) => {
    const roi = b.roi === null ? "geen kosten" : `ROI ${b.roi.toLocaleString("nl-NL")}×`;
    const change =
      Math.abs(b.proposedBudgetEur - b.currentBudgetEur) < 0.5
        ? `blijft ${formatEur(b.currentBudgetEur)}`
        : `${formatEur(b.currentBudgetEur)} → ${formatEur(b.proposedBudgetEur)}`;
    return `• ${b.branch.name}: ${change} (omzet 30d ${formatEur(b.last30.revenue)}, kosten ${formatEur(b.last30.cost)}, ${roi})${b.note ? ` — ${b.note}` : ""}`;
  });
  return [
    ...lines,
    `Holding-overhead 30d: ${formatEur(p.holding.cost)}`,
    `Totaal: ${formatEur(p.totalProposedEur)} van max. ${formatEur(p.allowanceEur)} (plafond + ${Math.round(p.revenueShare * 100)}% van ${formatEur(p.revenue30)} omzet)`,
  ].join("\n");
}

/** Wekelijks: stel een nieuwe verdeling voor als er iets verandert. */
export async function proposePortfolio(ctx: AppContext, actor: Actor): Promise<ApprovalRecord | null> {
  const p = await computePortfolio(ctx);
  const changes = p.branches
    .filter((b) => Math.abs(b.proposedBudgetEur - b.currentBudgetEur) >= 0.5)
    .map((b) => ({ branchId: b.branch.id, slug: b.branch.slug, from: b.currentBudgetEur, to: b.proposedBudgetEur }));
  if (changes.length === 0) return null;
  return requestApproval(
    ctx,
    {
      kind: "portfolio",
      title: "Portfolio-voorstel: budgetten per tak",
      summary: formatPortfolio(p),
      amountEur: p.totalProposedEur,
      details: { changes, allowanceEur: p.allowanceEur },
    },
    actor,
  );
}

export async function applyPortfolio(
  ctx: AppContext,
  details: { changes?: Array<{ branchId: number; to: number }>; allowanceEur?: number },
): Promise<void> {
  for (const c of details.changes ?? []) {
    const branch = await getBranch(ctx.db, c.branchId);
    if (!branch) continue;
    await updateBranch(ctx.db, branch.id, { monthlyBudgetEur: round2(c.to) });
  }
  if (typeof details.allowanceEur === "number" && details.allowanceEur > 0) {
    await syncCompanyBudget(ctx, details.allowanceEur);
  }
  await audit(ctx.db, "system", "portfolio.apply", { changes: details.changes ?? [] });
}

/** Het totale maandplafond als harde stop op bedrijfsniveau in Paperclip. */
export async function syncCompanyBudget(ctx: AppContext, allowanceEur: number): Promise<void> {
  await ctx.paperclip.updateCompany(ctx.companyId, {
    budgetMonthlyCents: eurToUsdCents(allowanceEur, ctx.config.money.usdToEur),
  });
}
