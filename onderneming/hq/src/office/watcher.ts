import { errorMessage, type AppContext } from "../domain/context.js";
import type { AgentStatus, PcActivity, PcIssue } from "../paperclip/types.js";
import { shortText } from "./events.js";
import { newRunLogState, readRunLogChunk, toolSummary, toolText, type RunLogState, type ToolKind, type ToolUse } from "./runlog.js";

const WAKE_REASON: Record<string, string> = {
  issue_assigned: "Nieuwe taak",
  approval_approved: "Verzoek goedgekeurd",
  approval_rejected: "Verzoek afgewezen",
  routine: "Vaste routine",
  schedule: "Vaste routine",
  transient_failure_retry: "Nieuwe poging",
};

const STATUS_TEXT: Partial<Record<AgentStatus, string>> = {
  paused: "gepauzeerd",
  idle: "beschikbaar",
  active: "beschikbaar",
  running: "aan het werk",
  error: "loopt vast",
  pending_approval: "wacht op goedkeuring",
  terminated: "vertrokken",
};

interface LiveRun {
  agentId: string;
  issueTitle: string | null;
  log: RunLogState;
  /** Wanneer we per soort tool voor het laatst iets toonden (niet elke zoekopdracht een ballon). */
  lastShown: Map<ToolKind, number>;
  shown: number;
}

/** Per soort tool hooguit één melding per zoveel tijd, en per run een maximum. */
const TOOL_GAP_MS = 12_000;
const TOOL_MAX_PER_RUN = 40;

/**
 * Kijkt mee in Paperclip en zet wat daar gebeurt om in kantoorgebeurtenissen:
 * wie er aan het werk is (runs), wie tegen wie praat (reacties en nieuwe taken),
 * nieuwe sollicitanten en budgetstops. Snel als iemand meekijkt, rustig als niemand kijkt.
 */
export class PaperclipWatcher {
  private timer: NodeJS.Timeout | undefined;
  private stopped = true;
  private readonly liveRuns = new Map<string, LiveRun>();
  private readonly seenActivity = new Set<string>();
  private readonly issueCache = new Map<string, { issue: PcIssue; at: number }>();
  private agentStatus: Map<string, AgentStatus> | undefined;
  private ticks = 0;

  constructor(
    private readonly ctx: AppContext,
    private readonly opts: { fastMs?: number; slowMs?: number } = {},
  ) {}

  start(): void {
    this.stopped = false;
    const loop = async () => {
      if (this.stopped) return;
      await this.tick();
      if (this.stopped) return;
      const delay = this.ctx.events.viewers > 0 ? (this.opts.fastMs ?? 4000) : (this.opts.slowMs ?? 30_000);
      this.timer = setTimeout(() => void loop(), delay);
    };
    void loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** Eén ronde: runs, activiteiten en (om de paar rondes) agentstatussen. Fouten stoppen de ronde niet. */
  async tick(): Promise<void> {
    this.ticks += 1;
    const jobs: Array<[string, () => Promise<void>]> = [
      ["runs", () => this.syncRuns()],
      ["activiteit", () => this.syncActivity()],
    ];
    if (this.ticks % 3 === 1 || this.ctx.events.viewers === 0) jobs.push(["agents", () => this.syncAgents()]);
    for (const [name, job] of jobs) {
      try {
        await job();
      } catch (err) {
        this.ctx.log.warn("kantoor: Paperclip bijhouden mislukt", { onderdeel: name, error: errorMessage(err) });
      }
    }
  }

  private async issue(issueId: string): Promise<PcIssue | null> {
    const cached = this.issueCache.get(issueId);
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.issue;
    try {
      const issue = await this.ctx.paperclip.getIssue(issueId);
      this.issueCache.set(issueId, { issue, at: Date.now() });
      if (this.issueCache.size > 500) this.issueCache.delete(this.issueCache.keys().next().value!);
      return issue;
    } catch {
      return null;
    }
  }

  private async syncRuns(): Promise<void> {
    const live = await this.ctx.paperclip.listLiveRuns(this.ctx.companyId);
    const current = new Set<string>();
    for (const run of live) {
      if (run.status !== "running" && run.status !== "queued") continue;
      current.add(run.id);
      if (this.liveRuns.has(run.id)) continue;
      let issueTitle: string | null = null;
      let identifier: string | null = null;
      let issueId: string | null = null;
      let wakeReason: string | null = null;
      // Aan welke klus werkt hij? Subtaken van één taak (bv. de ideeënraad) zijn samen één klus.
      let groupId: string | null = null;
      let groupTitle: string | null = null;
      try {
        const detail = await this.ctx.paperclip.getRun(run.id);
        wakeReason = typeof detail.contextSnapshot?.wakeReason === "string" ? detail.contextSnapshot.wakeReason : null;
        issueId = typeof detail.contextSnapshot?.issueId === "string" ? detail.contextSnapshot.issueId : null;
        const issue = issueId ? await this.issue(issueId) : null;
        issueTitle = issue?.title ?? null;
        identifier = issue?.identifier ?? null;
        const parent = issue?.parentId ? await this.issue(issue.parentId) : null;
        groupId = parent?.id ?? issue?.id ?? null;
        groupTitle = parent?.title ?? issueTitle;
      } catch {
        // Zonder details tonen we alleen dat hij werkt.
      }
      this.liveRuns.set(run.id, { agentId: run.agentId, issueTitle, log: newRunLogState(), lastShown: new Map(), shown: 0 });
      await this.ctx.events.emit({
        type: "run.started",
        agentId: run.agentId,
        text: issueTitle ?? (wakeReason ? (WAKE_REASON[wakeReason] ?? null) : null),
        data: { runId: run.id, issueId, identifier, wakeReason, groupId, groupTitle },
        sourceKey: `run:${run.id}:start`,
        at: run.startedAt ? new Date(run.startedAt) : undefined,
      });
    }
    for (const [runId, info] of [...this.liveRuns]) {
      if (current.has(runId)) {
        await this.followLog(runId, info);
        continue;
      }
      // Laatste stuk logboek nog lezen: wat deed hij vlak voor het einde?
      await this.followLog(runId, info);
      this.liveRuns.delete(runId);
      let status = "finished";
      let usage: Record<string, unknown> = {};
      try {
        const detail = await this.ctx.paperclip.getRun(runId);
        status = detail.status;
        const u = detail.usageJson ?? null;
        if (u) {
          usage = {
            tokensIn: typeof u.inputTokens === "number" ? u.inputTokens : null,
            tokensOut: typeof u.outputTokens === "number" ? u.outputTokens : null,
            costUsd: typeof u.costUsd === "number" ? Math.round(u.costUsd * 10000) / 10000 : null,
            model: typeof u.model === "string" ? u.model : null,
          };
        }
      } catch {
        // Onbekend: gewoon klaar.
      }
      const tools = toolSummary(info.log.counts);
      await this.ctx.events.emit({
        type: "run.finished",
        agentId: info.agentId,
        text: info.issueTitle,
        data: { runId, status, ...usage, ...(tools ? { tools, toolCounts: info.log.counts } : {}) },
        sourceKey: `run:${runId}:end`,
      });
    }
  }

  /** Leest het nieuwe stuk logboek van een run en toont wat de agent op het web en in de kennisbank doet. */
  private async followLog(runId: string, run: LiveRun): Promise<void> {
    for (let page = 0; page < 4; page++) {
      let chunk: { content: string; nextOffset?: number };
      try {
        chunk = await this.ctx.paperclip.runLog(runId, run.log.offset);
      } catch {
        return; // Geen logboek (nog niet, of een oudere Paperclip): dan alleen de run zelf.
      }
      const before = run.log.offset;
      for (const use of readRunLogChunk(run.log, chunk.content)) await this.showTool(runId, run, use);
      if (chunk.nextOffset === undefined) return;
      // Eén regel groter dan een hele pagina: overslaan in plaats van erop vast te lopen.
      if (run.log.offset === before) run.log.offset = chunk.nextOffset;
    }
  }

  private async showTool(runId: string, run: LiveRun, use: ToolUse): Promise<void> {
    const now = Date.now();
    if (run.shown >= TOOL_MAX_PER_RUN || now - (run.lastShown.get(use.kind) ?? 0) < TOOL_GAP_MS) return;
    run.lastShown.set(use.kind, now);
    run.shown += 1;
    await this.ctx.events.emit({
      type: "agent.tool",
      agentId: run.agentId,
      text: toolText(use),
      data: { runId, kind: use.kind, detail: use.detail },
    });
  }

  private async syncActivity(): Promise<void> {
    const entries = await this.ctx.paperclip.listActivity(this.ctx.companyId, 50);
    // Paperclip geeft het nieuwste eerst; wij verwerken in de volgorde waarin het gebeurde.
    for (const a of [...entries].reverse()) {
      if (this.seenActivity.has(a.id)) continue;
      this.seenActivity.add(a.id);
      await this.handleActivity(a);
    }
    if (this.seenActivity.size > 2000) {
      const keep = [...this.seenActivity].slice(-1000);
      this.seenActivity.clear();
      for (const id of keep) this.seenActivity.add(id);
    }
  }

  private async handleActivity(a: PcActivity): Promise<void> {
    const d = a.details ?? {};
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
    const at = new Date(a.createdAt);
    const sourceKey = `pc:activity:${a.id}`;
    const byAgent = a.actorType === "agent" ? (a.agentId ?? a.actorId) : null;

    switch (a.action) {
      case "issue.comment_added": {
        if (!byAgent || !a.entityId) return;
        const issue = await this.issue(a.entityId);
        const to = counterpart(issue, byAgent);
        await this.ctx.events.emit({
          type: "talk",
          agentId: byAgent,
          targetAgentId: to,
          text: shortText(str(d.bodySnippet), 160) ?? "Reactie geplaatst",
          data: {
            kind: "comment",
            issueId: a.entityId,
            identifier: str(d.identifier) ?? issue?.identifier ?? null,
            issueTitle: str(d.issueTitle) ?? issue?.title ?? null,
          },
          sourceKey,
          at,
        });
        return;
      }
      case "issue.created": {
        if (!byAgent || !a.entityId) return;
        const issue = await this.issue(a.entityId);
        const assignee = issue?.assigneeAgentId ?? null;
        if (!assignee || assignee === byAgent) return;
        const title = str(d.title) ?? issue?.title ?? "een taak";
        await this.ctx.events.emit({
          type: "talk",
          agentId: byAgent,
          targetAgentId: assignee,
          text: `Nieuwe taak voor jou: ${title}`,
          data: { kind: "delegate", issueId: a.entityId, identifier: str(d.identifier) ?? issue?.identifier ?? null, issueTitle: title },
          sourceKey,
          at,
        });
        return;
      }
      case "issue.updated": {
        // Een taak op "klaar": telt voor de nut-meter als iemand anders hem gaf. Een routine of een taak die je
        // jezelf gaf, bewijst niets (anders scoort "geen nieuws deze week" als resultaat).
        const previous = (d._previous ?? {}) as Record<string, unknown>;
        if (!byAgent || !a.entityId || d.status !== "done" || previous.status === "done") return;
        const issue = await this.issue(a.entityId);
        if (!issue || issue.originKind === "routine_execution") return;
        if (!issue.createdByUserId && (!issue.createdByAgentId || issue.createdByAgentId === byAgent)) return;
        await this.ctx.events.emit({
          type: "task.done",
          agentId: byAgent,
          targetAgentId: issue.createdByAgentId ?? null,
          text: issue.title,
          data: { issueId: a.entityId, identifier: str(d.identifier) ?? issue.identifier, byOwner: Boolean(issue.createdByUserId) },
          sourceKey,
          at,
        });
        return;
      }
      case "agent.hire_created": {
        if (!a.entityId) return;
        await this.ctx.events.emit({
          type: "agent.hired",
          agentId: a.entityId,
          text: str(d.name) ? `${str(d.name)} solliciteert` : "Nieuwe sollicitant",
          data: { name: str(d.name), role: str(d.role), byAgentId: byAgent, requiresApproval: d.requiresApproval === true },
          sourceKey,
          at,
        });
        return;
      }
      case "budget.hard_threshold_crossed": {
        if (d.scopeType !== "agent" || typeof d.scopeId !== "string") return;
        await this.ctx.events.emit({
          type: "budget.stop",
          agentId: d.scopeId,
          text: "Budget op: gepauzeerd tot jij beslist",
          data: { amountLimit: d.amountLimit ?? null, amountObserved: d.amountObserved ?? null },
          sourceKey,
          at,
        });
        return;
      }
      default:
        return;
    }
  }

  private async syncAgents(): Promise<void> {
    const agents = await this.ctx.paperclip.listAgents(this.ctx.companyId);
    const next = new Map(agents.map((a) => [a.id, a.status] as const));
    if (this.agentStatus) {
      for (const agent of agents) {
        const before = this.agentStatus.get(agent.id);
        if (!before || before === agent.status) continue;
        // 'running' ↔ 'idle' zien we al aan de runs; alleen echte statuswissels melden.
        const trivial = new Set<AgentStatus>(["running", "idle", "active"]);
        if (trivial.has(before) && trivial.has(agent.status)) continue;
        await this.ctx.events.emit({
          type: "agent.status",
          agentId: agent.id,
          text: `${agent.name} is ${STATUS_TEXT[agent.status] ?? agent.status}`,
          data: { from: before, to: agent.status, reason: agent.pauseReason },
        });
      }
    }
    this.agentStatus = next;
  }
}

/** Tegen wie praat een agent als hij reageert op een taak? De uitvoerder, anders de maker, anders jij. */
export function counterpart(issue: PcIssue | null, from: string): string | null {
  if (!issue) return null;
  if (issue.assigneeAgentId && issue.assigneeAgentId !== from) return issue.assigneeAgentId;
  if (issue.createdByAgentId && issue.createdByAgentId !== from) return issue.createdByAgentId;
  return null;
}
