import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { buildConfig, describeSelections, discover, parseEnvFile, pickModels, PROVIDERS } from "../src/ai/gratis.js";
import { AgentFactory } from "../src/company/factory.js";
import { loadCompany } from "../src/company/loader.js";
import { testConfig } from "../src/config.js";
import type { AppContext } from "../src/domain/context.js";
import { graphifyRuntime, semanticExtractionEnabled } from "../src/knowledge/graphify.js";

const provider = (id: string) => PROVIDERS.find((p) => p.id === id)!;

describe("gratis AI: modellen kiezen", () => {
  it("pakt het beste model dat er nu is, en slaat spraak en beveiligingsmodellen over", () => {
    expect(pickModels(provider("groq"), ["whisper-large-v3", "llama-3.1-8b-instant", "llama-3.3-70b-versatile", "openai/gpt-oss-120b", "meta-llama/llama-guard-4-12b"])).toEqual([
      "openai/gpt-oss-120b",
      "llama-3.3-70b-versatile",
    ]);
    expect(pickModels(provider("gemini"), ["models/gemini-2.0-flash", "models/gemini-2.5-flash", "models/gemini-2.5-pro"])).toEqual(["gemini-2.5-flash", "gemini-2.0-flash"]);
  });

  it("bij OpenRouter alleen de gratis modellen", () => {
    expect(pickModels(provider("openrouter"), ["openai/gpt-oss-120b", "deepseek/deepseek-chat-v3.1:free", "anthropic/claude-sonnet-5"])).toEqual(["deepseek/deepseek-chat-v3.1:free"]);
  });

  it("vraagt alleen aanbieders met een sleutel, en zegt het als een sleutel niet werkt", async () => {
    const asked: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      asked.push(url);
      expect((init?.headers as Record<string, string>).authorization).toMatch(/^Bearer /);
      if (url.includes("googleapis")) return new Response("{}", { status: 401 });
      if (url.includes("groq")) return Response.json({ data: [{ id: "llama-3.3-70b-versatile" }, { id: "openai/gpt-oss-120b" }] });
      return Response.json({ data: [{ id: "qwen/qwen3-235b-a22b:free" }] });
    };
    const found = await discover({ GROQ_API_KEY: "gsk_x", GEMINI_API_KEY: "fout", OPENROUTER_API_KEY: "sk-or-x" }, fetchImpl as typeof fetch);
    expect(asked).toHaveLength(3);
    expect(found.map((s) => [s.provider.id, s.models, s.error ?? null])).toEqual([
      ["groq", ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"], null],
      ["gemini", [], "sleutel ongeldig"],
      ["openrouter", ["qwen/qwen3-235b-a22b:free"], null],
    ]);
    const text = describeSelections(found);
    expect(text).toContain("1. openai/gpt-oss-120b, 2. llama-3.3-70b-versatile");
    expect(text).toContain("✖ Google AI Studio (Gemini): sleutel ongeldig");
    expect(text).toContain("kan je gegevens gebruiken voor training");
  });
});

describe("gratis AI: de routerconfig", () => {
  it("alle modellen onder één naam, in volgorde, en nooit een sleutel in het bestand", () => {
    const yaml = buildConfig([
      { provider: provider("groq"), models: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"] },
      { provider: provider("cerebras"), models: ["gpt-oss-120b"] },
      { provider: provider("gemini"), models: [], error: "sleutel ongeldig" },
    ]);
    const cfg = parse(yaml) as { model_list: Array<{ model_name: string; litellm_params: Record<string, unknown> }>; router_settings: Record<string, number>; general_settings: Record<string, string> };
    expect(cfg.model_list.map((m) => [m.model_name, m.litellm_params.model, m.litellm_params.order, m.litellm_params.api_key])).toEqual([
      ["gratis", "groq/openai/gpt-oss-120b", 1, "os.environ/GROQ_API_KEY"],
      ["gratis", "groq/llama-3.3-70b-versatile", 2, "os.environ/GROQ_API_KEY"],
      ["gratis", "cerebras/gpt-oss-120b", 3, "os.environ/CEREBRAS_API_KEY"],
    ]);
    expect(cfg.router_settings).toMatchObject({ allowed_fails: 0, cooldown_time: 60, num_retries: 2 });
    expect(cfg.general_settings.master_key).toBe("os.environ/LITELLM_MASTER_KEY");
    expect(yaml).not.toMatch(/gsk_|sk-or-|sk-[a-z0-9]{10}/i);
  });

  it("leest het sleutelbestand zoals systemd dat doet", () => {
    expect(parseEnvFile("# gratis AI\nGROQ_API_KEY=gsk_1\n\nGEMINI_API_KEY=\"g2\"\nLEEG=\n  CEREBRAS_API_KEY = c3 \n")).toEqual({ GROQ_API_KEY: "gsk_1", GEMINI_API_KEY: "g2", CEREBRAS_API_KEY: "c3" });
  });
});

describe("gratis AI voor agents en Graphify", () => {
  const withGratis = testConfig({
    gratisAi: { url: "http://127.0.0.1:4000", key: "sk-router", roles: ["verkenner"], contextTokens: 64000, envFile: "/x", configFile: "/y" },
  });
  const ctx = { config: withGratis } as AppContext;
  const factory = new AgentFactory(loadCompany(), "http://127.0.0.1:8080");

  it("een verkenner draait op de router, een bouwer gewoon op Claude", () => {
    const scout = factory.buildHire(ctx, factory.agentTemplate("verkenner"), { name: "Rigel", branch: null, reportsTo: null });
    expect(scout.adapterConfig).toMatchObject({
      model: "gratis",
      env: { HQ_URL: "http://127.0.0.1:8080", ANTHROPIC_BASE_URL: "http://127.0.0.1:4000", ANTHROPIC_AUTH_TOKEN: "sk-router", ANTHROPIC_DEFAULT_HAIKU_MODEL: "gratis", CLAUDE_CODE_MAX_CONTEXT_TOKENS: "64000" },
    });
    const builder = factory.buildHire(ctx, factory.agentTemplate("bouwer"), { name: "Pollux", branch: null, reportsTo: null });
    expect(builder.adapterConfig).toMatchObject({ model: "claude-sonnet-5" });
    expect((builder.adapterConfig as { env: Record<string, string> }).env.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it("zonder routersleutel draait niemand op gratis AI", () => {
    const off = { config: testConfig({ gratisAi: { ...withGratis.gratisAi, key: undefined } }) } as AppContext;
    const scout = factory.buildHire(off, factory.agentTemplate("verkenner"), { name: "Rigel", branch: null, reportsTo: null });
    expect(scout.adapterConfig).toMatchObject({ model: "claude-haiku-4-5" });
  });

  it("Graphify bouwt de kennisgraaf via de router met GRAPHIFY_BACKEND=gratis", () => {
    const cfg = testConfig({ gratisAi: withGratis.gratisAi, knowledge: { ...withGratis.knowledge, vaultDir: "/v", graphifyBackend: "gratis", graphifyApiKey: undefined } });
    expect(semanticExtractionEnabled(cfg)).toBe(true);
    expect(graphifyRuntime(cfg)).toMatchObject({ backend: "openai", model: "gratis", env: { OPENAI_BASE_URL: "http://127.0.0.1:4000/v1", OPENAI_API_KEY: "sk-router", OPENAI_MODEL: "gratis" } });
    const none = testConfig({ knowledge: { ...cfg.knowledge, graphifyBackend: "claude" } });
    expect(semanticExtractionEnabled(none)).toBe(false);
    expect(graphifyRuntime(none)).toBeNull();
  });
});
