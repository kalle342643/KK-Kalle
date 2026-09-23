import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listApprovals } from "../src/domain/approvals.js";
import { evaluateRunning } from "../src/domain/evaluator.js";
import {
  getExperiment,
  proposeExperiment,
  proposalSchema,
  recordMetric,
  snapshot,
} from "../src/domain/experiments.js";
import { halt } from "../src/domain/killswitch.js";
import { recordLedger, totals } from "../src/domain/ledger.js";
import { decide, requestBudgetIncrease, requestSpend } from "../src/domain/workflows.js";
import { addDays } from "../src/domain/time.js";
import { createTestEnv, validProposal, type TestEnv } from "./helpers/context.js";

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => {
  await env.close();
});

const asScout = () => `agent:${env.scout.id}` as const;

describe("experiment voorstellen", () => {
  it("maakt een verzoek in Paperclip én HQ en stuurt jou knoppen", async () => {
    const { experiment, approval } = await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), asScout());
    expect(experiment.status).toBe("proposed");
    expect(experiment.leadAgentId).toBe(env.lead.id);
    const pc = env.paperclip.approvals.get(approval.paperclipApprovalId)!;
    expect(pc.type).toBe("request_board_approval");
    expect(pc.requestedByAgentId).toBe(env.scout.id);
    expect((pc.payload.hq as Record<string, unknown>).kind).toBe("experiment_start");
    const msg = env.notifier.last()!;
    expect(msg.text).toContain("Rigel");
    expect(msg.text).toContain("EXP-1");
    expect(msg.buttons?.[0]?.map((b) => b.data)).toEqual([`ap:${approval.id}:y`, `ap:${approval.id}:n`]);
  });

  it("weigert voorstellen zonder bronlink, te duur, te lang of bij de holding", async () => {
    expect(() => proposalSchema.parse({ ...validProposal, evidence: [] })).toThrow();
    expect(() => proposalSchema.parse({ ...validProposal, evidence: ["ftp://x.nl"] })).toThrow();
    await expect(
      proposeExperiment(env.ctx, proposalSchema.parse({ ...validProposal, budgetEur: 500 }), asScout()),
    ).rejects.toThrow(/maximum/);
    await expect(
      proposeExperiment(env.ctx, proposalSchema.parse({ ...validProposal, durationDays: 60 }), asScout()),
    ).rejects.toThrow(/maximaal/);
    await expect(
      proposeExperiment(env.ctx, proposalSchema.parse({ ...validProposal, branch: "holding" }), asScout()),
    ).rejects.toThrow(/holding/);
  });

  it("bewaakt het takbudget", async () => {
    await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), asScout());
    await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), asScout());
    await expect(proposeExperiment(env.ctx, proposalSchema.parse(validProposal), asScout())).rejects.toThrow(
      /Takbudget/,
    );
  });

  it("begrenst het aantal verzoeken per agent per dag", async () => {
    await env.db.query("update branches set monthly_budget_eur = 1000 where slug = 'games'");
    env.ctx.config.money.globalMonthlyCapEur = 1000;
    for (let i = 0; i < 5; i++) await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), asScout());
    await expect(proposeExperiment(env.ctx, proposalSchema.parse(validProposal), asScout())).rejects.toThrow(
      /Te veel/,
    );
  });

  it("weigert alles als de kill switch aan staat", async () => {
    await halt(env.ctx, "test", "owner");
    await expect(proposeExperiment(env.ctx, proposalSchema.parse(validProposal), asScout())).rejects.toMatchObject({
      status: 423,
    });
  });
});

describe("na jouw beslissing", () => {
  it("goedkeuren start het experiment met een hard budget in Paperclip", async () => {
    const { experiment, approval } = await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), asScout());
    const decided = await decide(env.ctx, approval.id, "approve", null, "owner");
    expect(decided.status).toBe("approved");
    expect(decided.appliedAt).not.toBeNull();

    const exp = (await getExperiment(env.db, experiment.id))!;
    expect(exp.status).toBe("running");
    expect(exp.deadlineAt?.toISOString()).toBe("2026-10-07T10:00:00.000Z");
    const project = env.paperclip.projects.get(exp.paperclipProjectId!)!;
    expect(project.name).toBe("EXP-1 Fluxgrid prototype op CrazyGames");
    const policy = [...env.paperclip.policies.values()].find((p) => p.scopeId === project.id)!;
    expect(policy).toMatchObject({ windowKind: "lifetime", hardStopEnabled: true, amount: 2223 });
    const issue = env.paperclip.issues.find((i) => i.projectId === project.id)!;
    expect(issue.assigneeAgentId).toBe(env.lead.id);
    expect(issue.description).toContain("Omzet boek je nooit zelf");
  });

  it("afwijzen zet het experiment op rejected", async () => {
    const { experiment, approval } = await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), asScout());
    await decide(env.ctx, approval.id, "reject", "te vaag", "owner");
    expect((await getExperiment(env.db, experiment.id))!.status).toBe("rejected");
    expect(env.paperclip.projects.size).toBe(0);
  });

  it("dubbel beslissen kan niet", async () => {
    const { approval } = await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), asScout());
    await decide(env.ctx, approval.id, "approve", null, "owner");
    await expect(decide(env.ctx, approval.id, "reject", null, "owner")).rejects.toThrow(/al goedgekeurd/);
  });
});

async function startedExperiment(): Promise<number> {
  const { experiment, approval } = await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), asScout());
  await decide(env.ctx, approval.id, "approve", null, "owner");
  return experiment.id;
}

describe("meten en beoordelen", () => {
  it("agent-metingen tellen als signaal, niet als bewijs", async () => {
    const id = await startedExperiment();
    await recordMetric(env.ctx, id, { name: "plays", value: 900, source: "agent", trusted: false }, `agent:${env.lead.id}`);
    const s = await snapshot(env.ctx, (await getExperiment(env.db, id))!);
    expect(s.untrustedValue).toBe(900);
    expect(s.trustedValue).toBeNull();
    expect(await evaluateRunning(env.ctx)).toEqual([expect.objectContaining({ verdict: "continue" })]);
  });

  it("KEEP bij een betrouwbare meting: lead krijgt een opschaaltaak, analist een lessentaak", async () => {
    const id = await startedExperiment();
    await recordMetric(env.ctx, id, { name: "plays", value: 650, source: "crazygames", trusted: true }, "owner");
    const [result] = await evaluateRunning(env.ctx);
    expect(result?.verdict).toBe("keep");
    expect((await getExperiment(env.db, id))!.status).toBe("keep");
    const titles = env.paperclip.issues.map((i) => i.title);
    expect(titles.some((t) => t.includes("KEEP") && t.includes("EXP-1"))).toBe(true);
    expect(env.paperclip.issues.some((i) => i.assigneeAgentId === env.analyst.id)).toBe(true);
    expect(env.notifier.texts().some((t) => t.includes("✅ KEEP"))).toBe(true);
  });

  it("KILL na de deadline zonder resultaat: project geannuleerd", async () => {
    const id = await startedExperiment();
    env.clock.now = addDays(env.clock.now, 15);
    const [result] = await evaluateRunning(env.ctx);
    expect(result?.verdict).toBe("kill");
    const exp = (await getExperiment(env.db, id))!;
    expect(exp.status).toBe("killed");
    expect(env.paperclip.projects.get(exp.paperclipProjectId!)!.status).toBe("cancelled");
  });

  it("budget op in Paperclip → direct beoordelen en het incident gepauzeerd laten", async () => {
    const id = await startedExperiment();
    const exp = (await getExperiment(env.db, id))!;
    env.paperclip.addCost({ projectId: exp.paperclipProjectId, costCents: 2300 });
    const [result] = await evaluateRunning(env.ctx);
    expect(result?.verdict).toBe("kill");
    expect(env.paperclip.calls.some((c) => c.includes("keep_paused"))).toBe(true);
  });

  it("omzet uit het grootboek telt als meetpunt voor revenue_eur", async () => {
    const { experiment, approval } = await proposeExperiment(
      env.ctx,
      proposalSchema.parse({ ...validProposal, metric: { name: "revenue_eur", target: 10 } }),
      asScout(),
    );
    await decide(env.ctx, approval.id, "approve", null, "owner");
    await recordLedger(env.db, {
      kind: "revenue",
      amountEur: 12.5,
      source: "stripe",
      externalId: "ch_1",
      occurredAt: env.clock.now,
      branchId: env.games.id,
      experimentId: experiment.id,
    });
    const [result] = await evaluateRunning(env.ctx);
    expect(result?.verdict).toBe("keep");
  });
});

describe("geld aanvragen", () => {
  it("extra budget na goedkeuring verhoogt het harde budget en hervat het project", async () => {
    const id = await startedExperiment();
    const exp = (await getExperiment(env.db, id))!;
    env.paperclip.addCost({ projectId: exp.paperclipProjectId, costCents: 2300 });
    const req = await requestBudgetIncrease(
      env.ctx,
      id,
      { amountEur: 30, reason: "Eerste week 800 plays, retentie goed; opschalen met twee extra levels." },
      `agent:${env.lead.id}`,
    );
    await decide(env.ctx, req.id, "approve", null, "owner");
    const after = (await getExperiment(env.db, id))!;
    expect(after.budgetEur).toBe(50);
    const policy = [...env.paperclip.policies.values()].find((p) => p.scopeId === exp.paperclipProjectId)!;
    expect(policy.amount).toBe(5556);
    expect(env.paperclip.calls.some((c) => c.includes("raise_budget_and_resume"))).toBe(true);
  });

  it("een goedgekeurde uitgave wordt geboekt, maar jij betaalt zelf", async () => {
    const req = await requestSpend(
      env.ctx,
      { amountEur: 12, what: "Domeinnaam fluxgrid.nl", vendor: "TransIP", reason: "Nodig voor de landingspagina van het experiment.", branch: "games" },
      `agent:${env.lead.id}`,
    );
    await decide(env.ctx, req.id, "approve", null, "owner");
    const t = await totals(env.db, { branchId: env.games.id });
    expect(t.spend).toBe(12);
    expect(env.notifier.last()!.text).toContain("Voer de betaling zelf uit bij TransIP");
    expect((await listApprovals(env.db, { status: ["approved"] })).length).toBe(1);
  });
});
