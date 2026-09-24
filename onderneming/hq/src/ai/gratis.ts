import { stringify } from "yaml";

/**
 * Gratis AI: een LiteLLM-router op de server (127.0.0.1:4000) die de gratis lagen van een paar aanbieders
 * achter één adres zet. Loopt er één tegen zijn limiet aan, dan neemt de volgende het over.
 *
 * Bewust alleen de nette manier: per aanbieder één eigen API-sleutel binnen hun gratis laag, zoals hun
 * voorwaarden het toestaan. Geen inloggegevens of abonnementen van chat-apps hergebruiken, geen stapels
 * accounts om limieten te omzeilen (dat doet OmniRoute wel, en dat schendt de voorwaarden van die aanbieders).
 *
 * De modellen verschuiven vaak. Daarom kiest `dist/main.js gratis-ai` ze niet uit een vaste lijst, maar vraagt het elke
 * aanbieder welke modellen er nu zijn, en pakt het de beste volgens een voorkeurslijst.
 */

export type ProviderId = "groq" | "cerebras" | "gemini" | "mistral" | "openrouter";

export interface FreeProvider {
  id: ProviderId;
  name: string;
  /** Omgevingsvariabele met de sleutel (zo heet hij ook in de LiteLLM-config). */
  envKey: string;
  /** Voorvoegsel voor LiteLLM (groq/, gemini/, ...). */
  prefix: string;
  modelsUrl: string;
  /** Voorkeur, beste eerst. Het eerste patroon dat een bestaand model raakt, wint. */
  prefer: RegExp[];
  /** Alleen deze modellen komen in aanmerking (bv. OpenRouter: alleen :free). */
  allow?: (id: string) => boolean;
  /** Wat je moet weten: limieten en wat er met je gegevens gebeurt. */
  note: string;
  /** Gebruikt de aanbieder je prompts (mogelijk) om te trainen? */
  mayTrain: boolean;
}

export const PROVIDERS: FreeProvider[] = [
  {
    id: "groq",
    name: "Groq",
    envKey: "GROQ_API_KEY",
    prefix: "groq/",
    modelsUrl: "https://api.groq.com/openai/v1/models",
    prefer: [/^openai\/gpt-oss-120b$/, /^moonshotai\/kimi-k2/, /^qwen\/qwen3-32b$/, /^llama-3\.3-70b-versatile$/, /^meta-llama\/llama-4-maverick/, /^openai\/gpt-oss-20b$/],
    allow: (id) => !/whisper|tts|guard|playai|orpheus|prompt-guard|compound/i.test(id),
    note: "Gratis laag met limieten per minuut en per dag, per model. Traint niet op je gegevens.",
    mayTrain: false,
  },
  {
    id: "cerebras",
    name: "Cerebras",
    envKey: "CEREBRAS_API_KEY",
    prefix: "cerebras/",
    modelsUrl: "https://api.cerebras.ai/v1/models",
    prefer: [/^gpt-oss-120b$/, /^qwen-3-235b/, /^zai-glm/, /^llama-3\.3-70b$/, /^qwen-3-32b$/],
    note: "Gratis laag met een dagelijks tokenlimiet; het aanbod aan modellen wisselt vaak.",
    mayTrain: false,
  },
  {
    id: "gemini",
    name: "Google AI Studio (Gemini)",
    envKey: "GEMINI_API_KEY",
    prefix: "gemini/",
    modelsUrl: "https://generativelanguage.googleapis.com/v1beta/openai/models",
    prefer: [/gemini-2\.5-flash$/, /gemini-flash-latest$/, /gemini-2\.0-flash$/, /gemini-[\d.]+-flash$/],
    note: "Gratis laag met limieten per minuut en per dag. In de EU/EER gelden de regels van de betaalde laag: Google gebruikt je gegevens dan niet om te trainen.",
    mayTrain: false,
  },
  {
    id: "mistral",
    name: "Mistral",
    envKey: "MISTRAL_API_KEY",
    prefix: "mistral/",
    modelsUrl: "https://api.mistral.ai/v1/models",
    prefer: [/^mistral-small-latest$/, /^mistral-medium-latest$/, /^open-mistral-nemo/],
    note: "Gratis Experiment-plan (telefoonverificatie). Mistral mag die gegevens voor training gebruiken, tenzij je dat in de console uitzet.",
    mayTrain: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter (gratis modellen)",
    envKey: "OPENROUTER_API_KEY",
    prefix: "openrouter/",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    prefer: [/^openai\/gpt-oss-120b:free$/, /^deepseek\/deepseek-(chat|v3).*:free$/, /^qwen\/qwen3-(235b|coder).*:free$/, /^meta-llama\/llama-3\.3-70b.*:free$/, /^deepseek\/deepseek-r1.*:free$/],
    allow: (id) => id.endsWith(":free"),
    note: "Ongeveer 50 verzoeken per dag zonder tegoed. Sommige gratis modellen bewaren of gebruiken je prompts: daarom als laatste in de rij.",
    mayTrain: true,
  },
];

/** De modelnaam waarmee agents en Graphify de router aanspreken. */
export const GRATIS_MODEL = "gratis";

/** Kies het beste model van een aanbieder uit wat er nu is. */
export function pickModels(provider: FreeProvider, available: string[], max = 2): string[] {
  const ids = available.map((id) => id.replace(/^models\//, "")).filter((id) => !provider.allow || provider.allow(id));
  const picked: string[] = [];
  for (const pattern of provider.prefer) {
    const hit = ids.find((id) => pattern.test(id) && !picked.includes(id));
    if (hit) picked.push(hit);
    if (picked.length >= max) break;
  }
  return picked;
}

export interface Selection {
  provider: FreeProvider;
  models: string[];
  error?: string;
}

/** Vraagt elke aanbieder met een sleutel welke modellen er zijn. */
export async function discover(
  keys: Record<string, string | undefined>,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<Selection[]> {
  const out: Selection[] = [];
  for (const provider of PROVIDERS) {
    const key = keys[provider.envKey];
    if (!key) continue;
    try {
      const res = await fetchImpl(provider.modelsUrl, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        out.push({ provider, models: [], error: res.status === 401 || res.status === 403 ? "sleutel ongeldig" : `gaf ${res.status}` });
        continue;
      }
      const body = (await res.json()) as { data?: Array<{ id: string }> };
      const models = pickModels(provider, (body.data ?? []).map((m) => m.id));
      out.push({ provider, models, ...(models.length ? {} : { error: "geen bruikbaar gratis model gevonden" }) });
    } catch (err) {
      out.push({ provider, models: [], error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

/** De LiteLLM-config: alle gekozen modellen onder één naam, in volgorde van voorkeur. */
export function buildConfig(selections: Selection[], opts: { generatedAt?: Date } = {}): string {
  const modelList: Array<{ model_name: string; litellm_params: Record<string, unknown> }> = [];
  let order = 1;
  for (const s of selections) {
    for (const model of s.models) {
      modelList.push({
        model_name: GRATIS_MODEL,
        litellm_params: { model: `${s.provider.prefix}${model}`, api_key: `os.environ/${s.provider.envKey}`, order: order++ },
      });
    }
  }
  const config = {
    model_list: modelList,
    router_settings: {
      // Na één fout (bv. 429: limiet op) een minuut rust voor dat model; de volgende in de rij neemt het over.
      num_retries: Math.max(1, Math.min(4, modelList.length - 1)),
      allowed_fails: 0,
      cooldown_time: 60,
    },
    litellm_settings: { drop_params: true, request_timeout: 180, telemetry: false },
    general_settings: { master_key: "os.environ/LITELLM_MASTER_KEY" },
  };
  const header = [
    `# Gratis AI-router (LiteLLM). Gemaakt door \`dist/main.js gratis-ai --schrijf\`${opts.generatedAt ? ` op ${opts.generatedAt.toISOString().slice(0, 10)}` : ""}.`,
    "# Niet met de hand aanpassen: zet sleutels in ~/.config/hq/gratis-ai.env en draai het commando opnieuw.",
    "",
  ].join("\n");
  return header + stringify(config, { lineWidth: 0 });
}

/** Een leesbare samenvatting voor in de terminal. */
export function describeSelections(selections: Selection[]): string {
  if (!selections.length) {
    return "Nog geen sleutels. Zet er minstens één in ~/.config/hq/gratis-ai.env (GROQ_API_KEY, CEREBRAS_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY of OPENROUTER_API_KEY).";
  }
  const lines: string[] = [];
  let order = 1;
  for (const s of selections) {
    if (s.error && !s.models.length) {
      lines.push(`✖ ${s.provider.name}: ${s.error}`);
      continue;
    }
    lines.push(`✔ ${s.provider.name}: ${s.models.map((m) => `${order++}. ${m}`).join(", ")}${s.provider.mayTrain ? "  (⚠️ kan je gegevens gebruiken voor training)" : ""}`);
    lines.push(`   ${s.provider.note}`);
  }
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

/**
 * Omgeving voor een agent die op de gratis router draait (Claude Code praat dan met LiteLLM in plaats van
 * met Anthropic). Het contextvenster is kleiner dan bij Claude, dus Claude Code moet eerder samenvatten.
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
