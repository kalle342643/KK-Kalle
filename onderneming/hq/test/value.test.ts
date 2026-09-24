import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { proposeExperiment } from "../src/domain/experiments.js";
import { addLesson } from "../src/domain/lessons.js";
import { buildDailyReport } from "../src/domain/report.js";
import { buildOfficeSnapshot } from "../src/office/snapshot.js";
import { computeAgentValues, valueReportLines } from "../src/office/value.js";
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
});
