/**
 * Waar het kantoor zijn gegevens vandaan haalt: HQ (live) of een verzonnen demobedrijf.
 */
import type { KnowledgeGraph, OfficeEvent, OfficeSnapshot, ProjectDetail } from "../../src/office/types.js";

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
}
