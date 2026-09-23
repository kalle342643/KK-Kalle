import { mirrorApproval, markApplied, notifyApproval } from "../domain/approvals.js";
import { audit, countRecent } from "../domain/audit.js";
import { DomainError, requireBranch, updateBranch, type Branch } from "../domain/branches.js";
import { errorMessage, type Actor, type AppContext } from "../domain/context.js";
import { eurToUsdCents, formatEur } from "../domain/money.js";
import { getSetting } from "../domain/settings.js";
import { ensureBranch, type BranchProposal } from "../domain/workflows.js";
import { PaperclipError } from "../paperclip/client.js";
import type { HireAgentInput, PcAgent } from "../paperclip/types.js";
import { render, type AgentSpec, type BranchTemplate, type CompanyDefinition } from "./loader.js";

export interface TemplateSummary {
  key: string;
  title: string;
  role: string;
  model: string;
  budgetEur: number;
  description: string;
}

/**
 * De Agent Factory: maakt van een sjabloon (company/templates/agents/*.md) een Paperclip-agent,
 * en van een tak-sjabloon (company/templates/branches/*.yaml) een complete tak met routines.
 * Nieuwe agents vragen altijd goedkeuring (requireBoardApprovalForNewAgents staat aan).
 */
export class AgentFactory {
  constructor(
    private readonly def: CompanyDefinition,
    /** Adres waarop agents HQ bereiken (komt als $HQ_URL in hun omgeving). */
    private readonly agentUrl: string,
  ) {}

  listTemplates(): TemplateSummary[] {
    return this.def.agentTemplates.map((t) => ({
      key: t.key,
      title: t.title,
      role: t.role,
      model: t.model,
      budgetEur: t.budgetEur,
      description: t.description,
    }));
  }

  listBranchTemplates(): Array<{ key: string; name: string; description: string; agents: string[] }> {
    return this.def.branchTemplates.map((b) => ({
      key: b.key,
      name: b.name,
      description: b.description,
      agents: b.agents.map((a) => `${a.name} (${a.template}${a.lead ? ", lead" : ""})`),
    }));
  }

  agentTemplate(key: string): AgentSpec {
    const t = this.def.agentTemplates.find((x) => x.key === key);
    if (!t) throw new DomainError(`Onbekend agent-sjabloon '${key}'. Kies uit: ${this.def.agentTemplates.map((x) => x.key).join(", ")}`, 404);
    return t;
  }

  branchTemplate(key: string): BranchTemplate {
    const t = this.def.branchTemplates.find((x) => x.key === key);
    if (!t) throw new DomainError(`Onbekend tak-sjabloon '${key}'. Kies uit: ${this.def.branchTemplates.map((x) => x.key).join(", ")}`, 404);
    return t;
  }

  /** Zet een sjabloon om naar een Paperclip-aanname. */
  buildHire(
    ctx: AppContext,
    spec: AgentSpec,
    opts: { name: string; branch: Branch | null; reportsTo: string | null },
  ): HireAgentInput {
    const vars = {
      HQ_URL: this.agentUrl,
      COMPANY: this.def.company.name,
      AGENT_NAME: opts.name,
      BRANCH: opts.branch?.slug ?? "holding",
      BRANCH_NAME: opts.branch?.name ?? "Holding",
    };
    return {
      name: opts.name,
      role: spec.role,
      title: opts.branch ? `${spec.title} · ${opts.branch.name}` : spec.title,
      icon: spec.icon ?? null,
      reportsTo: opts.reportsTo,
      capabilities: render(spec.description, vars),
      desiredSkills: spec.skills,
      adapterType: "claude_local",
      adapterConfig: {
        model: spec.model,
        ...(spec.effort ? { effort: spec.effort } : {}),
        ...(spec.maxTurnsPerRun ? { maxTurnsPerRun: spec.maxTurnsPerRun } : {}),
        ...(spec.timeoutSec ? { timeoutSec: spec.timeoutSec } : {}),
        env: { HQ_URL: this.agentUrl, HQ_BRANCH: vars.BRANCH },
      },
      instructionsBundle: { entryFile: "AGENTS.md", files: { "AGENTS.md": render(spec.instructions, vars) } },
      runtimeConfig: {
        heartbeat: spec.heartbeat.enabled
          ? { enabled: true, intervalSec: spec.heartbeat.intervalSec ?? 86_400 }
          : { enabled: false },
      },
      budgetMonthlyCents: eurToUsdCents(spec.budgetEur, ctx.config.money.usdToEur),
      permissions: { canCreateAgents: spec.canCreateAgents },
      metadata: { hq: { template: spec.key, branch: vars.BRANCH, hqRole: spec.hqRole ?? null } },
    };
  }

  /**
   * Een agent (meestal de CEO of een tak-lead) wil iemand aannemen. Dat gebeurt namens die agent,
   * zodat Paperclip zijn rechten controleert; het verzoek komt daarna als goedkeuring bij jou.
   */
  async hireForAgent(
    ctx: AppContext,
    input: { template: string; branch: string; name?: string; reason: string },
    requester: PcAgent,
    requesterToken: string,
  ): Promise<{ agentId: string; approvalId: number | null }> {
    const actor: Actor = `agent:${requester.id}`;
    if ((await countRecent(ctx.db, actor, ["agent.hire"], 24)) >= 3) {
      throw new DomainError("Maximaal 3 aannames per dag per agent.", 429);
    }
    const spec = this.agentTemplate(input.template);
    const branch = await requireBranch(ctx.db, input.branch);
    if (branch.status !== "active") throw new DomainError(`Tak '${branch.slug}' is ${branch.status}.`);
    const name = await this.uniqueName(ctx, input.name ?? spec.name, branch);
    const hire = this.buildHire(ctx, spec, { name, branch, reportsTo: branch.leadAgentId ?? requester.id });
    hire.capabilities = `${hire.capabilities}\n\nReden van aanname: ${input.reason}`;
    let hiredResult;
    try {
      hiredResult = await ctx.paperclip.hireAgent(ctx.companyId, hire, { asAgentToken: requesterToken });
    } catch (err) {
      if (err instanceof PaperclipError && err.status === 403) {
        throw new DomainError("Je hebt geen recht om agents aan te nemen. Vraag het je lead of de CEO.", 403);
      }
      throw err;
    }
    const { agent, approval } = hiredResult;
    await audit(ctx.db, actor, "agent.hire", { template: spec.key, branch: branch.slug, agentId: agent.id });
    let approvalId: number | null = null;
    if (approval) {
      const { record } = await mirrorApproval(ctx, approval);
      await notifyApproval(ctx, record);
      approvalId = record.id;
    }
    return { agentId: agent.id, approvalId };
  }

  private async uniqueName(ctx: AppContext, wanted: string, branch: Branch | null): Promise<string> {
    const taken = new Set((await ctx.paperclip.listAgents(ctx.companyId)).map((a) => a.name.toLowerCase()));
    if (!taken.has(wanted.toLowerCase())) return wanted;
    const withBranch = branch ? `${wanted} ${branch.name}` : wanted;
    if (!taken.has(withBranch.toLowerCase())) return withBranch;
    for (let i = 2; i < 100; i++) {
      const candidate = `${withBranch} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    throw new DomainError(`Geen vrije naam gevonden voor '${wanted}'.`);
  }

  /**
   * Bouwt een complete tak op uit een sjabloon. Wordt aangeroepen nadat JIJ de tak hebt goedgekeurd;
   * de aannames die daarbij horen keurt HQ daarom zelf goed (met verwijzing naar jouw besluit).
   */
  async createBranchFromTemplate(ctx: AppContext, proposal: BranchProposal & { approvalId: number }): Promise<Branch> {
    const template = this.branchTemplate(proposal.template);
    let branch = await ensureBranch(ctx, {
      slug: proposal.slug,
      name: proposal.name,
      template: template.key,
      description: template.description,
      monthlyBudgetEur: proposal.monthlyBudgetEur ?? template.monthlyBudgetEur,
    });
    const roles = (await getSetting<Record<string, string>>(ctx.db, "agent_roles")) ?? {};
    const hired = new Map<string, string>();
    const existing = await ctx.paperclip.listAgents(ctx.companyId);
    const ordered = [...template.agents].sort((a, b) => Number(b.lead) - Number(a.lead));
    for (const slot of ordered) {
      const already = existing.find(
        (a) => (a.metadata?.hq as Record<string, unknown> | undefined)?.branch === branch.slug && a.name === slot.name,
      );
      if (already) {
        hired.set(slot.name, already.id);
        continue;
      }
      const spec = this.agentTemplate(slot.template);
      const name = await this.uniqueName(ctx, slot.name, branch);
      const leadId = ordered.find((s) => s.lead) ? hired.get(ordered.find((s) => s.lead)!.name) : undefined;
      const reportsTo = slot.lead ? roles.ceo ?? null : leadId ?? roles.ceo ?? null;
      const { agent, approval } = await ctx.paperclip.hireAgent(ctx.companyId, this.buildHire(ctx, spec, { name, branch, reportsTo }));
      hired.set(slot.name, agent.id);
      if (approval) {
        const approved = await ctx.paperclip.approve(
          approval.id,
          `Automatisch: onderdeel van tak '${branch.slug}' die de eigenaar goedkeurde (HQ #${proposal.approvalId}).`,
        );
        const { record } = await mirrorApproval(ctx, approved);
        await markApplied(ctx.db, record.id);
      }
      if (slot.lead) branch = await updateBranch(ctx.db, branch.id, { leadAgentId: agent.id });
    }

    const routineErrors: string[] = [];
    const existingRoutines = await ctx.paperclip.listRoutines(ctx.companyId);
    for (const r of template.routines) {
      const title = render(r.title, { BRANCH_NAME: branch.name, BRANCH: branch.slug });
      if (existingRoutines.some((x) => x.title === title)) continue;
      try {
        const routine = await ctx.paperclip.createRoutine(ctx.companyId, {
          title,
          description: render(r.description, { BRANCH_NAME: branch.name, BRANCH: branch.slug, HQ_URL: this.agentUrl }),
          assigneeAgentId: hired.get(r.assignee) ?? null,
          priority: r.priority,
          status: "active",
          concurrencyPolicy: "skip_if_active",
          catchUpPolicy: "skip_missed",
        });
        await ctx.paperclip.addRoutineTrigger(routine.id, {
          kind: "schedule",
          label: r.cron,
          enabled: true,
          cronExpression: r.cron,
          timezone: ctx.config.timezone,
        });
      } catch (err) {
        routineErrors.push(`${title}: ${errorMessage(err)}`);
      }
    }
    await audit(ctx.db, "system", "branch.build", { slug: branch.slug, agents: [...hired.keys()], routineErrors });
    await ctx.notifier.send({
      text: [
        `🌱 Tak ${branch.name} staat klaar (sjabloon ${template.key}).`,
        `Agents: ${[...hired.keys()].join(", ")}`,
        `Budget: ${formatEur(branch.monthlyBudgetEur)} per maand`,
        routineErrors.length ? `⚠️ Routines niet gelukt: ${routineErrors.join("; ")}` : `Routines: ${template.routines.length}`,
      ].join("\n"),
    });
    return branch;
  }
}
