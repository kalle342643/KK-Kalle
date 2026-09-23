import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import { audit } from "../domain/audit.js";
import { errorMessage, type AppContext, type Logger } from "../domain/context.js";
import { eurToUsdCents } from "../domain/money.js";
import { getSetting, setSetting } from "../domain/settings.js";
import type { PaperclipApi } from "../paperclip/client.js";
import type { PcAgent, PcRoutine } from "../paperclip/types.js";
import { AgentFactory } from "./factory.js";
import { render, type CompanyDefinition } from "./loader.js";
import { RecordingNotifier } from "../notify/notifier.js";

export interface BootstrapDeps {
  db: Db;
  config: Config;
  paperclip: PaperclipApi;
  log: Logger;
}

export interface BootstrapReport {
  companyId: string;
  companyCreated: boolean;
  skills: { created: string[]; updated: string[] };
  agents: { created: string[]; updated: string[] };
  routines: { created: string[]; updated: string[] };
  warnings: string[];
}

export const COMPANY_ID_SETTING = "paperclip_company_id";

/** Welk Paperclip-bedrijf is de holding? Env-variabele gaat voor, anders wat bootstrap heeft opgeslagen. */
export async function resolveCompanyId(deps: { db: Db; config: Config }): Promise<string | undefined> {
  return deps.config.paperclip.companyId ?? (await getSetting<string>(deps.db, COMPANY_ID_SETTING));
}

/**
 * Zet het bedrijf-als-code in Paperclip: bedrijf, skills, de vaste agents (CEO, analist) en routines.
 * Idempotent: opnieuw draaien werkt bestaande onderdelen bij in plaats van ze dubbel aan te maken.
 * Draai dit als eigenaar; de aannames die het doet keurt het daarom zelf goed.
 */
export async function bootstrap(deps: BootstrapDeps, def: CompanyDefinition): Promise<BootstrapReport> {
  const { paperclip, config } = deps;
  const report: BootstrapReport = {
    companyId: "",
    companyCreated: false,
    skills: { created: [], updated: [] },
    agents: { created: [], updated: [] },
    routines: { created: [], updated: [] },
    warnings: [],
  };

  // 1. Bedrijf
  let companyId = await resolveCompanyId(deps);
  if (!companyId) {
    const existing = (await paperclip.listCompanies()).find((c) => c.name === def.company.name && c.status !== "archived");
    if (existing) companyId = existing.id;
  }
  if (!companyId) {
    const created = await paperclip.createCompany({
      name: def.company.name,
      budgetMonthlyCents: eurToUsdCents(config.money.globalMonthlyCapEur, config.money.usdToEur),
    });
    companyId = created.id;
    report.companyCreated = true;
  }
  await paperclip.updateCompany(companyId, {
    description: def.company.description,
    requireBoardApprovalForNewAgents: def.company.requireBoardApprovalForNewAgents,
    budgetMonthlyCents: eurToUsdCents(config.money.globalMonthlyCapEur, config.money.usdToEur),
  });
  await setSetting(deps.db, COMPANY_ID_SETTING, companyId);
  report.companyId = companyId;

  // 2. Skills
  const skills = await paperclip.listSkills(companyId);
  for (const s of def.skills) {
    const found = skills.find((x) => x.slug === s.name);
    if (!found) {
      await paperclip.createSkill(companyId, { name: s.name, slug: s.name, markdown: s.markdown, tagline: s.tagline });
      report.skills.created.push(s.name);
    } else if ((found.markdown ?? "").trim() !== s.markdown.trim()) {
      await paperclip.updateSkillFile(companyId, found.id, "SKILL.md", s.markdown);
      report.skills.updated.push(s.name);
    }
  }

  // 3. Vaste agents (CEO eerst, zodat de rest aan hem kan rapporteren)
  const ctx: AppContext = {
    db: deps.db,
    config,
    paperclip,
    notifier: new RecordingNotifier(),
    companyId,
    now: () => new Date(),
    log: deps.log,
  };
  const factory = new AgentFactory(def, config.agentUrl);
  const roles = (await getSetting<Record<string, string>>(deps.db, "agent_roles")) ?? {};
  const current = await paperclip.listAgents(companyId);
  const byName = (name: string): PcAgent | undefined =>
    current.find((a) => a.name === name && a.status !== "terminated");
  const ordered = [...def.agents].sort((a, b) => Number(b.role === "ceo") - Number(a.role === "ceo"));
  const ids = new Map<string, string>();
  for (const spec of ordered) {
    const reportsTo = spec.role === "ceo" ? null : (spec.reportsTo ? ids.get(spec.reportsTo) : undefined) ?? roles.ceo ?? null;
    const hire = factory.buildHire(ctx, spec, { name: spec.name, branch: null, reportsTo });
    const existing = byName(spec.name);
    try {
      if (existing) {
        await paperclip.updateAgent(existing.id, {
          title: hire.title,
          capabilities: hire.capabilities,
          reportsTo: hire.reportsTo,
          adapterConfig: hire.adapterConfig,
          instructionsBundle: hire.instructionsBundle,
          runtimeConfig: hire.runtimeConfig,
          metadata: hire.metadata,
        });
        await paperclip.setAgentBudget(existing.id, hire.budgetMonthlyCents ?? 0);
        await paperclip.syncAgentSkills(existing.id, "add", spec.skills);
        ids.set(spec.name, existing.id);
        report.agents.updated.push(spec.name);
      } else {
        const { agent, approval } = await paperclip.hireAgent(companyId, hire);
        if (approval) await paperclip.approve(approval.id, "Bootstrap door de eigenaar (hq bootstrap).");
        ids.set(spec.name, agent.id);
        report.agents.created.push(spec.name);
      }
      if (spec.hqRole) roles[spec.hqRole] = ids.get(spec.name)!;
    } catch (err) {
      report.warnings.push(`agent ${spec.name}: ${errorMessage(err)}`);
    }
  }
  await setSetting(deps.db, "agent_roles", roles);

  // 4. Routines
  const routines = await paperclip.listRoutines(companyId);
  for (const r of def.company.routines) {
    const assignee = ids.get(r.assignee) ?? byName(r.assignee)?.id ?? null;
    const description = render(r.description, { HQ_URL: config.agentUrl, COMPANY: def.company.name });
    try {
      const existing: PcRoutine | undefined = routines.find((x) => x.title === r.title);
      if (existing) {
        await paperclip.updateRoutine(existing.id, { description, assigneeAgentId: assignee, priority: r.priority });
        const trigger = existing.triggers?.find((t) => t.kind === "schedule");
        if (trigger && (trigger.cronExpression !== r.cron || trigger.timezone !== config.timezone)) {
          await paperclip.updateRoutineTrigger(trigger.id, { cronExpression: r.cron, timezone: config.timezone, label: r.cron });
        } else if (!trigger) {
          await paperclip.addRoutineTrigger(existing.id, { kind: "schedule", label: r.cron, enabled: true, cronExpression: r.cron, timezone: config.timezone });
        }
        report.routines.updated.push(r.title);
      } else {
        const routine = await paperclip.createRoutine(companyId, {
          title: r.title,
          description,
          assigneeAgentId: assignee,
          priority: r.priority,
          status: "active",
          concurrencyPolicy: "skip_if_active",
          catchUpPolicy: "skip_missed",
        });
        await paperclip.addRoutineTrigger(routine.id, {
          kind: "schedule",
          label: r.cron,
          enabled: true,
          cronExpression: r.cron,
          timezone: config.timezone,
        });
        report.routines.created.push(r.title);
      }
    } catch (err) {
      report.warnings.push(`routine ${r.title}: ${errorMessage(err)}`);
    }
  }

  await audit(deps.db, "owner", "bootstrap", {
    companyId,
    skills: report.skills,
    agents: report.agents,
    routines: report.routines,
    warnings: report.warnings,
  });
  return report;
}

export function formatBootstrapReport(r: BootstrapReport): string {
  const list = (label: string, x: { created: string[]; updated: string[] }) =>
    `${label}: ${x.created.length} nieuw${x.created.length ? ` (${x.created.join(", ")})` : ""}, ${x.updated.length} bijgewerkt`;
  return [
    `Paperclip-bedrijf: ${r.companyId}${r.companyCreated ? " (nieuw aangemaakt)" : ""}`,
    list("Skills", r.skills),
    list("Agents", r.agents),
    list("Routines", r.routines),
    ...(r.warnings.length ? ["Waarschuwingen:", ...r.warnings.map((w) => `- ${w}`)] : []),
  ].join("\n");
}
