import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { audit } from "../src/domain/audit.js";
import { proposeExperiment } from "../src/domain/experiments.js";
import { halt } from "../src/domain/killswitch.js";
import { addLesson } from "../src/domain/lessons.js";
import { buildDailyReport } from "../src/domain/report.js";
import { buildOfficeSnapshot } from "../src/office/snapshot.js";
import { computeAgentValues, pauseIdleAgents, valueReportLines } from "../src/office/value.js";
import { PaperclipWatcher } from "../src/office/watcher.js";
import type { PcIssue } from "../src/paperclip/types.js";
import { createTestEnv, validProposal, type TestEnv } from "./helpers/context.js";

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => {
  await env.close();
});

describe("de nut-meter", () => {
  const at = "2026-09-20T10:00:00Z";

  it("zet naast elkaar wat een agent kostte en wat hij aantoonbaar opleverde", async () => {
    env.paperclip.addCost({ agentId: env.lead.id, costCents: 400, occurredAt: at });
    env.paperclip.addCost({ agentId: env.scout.id, costCents: 250, occurredAt: at });
    env.paperclip.addCost({ agentId: env.analyst.id, costCents: 20, occurredAt: at });
    // Kosten van lang geleden tellen niet mee.
    env.paperclip.addCost({ agentId: env.analyst.id, costCents: 9000, occurredAt: "2026-06-01T10:00:00Z" });
    await addLesson(env.ctx, { lesson: "Korte levels houden spelers langer vast.", branch: "games" }, `agent:${env.lead.id}`);
    await proposeExperiment(env.ctx, validProposal, `agent:${env.lead.id}`);

    const values = await computeAgentValues(env.ctx);
    const by = new Map(values.map((v) => [v.agentId, v]));
    expect(by.get(env.lead.id)).toMatchObject({ verdict: "levert", outputs: { lessons: 1, proposals: 1 }, outputTotal: 2 });
    expect(by.get(env.lead.id)!.costPerOutputEur).toBeGreaterThan(0);
    // Kost geld, levert niets aantoonbaars: bovenaan, met een waarschuwing.
    expect(by.get(env.scout.id)).toMatchObject({ verdict: "niets", outputTotal: 0, costPerOutputEur: null });
    expect(values[0]!.agentId).toBe(env.scout.id);
    // Te weinig uitgegeven om iets te zeggen.
    expect(by.get(env.analyst.id)).toMatchObject({ verdict: "rustig" });

    const lines = valueReportLines(values, new Map([[env.scout.id, "Rigel"]])).join("\n");
    expect(lines).toContain("💤 Kost geld zonder aantoonbaar resultaat (30 dagen): Rigel €2,");
    expect(valueReportLines(values.filter((v) => v.verdict !== "niets"), new Map())).toEqual([]);
  });

  it("staat in het kantoor en op maandag in het dagrapport", async () => {
    env.paperclip.addCost({ agentId: env.scout.id, costCents: 250, occurredAt: at });
    const snap = await buildOfficeSnapshot(env.ctx);
    expect(snap.stats.agents.find((v) => v.agentId === env.scout.id)).toMatchObject({ verdict: "niets" });

    expect(await buildDailyReport(env.ctx)).not.toContain("💤"); // woensdag
    env.clock.now = new Date("2026-09-28T06:00:00Z"); // maandag
    expect(await buildDailyReport(env.ctx)).toContain("💤 Kost geld zonder aantoonbaar resultaat (30 dagen): Rigel");
  });

  it("telt een afgeronde opdracht van een ander mee, maar geen routine en geen eigen taak", async () => {
    const issue = (title: string, extra: { createdByAgentId?: string; originKind?: string } = {}) =>
      env.paperclip.createIssue(env.ctx.companyId, { title, assigneeAgentId: env.scout.id, ...extra });
    const done = (i: PcIssue, status = "done") =>
      env.paperclip.addActivity({
        action: "issue.updated",
        actorType: "agent",
        actorId: env.scout.id,
        agentId: env.scout.id,
        entityType: "issue",
        entityId: i.id,
        details: { status, identifier: i.identifier, _previous: { status: "in_progress" } },
      });
    const fromLead = await issue("Bouw de eerste versie", { createdByAgentId: env.lead.id });
    done(fromLead);
    done(await issue("Mijn eigen lijstje", { createdByAgentId: env.scout.id }));
    done(await issue("Weekstart", { originKind: "routine_execution" }));
    done(await issue("Zoek uit wat de concurrent kost")); // van jou (het bord)
    done(fromLead, "in_review"); // alleen een andere status

    await new PaperclipWatcher(env.ctx).tick();
    const events = (await env.ctx.events.recent()).filter((e) => e.type === "task.done");
    expect(events.map((e) => e.text)).toEqual(["Bouw de eerste versie", "Zoek uit wat de concurrent kost"]);
    expect(events[0]).toMatchObject({ agentId: env.scout.id, targetAgentId: env.lead.id, data: { byOwner: false } });
    expect(events[1]).toMatchObject({ targetAgentId: null, data: { byOwner: true } });

    env.paperclip.addCost({ agentId: env.scout.id, costCents: 900, occurredAt: at });
    const scout = (await computeAgentValues(env.ctx)).find((v) => v.agentId === env.scout.id);
    expect(scout).toMatchObject({ verdict: "levert", outputs: { tasks: 2 }, outputTotal: 2 });
  });
});

describe("automatisch pauzeren", () => {
  const at = "2026-09-20T10:00:00Z";

  it("pauzeert wie geld kost zonder resultaat, en vertelt je hoe je hem terugzet", async () => {
    env.paperclip.addCost({ agentId: env.scout.id, costCents: 250, occurredAt: at });
    const result = await pauseIdleAgents(env.ctx);
    expect(result).toEqual({ paused: [{ agentId: env.scout.id, name: "Rigel", costEur: 2.25 }], skipped: null });
    expect(env.paperclip.agents.get(env.scout.id)!.status).toBe("paused");
    const message = env.notifier.sent.at(-1)!.text;
    expect(message).toContain("💤 Nut-meter: Rigel (€2,25) staat op pauze.");
    expect(message).toContain("▶️ Hervatten");
    const events = await env.ctx.events.recent();
    expect(events.find((e) => e.type === "agent.status")).toMatchObject({ agentId: env.scout.id, data: { to: "paused", by: "nut-meter" } });
    // Het kantoor weet dat de nut-meter hem pauzeerde.
    const values = await computeAgentValues(env.ctx);
    expect(values.find((v) => v.agentId === env.scout.id)!.autoPausedAt).not.toBeNull();
    expect(values.find((v) => v.agentId === env.lead.id)!.autoPausedAt).toBeNull();
    // Op maandag noemt het rapport hem niet meer (hij kost al niets meer), en een tweede ronde doet niets.
    env.clock.now = new Date("2026-09-28T06:00:00Z");
    expect(await buildDailyReport(env.ctx)).not.toContain("💤 Kost geld");
    expect((await pauseIdleAgents(env.ctx)).paused).toEqual([]);
  });

  it("geeft een nieuwe agent, en een die jij net weer aanzette, eerst twee weken", async () => {
    env.paperclip.addCost({ agentId: env.scout.id, costCents: 250, occurredAt: at });
    const scout = env.paperclip.agents.get(env.scout.id)!;
    scout.createdAt = new Date(env.clock.now.getTime() - 3 * 86_400_000).toISOString();
    expect((await pauseIdleAgents(env.ctx)).paused).toEqual([]);
    scout.createdAt = "2026-06-01T00:00:00Z";
    await audit(env.ctx.db, "owner", "agent.resume", { agentId: env.scout.id, name: "Rigel" });
    expect((await pauseIdleAgents(env.ctx)).paused).toEqual([]);
    expect(scout.status).toBe("idle");
  });

  it("pauzeert niemand als de meting niet te vertrouwen is, als het uit staat of bij een noodstop", async () => {
    env.paperclip.addCost({ agentId: env.scout.id, costCents: 250, occurredAt: at });
    env.paperclip.addCost({ agentId: env.analyst.id, costCents: 250, occurredAt: at });
    const tooMany = await pauseIdleAgents(env.ctx);
    expect(tooMany.paused).toEqual([]);
    expect(tooMany.skipped).toContain("te veel");
    expect(env.notifier.sent.at(-1)!.text).toContain("Ik pauzeer niemand");

    env.ctx.config.value.autoPause = false;
    expect((await pauseIdleAgents(env.ctx)).skipped).toContain("staat uit");
    env.ctx.config.value.autoPause = true;
    await halt(env.ctx, "test", "owner");
    expect((await pauseIdleAgents(env.ctx)).skipped).toContain("noodstop");
  });
});
