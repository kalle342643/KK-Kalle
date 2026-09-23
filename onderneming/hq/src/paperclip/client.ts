import type {
  BudgetPolicyInput,
  CreateIssueInput,
  CreateProjectInput,
  CreateRoutineInput,
  HireAgentInput,
  PcAgent,
  PcAgentCost,
  PcApproval,
  PcBudgetOverview,
  PcBudgetPolicy,
  PcCompany,
  PcCostSummary,
  PcIssue,
  PcProject,
  PcProjectCost,
  PcRoutine,
  PcRoutineTrigger,
  PcRun,
  PcSkill,
  ScheduleTriggerInput,
  ApprovalStatus,
  ApprovalType,
} from "./types.js";

/** Alles wat HQ met Paperclip doet. In tests vervangen door FakePaperclip. */
export interface PaperclipApi {
  health(): Promise<{ status: string; version?: string }>;

  listCompanies(): Promise<PcCompany[]>;
  createCompany(input: { name: string; budgetMonthlyCents?: number }): Promise<PcCompany>;
  updateCompany(
    companyId: string,
    patch: Partial<Pick<PcCompany, "name" | "status" | "budgetMonthlyCents" | "requireBoardApprovalForNewAgents">> & {
      description?: string | null;
    },
  ): Promise<PcCompany>;

  listAgents(companyId: string): Promise<PcAgent[]>;
  getAgent(agentId: string): Promise<PcAgent>;
  /** Identiteit van de agent achter een token (agent-API-key of run-JWT). */
  whoAmI(agentToken: string): Promise<PcAgent>;
  /** Neemt een agent aan. Met `asAgentToken` gebeurt dat namens die agent (Paperclip checkt dan zijn rechten). */
  hireAgent(
    companyId: string,
    input: HireAgentInput,
    opts?: { asAgentToken?: string },
  ): Promise<{ agent: PcAgent; approval: PcApproval | null }>;
  updateAgent(agentId: string, patch: Record<string, unknown>): Promise<PcAgent>;
  pauseAgent(agentId: string): Promise<PcAgent>;
  resumeAgent(agentId: string): Promise<PcAgent>;
  setAgentBudget(agentId: string, budgetMonthlyCents: number): Promise<void>;
  syncAgentSkills(agentId: string, mode: "add" | "remove" | "replace", skills: string[]): Promise<void>;
  wakeAgent(agentId: string, reason: string): Promise<void>;

  listApprovals(companyId: string, status?: ApprovalStatus): Promise<PcApproval[]>;
  getApproval(approvalId: string): Promise<PcApproval>;
  createApproval(
    companyId: string,
    input: { type: ApprovalType; payload: Record<string, unknown>; requestedByAgentId?: string | null },
  ): Promise<PcApproval>;
  approve(approvalId: string, note?: string | null): Promise<PcApproval>;
  reject(approvalId: string, note?: string | null): Promise<PcApproval>;

  listProjects(companyId: string): Promise<PcProject[]>;
  createProject(companyId: string, input: CreateProjectInput): Promise<PcProject>;
  updateProject(projectId: string, patch: Partial<Pick<PcProject, "name" | "status" | "leadAgentId">>): Promise<PcProject>;

  upsertBudgetPolicy(companyId: string, input: BudgetPolicyInput): Promise<PcBudgetPolicy>;
  budgetsOverview(companyId: string): Promise<PcBudgetOverview>;
  /** Lost een budget-incident op; Paperclip keurt of wijst de gekoppelde approval dan zelf af. */
  resolveBudgetIncident(
    companyId: string,
    incidentId: string,
    resolution: { action: "keep_paused" } | { action: "raise_budget_and_resume"; amount: number },
    note?: string | null,
  ): Promise<void>;
  costsSummary(companyId: string, range?: { from?: string; to?: string }): Promise<PcCostSummary>;
  costsByProject(companyId: string, range?: { from?: string; to?: string }): Promise<PcProjectCost[]>;
  costsByAgent(companyId: string, range?: { from?: string; to?: string }): Promise<PcAgentCost[]>;

  listLiveRuns(companyId: string): Promise<PcRun[]>;
  cancelRun(runId: string): Promise<void>;

  createIssue(companyId: string, input: CreateIssueInput): Promise<PcIssue>;

  listRoutines(companyId: string): Promise<PcRoutine[]>;
  createRoutine(companyId: string, input: CreateRoutineInput): Promise<PcRoutine>;
  updateRoutine(routineId: string, patch: Partial<CreateRoutineInput>): Promise<PcRoutine>;
  addRoutineTrigger(routineId: string, input: ScheduleTriggerInput): Promise<PcRoutineTrigger>;
  updateRoutineTrigger(
    triggerId: string,
    patch: Partial<Pick<ScheduleTriggerInput, "cronExpression" | "timezone" | "label" | "enabled">>,
  ): Promise<PcRoutineTrigger>;

  listSkills(companyId: string): Promise<PcSkill[]>;
  createSkill(companyId: string, input: { name: string; slug: string; markdown: string; tagline?: string }): Promise<PcSkill>;
  updateSkillFile(companyId: string, skillId: string, path: string, content: string): Promise<void>;
}

export class PaperclipError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: unknown,
  ) {
    const detail =
      body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : JSON.stringify(body);
    super(`Paperclip ${method} ${path} gaf ${status}: ${detail}`);
    this.name = "PaperclipError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class HttpPaperclipClient implements PaperclipApi {
  constructor(
    private readonly baseUrl: string,
    private readonly boardToken: string | undefined,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    const bearer = token ?? this.boardToken;
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) throw new PaperclipError(res.status, method, path, parsed);
    return parsed as T;
  }

  private qs(range?: { from?: string; to?: string }): string {
    const params = new URLSearchParams();
    if (range?.from) params.set("from", range.from);
    if (range?.to) params.set("to", range.to);
    const s = params.toString();
    return s ? `?${s}` : "";
  }

  health() {
    return this.request<{ status: string; version?: string }>("GET", "/health");
  }

  listCompanies() {
    return this.request<PcCompany[]>("GET", "/companies");
  }
  createCompany(input: { name: string; budgetMonthlyCents?: number }) {
    return this.request<PcCompany>("POST", "/companies", input);
  }
  updateCompany(companyId: string, patch: Record<string, unknown>) {
    return this.request<PcCompany>("PATCH", `/companies/${companyId}`, patch);
  }

  listAgents(companyId: string) {
    return this.request<PcAgent[]>("GET", `/companies/${companyId}/agents`);
  }
  getAgent(agentId: string) {
    return this.request<PcAgent>("GET", `/agents/${agentId}`);
  }
  whoAmI(agentToken: string) {
    return this.request<PcAgent>("GET", "/agents/me", undefined, agentToken);
  }
  async hireAgent(companyId: string, input: HireAgentInput, opts?: { asAgentToken?: string }) {
    const res = await this.request<{ agent: PcAgent; approval?: PcApproval | null } | PcAgent>(
      "POST",
      `/companies/${companyId}/agent-hires`,
      input,
      opts?.asAgentToken,
    );
    if ("agent" in res) return { agent: res.agent, approval: res.approval ?? null };
    return { agent: res, approval: null };
  }
  updateAgent(agentId: string, patch: Record<string, unknown>) {
    return this.request<PcAgent>("PATCH", `/agents/${agentId}`, patch);
  }
  pauseAgent(agentId: string) {
    return this.request<PcAgent>("POST", `/agents/${agentId}/pause`, {});
  }
  resumeAgent(agentId: string) {
    return this.request<PcAgent>("POST", `/agents/${agentId}/resume`, {});
  }
  async setAgentBudget(agentId: string, budgetMonthlyCents: number) {
    await this.request("PATCH", `/agents/${agentId}/budgets`, { budgetMonthlyCents });
  }
  async syncAgentSkills(agentId: string, mode: "add" | "remove" | "replace", skills: string[]) {
    await this.request("POST", `/agents/${agentId}/skills/sync`, { mode, desiredSkills: skills });
  }
  async wakeAgent(agentId: string, reason: string) {
    await this.request("POST", `/agents/${agentId}/wakeup`, {
      source: "automation",
      triggerDetail: "system",
      reason,
      forceFreshSession: false,
    });
  }

  listApprovals(companyId: string, status?: ApprovalStatus) {
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request<PcApproval[]>("GET", `/companies/${companyId}/approvals${q}`);
  }
  getApproval(approvalId: string) {
    return this.request<PcApproval>("GET", `/approvals/${approvalId}`);
  }
  createApproval(
    companyId: string,
    input: { type: ApprovalType; payload: Record<string, unknown>; requestedByAgentId?: string | null },
  ) {
    return this.request<PcApproval>("POST", `/companies/${companyId}/approvals`, input);
  }
  approve(approvalId: string, note?: string | null) {
    return this.request<PcApproval>("POST", `/approvals/${approvalId}/approve`, { decisionNote: note ?? null });
  }
  reject(approvalId: string, note?: string | null) {
    return this.request<PcApproval>("POST", `/approvals/${approvalId}/reject`, { decisionNote: note ?? null });
  }

  listProjects(companyId: string) {
    return this.request<PcProject[]>("GET", `/companies/${companyId}/projects`);
  }
  createProject(companyId: string, input: CreateProjectInput) {
    return this.request<PcProject>("POST", `/companies/${companyId}/projects`, input);
  }
  updateProject(projectId: string, patch: Record<string, unknown>) {
    return this.request<PcProject>("PATCH", `/projects/${projectId}`, patch);
  }

  upsertBudgetPolicy(companyId: string, input: BudgetPolicyInput) {
    return this.request<PcBudgetPolicy>("POST", `/companies/${companyId}/budgets/policies`, {
      metric: "billed_cents",
      warnPercent: 80,
      hardStopEnabled: true,
      notifyEnabled: true,
      isActive: true,
      ...input,
    });
  }
  budgetsOverview(companyId: string) {
    return this.request<PcBudgetOverview>("GET", `/companies/${companyId}/budgets/overview`);
  }
  async resolveBudgetIncident(
    companyId: string,
    incidentId: string,
    resolution: { action: "keep_paused" } | { action: "raise_budget_and_resume"; amount: number },
    note?: string | null,
  ) {
    await this.request("POST", `/companies/${companyId}/budget-incidents/${incidentId}/resolve`, {
      ...resolution,
      decisionNote: note ?? null,
    });
  }
  costsSummary(companyId: string, range?: { from?: string; to?: string }) {
    return this.request<PcCostSummary>("GET", `/companies/${companyId}/costs/summary${this.qs(range)}`);
  }
  costsByProject(companyId: string, range?: { from?: string; to?: string }) {
    return this.request<PcProjectCost[]>("GET", `/companies/${companyId}/costs/by-project${this.qs(range)}`);
  }
  costsByAgent(companyId: string, range?: { from?: string; to?: string }) {
    return this.request<PcAgentCost[]>("GET", `/companies/${companyId}/costs/by-agent${this.qs(range)}`);
  }

  listLiveRuns(companyId: string) {
    return this.request<PcRun[]>("GET", `/companies/${companyId}/live-runs`);
  }
  async cancelRun(runId: string) {
    await this.request("POST", `/heartbeat-runs/${runId}/cancel`, {});
  }

  createIssue(companyId: string, input: CreateIssueInput) {
    return this.request<PcIssue>("POST", `/companies/${companyId}/issues`, input);
  }

  listRoutines(companyId: string) {
    return this.request<PcRoutine[]>("GET", `/companies/${companyId}/routines`);
  }
  createRoutine(companyId: string, input: CreateRoutineInput) {
    return this.request<PcRoutine>("POST", `/companies/${companyId}/routines`, input);
  }
  updateRoutine(routineId: string, patch: Partial<CreateRoutineInput>) {
    return this.request<PcRoutine>("PATCH", `/routines/${routineId}`, patch);
  }
  async addRoutineTrigger(routineId: string, input: ScheduleTriggerInput) {
    const res = await this.request<{ trigger: PcRoutineTrigger }>("POST", `/routines/${routineId}/triggers`, input);
    return res.trigger;
  }
  async updateRoutineTrigger(triggerId: string, patch: Record<string, unknown>) {
    const res = await this.request<{ trigger?: PcRoutineTrigger } & Partial<PcRoutineTrigger>>(
      "PATCH",
      `/routine-triggers/${triggerId}`,
      patch,
    );
    return (res.trigger ?? res) as PcRoutineTrigger;
  }

  listSkills(companyId: string) {
    return this.request<PcSkill[]>("GET", `/companies/${companyId}/skills`);
  }
  createSkill(companyId: string, input: { name: string; slug: string; markdown: string; tagline?: string }) {
    return this.request<PcSkill>("POST", `/companies/${companyId}/skills`, { ...input, sharingScope: "company" });
  }
  async updateSkillFile(companyId: string, skillId: string, path: string, content: string) {
    await this.request("PATCH", `/companies/${companyId}/skills/${skillId}/files`, { path, content });
  }
}
