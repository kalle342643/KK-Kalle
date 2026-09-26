import { z } from "zod";
import {
  announceDecision,
  getApproval,
  listApprovals,
  markApplied,
  mirrorApproval,
  notifyApproval,
  prependApprovalSummary,
  recordDecision,
  requestApproval,
  type ApprovalRecord,
  type Decision,
} from "./approvals.js";
import { audit, countRecent } from "./audit.js";
import { createBranch, DomainError, getBranchBySlug, requireBranch } from "./branches.js";
import { errorMessage, type Actor, type AppContext } from "./context.js";
import {
  experimentCode,
  increaseExperimentBudget,
  rejectExperiment,
  requireExperiment,
  startExperiment,
} from "./experiments.js";
import { assertNotHalted } from "./killswitch.js";
import { recordLedger } from "./ledger.js";
import { formatEur, round2 } from "./money.js";
import { applyPortfolio } from "./portfolio.js";
import { markNotified } from "./settings.js";

/**
 * Een beslissing van de eigenaar (Telegram-knop, dashboard of Paperclip-UI) vastleggen én uitvoeren.
 */
export async function decide(
  ctx: AppContext,
  approvalId: number,
  decision: Decision,
  note: string | null,
  actor: Actor,
): Promise<ApprovalRecord> {
  const record = await recordDecision(ctx, approvalId, decision, note, actor);
  return applyDecision(ctx, record);
}

/** Hooks die andere modules registreren (voorkomt kringverwijzingen, bv. naar de Agent Factory). */
export interface WorkflowHooks {
  createBranchFromTemplate?: (ctx: AppContext, details: BranchProposal & { approvalId: number }) => Promise<void>;
  /** Bezetting en kosten bij een aanname die de sync als eerste ziet (Agent Factory). */
  describeHire?: (ctx: AppContext, payload: Record<string, unknown>) => Promise<string>;
}

const hooks: WorkflowHooks = {};

export function registerWorkflowHooks(h: WorkflowHooks): void {
  Object.assign(hooks, h);
}

/** Voert de gevolgen van een beslissing uit. Idempotent: `applied_at` voorkomt dubbel uitvoeren. */
export async function applyDecision(ctx: AppContext, record: ApprovalRecord): Promise<ApprovalRecord> {
  if (record.appliedAt) return record;
  if (record.status !== "approved" && record.status !== "rejected") return record;
  const hq = (record.payload.hq ?? {}) as Record<string, unknown>;
  const approved = record.status === "approved";
  try {
    switch (record.kind) {
      case "experiment_start":
        if (record.experimentId) {
          if (approved) await startExperiment(ctx, record.experimentId);
          else await rejectExperiment(ctx, record.experimentId, record.decisionNote);
        }
        break;
      case "budget_increase":
        if (approved && record.experimentId && record.amountEur) {
          await increaseExperimentBudget(ctx, record.experimentId, record.amountEur);
          await ctx.notifier.send({
            text: `📈 ${experimentCode(record.experimentId)} krijgt ${formatEur(record.amountEur)} extra budget.`,
            silent: true,
          });
        }
        break;
      case "spend":
        if (approved && record.amountEur) {
          // Agents kunnen zelf niets betalen: de eigenaar voert de uitgave uit. We boeken het als toegezegd.
          await recordLedger(ctx.db, {
            kind: "spend",
            amountEur: record.amountEur,
            source: "approval",
            externalId: `approval:${record.paperclipApprovalId}`,
            occurredAt: ctx.now(),
            branchId: record.branchId,
            experimentId: record.experimentId,
            description: record.title,
          });
          await ctx.notifier.send({
            text: `💳 Goedgekeurd: ${record.title} (${formatEur(record.amountEur)}).\nVoer de betaling zelf uit${typeof hq.vendor === "string" ? ` bij ${hq.vendor}` : ""}; agents hebben geen toegang tot geld.`,
          });
        }
        break;
      case "branch_create":
        if (approved) {
          if (!hooks.createBranchFromTemplate) throw new Error("Agent Factory is niet geladen.");
          await hooks.createBranchFromTemplate(ctx, { ...(hq as unknown as BranchProposal), approvalId: record.id });
        }
        break;
      case "portfolio":
        if (approved) await applyPortfolio(ctx, hq as { changes?: Array<{ branchId: number; to: number }>; allowanceEur?: number });
        break;
      default:
        // hire_agent, ceo_strategy, budget_override en generic: Paperclip handelt de gevolgen zelf af.
        break;
    }
    await markApplied(ctx.db, record.id);
    return (await getApproval(ctx.db, record.id))!;
  } catch (err) {
    const msg = errorMessage(err);
    await markApplied(ctx.db, record.id, msg);
    ctx.log.error("beslissing uitvoeren mislukt", { approvalId: record.id, error: msg });
    if (await markNotified(ctx.db, `apply-error:${record.id}`)) {
      await ctx.notifier.send({
        text: `⚠️ Uitvoeren van #${record.id} (${record.title}) mislukte: ${msg}\nHQ probeert het automatisch opnieuw.`,
      });
    }
    return (await getApproval(ctx.db, record.id))!;
  }
}

/**
 * Houdt HQ gelijk met Paperclip: nieuwe verzoeken melden, beslissingen uit de Paperclip-UI
 * overnemen en mislukte uitvoeringen opnieuw proberen.
 */
export async function syncApprovals(ctx: AppContext): Promise<{ newPending: number; decided: number; retried: number }> {
  let newPending = 0;
  let decided = 0;
  let retried = 0;
  const pending = await ctx.paperclip.listApprovals(ctx.companyId, "pending");
  const pendingIds = new Set(pending.map((a) => a.id));
  for (const pc of pending) {
    const mirrored = await mirrorApproval(ctx, pc);
    let record = mirrored.record;
    if (mirrored.isNew) {
      newPending += 1;
      if (record.kind === "hire_agent" && hooks.describeHire) {
        try {
          record = await prependApprovalSummary(ctx, record, await hooks.describeHire(ctx, pc.payload ?? {}));
        } catch (err) {
          ctx.log.warn("bezetting bij aanname niet gelukt", { approvalId: record.id, error: errorMessage(err) });
        }
      }
    }
    await notifyApproval(ctx, record);
  }
  // Wat HQ nog als open ziet maar niet meer in de Paperclip-lijst staat, is ergens anders beslist.
  for (const record of await listApprovals(ctx.db, { status: ["pending", "revision_requested"], limit: 200 })) {
    if (pendingIds.has(record.paperclipApprovalId)) continue;
    const pc = await ctx.paperclip.getApproval(record.paperclipApprovalId);
    const { record: updated } = await mirrorApproval(ctx, pc);
    if (updated.status === "approved" || updated.status === "rejected") {
      decided += 1;
      await announceDecision(ctx, updated);
      await applyDecision(ctx, updated);
    }
  }
  for (const record of await listApprovals(ctx.db, { status: ["approved", "rejected"], unapplied: true, limit: 50 })) {
    retried += 1;
    await applyDecision(ctx, record);
  }
  return { newPending, decided, retried };
}

async function checkAgentRateLimit(ctx: AppContext, actor: Actor): Promise<void> {
  if (!actor.startsWith("agent:")) return;
  const recent = await countRecent(ctx.db, actor, ["approval.request"], 24);
  if (recent >= ctx.config.money.maxRequestsPerAgentPerDay) {
    throw new DomainError("Te veel verzoeken vandaag. Bundel je vragen en probeer het morgen opnieuw.", 429);
  }
}

const agentIdOf = (actor: Actor): string | null => (actor.startsWith("agent:") ? actor.slice(6) : null);

export const budgetRequestSchema = z.object({
  amountEur: z.number().positive(),
  reason: z.string().trim().min(20).max(2000),
});

/** Na een KEEP: extra budget om op te schalen. Altijd via jouw akkoord. */
export async function requestBudgetIncrease(
  ctx: AppContext,
  experimentId: number,
  input: z.infer<typeof budgetRequestSchema>,
  actor: Actor,
): Promise<ApprovalRecord> {
  await assertNotHalted(ctx);
  await checkAgentRateLimit(ctx, actor);
  const exp = await requireExperiment(ctx.db, experimentId);
  if (!["running", "keep"].includes(exp.status)) {
    throw new DomainError(`Extra budget kan alleen voor lopende of geslaagde experimenten (status is ${exp.status}).`);
  }
  if (input.amountEur > ctx.config.money.experimentMaxBudgetEur) {
    throw new DomainError(`Maximaal ${formatEur(ctx.config.money.experimentMaxBudgetEur)} per verzoek.`);
  }
  // In de praktijk vroeg een lead in twee runs twee keer hetzelfde aan: één open verzoek per experiment is genoeg.
  const open = (await listApprovals(ctx.db, { status: ["pending"], limit: 200 })).find(
    (a) => a.kind === "budget_increase" && a.experimentId === exp.id,
  );
  if (open) {
    throw new DomainError(`Er staat al een budgetverzoek open voor ${experimentCode(exp.id)} (#${open.id}). Wacht op de eigenaar.`, 409);
  }
  return requestApproval(
    ctx,
    {
      kind: "budget_increase",
      title: `${experimentCode(exp.id)} ${exp.title}: +${formatEur(input.amountEur)}`,
      summary: input.reason,
      amountEur: round2(input.amountEur),
      experimentId: exp.id,
      branchId: exp.branchId,
      requestedByAgentId: agentIdOf(actor),
    },
    actor,
  );
}

export const spendRequestSchema = z.object({
  amountEur: z.number().positive().max(10_000),
  what: z.string().trim().min(5).max(200),
  vendor: z.string().trim().max(100).optional(),
  reason: z.string().trim().min(20).max(2000),
  branch: z.string().optional(),
  experimentId: z.number().int().positive().optional(),
});

/** Echt geld uitgeven (domein, advertenties, tools). De eigenaar betaalt zelf na goedkeuring. */
export async function requestSpend(
  ctx: AppContext,
  input: z.infer<typeof spendRequestSchema>,
  actor: Actor,
): Promise<ApprovalRecord> {
  await assertNotHalted(ctx);
  await checkAgentRateLimit(ctx, actor);
  let branchId: number | null = null;
  if (input.experimentId) branchId = (await requireExperiment(ctx.db, input.experimentId)).branchId;
  else if (input.branch) branchId = (await requireBranch(ctx.db, input.branch)).id;
  return requestApproval(
    ctx,
    {
      kind: "spend",
      title: `Uitgave: ${input.what}`,
      summary: `${input.reason}${input.vendor ? `\nLeverancier: ${input.vendor}` : ""}`,
      amountEur: round2(input.amountEur),
      branchId,
      experimentId: input.experimentId ?? null,
      requestedByAgentId: agentIdOf(actor),
      details: { vendor: input.vendor ?? null, what: input.what },
    },
    actor,
  );
}

export const branchProposalSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  name: z.string().trim().min(2).max(60),
  template: z.string().regex(/^[a-z0-9-]+$/),
  pitch: z.string().trim().min(50).max(4000),
  evidence: z.array(z.url({ protocol: /^https?$/ })).min(1).max(10),
  monthlyBudgetEur: z.number().positive().optional(),
});

export type BranchProposal = z.infer<typeof branchProposalSchema>;

/** De CEO stelt een nieuwe tak voor (bv. 'content' of 'saas'). Bij akkoord bouwt de Agent Factory hem op. */
export async function proposeBranch(ctx: AppContext, input: BranchProposal, actor: Actor): Promise<ApprovalRecord> {
  await assertNotHalted(ctx);
  await checkAgentRateLimit(ctx, actor);
  if (await getBranchBySlug(ctx.db, input.slug)) throw new DomainError(`Tak '${input.slug}' bestaat al.`, 409);
  const budget = round2(input.monthlyBudgetEur ?? ctx.config.money.experimentBudgetEur * 2);
  return requestApproval(
    ctx,
    {
      kind: "branch_create",
      title: `Nieuwe tak: ${input.name} (sjabloon ${input.template})`,
      summary: `${input.pitch}\n\nBewijs: ${input.evidence.join(" , ")}\nStartbudget: ${formatEur(budget)} per maand`,
      amountEur: budget,
      requestedByAgentId: agentIdOf(actor),
      details: { ...input, monthlyBudgetEur: budget },
    },
    actor,
  );
}

/** Minimale takcreatie (zonder agents) — gebruikt door de Agent Factory en de CLI. */
export async function ensureBranch(
  ctx: AppContext,
  input: { slug: string; name: string; template?: string | null; description?: string | null; monthlyBudgetEur: number },
) {
  const existing = await getBranchBySlug(ctx.db, input.slug);
  if (existing) return existing;
  const branch = await createBranch(ctx.db, input);
  await audit(ctx.db, "system", "branch.create", { slug: input.slug, template: input.template });
  return branch;
}
