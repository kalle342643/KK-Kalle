import { randomUUID } from "node:crypto";
import { PaperclipError, type PaperclipApi } from "../../src/paperclip/client.js";
import type {
  ApprovalStatus,
  ApprovalType,
  BudgetPolicyInput,
  CreateIssueInput,
  CreateProjectInput,
  CreateRoutineInput,
  HireAgentInput,
  PcAgent,
  PcApproval,
  PcBudgetIncident,
  PcBudgetOverview,
  PcBudgetPolicy,
  PcCompany,
  PcIssue,
  PcProject,
  PcRoutine,
  PcActivity,
  PcRoutineTrigger,
  PcRunDetail,
  PcSkill,
  ScheduleTriggerInput,
} from "../../src/paperclip/types.js";

interface CostEvent {
  agentId: string | null;
  projectId: string | null;
  costCents: number;
  occurredAt: string;
}

/** In-memory nabootsing van de Paperclip-API, net genoeg voor de HQ-tests. */
export class FakePaperclip implements PaperclipApi {
  companies = new Map<string, PcCompany>();
  agents = new Map<string, PcAgent>();
  approvals = new Map<string, PcApproval>();
  projects = new Map<string, PcProject>();
  policies = new Map<string, PcBudgetPolicy>();
  costs: CostEvent[] = [];
  runs = new Map<string, PcRunDetail>();
  issues: Array<PcIssue & CreateIssueInput & { companyId: string }> = [];
  /** Activiteitenlogboek in volgorde van ontstaan (listActivity geeft het nieuwste eerst). */
  activity: PcActivity[] = [];
  routines = new Map<string, PcRoutine & { companyId: string }>();
  skills = new Map<string, PcSkill & { companyId: string; files: Record<string, string> }>();
  tokens = new Map<string, string>();
  /** Agents met permissions.canCreateAgents (bv. de CEO). */
  canCreateAgents = new Set<string>();
  wakeups: Array<{ agentId: string; reason: string }> = [];
  calls: string[] = [];

  constructor() {}

  /** Handig voor tests: maakt direct een actief bedrijf. */
  seedCompany(name = "Holding"): PcCompany {
    const c: PcCompany = {
      id: randomUUID(),
      name,
      description: null,
      status: "active",
      budgetMonthlyCents: 0,
      spentMonthlyCents: 0,
      requireBoardApprovalForNewAgents: false,
    };
    this.companies.set(c.id, c);
    return c;
  }

  seedAgent(companyId: string, partial: Partial<PcAgent> = {}): PcAgent {
    const a: PcAgent = {
      id: randomUUID(),
      companyId,
      name: partial.name ?? "Agent",
      role: partial.role ?? "general",
      title: partial.title ?? null,
      status: partial.status ?? "idle",
      reportsTo: partial.reportsTo ?? null,
      capabilities: null,
      adapterType: "claude_local",
      adapterConfig: {},
      runtimeConfig: {},
      budgetMonthlyCents: partial.budgetMonthlyCents ?? 1000,
      spentMonthlyCents: 0,
      pauseReason: null,
      metadata: partial.metadata ?? null,
      lastHeartbeatAt: null,
    };
    this.agents.set(a.id, a);
    return a;
  }

  addActivity(partial: Partial<PcActivity> & { action: string }): PcActivity {
    const a: PcActivity = {
      id: randomUUID(),
      companyId: [...this.companies.keys()][0] ?? "",
      actorType: "system",
      actorId: null,
      entityType: null,
      entityId: null,
      agentId: null,
      runId: null,
      details: null,
      createdAt: new Date().toISOString(),
      ...partial,
    };
    this.activity.push(a);
    return a;
  }

  issueToken(agentId: string): string {
    const token = `pcp_${randomUUID()}`;
    this.tokens.set(token, agentId);
    return token;
  }

  addCost(e: Partial<CostEvent> & { costCents: number }): void {
    this.costs.push({
      agentId: e.agentId ?? null,
      projectId: e.projectId ?? null,
      costCents: e.costCents,
      occurredAt: e.occurredAt ?? new Date().toISOString(),
    });
    for (const p of this.policies.values()) {
      const matches =
        (p.scopeType === "project" && p.scopeId === e.projectId) ||
        (p.scopeType === "agent" && p.scopeId === e.agentId);
      if (!matches) continue;
      p.observedAmount += e.costCents;
      p.remainingAmount = Math.max(0, p.amount - p.observedAmount);
      p.utilizationPercent = (p.observedAmount / p.amount) * 100;
      if (p.hardStopEnabled && p.observedAmount >= p.amount && p.status !== "hard_stop") {
        p.status = "hard_stop";
        p.paused = true;
        p.pauseReason = "budget";
        const companyId = [...this.companies.keys()][0] ?? "";
        const approval = this.makeApproval(
          companyId,
          "budget_override_required",
          {
            scopeId: p.scopeId,
            scopeType: p.scopeType,
            scopeName: p.scopeName ?? p.scopeId,
            windowKind: p.windowKind,
            budgetAmount: p.amount,
            observedAmount: p.observedAmount,
          },
          null,
        );
        const incidentId = randomUUID();
        this.incidents.set(incidentId, {
          id: incidentId,
          policyId: p.policyId,
          scopeType: p.scopeType,
          scopeId: p.scopeId,
          scopeName: p.scopeName ?? p.scopeId,
          windowKind: p.windowKind,
          amountLimit: p.amount,
          amountObserved: p.observedAmount,
          status: "open",
          approvalId: approval.id,
          approvalStatus: "pending",
        });
        if (p.scopeType === "agent") {
          const agent = this.agents.get(p.scopeId);
          if (agent) {
            agent.status = "paused";
            agent.pauseReason = "budget";
          }
        }
      }
    }
  }

  incidents = new Map<string, PcBudgetIncident>();

  async resolveBudgetIncident(
    _companyId: string,
    incidentId: string,
    resolution: { action: "keep_paused" } | { action: "raise_budget_and_resume"; amount: number },
  ) {
    const inc = this.need(this.incidents, incidentId, "budget-incidents");
    inc.status = "resolved";
    const approval = inc.approvalId ? this.approvals.get(inc.approvalId) : undefined;
    const policy = this.policies.get(inc.policyId);
    if (resolution.action === "raise_budget_and_resume") {
      if (approval) approval.status = "approved";
      if (policy) {
        policy.amount = resolution.amount;
        policy.status = policy.observedAmount >= policy.amount ? "hard_stop" : "ok";
        policy.paused = false;
      }
      if (inc.scopeType === "agent") {
        const agent = this.agents.get(inc.scopeId);
        if (agent) {
          agent.status = "idle";
          agent.budgetMonthlyCents = resolution.amount;
        }
      }
    } else if (approval) {
      approval.status = "rejected";
    }
    if (approval) approval.decidedAt = new Date().toISOString();
    this.calls.push(`resolveIncident:${incidentId}:${resolution.action}`);
  }

  private need<T>(map: Map<string, T>, id: string, what: string): T {
    const v = map.get(id);
    if (!v) throw new PaperclipError(404, "GET", `/${what}/${id}`, { error: `${what} not found` });
    return v;
  }

  async health() {
    return { status: "ok", version: "fake" };
  }

  async listCompanies() {
    return [...this.companies.values()];
  }
  async createCompany(input: { name: string; budgetMonthlyCents?: number }) {
    const c = this.seedCompany(input.name);
    c.budgetMonthlyCents = input.budgetMonthlyCents ?? 0;
    return c;
  }
  async updateCompany(companyId: string, patch: Record<string, unknown>) {
    const c = this.need(this.companies, companyId, "companies");
    Object.assign(c, patch);
    this.calls.push(`updateCompany:${JSON.stringify(patch)}`);
    return c;
  }

  async listAgents(companyId: string) {
    return [...this.agents.values()].filter((a) => a.companyId === companyId);
  }
  async getAgent(agentId: string) {
    return this.need(this.agents, agentId, "agents");
  }
  async whoAmI(agentToken: string) {
    const id = this.tokens.get(agentToken);
    if (!id) throw new PaperclipError(401, "GET", "/agents/me", { error: "Unauthorized" });
    return this.need(this.agents, id, "agents");
  }
  async hireAgent(companyId: string, input: HireAgentInput, opts?: { asAgentToken?: string }) {
    const company = this.need(this.companies, companyId, "companies");
    let requestedByAgentId: string | null = null;
    if (opts?.asAgentToken) {
      const requester = await this.whoAmI(opts.asAgentToken);
      if (!this.canCreateAgents.has(requester.id)) {
        throw new PaperclipError(403, "POST", `/companies/${companyId}/agent-hires`, { error: "Missing permission: can create agents" });
      }
      requestedByAgentId = requester.id;
    }
    const needsApproval = company.requireBoardApprovalForNewAgents === true;
    const agent = this.seedAgent(companyId, {
      name: input.name,
      role: input.role,
      title: input.title ?? null,
      reportsTo: input.reportsTo ?? null,
      budgetMonthlyCents: input.budgetMonthlyCents ?? 0,
      metadata: input.metadata ?? null,
      status: needsApproval ? "pending_approval" : "idle",
    });
    agent.adapterConfig = input.adapterConfig;
    this.calls.push(`hireAgent:${input.name}`);
    if (!needsApproval) return { agent, approval: null };
    const approval = this.makeApproval(companyId, "hire_agent", { ...input, agentId: agent.id }, requestedByAgentId);
    return { agent, approval };
  }
  async updateAgent(agentId: string, patch: Record<string, unknown>) {
    const a = this.need(this.agents, agentId, "agents");
    Object.assign(a, patch);
    return a;
  }
  async pauseAgent(agentId: string) {
    const a = this.need(this.agents, agentId, "agents");
    a.status = "paused";
    a.pauseReason = "manual";
    this.calls.push(`pause:${agentId}`);
    return a;
  }
  async resumeAgent(agentId: string) {
    const a = this.need(this.agents, agentId, "agents");
    a.status = "idle";
    a.pauseReason = null;
    this.calls.push(`resume:${agentId}`);
    return a;
  }
  async setAgentBudget(agentId: string, budgetMonthlyCents: number) {
    this.need(this.agents, agentId, "agents").budgetMonthlyCents = budgetMonthlyCents;
  }
  async syncAgentSkills(agentId: string, mode: string, skills: string[]) {
    this.need(this.agents, agentId, "agents");
    this.calls.push(`syncSkills:${agentId}:${mode}:${skills.join(",")}`);
  }
  async wakeAgent(agentId: string, reason: string) {
    this.need(this.agents, agentId, "agents");
    const company = this.need(this.companies, this.agents.get(agentId)!.companyId, "companies");
    if (company.status !== "active") {
      throw new PaperclipError(409, "POST", `/agents/${agentId}/wakeup`, { error: "Company is not active" });
    }
    this.wakeups.push({ agentId, reason });
  }

  private makeApproval(
    companyId: string,
    type: ApprovalType,
    payload: Record<string, unknown>,
    requestedByAgentId: string | null,
  ): PcApproval {
    const a: PcApproval = {
      id: randomUUID(),
      companyId,
      type,
      status: "pending",
      payload,
      requestedByAgentId,
      requestedByUserId: requestedByAgentId ? null : "local-board",
      decisionNote: null,
      decidedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.approvals.set(a.id, a);
    return a;
  }

  async listApprovals(companyId: string, status?: ApprovalStatus) {
    return [...this.approvals.values()].filter(
      (a) => a.companyId === companyId && (status === undefined || a.status === status),
    );
  }
  async getApproval(approvalId: string) {
    return this.need(this.approvals, approvalId, "approvals");
  }
  async createApproval(
    companyId: string,
    input: { type: ApprovalType; payload: Record<string, unknown>; requestedByAgentId?: string | null },
  ) {
    return this.makeApproval(companyId, input.type, input.payload, input.requestedByAgentId ?? null);
  }
  async approve(approvalId: string, note?: string | null) {
    const a = this.need(this.approvals, approvalId, "approvals");
    if (a.status === "approved" || a.status === "rejected") {
      throw new PaperclipError(422, "POST", `/approvals/${approvalId}/approve`, { error: "Approval already decided" });
    }
    a.status = "approved";
    a.decisionNote = note ?? null;
    a.decidedAt = new Date().toISOString();
    if (a.type === "hire_agent" && typeof a.payload.agentId === "string") {
      const agent = this.agents.get(a.payload.agentId);
      if (agent) agent.status = "idle";
    }
    this.calls.push(`approve:${approvalId}`);
    return a;
  }
  async reject(approvalId: string, note?: string | null) {
    const a = this.need(this.approvals, approvalId, "approvals");
    if (a.status === "approved" || a.status === "rejected") {
      throw new PaperclipError(422, "POST", `/approvals/${approvalId}/reject`, { error: "Approval already decided" });
    }
    a.status = "rejected";
    a.decisionNote = note ?? null;
    a.decidedAt = new Date().toISOString();
    if (a.type === "hire_agent" && typeof a.payload.agentId === "string") {
      const agent = this.agents.get(a.payload.agentId);
      if (agent) agent.status = "terminated";
    }
    this.calls.push(`reject:${approvalId}`);
    return a;
  }

  async listProjects(companyId: string) {
    return [...this.projects.values()].filter((p) => p.companyId === companyId);
  }
  async createProject(companyId: string, input: CreateProjectInput) {
    const p: PcProject = {
      id: randomUUID(),
      companyId,
      name: input.name,
      status: input.status ?? "planned",
      leadAgentId: input.leadAgentId ?? null,
    };
    this.projects.set(p.id, p);
    return p;
  }
  async updateProject(projectId: string, patch: Record<string, unknown>) {
    const p = this.need(this.projects, projectId, "projects");
    Object.assign(p, patch);
    return p;
  }

  async upsertBudgetPolicy(_companyId: string, input: BudgetPolicyInput) {
    const existing = [...this.policies.values()].find(
      (p) => p.scopeType === input.scopeType && p.scopeId === input.scopeId && p.windowKind === input.windowKind,
    );
    const observed = existing?.observedAmount ?? 0;
    const policy: PcBudgetPolicy = {
      policyId: existing?.policyId ?? randomUUID(),
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      windowKind: input.windowKind,
      amount: input.amount,
      observedAmount: observed,
      remainingAmount: Math.max(0, input.amount - observed),
      utilizationPercent: input.amount > 0 ? (observed / input.amount) * 100 : 0,
      hardStopEnabled: input.hardStopEnabled ?? true,
      status: observed >= input.amount ? "hard_stop" : "ok",
      paused: observed >= input.amount,
      pauseReason: null,
    };
    this.policies.set(policy.policyId, policy);
    return policy;
  }
  async budgetsOverview(): Promise<PcBudgetOverview> {
    return {
      policies: [...this.policies.values()],
      activeIncidents: [...this.incidents.values()].filter((i) => i.status === "open"),
      pausedAgentCount: 0,
      pausedProjectCount: 0,
      pendingApprovalCount: [...this.approvals.values()].filter((a) => a.status === "pending").length,
    };
  }
  private inRange(e: CostEvent, range?: { from?: string; to?: string }) {
    const t = Date.parse(e.occurredAt);
    if (range?.from && t < Date.parse(range.from)) return false;
    if (range?.to && t >= Date.parse(range.to)) return false;
    return true;
  }
  async costsSummary(_companyId: string, range?: { from?: string; to?: string }) {
    const spendCents = this.costs.filter((e) => this.inRange(e, range)).reduce((s, e) => s + e.costCents, 0);
    return { spendCents, budgetCents: 0, utilizationPercent: 0 };
  }
  async costsByProject(_companyId: string, range?: { from?: string; to?: string }) {
    const by = new Map<string, number>();
    for (const e of this.costs) {
      if (!e.projectId || !this.inRange(e, range)) continue;
      by.set(e.projectId, (by.get(e.projectId) ?? 0) + e.costCents);
    }
    return [...by.entries()].map(([projectId, costCents]) => ({
      projectId,
      projectName: this.projects.get(projectId)?.name ?? null,
      costCents,
    }));
  }
  async costsByAgent(_companyId: string, range?: { from?: string; to?: string }) {
    const by = new Map<string, number>();
    for (const e of this.costs) {
      if (!e.agentId || !this.inRange(e, range)) continue;
      by.set(e.agentId, (by.get(e.agentId) ?? 0) + e.costCents);
    }
    return [...by.entries()].map(([agentId, costCents]) => ({
      agentId,
      agentName: this.agents.get(agentId)?.name ?? "?",
      agentStatus: this.agents.get(agentId)?.status ?? "idle",
      costCents,
    }));
  }

  async listLiveRuns(companyId: string) {
    return [...this.runs.values()].filter(
      (r) => r.status === "running" && this.agents.get(r.agentId)?.companyId === companyId,
    );
  }
  async getRun(runId: string) {
    return this.need(this.runs, runId, "heartbeat-runs");
  }
  /** Logboeken per run, als JSONL zoals Paperclip ze opslaat. Vul met appendRunLog. */
  runLogs = new Map<string, string>();
  appendRunLog(runId: string, stream: "stdout" | "stderr", chunk: string) {
    const line = JSON.stringify({ ts: new Date().toISOString(), stream, chunk });
    this.runLogs.set(runId, (this.runLogs.get(runId) ?? "") + `${line}\n`);
  }
  async runLog(runId: string, offset: number, limitBytes = 256_000) {
    const all = Buffer.from(this.runLogs.get(runId) ?? "", "utf8");
    const end = Math.min(all.length, offset + limitBytes);
    return { content: all.subarray(offset, end).toString("utf8"), ...(end < all.length ? { nextOffset: end } : {}) };
  }
  async listActivity(companyId: string, limit = 50) {
    return this.activity
      .filter((a) => a.companyId === companyId)
      .slice(-limit)
      .reverse();
  }
  async cancelRun(runId: string) {
    const r = this.need(this.runs, runId, "heartbeat-runs");
    r.status = "cancelled";
    this.calls.push(`cancelRun:${runId}`);
  }

  async createIssue(companyId: string, input: CreateIssueInput & { createdByAgentId?: string | null }) {
    const issue = {
      id: randomUUID(),
      identifier: `HQ-${this.issues.length + 1}`,
      status: "todo",
      companyId,
      createdByAgentId: null,
      createdByUserId: input.createdByAgentId ? null : "local-board",
      ...input,
    };
    this.issues.push(issue);
    return issue;
  }
  async getIssue(issueId: string) {
    const issue = this.issues.find((i) => i.id === issueId);
    if (!issue) throw new PaperclipError(404, "GET", `/issues/${issueId}`, { error: "Issue not found" });
    return issue;
  }

  async listRoutines(companyId: string) {
    return [...this.routines.values()].filter((r) => r.companyId === companyId);
  }
  async createRoutine(companyId: string, input: CreateRoutineInput) {
    const r = {
      id: randomUUID(),
      companyId,
      title: input.title,
      description: input.description ?? null,
      assigneeAgentId: input.assigneeAgentId ?? null,
      priority: input.priority ?? "medium",
      status: input.status ?? "active",
      triggers: [] as PcRoutineTrigger[],
    };
    this.routines.set(r.id, r);
    return r;
  }
  async updateRoutine(routineId: string, patch: Partial<CreateRoutineInput>) {
    const r = this.need(this.routines, routineId, "routines");
    Object.assign(r, patch);
    return r;
  }
  async addRoutineTrigger(routineId: string, input: ScheduleTriggerInput) {
    const r = this.need(this.routines, routineId, "routines");
    const t: PcRoutineTrigger = {
      id: randomUUID(),
      kind: "schedule",
      label: input.label ?? null,
      enabled: input.enabled ?? true,
      cronExpression: input.cronExpression,
      timezone: input.timezone ?? null,
    };
    r.triggers = [...(r.triggers ?? []), t];
    return t;
  }
  async updateRoutineTrigger(triggerId: string, patch: Record<string, unknown>) {
    for (const r of this.routines.values()) {
      const t = r.triggers?.find((x) => x.id === triggerId);
      if (t) {
        Object.assign(t, patch);
        return t;
      }
    }
    throw new PaperclipError(404, "PATCH", `/routine-triggers/${triggerId}`, { error: "not found" });
  }

  async listSkills(companyId: string) {
    // Net als de echte API: de lijst bevat geen inhoud.
    return [...this.skills.values()]
      .filter((s) => s.companyId === companyId)
      .map(({ markdown: _markdown, ...rest }) => rest);
  }
  async getSkill(_companyId: string, skillId: string) {
    return this.need(this.skills, skillId, "skills");
  }
  async createSkill(companyId: string, input: { name: string; slug: string; markdown: string }) {
    const s = {
      id: randomUUID(),
      companyId,
      key: `company/${companyId}/${input.slug}`,
      slug: input.slug,
      name: input.name,
      markdown: input.markdown,
      files: { "SKILL.md": input.markdown },
    };
    this.skills.set(s.id, s);
    return s;
  }
  async updateSkillFile(_companyId: string, skillId: string, path: string, content: string) {
    const s = this.need(this.skills, skillId, "skills");
    s.files[path] = content;
    if (path === "SKILL.md") s.markdown = content;
  }
}
