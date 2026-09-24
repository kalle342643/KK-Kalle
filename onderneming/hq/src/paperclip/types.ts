/**
 * Minimale typen voor de Paperclip REST-API (getest tegen Paperclip 2026.916.1).
 * Alleen de velden die HQ gebruikt; Paperclip stuurt er meer mee.
 */

export type AgentRole =
  | "ceo"
  | "cto"
  | "cmo"
  | "cfo"
  | "security"
  | "engineer"
  | "designer"
  | "pm"
  | "qa"
  | "devops"
  | "researcher"
  | "general";

export type AgentStatus =
  | "active"
  | "paused"
  | "idle"
  | "running"
  | "error"
  | "pending_approval"
  | "terminated";

export interface PcCompany {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "paused" | "archived";
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  requireBoardApprovalForNewAgents?: boolean;
}

export interface PcAgent {
  id: string;
  companyId: string;
  name: string;
  role: AgentRole;
  title: string | null;
  status: AgentStatus;
  reportsTo: string | null;
  capabilities: string | null;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  runtimeConfig: Record<string, unknown>;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  pauseReason: string | null;
  metadata: Record<string, unknown> | null;
  lastHeartbeatAt: string | null;
}

export type ApprovalType =
  | "hire_agent"
  | "approve_ceo_strategy"
  | "budget_override_required"
  | "request_board_approval";

export type ApprovalStatus = "pending" | "revision_requested" | "approved" | "rejected";

export interface PcApproval {
  id: string;
  companyId: string;
  type: ApprovalType;
  status: ApprovalStatus;
  payload: Record<string, unknown>;
  requestedByAgentId: string | null;
  requestedByUserId: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface PcProject {
  id: string;
  companyId: string;
  name: string;
  status: "backlog" | "planned" | "in_progress" | "completed" | "cancelled";
  leadAgentId: string | null;
}

export interface PcBudgetPolicy {
  policyId: string;
  scopeType: "company" | "agent" | "project";
  scopeId: string;
  scopeName?: string;
  windowKind: "calendar_month_utc" | "lifetime";
  amount: number;
  observedAmount: number;
  remainingAmount: number;
  utilizationPercent: number;
  hardStopEnabled: boolean;
  status: string;
  paused: boolean;
  pauseReason: string | null;
}

/** Ontstaat als een budget met harde stop overschreden wordt; Paperclip pauzeert dan de scope. */
export interface PcBudgetIncident {
  id: string;
  policyId: string;
  scopeType: "company" | "agent" | "project";
  scopeId: string;
  scopeName?: string;
  windowKind: "calendar_month_utc" | "lifetime";
  amountLimit: number;
  amountObserved: number;
  status: string;
  approvalId: string | null;
  approvalStatus: string | null;
}

export interface PcBudgetOverview {
  policies: PcBudgetPolicy[];
  activeIncidents: PcBudgetIncident[];
  pausedAgentCount: number;
  pausedProjectCount: number;
  pendingApprovalCount: number;
}

export interface PcProjectCost {
  projectId: string | null;
  projectName: string | null;
  costCents: number;
}

export interface PcAgentCost {
  agentId: string;
  agentName: string;
  agentStatus: string;
  costCents: number;
}

export interface PcCostSummary {
  spendCents: number;
  budgetCents: number;
  utilizationPercent: number;
}

export interface PcRun {
  id: string;
  status: string;
  agentId: string;
  agentName?: string;
  startedAt: string | null;
}

/** Eén heartbeat-run met context (waarom de agent wakker werd en aan welke taak hij werkt). */
export interface PcRunDetail extends PcRun {
  finishedAt?: string | null;
  error?: string | null;
  contextSnapshot?: { issueId?: string; wakeReason?: string; [key: string]: unknown } | null;
}

export interface PcIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  assigneeAgentId?: string | null;
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
  projectId?: string | null;
}

/** Regel uit het activiteitenlogboek van een bedrijf (`GET /companies/{id}/activity`, nieuwste eerst). */
export interface PcActivity {
  id: string;
  companyId: string;
  actorType: "user" | "agent" | "system" | (string & {});
  actorId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  agentId: string | null;
  runId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface PcRoutineTrigger {
  id: string;
  kind: "schedule" | "webhook" | "api";
  label: string | null;
  enabled: boolean;
  cronExpression: string | null;
  timezone: string | null;
}

export interface PcRoutine {
  id: string;
  title: string;
  description: string | null;
  assigneeAgentId: string | null;
  priority?: "critical" | "high" | "medium" | "low";
  status: "active" | "paused" | "archived";
  triggers?: PcRoutineTrigger[];
}

export interface PcSkill {
  id: string;
  key: string;
  slug: string;
  name: string;
  markdown?: string | null;
}

export interface HireAgentInput {
  name: string;
  role: AgentRole;
  title?: string | null;
  icon?: string | null;
  reportsTo?: string | null;
  capabilities?: string | null;
  desiredSkills?: string[];
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  instructionsBundle?: { entryFile: string; files: Record<string, string> };
  runtimeConfig?: Record<string, unknown>;
  budgetMonthlyCents?: number;
  permissions?: { canCreateAgents?: boolean; canCreateSkills?: boolean };
  metadata?: Record<string, unknown> | null;
  sourceIssueId?: string | null;
}

export interface CreateProjectInput {
  name: string;
  status?: PcProject["status"];
  leadAgentId?: string | null;
  targetDate?: string | null;
  idempotencyKey?: string;
}

export interface BudgetPolicyInput {
  scopeType: "company" | "agent" | "project";
  scopeId: string;
  windowKind: "calendar_month_utc" | "lifetime";
  amount: number;
  warnPercent?: number;
  hardStopEnabled?: boolean;
  notifyEnabled?: boolean;
  isActive?: boolean;
}

export interface CreateIssueInput {
  title: string;
  description?: string | null;
  priority?: "critical" | "high" | "medium" | "low";
  assigneeAgentId?: string | null;
  projectId?: string | null;
}

export interface CreateRoutineInput {
  title: string;
  description?: string | null;
  assigneeAgentId?: string | null;
  projectId?: string | null;
  priority?: "critical" | "high" | "medium" | "low";
  status?: "active" | "paused" | "archived";
  concurrencyPolicy?: "coalesce_if_active" | "always_enqueue" | "skip_if_active";
  catchUpPolicy?: "skip_missed" | "enqueue_missed_with_cap";
}

export interface ScheduleTriggerInput {
  kind: "schedule";
  label?: string | null;
  enabled?: boolean;
  cronExpression: string;
  timezone?: string;
}
