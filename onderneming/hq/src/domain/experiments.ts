import { z } from "zod";
import { num, type Db } from "../db/index.js";
import { PaperclipError } from "../paperclip/client.js";
import { requestApproval, type ApprovalRecord } from "./approvals.js";
import { audit, countRecent } from "./audit.js";
import { DomainError, getBranch, HOLDING_SLUG, listBranches, requireBranch, type Branch } from "./branches.js";
import type { Actor, AppContext } from "./context.js";
import { assertNotHalted } from "./killswitch.js";
import { totals } from "./ledger.js";
import { safeProposalKnowledge, knowledgeSummaryLines, type ProposalKnowledge } from "../knowledge/precheck.js";
import { experimentCode } from "./codes.js";
import { eurToUsdCents, formatEur, round2 } from "./money.js";
import { addDays, daysBetween } from "./time.js";

export type ExperimentStatus = "proposed" | "approved" | "running" | "keep" | "iterate" | "killed" | "rejected";

export const OPEN_STATUSES: ExperimentStatus[] = ["proposed", "approved", "running"];

export interface Experiment {
  id: number;
  branchId: number;
  parentId: number | null;
  iteration: number;
  title: string;
  hypothesis: string;
  metricName: string;
  metricTarget: number;
  budgetEur: number;
  durationDays: number;
  status: ExperimentStatus;
  prediction: string | null;
  evidenceLinks: string[];
  plan: string | null;
  proposedByAgentId: string | null;
  leadAgentId: string | null;
  paperclipProjectId: string | null;
  approvalId: string | null;
  startedAt: Date | null;
  deadlineAt: Date | null;
  endedAt: Date | null;
  decisionReason: string | null;
  createdAt: Date;
}

interface ExperimentRow {
  id: number;
  branch_id: number;
  parent_id: number | null;
  iteration: number;
  title: string;
  hypothesis: string;
  metric_name: string;
  metric_target: string;
  budget_eur: string;
  duration_days: number;
  status: ExperimentStatus;
  prediction: string | null;
  evidence_links: string[];
  plan: string | null;
  proposed_by_agent_id: string | null;
  lead_agent_id: string | null;
  paperclip_project_id: string | null;
  approval_id: string | null;
  started_at: string | Date | null;
  deadline_at: string | Date | null;
  ended_at: string | Date | null;
  decision_reason: string | null;
  created_at: string | Date;
}

const d = (v: string | Date | null) => (v ? new Date(v) : null);

function toExperiment(r: ExperimentRow): Experiment {
  return {
    id: r.id,
    branchId: r.branch_id,
    parentId: r.parent_id,
    iteration: r.iteration,
    title: r.title,
    hypothesis: r.hypothesis,
    metricName: r.metric_name,
    metricTarget: num(r.metric_target),
    budgetEur: num(r.budget_eur),
    durationDays: r.duration_days,
    status: r.status,
    prediction: r.prediction,
    evidenceLinks: r.evidence_links ?? [],
    plan: r.plan,
    proposedByAgentId: r.proposed_by_agent_id,
    leadAgentId: r.lead_agent_id,
    paperclipProjectId: r.paperclip_project_id,
    approvalId: r.approval_id,
    startedAt: d(r.started_at),
    deadlineAt: d(r.deadline_at),
    endedAt: d(r.ended_at),
    decisionReason: r.decision_reason,
    createdAt: new Date(r.created_at),
  };
}

export { experimentCode };

export async function getExperiment(db: Db, id: number): Promise<Experiment | undefined> {
  const rows = await db.query<ExperimentRow>("select * from experiments where id = $1", [id]);
  return rows[0] ? toExperiment(rows[0]) : undefined;
}

export async function requireExperiment(db: Db, id: number): Promise<Experiment> {
  const e = await getExperiment(db, id);
  if (!e) throw new DomainError(`${experimentCode(id)} bestaat niet.`, 404);
  return e;
}

export async function listExperiments(
  db: Db,
  filter: { status?: ExperimentStatus[]; branchId?: number; limit?: number } = {},
): Promise<Experiment[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status?.length) {
    params.push(filter.status);
    where.push(`status = any($${params.length}::text[])`);
  }
  if (filter.branchId !== undefined) {
    params.push(filter.branchId);
    where.push(`branch_id = $${params.length}`);
  }
  params.push(filter.limit ?? 100);
  const rows = await db.query<ExperimentRow>(
    `select * from experiments ${where.length ? `where ${where.join(" and ")}` : ""}
     order by id desc limit $${params.length}`,
    params,
  );
  return rows.map(toExperiment);
}

async function setStatus(db: Db, id: number, status: ExperimentStatus, extra: Record<string, unknown> = {}): Promise<Experiment> {
  const sets = ["status = $2", "updated_at = now()"];
  const params: unknown[] = [id, status];
  for (const [col, value] of Object.entries(extra)) {
    params.push(value instanceof Date ? value.toISOString() : value);
    sets.push(`${col} = $${params.length}`);
  }
  const rows = await db.query<ExperimentRow>(`update experiments set ${sets.join(", ")} where id = $1 returning *`, params);
  return toExperiment(rows[0]!);
}

export const proposalSchema = z.object({
  branch: z.string().min(1),
  title: z.string().trim().min(5).max(120),
  hypothesis: z.string().trim().min(20).max(2000),
  metric: z.object({
    name: z
      .string()
      .regex(/^[a-z0-9_]{2,40}$/, "gebruik kleine letters, cijfers en _ (bv. plays, signups, revenue_eur)"),
    target: z.number().positive(),
  }),
  budgetEur: z.number().positive().optional(),
  durationDays: z.number().int().min(1).optional(),
  prediction: z.string().trim().max(1000).optional(),
  evidence: z.array(z.url({ protocol: /^https?$/ })).min(1, "minstens één link naar een echte bron").max(10),
  plan: z.string().trim().max(4000).optional(),
  parentId: z.number().int().positive().optional(),
  leadAgentId: z.string().optional(),
});

export type Proposal = z.infer<typeof proposalSchema>;

export interface BudgetGate {
  branchBudgetEur: number;
  branchCommittedEur: number;
  globalAllowanceEur: number;
  globalCommittedEur: number;
}

/** Hoeveel budget staat er al open (voorgesteld of lopend) per tak en in totaal? */
export async function budgetGate(ctx: AppContext, branch: Branch): Promise<BudgetGate> {
  const rows = await ctx.db.query<{ branch_id: number; total: string }>(
    `select branch_id, coalesce(sum(budget_eur), 0) as total from experiments
     where status = any($1::text[]) group by branch_id`,
    [OPEN_STATUSES],
  );
  let global = 0;
  let own = 0;
  for (const r of rows) {
    global += num(r.total);
    if (r.branch_id === branch.id) own = num(r.total);
  }
  const now = ctx.now();
  const revenue30 = (await totals(ctx.db, { from: addDays(now, -30), to: now })).revenue;
  return {
    branchBudgetEur: branch.monthlyBudgetEur,
    branchCommittedEur: round2(own),
    globalAllowanceEur: round2(ctx.config.money.globalMonthlyCapEur + ctx.config.money.revenueShareForAi * revenue30),
    globalCommittedEur: round2(global),
  };
}

/**
 * Een agent (of de eigenaar) stelt een experiment voor. HQ controleert de harde regels
 * en vraagt daarna jouw akkoord. Geld gaat pas lopen na goedkeuring.
 */
export async function proposeExperiment(
  ctx: AppContext,
  input: Proposal,
  actor: Actor,
): Promise<{ experiment: Experiment; approval: ApprovalRecord; knowledge: ProposalKnowledge | null }> {
  await assertNotHalted(ctx);
  const cfg = ctx.config.money;
  const branch = await requireBranch(ctx.db, input.branch);
  if (branch.slug === HOLDING_SLUG) throw new DomainError("Experimenten horen bij een tak, niet bij de holding.");
  if (branch.status !== "active") throw new DomainError(`Tak '${branch.slug}' is ${branch.status}.`);

  const budgetEur = round2(input.budgetEur ?? cfg.experimentBudgetEur);
  if (budgetEur > cfg.experimentMaxBudgetEur) {
    throw new DomainError(
      `Budget ${formatEur(budgetEur)} is hoger dan het maximum per experiment (${formatEur(cfg.experimentMaxBudgetEur)}).`,
    );
  }
  const durationDays = input.durationDays ?? cfg.experimentMaxDays;
  if (durationDays > cfg.experimentMaxDays) {
    throw new DomainError(`Een experiment duurt maximaal ${cfg.experimentMaxDays} dagen.`);
  }

  let iteration = 0;
  if (input.parentId) {
    const parent = await requireExperiment(ctx.db, input.parentId);
    if (parent.status !== "iterate") {
      throw new DomainError(`${experimentCode(parent.id)} heeft status '${parent.status}', geen 'iterate'.`);
    }
    if (parent.iteration >= cfg.maxIterations) {
      throw new DomainError(`${experimentCode(parent.id)} heeft al ${parent.iteration} iteraties gehad; maximum bereikt.`);
    }
    iteration = parent.iteration + 1;
  }

  const agentId = actor.startsWith("agent:") ? actor.slice("agent:".length) : null;
  if (agentId) {
    const recent = await countRecent(ctx.db, actor, ["approval.request"], 24);
    if (recent >= cfg.maxRequestsPerAgentPerDay) {
      throw new DomainError("Te veel verzoeken vandaag. Bundel je ideeën en probeer het morgen opnieuw.", 429);
    }
  }

  const gate = await budgetGate(ctx, branch);
  if (gate.branchCommittedEur + budgetEur > gate.branchBudgetEur) {
    throw new DomainError(
      `Takbudget ${branch.slug} is op: ${formatEur(gate.branchCommittedEur)} van ${formatEur(gate.branchBudgetEur)} ligt al vast. ` +
        "Rond eerst een experiment af of vraag de CEO om een portfolio-verschuiving.",
    );
  }
  if (gate.globalCommittedEur + budgetEur > gate.globalAllowanceEur) {
    throw new DomainError(
      `Het totale AI-budget (${formatEur(gate.globalAllowanceEur)}) is vergeven. Eerst moet er omzet of ruimte bij komen.`,
    );
  }

  const rows = await ctx.db.query<ExperimentRow>(
    `insert into experiments (branch_id, parent_id, iteration, title, hypothesis, metric_name, metric_target, budget_eur,
       duration_days, prediction, evidence_links, plan, proposed_by_agent_id, lead_agent_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning *`,
    [
      branch.id,
      input.parentId ?? null,
      iteration,
      input.title,
      input.hypothesis,
      input.metric.name,
      input.metric.target,
      budgetEur,
      durationDays,
      input.prediction ?? null,
      input.evidence,
      input.plan ?? null,
      agentId,
      // De tak-lead voert uit; de voorsteller (vaak een verkenner) alleen als er geen lead is.
      input.leadAgentId ?? branch.leadAgentId ?? agentId,
    ],
  );
  const experiment = toExperiment(rows[0]!);
  await audit(ctx.db, actor, "experiment.propose", { experimentId: experiment.id, budgetEur, branch: branch.slug });
  // Vooronderzoek: wat weet de holding hier al over? Staat bij het voorstel, zodat jij het ziet bij het beslissen.
  const knowledge = await safeProposalKnowledge(ctx, experiment);

  const summary = [
    `Tak: ${branch.name}`,
    `Hypothese: ${input.hypothesis}`,
    `Meetpunt: ${input.metric.name} ≥ ${input.metric.target} binnen ${durationDays} dagen`,
    input.prediction ? `Voorspelling: ${input.prediction}` : null,
    `Bewijs: ${input.evidence.join(" , ")}`,
    iteration > 0 ? `Iteratie ${iteration} van ${experimentCode(input.parentId!)}` : null,
    ...(knowledge ? knowledgeSummaryLines(knowledge) : []),
  ]
    .filter(Boolean)
    .join("\n");
  const approval = await requestApproval(
    ctx,
    {
      kind: "experiment_start",
      title: `${experimentCode(experiment.id)} ${experiment.title}`,
      summary,
      amountEur: budgetEur,
      experimentId: experiment.id,
      branchId: branch.id,
      requestedByAgentId: agentId,
    },
    actor,
  );
  await ctx.db.query("update experiments set approval_id = $2 where id = $1", [experiment.id, approval.paperclipApprovalId]);
  return { experiment: { ...experiment, approvalId: approval.paperclipApprovalId }, approval, knowledge };
}

/** Na jouw akkoord: project + hard budget in Paperclip, en een taak voor de verantwoordelijke agent. */
export async function startExperiment(ctx: AppContext, id: number): Promise<Experiment> {
  let exp = await requireExperiment(ctx.db, id);
  if (exp.status === "running") return exp;
  if (exp.status !== "proposed" && exp.status !== "approved") {
    throw new DomainError(`${experimentCode(id)} kan niet starten vanuit status '${exp.status}'.`);
  }
  exp = await setStatus(ctx.db, id, "approved");
  const branch = (await getBranch(ctx.db, exp.branchId))!;
  const lead = exp.leadAgentId ?? branch.leadAgentId ?? exp.proposedByAgentId;
  const name = `${experimentCode(id)} ${exp.title}`.slice(0, 120);

  let projectId = exp.paperclipProjectId;
  if (!projectId) {
    try {
      const project = await ctx.paperclip.createProject(ctx.companyId, {
        name,
        status: "in_progress",
        leadAgentId: lead,
        // Met het aanmaakmoment erbij: na een lege HQ-database begint de nummering opnieuw bij 1,
        // en dan mag EXP-1 niet op het oude project van een vorige EXP-1 botsen.
        idempotencyKey: `hq-exp-${id}-${exp.createdAt.getTime().toString(36)}`,
      });
      projectId = project.id;
    } catch (err) {
      if (!(err instanceof PaperclipError) || err.status >= 500) throw err;
      const existing = (await ctx.paperclip.listProjects(ctx.companyId)).find((p) => p.name === name);
      if (!existing) throw err;
      projectId = existing.id;
    }
    await ctx.db.query("update experiments set paperclip_project_id = $2 where id = $1", [id, projectId]);
  }

  await ctx.paperclip.upsertBudgetPolicy(ctx.companyId, {
    scopeType: "project",
    scopeId: projectId,
    windowKind: "lifetime",
    amount: eurToUsdCents(exp.budgetEur, ctx.config.money.usdToEur),
    hardStopEnabled: true,
  });

  const now = ctx.now();
  const deadline = addDays(now, exp.durationDays);
  if (lead) {
    await ctx.paperclip.createIssue(ctx.companyId, {
      title: `${experimentCode(id)}: ${exp.title}`,
      priority: "high",
      assigneeAgentId: lead,
      projectId,
      description: [
        `Je experiment is goedgekeurd. Budget: ${formatEur(exp.budgetEur)} (harde stop in Paperclip).`,
        `Deadline: ${deadline.toISOString().slice(0, 10)}.`,
        "",
        `**Hypothese:** ${exp.hypothesis}`,
        `**Succes:** ${exp.metricName} ≥ ${exp.metricTarget}`,
        exp.plan ? `\n**Plan:**\n${exp.plan}` : "",
        "",
        "Regels (zie skill hq-geld-en-regels):",
        `- Meld metingen via HQ: POST /api/agent/experiments/${id}/metrics`,
        "- Omzet boek je nooit zelf; die komt uit Stripe/CrazyGames-imports.",
        "- Publiceren, geld uitgeven of accounts aanmaken: altijd eerst een verzoek via HQ.",
      ].join("\n"),
    });
  }
  exp = await setStatus(ctx.db, id, "running", { started_at: now, deadline_at: deadline });
  await audit(ctx.db, "system", "experiment.start", { experimentId: id, projectId });
  await ctx.events.emit({
    type: "experiment.started",
    agentId: lead,
    text: `${experimentCode(id)} ${exp.title}`,
    data: { experimentId: id, branch: branch.slug, budgetEur: exp.budgetEur },
  });
  await ctx.notifier.send({
    text: `▶️ ${experimentCode(id)} gestart: ${exp.title}\nBudget ${formatEur(exp.budgetEur)}, deadline ${deadline.toISOString().slice(0, 10)}.`,
    silent: true,
  });
  return exp;
}

export async function rejectExperiment(ctx: AppContext, id: number, note: string | null): Promise<Experiment> {
  const exp = await requireExperiment(ctx.db, id);
  if (exp.status !== "proposed" && exp.status !== "approved") return exp;
  return setStatus(ctx.db, id, "rejected", { ended_at: ctx.now(), decision_reason: note ?? "Afgewezen door de eigenaar" });
}

export async function endExperiment(
  ctx: AppContext,
  id: number,
  status: Extract<ExperimentStatus, "keep" | "iterate" | "killed">,
  reason: string,
): Promise<Experiment> {
  return setStatus(ctx.db, id, status, { ended_at: ctx.now(), decision_reason: reason });
}

export async function increaseExperimentBudget(ctx: AppContext, id: number, extraEur: number): Promise<Experiment> {
  const exp = await requireExperiment(ctx.db, id);
  const newBudget = round2(exp.budgetEur + extraEur);
  const rows = await ctx.db.query<ExperimentRow>(
    "update experiments set budget_eur = $2, updated_at = now() where id = $1 returning *",
    [id, newBudget],
  );
  if (exp.paperclipProjectId) {
    const cents = eurToUsdCents(newBudget, ctx.config.money.usdToEur);
    await ctx.paperclip.upsertBudgetPolicy(ctx.companyId, {
      scopeType: "project",
      scopeId: exp.paperclipProjectId,
      windowKind: "lifetime",
      amount: cents,
      hardStopEnabled: true,
    });
    const overview = await ctx.paperclip.budgetsOverview(ctx.companyId);
    for (const inc of overview.activeIncidents) {
      if (inc.scopeType === "project" && inc.scopeId === exp.paperclipProjectId) {
        await ctx.paperclip.resolveBudgetIncident(
          ctx.companyId,
          inc.id,
          { action: "raise_budget_and_resume", amount: cents },
          "HQ: extra budget goedgekeurd",
        );
      }
    }
  }
  return toExperiment(rows[0]!);
}

export const metricSchema = z.object({
  name: z.string().regex(/^[a-z0-9_]{2,40}$/),
  value: z.number().finite(),
  note: z.string().max(500).optional(),
});

/**
 * Een meting. Van een agent is die 'onbetrouwbaar' (trusted=false): telt wel mee als signaal,
 * maar nooit als bewijs voor KEEP. Importers en de eigenaar leveren betrouwbare metingen.
 */
export async function recordMetric(
  ctx: AppContext,
  experimentId: number,
  input: { name: string; value: number; note?: string; source: string; trusted: boolean; externalId?: string },
  actor: Actor,
): Promise<void> {
  const exp = await requireExperiment(ctx.db, experimentId);
  if (actor.startsWith("agent:")) await assertNotHalted(ctx);
  if (!["running", "keep", "iterate"].includes(exp.status)) {
    throw new DomainError(`${experimentCode(experimentId)} loopt niet (status ${exp.status}).`);
  }
  await ctx.db.query(
    `insert into metrics (experiment_id, name, value, source, trusted, note, external_id, reported_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (source, external_id) do update set value = excluded.value, recorded_at = now()`,
    [experimentId, input.name, input.value, input.source, input.trusted, input.note ?? null, input.externalId ?? null, actor],
  );
  await audit(ctx.db, actor, "metric.record", { experimentId, name: input.name, value: input.value, trusted: input.trusted });
  await ctx.events.emit({
    type: "metric",
    agentId: actor.startsWith("agent:") ? actor.slice(6) : null,
    text: `${experimentCode(experimentId)} ${input.name}: ${input.value}`,
    data: { experimentId, name: input.name, value: input.value, trusted: input.trusted },
  });
}

export interface ExperimentSnapshot {
  experiment: Experiment;
  branch: Branch;
  spentEur: number;
  revenueEur: number;
  trustedValue: number | null;
  untrustedValue: number | null;
  budgetUsedPct: number;
  budgetExhausted: boolean;
  daysLeft: number | null;
}

/** Stand van zaken van één experiment: geld uit het grootboek, metingen uit de metrics-tabel. */
export async function snapshot(ctx: AppContext, exp: Experiment): Promise<ExperimentSnapshot> {
  const branch = (await getBranch(ctx.db, exp.branchId))!;
  const t = await totals(ctx.db, { experimentId: exp.id });
  let trustedValue: number | null = null;
  let untrustedValue: number | null = null;
  if (exp.metricName === "revenue_eur") {
    trustedValue = t.revenue;
  } else {
    const rows = await ctx.db.query<{ trusted: boolean; best: string | null }>(
      "select trusted, max(value) as best from metrics where experiment_id = $1 and name = $2 group by trusted",
      [exp.id, exp.metricName],
    );
    for (const r of rows) {
      if (r.trusted) trustedValue = r.best === null ? null : num(r.best);
      else untrustedValue = r.best === null ? null : num(r.best);
    }
  }
  const budgetUsedPct = exp.budgetEur > 0 ? t.cost / exp.budgetEur : 0;
  let budgetExhausted = t.cost >= exp.budgetEur;
  if (!budgetExhausted && exp.paperclipProjectId) {
    try {
      const overview = await ctx.paperclip.budgetsOverview(ctx.companyId);
      budgetExhausted = overview.activeIncidents.some(
        (i) => i.scopeType === "project" && i.scopeId === exp.paperclipProjectId,
      );
    } catch {
      // Paperclip even onbereikbaar: val terug op het grootboek.
    }
  }
  return {
    experiment: exp,
    branch,
    spentEur: t.cost,
    revenueEur: t.revenue,
    trustedValue,
    untrustedValue,
    budgetUsedPct,
    budgetExhausted,
    daysLeft: exp.deadlineAt ? Math.max(0, Math.ceil(daysBetween(ctx.now(), exp.deadlineAt))) : null,
  };
}

/** Alle actieve takken met hun lopende experimenten (voor rapporten en agents). */
export async function runningByBranch(ctx: AppContext): Promise<Array<{ branch: Branch; experiments: Experiment[] }>> {
  const branches = await listBranches(ctx.db);
  const running = await listExperiments(ctx.db, { status: ["running"] });
  return branches.map((branch) => ({ branch, experiments: running.filter((e) => e.branchId === branch.id) }));
}
