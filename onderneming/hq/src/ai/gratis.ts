/**
 * Gratis AI via OmniRoute (MIT, github.com/diegosouzapw/OmniRoute) op de server (127.0.0.1:20128).
 * OmniRoute zet veel aanbieders achter één adres. In de combo "gratis" zet HQ de beste gratis modellen in een
 * vaste volgorde: zit er één aan zijn limiet, dan neemt de volgende het over.
 *
 * Bewust alleen de nette manier: per aanbieder één eigen API-sleutel binnen hun gratis laag. OmniRoute kan ook
 * abonnementen koppelen (Claude, ChatGPT, Copilot), cookies van webchats gebruiken en accounts stapelen. Dat
 * gebruikt HQ niet: het schendt de voorwaarden van die aanbieders, en je account (ook dat van Claude Code) kan er
 * geblokkeerd door raken. Verbindingen buiten de lijst hieronder komen daarom nooit in de combo.
 *
 * De modellen verschuiven vaak. Daarom vraagt `dist/main.js gratis-ai` OmniRoute welke modellen een aanbieder
 * nu heeft, en pakt het de beste volgens een voorkeurslijst.
 */

export type ProviderId = "groq" | "cerebras" | "sambanova" | "gemini" | "huggingface" | "mistral" | "openrouter";

export interface FreeProvider {
  /** Id van de aanbieder in OmniRoute. */
  id: ProviderId;
  name: string;
  /** Omgevingsvariabele met jouw sleutel (in ~/.config/hq/gratis-ai.env). */
  envKey: string;
  /** Waar je de sleutel maakt. */
  keyUrl: string;
  /** Voorkeur, beste eerst. Het eerste patroon dat een bestaand model raakt, wint. */
  prefer: RegExp[];
  /** Alleen deze modellen komen in aanmerking (geen spraak, embeddings of beveiligingsfilters). */
  allow?: (id: string) => boolean;
  /** Wat je moet weten: limieten en wat er met je gegevens gebeurt. */
  note: string;
  /** Gebruikt de aanbieder je prompts (mogelijk) om te trainen? Die staan achteraan in de rij. */
  mayTrain: boolean;
}

const chatOnly = (id: string) => !/whisper|tts|embed|guard|safeguard|safety|rerank|ocr|image|vision-exp|moderation/i.test(id);

/**
 * In deze volgorde komen ze in de combo: snel en privacy-vriendelijk eerst. Stand september 2026
 * (docs/ONDERZOEK-AGENTS.md, "Gratis en open modellen"). Bewust níet in de lijst:
 * - Cerebras: sinds augustus 2026 geen gratis laag meer, alleen proeftegoed met een betaalkaart;
 * - NVIDIA NIM en Cohere: gratis alleen om te proberen, niet voor echt werk (hun voorwaarden);
 * - Kimi K2.6 en K3: nergens meer gratis (OpenRouter, Groq en Cloudflare vragen nu geld).
 */
export const PROVIDERS: FreeProvider[] = [
  {
    id: "groq",
    name: "Groq",
    envKey: "GROQ_API_KEY",
    keyUrl: "https://console.groq.com/keys",
    // Llama ging in augustus 2026 van de gratis laag af.
    prefer: [/^openai\/gpt-oss-120b$/, /^qwen\/qwen3\.8-\d+b$/, /^qwen\/qwen3\.\d+-\d+b$/, /^openai\/gpt-oss-20b$/],
    allow: chatOnly,
    note: "Gratis laag met limieten per minuut en per dag, per model. Traint niet op je gegevens.",
    mayTrain: false,
  },
  {
    id: "sambanova",
    name: "SambaNova",
    envKey: "SAMBANOVA_API_KEY",
    keyUrl: "https://cloud.sambanova.ai/apis",
    prefer: [/^DeepSeek-V4/, /^DeepSeek-V3\.\d+$/, /^gpt-oss-120b$/, /^MiniMax-M\d/, /^Meta-Llama-3\.3-70B/, /^gemma-4/],
    allow: chatOnly,
    note: "Gratis laag met limieten per minuut en per dag.",
    mayTrain: false,
  },
  {
    id: "gemini",
    name: "Google AI Studio (Gemini)",
    envKey: "GEMINI_API_KEY",
    keyUrl: "https://aistudio.google.com/apikey",
    prefer: [/^gemini-\d+(\.\d+)?-flash$/, /^gemini-\d+(\.\d+)?-flash-preview$/, /^gemini-\d+(\.\d+)?-flash-lite$/],
    allow: chatOnly,
    note: "Gratis laag met limieten per minuut en per dag. In de EU/EER gelden de regels van de betaalde laag: Google gebruikt je gegevens dan niet om te trainen.",
    mayTrain: false,
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    envKey: "HF_TOKEN",
    keyUrl: "https://huggingface.co/settings/tokens",
    prefer: [/^openai\/gpt-oss-120b$/, /^deepseek-ai\/DeepSeek-V\d+(\.\d+)?-Flash$/, /^Qwen\/Qwen3\.\d+-27B$/, /^zai-org\/GLM-\d+(\.\d+)?-Flash$/, /^meta-llama\/Llama-3\.3-70B/],
    allow: chatOnly,
    note: "Een klein gratis tegoed per maand; daarna stopt het tot de volgende maand.",
    mayTrain: false,
  },
  {
    id: "mistral",
    name: "Mistral",
    envKey: "MISTRAL_API_KEY",
    keyUrl: "https://console.mistral.ai/api-keys",
    prefer: [/^mistral-small-latest$/, /^mistral-medium/, /^devstral-latest$/, /^mistral-large-latest$/],
    allow: chatOnly,
    note: "Gratis Experiment-plan (telefoonverificatie), bedoeld om te proberen. Mistral gebruikt die gegevens voor training, tenzij je dat uitzet (Admin → Privacy).",
    mayTrain: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter (gratis modellen)",
    envKey: "OPENROUTER_API_KEY",
    keyUrl: "https://openrouter.ai/keys",
    // Alleen grote modellen die met tools overweg kunnen, bij naam: het gratis aanbod wisselt vaak (in september 2026
    // helemaal) en bevat ook piepkleine modellen en filters waar een agent niets aan heeft.
    prefer: [
      /^thinkingmachines\/inkling:free$/,
      /^nvidia\/nemotron-3-ultra-[\w-]+:free$/,
      /^qwen\/qwen3[\w.-]*:free$/,
      /^google\/gemma-4-31b[\w-]*:free$/,
      /^nvidia\/nemotron-3-super-[\w-]+:free$/,
      /^deepseek\/[\w.-]+:free$/,
    ],
    allow: (id) => id.endsWith(":free") && chatOnly(id),
    note: "20 verzoeken per minuut en 50 per dag (1000 als je ooit $10 tegoed kocht). Sommige gratis modellen bewaren of gebruiken je prompts: daarom als laatste in de rij.",
    mayTrain: true,
  },
];

/** De modelnaam (de combo in OmniRoute) waarmee agents en Graphify de router aanspreken. */
export const GRATIS_MODEL = "gratis";
/** Naam van de sleutel waarmee HQ en de agents OmniRoute gebruiken. */
export const HQ_KEY_NAME = "hq-agents";

/** Kies de beste modellen van een aanbieder uit wat er nu is. Meer modellen = langer doorwerken (limieten gelden vaak per model). */
export function pickModels(provider: FreeProvider, available: string[], max = 3): string[] {
  const ids = available.filter((id) => !provider.allow || provider.allow(id));
  const picked: string[] = [];
  for (const pattern of provider.prefer) {
    for (const id of ids) {
      if (picked.length >= max) return picked;
      if (pattern.test(id) && !picked.includes(id)) picked.push(id);
    }
  }
  return picked;
}

// ---------------------------------------------------------------------------------------------- OmniRoute

export interface Connection {
  id: string;
  provider: string;
  name: string;
  isActive: boolean;
  /** apikey, oauth, cookie, ... */
  authType?: string;
}

/** Wat HQ van OmniRoute nodig heeft (zo kunnen de tests een nep-OmniRoute gebruiken). */
export interface OmniApi {
  login(): Promise<void>;
  connections(): Promise<Connection[]>;
  addConnection(provider: string, name: string, apiKey: string): Promise<void>;
  updateConnection(id: string, apiKey: string): Promise<void>;
  models(connectionId: string): Promise<string[]>;
  combos(): Promise<Array<{ id: string; name: string }>>;
  saveCombo(id: string | null, name: string, models: string[]): Promise<void>;
  keys(): Promise<Array<{ id: string; name: string }>>;
  createKey(name: string): Promise<{ id: string; key: string }>;
  updateKey(id: string, patch: Record<string, unknown>): Promise<void>;
  /** Werkt deze sleutel voor de agents (het /v1-deel)? */
  keyWorks(key: string): Promise<boolean>;
}

export class OmniRouteError extends Error {}

const unreachable = (baseUrl: string, err: unknown) =>
  new OmniRouteError(`OmniRoute niet bereikbaar op ${baseUrl} (${err instanceof Error ? err.message : String(err)}). Draait gratis-ai? (systemctl --user status gratis-ai)`);

/** Beheer van OmniRoute via zijn API, ingelogd met het wachtwoord van het dashboard. */
export class OmniRouteClient implements OmniApi {
  private cookie = "";

  constructor(
    private readonly baseUrl: string,
    private readonly password: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw unreachable(this.baseUrl, err);
    }
    const text = await res.text();
    if (!res.ok) throw new OmniRouteError(`OmniRoute gaf ${res.status} op ${method} ${path}: ${text.slice(0, 200)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  async login(): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: this.password }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw unreachable(this.baseUrl, err);
    }
    if (res.status === 401 || res.status === 403) {
      throw new OmniRouteError("Inloggen bij OmniRoute lukte niet: klopt OMNIROUTE_PASSWORD in gratis-ai.env nog met het wachtwoord van het dashboard?");
    }
    if (!res.ok) throw new OmniRouteError(`Inloggen bij OmniRoute gaf ${res.status}.`);
    const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie") ?? ""];
    this.cookie = cookies
      .map((c) => c.split(";")[0]!.trim())
      .filter(Boolean)
      .join("; ");
    if (!this.cookie) throw new OmniRouteError("OmniRoute gaf na het inloggen geen sessie terug.");
  }

  async connections(): Promise<Connection[]> {
    const r = await this.call<{ connections?: Connection[] }>("GET", "/api/providers");
    return r.connections ?? [];
  }

  async addConnection(provider: string, name: string, apiKey: string): Promise<void> {
    await this.call("POST", "/api/providers", { provider, name, apiKey, isActive: true });
  }

  async updateConnection(id: string, apiKey: string): Promise<void> {
    await this.call("PATCH", `/api/providers/${encodeURIComponent(id)}`, { apiKey, isActive: true });
  }

  async models(connectionId: string): Promise<string[]> {
    const r = await this.call<{ models?: Array<{ id: string }> }>("GET", `/api/providers/${encodeURIComponent(connectionId)}/models`);
    return (r.models ?? []).map((m) => m.id);
  }

  async combos(): Promise<Array<{ id: string; name: string }>> {
    const r = await this.call<{ combos?: Array<{ id: string; name: string }> }>("GET", "/api/combos");
    return r.combos ?? [];
  }

  async saveCombo(id: string | null, name: string, models: string[]): Promise<void> {
    const body = { name, strategy: "priority", models };
    if (id) await this.call("PUT", `/api/combos/${encodeURIComponent(id)}`, body);
    else await this.call("POST", "/api/combos", body);
  }

  async keys(): Promise<Array<{ id: string; name: string }>> {
    const r = await this.call<{ keys?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>>("GET", "/api/keys");
    return Array.isArray(r) ? r : (r.keys ?? []);
  }

  async createKey(name: string): Promise<{ id: string; key: string }> {
    return this.call<{ id: string; key: string }>("POST", "/api/keys", { name });
  }

  async updateKey(id: string, patch: Record<string, unknown>): Promise<void> {
    await this.call("PATCH", `/api/keys/${encodeURIComponent(id)}`, patch);
  }

  async keyWorks(key: string): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export interface GratisPlan {
  /** De combo "gratis": provider/model, in volgorde. */
  combo: string[];
  used: Array<{ provider: FreeProvider; connection: string; models: string[] }>;
  /** Verbindingen in OmniRoute die HQ bewust niet gebruikt, met de reden. */
  skipped: Array<{ name: string; reason: string }>;
}

const isApiKey = (c: Connection) => !c.authType || c.authType === "apikey";

/** Welke verbindingen komen in de combo, en welke niet (en waarom). */
export async function planGratis(api: OmniApi, connections: Connection[], perProvider = 3): Promise<GratisPlan> {
  const plan: GratisPlan = { combo: [], used: [], skipped: [] };
  for (const c of connections) {
    if (!isApiKey(c)) {
      plan.skipped.push({ name: c.name, reason: "gekoppeld via een login of abonnement: dat verbieden de meeste aanbieders, en je account kan geblokkeerd raken" });
    } else if (!PROVIDERS.some((p) => p.id === c.provider)) {
      plan.skipped.push({ name: c.name, reason: "staat niet op de lijst van bekende aanbieders met een officiële gratis laag" });
    } else if (!c.isActive) {
      plan.skipped.push({ name: c.name, reason: "staat uit in OmniRoute" });
    }
  }
  for (const provider of PROVIDERS) {
    const c = connections.find((x) => x.provider === provider.id && x.isActive && isApiKey(x));
    if (!c) continue;
    const models = pickModels(provider, await api.models(c.id), provider.id === "openrouter" ? Math.min(2, perProvider) : perProvider);
    if (!models.length) {
      plan.skipped.push({ name: c.name, reason: "geen bruikbaar gratis model gevonden" });
      continue;
    }
    plan.used.push({ provider, connection: c.name, models });
    plan.combo.push(...models.map((m) => `${provider.id}/${m}`));
  }
  return plan;
}

export interface SyncResult {
  plan: GratisPlan;
  added: string[];
  updated: string[];
  /** Nieuwe sleutel voor HQ (komt als HQ_GRATIS_AI_KEY in hq.env), of null als de oude nog werkt. */
  newKey: string | null;
}

/**
 * Zet jouw sleutels in OmniRoute, maakt de combo "gratis" en zorgt dat HQ een eigen sleutel heeft.
 * Die sleutel slaat geen prompts op en laat de tekst ongemoeid (OmniRoute kan prompts "comprimeren";
 * dat verandert wat de agent leest).
 */
export async function syncGratis(api: OmniApi, keys: Record<string, string | undefined>, opts: { hqKey?: string; perProvider?: number } = {}): Promise<SyncResult> {
  await api.login();
  const result: SyncResult = { plan: { combo: [], used: [], skipped: [] }, added: [], updated: [], newKey: null };
  let connections = await api.connections();
  for (const provider of PROVIDERS) {
    const key = keys[provider.envKey];
    if (!key) continue;
    const existing = connections.find((c) => c.provider === provider.id && isApiKey(c));
    if (existing) {
      await api.updateConnection(existing.id, key);
      result.updated.push(provider.name);
    } else {
      await api.addConnection(provider.id, provider.name, key);
      result.added.push(provider.name);
    }
  }
  connections = await api.connections();
  result.plan = await planGratis(api, connections, opts.perProvider);
  if (result.plan.combo.length) {
    const existing = (await api.combos()).find((c) => c.name === GRATIS_MODEL);
    await api.saveCombo(existing?.id ?? null, GRATIS_MODEL, result.plan.combo);
  }
  let hqKey = (await api.keys()).find((k) => k.name === HQ_KEY_NAME);
  if (!hqKey || !opts.hqKey || !(await api.keyWorks(opts.hqKey))) {
    const created = await api.createKey(HQ_KEY_NAME);
    hqKey = { id: created.id, name: HQ_KEY_NAME };
    result.newKey = created.key;
  }
  await api.updateKey(hqKey.id, { compressionEnabled: false, noLog: true });
  return result;
}

/** Een leesbare samenvatting voor in de terminal. */
export function describePlan(plan: GratisPlan): string {
  if (!plan.used.length && !plan.skipped.length) {
    return "Nog geen aanbieders. Zet minstens één sleutel in ~/.config/hq/gratis-ai.env (bv. GROQ_API_KEY) en draai dit met --schrijf.";
  }
  const lines: string[] = [];
  let order = 1;
  for (const u of plan.used) {
    lines.push(`✔ ${u.provider.name}: ${u.models.map((m) => `${order++}. ${m}`).join(", ")}${u.provider.mayTrain ? "  (⚠️ kan je gegevens gebruiken voor training)" : ""}`);
    lines.push(`   ${u.provider.note}`);
  }
  for (const s of plan.skipped) lines.push(`✖ ${s.name}: ${s.reason}`);
  if (plan.combo.length) lines.push("", `Combo "${GRATIS_MODEL}": ${plan.combo.length} modellen, in deze volgorde.`);
  return lines.join("\n");
}

/** Leest een env-bestand (KEY=waarde per regel, # is commentaar). */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value) out[key] = value;
  }
  return out;
}

/** Zet (of vervangt) één regel KEY=waarde in een env-bestand, en laat de rest staan. */
export function setEnvLine(text: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) return text.replace(re, line);
  return `${text.replace(/\n*$/, "\n")}${line}\n`;
}

/**
 * Omgeving voor een agent die op de gratis router draait (Claude Code praat dan via OmniRoute in plaats van
 * rechtstreeks met Anthropic). Het contextvenster is kleiner dan bij Claude, dus Claude Code moet eerder samenvatten.
 */
export function gratisAgentEnv(cfg: { url: string; key: string; contextTokens: number }): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: cfg.url,
    ANTHROPIC_AUTH_TOKEN: cfg.key,
    ANTHROPIC_DEFAULT_OPUS_MODEL: GRATIS_MODEL,
    ANTHROPIC_DEFAULT_SONNET_MODEL: GRATIS_MODEL,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: GRATIS_MODEL,
    CLAUDE_CODE_SUBAGENT_MODEL: GRATIS_MODEL,
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(cfg.contextTokens),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}
