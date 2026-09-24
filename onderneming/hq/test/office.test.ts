import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/api/app.js";
import { listApprovals } from "../src/domain/approvals.js";
import { proposalSchema, proposeExperiment } from "../src/domain/experiments.js";
import { halt } from "../src/domain/killswitch.js";
import { recordRevenue } from "../src/domain/ledger.js";
import { decide } from "../src/domain/workflows.js";
import { shortText } from "../src/office/events.js";
import { buildOfficeSnapshot } from "../src/office/snapshot.js";
import type { OfficeEvent } from "../src/office/types.js";
import { counterpart, PaperclipWatcher } from "../src/office/watcher.js";
import { createTestEnv, validProposal, type TestEnv } from "./helpers/context.js";

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => {
  await env.close();
});

const types = async () => (await env.ctx.events.recent(100)).map((e) => e.type);

describe("kantoorgebeurtenissen", () => {
  it("slaat op, meldt aan wie meekijkt en slaat dubbele bronnen over", async () => {
    const seen: OfficeEvent[] = [];
    const stop = env.ctx.events.subscribe((e) => seen.push(e));
    expect(env.ctx.events.viewers).toBe(1);
    const first = await env.ctx.events.emit({ type: "talk", agentId: "a", targetAgentId: "b", text: "**Hoi** [Vega](x)\n\nhoe gaat het?", sourceKey: "k1" });
    expect(first?.text).toBe("Hoi Vega hoe gaat het?");
    expect(await env.ctx.events.emit({ type: "talk", agentId: "a", text: "nog een keer", sourceKey: "k1" })).toBeNull();
    await env.ctx.events.emit({ type: "halt", text: "test" });
    stop();
    expect(seen.map((e) => e.type)).toEqual(["talk", "halt"]);
    expect((await env.ctx.events.after(first!.id)).map((e) => e.type)).toEqual(["halt"]);
    expect(await env.ctx.events.lastId()).toBe(seen[1]!.id);
  });

  it("korte tekst: zonder Markdown, ingekort met …", () => {
    expect(shortText("`code` en *nadruk*", 50)).toBe("code en nadruk");
    expect(shortText("a".repeat(20), 10)).toBe(`${"a".repeat(9)}…`);
    expect(shortText("   ")).toBeNull();
  });

  it("echte acties verschijnen in het kantoor: verzoek, beslissing, experiment, omzet en noodstop", async () => {
    const { approval } = await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), `agent:${env.scout.id}`);
    const requested = (await env.ctx.events.recent()).find((e) => e.type === "approval.requested")!;
    expect(requested).toMatchObject({ agentId: env.scout.id, data: { kind: "experiment_start" } });

    await decide(env.ctx, approval.id, "approve", null, "owner");
    const decided = (await env.ctx.events.recent()).find((e) => e.type === "approval.decided")!;
    expect(decided.data).toMatchObject({ status: "approved", approvalId: approval.id });
    const started = (await env.ctx.events.recent()).find((e) => e.type === "experiment.started")!;
    expect(started.agentId).toBe(env.lead.id);

    const res = await recordRevenue(env.ctx, {
      amountEur: 12.5,
      source: "stripe",
      externalId: "ch_1",
      occurredAt: env.clock.now,
      branchId: env.games.id,
    });
    expect(res.inserted).toBe(true);
    // Dezelfde betaling nog eens importeren geeft geen tweede kassa-geluid.
    expect((await recordRevenue(env.ctx, { amountEur: 12.5, source: "stripe", externalId: "ch_1", occurredAt: env.clock.now, branchId: env.games.id })).inserted).toBe(false);
    expect((await types()).filter((t) => t === "revenue").length).toBe(1);
    const revenue = (await env.ctx.events.recent()).find((e) => e.type === "revenue")!;
    expect(revenue.data).toMatchObject({ amountEur: 12.5, branch: "games" });

    await halt(env.ctx, "test", "owner");
    expect(await types()).toContain("halt");
  });
});

describe("Paperclip meekijken", () => {
  it("wie werkt: run gestart met de taak, en weer klaar", async () => {
    const issue = await env.paperclip.createIssue(env.ctx.companyId, { title: "EXP-1: Fluxgrid bouwen", assigneeAgentId: env.lead.id });
    env.paperclip.runs.set("run-1", {
      id: "run-1",
      status: "running",
      agentId: env.lead.id,
      startedAt: "2026-09-23T09:59:00Z",
      contextSnapshot: { issueId: issue.id, wakeReason: "issue_assigned" },
    });
    const watcher = new PaperclipWatcher(env.ctx);
    await watcher.tick();
    const started = (await env.ctx.events.recent()).find((e) => e.type === "run.started")!;
    expect(started).toMatchObject({ agentId: env.lead.id, text: "EXP-1: Fluxgrid bouwen", data: { identifier: issue.identifier } });

    env.paperclip.runs.get("run-1")!.status = "succeeded";
    await watcher.tick();
    const finished = (await env.ctx.events.recent()).find((e) => e.type === "run.finished")!;
    expect(finished.data).toMatchObject({ runId: "run-1", status: "succeeded" });
    // Een tweede watcher (na een herstart) meldt dezelfde run niet opnieuw.
    await new PaperclipWatcher(env.ctx).tick();
    expect((await types()).filter((t) => t === "run.started").length).toBe(1);
  });

  it("subtaken van één taak zijn samen één klus (zoals de ideeënraad)", async () => {
    const council = await env.paperclip.createIssue(env.ctx.companyId, { title: "Ideeënraad Games-studio", assigneeAgentId: env.lead.id });
    const sub = await env.paperclip.createIssue(env.ctx.companyId, { title: "Waarnemingen: trending games", assigneeAgentId: env.scout.id, parentId: council.id });
    const solo = await env.paperclip.createIssue(env.ctx.companyId, { title: "Lessen EXP-2", assigneeAgentId: env.analyst.id });
    for (const [runId, agentId, issueId] of [
      ["run-a", env.lead.id, council.id],
      ["run-b", env.scout.id, sub.id],
      ["run-c", env.analyst.id, solo.id],
    ] as const) {
      env.paperclip.runs.set(runId, { id: runId, status: "running", agentId, startedAt: null, contextSnapshot: { issueId } });
      env.paperclip.agents.get(agentId)!.status = "running";
    }
    await new PaperclipWatcher(env.ctx).tick();
    const started = new Map((await env.ctx.events.recent()).filter((e) => e.type === "run.started").map((e) => [e.agentId, e.data]));
    expect(started.get(env.lead.id)).toMatchObject({ groupId: council.id, groupTitle: "Ideeënraad Games-studio" });
    expect(started.get(env.scout.id)).toMatchObject({ groupId: council.id, groupTitle: "Ideeënraad Games-studio" });
    expect(started.get(env.analyst.id)).toMatchObject({ groupId: solo.id, groupTitle: "Lessen EXP-2" });
    // Het kantoor krijgt het mee in de momentopname (ook na het herladen van de pagina).
    const snap = await buildOfficeSnapshot(env.ctx);
    expect(snap.agents.find((a) => a.id === env.scout.id)!.job).toEqual({ groupId: council.id, title: "Ideeënraad Games-studio" });
  });

  it("wie tegen wie praat: reacties en nieuwe taken tussen agents", async () => {
    const issue = await env.paperclip.createIssue(env.ctx.companyId, {
      title: "Top 5 pitches",
      assigneeAgentId: env.lead.id,
      createdByAgentId: env.scout.id,
    });
    env.paperclip.addActivity({
      action: "issue.created",
      actorType: "agent",
      actorId: env.scout.id,
      agentId: env.scout.id,
      entityType: "issue",
      entityId: issue.id,
      details: { title: issue.title, identifier: issue.identifier },
    });
    env.paperclip.addActivity({
      action: "issue.comment_added",
      actorType: "agent",
      actorId: env.lead.id,
      agentId: env.lead.id,
      entityType: "issue",
      entityId: issue.id,
      details: { bodySnippet: "Nummer 3 is **sterk**, maar de bron is dun.", identifier: issue.identifier, issueTitle: issue.title },
    });
    // Reactie van het bord (jij) en systeemregels leveren geen gepraat op.
    env.paperclip.addActivity({ action: "issue.comment_added", actorType: "user", actorId: "local-board", entityId: issue.id });
    env.paperclip.addActivity({ action: "routine.updated", actorType: "user", actorId: "local-board" });

    const watcher = new PaperclipWatcher(env.ctx);
    await watcher.tick();
    await watcher.tick(); // niets dubbel
    const talks = (await env.ctx.events.recent()).filter((e) => e.type === "talk");
    expect(talks).toHaveLength(2);
    expect(talks[0]).toMatchObject({ agentId: env.scout.id, targetAgentId: env.lead.id, text: "Nieuwe taak voor jou: Top 5 pitches" });
    expect(talks[1]).toMatchObject({ agentId: env.lead.id, targetAgentId: env.scout.id, text: "Nummer 3 is sterk, maar de bron is dun." });
  });

  it("sollicitanten, budgetstops en statuswissels", async () => {
    const watcher = new PaperclipWatcher(env.ctx);
    await watcher.tick();
    env.paperclip.addActivity({
      action: "agent.hire_created",
      actorType: "agent",
      actorId: env.lead.id,
      agentId: env.lead.id,
      entityType: "agent",
      entityId: "nieuw-1",
      details: { name: "Sirius", role: "engineer", requiresApproval: true },
    });
    env.paperclip.addActivity({
      action: "budget.hard_threshold_crossed",
      actorType: "system",
      details: { scopeType: "agent", scopeId: env.scout.id, amountLimit: 334, amountObserved: 400 },
    });
    await env.paperclip.pauseAgent(env.analyst.id);
    await watcher.tick();
    const events = await env.ctx.events.recent();
    expect(events.find((e) => e.type === "agent.hired")).toMatchObject({ agentId: "nieuw-1", data: { byAgentId: env.lead.id } });
    expect(events.find((e) => e.type === "budget.stop")?.agentId).toBe(env.scout.id);
    expect(events.find((e) => e.type === "agent.status")).toMatchObject({ agentId: env.analyst.id, data: { from: "idle", to: "paused" } });
  });

  it("met wie praat je: de uitvoerder, anders de maker, anders de eigenaar", () => {
    const issue = { id: "i", identifier: "X-1", title: "t", status: "todo", assigneeAgentId: "a", createdByAgentId: "b" };
    expect(counterpart(issue, "c")).toBe("a");
    expect(counterpart(issue, "a")).toBe("b");
    expect(counterpart({ ...issue, createdByAgentId: null }, "a")).toBeNull();
    expect(counterpart(null, "a")).toBeNull();
  });

  it("blijft werken als Paperclip even weg is", async () => {
    env.paperclip.listActivity = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(new PaperclipWatcher(env.ctx).tick()).resolves.toBeUndefined();
  });
});

describe("het kantoor in de browser", () => {
  it("de momentopname heeft agents per tak, jouw bureau en de laatste gebeurtenissen", async () => {
    await env.paperclip.updateAgent(env.lead.id, { metadata: { hq: { branch: "games", template: "tak-lead" } }, adapterConfig: { model: "claude-sonnet-5" } });
    await env.paperclip.updateAgent(env.analyst.id, { metadata: { hq: { hqRole: "analyst" } } });
    const { approval } = await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), `agent:${env.scout.id}`);
    expect(approval.status).toBe("pending");
    const snap = await buildOfficeSnapshot(env.ctx);
    expect(snap.companyName).toBe("Test Holding");
    const vega = snap.agents.find((a) => a.name === "Vega")!;
    expect(vega).toMatchObject({ branch: "games", hqRole: "lead", model: "claude-sonnet-5" });
    expect(snap.agents.find((a) => a.name === "Argus")).toMatchObject({ branch: "holding", hqRole: "analyst" });
    expect(snap.approvals).toHaveLength(1);
    expect(snap.kpis.pendingApprovals).toBe(1);
    expect(snap.branches.map((b) => b.slug)).toEqual(expect.arrayContaining(["holding", "games"]));
    expect(snap.events.at(-1)?.type).toBe("approval.requested");
    expect(snap.lastEventId).toBe(snap.events.at(-1)!.id);
    expect(snap.knowledge.source).toBe("hq");
  });

  it("owner-API: momentopname, live stroom en een agent pauzeren", async () => {
    const app = createApp(env.ctx);
    const snap = await app.request("/api/owner/office");
    expect(snap.status).toBe(200);

    // De live stroom stuurt gemiste gebeurtenissen na (Last-Event-ID) en daarna nieuwe.
    await env.ctx.events.emit({ type: "talk", agentId: env.lead.id, text: "eerste" });
    const controller = new AbortController();
    const res = await app.request("/api/owner/office/stream?after=0", { signal: controller.signal, headers: { "last-event-id": "0" } });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    await env.ctx.events.emit({ type: "knowledge.query", agentId: env.scout.id, text: "retentie mobiel" });
    let text = "";
    const decoder = new TextDecoder();
    while (!text.includes("retentie mobiel")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    controller.abort();
    expect(text).toContain("event: office");
    expect(text).toContain("retentie mobiel");

    const paused = await app.request(`/api/owner/agents/${env.scout.id}/pause`, { method: "POST" });
    expect(await paused.json()).toMatchObject({ status: "paused" });
    expect(env.paperclip.agents.get(env.scout.id)!.status).toBe("paused");
    expect((await env.ctx.events.recent()).at(-1)).toMatchObject({ type: "agent.status", agentId: env.scout.id });
    const foreign = env.paperclip.seedAgent("ander-bedrijf", { name: "Vreemd" });
    expect((await app.request(`/api/owner/agents/${foreign.id}/pause`, { method: "POST" })).status).toBe(404);
  });

  it("een gemiste beslissing uit de Paperclip-UI komt ook in het kantoor", async () => {
    const { approval } = await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), `agent:${env.scout.id}`);
    await env.paperclip.approve(approval.paperclipApprovalId, "via UI");
    const { syncApprovals } = await import("../src/domain/workflows.js");
    await syncApprovals(env.ctx);
    const decided = (await env.ctx.events.recent()).filter((e) => e.type === "approval.decided");
    expect(decided).toHaveLength(1);
    expect((await listApprovals(env.db, { status: ["approved"] }))[0]?.appliedAt).not.toBeNull();
  });
});
