import { num, type Db } from "../db/index.js";
import { DomainError } from "../domain/branches.js";
import type { AppContext } from "../domain/context.js";
import { experimentCode, listExperiments, snapshot } from "../domain/experiments.js";
import { round2 } from "../domain/money.js";
import { addLocalDays, localDayKey, startOfLocalDay } from "../domain/time.js";
import type { OfficeEvent, OfficeProject, OfficeStats, ProjectDetail, ProjectStatus } from "./types.js";

/** Alle projecten (experimenten): lopend, voorgesteld en recent afgerond. */
export async function listProjects(ctx: AppContext, limit = 80): Promise<OfficeProject[]> {
  const exps = await listExperiments(ctx.db, { limit });
  const out: OfficeProject[] = [];
  for (const e of exps) {
    const s = await snapshot(ctx, e);
    out.push({
      id: e.id,
      code: experimentCode(e.id),
      title: e.title,
      branch: s.branch.slug,
      branchName: s.branch.name,
      status: e.status as ProjectStatus,
      leadAgentId: e.leadAgentId ?? s.branch.leadAgentId,
      metric: e.metricName,
      target: e.metricTarget,
      value: s.trustedValue ?? s.untrustedValue,
      trusted: s.trustedValue !== null,
      spentEur: s.spentEur,
      budgetEur: e.budgetEur,
      revenueEur: s.revenueEur,
      daysLeft: s.daysLeft,
      startedAt: e.startedAt?.toISOString() ?? null,
      endedAt: e.endedAt?.toISOString() ?? null,
      createdAt: e.createdAt.toISOString(),
      reason: e.decisionReason,
      iteration: e.iteration,
      hypothesis: e.hypothesis,
      prediction: e.prediction,
    });
  }
  return out;
}

export async function projectDetail(ctx: AppContext, id: number): Promise<ProjectDetail> {
  const project = (await listProjects(ctx, 500)).find((p) => p.id === id);
  if (!project) throw new DomainError(`Project ${experimentCode(id)} bestaat niet.`, 404);
  const metrics = await ctx.db.query<{ name: string; value: string | number; source: string; trusted: boolean; recorded_at: string | Date }>(
    "select name, value, source, trusted, recorded_at from metrics where experiment_id = $1 order by recorded_at, id limit 500",
    [id],
  );
  const ledger = await ctx.db.query<{ kind: string; amount_eur: string | number; source: string; description: string | null; occurred_at: string | Date }>(
    "select kind, amount_eur, source, description, occurred_at from ledger where experiment_id = $1 and amount_eur > 0 order by occurred_at desc limit 100",
    [id],
  );
  const lessons = await ctx.db.query<{ id: number; lesson: string; tags: string[] | null; created_at: string | Date }>(
    "select id, lesson, tags, created_at from lessons where experiment_id = $1 order by id desc limit 50",
    [id],
  );
  const events = await ctx.db.query<{
    id: number | string;
    at: string | Date;
    type: OfficeEvent["type"];
    agent_id: string | null;
    target_agent_id: string | null;
    text: string | null;
    data: Record<string, unknown> | null;
  }>(
    `select * from office_events where data->>'experimentId' = $1::text
       or text ~ $2 order by id desc limit 40`,
    [id, `${experimentCode(id)}([^0-9]|$)`],
  );
  return {
    project,
    metrics: metrics.map((m) => ({ name: m.name, value: num(m.value), source: m.source, trusted: m.trusted, at: new Date(m.recorded_at).toISOString() })),
    ledger: ledger.map((l) => ({
      kind: l.kind,
      amountEur: num(l.amount_eur),
      source: l.source,
      description: l.description,
      at: new Date(l.occurred_at).toISOString(),
    })),
    lessons: lessons.map((l) => ({ id: l.id, lesson: l.lesson, tags: l.tags ?? [], at: new Date(l.created_at).toISOString() })),
    events: events.map((e) => ({
      id: Number(e.id),
      at: new Date(e.at).toISOString(),
      type: e.type,
      agentId: e.agent_id,
      targetAgentId: e.target_agent_id,
      text: e.text,
      data: e.data ?? {},
    })),
  };
}

/** Cijfers voor de controlekamer: omzet en kosten per dag (30 dagen) en per tak. */
export async function officeStats(ctx: AppContext, days = 30): Promise<OfficeStats> {
  const tz = ctx.config.timezone;
  const today = startOfLocalDay(ctx.now(), tz);
  const from = addLocalDays(today, -(days - 1), tz);
  const to = addLocalDays(today, 1, tz);
  const rows = await ctx.db.query<{ kind: string; amount_eur: string | number; occurred_at: string | Date; branch_id: number | null }>(
    "select kind, amount_eur, occurred_at, branch_id from ledger where occurred_at >= $1 and occurred_at < $2",
    [from.toISOString(), to.toISOString()],
  );
  const perDay = new Map<string, { revenueEur: number; costEur: number }>();
  for (let k = 0; k < days; k++) perDay.set(localDayKey(addLocalDays(from, k, tz), tz), { revenueEur: 0, costEur: 0 });
  const perBranch = new Map<number | null, { revenue: number; cost: number }>();
  for (const r of rows) {
    const key = localDayKey(new Date(r.occurred_at), tz);
    const day = perDay.get(key);
    const amount = num(r.amount_eur);
    const b = perBranch.get(r.branch_id) ?? { revenue: 0, cost: 0 };
    if (r.kind === "revenue") {
      if (day) day.revenueEur += amount;
      b.revenue += amount;
    } else {
      if (day) day.costEur += amount;
      b.cost += amount;
    }
    perBranch.set(r.branch_id, b);
  }
  const branches = await ctx.db.query<{ id: number; slug: string; name: string; monthly_budget_eur: string | number }>(
    "select id, slug, name, monthly_budget_eur from branches where status <> 'killed' order by id",
  );
  const runs = await ctx.db.query<{ n: string | number; tokens: string | number | null }>(
    `select count(*) as n, sum(coalesce((data->>'tokensIn')::numeric, 0) + coalesce((data->>'tokensOut')::numeric, 0)) as tokens
     from office_events where type = 'run.finished' and at >= $1`,
    [today.toISOString()],
  );
  const dayList = [...perDay.entries()].map(([date, v]) => ({ date, revenueEur: round2(v.revenueEur), costEur: round2(v.costEur) }));
  return {
    days: dayList,
    branches: branches.map((b) => ({
      slug: b.slug,
      name: b.name,
      revenue30Eur: round2(perBranch.get(b.id)?.revenue ?? 0),
      cost30Eur: round2(perBranch.get(b.id)?.cost ?? 0),
      budgetEur: num(b.monthly_budget_eur),
    })),
    totals: {
      revenue30Eur: round2(dayList.reduce((s, d) => s + d.revenueEur, 0)),
      cost30Eur: round2(dayList.reduce((s, d) => s + d.costEur, 0)),
      tokensToday: Number(runs[0]?.tokens ?? 0),
      runsToday: Number(runs[0]?.n ?? 0),
    },
  };
}

export type { Db };
