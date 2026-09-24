import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyCommand, newRunLogState, readRunLogChunk, shortUrl, toolSummary, toolText } from "../src/office/runlog.js";
import { PaperclipWatcher } from "../src/office/watcher.js";
import { createTestEnv, type TestEnv } from "./helpers/context.js";

/** Een logregel zoals Paperclip hem opslaat. */
const rec = (chunk: string, stream = "stdout") => `${JSON.stringify({ ts: "2026-09-23T10:00:00Z", stream, chunk })}\n`;
const acp = (name: string, input: unknown, tag = "tool_call") => `${JSON.stringify({ type: "acpx.tool_call", name, toolCallId: "t1", status: "pending", tag, input })}\n`;

describe("wat een agent doet, uit het logboek van zijn run", () => {
  it("herkent zoeken, lezen, trends, de kennisgraaf en code (ACP-engine)", () => {
    const state = newRunLogState();
    const log =
      rec(acp('"browser puzzle games 2026"', { query: "browser puzzle games 2026" })) +
      rec(acp("Fetch https://www.crazygames.com/t/puzzle?utm=x", { url: "https://www.crazygames.com/t/puzzle?utm=x", prompt: "..." })) +
      rec(acp("Fetch https://www.crazygames.com/t/puzzle", { url: "https://www.crazygames.com/t/puzzle" }, "tool_call_update")) +
      rec(acp("hq-web https://poki.com/en/puzzle --diep 3", { command: "hq-web https://poki.com/en/puzzle --diep 3" })) +
      rec(acp("Terminal", { command: 'hq-trends "cookie consent scanner" --dagen 14' })) +
      rec(acp("Terminal", { command: 'hq-graaf pad "Fluxgrid" "mobiel"' })) +
      rec(acp("Terminal", { command: "npm test" })) +
      rec(acp("Terminal", { command: 'hq kennis "retentie"' })) +
      rec(acp("Edit src/levels/loader.ts", { file_path: "/work/src/levels/loader.ts", old_string: "a", new_string: "b" })) +
      rec(acp("Read src/main.ts", { file_path: "/work/src/main.ts" })) +
      rec(JSON.stringify({ type: "acpx.text_delta", text: "Ik zoek nu" }) + "\n");
    const uses = readRunLogChunk(state, log);
    expect(uses).toEqual([
      { kind: "search", detail: "browser puzzle games 2026" },
      { kind: "fetch", detail: "crazygames.com/t/puzzle" },
      { kind: "crawl", detail: "poki.com/en/puzzle" },
      { kind: "trends", detail: "cookie consent scanner" },
      { kind: "graph", detail: "pad Fluxgrid" },
      { kind: "code", detail: "loader.ts" },
    ]);
    expect(state.offset).toBe(Buffer.byteLength(log));
    expect(toolSummary(state.counts)).toBe("1× gezocht, 2 pagina's gelezen, 1× trends, 1× kennisgraaf, 1 bestand bewerkt");
  });

  it("stream-json van de CLI mag midden in een regel knippen, en een pagina midden in een record", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Even zoeken" }, { type: "tool_use", name: "WebSearch", input: { query: "idle games mobiel" } }, { type: "tool_use", name: "WebFetch", input: { url: "https://example.org/a" } }] },
    });
    const full = rec(line.slice(0, 40)) + rec(`${line.slice(40)}\n`) + rec(JSON.stringify({ type: "result" }) + "\n");
    const state = newRunLogState();
    const cut = Buffer.from(full).subarray(0, Buffer.byteLength(rec(line.slice(0, 40))) + 25).toString("utf8");
    expect(readRunLogChunk(state, cut)).toEqual([]);
    const rest = Buffer.from(full).subarray(state.offset).toString("utf8");
    expect(readRunLogChunk(state, rest)).toEqual([
      { kind: "search", detail: "idle games mobiel" },
      { kind: "fetch", detail: "example.org/a" },
    ]);
    expect(state.offset).toBe(Buffer.byteLength(full));
  });

  it("negeert stderr, interne adressen en gewone shell-commando's", () => {
    const state = newRunLogState();
    expect(readRunLogChunk(state, rec(acp("x", { query: "geheim" }), "stderr"))).toEqual([]);
    expect(classifyCommand('curl -sS "$HQ_URL/api/agent/overview"')).toBeNull();
    expect(classifyCommand("curl -s http://127.0.0.1:8080/api/agent/me")).toBeNull();
    expect(classifyCommand("curl -sL https://api.github.com/repos/x/y | jq .")).toEqual({ kind: "fetch", detail: "api.github.com/repos/x/y" });
    expect(classifyCommand("ls -la")).toBeNull();
    expect(shortUrl("https://www.example.com/")).toBe("example.com");
    expect(toolText({ kind: "search", detail: "abc" })).toBe("🔎 zoekt: abc");
  });
});

describe("de watcher laat het in het kantoor zien", () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await createTestEnv();
  });
  afterEach(async () => {
    await env.close();
  });

  it("toont web-stappen tijdens de run (niet elke zoekopdracht) en telt ze op aan het eind", async () => {
    env.paperclip.runs.set("run-web", { id: "run-web", status: "running", agentId: env.scout.id, startedAt: "2026-09-23T09:59:00Z", contextSnapshot: {} });
    env.paperclip.appendRunLog("run-web", "stdout", acp('"puzzel trends"', { query: "puzzel trends" }));
    env.paperclip.appendRunLog("run-web", "stdout", acp('"puzzel trends mobiel"', { query: "puzzel trends mobiel" }));
    env.paperclip.appendRunLog("run-web", "stdout", acp("Fetch https://www.crazygames.com/t/puzzle", { url: "https://www.crazygames.com/t/puzzle" }));
    const watcher = new PaperclipWatcher(env.ctx);
    await watcher.tick();

    const tools = (await env.ctx.events.recent(20)).filter((e) => e.type === "agent.tool");
    expect(tools.map((e) => e.text).sort()).toEqual(["🌐 leest: crazygames.com/t/puzzle", "🔎 zoekt: puzzel trends"]);
    expect(tools[0]).toMatchObject({ agentId: env.scout.id, data: { runId: "run-web" } });

    // Meer logboek na de eerste ronde: alleen het nieuwe stuk wordt gelezen.
    env.paperclip.appendRunLog("run-web", "stdout", acp("Terminal", { command: 'hq-trends "puzzel"' }));
    env.paperclip.runs.get("run-web")!.status = "succeeded";
    await watcher.tick();
    const finished = (await env.ctx.events.recent(20)).find((e) => e.type === "run.finished")!;
    expect(finished.data).toMatchObject({ tools: "2× gezocht, 1 pagina gelezen, 1× trends", toolCounts: { search: 2, fetch: 1, trends: 1 } });
    expect((await env.ctx.events.recent(30)).filter((e) => e.type === "agent.tool")).toHaveLength(3);
  });
});
