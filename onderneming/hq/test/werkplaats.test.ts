import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/api/app.js";
import { parseBacklog } from "../src/code/backlog.js";
import { GitHubClient, GitHubError, parseCommitMessage, type GitHubApi } from "../src/code/github.js";
import { codeOverview, codeReportLines } from "../src/code/overview.js";
import { getCodeProject, saveCodeProject } from "../src/code/projects.js";
import { findHealthUrl, followNewRepos, siteUrl } from "../src/code/follow.js";
import { CodeWatcher } from "../src/code/watch.js";
import { buildOfficeSnapshot } from "../src/office/snapshot.js";
import { createTestEnv, type TestEnv } from "./helpers/context.js";

const REPO = "demo-holding/scanner";
const MAIN = "claude/nieuwe-opslag-x1y2z3";
const SESSION = "session_01DemoSessieVoorDeTest0";

/** Nep-GitHub: per pad een antwoord (of een fout), en een lijst van wat er gevraagd werd. */
class FakeGitHub implements GitHubApi {
  routes = new Map<string, unknown>();
  calls: string[] = [];
  set(path: string, value: unknown) {
    this.routes.set(path, value);
    return this;
  }
  async get<T>(path: string): Promise<T> {
    this.calls.push(path);
    const key = [...this.routes.keys()].find((k) => path === k || (k.endsWith("*") && path.startsWith(k.slice(0, -1))));
    if (key === undefined) throw new GitHubError(404, path, "Niet gevonden, of het token heeft geen toegang tot deze repository.");
    const v = this.routes.get(key);
    if (v instanceof GitHubError) throw v;
    return structuredClone(v) as T;
  }
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const BACKLOG = `# Backlog

## Voor de eerste betaling — dit ligt bij Kalle

- **Inschrijven bij de KvK.** Zet \`SCANNER_KVK\` in Vercel.
- **Vercel naar Pro.** Hobby is alleen voor niet-commercieel gebruik.
- [x] **Supabase-project aanmaken.** Klaar.

## Product

- **Cookiemuren.** De scan meldt de muur,
  maar scant alleen die muur.
`;

const commit = (sha: string, title: string, at: string, session = true) => ({
  sha,
  html_url: `https://github.com/${REPO}/commit/${sha}`,
  commit: {
    message: `${title}\n\nUitleg.\n\nCo-Authored-By: Claude <noreply@anthropic.com>${session ? `\nClaude-Session: https://claude.ai/code/${SESSION}` : ""}`,
    author: { date: at },
    committer: { date: at },
  },
});

function scannerOnGitHub(gh: FakeGitHub) {
  gh.set(`/repos/${REPO}`, { default_branch: MAIN, html_url: `https://github.com/${REPO}`, size: 900, pushed_at: "2026-09-23T09:00:00Z" })
    .set(`/repos/${REPO}/branches?per_page=100`, [
      { name: MAIN, commit: { sha: "aaa1" } },
      { name: "experiment-oud", commit: { sha: "zzz9" } },
    ])
    .set(`/repos/${REPO}/commits?sha=${encodeURIComponent(MAIN)}*`, [commit("aaa1", "Zeg waarom een pagina niet open ging", "2026-09-23T09:30:00Z")])
    .set(`/repos/${REPO}/pulls?state=open&per_page=30`, [])
    .set(`/repos/${REPO}/actions/runs?head_sha=aaa1&per_page=20`, { workflow_runs: [{ status: "completed", conclusion: "success", html_url: "https://ci/1", updated_at: "2026-09-23T09:05:00Z" }] })
    .set(`/repos/${REPO}/commits/aaa1/status`, { state: "success", total_count: 1, statuses: [{ state: "success", target_url: "https://vercel.com/x", context: "Vercel", updated_at: "2026-09-23T09:04:00Z" }] })
    .set(`/repos/${REPO}/deployments?per_page=10`, [{ id: 11, sha: "aaa1", environment: "Production", production_environment: true, created_at: "2026-09-23T09:01:00Z" }])
    .set(`/repos/${REPO}/deployments/11/statuses?per_page=1`, [{ state: "success", environment_url: "https://scanner.example", created_at: "2026-09-23T09:03:00Z" }])
    .set(`/repos/${REPO}/contents/BACKLOG.md?ref=${encodeURIComponent(MAIN)}`, { sha: "bl1", encoding: "base64", content: b64(BACKLOG) });
}

let env: TestEnv;
let gh: FakeGitHub;
beforeEach(async () => {
  env = await createTestEnv();
  gh = new FakeGitHub();
});
afterEach(async () => {
  await env.close();
});

const addScanner = () =>
  saveCodeProject(env.ctx, { name: "Scanner", repo: REPO, url: "https://scanner.example", healthUrl: "https://scanner.example/api/gezondheid", branch: "saas" }, "owner");
/** Gebeurtenissen van één soort, oudste eerst. */
const events = async (type: string) => (await env.ctx.events.recent(100)).filter((e) => e.type === type);

describe("backlog lezen", () => {
  it("haalt de punten eruit en weet wat bij jou ligt", () => {
    const items = parseBacklog(BACKLOG, ["Kalle"]);
    expect(items.map((i) => [i.title, i.owner])).toEqual([
      ["Inschrijven bij de KvK", true],
      ["Vercel naar Pro", true],
      ["Cookiemuren", false],
    ]);
    expect(items[0]!.text).toBe("Zet SCANNER_KVK in Vercel.");
    expect(items[2]!.text).toBe("De scan meldt de muur, maar scant alleen die muur.");
  });

  it("herkent ook 'voor jou', (u) en je naam in een punt, en losse zinnen", () => {
    const items = parseBacklog("## Techniek\n- Kalle zet de DNS goed. Daarna testen.\n- Logs opschonen\n\n## Voor jou\n- Domein kopen\n", ["Kalle"]);
    expect(items.map((i) => [i.title, i.owner])).toEqual([
      ["Kalle zet de DNS goed", true],
      ["Logs opschonen", false],
      ["Domein kopen", true],
    ]);
  });
});

describe("commitberichten", () => {
  it("vindt de Claude Code-sessie onder een commit", () => {
    expect(parseCommitMessage(`Titel\n\nClaude-Session: https://claude.ai/code/${SESSION}`)).toEqual({
      title: "Titel",
      sessionUrl: `https://claude.ai/code/${SESSION}`,
      sessionId: SESSION,
    });
    expect(parseCommitMessage("Gewoon een commit").sessionId).toBeNull();
  });
});

describe("de werkplaats volgt een project op GitHub", () => {
  it("eerste keer: alles in beeld (sessie, tests, live, backlog), maar geen stortvloed aan meldingen", async () => {
    await addScanner();
    scannerOnGitHub(gh);
    const watcher = new CodeWatcher(env.ctx, gh);
    await watcher.pollProject((await getCodeProject(env.db, "scanner"))!);

    const { projects, sessions } = await codeOverview(env.ctx);
    expect(projects[0]).toMatchObject({
      key: "scanner",
      name: "Scanner",
      defaultBranch: MAIN,
      empty: false,
      error: null,
      ci: { state: "passed" },
      deploy: { state: "success", url: "https://scanner.example", environment: "Production" },
      lastCommit: { sha: "aaa1", title: "Zeg waarom een pagina niet open ging", session: `https://claude.ai/code/${SESSION}` },
      backlog: { ownerCount: 2, totalCount: 3 },
      activeSessions: 1,
    });
    expect(projects[0]!.backlog!.items[0]).toMatchObject({ title: "Inschrijven bij de KvK", owner: true });
    expect(sessions).toEqual([
      expect.objectContaining({ id: SESSION, actorId: `cc:${SESSION}`, projectKey: "scanner", url: `https://claude.ai/code/${SESSION}`, branch: MAIN, commits: 1, state: "working" }),
    ]);
    // Branches die niet van Claude of een PR zijn, volgen we niet.
    expect(gh.calls.some((c) => c.includes("experiment-oud"))).toBe(false);
    expect(await events("code.commit")).toEqual([]);
  });

  it("daarna: nieuwe commits, een pull request, rode tests en samenvoegen worden gebeurtenissen", async () => {
    await addScanner();
    scannerOnGitHub(gh);
    const watcher = new CodeWatcher(env.ctx, gh);
    await watcher.pollProject((await getCodeProject(env.db, "scanner"))!);

    // Claude Code werkt verder op een eigen branch en opent een PR; de tests daarop falen.
    gh.set(`/repos/${REPO}/branches?per_page=100`, [
      { name: MAIN, commit: { sha: "aaa1" } },
      { name: "claude/fix-scan-x1", commit: { sha: "bbb2" } },
    ])
      .set(`/repos/${REPO}/commits?sha=${encodeURIComponent("claude/fix-scan-x1")}*`, [commit("bbb2", "Scan: foutcode tonen", "2026-09-23T09:30:00Z")])
      .set(`/repos/${REPO}/pulls?state=open&per_page=30`, [
        { number: 7, title: "Scan: foutcode tonen", html_url: `https://github.com/${REPO}/pull/7`, draft: true, updated_at: "2026-09-23T09:31:00Z", state: "open", head: { ref: "claude/fix-scan-x1", sha: "bbb2" } },
      ])
      .set(`/repos/${REPO}/actions/runs?head_sha=bbb2&per_page=20`, { workflow_runs: [{ status: "completed", conclusion: "failure", html_url: "https://ci/2", updated_at: "2026-09-23T09:33:00Z" }] })
      .set(`/repos/${REPO}/commits/bbb2/status`, { state: "pending", total_count: 0, statuses: [] });
    await watcher.pollProject((await getCodeProject(env.db, "scanner"))!);

    const [c] = await events("code.commit");
    expect(c).toMatchObject({ agentId: `cc:${SESSION}`, text: "Scan: foutcode tonen", data: { project: "scanner", branch: "claude/fix-scan-x1" } });
    expect(await events("code.pr")).toEqual([expect.objectContaining({ text: "PR #7: Scan: foutcode tonen", data: expect.objectContaining({ action: "opened" }) })]);
    let overview = await codeOverview(env.ctx);
    expect(overview.projects[0]!.openPrs).toEqual([expect.objectContaining({ number: 7, draft: true, ci: "failed" })]);
    expect(overview.sessions[0]).toMatchObject({ id: SESSION, lastAction: "✍️ Scan: foutcode tonen", commits: 2, pr: { number: 7, state: "open", ci: "failed" } });

    // Samengevoegd: de sessie is klaar.
    gh.set(`/repos/${REPO}/pulls?state=open&per_page=30`, []).set(`/repos/${REPO}/pulls/7`, { number: 7, merged_at: "2026-09-23T10:00:00Z", state: "closed", head: { ref: "claude/fix-scan-x1", sha: "bbb2" } });
    await watcher.pollProject((await getCodeProject(env.db, "scanner"))!);
    expect((await events("code.pr")).map((e) => e.data.action)).toEqual(["opened", "merged"]);
    overview = await codeOverview(env.ctx);
    expect(overview.sessions[0]).toMatchObject({ state: "done", pr: { state: "merged" } });
  });

  it("een mislukte uitrol naar productie komt ook als bericht", async () => {
    await addScanner();
    scannerOnGitHub(gh);
    const watcher = new CodeWatcher(env.ctx, gh);
    await watcher.pollProject((await getCodeProject(env.db, "scanner"))!);
    gh.set(`/repos/${REPO}/deployments?per_page=10`, [{ id: 12, sha: "ccc3", environment: "Production", production_environment: true, created_at: "2026-09-23T11:00:00Z" }]).set(
      `/repos/${REPO}/deployments/12/statuses?per_page=1`,
      [{ state: "failure", target_url: "https://vercel.com/x/12", created_at: "2026-09-23T11:02:00Z" }],
    );
    await watcher.pollProject((await getCodeProject(env.db, "scanner"))!);
    expect(env.notifier.sent.at(-1)?.text).toContain("Uitrollen van Scanner mislukt");
    expect((await events("code.deploy"))[0]).toMatchObject({ data: { state: "failure" } });
  });

  it("een lege repository (Fluxgrid) is geen fout, en zonder toegang staat de reden erbij", async () => {
    await saveCodeProject(env.ctx, { name: "Fluxgrid", repo: "demo-holding/fluxgrid", branch: "games" }, "owner");
    await saveCodeProject(env.ctx, { name: "Geheim", repo: "iemand/anders" }, "owner");
    gh.set("/repos/demo-holding/fluxgrid", { default_branch: "main", html_url: "https://github.com/demo-holding/fluxgrid", size: 0, pushed_at: null }).set(
      "/repos/demo-holding/fluxgrid/branches?per_page=100",
      [],
    );
    const watcher = new CodeWatcher(env.ctx, gh);
    await watcher.pollAll();
    const { projects } = await codeOverview(env.ctx);
    expect(projects.find((p) => p.key === "fluxgrid")).toMatchObject({ empty: true, error: null, lastCommit: null });
    expect(projects.find((p) => p.key === "geheim")?.error).toContain("geen toegang");
    expect((await codeReportLines(env.ctx)).join("\n")).toContain("Fluxgrid: nog geen code op GitHub");
  });
});

describe("gezondheidscheck", () => {
  it("twee keer mis = ligt eruit (met bericht), weer bereikbaar = bericht met hoe lang", async () => {
    await addScanner();
    let status = 200;
    const fetchImpl = async () => new Response("{}", { status });
    const watcher = new CodeWatcher(env.ctx, null, fetchImpl as typeof fetch);
    const check = async () => watcher.checkProject((await getCodeProject(env.db, "scanner"))!);

    await check();
    expect((await codeOverview(env.ctx)).projects[0]!.health).toMatchObject({ state: "up", status: 200 });
    status = 503;
    await check();
    expect((await codeOverview(env.ctx)).projects[0]!.health.state).toBe("up"); // één hapering is nog geen storing
    await check();
    const down = (await codeOverview(env.ctx)).projects[0]!.health;
    expect(down).toMatchObject({ state: "down", status: 503 });
    expect(down.note).toContain("database");
    expect(env.notifier.sent.at(-1)?.text).toContain("🔴 Scanner ligt eruit");

    env.clock.now = new Date(env.clock.now.getTime() + 12 * 60_000);
    status = 200;
    await check();
    expect(env.notifier.sent.at(-1)?.text).toBe("🟢 Scanner is weer bereikbaar (lag 12 min plat).");
    expect((await codeOverview(env.ctx)).projects[0]!.health.uptime24h).toBe(0.5);
    expect((await events("code.health")).map((e) => e.data.state)).toEqual(["down", "up"]);
  });

  it("zonder gezondheidsadres telt elke pagina onder 400 als bereikbaar", async () => {
    await saveCodeProject(env.ctx, { name: "Site", url: "https://example.org" }, "owner");
    const watcher = new CodeWatcher(env.ctx, null, (async () => new Response("", { status: 301 })) as unknown as typeof fetch);
    await watcher.checkProject((await getCodeProject(env.db, "site"))!);
    expect((await codeOverview(env.ctx)).projects[0]!.health.state).toBe("up");
  });
});

describe("Claude Code-hooks", () => {
  const hook = (app: ReturnType<typeof createApp>, payload: unknown, token = "hook-geheim-0123456789") =>
    app.request("/api/hooks/claude-code", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(payload) });

  it("staan uit zonder geheim, en weigeren een fout geheim", async () => {
    expect((await hook(createApp(env.ctx), { event: "ping", sessionId: "x" })).status).toBe(404);
    const ctx = { ...env.ctx, config: { ...env.ctx.config, code: { ...env.ctx.config.code, hookToken: "hook-geheim-0123456789" } } };
    expect((await hook(createApp(ctx), { event: "ping", sessionId: "x" }, "fout-geheim-0123456789")).status).toBe(401);
    expect((await hook(createApp(ctx), { event: "ping", sessionId: "x" })).status).toBe(200);
  });

  it("opdracht, tools en klaar: live in het kantoor, gekoppeld aan de sessie van de commits", async () => {
    const ctx = { ...env.ctx, config: { ...env.ctx.config, code: { ...env.ctx.config.code, hookToken: "hook-geheim-0123456789" } } };
    await addScanner();
    scannerOnGitHub(gh);
    await new CodeWatcher(ctx, gh).pollProject((await getCodeProject(env.db, "scanner"))!);
    const app = createApp(ctx);
    const base = { sessionId: "3f2a-uuid", repo: REPO, branch: MAIN, where: "cloud" };
    expect((await hook(app, { ...base, event: "UserPromptSubmit", prompt: "Maak de cookiescanner sneller" })).status).toBe(200);
    await hook(app, { ...base, event: "PreToolUse", kind: "search", detail: "playwright slow on vercel" });
    await hook(app, { ...base, event: "PreToolUse", kind: "search", detail: "nog een zoekopdracht" });
    await hook(app, { ...base, event: "PreToolUse", kind: "test", detail: "npm test" });
    await hook(app, { ...base, event: "Stop" });

    const { sessions } = await codeOverview(ctx);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: SESSION, title: "Maak de cookiescanner sneller", lastAction: "✅ Klaar, wacht op jou" });
    const texts = (await events("code.session")).map((e) => e.text);
    expect(texts).toEqual([
      "Nieuwe opdracht voor Claude Code (Scanner): Maak de cookiescanner sneller",
      "🔎 playwright slow on vercel",
      "🧪 npm test",
      "Claude Code is klaar met Scanner",
    ]);
  });

  it("controleert de invoer", async () => {
    const ctx = { ...env.ctx, config: { ...env.ctx.config, code: { ...env.ctx.config.code, hookToken: "hook-geheim-0123456789" } } };
    const res = await hook(createApp(ctx), { event: "PreToolUse", sessionId: "../../etc", repo: "geen repo" });
    expect(res.status).toBe(400);
    expect((await hook(createApp(ctx), { event: "SubagentStart", sessionId: "x", agentId: "a/../b" })).status).toBe(400);
  });

  it("helpers (sub-agents): inzetten, stappen zetten en opleveren, elk als eigen poppetje", async () => {
    const ctx = { ...env.ctx, config: { ...env.ctx.config, code: { ...env.ctx.config.code, hookToken: "hook-geheim-0123456789" } } };
    await addScanner();
    const app = createApp(ctx);
    const base = { sessionId: "sessie-7", repo: REPO, branch: "claude/klanten", where: "cloud" };
    const session = "cc:cloud:sessie-7";
    const helper = `${session}~agent-1`;
    await hook(app, { ...base, event: "UserPromptSubmit", prompt: "Hoe krijgen we de eerste tien klanten?" });
    await hook(app, { ...base, event: "PreToolUse", kind: "helper", detail: "Zoek hoe vergelijkbare tools klanten vinden", agentType: "onderzoeker" });
    await hook(app, { ...base, event: "SubagentStart", agentId: "agent-1", agentType: "onderzoeker" });
    await hook(app, { ...base, event: "PreToolUse", kind: "search", detail: "cookie scanner eerste klanten", agentId: "agent-1", agentType: "onderzoeker" });
    await hook(app, { ...base, event: "PreToolUse", kind: "fetch", detail: "voorbeeld.nl/prijzen", agentId: "agent-1", agentType: "onderzoeker" });

    let [s] = (await codeOverview(ctx)).sessions;
    expect(s).toMatchObject({
      actorId: session,
      state: "working",
      // De sessie houdt haar eigen laatste stap: wie ze inzette.
      lastAction: "🧑‍🤝‍🧑 Onderzoeker: Zoek hoe vergelijkbare tools klanten vinden",
      helpersUsed: 1,
      helpers: [{ actorId: helper, agentType: "onderzoeker", label: "Onderzoeker", task: "Zoek hoe vergelijkbare tools klanten vinden", lastAction: "🌐 voorbeeld.nl/prijzen", tools: 2, startedAt: expect.any(String), lastActivityAt: expect.any(String) }],
    });

    // De helper werkt op de achtergrond door terwijl de sessie zelf al stopt (zo doet Claude Code het echt).
    await hook(app, { ...base, event: "Stop" });
    [s] = (await codeOverview(ctx)).sessions;
    expect(s!.lastAction).toBe("⏳ Wacht op een helper");
    await hook(app, { ...base, event: "SubagentStop", agentId: "agent-1", agentType: "onderzoeker" });
    // Het bericht dat de helper klaar is, is geen nieuwe opdracht van jou.
    await hook(app, { ...base, event: "UserPromptSubmit", prompt: "<task-notification> <task-id>agent-1</task-id> <status>completed</status>" });
    await hook(app, { ...base, event: "Stop" });
    [s] = (await codeOverview(ctx)).sessions;
    expect(s).toMatchObject({ helpersUsed: 1, helpers: [], title: "Hoe krijgen we de eerste tien klanten?", lastAction: "✅ Klaar, wacht op jou" });
    expect((await events("code.helper")).map((e) => [e.data.action, e.agentId, e.targetAgentId, e.text])).toEqual([
      ["start", helper, session, "🧑‍🤝‍🧑 Onderzoeker erbij: Zoek hoe vergelijkbare tools klanten vinden"],
      ["tool", helper, session, "🔎 cookie scanner eerste klanten"],
      ["tool", helper, session, "🌐 voorbeeld.nl/prijzen"],
      ["stop", helper, session, "📨 Onderzoeker levert op: Zoek hoe vergelijkbare tools klanten vinden"],
    ]);
    // Een tweede keer stoppen levert niets dubbels op.
    await hook(app, { ...base, event: "SubagentStop", agentId: "agent-1", agentType: "onderzoeker" });
    expect(await events("code.helper")).toHaveLength(4);
  });

  it("een helper zonder beginbericht verschijnt bij zijn eerste stap, en verdwijnt als hij lang stil is of de sessie sluit", async () => {
    const ctx = { ...env.ctx, config: { ...env.ctx.config, code: { ...env.ctx.config.code, hookToken: "hook-geheim-0123456789" } } };
    const app = createApp(ctx);
    const base = { sessionId: "sessie-8", where: "local" };
    await hook(app, { ...base, event: "PreToolUse", kind: "search", detail: "iets", agentId: "x1", agentType: "plugin:tools:security-reviewer" });
    let [s] = (await codeOverview(ctx)).sessions;
    expect(s!.helpers).toEqual([expect.objectContaining({ label: "Security reviewer", actorId: "cc:local:sessie-8~x1" })]);
    expect((await events("code.helper")).map((e) => e.data.action)).toEqual(["start", "tool"]);

    await hook(app, { ...base, event: "SubagentStart", agentId: "x2", agentType: "Explore" });
    await hook(app, { ...base, event: "SessionEnd" });
    [s] = (await codeOverview(ctx)).sessions;
    expect(s).toMatchObject({ state: "done", helpers: [], helpersUsed: 2 });
  });
});

describe("het hook-script zelf", () => {
  /** Draait deploy/claude-code/hq-hook.mjs zoals Claude Code dat doet, met een nep-HQ die opvangt wat binnenkomt. */
  async function runHook(input: Record<string, unknown>): Promise<{ bodies: Array<Record<string, unknown>>; stdout: string; code: number | null }> {
    const { createServer } = await import("node:http");
    const { spawn } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");
    const bodies: Array<Record<string, unknown>> = [];
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        if (req.headers.authorization === "Bearer test-geheim") bodies.push(JSON.parse(raw) as Record<string, unknown>);
        res.end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    const script = fileURLToPath(new URL("../../deploy/claude-code/hq-hook.mjs", import.meta.url));
    const child = spawn(process.execPath, [script], {
      env: { PATH: process.env.PATH, HOME: "/nergens", HQ_HOOK_URL: `http://127.0.0.1:${port}/api/hooks/claude-code`, HQ_HOOK_TOKEN: "test-geheim" },
      cwd: "/",
    });
    let stdout = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stdin.end(JSON.stringify(input));
    const code = await new Promise<number | null>((r) => child.on("close", r));
    await new Promise<void>((r) => server.close(() => r()));
    return { bodies, stdout, code };
  }

  it("meldt het inzetten van een helper, met wat hij moet doen", async () => {
    const out = await runHook({
      hook_event_name: "PreToolUse",
      session_id: "abc-123",
      tool_name: "Agent",
      tool_input: { description: "Zoek concurrenten en prijzen", prompt: "Lange opdracht met sk-abcdefghijklmnopqrstuvwxyz", subagent_type: "onderzoeker" },
    });
    expect(out).toMatchObject({ code: 0, stdout: "" });
    expect(out.bodies).toEqual([expect.objectContaining({ event: "PreToolUse", sessionId: "abc-123", kind: "helper", detail: "Zoek concurrenten en prijzen", agentType: "onderzoeker" })]);
  });

  it("stuurt geen systeemberichten of commando's door als opdracht, en poetst alleen echte sleutels weg", async () => {
    expect((await runHook({ hook_event_name: "UserPromptSubmit", session_id: "abc-123", prompt: "<task-notification> <task-id>x</task-id>" })).bodies).toEqual([]);
    expect((await runHook({ hook_event_name: "UserPromptSubmit", session_id: "abc-123", prompt: "/clear" })).bodies).toEqual([]);
    const out = await runHook({ hook_event_name: "UserPromptSubmit", session_id: "abc-123", prompt: "Maak een risk-analyse met sleutel sk-ant-abcdefghijklmnopqrst" });
    expect(out.bodies[0]!.prompt).toBe("Maak een risk-analyse met sleutel •••");
  });

  it("geeft bij stappen binnen een helper diens id en soort mee, en begin en einde", async () => {
    const step = await runHook({ hook_event_name: "PreToolUse", session_id: "abc-123", agent_id: "agent-9", agent_type: "Explore", tool_name: "WebSearch", tool_input: { query: "puzzle game retention" } });
    expect(step.bodies).toEqual([expect.objectContaining({ kind: "search", detail: "puzzle game retention", agentId: "agent-9", agentType: "Explore" })]);
    const start = await runHook({ hook_event_name: "SubagentStart", session_id: "abc-123", agent_id: "agent-9", agent_type: "Explore" });
    expect(start.bodies).toEqual([expect.objectContaining({ event: "SubagentStart", agentId: "agent-9", agentType: "Explore" })]);
    const stop = await runHook({ hook_event_name: "SubagentStop", session_id: "abc-123", agent_id: "agent-9", agent_type: "Explore", last_assistant_message: "geheim verslag" });
    expect(stop.bodies).toHaveLength(1);
    expect(JSON.stringify(stop.bodies)).not.toContain("geheim verslag");
    // Zonder id van de helper geen begin- of eindbericht.
    expect((await runHook({ hook_event_name: "SubagentStop", session_id: "abc-123" })).bodies).toEqual([]);
  });
});

describe("werkplaats in het kantoor en via de API", () => {
  it("project volgen, bekijken en weer weghalen", async () => {
    const app = createApp(env.ctx);
    const post = (json: unknown) => app.request("/api/owner/code/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) });
    expect((await post({ name: "Scanner", repo: "scanner" })).status).toBe(400);
    expect((await post({ name: "Scanner", repo: REPO, url: "ftp://x" })).status).toBe(400);
    const res = await post({ name: "Scanner", repo: REPO, url: "https://scanner.example" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ key: "scanner", repo: REPO, backlogPath: "BACKLOG.md" });

    const snap = await buildOfficeSnapshot(env.ctx);
    expect(snap.code).toMatchObject({ github: false, hooks: false, projects: [expect.objectContaining({ key: "scanner", health: expect.objectContaining({ state: "unknown" }) })] });
    expect((await (await app.request("/api/owner/code/repos")).json()) as { error: string }).toMatchObject({ error: expect.stringContaining("HQ_GITHUB_TOKEN") });

    expect((await app.request("/api/owner/code/projects/scanner", { method: "DELETE" })).status).toBe(200);
    expect((await codeOverview(env.ctx)).projects).toEqual([]);
  });

  it("de GitHub-client onthoudt ETags: een ongewijzigde pagina kost geen limiet", async () => {
    const seen: Array<Record<string, string>> = [];
    let n = 0;
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      seen.push({ ...(init?.headers as Record<string, string>) });
      n += 1;
      return n === 1
        ? new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { etag: '"e1"', "x-ratelimit-remaining": "4999" } })
        : new Response(null, { status: 304, headers: { "x-ratelimit-remaining": "4999" } });
    };
    const client = new GitHubClient("tok", fetchImpl as typeof fetch);
    expect(await client.get("/repos/a/b")).toEqual({ ok: 1 });
    expect(await client.get("/repos/a/b")).toEqual({ ok: 1 });
    expect(seen[0]).toMatchObject({ authorization: "Bearer tok" });
    expect(seen[1]).toMatchObject({ "if-none-match": '"e1"' });
  });
});

describe("de werkplaats volgt je repositories vanzelf", () => {
  const repos = [
    { full_name: REPO, name: "scanner", homepage: "scanner.example", description: "Scant sites op fouten." },
    { full_name: "demo-holding/oud", name: "oud", homepage: null, description: null, archived: true },
    { full_name: "demo-holding/weg", name: "weg", homepage: null, description: null },
    { full_name: "demo-holding/puzzel", name: "puzzel", homepage: "https://puzzel.example/", description: null },
  ];
  // De scanner heeft een gezondheidscheck op /api/health; de puzzel geeft op elk adres gewoon zijn pagina terug.
  const fetchImpl = async (url: string) => {
    if (url === "https://scanner.example/api/health") return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
    if (url.startsWith("https://puzzel.example/")) return new Response("<html>spel</html>", { status: 200, headers: { "content-type": "text/html" } });
    return new Response("niet gevonden", { status: 404 });
  };

  it("volgt nieuwe repositories met hun site en gezondheidscheck, maar niet wat je weghaalde of wat gearchiveerd is", async () => {
    gh.set("/user/repos?per_page=100&sort=pushed", repos);
    // Deze haalde je eerder weg in het kantoor: die komt niet terug.
    await saveCodeProject(env.ctx, { name: "weg", repo: "demo-holding/weg" }, "owner");
    await env.db.query("update code_projects set archived_at = now() where key = 'weg'");

    expect(await followNewRepos(env.ctx, gh, fetchImpl as typeof fetch)).toEqual(["scanner", "puzzel"]);
    expect(await getCodeProject(env.db, "scanner")).toMatchObject({
      repo: REPO,
      url: "https://scanner.example",
      healthUrl: "https://scanner.example/api/health",
      description: "Scant sites op fouten.",
    });
    // Een pagina die op elk adres gewoon antwoordt, is geen gezondheidscheck: dan controleert HQ de site zelf.
    expect(await getCodeProject(env.db, "puzzel")).toMatchObject({ url: "https://puzzel.example", healthUrl: null });
    expect(await getCodeProject(env.db, "weg")).toMatchObject({ archivedAt: expect.any(Date) });
    expect(env.notifier.last()!.text).toBe(
      "🛠️ Werkplaats: ik volg nu scanner en puzzel. Die kwamen mee met je GitHub-token. Niet volgen? Haal ze weg in het kantoor; dan komen ze niet terug.",
    );
    // Een tweede keer: niets nieuws, geen bericht.
    const sent = env.notifier.texts().length;
    expect(await followNewRepos(env.ctx, gh, fetchImpl as typeof fetch)).toEqual([]);
    expect(env.notifier.texts().length).toBe(sent);
  });

  it("kijkt hooguit één keer per uur, en helemaal niet met HQ_AUTO_FOLLOW=uit", async () => {
    gh.set("/user/repos?per_page=100&sort=pushed", []);
    const watcher = new CodeWatcher(env.ctx, gh, fetchImpl as typeof fetch);
    await watcher.pollAll();
    await watcher.pollAll();
    expect(gh.calls.filter((c) => c.startsWith("/user/repos"))).toHaveLength(1);
    env.clock.now = new Date(env.clock.now.getTime() + 3_600_000);
    await watcher.pollAll();
    expect(gh.calls.filter((c) => c.startsWith("/user/repos"))).toHaveLength(2);

    env.ctx.config.code.autoFollow = false;
    env.clock.now = new Date(env.clock.now.getTime() + 3_600_000);
    await watcher.pollAll();
    expect(gh.calls.filter((c) => c.startsWith("/user/repos"))).toHaveLength(2);
  });

  it("maakt van het veld website een bruikbaar adres", async () => {
    expect(siteUrl("scanner.example")).toBe("https://scanner.example");
    expect(siteUrl(" https://a.example/pad/ ")).toBe("https://a.example/pad");
    expect(siteUrl("")).toBeNull();
    expect(siteUrl("localhost")).toBeNull();
    expect(siteUrl("ftp://a.example")).toBeNull();
    expect(await findHealthUrl("https://nergens.example", (async () => { throw new Error("offline"); }) as typeof fetch)).toBeNull();
  });
});
