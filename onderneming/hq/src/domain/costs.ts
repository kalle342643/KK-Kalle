import { holdingBranch } from "./branches.js";
import type { AppContext } from "./context.js";
import { halt, isHalted } from "./killswitch.js";
import { ledgerExists, recordLedger, totals } from "./ledger.js";
import { formatEur, round2, usdCentsToEur } from "./money.js";
import { markNotified } from "./settings.js";
import { addLocalDays, localDayKey, startOfLocalDay } from "./time.js";

/**
 * Haalt de AI-kosten uit Paperclip en boekt ze per dag in het grootboek:
 * per experiment-project op de tak van dat experiment, de rest op de holding.
 * Idempotent: dezelfde dag opnieuw ophalen werkt het bedrag bij.
 */
export async function syncCosts(ctx: AppContext, days = 3): Promise<{ entries: number; todayEur: number }> {
  const tz = ctx.config.timezone;
  const rate = ctx.config.money.usdToEur;
  const holding = await holdingBranch(ctx.db);
  const projectMap = new Map<string, { experimentId: number; branchId: number }>();
  for (const r of await ctx.db.query<{ id: number; branch_id: number; paperclip_project_id: string }>(
    "select id, branch_id, paperclip_project_id from experiments where paperclip_project_id is not null",
  )) {
    projectMap.set(r.paperclip_project_id, { experimentId: r.id, branchId: r.branch_id });
  }

  let entries = 0;
  let todayEur = 0;
  const todayStart = startOfLocalDay(ctx.now(), tz);
  for (let i = days - 1; i >= 0; i--) {
    const from = addLocalDays(todayStart, -i, tz);
    const to = addLocalDays(from, 1, tz);
    const range = { from: from.toISOString(), to: to.toISOString() };
    const day = localDayKey(from, tz);
    const [summary, byProject] = await Promise.all([
      ctx.paperclip.costsSummary(ctx.companyId, range),
      ctx.paperclip.costsByProject(ctx.companyId, range),
    ]);
    let attributedCents = 0;
    for (const p of byProject) {
      if (!p.projectId || p.costCents <= 0) continue;
      const link = projectMap.get(p.projectId);
      attributedCents += p.costCents;
      await recordLedger(ctx.db, {
        kind: "token_cost",
        amountEur: usdCentsToEur(p.costCents, rate),
        source: "paperclip",
        externalId: `project:${p.projectId}:${day}`,
        occurredAt: from,
        branchId: link?.branchId ?? holding.id,
        experimentId: link?.experimentId ?? null,
        description: `AI-kosten ${p.projectName ?? p.projectId} (${day})`,
      });
      entries += 1;
    }
    const rest = Math.max(0, summary.spendCents - attributedCents);
    const restId = `unattributed:${day}`;
    // Geen lege €0-regels, maar een eerder geboekt bedrag wel bijwerken (bv. na een correctie in Paperclip).
    if (rest > 0 || (await ledgerExists(ctx.db, "paperclip", restId))) {
      await recordLedger(ctx.db, {
        kind: "token_cost",
        amountEur: usdCentsToEur(rest, rate),
        source: "paperclip",
        externalId: restId,
        occurredAt: from,
        branchId: holding.id,
        description: `AI-kosten zonder project (${day})`,
      });
      entries += 1;
    }
    if (i === 0) todayEur = usdCentsToEur(summary.spendCents, rate);
  }
  await checkSpendAlarm(ctx, todayEur);
  return { entries, todayEur: round2(todayEur) };
}

/** Veiligheidsnet: kost vandaag meer dan het alarmbedrag, dan gaat alles automatisch op stop. */
export async function checkSpendAlarm(ctx: AppContext, todayEur: number): Promise<boolean> {
  const limit = ctx.config.money.dailySpendAlarmEur;
  if (todayEur < limit || (await isHalted(ctx))) return false;
  const day = localDayKey(ctx.now(), ctx.config.timezone);
  await halt(ctx, `Dagalarm: ${formatEur(todayEur)} AI-kosten vandaag (grens ${formatEur(limit)})`, "job:cost-sync");
  if (await markNotified(ctx.db, `spend-alarm:${day}`)) {
    await ctx.notifier.send({
      text: `🚨 Noodstop: vandaag al ${formatEur(todayEur)} aan AI-kosten (grens ${formatEur(limit)}).\nAlle agents staan stil. Kijk in het dashboard wat er gebeurde en stuur /hervat als het veilig is.`,
    });
  }
  return true;
}

/** Kosten van vandaag volgens het grootboek (na de laatste sync). */
export async function costToday(ctx: AppContext): Promise<number> {
  const from = startOfLocalDay(ctx.now(), ctx.config.timezone);
  const t = await totals(ctx.db, { from, to: addLocalDays(from, 1, ctx.config.timezone) });
  return t.cost;
}
