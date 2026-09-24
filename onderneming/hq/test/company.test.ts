import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrap, formatBootstrapReport } from "../src/company/bootstrap.js";
import { AgentFactory } from "../src/company/factory.js";
import { defaultCompanyDir, loadCompany, render } from "../src/company/loader.js";
import { listApprovals } from "../src/domain/approvals.js";
import { getBranchBySlug } from "../src/domain/branches.js";
import { getSetting } from "../src/domain/settings.js";
import { decide, proposeBranch, registerWorkflowHooks } from "../src/domain/workflows.js";
import { createTestEnv, type TestEnv } from "./helpers/context.js";

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => {
  await env.close();
});

describe("bedrijf als code", () => {
  it("laadt de holding, skills en sjablonen zonder fouten", () => {
    const def = loadCompany();
    expect(def.company.name).toBe("KK Holding");
    expect(def.agents.map((a) => a.name).sort()).toEqual(["Argus", "Atlas"]);
    expect(def.skills.map((s) => s.name)).toContain("hq-api");
    expect(def.branchTemplates.map((b) => b.key).sort()).toEqual(["content", "games", "generiek", "saas"]);
    for (const t of def.agentTemplates) expect(t.instructions.length).toBeGreaterThan(200);
  });

  it("vangt tikfouten in verwijzingen af", () => {
    const dir = mkdtempSync(join(tmpdir(), "company-"));
    cpSync(defaultCompanyDir(), dir, { recursive: true });
    writeFileSync(
      join(dir, "templates", "branches", "kapot.yaml"),
      "name: Kapot\ndescription: x\nmonthlyBudgetEur: 10\nagents:\n  - { template: bestaat-niet, name: X, lead: true }\n",
    );
    expect(() => loadCompany(dir)).toThrow(/bestaat-niet/);
  });

  it("vult variabelen in", () => {
    expect(render("Hoi {{AGENT_NAME}} van {{BRANCH}} {{ONBEKEND}}", { AGENT_NAME: "Vega", BRANCH: "games" })).toBe(
      "Hoi Vega van games {{ONBEKEND}}",
    );
  });
});

describe("bootstrap naar Paperclip", () => {
  it("maakt bedrijf, skills, CEO, analist en routines aan, en werkt ze bij bij een tweede run", async () => {
    const def = loadCompany();
    const deps = { db: env.db, config: env.ctx.config, paperclip: env.paperclip, log: env.ctx.log };
    // Een verse installatie: geen bedrijf van tevoren bekend.
    await env.db.query("delete from settings");
    const first = await bootstrap(deps, def);
    expect(first.companyCreated).toBe(true);
    expect(first.agents.created.sort()).toEqual(["Argus", "Atlas"]);
    expect(first.skills.created.length).toBe(def.skills.length);
    expect(first.routines.created.length).toBe(3);
    expect(first.warnings).toEqual([]);

    const company = env.paperclip.companies.get(first.companyId)!;
    expect(company.requireBoardApprovalForNewAgents).toBe(true);
    const inCompany = [...env.paperclip.agents.values()].filter((a) => a.companyId === first.companyId);
    const atlas = inCompany.find((a) => a.name === "Atlas")!;
    const argus = inCompany.find((a) => a.name === "Argus")!;
    expect(atlas.status).toBe("idle"); // aanname automatisch goedgekeurd door bootstrap
    expect(argus.reportsTo).toBe(atlas.id);
    expect(atlas.adapterConfig).toMatchObject({ model: "claude-opus-5", env: { HQ_URL: "http://127.0.0.1:8080" } });
    expect(await getSetting(env.db, "agent_roles")).toMatchObject({ ceo: atlas.id, analyst: argus.id });
    const weekly = [...env.paperclip.routines.values()].find((r) => r.title === "Wekelijkse strategie")!;
    expect(weekly.assigneeAgentId).toBe(atlas.id);
    expect(weekly.triggers?.[0]).toMatchObject({ cronExpression: "0 7 * * 1", timezone: "Europe/Amsterdam" });

    // Tweede run zonder wijzigingen: niets nieuws, en agents blijven onaangeroerd.
    const second = await bootstrap(deps, def);
    expect(second.companyCreated).toBe(false);
    expect(second.companyId).toBe(first.companyId);
    expect(second.agents.created).toEqual([]);
    expect(second.agents.updated).toEqual([]);
    expect(second.skills.created).toEqual([]);
    expect(second.skills.updated).toEqual([]);
    expect(second.routines.created).toEqual([]);
    expect(second.routines.updated).toEqual([]);
    expect(formatBootstrapReport(second)).toContain("Agents: 0 nieuw, 0 bijgewerkt");

    // Jij verhoogde het budget van Atlas; een instructiewijziging mag dat niet terugdraaien.
    await env.paperclip.setAgentBudget(atlas.id, 9999);
    const changed = { ...def, agents: def.agents.map((a) => (a.name === "Atlas" ? { ...a, instructions: `${a.instructions}\n\nNieuwe regel.` } : a)) };
    const third = await bootstrap(deps, changed);
    expect(third.agents.updated).toEqual(["Atlas"]);
    expect(env.paperclip.agents.get(atlas.id)!.budgetMonthlyCents).toBe(9999);
  });
});

describe("Agent Factory", () => {
  it("bouwt na jouw akkoord een complete tak op uit een sjabloon", async () => {
    const factory = new AgentFactory(loadCompany(), "http://127.0.0.1:8080");
    registerWorkflowHooks({ createBranchFromTemplate: (ctx, p) => factory.createBranchFromTemplate(ctx, p).then(() => undefined) });
    env.paperclip.companies.get(env.ctx.companyId)!.requireBoardApprovalForNewAgents = true;
    const ceo = env.paperclip.seedAgent(env.ctx.companyId, { name: "Atlas", role: "ceo" });
    await env.db.query("update settings set value = $1 where key = 'agent_roles'", [JSON.stringify({ ceo: ceo.id, analyst: env.analyst.id })]);

    const request = await proposeBranch(
      env.ctx,
      {
        slug: "complyscan",
        name: "ComplyScan",
        template: "saas",
        pitch:
          "Toegankelijkheidsscans (WCAG/EAA) voor MKB-websites: veel vragen op ondernemersfora sinds de EAA van kracht werd, weinig betaalbare tools in het Nederlands.",
        evidence: ["https://www.w3.org/WAI/standards-guidelines/wcag/"],
      },
      `agent:${ceo.id}`,
    );
    expect(env.notifier.last()!.text).toContain("Nieuwe tak: ComplyScan");
    await decide(env.ctx, request.id, "approve", null, "owner");

    const branch = (await getBranchBySlug(env.db, "complyscan"))!;
    expect(branch.monthlyBudgetEur).toBe(40);
    const agents = [...env.paperclip.agents.values()].filter(
      (a) => (a.metadata?.hq as Record<string, unknown> | undefined)?.branch === "complyscan",
    );
    expect(agents.map((a) => a.name).sort()).toEqual(["Amstel", "IJssel", "Maas", "Rijn", "Schelde", "Waal"]);
    expect(agents.every((a) => a.status === "idle")).toBe(true); // aannames gedelegeerd goedgekeurd
    const maas = agents.find((a) => a.name === "Maas")!;
    expect(branch.leadAgentId).toBe(maas.id);
    expect(maas.reportsTo).toBe(ceo.id);
    expect(agents.find((a) => a.name === "Waal")!.reportsTo).toBe(maas.id);
    const routineTitles = [...env.paperclip.routines.values()].map((r) => r.title);
    expect(routineTitles).toContain("Ideeënraad ComplyScan");
    const approvals = await listApprovals(env.db, { status: ["approved"], limit: 100 });
    expect(approvals.filter((a) => a.kind === "hire_agent").length).toBe(6);
    expect(env.notifier.last()!.text).toContain("Tak ComplyScan staat klaar");
  });

  it("werkt tak-agents bij als hun sjabloon verandert", async () => {
    const def = loadCompany();
    const factory = new AgentFactory(def, "http://127.0.0.1:8080");
    await factory.createBranchFromTemplate(env.ctx, {
      slug: "shop",
      name: "Shop",
      template: "generiek",
      pitch: "x".repeat(60),
      evidence: ["https://example.com"],
      approvalId: 1,
    });
    expect((await factory.refreshBranchAgents(env.ctx)).updated).toEqual([]);

    const tweaked = {
      ...def,
      agentTemplates: def.agentTemplates.map((t) => (t.key === "bouwer" ? { ...t, model: "claude-opus-5" } : t)),
    };
    const refreshed = await new AgentFactory(tweaked, "http://127.0.0.1:8080").refreshBranchAgents(env.ctx);
    expect(refreshed.updated).toEqual(["Smid"]);
    const smid = [...env.paperclip.agents.values()].find((a) => a.name === "Smid")!;
    expect(smid.adapterConfig).toMatchObject({ model: "claude-opus-5" });
  });

  it("geeft namen een achtervoegsel als ze al bestaan", async () => {
    const factory = new AgentFactory(loadCompany(), "http://127.0.0.1:8080");
    env.paperclip.seedAgent(env.ctx.companyId, { name: "Kompas" });
    await factory.createBranchFromTemplate(env.ctx, {
      slug: "shop",
      name: "Shop",
      template: "generiek",
      pitch: "x".repeat(60),
      evidence: ["https://example.com"],
      approvalId: 1,
    });
    const names = [...env.paperclip.agents.values()].map((a) => a.name);
    expect(names).toContain("Kompas Shop");
  });
});

// Voorkom dat ongebruikte helpers de linter storen.
void mkdirSync;
