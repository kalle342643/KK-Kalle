import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/api/app.js";
import { formatApproval } from "../src/domain/approvals.js";
import { proposalSchema, proposeExperiment, recordMetric } from "../src/domain/experiments.js";
import { recordLedger, recordRevenue } from "../src/domain/ledger.js";
import { addLesson } from "../src/domain/lessons.js";
import { decide } from "../src/domain/workflows.js";
import { OfficeNotifier } from "../src/office/notifier.js";
import { buildOfficeSnapshot } from "../src/office/snapshot.js";
import type { OfficeProject, OfficeStats, ProjectDetail } from "../src/office/types.js";
import { PaperclipWatcher } from "../src/office/watcher.js";
import { createTestEnv, validProposal, type TestEnv } from "./helpers/context.js";

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => {
  await env.close();
});

const put = (body: unknown) => ({ method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const last = async () => (await env.ctx.events.recent(1))[0];

/** Een lopend experiment in de tak games, met de lead als verantwoordelijke. */
async function runningExperiment(): Promise<number> {
  const { approval } = await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), `agent:${env.lead.id}`);
  await decide(env.ctx, approval.id, "approve", null, "owner");
  return approval.experimentId!;
}

describe("bijnamen en uiterlijk", () => {
  it("geeft een agent een bijnaam en poppetje: zichtbaar in het kantoor en in Telegram", async () => {
    const app = createApp(env.ctx);
    const res = await app.request(`/api/owner/agents/${env.lead.id}/profile`, put({ nickname: "Fluxie", avatar: 4 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ agentId: env.lead.id, nickname: "Fluxie", avatar: 4 });
    expect(await last()).toMatchObject({ type: "agent.profile", agentId: env.lead.id, text: "Heet nu Fluxie", data: { changed: "nickname" } });

    // Alleen een ander poppetje: de bijnaam blijft staan.
    await app.request(`/api/owner/agents/${env.lead.id}/profile`, put({ avatar: 7 }));
    expect(await last()).toMatchObject({ text: "Nieuw uiterlijk", data: { nickname: "Fluxie", avatar: 7, changed: "avatar" } });

    const snap = await buildOfficeSnapshot(env.ctx);
    expect(snap.agents.find((a) => a.id === env.lead.id)).toMatchObject({ nickname: "Fluxie", avatar: 7 });

    const { approval } = await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), `agent:${env.lead.id}`);
    expect(await formatApproval(env.ctx, approval)).toContain("Fluxie (Vega)");

    // Leeg maken haalt de bijnaam weg.
    await app.request(`/api/owner/agents/${env.lead.id}/profile`, put({ nickname: "" }));
    expect(await last()).toMatchObject({ text: "Bijnaam weggehaald", data: { nickname: null, avatar: 7 } });
  });

  it("jij en de HQ-bot kunnen ook een naam en poppetje krijgen", async () => {
    const app = createApp(env.ctx);
    expect((await app.request("/api/owner/agents/owner/profile", put({ nickname: "Kalle", avatar: 0 }))).status).toBe(200);
    expect((await app.request("/api/owner/agents/hq-bot/profile", put({ nickname: "Bleep" }))).status).toBe(200);
    const snap = await buildOfficeSnapshot(env.ctx);
    expect(snap.people).toEqual([
      expect.objectContaining({ id: "owner", nickname: "Kalle", avatar: 0 }),
      expect.objectContaining({ id: "hq-bot", nickname: "Bleep", avatar: null }),
    ]);
  });

  it("controleert de invoer en kent alleen agents van dit bedrijf", async () => {
    const app = createApp(env.ctx);
    expect((await app.request(`/api/owner/agents/${env.lead.id}/profile`, put({ avatar: 12 }))).status).toBe(400);
    expect((await app.request(`/api/owner/agents/${env.lead.id}/profile`, put({ nickname: "x".repeat(31) }))).status).toBe(400);
    const foreign = env.paperclip.seedAgent("ander-bedrijf", { name: "Vreemd" });
    expect((await app.request(`/api/owner/agents/${foreign.id}/profile`, put({ nickname: "Hoi" }))).status).toBe(404);
    expect((await app.request("/api/owner/agents/bestaat-niet/profile", put({ nickname: "Hoi" }))).status).toBe(404);
  });
});

describe("projecten en cijfers", () => {
  it("projectenbord en projectdetails met metingen, lessen en tijdlijn", async () => {
    const id = await runningExperiment();
    await recordMetric(env.ctx, id, { name: "plays", value: 120, source: "crazygames", trusted: true }, "owner");
    await addLesson(env.ctx, { lesson: "Korte levels houden spelers langer vast", experimentId: id, tags: ["retentie"] }, `agent:${env.lead.id}`);
    // Iets over EXP-10 hoort niet bij EXP-1.
    await env.ctx.events.emit({ type: "talk", agentId: env.scout.id, text: `EXP-${id}0 is iets anders` });

    const app = createApp(env.ctx);
    const list = (await (await app.request("/api/owner/projects")).json()) as OfficeProject[];
    expect(list[0]).toMatchObject({ id, code: `EXP-${id}`, status: "running", branch: "games", metric: "plays", value: 120, trusted: true, leadAgentId: env.lead.id });

    const detail = (await (await app.request(`/api/owner/projects/${id}`)).json()) as ProjectDetail;
    expect(detail.metrics).toEqual([expect.objectContaining({ name: "plays", value: 120, trusted: true })]);
    expect(detail.lessons).toEqual([expect.objectContaining({ lesson: "Korte levels houden spelers langer vast" })]);
    expect(detail.events.map((e) => e.type)).toEqual(expect.arrayContaining(["metric", "experiment.started", "knowledge.write"]));
    expect(detail.events.some((e) => e.text?.includes(`EXP-${id}0`))).toBe(false);
    expect((await app.request("/api/owner/projects/999")).status).toBe(404);
  });

  it("omzet en kosten per dag en per tak, en de tokens van vandaag", async () => {
    await recordRevenue(env.ctx, { amountEur: 10, source: "stripe", externalId: "ch_1", occurredAt: env.clock.now, branchId: env.games.id });
    await recordLedger(env.db, { kind: "token_cost", amountEur: 2.5, source: "paperclip", externalId: "c1", occurredAt: env.clock.now, branchId: env.games.id });
    await env.ctx.events.emit({ type: "run.finished", agentId: env.lead.id, data: { tokensIn: 1000, tokensOut: 200 }, at: env.clock.now });

    const app = createApp(env.ctx);
    const stats = (await (await app.request("/api/owner/stats")).json()) as OfficeStats;
    expect(stats.days).toHaveLength(30);
    expect(stats.days.at(-1)).toMatchObject({ date: "2026-09-23", revenueEur: 10, costEur: 2.5 });
    expect(stats.branches.find((b) => b.slug === "games")).toMatchObject({ revenue30Eur: 10, cost30Eur: 2.5, budgetEur: 40 });
    expect(stats.totals).toMatchObject({ revenue30Eur: 10, cost30Eur: 2.5, tokensToday: 1200, runsToday: 1 });
  });

  it("de momentopname heeft het projectenbord en de cijfers al bij zich", async () => {
    const id = await runningExperiment();
    const snap = await buildOfficeSnapshot(env.ctx);
    expect(snap.projects.map((p) => p.id)).toEqual([id]);
    expect(snap.stats.days).toHaveLength(30);
    expect(snap.people.map((p) => p.id)).toEqual(["owner", "hq-bot"]);
  });
});

describe("de HQ-bot en Paperclip-runs", () => {
  it("elk bericht aan jou verschijnt in het kantoor als bericht van de HQ-bot", async () => {
    const notifier = new OfficeNotifier(env.notifier, env.ctx.events);
    await notifier.send({ text: "📊 Dagrapport: alles goed", buttons: [[{ label: "Ok", data: "x" }]] });
    expect(env.notifier.sent).toHaveLength(1);
    expect(await last()).toMatchObject({ type: "message.sent", agentId: "hq-bot", text: "📊 Dagrapport: alles goed", data: { buttons: true, channels: ["telegram"] } });
  });

  it("een klaar run neemt tokens, kosten en model mee (voor 'tokens vandaag')", async () => {
    env.paperclip.runs.set("run-9", {
      id: "run-9",
      status: "running",
      agentId: env.lead.id,
      startedAt: "2026-09-23T09:59:00Z",
      contextSnapshot: {},
    });
    const watcher = new PaperclipWatcher(env.ctx);
    await watcher.tick();
    const run = env.paperclip.runs.get("run-9")!;
    run.status = "succeeded";
    run.usageJson = { model: "claude-sonnet-5", inputTokens: 5000, outputTokens: 700, costUsd: 0.04 };
    await watcher.tick();
    const finished = (await env.ctx.events.recent()).find((e) => e.type === "run.finished")!;
    expect(finished.data).toMatchObject({ tokensIn: 5000, tokensOut: 700, costUsd: 0.04, model: "claude-sonnet-5" });
  });
});

describe("statische bestanden", () => {
  it("geeft niets buiten de map en alleen bekende soorten bestanden", async () => {
    const app = createApp(env.ctx);
    expect((await app.request("/static/../package.json")).status).toBe(404);
    expect((await app.request("/static/%2e%2e/%2e%2e/package.json")).status).toBe(404);
    expect((await app.request("/static/assets/iets.exe")).status).toBe(404);
    expect((await app.request("/static/bestaat-niet.js")).status).toBe(404);
    expect((await app.request("/static/%E0%A4%A.js")).status).toBe(404);
  });

  it("de demo is zonder inloggen te zien, het echte kantoor niet", async () => {
    const app = createApp({ ...env.ctx, config: { ...env.ctx.config, adminToken: "geheim" } });
    const demo = await app.request("/demo");
    expect(demo.status).toBe(200);
    expect(await demo.text()).toContain('data-mode="demo"');
    expect((await app.request("/kantoor")).status).toBe(401);
    expect((await app.request("/api/owner/projects")).status).toBe(401);
  });
});
