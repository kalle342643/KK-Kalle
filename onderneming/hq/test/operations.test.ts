import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getApproval, listApprovals } from "../src/domain/approvals.js";
import { getBranchBySlug } from "../src/domain/branches.js";
import { syncCosts } from "../src/domain/costs.js";
import { proposalSchema, proposeExperiment } from "../src/domain/experiments.js";
import { halt, haltState, resume } from "../src/domain/killswitch.js";
import { recordLedger, totals } from "../src/domain/ledger.js";
import { addLesson, searchLessons } from "../src/domain/lessons.js";
import { computePortfolio, proposePortfolio } from "../src/domain/portfolio.js";
import { buildDailyReport, buildStatus } from "../src/domain/report.js";
import { decide, syncApprovals } from "../src/domain/workflows.js";
import { createTestEnv, validProposal, type TestEnv } from "./helpers/context.js";

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => {
  await env.close();
});

describe("kill switch", () => {
  it("pauzeert bedrijf en agents en breekt lopende runs af", async () => {
    env.paperclip.runs.set("run-1", { id: "run-1", status: "running", agentId: env.lead.id, startedAt: null });
    const res = await halt(env.ctx, "test", "owner");
    expect(res).toMatchObject({ pausedAgents: 3, cancelledRuns: 1, errors: [] });
    expect(env.paperclip.companies.get(env.ctx.companyId)!.status).toBe("paused");
    expect([...env.paperclip.agents.values()].every((a) => a.status === "paused")).toBe(true);
    expect(env.paperclip.runs.get("run-1")!.status).toBe("cancelled");
    expect((await haltState(env.ctx)).halted).toBe(true);
  });

  it("hervat alleen agents die HQ zelf gepauzeerd heeft", async () => {
    await env.paperclip.pauseAgent(env.scout.id); // bv. door een budgetstop, los van de kill switch
    await halt(env.ctx, "test", "owner");
    await resume(env.ctx, "owner");
    expect(env.paperclip.agents.get(env.lead.id)!.status).toBe("idle");
    expect(env.paperclip.agents.get(env.scout.id)!.status).toBe("paused");
    expect(env.paperclip.companies.get(env.ctx.companyId)!.status).toBe("active");
    expect((await haltState(env.ctx)).halted).toBe(false);
  });

  it("zet HQ ook op stop als Paperclip onbereikbaar is", async () => {
    env.paperclip.listAgents = async () => {
      throw new Error("ECONNREFUSED");
    };
    const res = await halt(env.ctx, "test", "owner");
    expect(res.errors.join()).toContain("ECONNREFUSED");
    expect((await haltState(env.ctx)).halted).toBe(true);
  });
});

describe("kosten uit Paperclip", () => {
  it("boekt kosten per dag: projecten op hun tak, de rest op de holding", async () => {
    const { approval } = await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), `agent:${env.scout.id}`);
    await decide(env.ctx, approval.id, "approve", null, "owner");
    const projectId = [...env.paperclip.projects.keys()][0]!;
    env.paperclip.addCost({ projectId, agentId: env.lead.id, costCents: 400, occurredAt: "2026-09-23T08:00:00Z" });
    env.paperclip.addCost({ agentId: env.analyst.id, costCents: 100, occurredAt: "2026-09-22T12:00:00Z" });

    const first = await syncCosts(env.ctx);
    expect(first.todayEur).toBe(3.6);
    expect((await totals(env.db, { branchId: env.games.id })).tokenCost).toBe(3.6);
    const holding = (await getBranchBySlug(env.db, "holding"))!;
    expect((await totals(env.db, { branchId: holding.id })).tokenCost).toBe(0.9);

    // Opnieuw synchroniseren telt niets dubbel, maar werkt bedragen bij.
    env.paperclip.addCost({ projectId, costCents: 100, occurredAt: "2026-09-23T09:00:00Z" });
    await syncCosts(env.ctx);
    expect((await totals(env.db, { branchId: env.games.id })).tokenCost).toBe(4.5);
  });

  it("gooit alles op stop als de dagkosten boven het alarm komen", async () => {
    env.paperclip.addCost({ agentId: env.lead.id, costCents: 2000, occurredAt: "2026-09-23T09:00:00Z" });
    await syncCosts(env.ctx);
    expect((await haltState(env.ctx)).halted).toBe(true);
    expect(env.notifier.texts().some((t) => t.includes("Noodstop"))).toBe(true);
  });
});

describe("verzoeken uit Paperclip zelf", () => {
  it("toont een aanname door de CEO in Telegram en volgt een beslissing in de Paperclip-UI", async () => {
    env.paperclip.companies.get(env.ctx.companyId)!.requireBoardApprovalForNewAgents = true;
    const { approval: pc } = await env.paperclip.hireAgent(env.ctx.companyId, {
      name: "Sirius",
      role: "engineer",
      title: "Bouwer",
      adapterType: "claude_local",
      adapterConfig: { model: "claude-sonnet-5" },
      budgetMonthlyCents: 1000,
    });
    const first = await syncApprovals(env.ctx);
    expect(first.newPending).toBe(1);
    const msg = env.notifier.last()!;
    expect(msg.text).toContain("Nieuwe agent aannemen: Sirius (Bouwer)");
    expect(msg.text).toContain("claude-sonnet-5");

    // Twee keer synchroniseren meldt niet dubbel.
    await syncApprovals(env.ctx);
    expect(env.notifier.sent.length).toBe(1);

    await env.paperclip.approve(pc!.id, "via UI");
    const second = await syncApprovals(env.ctx);
    expect(second.decided).toBe(1);
    const [record] = await listApprovals(env.db, { status: ["approved"] });
    expect(record?.kind).toBe("hire_agent");
    expect(record?.appliedAt).not.toBeNull();
  });

  it("een budgetstop van een agent: 'verhoog' lost het incident op in Paperclip", async () => {
    env.paperclip.upsertBudgetPolicy(env.ctx.companyId, {
      scopeType: "agent",
      scopeId: env.lead.id,
      windowKind: "calendar_month_utc",
      amount: 1000,
    });
    env.paperclip.addCost({ agentId: env.lead.id, costCents: 1200 });
    expect(env.paperclip.agents.get(env.lead.id)!.status).toBe("paused");
    await syncApprovals(env.ctx);
    const [record] = await listApprovals(env.db, { status: ["pending"] });
    expect(record?.kind).toBe("budget_override");
    expect(env.notifier.last()!.buttons?.[0]?.[0]?.label).toContain("Verhoog");

    const decided = await decide(env.ctx, record!.id, "approve", null, "owner");
    expect(decided.status).toBe("approved");
    expect(env.paperclip.agents.get(env.lead.id)!.status).toBe("idle");
    expect(env.paperclip.agents.get(env.lead.id)!.budgetMonthlyCents).toBe(1500);
  });

  it("probeert een mislukte uitvoering later opnieuw", async () => {
    const { approval } = await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), `agent:${env.scout.id}`);
    const original = env.paperclip.createProject.bind(env.paperclip);
    env.paperclip.createProject = async () => {
      throw new Error("Paperclip down");
    };
    const failed = await decide(env.ctx, approval.id, "approve", null, "owner");
    expect(failed.appliedAt).toBeNull();
    expect(failed.applyError).toContain("Paperclip down");
    env.paperclip.createProject = original;
    const res = await syncApprovals(env.ctx);
    expect(res.retried).toBe(1);
    expect((await getApproval(env.db, approval.id))!.appliedAt).not.toBeNull();
  });
});

describe("portfolio", () => {
  it("geeft een tak met omzet meer budget, binnen het totaalplafond", async () => {
    await recordLedger(env.db, {
      kind: "revenue",
      amountEur: 100,
      source: "stripe",
      externalId: "ch_a",
      occurredAt: new Date("2026-09-20T10:00:00Z"),
      branchId: env.games.id,
    });
    const p = await computePortfolio(env.ctx);
    const games = p.branches.find((b) => b.branch.slug === "games")!;
    expect(games.proposedBudgetEur).toBe(50); // 20 start + 30% van 100
    expect(p.allowanceEur).toBe(70); // 40 plafond + 30% van 100

    const approval = await proposePortfolio(env.ctx, "job:weekly");
    expect(approval).not.toBeNull();
    await decide(env.ctx, approval!.id, "approve", null, "owner");
    expect((await getBranchBySlug(env.db, "games"))!.monthlyBudgetEur).toBe(50);
    expect(env.paperclip.companies.get(env.ctx.companyId)!.budgetMonthlyCents).toBe(7778);
  });

  it("stelt niets voor als er niets verandert", async () => {
    await env.db.query("update branches set monthly_budget_eur = 20 where slug = 'games'");
    expect(await proposePortfolio(env.ctx, "job:weekly")).toBeNull();
  });
});

describe("lessen en rapporten", () => {
  it("vindt lessen terug op tekst en tak", async () => {
    await addLesson(env.ctx, { lesson: "Idle-games scoren slecht op mobiel bij CrazyGames.", branch: "games", tags: ["mobiel"] }, "owner");
    await addLesson(env.ctx, { lesson: "Korte levels verhogen de speeltijd per sessie.", branch: "games" }, "owner");
    expect((await searchLessons(env.db, { text: "mobiel" })).length).toBe(1);
    expect((await searchLessons(env.db, { branchId: env.games.id })).length).toBe(2);
    expect((await searchLessons(env.db, { tag: "mobiel" }))[0]?.lesson).toContain("Idle");
  });

  it("het dagrapport noemt omzet, kosten en wat op jou wacht", async () => {
    await recordLedger(env.db, {
      kind: "revenue",
      amountEur: 18.4,
      source: "crazygames",
      externalId: "cg-2026-09-22",
      occurredAt: new Date("2026-09-22T12:00:00Z"),
      branchId: env.games.id,
    });
    await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), `agent:${env.scout.id}`);
    // Intl zet een harde spatie tussen € en het bedrag; normaliseer die voor de vergelijking.
    const text = (await buildDailyReport(env.ctx)).replace(/ /g, " ");
    expect(text).toContain("Dagrapport");
    expect(text).toMatch(/Omzet € 18,40/);
    expect(text).toContain("Wacht op jou: 1");
    const status = await buildStatus(env.ctx);
    expect(status).toContain("🟢");
    expect(status).toContain("Agents: 3");
  });
});
