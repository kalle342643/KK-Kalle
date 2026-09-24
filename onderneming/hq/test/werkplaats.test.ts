import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/api/app.js";
import { parseBacklog } from "../src/code/backlog.js";
import { GitHubClient, GitHubError, parseCommitMessage, type GitHubApi } from "../src/code/github.js";
import { codeOverview, codeReportLines } from "../src/code/overview.js";
import { getCodeProject, saveCodeProject } from "../src/code/projects.js";
import { CodeWatcher } from "../src/code/watch.js";
import { buildOfficeSnapshot } from "../src/office/snapshot.js";
import { createTestEnv, type TestEnv } from "./helpers/context.js";

const REPO = "kalle342643/website-1";
const MAIN = "claude/github-only-storage-7al57w";
const SESSION = "session_01PKTV36A7UTeA81wpnz7x4n";

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

- **Inschrijven bij de KvK.** Zet \`NORMWACHT_KVK\` in Vercel.
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

function normwachtOnGitHub(gh: FakeGitHub) {
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
    .set(`/repos/${REPO}/deployments/11/statuses?per_page=1`, [{ state: "success", environment_url: "https://normwatch.vercel.app", created_at: "2026-09-23T09:03:00Z" }])
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

const addNormwacht = () =>
  saveCodeProject(env.ctx, { name: "Normwacht", repo: REPO, url: "https://normwatch.vercel.app", healthUrl: "https://normwatch.vercel.app/api/gezondheid", branch: "saas" }, "owner");
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
    expect(items[0]!.text).toBe("Zet NORMWACHT_KVK in Vercel.");
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
    await addNormwacht();
    normwachtOnGitHub(gh);
    const watcher = new CodeWatcher(env.ctx, gh);
    await watcher.pollProject((await getCodeProject(env.db, "normwacht"))!);

    const { projects, sessions } = await codeOverview(env.ctx);
    expect(projects[0]).toMatchObject({
      key: "normwacht",
      name: "Normwacht",
      defaultBranch: MAIN,
      empty: false,
      error: null,
      ci: { state: "passed" },
      deploy: { state: "success", url: "https://normwatch.vercel.app", environment: "Production" },
      lastCommit: { sha: "aaa1", title: "Zeg waarom een pagina niet open ging", session: `https://claude.ai/code/${SESSION}` },
      backlog: { ownerCount: 2, totalCount: 3 },
      activeSessions: 1,
    });
    expect(projects[0]!.backlog!.items[0]).toMatchObject({ title: "Inschrijven bij de KvK", owner: true });
    expect(sessions).toEqual([
      expect.objectContaining({ id: SESSION, actorId: `cc:${SESSION}`, projectKey: "normwacht", url: `https://claude.ai/code/${SESSION}`, branch: MAIN, commits: 1, state: "working" }),
    ]);
    // Branches die niet van Claude of een PR zijn, volgen we niet.
    expect(gh.calls.some((c) => c.includes("experiment-oud"))).toBe(false);
    expect(await events("code.commit")).toEqual([]);
  });

  it("daarna: nieuwe commits, een pull request, rode tests en samenvoegen worden gebeurtenissen", async () => {
    await addNormwacht();
    normwachtOnGitHub(gh);
    const watcher = new CodeWatcher(env.ctx, gh);
    await watcher.pollProject((await getCodeProject(env.db, "normwacht"))!);

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
    await watcher.pollProject((await getCodeProject(env.db, "normwacht"))!);

    const [c] = await events("code.commit");
    expect(c).toMatchObject({ agentId: `cc:${SESSION}`, text: "Scan: foutcode tonen", data: { project: "normwacht", branch: "claude/fix-scan-x1" } });
    expect(await events("code.pr")).toEqual([expect.objectContaining({ text: "PR #7: Scan: foutcode tonen", data: expect.objectContaining({ action: "opened" }) })]);
    let overview = await codeOverview(env.ctx);
    expect(overview.projects[0]!.openPrs).toEqual([expect.objectContaining({ number: 7, draft: true, ci: "failed" })]);
    expect(overview.sessions[0]).toMatchObject({ id: SESSION, lastAction: "✍️ Scan: foutcode tonen", commits: 2, pr: { number: 7, state: "open", ci: "failed" } });

    // Samengevoegd: de sessie is klaar.
    gh.set(`/repos/${REPO}/pulls?state=open&per_page=30`, []).set(`/repos/${REPO}/pulls/7`, { number: 7, merged_at: "2026-09-23T10:00:00Z", state: "closed", head: { ref: "claude/fix-scan-x1", sha: "bbb2" } });
    await watcher.pollProject((await getCodeProject(env.db, "normwacht"))!);
    expect((await events("code.pr")).map((e) => e.data.action)).toEqual(["opened", "merged"]);
    overview = await codeOverview(env.ctx);
    expect(overview.sessions[0]).toMatchObject({ state: "done", pr: { state: "merged" } });
  });

  it("een mislukte uitrol naar productie komt ook als bericht", async () => {
    await addNormwacht();
    normwachtOnGitHub(gh);
    const watcher = new CodeWatcher(env.ctx, gh);
    await watcher.pollProject((await getCodeProject(env.db, "normwacht"))!);
    gh.set(`/repos/${REPO}/deployments?per_page=10`, [{ id: 12, sha: "ccc3", environment: "Production", production_environment: true, created_at: "2026-09-23T11:00:00Z" }]).set(
      `/repos/${REPO}/deployments/12/statuses?per_page=1`,
      [{ state: "failure", target_url: "https://vercel.com/x/12", created_at: "2026-09-23T11:02:00Z" }],
    );
    await watcher.pollProject((await getCodeProject(env.db, "normwacht"))!);
    expect(env.notifier.sent.at(-1)?.text).toContain("Uitrollen van Normwacht mislukt");
    expect((await events("code.deploy"))[0]).toMatchObject({ data: { state: "failure" } });
  });

  it("een lege repository (Fluxgrid) is geen fout, en zonder toegang staat de reden erbij", async () => {
    await saveCodeProject(env.ctx, { name: "Fluxgrid", repo: "kalle342643/Fluxgrid", branch: "games" }, "owner");
    await saveCodeProject(env.ctx, { name: "Geheim", repo: "iemand/anders" }, "owner");
    gh.set("/repos/kalle342643/Fluxgrid", { default_branch: "main", html_url: "https://github.com/kalle342643/Fluxgrid", size: 0, pushed_at: null }).set(
      "/repos/kalle342643/Fluxgrid/branches?per_page=100",
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
    await addNormwacht();
    let status = 200;
    const fetchImpl = async () => new Response("{}", { status });
    const watcher = new CodeWatcher(env.ctx, null, fetchImpl as typeof fetch);
    const check = async () => watcher.checkProject((await getCodeProject(env.db, "normwacht"))!);

    await check();
    expect((await codeOverview(env.ctx)).projects[0]!.health).toMatchObject({ state: "up", status: 200 });
    status = 503;
    await check();
    expect((await codeOverview(env.ctx)).projects[0]!.health.state).toBe("up"); // één hapering is nog geen storing
    await check();
    const down = (await codeOverview(env.ctx)).projects[0]!.health;
    expect(down).toMatchObject({ state: "down", status: 503 });
    expect(down.note).toContain("database");
    expect(env.notifier.sent.at(-1)?.text).toContain("🔴 Normwacht ligt eruit");

    env.clock.now = new Date(env.clock.now.getTime() + 12 * 60_000);
    status = 200;
    await check();
    expect(env.notifier.sent.at(-1)?.text).toBe("🟢 Normwacht is weer bereikbaar (lag 12 min plat).");
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
    await addNormwacht();
    normwachtOnGitHub(gh);
    await new CodeWatcher(ctx, gh).pollProject((await getCodeProject(env.db, "normwacht"))!);
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
      "Nieuwe opdracht voor Claude Code (Normwacht): Maak de cookiescanner sneller",
      "🔎 playwright slow on vercel",
      "🧪 npm test",
      "Claude Code is klaar met Normwacht",
    ]);
  });

  it("controleert de invoer", async () => {
    const ctx = { ...env.ctx, config: { ...env.ctx.config, code: { ...env.ctx.config.code, hookToken: "hook-geheim-0123456789" } } };
    const res = await hook(createApp(ctx), { event: "PreToolUse", sessionId: "../../etc", repo: "geen repo" });
    expect(res.status).toBe(400);
  });
});

describe("werkplaats in het kantoor en via de API", () => {
  it("project volgen, bekijken en weer weghalen", async () => {
    const app = createApp(env.ctx);
    const post = (json: unknown) => app.request("/api/owner/code/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) });
    expect((await post({ name: "Normwacht", repo: "website-1" })).status).toBe(400);
    expect((await post({ name: "Normwacht", repo: REPO, url: "ftp://x" })).status).toBe(400);
    const res = await post({ name: "Normwacht", repo: REPO, url: "https://normwatch.vercel.app" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ key: "normwacht", repo: REPO, backlogPath: "BACKLOG.md" });

    const snap = await buildOfficeSnapshot(env.ctx);
    expect(snap.code).toMatchObject({ github: false, hooks: false, projects: [expect.objectContaining({ key: "normwacht", health: expect.objectContaining({ state: "unknown" }) })] });
    expect((await (await app.request("/api/owner/code/repos")).json()) as { error: string }).toMatchObject({ error: expect.stringContaining("HQ_GITHUB_TOKEN") });

    expect((await app.request("/api/owner/code/projects/normwacht", { method: "DELETE" })).status).toBe(200);
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
