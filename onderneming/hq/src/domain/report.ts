import { listApprovals } from "./approvals.js";
import { listBranches } from "./branches.js";
import { errorMessage, type AppContext } from "./context.js";
import { codeReportLines } from "../code/overview.js";
import { experimentCode, listExperiments, snapshot } from "./experiments.js";
import { haltState } from "./killswitch.js";
import { totals, totalsByBranch } from "./ledger.js";
import { formatEur, formatPct } from "./money.js";
import { addLocalDays, formatShortDate, startOfLocalDay, startOfLocalMonth } from "./time.js";

function signed(n: number): string {
  return `${n >= 0 ? "+" : "−"}${formatEur(Math.abs(n))}`;
}

/** Het ochtendbericht: gisteren in euro's, lopende experimenten en wat er op jou wacht. */
export async function buildDailyReport(ctx: AppContext): Promise<string> {
  const tz = ctx.config.timezone;
  const today = startOfLocalDay(ctx.now(), tz);
  const yesterday = addLocalDays(today, -1, tz);
  const monthStart = startOfLocalMonth(ctx.now(), tz);

  const day = await totals(ctx.db, { from: yesterday, to: today });
  const month = await totals(ctx.db, { from: monthStart, to: addLocalDays(today, 1, tz) });
  const byBranch = await totalsByBranch(ctx.db, yesterday, today);
  const branches = await listBranches(ctx.db, { includeKilled: true });
  const halt = await haltState(ctx);

  const lines: string[] = [];
  lines.push(`☀️ Dagrapport ${formatShortDate(yesterday, tz)}`);
  if (halt.halted) lines.push(`⛔ NOODSTOP actief: ${halt.reason ?? ""}`);
  lines.push(
    `Omzet ${formatEur(day.revenue)} · AI ${formatEur(day.tokenCost)} · uitgaven ${formatEur(day.spend)} · resultaat ${signed(day.profit)}`,
  );
  const branchLines = branches
    .map((b) => ({ b, t: byBranch.get(b.id) }))
    .filter(({ t }) => t && (t.revenue > 0 || t.cost > 0))
    .map(({ b, t }) => `• ${b.name}: omzet ${formatEur(t!.revenue)}, kosten ${formatEur(t!.cost)}`);
  if (branchLines.length) lines.push(...branchLines);

  // "Experiment X heeft €42 opgeleverd": omzet van gisteren per experiment, met het totaal tot nu toe.
  const earners = await ctx.db.query<{ experiment_id: number; title: string; day: string; total: string }>(
    `select l.experiment_id, e.title,
       sum(l.amount_eur) filter (where l.occurred_at >= $1 and l.occurred_at < $2) as day,
       sum(l.amount_eur) as total
     from ledger l join experiments e on e.id = l.experiment_id
     where l.kind = 'revenue' group by l.experiment_id, e.title
     having sum(l.amount_eur) filter (where l.occurred_at >= $1 and l.occurred_at < $2) > 0
     order by 3 desc limit 5`,
    [yesterday.toISOString(), today.toISOString()],
  );
  for (const r of earners) {
    lines.push(
      `💶 ${experimentCode(r.experiment_id)} ${r.title} heeft ${formatEur(Number(r.day))} opgeleverd (totaal ${formatEur(Number(r.total))})`,
    );
  }

  const allowance = ctx.config.money.globalMonthlyCapEur + ctx.config.money.revenueShareForAi * month.revenue;
  lines.push(
    "",
    `Deze maand: omzet ${formatEur(month.revenue)}, kosten ${formatEur(month.cost)} (${formatPct(allowance > 0 ? month.cost / allowance : 0)} van ${formatEur(allowance)}), resultaat ${signed(month.profit)}`,
  );

  const running = await listExperiments(ctx.db, { status: ["running"] });
  if (running.length) {
    lines.push("", `🧪 Lopend (${running.length}):`);
    for (const exp of running.slice(0, 8)) {
      try {
        const s = await snapshot(ctx, exp);
        const value = s.trustedValue ?? s.untrustedValue;
        const mark = s.trustedValue !== null && s.trustedValue >= exp.metricTarget ? " ✅" : s.trustedValue === null && s.untrustedValue !== null ? " (agent)" : "";
        lines.push(
          `• ${experimentCode(exp.id)} ${exp.title} — ${exp.metricName} ${value ?? 0}/${exp.metricTarget}${mark}, budget ${formatPct(s.budgetUsedPct)}, nog ${s.daysLeft ?? "?"} d`,
        );
      } catch (err) {
        lines.push(`• ${experimentCode(exp.id)} ${exp.title} (stand onbekend: ${errorMessage(err)})`);
      }
    }
  }

  const ended = (await listExperiments(ctx.db, { status: ["keep", "iterate", "killed"], limit: 20 })).filter(
    (e) => e.endedAt && e.endedAt >= yesterday && e.endedAt < today,
  );
  if (ended.length) {
    lines.push("", "Besluiten:");
    for (const e of ended) lines.push(`• ${experimentCode(e.id)} ${e.status.toUpperCase()}: ${e.decisionReason ?? ""}`);
  }

  const pending = await listApprovals(ctx.db, { status: ["pending"], limit: 50 });
  if (pending.length) lines.push("", `⏳ Wacht op jou: ${pending.length} verzoek(en) → /goedkeuringen`);

  const lessons = await ctx.db.query<{ n: string }>(
    "select count(*) as n from lessons where created_at >= $1 and created_at < $2",
    [yesterday.toISOString(), today.toISOString()],
  );
  const nLessons = Number(lessons[0]?.n ?? 0);
  if (nLessons > 0) lines.push(`📚 ${nLessons} nieuwe les(sen) vastgelegd.`);
  try {
    lines.push(...(await codeReportLines(ctx)));
  } catch (err) {
    lines.push("", `🛠️ Werkplaats: stand onbekend (${errorMessage(err)})`);
  }
  return lines.join("\n");
}

/** Kort overzicht voor /status. */
export async function buildStatus(ctx: AppContext): Promise<string> {
  const tz = ctx.config.timezone;
  const today = startOfLocalDay(ctx.now(), tz);
  const halt = await haltState(ctx);
  const t = await totals(ctx.db, { from: today, to: addLocalDays(today, 1, tz) });
  const month = await totals(ctx.db, { from: startOfLocalMonth(ctx.now(), tz), to: addLocalDays(today, 1, tz) });
  const lines = [halt.halted ? `⛔ NOODSTOP sinds ${halt.at?.slice(0, 16).replace("T", " ")}: ${halt.reason}` : "🟢 Alles draait"];
  try {
    const agents = await ctx.paperclip.listAgents(ctx.companyId);
    const count = (s: string) => agents.filter((a) => a.status === s).length;
    lines.push(
      `Agents: ${agents.filter((a) => a.status !== "terminated").length} (werkt ${count("running")}, idle ${count("idle") + count("active")}, gepauzeerd ${count("paused")}, fout ${count("error")})`,
    );
  } catch (err) {
    lines.push(`Agents: Paperclip onbereikbaar (${errorMessage(err)})`);
  }
  const running = await listExperiments(ctx.db, { status: ["running"] });
  const pending = await listApprovals(ctx.db, { status: ["pending"], limit: 100 });
  lines.push(
    `Vandaag: kosten ${formatEur(t.cost)}, omzet ${formatEur(t.revenue)}`,
    `Maand: kosten ${formatEur(month.cost)}, omzet ${formatEur(month.revenue)}`,
    `Experimenten lopend: ${running.length} · wacht op jou: ${pending.length}`,
  );
  return lines.join("\n");
}
