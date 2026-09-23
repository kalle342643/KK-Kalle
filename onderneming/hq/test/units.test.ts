import { describe, expect, it } from "vitest";
import { testConfig } from "../src/config.js";
import { decide } from "../src/domain/evaluator.js";
import type { Experiment, ExperimentSnapshot } from "../src/domain/experiments.js";
import { eurToUsdCents, formatEur, usdCentsToEur } from "../src/domain/money.js";
import { addLocalDays, localDayKey, startOfLocalDay, startOfLocalMonth } from "../src/domain/time.js";
import type { Branch } from "../src/domain/branches.js";

describe("geld", () => {
  it("rekent Paperclip-centen om naar euro's en terug (naar boven afgerond)", () => {
    expect(usdCentsToEur(350, 0.9)).toBe(3.15);
    expect(eurToUsdCents(20, 0.9)).toBe(2223);
    expect(eurToUsdCents(20, 1)).toBe(2000);
  });

  it("formatteert bedragen op zijn Nederlands", () => {
    expect(formatEur(1234.5).replace(/\s/g, " ")).toBe("€ 1.234,50");
  });
});

describe("tijd in Europe/Amsterdam", () => {
  const tz = "Europe/Amsterdam";
  it("vindt lokale middernacht in de zomer (UTC+2) en winter (UTC+1)", () => {
    expect(startOfLocalDay(new Date("2026-09-23T10:00:00Z"), tz).toISOString()).toBe("2026-09-22T22:00:00.000Z");
    expect(startOfLocalDay(new Date("2026-12-01T10:00:00Z"), tz).toISOString()).toBe("2026-11-30T23:00:00.000Z");
  });

  it("telt dagen goed over de zomertijdwissel heen", () => {
    const sat = startOfLocalDay(new Date("2026-10-24T12:00:00Z"), tz);
    const mon = addLocalDays(sat, 2, tz);
    expect(localDayKey(mon, tz)).toBe("2026-10-26");
    expect(mon.toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("geeft de juiste lokale dag vlak na middernacht", () => {
    expect(localDayKey(new Date("2026-09-22T22:30:00Z"), tz)).toBe("2026-09-23");
    expect(startOfLocalMonth(new Date("2026-09-30T23:30:00Z"), tz).toISOString()).toBe("2026-09-30T22:00:00.000Z");
  });
});

describe("KEEP/ITERATE/KILL-regels", () => {
  const money = testConfig().money;
  const now = new Date("2026-10-10T12:00:00Z");
  const branch: Branch = {
    id: 2,
    slug: "games",
    name: "Games",
    description: null,
    template: null,
    status: "active",
    monthlyBudgetEur: 40,
    leadAgentId: null,
  };
  const exp = (over: Partial<Experiment> = {}): Experiment => ({
    id: 1,
    branchId: 2,
    parentId: null,
    iteration: 0,
    title: "Test",
    hypothesis: "h",
    metricName: "plays",
    metricTarget: 500,
    budgetEur: 20,
    durationDays: 14,
    status: "running",
    prediction: null,
    evidenceLinks: [],
    plan: null,
    proposedByAgentId: null,
    leadAgentId: null,
    paperclipProjectId: null,
    approvalId: null,
    startedAt: new Date("2026-10-01T00:00:00Z"),
    deadlineAt: new Date("2026-10-15T00:00:00Z"),
    endedAt: null,
    decisionReason: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    ...over,
  });
  const snap = (over: Partial<ExperimentSnapshot> = {}, e: Partial<Experiment> = {}): ExperimentSnapshot => ({
    experiment: exp(e),
    branch,
    spentEur: 5,
    revenueEur: 0,
    trustedValue: null,
    untrustedValue: null,
    budgetUsedPct: 0.25,
    budgetExhausted: false,
    daysLeft: 5,
    ...over,
  });

  it("KEEP zodra een betrouwbare meting het doel haalt, ook vóór de deadline", () => {
    expect(decide(snap({ trustedValue: 600 }), now, money).verdict).toBe("keep");
  });

  it("gaat door zolang deadline en budget niet op zijn", () => {
    expect(decide(snap({ trustedValue: 100 }), now, money).verdict).toBe("continue");
  });

  it("een agent-meting alleen is nooit genoeg voor KEEP", () => {
    expect(decide(snap({ untrustedValue: 5000 }), now, money).verdict).toBe("continue");
  });

  it("ITERATE na de deadline bij een echt signaal", () => {
    const late = new Date("2026-10-16T00:00:00Z");
    expect(decide(snap({ trustedValue: 260 }), late, money).verdict).toBe("iterate");
    expect(decide(snap({ untrustedValue: 600 }), late, money).verdict).toBe("iterate");
  });

  it("KILL na de deadline zonder signaal, of als het budget op is", () => {
    const late = new Date("2026-10-16T00:00:00Z");
    expect(decide(snap({ trustedValue: 100 }), late, money).verdict).toBe("kill");
    expect(decide(snap({ budgetExhausted: true, trustedValue: 10 }), now, money).verdict).toBe("kill");
  });

  it("KILL als het maximum aantal iteraties bereikt is", () => {
    const late = new Date("2026-10-16T00:00:00Z");
    const d = decide(snap({ trustedValue: 300 }, { iteration: money.maxIterations }), late, money);
    expect(d.verdict).toBe("kill");
    expect(d.reason).toContain("maximum");
  });
});
