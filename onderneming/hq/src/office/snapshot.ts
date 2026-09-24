import { listApprovals } from "../domain/approvals.js";
import { listBranches } from "../domain/branches.js";
import { errorMessage, type AppContext } from "../domain/context.js";
import { experimentCode, listExperiments, snapshot } from "../domain/experiments.js";
import { haltState } from "../domain/killswitch.js";
import { totals } from "../domain/ledger.js";
import { round2, usdCentsToEur } from "../domain/money.js";
import { computePortfolio } from "../domain/portfolio.js";
import { addLocalDays, startOfLocalDay, startOfLocalMonth } from "../domain/time.js";
import { knowledgeGraph } from "../knowledge/service.js";
import type { PcAgent } from "../paperclip/types.js";
import type { OfficeAgent, OfficeBranch, OfficeSnapshot } from "./types.js";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Alles wat het kantoor nodig heeft om te tekenen: agents, takken, jouw bureau en de laatste gebeurtenissen. */
export async function buildOfficeSnapshot(ctx: AppContext): Promise<OfficeSnapshot> {
  const tz = ctx.config.timezone;
  const today = startOfLocalDay(ctx.now(), tz);
  const tomorrow = addLocalDays(today, 1, tz);
  const [halt, day, month, portfolio, pending, branches, running] = await Promise.all([
    haltState(ctx),
    totals(ctx.db, { from: today, to: tomorrow }),
    totals(ctx.db, { from: startOfLocalMonth(ctx.now(), tz), to: tomorrow }),
    computePortfolio(ctx),
    listApprovals(ctx.db, { status: ["pending"], limit: 30 }),
    listBranches(ctx.db),
    listExperiments(ctx.db, { status: ["running"] }),
  ]);

  let paperclipError: string | null = null;
  let pcAgents: PcAgent[] = [];
  const costToday = new Map<string, number>();
  let companyName = "HQ";
  try {
    pcAgents = (await ctx.paperclip.listAgents(ctx.companyId)).filter((a) => a.status !== "terminated");
    for (const c of await ctx.paperclip.costsByAgent(ctx.companyId, { from: today.toISOString(), to: tomorrow.toISOString() })) {
      costToday.set(c.agentId, usdCentsToEur(c.costCents, ctx.config.money.usdToEur));
    }
    companyName = (await ctx.paperclip.listCompanies()).find((c) => c.id === ctx.companyId)?.name ?? companyName;
  } catch (err) {
    paperclipError = errorMessage(err);
  }

  // Waar werken ze nu aan? De watcher legde bij elke gestarte run de taak vast.
  const tasks = new Map<string, string>();
  const liveAgents = pcAgents.filter((a) => a.status === "running").map((a) => a.id);
  if (liveAgents.length) {
    const rows = await ctx.db.query<{ agent_id: string; text: string | null }>(
      `select distinct on (agent_id) agent_id, text from office_events
       where type = 'run.started' and agent_id = any($1::text[]) order by agent_id, id desc`,
      [liveAgents],
    );
    for (const r of rows) if (r.text) tasks.set(r.agent_id, r.text);
  }

  const agents: OfficeAgent[] = pcAgents.map((a) => {
    const hq = (a.metadata?.hq ?? {}) as Record<string, unknown>;
    const model = str((a.adapterConfig as Record<string, unknown> | undefined)?.model);
    const hqRole = str(hq.hqRole) ?? (str(hq.template) === "tak-lead" ? "lead" : null);
    return {
      id: a.id,
      name: a.name,
      role: a.role,
      title: a.title,
      status: a.status,
      branch: str(hq.branch) ?? "holding",
      hqRole,
      template: str(hq.template),
      reportsTo: a.reportsTo,
      model,
      costTodayEur: round2(costToday.get(a.id) ?? 0),
      spentMonthEur: usdCentsToEur(a.spentMonthlyCents, ctx.config.money.usdToEur),
      budgetMonthEur: usdCentsToEur(a.budgetMonthlyCents, ctx.config.money.usdToEur),
      lastActiveAt: a.lastHeartbeatAt,
      pauseReason: a.pauseReason,
      currentTask: tasks.get(a.id) ?? null,
    };
  });

  const officeBranches: OfficeBranch[] = [];
  for (const b of branches) {
    const exps = [];
    for (const e of running.filter((x) => x.branchId === b.id)) {
      const s = await snapshot(ctx, e);
      exps.push({
        id: e.id,
        code: experimentCode(e.id),
        title: e.title,
        metric: e.metricName,
        target: e.metricTarget,
        value: s.trustedValue ?? s.untrustedValue,
        trusted: s.trustedValue !== null,
        spentEur: s.spentEur,
        budgetEur: e.budgetEur,
        daysLeft: s.daysLeft,
        leadAgentId: e.leadAgentId ?? b.leadAgentId,
      });
    }
    officeBranches.push({
      slug: b.slug,
      name: b.name,
      template: b.template,
      status: b.status,
      monthlyBudgetEur: b.monthlyBudgetEur,
      leadAgentId: b.leadAgentId,
      experiments: exps,
    });
  }

  let knowledge: OfficeSnapshot["knowledge"] = { source: "hq", nodes: 0, edges: 0, builtAt: null };
  try {
    const g = await knowledgeGraph(ctx, 1);
    knowledge = { source: g.source, nodes: g.totalNodes, edges: g.totalEdges, builtAt: g.builtAt };
  } catch (err) {
    ctx.log.warn("kennisgraaf laden mislukt", { error: errorMessage(err) });
  }

  return {
    generatedAt: ctx.now().toISOString(),
    companyName,
    halted: halt.halted,
    haltReason: halt.reason,
    timezone: tz,
    kpis: {
      revenueTodayEur: day.revenue,
      costTodayEur: day.cost,
      revenueMonthEur: month.revenue,
      costMonthEur: month.cost,
      allowanceMonthEur: portfolio.allowanceEur,
      runningExperiments: running.length,
      pendingApprovals: pending.length,
    },
    branches: officeBranches,
    agents,
    approvals: pending.map((a) => ({
      id: a.id,
      title: a.title,
      kind: a.kind,
      summary: a.summary ? a.summary.slice(0, 600) : null,
      amountEur: a.amountEur,
      requestedByAgentId: a.requestedByAgentId,
      createdAt: a.createdAt.toISOString(),
    })),
    knowledge,
    events: await ctx.events.recent(40),
    lastEventId: await ctx.events.lastId(),
    paperclipError,
  };
}
