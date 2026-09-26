import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentFactory } from "../src/company/factory.js";
import { defaultCompanyDir, effortProblem, loadCompany } from "../src/company/loader.js";
import { listApprovals } from "../src/domain/approvals.js";
import { registerWorkflowHooks, syncApprovals } from "../src/domain/workflows.js";
import type { PcAgent } from "../src/paperclip/types.js";
import { createTestEnv, type TestEnv } from "./helpers/context.js";

describe("model en denkstand per rol", () => {
  it("elke rol kiest zijn effort zelf, behalve Haiku (dat kent het niet)", () => {
    const def = loadCompany();
    for (const a of [...def.agents, ...def.agentTemplates]) expect(effortProblem(a.model, a.effort), a.key).toBeNull();
    expect(effortProblem("claude-haiku-4-5", "low")).toMatch(/kent geen effort/);
    expect(effortProblem("claude-sonnet-5", undefined)).toMatch(/kies een effort/);
    expect(effortProblem("gratis", undefined)).toBeNull(); // geen Claude-model: niets over te zeggen
  });

  it("een sjabloon zonder effort laadt niet", () => {
    const dir = mkdtempSync(join(tmpdir(), "company-"));
    cpSync(defaultCompanyDir(), dir, { recursive: true });
    const path = join(dir, "templates", "agents", "schrijver.md");
    writeFileSync(path, readFileSync(path, "utf8").replace("effort: medium\n", ""));
    expect(() => loadCompany(dir)).toThrow(/schrijver\.md: kies een effort/);
  });

  it("de sjablonen zeggen hoeveel er per tak mogen, en GET /templates laat het zien", () => {
    const factory = new AgentFactory(loadCompany(), "http://127.0.0.1:8080");
    const max = Object.fromEntries(factory.listTemplates().map((t) => [t.key, t.maxPerBranch]));
    expect(max).toEqual({ bouwer: 2, criticus: 1, publicist: 1, schrijver: 2, "tak-lead": 1, verkenner: 3 });
    expect(factory.listTemplates().find((t) => t.key === "criticus")).toMatchObject({ model: "claude-sonnet-5", effort: "medium" });
  });
});

describe("de Agent Factory controleert de bezetting", () => {
  let env: TestEnv;
  let factory: AgentFactory;
  beforeEach(async () => {
    env = await createTestEnv();
    factory = new AgentFactory(loadCompany(), "http://127.0.0.1:8080");
    env.paperclip.companies.get(env.ctx.companyId)!.requireBoardApprovalForNewAgents = true;
    env.paperclip.canCreateAgents.add(env.lead.id);
  });
  afterEach(async () => {
    await env.close();
  });

  const colleague = (name: string, template: string, extra: Partial<PcAgent> = {}) =>
    env.paperclip.seedAgent(env.ctx.companyId, { name, metadata: { hq: { template, branch: "games" } }, ...extra });
  const hire = (template: string) =>
    factory.hireForAgent(
      env.ctx,
      { template, branch: "games", reason: "Niemand volgt de YouTube-reacties; 5 waarnemingen per week uit die bron." },
      env.paperclip.agents.get(env.lead.id)!,
      env.lead.token,
    );

  it("weigert een tweede criticus: twee kopieën van hetzelfde model zien dezelfde dingen", async () => {
    colleague("Castor", "criticus");
    await expect(hire("criticus")).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/al 1 × criticus \(hooguit 1 per tak\)/) });
    expect(env.paperclip.calls.filter((c) => c.startsWith("hireAgent"))).toEqual([]);
  });

  it("weigert zolang een collega met dezelfde rol op pauze staat", async () => {
    colleague("Deneb", "verkenner", { status: "paused" });
    await expect(hire("verkenner")).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Deneb \(verkenner\) staat op pauze/) });
  });

  it("weigert zolang een collega met dezelfde rol geld kost zonder resultaat", async () => {
    const deneb = colleague("Deneb", "verkenner");
    env.paperclip.addCost({ agentId: deneb.id, costCents: 250, occurredAt: "2026-09-20T10:00:00Z" });
    await expect(hire("verkenner")).rejects.toMatchObject({ message: expect.stringMatching(/Deneb \(verkenner\) kostte .* zonder resultaat/) });
  });

  it("zet de bezetting en de kosten van de tak bovenaan het verzoek aan Kalle", async () => {
    colleague("Deneb", "verkenner");
    const { approvalId } = await hire("verkenner");
    const record = (await listApprovals(env.db, { limit: 10 })).find((a) => a.id === approvalId)!;
    expect(record.summary!.split("\n").slice(0, 3)).toEqual([
      "Bezetting Games: 1 agent, waarvan 1 × verkenner (Deneb: nog weinig gebruikt). Hooguit 3 per tak.",
      expect.stringMatching(/^Kosten: deze agent tot .* per maand \(claude-haiku-4-5\); de agents van Games kostten de afgelopen 30 dagen samen /),
      "Na 14 dagen kijkt de nut-meter of hij iets oplevert. Zo niet, dan gaat hij vanzelf op pauze.",
    ]);
    expect(record.summary).toContain("Reden van aanname: Niemand volgt de YouTube-reacties");
    expect(env.notifier.last()!.text).toContain("Bezetting Games: 1 agent");
  });

  it("een aanname buiten HQ om krijgt een waarschuwing, en die via Paperclip met HQ-gegevens de bezetting", async () => {
    registerWorkflowHooks({ describeHire: (c, payload) => factory.describeHireApproval(c, payload) });
    // Een agent nam rechtstreeks in Paperclip iemand aan: geen sjabloon, geen tak.
    await env.paperclip.hireAgent(env.ctx.companyId, { name: "Zwerver", role: "general", adapterType: "claude_local", adapterConfig: {} });
    // En een aanname met HQ-gegevens voor een rol die al vol zit.
    colleague("Castor", "criticus");
    await env.paperclip.hireAgent(env.ctx.companyId, {
      name: "Pollux",
      role: "researcher",
      adapterType: "claude_local",
      adapterConfig: {},
      metadata: { hq: { template: "criticus", branch: "games" } },
    });
    expect((await syncApprovals(env.ctx)).newPending).toBe(2);
    const summaries = (await listApprovals(env.db, { limit: 10 })).map((a) => a.summary ?? "");
    expect(summaries.some((s) => s.startsWith("Let op: deze aanname kwam niet via HQ binnen."))).toBe(true);
    const pollux = summaries.find((s) => s.includes("× criticus"))!;
    expect(pollux).toMatch(/^⚠️ HQ zou dit weigeren: Games heeft al 1 × criticus/);
    // De nieuwe agent zelf telt niet mee als zijn eigen collega.
    expect(pollux).toContain("waarvan 1 × criticus (Castor: nog weinig gebruikt)");
  });
});
