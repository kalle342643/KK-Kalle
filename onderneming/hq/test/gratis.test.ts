import { describe, expect, it } from "vitest";
import {
  describePlan,
  OmniRouteClient,
  pickModels,
  planGratis,
  PROVIDERS,
  setEnvLine,
  syncGratis,
  parseEnvFile,
  type Connection,
  type OmniApi,
} from "../src/ai/gratis.js";
import { AgentFactory } from "../src/company/factory.js";
import { loadCompany } from "../src/company/loader.js";
import { testConfig } from "../src/config.js";
import type { AppContext } from "../src/domain/context.js";
import { graphifyRuntime, semanticExtractionEnabled } from "../src/knowledge/graphify.js";

const provider = (id: string) => PROVIDERS.find((p) => p.id === id)!;

/** Modellen zoals OmniRoute 3.8 ze per aanbieder in zijn catalogus heeft. */
const CATALOG: Record<string, string[]> = {
  groq: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.6-27b", "qwen/qwen3.8-27b", "openai/gpt-oss-safeguard-20b", "whisper-large-v3"],
  sambanova: ["Meta-Llama-3.3-70B-Instruct", "DeepSeek-V3.2", "DeepSeek-V4-Flash", "gpt-oss-120b"],
  gemini: ["gemini-3.7-flash", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-3.1-flash-tts-preview", "gemini-embedding-2"],
  // Het echte gratis aanbod van OpenRouter op 25 september 2026, plus twee betaalde modellen.
  openrouter: [
    "openai/gpt-6-luna",
    "liquid/lfm-2.5-2.6b:free",
    "nvidia/nemotron-3.5-content-safety:free",
    "qwen/qwen3.8-27b:free",
    "stealth/space-bunny-alpha",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "moonshotai/kimi-k2.6",
    "thinkingmachines/inkling:free",
    "google/gemma-4-31b-it:free",
  ],
};

/** Nep-OmniRoute: onthoudt wat HQ erin zet. */
class FakeOmni implements OmniApi {
  loggedIn = false;
  conns: Connection[] = [];
  combosList: Array<{ id: string; name: string; models: string[] }> = [];
  keysList: Array<{ id: string; name: string; key: string; patch?: Record<string, unknown> }> = [];
  apiKeys = new Map<string, string>();
  async login() {
    this.loggedIn = true;
  }
  async connections() {
    return this.conns.map((c) => ({ ...c }));
  }
  async addConnection(provider: string, name: string, apiKey: string) {
    const id = `c-${provider}`;
    this.conns.push({ id, provider, name, isActive: true, authType: "apikey" });
    this.apiKeys.set(id, apiKey);
  }
  async updateConnection(id: string, apiKey: string) {
    this.apiKeys.set(id, apiKey);
  }
  async models(connectionId: string) {
    return CATALOG[this.conns.find((c) => c.id === connectionId)!.provider] ?? [];
  }
  async combos() {
    return this.combosList;
  }
  async saveCombo(id: string | null, name: string, models: string[]) {
    if (id) this.combosList = this.combosList.map((c) => (c.id === id ? { id, name, models } : c));
    else this.combosList.push({ id: `combo-${this.combosList.length + 1}`, name, models });
  }
  async keys() {
    return this.keysList;
  }
  async createKey(name: string) {
    const k = { id: `k${this.keysList.length + 1}`, name, key: `sk-omni-${this.keysList.length + 1}` };
    this.keysList.push(k);
    return { id: k.id, key: k.key };
  }
  async updateKey(id: string, patch: Record<string, unknown>) {
    this.keysList.find((k) => k.id === id)!.patch = patch;
  }
  async keyWorks(key: string) {
    return this.keysList.some((k) => k.key === key);
  }
}

describe("gratis AI: modellen kiezen", () => {
  it("pakt de beste modellen die er nu zijn, en slaat spraak, embeddings en filters over", () => {
    // Llama staat nog in de lijst, maar ging in augustus 2026 van de gratis laag af.
    expect(pickModels(provider("groq"), CATALOG.groq!)).toEqual(["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "qwen/qwen3.6-27b"]);
    expect(pickModels(provider("gemini"), CATALOG.gemini!)).toEqual(["gemini-3.7-flash", "gemini-2.5-flash", "gemini-3.1-flash-lite"]);
    expect(pickModels(provider("sambanova"), CATALOG.sambanova!, 2)).toEqual(["DeepSeek-V4-Flash", "DeepSeek-V3.2"]);
  });

  it("bij OpenRouter alleen grote gratis modellen die met tools werken, geen piepkleine of filters", () => {
    expect(pickModels(provider("openrouter"), CATALOG.openrouter!)).toEqual(["thinkingmachines/inkling:free", "nvidia/nemotron-3-ultra-550b-a55b:free", "qwen/qwen3.8-27b:free"]);
    expect(pickModels(provider("openrouter"), ["liquid/lfm-2.5-2.6b:free", "nvidia/nemotron-3.5-content-safety:free", "stealth/space-bunny-alpha", "moonshotai/kimi-k2.6"])).toEqual([]);
  });

  it("aanbieders zonder echte gratis laag staan er niet in", () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(["groq", "sambanova", "gemini", "huggingface", "mistral", "openrouter"]);
  });
});

describe("gratis AI: OmniRoute inrichten", () => {
  it("zet jouw sleutels erin, maakt de combo in vaste volgorde en een eigen sleutel voor de agents", async () => {
    const omni = new FakeOmni();
    const res = await syncGratis(omni, { GROQ_API_KEY: "gsk_1", GEMINI_API_KEY: "g_2", OPENROUTER_API_KEY: "sk-or-3", ONBEKEND_API_KEY: "x" });
    expect(omni.loggedIn).toBe(true);
    expect(res.added).toEqual(["Groq", "Google AI Studio (Gemini)", "OpenRouter (gratis modellen)"]);
    expect(omni.apiKeys.get("c-groq")).toBe("gsk_1");
    expect(omni.combosList).toEqual([
      {
        id: "combo-1",
        name: "gratis",
        models: [
          "groq/openai/gpt-oss-120b",
          "groq/qwen/qwen3.8-27b",
          "groq/qwen/qwen3.6-27b",
          "gemini/gemini-3.7-flash",
          "gemini/gemini-2.5-flash",
          "gemini/gemini-3.1-flash-lite",
          // OpenRouter achteraan en met hooguit twee: de limiet geldt daar per account, niet per model.
          "openrouter/thinkingmachines/inkling:free",
          "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
        ],
      },
    ]);
    // Een eigen sleutel: geen prompts bewaren, en niets aan de tekst veranderen.
    expect(res.newKey).toBe("sk-omni-1");
    expect(omni.keysList[0]).toMatchObject({ name: "hq-agents", patch: { compressionEnabled: false, noLog: true } });
    expect(describePlan(res.plan)).toContain('Combo "gratis": 8 modellen');
  });

  it("tweede keer: sleutels bijwerken, combo vervangen, en de werkende sleutel houden", async () => {
    const omni = new FakeOmni();
    const first = await syncGratis(omni, { GROQ_API_KEY: "gsk_1" });
    const second = await syncGratis(omni, { GROQ_API_KEY: "gsk_nieuw", SAMBANOVA_API_KEY: "s_1", CEREBRAS_API_KEY: "c_1" }, { hqKey: first.newKey! });
    // Cerebras heeft geen gratis laag meer: die sleutel laat HQ liggen.
    expect(second).toMatchObject({ added: ["SambaNova"], updated: ["Groq"], newKey: null });
    expect(omni.apiKeys.get("c-groq")).toBe("gsk_nieuw");
    expect(omni.combosList).toHaveLength(1);
    expect(omni.combosList[0]!.models.slice(3)).toEqual(["sambanova/DeepSeek-V4-Flash", "sambanova/DeepSeek-V3.2", "sambanova/gpt-oss-120b"]);
    // Klopt de sleutel in hq.env niet meer, dan komt er een nieuwe.
    expect((await syncGratis(omni, {}, { hqKey: "sk-weg" })).newKey).toBe("sk-omni-2");
  });

  it("abonnementen, webchats en onbekende aanbieders komen nooit in de combo", async () => {
    const omni = new FakeOmni();
    omni.conns = [
      { id: "a", provider: "claude", name: "Claude (abonnement)", isActive: true, authType: "oauth" },
      { id: "b", provider: "chatgpt-web", name: "ChatGPT web", isActive: true, authType: "cookie" },
      { id: "c", provider: "free-ai", name: "Free AI", isActive: true, authType: "apikey" },
      { id: "d", provider: "groq", name: "Groq", isActive: true, authType: "apikey" },
    ];
    const plan = await planGratis(omni, omni.conns);
    expect(plan.combo.every((m) => m.startsWith("groq/"))).toBe(true);
    expect(plan.skipped.map((s) => [s.name, s.reason.split(":")[0]])).toEqual([
      ["Claude (abonnement)", "gekoppeld via een login of abonnement"],
      ["ChatGPT web", "gekoppeld via een login of abonnement"],
      ["Free AI", "staat niet op de lijst van bekende aanbieders met een officiële gratis laag"],
    ]);
  });
});

describe("gratis AI: de OmniRoute-client", () => {
  it("logt in met het wachtwoord en stuurt daarna de sessie mee", async () => {
    const seen: Array<{ url: string; cookie: string | null }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({ url, cookie: headers.get("cookie") });
      if (url.endsWith("/api/auth/login")) {
        if (JSON.parse(String(init?.body)).password !== "goed") return new Response('{"error":"Invalid password"}', { status: 401 });
        return new Response('{"success":true}', { status: 200, headers: { "set-cookie": "auth_token=abc; Path=/; HttpOnly" } });
      }
      return Response.json({ connections: [{ id: "1", provider: "groq", name: "Groq", isActive: true, authType: "apikey" }] });
    }) as typeof fetch;
    await expect(new OmniRouteClient("http://omni", "fout", fetchImpl).login()).rejects.toThrow(/OMNIROUTE_PASSWORD/);
    const api = new OmniRouteClient("http://omni", "goed", fetchImpl);
    await api.login();
    expect(await api.connections()).toHaveLength(1);
    expect(seen.at(-1)).toEqual({ url: "http://omni/api/providers", cookie: "auth_token=abc" });
  });

  it("zet de sleutel in hq.env zonder de rest aan te raken", () => {
    expect(setEnvLine("A=1\nHQ_GRATIS_AI_KEY=oud\nB=2\n", "HQ_GRATIS_AI_KEY", "nieuw")).toBe("A=1\nHQ_GRATIS_AI_KEY=nieuw\nB=2\n");
    expect(setEnvLine("A=1", "HQ_GRATIS_AI_KEY", "nieuw")).toBe("A=1\nHQ_GRATIS_AI_KEY=nieuw\n");
    expect(parseEnvFile("# gratis AI\nGROQ_API_KEY=gsk_1\n\nGEMINI_API_KEY=\"g2\"\nLEEG=\n  HF_TOKEN = h3 \n")).toEqual({ GROQ_API_KEY: "gsk_1", GEMINI_API_KEY: "g2", HF_TOKEN: "h3" });
  });
});

describe("gratis AI voor agents en Graphify", () => {
  const withGratis = testConfig({
    gratisAi: { url: "http://127.0.0.1:20128", key: "sk-router", roles: ["verkenner"], contextTokens: 64000, perProvider: 3, envFile: "/x", hqEnvFile: "/y" },
  });
  const ctx = { config: withGratis } as AppContext;
  const factory = new AgentFactory(loadCompany(), "http://127.0.0.1:8080");

  it("een verkenner draait via OmniRoute, een bouwer gewoon op Claude", () => {
    const scout = factory.buildHire(ctx, factory.agentTemplate("verkenner"), { name: "Rigel", branch: null, reportsTo: null });
    expect(scout.adapterConfig).toMatchObject({
      model: "gratis",
      env: { HQ_URL: "http://127.0.0.1:8080", ANTHROPIC_BASE_URL: "http://127.0.0.1:20128", ANTHROPIC_AUTH_TOKEN: "sk-router", ANTHROPIC_DEFAULT_HAIKU_MODEL: "gratis", CLAUDE_CODE_MAX_CONTEXT_TOKENS: "64000" },
    });
    const builder = factory.buildHire(ctx, factory.agentTemplate("bouwer"), { name: "Pollux", branch: null, reportsTo: null });
    expect(builder.adapterConfig).toMatchObject({ model: "claude-sonnet-5" });
    expect((builder.adapterConfig as { env: Record<string, string> }).env.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it("zonder sleutel draait niemand op gratis AI", () => {
    const off = { config: testConfig({ gratisAi: { ...withGratis.gratisAi, key: undefined } }) } as AppContext;
    const scout = factory.buildHire(off, factory.agentTemplate("verkenner"), { name: "Rigel", branch: null, reportsTo: null });
    expect(scout.adapterConfig).toMatchObject({ model: "claude-haiku-4-5" });
  });

  it("Graphify bouwt de kennisgraaf via OmniRoute met GRAPHIFY_BACKEND=gratis", () => {
    const cfg = testConfig({ gratisAi: withGratis.gratisAi, knowledge: { ...withGratis.knowledge, vaultDir: "/v", graphifyBackend: "gratis", graphifyApiKey: undefined } });
    expect(semanticExtractionEnabled(cfg)).toBe(true);
    expect(graphifyRuntime(cfg)).toMatchObject({ backend: "openai", model: "gratis", env: { OPENAI_BASE_URL: "http://127.0.0.1:20128/v1", OPENAI_API_KEY: "sk-router", OPENAI_MODEL: "gratis" } });
    const none = testConfig({ knowledge: { ...cfg.knowledge, graphifyBackend: "claude" } });
    expect(semanticExtractionEnabled(none)).toBe(false);
    expect(graphifyRuntime(none)).toBeNull();
  });
});
