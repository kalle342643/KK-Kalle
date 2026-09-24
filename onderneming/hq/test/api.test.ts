import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/api/app.js";
import { AgentFactory } from "../src/company/factory.js";
import { loadCompany } from "../src/company/loader.js";
import { listApprovals } from "../src/domain/approvals.js";
import { totals } from "../src/domain/ledger.js";
import { createTestEnv, validProposal, type TestEnv } from "./helpers/context.js";

let env: TestEnv;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  env = await createTestEnv();
  app = createApp(env.ctx, { factory: new AgentFactory(loadCompany(), "http://127.0.0.1:8080") });
});
afterEach(async () => {
  await env.close();
});

function call(method: string, path: string, opts: { token?: string; json?: unknown; text?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.text !== undefined) {
    headers["content-type"] = "text/csv";
    body = opts.text;
  }
  return app.request(path, { method, headers, body });
}

describe("agent-API", () => {
  it("weigert verzoeken zonder of met een fout token", async () => {
    expect((await call("GET", "/api/agent/me")).status).toBe(401);
    expect((await call("GET", "/api/agent/me", { token: "pcp_nep" })).status).toBe(401);
    const res = await call("GET", "/api/agent/me", { token: env.lead.token });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: env.lead.id, name: "Vega" });
  });

  it("laat een agent een experiment voorstellen en meten", async () => {
    const res = await call("POST", "/api/agent/experiments", { token: env.scout.token, json: validProposal });
    expect(res.status).toBe(201);
    const { experiment } = (await res.json()) as { experiment: { id: number } };
    expect((await listApprovals(env.db, { status: ["pending"] })).length).toBe(1);

    const bad = await call("POST", "/api/agent/experiments", {
      token: env.scout.token,
      json: { ...validProposal, evidence: [] },
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { issues: unknown[] }).issues.length).toBeGreaterThan(0);

    const [approval] = await listApprovals(env.db, { status: ["pending"] });
    await app.request(`/api/owner/approvals/${approval!.id}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve" }),
    });
    const metric = await call("POST", `/api/agent/experiments/EXP-${experiment.id}/metrics`, {
      token: env.lead.token,
      json: { name: "plays", value: 321 },
    });
    expect(metric.status).toBe(201);
    const detail = (await (await call("GET", `/api/agent/experiments/${experiment.id}`, { token: env.lead.token })).json()) as {
      untrustedValue: number;
      trustedValue: number | null;
    };
    expect(detail).toMatchObject({ untrustedValue: 321, trustedValue: null });

    const overview = (await (await call("GET", "/api/agent/overview", { token: env.lead.token })).json()) as {
      running: unknown[];
      branches: Array<{ slug: string; freeEur: number }>;
    };
    expect(overview.running.length).toBe(1);
    expect(overview.branches.find((b) => b.slug === "games")?.freeEur).toBe(20);
  });

  it("slaat lessen op en zoekt ze terug", async () => {
    const add = await call("POST", "/api/agent/lessons", {
      token: env.lead.token,
      json: { lesson: "Thumbnails met één duidelijk object krijgen meer klikken.", branch: "games", tags: ["thumbnail"] },
    });
    expect(add.status).toBe(201);
    const found = (await (await call("GET", "/api/agent/lessons?q=thumbnails", { token: env.lead.token })).json()) as unknown[];
    expect(found.length).toBe(1);
  });

  it("geeft een agent geen manier om omzet te boeken", async () => {
    const res = await call("POST", "/api/owner/revenue", {
      token: env.lead.token,
      json: { amountEur: 100, branch: "games", source: "stripe" },
    });
    // Zonder HQ_ADMIN_TOKEN is de eigenaar-API alleen lokaal bereikbaar; met een token moet dat token kloppen.
    env.ctx.config.adminToken = "geheim";
    const denied = await call("POST", "/api/owner/revenue", {
      token: env.lead.token,
      json: { amountEur: 100, branch: "games", source: "stripe" },
    });
    expect(denied.status).toBe(401);
    expect(res.status).toBe(201); // de eerste call was 'lokaal' (geen admin-token ingesteld)
  });

  it("begrenst berichten van agents aan de eigenaar", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await call("POST", "/api/agent/notify", { token: env.lead.token, json: { text: `Update nummer ${i}` } })).status).toBe(201);
    }
    expect((await call("POST", "/api/agent/notify", { token: env.lead.token, json: { text: "Nog eentje" } })).status).toBe(429);
    expect(env.notifier.texts().filter((t) => t.startsWith("💬 Vega")).length).toBe(3);
  });

  it("toont sjablonen en neemt alleen aan met recht op aannemen", async () => {
    const templates = (await (await call("GET", "/api/agent/templates", { token: env.lead.token })).json()) as {
      agents: Array<{ key: string }>;
    };
    expect(templates.agents.map((t) => t.key)).toContain("verkenner");
    env.paperclip.companies.get(env.ctx.companyId)!.requireBoardApprovalForNewAgents = true;
    const denied = await call("POST", "/api/agent/hire", {
      token: env.lead.token,
      json: { template: "verkenner", branch: "games", reason: "Extra verkenner voor YouTube-comments en Reddit." },
    });
    expect(denied.status).toBe(403);
    env.paperclip.canCreateAgents.add(env.lead.id);
    const ok = await call("POST", "/api/agent/hire", {
      token: env.lead.token,
      json: { template: "verkenner", branch: "games", reason: "Extra verkenner voor YouTube-comments en Reddit." },
    });
    expect(ok.status).toBe(201);
    const hired = [...env.paperclip.agents.values()].find((a) => a.status === "pending_approval")!;
    expect(hired.adapterConfig).toMatchObject({ env: { HQ_URL: "http://127.0.0.1:8080", HQ_BRANCH: "games" } });
    expect(env.notifier.last()!.text).toContain("Nieuwe agent aannemen");
  });

  it("weigert alle agent-acties tijdens een noodstop", async () => {
    const halt = await app.request("/api/owner/halt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "test" }),
    });
    expect(halt.status).toBe(200);
    const res = await call("POST", "/api/agent/experiments", { token: env.scout.token, json: validProposal });
    expect(res.status).toBe(423);
    expect(((await (await app.request("/health")).json()) as { halted: boolean }).halted).toBe(true);
  });
});

describe("eigenaar-API en dashboard", () => {
  it("laat je vanuit het kantoor meten, boeken, beslissen, zoeken en opruimen", async () => {
    const proposed = await call("POST", "/api/agent/experiments", { token: env.scout.token, json: validProposal });
    const { experiment } = (await proposed.json()) as { experiment: { id: number } };
    const [approval] = await listApprovals(env.db, { status: ["pending"] });
    await call("POST", `/api/owner/approvals/${approval!.id}/decide`, { json: { decision: "approve" } });

    // Een meting uit het CrazyGames-portaal en de uitbetaling: allebei betrouwbaar, want van jou.
    expect((await call("POST", "/api/owner/metrics", { json: { experimentId: experiment.id, name: "plays", value: 740, source: "owner" } })).status).toBe(201);
    const revenue = { amountEur: 6.4, branch: "games", source: "crazygames", experimentId: experiment.id, description: "Advertenties" };
    expect((await call("POST", "/api/owner/revenue", { json: revenue })).status).toBe(201);
    const ledger = (await (await call("GET", "/api/owner/ledger?limit=5")).json()) as Array<Record<string, unknown>>;
    expect(ledger[0]).toMatchObject({ kind: "revenue", amountEur: 6.4, branch: "games", experiment: `EXP-${experiment.id}`, source: "crazygames" });

    // Zelf beslissen gaat langs hetzelfde pad als de automatische beoordeling (bericht, vervolgtaken).
    expect((await call("POST", `/api/owner/experiments/${experiment.id}/end`, { json: { verdict: "kill", reason: "x" } })).status).toBe(400);
    const end = await call("POST", `/api/owner/experiments/${experiment.id}/end`, { json: { verdict: "kill", reason: "Geen spelers na de eerste week" } });
    expect(end.status).toBe(200);
    expect(env.notifier.texts().some((t) => t.includes("KILL") && t.includes("Besloten door jou: Geen spelers"))).toBe(true);
    expect((await call("POST", `/api/owner/experiments/${experiment.id}/end`, { json: { verdict: "keep", reason: "Toch wel" } })).status).toBe(409);

    // Zoeken in de kennisbank, zonder dat er in het kantoor iemand naar de kennisbank loopt.
    await call("POST", "/api/agent/lessons", { token: env.lead.token, json: { lesson: "Korte levels houden spelers langer vast.", branch: "games" } });
    const found = (await (await call("GET", "/api/owner/knowledge?q=levels")).json()) as { lessons: Array<{ lesson: string }> };
    expect(found.lessons[0]!.lesson).toContain("Korte levels");
    expect((await env.ctx.events.recent()).some((e) => e.type === "knowledge.query" && e.text === "levels")).toBe(false);
    expect((await call("GET", "/api/owner/knowledge?q=ab")).status).toBe(400);

    // De nut-meter nu draaien: niemand kost hier geld zonder resultaat.
    expect(await (await call("POST", "/api/owner/value/pause", { json: {} })).json()).toEqual({ paused: [], skipped: null });
  });

  it("importeert omzet uit CSV zonder dubbel te tellen", async () => {
    const csv = [
      "date;amount_eur;branch;source;description",
      "2026-09-20;12,50;games;crazygames;Fluxgrid ads",
      "2026-09-21;3,10;games;crazygames;Fluxgrid ads",
      "2026-09-21;99;games;agent;mag niet",
    ].join("\n");
    const first = (await (await call("POST", "/api/owner/revenue/csv", { text: csv })).json()) as { imported: number; errors: string[] };
    expect(first.imported).toBe(2);
    expect(first.errors[0]).toContain("bron 'agent'");
    await call("POST", "/api/owner/revenue/csv", { text: csv });
    expect((await totals(env.db, { branchId: env.games.id })).revenue).toBe(15.6);
    // Zoals je het zelf zou schrijven: Nederlandse kolomnamen.
    const nl = ["Datum;Bedrag;Tak;Bron;Omschrijving", "2026-09-22;4,40;games;affiliate;Commissie"].join("\n");
    expect(await (await call("POST", "/api/owner/revenue/csv", { text: nl })).json()).toEqual({ imported: 1, errors: [] });
    expect((await totals(env.db, { branchId: env.games.id })).revenue).toBe(20);
  });

  it("toont het kantoor en het overzicht, en vraagt om inloggen als er een token is", async () => {
    const office = await app.request("/");
    expect(office.status).toBe(200);
    expect(await office.text()).toContain("/static/office.js");
    const open = await app.request("/overzicht");
    expect(open.status).toBe(200);
    const html = await open.text();
    expect(html).toContain("Wacht op jou");
    expect(html).toContain("Vega");

    env.ctx.config.adminToken = "geheim";
    expect((await app.request("/")).status).toBe(401);
    expect((await app.request("/overzicht")).status).toBe(401);
    expect((await app.request("/api/owner/office")).status).toBe(401);
    // Het demo-kantoor laat niets van het bedrijf zien en mag zonder inloggen.
    expect((await app.request("/demo")).status).toBe(200);
    const login = await app.request("/?token=geheim");
    expect(login.status).toBe(302);
    const cookie = login.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    const withCookie = await app.request("/", { headers: { cookie: cookie.split(";")[0]! } });
    expect(withCookie.status).toBe(200);
    const overzicht = await app.request("/overzicht", { headers: { cookie: cookie.split(";")[0]! } });
    expect(overzicht.status).toBe(200);
  });
});
