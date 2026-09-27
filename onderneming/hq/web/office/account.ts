/**
 * Het kantoor op je Claude-account: het artifact op claude.ai. Je Claude Code-sessies, afdelingen en routines komen
 * live binnen via de connector "Claude Code Remote" (met jouw toestemming, als jij), en een opdracht voor de hoofdagent
 * wordt een nieuwe sessie. Er draait hier geen HQ: geld, experimenten en Paperclip-agents zie je op je eigen server.
 */
import type { AutoPauseResult, CodeProject, KnowledgeGraph, KnowledgeHits, LedgerLine, OfficeEvent, OfficeSnapshot, ProjectDetail } from "../../src/office/types.js";
import {
  accountSnapshot,
  createSessionInput,
  environmentsFrom,
  explainError,
  pickEnvironment,
  routinesFrom,
  SERVER,
  sessionChanges,
  sessionIdIn,
  sessionsFrom,
  visibleSessions,
  type AccountState,
  type Trouble,
} from "./account-model.js";
import type { CodeProjectInput, DataSource, PlanInput, PlanResult, RepoChoice, RevenueInput } from "./data.js";
import { OWNER_ID } from "./layout.js";

/** Het deel van de mcp-capability dat het kantoor gebruikt (de typen van claude.ai zelf, ingekort). */
interface McpResult {
  payload?: unknown;
  cache?: { storedAt: number; revalidating: boolean };
}
type WatchEvent = { type: "data"; result: McpResult } | { type: "error"; error: unknown };
interface Mcp {
  callTool(server: string, tool: string, input?: unknown, options?: { cache?: false }): Promise<McpResult>;
  watchTool(
    server: string,
    tool: string,
    input: unknown,
    handler: (ev: WatchEvent) => void,
    options?: { cache?: { staleTime?: number; gcTime?: number }; refetchInterval?: number },
  ): () => void;
  invalidate(server?: string, tool?: string, input?: unknown): Promise<void>;
}
interface ClaudeRuntime {
  use(name: string): Promise<unknown>;
}

const SESSIONS_INPUT = { limit: 50 };
const NOT_HERE = "Dit kan pas als je server (HQ) draait. Hier zie je alleen wat je Claude-account doet.";
const PROFILE_KEY = "kk-kantoor-jij";

function savedProfile(): { nickname: string | null; avatar: number | null } {
  try {
    const raw = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "null") as { nickname?: unknown; avatar?: unknown } | null;
    return {
      nickname: typeof raw?.nickname === "string" && raw.nickname.trim() ? raw.nickname.trim().slice(0, 30) : null,
      avatar: typeof raw?.avatar === "number" && raw.avatar >= 0 && raw.avatar < 12 ? raw.avatar : null,
    };
  } catch {
    return { nickname: null, avatar: null };
  }
}

export class AccountSource implements DataSource {
  readonly mode = "account" as const;
  private readonly st: AccountState = {
    state: "loading",
    message: "Verbinden met je Claude-account…",
    updatedAt: null,
    sessions: [],
    routines: [],
    routinesError: null,
    environments: [],
    owner: savedProfile(),
    events: [],
    lastEventId: 0,
  };
  private readonly mcp: Promise<Mcp | null>;
  private firstAnswer: Promise<void>;
  private answered!: () => void;
  private seen = false;
  /** De vorige sessielijst zoals het kantoor hem tekende (om veranderingen te zien). */
  private lastVisible: ReturnType<typeof visibleSessions> = [];
  private onEvent: ((e: OfficeEvent) => void) | null = null;
  private onStatus: ((ok: boolean) => void) | null = null;
  private onChange: (() => void) | null = null;
  private stops: Array<() => void> = [];

  constructor() {
    this.firstAnswer = new Promise((resolve) => (this.answered = resolve));
    const claude = (window as unknown as { claude?: ClaudeRuntime }).claude;
    this.mcp = claude?.use
      ? claude.use("mcp").then(
          (ns) => (ns as Mcp | null) ?? null,
          () => null,
        )
      : Promise.resolve(null);
    void this.start();
  }

  private async start(): Promise<void> {
    const mcp = await this.mcp;
    if (!mcp) {
      this.fail({ kind: "unavailable", message: "Deze weergave kan niet bij je Claude-account. Open het kantoor op claude.ai, ingelogd met je eigen account." });
      return;
    }
    this.stops.push(
      mcp.watchTool(SERVER, "list_sessions", SESSIONS_INPUT, (ev) => this.onSessions(ev), { refetchInterval: 30_000, cache: { staleTime: 15_000, gcTime: 600_000 } }),
      mcp.watchTool(SERVER, "list_triggers", {}, (ev) => this.onRoutines(ev), { refetchInterval: 300_000, cache: { staleTime: 60_000, gcTime: 600_000 } }),
      mcp.watchTool(SERVER, "list_environments", {}, (ev) => this.onEnvironments(ev), { refetchInterval: 900_000, cache: { staleTime: 300_000, gcTime: 3_600_000 } }),
    );
  }

  private fail(t: Trouble): void {
    if (t.kind === "blocked" || t.kind === "unavailable") {
      // Geen toegang (meer): niets laten staan wat je niet meer mag zien.
      this.st.sessions = [];
      this.st.routines = [];
      this.st.environments = [];
      this.st.state = t.kind;
      this.seen = false;
      this.lastVisible = [];
    } else if (t.kind === "gone") {
      this.stops.forEach((stop) => stop());
      this.stops = [];
      this.st.state = "unavailable";
    } else if (this.st.state === "loading") {
      this.st.state = t.kind === "transient" ? "loading" : "blocked";
    }
    this.st.message = t.message;
    this.onStatus?.(false);
    this.answered();
    this.onChange?.();
  }

  private onSessions(ev: WatchEvent): void {
    if (ev.type === "error") {
      this.fail(explainError(ev.error));
      return;
    }
    const now = Date.now();
    const before = this.lastVisible;
    this.st.sessions = sessionsFrom(ev.result.payload);
    this.st.updatedAt = ev.result.cache?.storedAt ?? now;
    this.st.state = "ok";
    this.st.message = null;
    this.onStatus?.(true);
    const after = visibleSessions(this.st.sessions, now);
    if (this.seen && !ev.result.cache) {
      for (const change of sessionChanges(before, after)) this.emit(change);
    }
    this.lastVisible = after;
    this.seen = true;
    this.answered();
    this.onChange?.();
  }

  private onRoutines(ev: WatchEvent): void {
    if (ev.type === "error") {
      const t = explainError(ev.error);
      if (t.kind === "blocked" || t.kind === "unavailable") this.st.routines = [];
      this.st.routinesError = t.message;
    } else {
      this.st.routines = routinesFrom(ev.result.payload);
      this.st.routinesError = null;
    }
    this.onChange?.();
  }

  private onEnvironments(ev: WatchEvent): void {
    if (ev.type === "error") {
      const t = explainError(ev.error);
      if (t.kind === "blocked" || t.kind === "unavailable") this.st.environments = [];
      return;
    }
    this.st.environments = environmentsFrom(ev.result.payload);
    this.onChange?.();
  }

  private emit(change: Omit<OfficeEvent, "id" | "at">): void {
    const e: OfficeEvent = { id: ++this.st.lastEventId, at: new Date().toISOString(), ...change };
    this.st.events.push(e);
    if (this.st.events.length > 120) this.st.events.splice(0, this.st.events.length - 120);
    this.onEvent?.(e);
  }

  async snapshot(): Promise<OfficeSnapshot> {
    // De eerste keer even wachten op je sessies (claude.ai vraagt dan misschien eerst om toestemming).
    await Promise.race([this.firstAnswer, new Promise((resolve) => setTimeout(resolve, 9_000))]);
    return accountSnapshot(this.st, Date.now());
  }

  subscribe(onEvent: (e: OfficeEvent) => void, onStatus: (connected: boolean) => void, onChange?: () => void): () => void {
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.onChange = onChange ?? null;
    onStatus(this.st.state === "ok");
    // Wat er binnenkwam tussen de eerste momentopname en nu, ook laten zien.
    onChange?.();
    return () => {
      this.onEvent = null;
      this.onStatus = null;
      this.onChange = null;
    };
  }

  /** Nieuwe lijst ophalen na iets wat je zelf deed (bv. een opdracht gestuurd). */
  private async reload(): Promise<void> {
    const mcp = await this.mcp;
    await mcp?.invalidate(SERVER, "list_sessions").catch(() => undefined);
  }

  private async need(): Promise<Mcp> {
    const mcp = await this.mcp;
    if (!mcp) throw new Error("Deze weergave kan niet bij je Claude-account. Open het kantoor op claude.ai.");
    return mcp;
  }

  async sendPlan(input: PlanInput): Promise<PlanResult> {
    const text = input.text.trim();
    if (text.length < 3) throw new Error("Schrijf eerst wat de hoofdagent moet doen.");
    const mcp = await this.need();
    const env = input.environmentId || pickEnvironment(this.st.sessions, this.st.environments);
    if (!env) throw new Error("Geen cloudomgeving gevonden. Start één keer een sessie op claude.ai/code; daarna kan het vanaf hier.");
    let result: McpResult;
    try {
      result = await mcp.callTool(SERVER, "create_session", createSessionInput({ text, followUp: input.followUp ?? null }, env), { cache: false });
    } catch (err) {
      const t = explainError(err);
      // Bij een time-out weten we niet of de sessie toch is gestart: eerst kijken, niet zomaar opnieuw.
      throw new Error(t.kind === "transient" ? "Geen antwoord van Claude Code Remote. Kijk over een minuut in de stamboom of de hoofdagent toch is gestart, voordat je opnieuw stuurt." : t.message);
    }
    void this.reload();
    const id = sessionIdIn(result.payload);
    return { id, url: id ? `https://claude.ai/code/${id}` : null, message: "De hoofdagent is gestart. Hij verschijnt zo in zijn kamer en in de stamboom." };
  }

  async stopSession(id: string): Promise<void> {
    const mcp = await this.need();
    try {
      await mcp.callTool(SERVER, "interrupt_session", { session_id: id }, { cache: false });
    } catch (err) {
      throw new Error(explainError(err).message);
    }
    void this.reload();
  }

  async archiveSession(id: string): Promise<void> {
    const mcp = await this.need();
    try {
      await mcp.callTool(SERVER, "archive_session", { session_id: id }, { cache: false });
    } catch (err) {
      throw new Error(explainError(err).message);
    }
    void this.reload();
  }

  async setProfile(agentId: string, profile: { nickname?: string | null; avatar?: number | null }): Promise<void> {
    if (agentId !== OWNER_ID) throw new Error("Een sessie kun je hier geen naam geven; dat doet de titel in Claude.");
    const next = {
      nickname: profile.nickname === undefined ? this.st.owner.nickname : profile.nickname?.trim() || null,
      avatar: profile.avatar === undefined ? this.st.owner.avatar : profile.avatar,
    };
    this.st.owner = next;
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
    } catch {
      // Zonder opslag geldt het alleen tot je de pagina herlaadt.
    }
    this.onChange?.();
  }

  async graph(): Promise<KnowledgeGraph> {
    return { source: "hq", builtAt: null, nodes: [], edges: [], totalNodes: 0, totalEdges: 0 };
  }

  // Alles hieronder hoort bij HQ op je server.
  async decide(_approvalId: number, _decision: "approve" | "reject"): Promise<void> {
    throw new Error(NOT_HERE);
  }
  async halt(_reason: string): Promise<void> {
    throw new Error(NOT_HERE);
  }
  async resume(): Promise<void> {
    throw new Error(NOT_HERE);
  }
  async setAgentPaused(_agentId: string, _paused: boolean): Promise<void> {
    throw new Error(NOT_HERE);
  }
  project(_id: number): Promise<ProjectDetail> {
    return Promise.reject(new Error(NOT_HERE));
  }
  async giveTask(_agentId: string, _task: { title: string; description?: string; priority?: "high" | "medium" | "low" }): Promise<void> {
    throw new Error(NOT_HERE);
  }
  async saveCodeProject(_input: CodeProjectInput): Promise<void> {
    throw new Error(NOT_HERE);
  }
  async removeCodeProject(_key: string): Promise<void> {
    throw new Error(NOT_HERE);
  }
  refreshCodeProject(_key: string): Promise<CodeProject | null> {
    return Promise.reject(new Error(NOT_HERE));
  }
  async codeRepos(): Promise<{ repos: RepoChoice[]; error: string | null }> {
    return { repos: [], error: NOT_HERE };
  }
  async addMetric(_experimentId: number, _metric: { name: string; value: number; note?: string }): Promise<void> {
    throw new Error(NOT_HERE);
  }
  async addRevenue(_input: RevenueInput): Promise<void> {
    throw new Error(NOT_HERE);
  }
  importCsv(_text: string): Promise<{ imported: number; errors: string[] }> {
    return Promise.reject(new Error(NOT_HERE));
  }
  async endProject(_id: number, _verdict: "keep" | "iterate" | "kill", _reason: string): Promise<void> {
    throw new Error(NOT_HERE);
  }
  async ledger(_limit?: number): Promise<LedgerLine[]> {
    return [];
  }
  searchKnowledge(_q: string): Promise<KnowledgeHits> {
    return Promise.reject(new Error(NOT_HERE));
  }
  pauseIdle(): Promise<AutoPauseResult> {
    return Promise.reject(new Error(NOT_HERE));
  }
}
