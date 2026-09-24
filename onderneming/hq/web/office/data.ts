/**
 * Waar het kantoor zijn gegevens vandaan haalt: HQ (live) of een verzonnen demobedrijf.
 */
import type { CodeProject, KnowledgeGraph, OfficeEvent, OfficeSnapshot, ProjectDetail } from "../../src/office/types.js";

/** Wat je invult bij "project volgen" in de werkplaats. */
export interface CodeProjectInput {
  key?: string;
  name: string;
  repo?: string | null;
  url?: string | null;
  healthUrl?: string | null;
  branch?: string | null;
  backlogPath?: string;
  description?: string | null;
}

export interface RepoChoice {
  repo: string;
  private: boolean;
  homepage: string | null;
  description: string | null;
  pushedAt: string | null;
}

export interface DataSource {
  readonly mode: "live" | "demo";
  snapshot(): Promise<OfficeSnapshot>;
  /** Live gebeurtenissen; geeft een functie terug om te stoppen. */
  subscribe(onEvent: (e: OfficeEvent) => void, onStatus: (connected: boolean) => void): () => void;
  decide(approvalId: number, decision: "approve" | "reject"): Promise<void>;
  halt(reason: string): Promise<void>;
  resume(): Promise<void>;
  setAgentPaused(agentId: string, paused: boolean): Promise<void>;
  setProfile(agentId: string, profile: { nickname?: string | null; avatar?: number | null }): Promise<void>;
  project(id: number): Promise<ProjectDetail>;
  graph(): Promise<KnowledgeGraph>;
  /** Een agent een taak geven (wordt een Paperclip-taak op zijn naam). */
  giveTask(agentId: string, task: { title: string; description?: string; priority?: "high" | "medium" | "low" }): Promise<void>;
  /** Werkplaats: een project volgen of bijwerken, weghalen, nu verversen, en repositories om uit te kiezen. */
  saveCodeProject(input: CodeProjectInput): Promise<void>;
  removeCodeProject(key: string): Promise<void>;
  refreshCodeProject(key: string): Promise<CodeProject | null>;
  codeRepos(): Promise<{ repos: RepoChoice[]; error: string | null }>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const msg = json && typeof json === "object" && "error" in json ? String((json as { error: unknown }).error) : res.statusText;
    throw new HttpError(res.status, msg);
  }
  return json as T;
}

export class LiveSource implements DataSource {
  readonly mode = "live" as const;
  private lastId = 0;

  async snapshot(): Promise<OfficeSnapshot> {
    const snap = await request<OfficeSnapshot>("GET", "/api/owner/office");
    this.lastId = Math.max(this.lastId, snap.lastEventId);
    return snap;
  }

  subscribe(onEvent: (e: OfficeEvent) => void, onStatus: (connected: boolean) => void): () => void {
    let es: EventSource | null = null;
    let stopped = false;
    let retry = 1000;
    const connect = () => {
      if (stopped) return;
      es = new EventSource(`/api/owner/office/stream?after=${this.lastId}`);
      es.addEventListener("open", () => {
        retry = 1000;
        onStatus(true);
      });
      es.addEventListener("office", (msg) => {
        const e = JSON.parse((msg as MessageEvent).data) as OfficeEvent;
        if (e.id <= this.lastId) return;
        this.lastId = e.id;
        onEvent(e);
      });
      es.addEventListener("error", () => {
        onStatus(false);
        es?.close();
        // Opnieuw verbinden met oplopende pauze (max 30 s); gemiste gebeurtenissen komen dan alsnog.
        setTimeout(connect, retry);
        retry = Math.min(retry * 2, 30_000);
      });
    };
    connect();
    return () => {
      stopped = true;
      es?.close();
    };
  }

  async decide(approvalId: number, decision: "approve" | "reject"): Promise<void> {
    await request("POST", `/api/owner/approvals/${approvalId}/decide`, { decision });
  }
  async halt(reason: string): Promise<void> {
    await request("POST", "/api/owner/halt", { reason });
  }
  async resume(): Promise<void> {
    await request("POST", "/api/owner/resume", {});
  }
  async setAgentPaused(agentId: string, paused: boolean): Promise<void> {
    await request("POST", `/api/owner/agents/${encodeURIComponent(agentId)}/${paused ? "pause" : "resume"}`, {});
  }
  async setProfile(agentId: string, profile: { nickname?: string | null; avatar?: number | null }): Promise<void> {
    await request("PUT", `/api/owner/agents/${encodeURIComponent(agentId)}/profile`, profile);
  }
  project(id: number): Promise<ProjectDetail> {
    return request("GET", `/api/owner/projects/${id}`);
  }
  graph(): Promise<KnowledgeGraph> {
    return request("GET", "/api/owner/knowledge/graph?max=400");
  }
  async giveTask(agentId: string, task: { title: string; description?: string; priority?: "high" | "medium" | "low" }): Promise<void> {
    await request("POST", `/api/owner/agents/${encodeURIComponent(agentId)}/task`, task);
  }
  async saveCodeProject(input: CodeProjectInput): Promise<void> {
    await request("POST", "/api/owner/code/projects", input);
  }
  async removeCodeProject(key: string): Promise<void> {
    await request("DELETE", `/api/owner/code/projects/${encodeURIComponent(key)}`);
  }
  refreshCodeProject(key: string): Promise<CodeProject | null> {
    return request("POST", `/api/owner/code/projects/${encodeURIComponent(key)}/refresh`, {});
  }
  codeRepos(): Promise<{ repos: RepoChoice[]; error: string | null }> {
    return request("GET", "/api/owner/code/repos");
  }
}
