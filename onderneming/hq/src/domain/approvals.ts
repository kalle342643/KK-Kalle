import { num, numOrNull, type Db } from "../db/index.js";
import type { Button } from "../notify/notifier.js";
import { PaperclipError } from "../paperclip/client.js";
import type { ApprovalStatus, PcApproval } from "../paperclip/types.js";
import { audit } from "./audit.js";
import { DomainError } from "./branches.js";
import type { Actor, AppContext } from "./context.js";
import { formatEur, usdCentsToEur } from "./money.js";

/** Soorten beslissingen die HQ kent. De eerste vijf maakt HQ zelf aan; de rest komt uit Paperclip. */
export type ApprovalKind =
  | "experiment_start"
  | "budget_increase"
  | "spend"
  | "branch_create"
  | "portfolio"
  | "hire_agent"
  | "ceo_strategy"
  | "budget_override"
  | "generic";

export interface ApprovalRecord {
  id: number;
  paperclipApprovalId: string;
  paperclipType: string;
  kind: ApprovalKind;
  title: string;
  summary: string | null;
  amountEur: number | null;
  experimentId: number | null;
  branchId: number | null;
  requestedByAgentId: string | null;
  payload: Record<string, unknown>;
  status: ApprovalStatus;
  decisionNote: string | null;
  decidedAt: Date | null;
  appliedAt: Date | null;
  applyError: string | null;
  notifiedAt: Date | null;
  telegramMessageId: number | null;
  createdAt: Date;
}

interface ApprovalRow {
  id: number;
  paperclip_approval_id: string;
  paperclip_type: string;
  kind: ApprovalKind;
  title: string;
  summary: string | null;
  amount_eur: string | null;
  experiment_id: number | null;
  branch_id: number | null;
  requested_by_agent_id: string | null;
  payload: Record<string, unknown>;
  status: ApprovalStatus;
  decision_note: string | null;
  decided_at: string | Date | null;
  applied_at: string | Date | null;
  apply_error: string | null;
  notified_at: string | Date | null;
  telegram_message_id: string | number | null;
  created_at: string | Date;
}

function toRecord(r: ApprovalRow): ApprovalRecord {
  return {
    id: r.id,
    paperclipApprovalId: r.paperclip_approval_id,
    paperclipType: r.paperclip_type,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    amountEur: numOrNull(r.amount_eur),
    experimentId: r.experiment_id,
    branchId: r.branch_id,
    requestedByAgentId: r.requested_by_agent_id,
    payload: r.payload ?? {},
    status: r.status,
    decisionNote: r.decision_note,
    decidedAt: r.decided_at ? new Date(r.decided_at) : null,
    appliedAt: r.applied_at ? new Date(r.applied_at) : null,
    applyError: r.apply_error,
    notifiedAt: r.notified_at ? new Date(r.notified_at) : null,
    telegramMessageId: r.telegram_message_id === null ? null : num(r.telegram_message_id),
    createdAt: new Date(r.created_at),
  };
}

export async function getApproval(db: Db, id: number): Promise<ApprovalRecord | undefined> {
  const rows = await db.query<ApprovalRow>("select * from approvals where id = $1", [id]);
  return rows[0] ? toRecord(rows[0]) : undefined;
}

export async function getApprovalByPaperclipId(db: Db, paperclipId: string): Promise<ApprovalRecord | undefined> {
  const rows = await db.query<ApprovalRow>("select * from approvals where paperclip_approval_id = $1", [paperclipId]);
  return rows[0] ? toRecord(rows[0]) : undefined;
}

export async function listApprovals(
  db: Db,
  filter: { status?: ApprovalStatus[]; unapplied?: boolean; limit?: number } = {},
): Promise<ApprovalRecord[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status?.length) {
    params.push(filter.status);
    where.push(`status = any($${params.length}::text[])`);
  }
  if (filter.unapplied) where.push("applied_at is null");
  params.push(filter.limit ?? 50);
  const rows = await db.query<ApprovalRow>(
    `select * from approvals ${where.length ? `where ${where.join(" and ")}` : ""}
     order by id desc limit $${params.length}`,
    params,
  );
  return rows.map(toRecord);
}

export interface ApprovalRequest {
  kind: Exclude<ApprovalKind, "hire_agent" | "ceo_strategy" | "budget_override" | "generic">;
  title: string;
  summary: string;
  amountEur?: number | null;
  experimentId?: number | null;
  branchId?: number | null;
  requestedByAgentId?: string | null;
  /** Extra gegevens die nodig zijn om de beslissing later uit te voeren. */
  details?: Record<string, unknown>;
}

/** Maakt een goedkeuringsverzoek in Paperclip (zichtbaar in de Paperclip-inbox) én in HQ, en meldt het aan de eigenaar. */
export async function requestApproval(ctx: AppContext, req: ApprovalRequest, actor: Actor): Promise<ApprovalRecord> {
  const payload = {
    title: req.title,
    summary: req.summary,
    hq: {
      kind: req.kind,
      amountEur: req.amountEur ?? null,
      experimentId: req.experimentId ?? null,
      branchId: req.branchId ?? null,
      ...(req.details ?? {}),
    },
  };
  const pc = await ctx.paperclip.createApproval(ctx.companyId, {
    type: "request_board_approval",
    payload,
    requestedByAgentId: req.requestedByAgentId ?? null,
  });
  const rows = await ctx.db.query<ApprovalRow>(
    `insert into approvals (paperclip_approval_id, paperclip_type, kind, title, summary, amount_eur, experiment_id,
       branch_id, requested_by_agent_id, payload, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending') returning *`,
    [
      pc.id,
      pc.type,
      req.kind,
      req.title,
      req.summary,
      req.amountEur ?? null,
      req.experimentId ?? null,
      req.branchId ?? null,
      req.requestedByAgentId ?? null,
      JSON.stringify(payload),
    ],
  );
  const record = toRecord(rows[0]!);
  await audit(ctx.db, actor, "approval.request", { approvalId: record.id, kind: req.kind, amountEur: req.amountEur });
  await notifyApproval(ctx, record);
  return record;
}

/** Vertaalt een Paperclip-approval (bv. een aanname door de CEO) naar een HQ-record. */
function describeForeign(ctx: AppContext, pc: PcApproval): {
  kind: ApprovalKind;
  title: string;
  summary: string | null;
  amountEur: number | null;
} {
  const p = pc.payload ?? {};
  const hq = (p.hq ?? null) as Record<string, unknown> | null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  if (hq && typeof hq.kind === "string") {
    return {
      kind: hq.kind as ApprovalKind,
      title: str(p.title) ?? "Verzoek",
      summary: str(p.summary),
      amountEur: typeof hq.amountEur === "number" ? hq.amountEur : null,
    };
  }
  switch (pc.type) {
    case "hire_agent": {
      const budget = typeof p.budgetMonthlyCents === "number" ? usdCentsToEur(p.budgetMonthlyCents, ctx.config.money.usdToEur) : null;
      const model = (p.adapterConfig as Record<string, unknown> | undefined)?.model;
      return {
        kind: "hire_agent",
        title: `Nieuwe agent aannemen: ${str(p.name) ?? "?"}${str(p.title) ? ` (${str(p.title)})` : ""}`,
        summary: [
          str(p.capabilities),
          typeof model === "string" ? `Model: ${model}` : null,
          budget !== null ? `Maandbudget: ${formatEur(budget)}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
        amountEur: budget,
      };
    }
    case "approve_ceo_strategy":
      return {
        kind: "ceo_strategy",
        title: str(p.title) ?? "Strategievoorstel van de CEO",
        summary: str(p.summary) ?? str(p.strategy) ?? str(p.body) ?? JSON.stringify(p).slice(0, 600),
        amountEur: null,
      };
    case "budget_override_required": {
      const limit = typeof p.budgetAmount === "number" ? usdCentsToEur(p.budgetAmount, ctx.config.money.usdToEur) : null;
      const observed =
        typeof p.observedAmount === "number" ? usdCentsToEur(p.observedAmount, ctx.config.money.usdToEur) : null;
      const scope = p.scopeType === "agent" ? "Agent" : p.scopeType === "project" ? "Project" : "Bedrijf";
      return {
        kind: "budget_override",
        title: `${scope} ${str(p.scopeName) ?? ""} heeft zijn budget op`.replace(/\s+/g, " "),
        summary: `Uitgegeven ${observed !== null ? formatEur(observed) : "?"} van ${limit !== null ? formatEur(limit) : "?"}. Paperclip heeft het gepauzeerd.`,
        amountEur: limit,
      };
    }
    default:
      return {
        kind: "generic",
        title: str(p.title) ?? "Verzoek van een agent",
        summary: str(p.summary) ?? str(p.body) ?? str(p.reason) ?? null,
        amountEur: null,
      };
  }
}

/** Zorgt dat een Paperclip-approval ook in HQ staat. Geeft aan of hij nieuw was. */
export async function mirrorApproval(ctx: AppContext, pc: PcApproval): Promise<{ record: ApprovalRecord; isNew: boolean }> {
  const existing = await getApprovalByPaperclipId(ctx.db, pc.id);
  if (existing) {
    if (existing.status !== pc.status) {
      const rows = await ctx.db.query<ApprovalRow>(
        `update approvals set status = $2, decision_note = $3, decided_at = $4, updated_at = now()
         where id = $1 returning *`,
        [existing.id, pc.status, pc.decisionNote, pc.decidedAt],
      );
      return { record: toRecord(rows[0]!), isNew: false };
    }
    return { record: existing, isNew: false };
  }
  const d = describeForeign(ctx, pc);
  const hq = (pc.payload?.hq ?? {}) as Record<string, unknown>;
  const rows = await ctx.db.query<ApprovalRow>(
    `insert into approvals (paperclip_approval_id, paperclip_type, kind, title, summary, amount_eur, experiment_id,
       branch_id, requested_by_agent_id, payload, status, decision_note, decided_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     on conflict (paperclip_approval_id) do nothing returning *`,
    [
      pc.id,
      pc.type,
      d.kind,
      d.title,
      d.summary,
      d.amountEur,
      typeof hq.experimentId === "number" ? hq.experimentId : null,
      typeof hq.branchId === "number" ? hq.branchId : null,
      pc.requestedByAgentId,
      JSON.stringify(pc.payload ?? {}),
      pc.status,
      pc.decisionNote,
      pc.decidedAt,
    ],
  );
  if (!rows[0]) {
    const again = await getApprovalByPaperclipId(ctx.db, pc.id);
    return { record: again!, isNew: false };
  }
  return { record: toRecord(rows[0]), isNew: true };
}

const KIND_ICON: Record<ApprovalKind, string> = {
  experiment_start: "🧪",
  budget_increase: "📈",
  spend: "💳",
  branch_create: "🌱",
  portfolio: "📊",
  hire_agent: "🧑‍💼",
  ceo_strategy: "🧭",
  budget_override: "🛑",
  generic: "❓",
};

export function approvalButtons(record: ApprovalRecord): Button[][] {
  if (record.kind === "budget_override") {
    return [
      [
        { label: "✅ Verhoog en hervat", data: `ap:${record.id}:y` },
        { label: "⏸ Laat gepauzeerd", data: `ap:${record.id}:n` },
      ],
    ];
  }
  return [
    [
      { label: "✅ Goedkeuren", data: `ap:${record.id}:y` },
      { label: "❌ Afwijzen", data: `ap:${record.id}:n` },
    ],
  ];
}

export async function formatApproval(ctx: AppContext, record: ApprovalRecord): Promise<string> {
  let who = "";
  if (record.requestedByAgentId) {
    try {
      const agent = await ctx.paperclip.getAgent(record.requestedByAgentId);
      who = `${agent.name}${agent.title ? ` (${agent.title})` : ""} vraagt: `;
    } catch {
      who = "Een agent vraagt: ";
    }
  }
  const lines = [`${KIND_ICON[record.kind]} ${who}${record.title}`];
  if (record.amountEur !== null && record.kind !== "hire_agent" && record.kind !== "budget_override") {
    lines.push(`Bedrag: ${formatEur(record.amountEur)}`);
  }
  if (record.summary) lines.push("", record.summary.slice(0, 1500));
  lines.push("", `#${record.id}`);
  return lines.join("\n");
}

/** Stuurt het verzoek met knoppen naar de eigenaar (één keer). */
export async function notifyApproval(ctx: AppContext, record: ApprovalRecord): Promise<void> {
  if (record.status !== "pending" || record.notifiedAt) return;
  const text = await formatApproval(ctx, record);
  const sent = await ctx.notifier.send({ text, buttons: approvalButtons(record) });
  const telegram = sent.find((s) => s.channel === "telegram" && s.messageId);
  await ctx.db.query(
    "update approvals set notified_at = now(), telegram_message_id = $2, updated_at = now() where id = $1",
    [record.id, telegram?.messageId ? Number(telegram.messageId) : null],
  );
}

export type Decision = "approve" | "reject";

/**
 * Legt de beslissing vast in Paperclip en HQ. Voert de gevolgen NIET uit;
 * dat doet `decide` in workflows.ts (zodat deze module geen kringverwijzingen krijgt).
 */
export async function recordDecision(
  ctx: AppContext,
  id: number,
  decision: Decision,
  note: string | null,
  actor: Actor,
): Promise<ApprovalRecord> {
  const record = await getApproval(ctx.db, id);
  if (!record) throw new DomainError(`Verzoek #${id} bestaat niet.`, 404);
  if (record.status === "approved" || record.status === "rejected") {
    throw new DomainError(`Verzoek #${id} is al ${record.status === "approved" ? "goedgekeurd" : "afgewezen"}.`, 409);
  }

  let final: PcApproval;
  if (record.kind === "budget_override") {
    final = await resolveBudgetOverride(ctx, record, decision, note);
  } else {
    try {
      final =
        decision === "approve"
          ? await ctx.paperclip.approve(record.paperclipApprovalId, note)
          : await ctx.paperclip.reject(record.paperclipApprovalId, note);
    } catch (err) {
      // Al beslist in de Paperclip-UI? Neem die uitkomst over in plaats van te falen.
      if (err instanceof PaperclipError && (err.status === 409 || err.status === 422)) {
        final = await ctx.paperclip.getApproval(record.paperclipApprovalId);
      } else {
        throw err;
      }
    }
  }
  const status: ApprovalStatus = final.status;
  const rows = await ctx.db.query<ApprovalRow>(
    `update approvals set status = $2, decision_note = $3, decided_at = coalesce($4, now()), updated_at = now()
     where id = $1 returning *`,
    [id, status, note ?? final.decisionNote, final.decidedAt],
  );
  await audit(ctx.db, actor, "approval.decide", { approvalId: id, decision, status });
  return toRecord(rows[0]!);
}

/** Budgetincidenten los je in Paperclip op via het incident zelf; de gekoppelde approval volgt dan. */
async function resolveBudgetOverride(
  ctx: AppContext,
  record: ApprovalRecord,
  decision: Decision,
  note: string | null,
): Promise<PcApproval> {
  const overview = await ctx.paperclip.budgetsOverview(ctx.companyId);
  const incident = overview.activeIncidents.find((i) => i.approvalId === record.paperclipApprovalId);
  if (incident) {
    if (decision === "approve") {
      const amount = Math.ceil(Math.max(incident.amountLimit * 1.5, incident.amountObserved * 1.2));
      await ctx.paperclip.resolveBudgetIncident(ctx.companyId, incident.id, { action: "raise_budget_and_resume", amount }, note);
    } else {
      await ctx.paperclip.resolveBudgetIncident(ctx.companyId, incident.id, { action: "keep_paused" }, note);
    }
  }
  return ctx.paperclip.getApproval(record.paperclipApprovalId);
}

export async function markApplied(db: Db, id: number, error: string | null = null): Promise<void> {
  if (error) {
    await db.query("update approvals set apply_error = $2, updated_at = now() where id = $1", [id, error]);
  } else {
    await db.query("update approvals set applied_at = now(), apply_error = null, updated_at = now() where id = $1", [id]);
  }
}

/** Telt openstaande verzoeken van één agent vandaag (rate limit). */
export async function pendingCountForAgent(db: Db, agentId: string): Promise<number> {
  const rows = await db.query<{ n: string | number }>(
    "select count(*) as n from approvals where requested_by_agent_id = $1 and status = 'pending'",
    [agentId],
  );
  return Number(rows[0]?.n ?? 0);
}
