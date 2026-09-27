import { describe, expect, it } from "vitest";
import type { OfficeAgent, OfficeSnapshot } from "../src/office/types.js";
import {
  accountSnapshot,
  bucketOf,
  createSessionInput,
  environmentsFrom,
  explainError,
  HOLDING_REPO,
  pickEnvironment,
  planTitle,
  routinesFrom,
  sessionChanges,
  sessionIdIn,
  sessionsFrom,
  toCodeSession,
  visibleSessions,
  type AccountState,
} from "../web/office/account-model.js";
import { buildLayout } from "../web/office/layout.js";
import { buildTree, type TreeNode } from "../web/office/tree.js";

const NOW = Date.parse("2026-09-27T10:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

/** Een verzonnen sessie in de vorm die Claude Code Remote teruggeeft. */
function raw(id: string, bucket: string, tags: string[] = [], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: `Taak ${id}`,
    session_status: bucket === "WORKING" ? "SESSION_STATUS_RUNNING" : "SESSION_STATUS_IDLE",
    status_bucket: `SESSION_STATUS_BUCKET_${bucket}`,
    created_at: ago(120),
    updated_at: ago(5),
    environment_id: "env_cloud",
    environment_kind: "anthropic_cloud",
    tags,
    session_context: { sources: [{ git_repository: { url: "https://github.com/voorbeeld/holding" } }], model: "claude-sonnet-5" },
    external_metadata: { usage: { cost_usd: 2 } },
    ...extra,
  };
}

const state = (sessions: Array<Record<string, unknown>>, extra: Partial<AccountState> = {}): AccountState => ({
  state: "ok",
  message: null,
  updatedAt: NOW,
  sessions,
  routines: [],
  routinesError: null,
  environments: [],
  owner: { nickname: null, avatar: null },
  events: [],
  lastEventId: 0,
  ...extra,
});

describe("kantoor op je Claude-account: sessies lezen", () => {
  it("vindt de lijst, ook als hij een laag dieper zit", () => {
    const one = raw("session_a", "WORKING");
    expect(sessionsFrom({ ccr: { data: [one] } })).toHaveLength(1);
    expect(sessionsFrom({ data: [one, { geen: "id" }] })).toHaveLength(1);
    expect(sessionsFrom([one])).toHaveLength(1);
    expect(sessionsFrom("rommel")).toEqual([]);
  });

  it("vertaalt de status naar bezig, wacht op jou, klaar, mislukt of gearchiveerd", () => {
    expect(bucketOf(raw("a", "WORKING"))).toBe("working");
    expect(bucketOf(raw("a", "BLOCKED"))).toBe("waiting");
    expect(bucketOf(raw("a", "REVIEW_READY"))).toBe("review");
    expect(bucketOf(raw("a", "FAILED"))).toBe("failed");
    expect(bucketOf(raw("a", "COMPLETED"))).toBe("done");
    expect(bucketOf({ ...raw("a", "WORKING"), session_status: "SESSION_STATUS_ARCHIVED" })).toBe("archived");
    expect(bucketOf({ session_status: "SESSION_STATUS_REQUIRES_ACTION" })).toBe("waiting");
  });

  it("herkent de hoofdagent en afdelingen aan hun tags, met rol en ouder", () => {
    const boss = toCodeSession(raw("session_boss", "WORKING", ["hoofdagent"], { task_summary: "verdeelt het werk" }), NOW);
    expect(boss).toMatchObject({ room: "hoofdagent", label: "Hoofdagent", state: "working", lastAction: "verdeelt het werk" });
    expect(boss.account).toMatchObject({ kind: "hoofdagent", team: null, repo: "voorbeeld/holding", model: "claude-sonnet-5", costUsd: 2 });

    const builder = toCodeSession(
      raw("session_b", "BLOCKED", ["afdeling:Puzzel Game", "rol:bouwer", "ouder:session_boss"], {
        post_turn_summary: { needs_action: "Mag ik een repository maken?", recent_action: "prototype klaar" },
        session_context: { outcomes: [{ git_repository: { git_info: { repo: "voorbeeld/puzzel", branches: ["claude/proto"] } } }] },
      }),
      NOW,
    );
    expect(builder).toMatchObject({ room: "afd-puzzel-game", label: "Bouwer · Puzzel game", state: "idle", branch: "claude/proto", projectKey: "voorbeeld/puzzel" });
    expect(builder.account).toMatchObject({ kind: "afdeling", team: "puzzel-game", teamName: "Puzzel game", role: "bouwer", parentId: "session_boss", bucket: "waiting", needsAction: "Mag ik een repository maken?" });

    const cowork = toCodeSession(raw("session_c", "COMPLETED", ["product:cowork"], { environment_kind: "bridge", session_context: {} }), NOW);
    expect(cowork).toMatchObject({ room: null, label: "Claude · je computer", source: "local", projectKey: null });
    expect(cowork.account!.kind).toBe("los");
  });

  it("laat oude, afgeronde sessies weg, maar houdt wat loopt of net klaar is", () => {
    const list = visibleSessions(
      [
        raw("session_run", "WORKING", [], { updated_at: ago(60 * 24 * 30) }),
        raw("session_old", "COMPLETED", [], { updated_at: ago(60 * 24 * 20) }),
        raw("session_new", "COMPLETED", [], { updated_at: ago(60) }),
        { ...raw("session_arch", "COMPLETED"), session_status: "SESSION_STATUS_ARCHIVED" },
        { ...raw("session_team_arch", "COMPLETED", ["afdeling:x"]), session_status: "SESSION_STATUS_ARCHIVED" },
      ],
      NOW,
    );
    expect(list.map((s) => s.id).sort()).toEqual(["session_new", "session_run", "session_team_arch"]);
    // Klaar sinds een uur: nog aan het bureau. Klaar sinds een dag: naar huis (maar nog in de lijst).
    expect(list.find((s) => s.id === "session_new")!.state).toBe("idle");
    expect(toCodeSession(raw("x", "COMPLETED", [], { updated_at: ago(60 * 24) }), NOW).state).toBe("done");
  });

  it("maakt een momentopname zonder HQ: geen agents, geen HQ-bot, wel afdelingen, projecten en totalen", () => {
    const snap = accountSnapshot(
      state([
        raw("session_boss", "WORKING", ["hoofdagent"]),
        raw("session_1", "WORKING", ["afdeling:games", "ouder:session_boss"]),
        raw("session_2", "BLOCKED", ["afdeling:games", "ouder:session_boss"]),
        raw("session_3", "REVIEW_READY", []),
      ]),
      NOW,
    );
    expect(snap.agents).toEqual([]);
    expect(snap.people.map((p) => p.id)).toEqual(["owner"]);
    expect(snap.account!.teams).toEqual([{ slug: "games", name: "Games", sessions: 2, working: 1, waiting: 1 }]);
    expect(snap.account!.totals).toMatchObject({ working: 2, waiting: 1, review: 1, failed: 0, costUsd30d: 8 });
    expect(snap.code.projects).toHaveLength(1);
    expect(snap.code.projects[0]).toMatchObject({ key: "voorbeeld/holding", source: "account", activeSessions: 4 });
  });

  it("ziet wat er veranderde: nieuwe sessie, wacht op jou, en een nieuwe stap", () => {
    const before = visibleSessions([raw("session_1", "WORKING", [], { task_summary: "leest" }), raw("session_2", "WORKING")], NOW);
    const after = visibleSessions(
      [
        raw("session_1", "WORKING", [], { task_summary: "schrijft tests" }),
        raw("session_2", "BLOCKED", [], { post_turn_summary: { needs_action: "Mag ik pushen?" } }),
        raw("session_3", "WORKING", ["hoofdagent"]),
      ],
      NOW,
    );
    const changes = sessionChanges(before, after);
    expect(changes.map((c) => c.data.action)).toEqual(["tool", "needs-you", "started"]);
    expect(changes[1]!.text).toContain("wacht op jou: Mag ik pushen?");
    expect(changes[2]).toMatchObject({ type: "code.session", agentId: "cc:session_3" });
    expect(sessionChanges(after, after)).toEqual([]);
  });

  it("leest routines en omgevingen, en kiest de cloudomgeving die je het laatst gebruikte", () => {
    expect(routinesFrom({ data: [{ id: "trig_1", name: "Ochtend", cron_expression: "45 6 * * 1-5", enabled: false, last_run: { status: "SUCCEEDED", fired_at: ago(10) } }] })).toEqual([
      { id: "trig_1", name: "Ochtend", cron: "45 6 * * 1-5", nextRunAt: null, enabled: false, lastRunAt: ago(10), lastStatus: "SUCCEEDED" },
    ]);
    const envs = environmentsFrom({ environments: [{ environment_id: "env_cowork", name: "Cowork", kind: "remote_cowork" }, { environment_id: "env_cloud", name: "Standaard", kind: "anthropic_cloud" }] });
    expect(envs.map((e) => e.id)).toEqual(["env_cowork", "env_cloud"]);
    const sessions = [raw("a", "WORKING", [], { environment_id: "env_old", updated_at: ago(500) }), raw("b", "WORKING", [], { environment_id: "env_cloud", updated_at: ago(5) })];
    expect(pickEnvironment(sessions, envs)).toBe("env_cloud");
    // Geen cloudsessie bekend: de eerste omgeving die geen Cowork is.
    expect(pickEnvironment([], envs)).toBe("env_cloud");
    expect(pickEnvironment([], [{ id: "env_cowork", name: "Cowork", kind: "remote_cowork" }])).toBeNull();
  });

  it("zet een opdracht klaar voor een nieuwe hoofdagent in de repository van de holding", () => {
    const input = createSessionInput({ text: "Bouw een kleine puzzelgame\nen test hem", followUp: { id: "session_prev", title: "Hoofdagent: eerdere klus" } }, "env_cloud");
    expect(input).toMatchObject({ tags: ["hoofdagent"], source_url: HOLDING_REPO, environment_id: "env_cloud", title: "Hoofdagent: Bouw een kleine puzzelgame" });
    expect(String(input.prompt)).toContain("Bouw een kleine puzzelgame\nen test hem");
    expect(String(input.prompt)).toContain("session_prev");
    expect(String(input.append_system_prompt)).toContain(".claude/skills/hoofdagent/SKILL.md");
    expect(planTitle("x".repeat(100))).toHaveLength("Hoofdagent: ".length + 60);
  });

  it("vindt het id van de nieuwe sessie in het antwoord, waar het ook zit", () => {
    expect(sessionIdIn({ id: "session_01ABC" })).toBe("session_01ABC");
    expect(sessionIdIn({ ccr: { session: { id: "session_01XYZ" } } })).toBe("session_01XYZ");
    expect(sessionIdIn({ environment_id: "env_1", message: "gestart" })).toBeNull();
  });

  it("vertaalt fouten naar wat jij kunt doen, per soort", () => {
    expect(explainError({ code: "needs_reauth", message: "x" }).kind).toBe("blocked");
    expect(explainError({ code: "server_not_connected", message: "x" }).message).toContain("Connectors");
    expect(explainError({ code: "not_in_manifest", message: "x" }).message).toContain("Toestaan");
    expect(explainError({ code: "server_unavailable", message: "x", retryable: true }).kind).toBe("transient");
    expect(explainError({ code: "iets_nieuws", message: "x", retryable: true }).kind).toBe("transient");
    expect(explainError({ code: "iets_nieuws", message: "kapot" }).message).toContain("kapot");
    expect(explainError({ code: "tool_error", message: "geen toegang tot repo" })).toMatchObject({ kind: "failed" });
    expect(explainError({ code: "capability_disabled", message: "x" }).kind).toBe("unavailable");
  });
});

const names = (n: TreeNode): unknown => ({ n: n.name, c: n.children.map(names) });

describe("stamboom", () => {
  const modelName = (m: string | null) => m ?? "–";

  it("hangt afdelingen onder de hoofdagent die ze startte, en wat nergens bij hoort los", () => {
    const snap = accountSnapshot(
      state([
        raw("session_boss", "WORKING", ["hoofdagent"], { title: "Hoofdagent: Puzzelgame testen" }),
        raw("session_lead", "WORKING", ["afdeling:puzzel", "rol:lead", "ouder:session_boss"], { title: "Plan" }),
        raw("session_dev", "BLOCKED", ["afdeling:puzzel", "rol:bouwer", "ouder:session_lead"], { title: "Prototype" }),
        raw("session_solo", "REVIEW_READY", [], { title: "Blogcheck" }),
        raw("session_kind", "WORKING", ["ouder:session_solo"], { title: "Hulpje" }),
      ]),
      NOW,
    );
    const tree = buildTree(snap, { modelName });
    expect(names(tree.root)).toEqual({
      n: "Jij",
      c: [{ n: "Puzzelgame testen", c: [{ n: "Puzzel", c: [{ n: "Plan", c: [{ n: "Prototype", c: [] }] }] }] }],
    });
    expect(tree.loose.map(names)).toEqual([{ n: "Blogcheck", c: [{ n: "Hulpje", c: [] }] }]);
    expect(tree.teams).toEqual([expect.objectContaining({ name: "Puzzel", members: 2, working: 1, waiting: 1 })]);
    const dev = tree.root.children[0]!.children[0]!.children[0]!.children[0]!;
    expect(dev).toMatchObject({ role: "Bouwer", status: { label: "wacht op jou", tone: "warn" } });
  });

  it("loopt niet vast als twee sessies elkaar als ouder noemen", () => {
    const snap = accountSnapshot(
      state([raw("session_a", "WORKING", ["ouder:session_b"], { title: "A" }), raw("session_b", "WORKING", ["ouder:session_a"], { title: "B" })]),
      NOW,
    );
    const tree = buildTree(snap, { modelName });
    const count = (n: TreeNode): number => 1 + n.children.reduce((s, c) => s + count(c), 0);
    expect(tree.loose.reduce((s, n) => s + count(n), 0)).toBe(2);
  });

  it("toont op je server de CEO, de afdelingen met hun lead, en wie onder wie werkt", () => {
    const agent = (id: string, branch: string, extra: Partial<OfficeAgent> = {}): OfficeAgent => ({
      id,
      name: id,
      role: "general",
      title: null,
      status: "idle",
      branch,
      hqRole: null,
      template: null,
      reportsTo: null,
      model: "claude-sonnet-5",
      costTodayEur: 0,
      spentMonthEur: 1,
      budgetMonthEur: 10,
      lastActiveAt: null,
      pauseReason: null,
      currentTask: null,
      nickname: null,
      avatar: null,
      ...extra,
    });
    const snap = {
      ...accountSnapshot(state([]), NOW),
      account: undefined,
      branches: [{ slug: "games", name: "Games", template: "games", status: "active", monthlyBudgetEur: 30, leadAgentId: "lead", experiments: [] }],
      agents: [
        agent("atlas", "holding", { hqRole: "ceo" }),
        agent("argus", "holding", { hqRole: "analyst" }),
        agent("lead", "games", { hqRole: "lead", template: "tak-lead" }),
        agent("bouwer", "games", { status: "running", currentTask: "bouwt de game" }),
        agent("helper", "games", { reportsTo: "bouwer" }),
        agent("weg", "games", { status: "terminated" }),
      ],
    } as OfficeSnapshot;
    const tree = buildTree(snap, { modelName });
    expect(names(tree.root)).toEqual({
      n: "Jij",
      c: [{ n: "atlas", c: [{ n: "Games", c: [{ n: "lead", c: [{ n: "bouwer", c: [{ n: "helper", c: [] }] }] }] }, { n: "argus", c: [] }] }],
    });
    expect(tree.teams[0]).toMatchObject({ name: "Games", members: 3, working: 1 });
  });
});

describe("plattegrond van het kantoor op je Claude-account", () => {
  it("zet geen HQ-bot neer en houdt bureaus vrij voor sessies in een afdeling", () => {
    const layout = buildLayout({
      branches: [
        { slug: "hoofdagent", name: "Hoofdagent", template: "hoofdagent", seats: 3 },
        { slug: "afd-puzzel", name: "Puzzel", template: null, seats: 6 },
      ],
      agents: [],
      bot: false,
    });
    expect(layout.desks.some((d) => d.id === "desk-bot")).toBe(false);
    // Minstens een bureau per sessie plus een vrij bureau (de rest van het raster vult de kamer).
    expect(layout.desks.filter((d) => d.roomId === "dept-hoofdagent").length).toBeGreaterThanOrEqual(4);
    expect(layout.desks.filter((d) => d.roomId === "dept-afd-puzzel").length).toBeGreaterThanOrEqual(7);
    expect(layout.rooms.find((r) => r.id === "dept-hoofdagent")!.accent).toBe("#b8872f");
  });
});
