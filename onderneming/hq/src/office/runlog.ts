/**
 * Leest mee in het logboek van een Paperclip-run en haalt eruit wat de agent op het web en in de
 * kennisbank doet: zoeken, pagina's lezen, trends, de kennisgraaf, code aanpassen. Zo zie je in het
 * kantoor dat een agent echt het web op gaat, zonder dat er op de server iets extra's hoeft te draaien.
 *
 * Het logboek is JSONL: per regel `{ts, stream, chunk}`. In de chunks staat wat de agent uitvoert:
 * - bij de ACP-engine (standaard): regels `{"type":"acpx.tool_call","name":…,"input":{…}}`;
 * - bij de CLI-engine: stream-json, `{"type":"assistant","message":{"content":[{"type":"tool_use",…}]}}`.
 */

export type ToolKind = "search" | "fetch" | "crawl" | "trends" | "graph" | "code" | "skill";

export interface ToolUse {
  kind: ToolKind;
  /** Wat er gezocht of gelezen werd, kort (zoekvraag, adres, bestandsnaam). */
  detail: string;
}

export interface RunLogState {
  /** Tot waar (in bytes) het logboek gelezen is. */
  offset: number;
  /** Onafgemaakte regel uit de uitvoer van de agent (stream-json kan midden in een regel knippen). */
  pending: string;
  counts: Partial<Record<ToolKind, number>>;
}

export const newRunLogState = (): RunLogState => ({ offset: 0, pending: "", counts: {} });

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/** Een adres kort: host + pad, zonder queryparameters (daar kan van alles in staan). */
export function shortUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname === "/" ? "" : u.pathname;
    return clip(`${u.hostname.replace(/^www\./, "")}${path}`, 70);
  } catch {
    return clip(raw, 70);
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const fileName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const firstArg = (s: string) => {
  const m = s.match(/^\s*(?:"([^"]*)"|'([^']*)'|(\S+))/);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
};

/** Wat doet een shell-commando? Alleen de commando's die ertoe doen; de rest is ruis. */
export function classifyCommand(command: string): ToolUse | null {
  const web = command.match(/\bhq-web\s+(.+)/);
  if (web) return { kind: "crawl", detail: shortUrl(firstArg(web[1]!)) };
  const trends = command.match(/\bhq-trends\s+(.+)/);
  if (trends) return { kind: "trends", detail: clip(firstArg(trends[1]!), 60) };
  const graaf = command.match(/\bhq-graaf\s+(\w+)\s*(.*)/);
  if (graaf) return { kind: "graph", detail: clip(`${graaf[1]} ${firstArg(graaf[2] ?? "")}`.trim(), 60) };
  const graphify = command.match(/\bgraphify\s+(query|explain|path|update)\s*(.*)/);
  if (graphify) return { kind: "graph", detail: clip(`${graphify[1]} ${firstArg(graphify[2] ?? "")}`.trim(), 60) };
  // `hq kennis` loopt via HQ zelf; dat meldt HQ al als kennisvraag.
  const curl = command.match(/\bcurl\b[^|;&]*?(https?:\/\/[^\s'"|;&]+)/);
  if (curl && !/\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(curl[1]!) && !curl[1]!.includes("$HQ_URL")) {
    return { kind: "fetch", detail: shortUrl(curl[1]!) };
  }
  return null;
}

/** Zet één toolaanroep (naam + invoer) om naar iets wat het kantoor kan tonen. */
export function classifyTool(name: string, input: unknown): ToolUse | null {
  const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  // Bij ACP is de naam een titel ("Fetch https://…", "Edit src/x.ts", of de zoekvraag tussen
  // aanhalingstekens); bij de CLI de toolnaam (WebSearch, WebFetch, Bash, Edit). De invoer beslist.
  const n = name.trim();
  if (/^skill\b/i.test(n)) {
    const skill = str(inp.skill) ?? str(inp.name) ?? str(inp.command);
    return skill ? { kind: "skill", detail: clip(skill, 40) } : null;
  }
  const command = str(inp.command);
  if (command) return classifyCommand(command);
  const url = str(inp.url);
  if (url) return { kind: "fetch", detail: shortUrl(url) };
  const query = str(inp.query);
  if (query) return { kind: "search", detail: clip(query, 80) };
  const file = str(inp.file_path) ?? str(inp.notebook_path);
  if (file && /edit|write/i.test(n)) return { kind: "code", detail: fileName(file) };
  return null;
}

/** Eén regel uitvoer van de agent (ACP of stream-json) → de toolaanroepen erin. */
export function toolUsesInLine(line: string): ToolUse[] {
  // Snel overslaan: de meeste regels zijn tekst of tokens, geen toolaanroep.
  if (!line.includes("tool_call") && !line.includes("tool_use")) return [];
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (obj.type === "acpx.tool_call") {
    // Alleen de eerste melding van een aanroep; de updates daarna gaan over dezelfde aanroep.
    if (obj.tag === "tool_call_update") return [];
    const use = classifyTool(String(obj.name ?? ""), obj.input);
    return use ? [use] : [];
  }
  if (obj.type === "assistant") {
    const content = (obj.message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) return [];
    const out: ToolUse[] = [];
    for (const item of content as Array<Record<string, unknown>>) {
      if (item?.type !== "tool_use") continue;
      const use = classifyTool(String(item.name ?? ""), item.input);
      if (use) out.push(use);
    }
    return out;
  }
  return [];
}

/**
 * Verwerkt een nieuw stuk logboek. Werkt `state` bij (offset, onafgemaakte regel, tellingen) en geeft
 * de toolaanroepen in volgorde terug. `content` begint op `state.offset`.
 */
export function readRunLogChunk(state: RunLogState, content: string): ToolUse[] {
  const end = content.lastIndexOf("\n");
  if (end < 0) return [];
  const complete = content.slice(0, end + 1);
  state.offset += Buffer.byteLength(complete, "utf8");
  const uses: ToolUse[] = [];
  for (const record of complete.split("\n")) {
    if (!record) continue;
    let rec: { stream?: string; chunk?: unknown };
    try {
      rec = JSON.parse(record) as { stream?: string; chunk?: unknown };
    } catch {
      continue;
    }
    if (rec.stream !== "stdout" || typeof rec.chunk !== "string") continue;
    const text = state.pending + rec.chunk;
    const lines = text.split("\n");
    state.pending = lines.pop() ?? "";
    // Een onafgemaakte regel van meer dan 1 MB is geen toolaanroep meer; niet eeuwig bewaren.
    if (state.pending.length > 1_000_000) state.pending = "";
    for (const line of lines) {
      for (const use of toolUsesInLine(line)) {
        state.counts[use.kind] = (state.counts[use.kind] ?? 0) + 1;
        uses.push(use);
      }
    }
  }
  return uses;
}

const ICON: Record<ToolKind, string> = {
  search: "🔎",
  fetch: "🌐",
  crawl: "🌐",
  trends: "📈",
  graph: "🕸️",
  code: "✍️",
  skill: "📘",
};

const VERB: Record<ToolKind, string> = {
  search: "zoekt",
  fetch: "leest",
  crawl: "leest",
  trends: "trends",
  graph: "kennisgraaf",
  code: "bewerkt",
  skill: "skill",
};

export function toolText(use: ToolUse): string {
  return `${ICON[use.kind]} ${VERB[use.kind]}: ${use.detail}`;
}

/** Korte samenvatting voor als de run klaar is: "3× gezocht, 5 pagina's gelezen". */
export function toolSummary(counts: Partial<Record<ToolKind, number>>): string | null {
  const parts: string[] = [];
  const pages = (counts.fetch ?? 0) + (counts.crawl ?? 0);
  if (counts.search) parts.push(`${counts.search}× gezocht`);
  if (pages) parts.push(`${pages} ${pages === 1 ? "pagina" : "pagina's"} gelezen`);
  if (counts.trends) parts.push(`${counts.trends}× trends`);
  if (counts.graph) parts.push(`${counts.graph}× kennisgraaf`);
  if (counts.code) parts.push(`${counts.code} ${counts.code === 1 ? "bestand" : "bestanden"} bewerkt`);
  return parts.length ? parts.join(", ") : null;
}
