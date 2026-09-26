import type { Branch } from "../domain/branches.js";
import type { AppContext } from "../domain/context.js";
import { formatEur } from "../domain/money.js";
import { agentValues } from "../office/value.js";
import type { PcAgent } from "../paperclip/types.js";
import type { AgentSpec } from "./loader.js";

/**
 * De bezetting van een tak, gecontroleerd vóór elke aanname. Het onderzoek (docs/ONDERZOEK-AGENTS.md) zegt: een
 * extra agent helpt alleen met een eigen bron, een tegengestelde rol of een eigen vak voor werk dat al wacht. Twee
 * dingen kan HQ zelf nagaan zonder AI: zit de tak al vol met deze rol, en levert wie er al is iets op?
 */
export interface StaffingCheck {
  /** Waarom HQ deze aanname weigert (null = mag voorgelegd worden). */
  blocker: string | null;
  /** Wat Kalle bij het verzoek ziet: bezetting, kosten en wat er daarna gebeurt. */
  lines: string[];
}

const VERDICT: Record<string, string> = { levert: "levert", niets: "voor de sier?", rustig: "nog weinig gebruikt" };

const hqMeta = (a: PcAgent) => (a.metadata?.hq ?? {}) as { template?: string; branch?: string };

export async function checkStaffing(ctx: AppContext, spec: AgentSpec, branch: Branch, opts: { exceptAgentId?: string } = {}): Promise<StaffingCheck> {
  const inBranch = (await ctx.paperclip.listAgents(ctx.companyId)).filter(
    (a) => a.status !== "terminated" && a.id !== opts.exceptAgentId && hqMeta(a).branch === branch.slug,
  );
  const same = inBranch.filter((a) => hqMeta(a).template === spec.key);
  const values = new Map((await agentValues(ctx)).map((v) => [v.agentId, v]));

  const describe = (a: PcAgent) => {
    if (a.status === "paused") return `${a.name}: op pauze`;
    if (a.status === "pending_approval") return `${a.name}: wacht op jouw akkoord`;
    const v = values.get(a.id);
    return v ? `${a.name}: ${VERDICT[v.verdict]}` : a.name;
  };

  let blocker: string | null = null;
  const idle = same.find((a) => a.status === "paused" || values.get(a.id)?.verdict === "niets");
  if (idle) {
    blocker =
      idle.status === "paused"
        ? `${idle.name} (${spec.key}) staat op pauze in ${branch.name}. Vraag Kalle hem weer aan te zetten met een nieuwe taak of bron; een tweede ${spec.key} lost dat niet op.`
        : `${idle.name} (${spec.key}) kostte ${formatEur(values.get(idle.id)!.costEur)} in 30 dagen zonder resultaat. Geef hem eerst werk dat iets oplevert.`;
  } else if (same.length >= spec.maxPerBranch) {
    blocker = `${branch.name} heeft al ${same.length} × ${spec.key} (hooguit ${spec.maxPerBranch} per tak). Geef een van hen de taak.`;
  }

  const branchCost = inBranch.reduce((sum, a) => sum + (values.get(a.id)?.costEur ?? 0), 0);
  const lines = [
    `Bezetting ${branch.name}: ${inBranch.length} ${inBranch.length === 1 ? "agent" : "agents"}, waarvan ${same.length} × ${spec.key}` +
      (same.length ? ` (${same.map(describe).join(", ")})` : "") +
      `. Hooguit ${spec.maxPerBranch} per tak.`,
    `Kosten: deze agent tot ${formatEur(spec.budgetEur)} per maand (${spec.model}); de agents van ${branch.name} kostten de afgelopen 30 dagen samen ${formatEur(branchCost)}.`,
    "Na 14 dagen kijkt de nut-meter of hij iets oplevert. Zo niet, dan gaat hij vanzelf op pauze.",
  ];
  return { blocker, lines };
}

/** Voor aannames die buiten HQ om binnenkomen (rechtstreeks in Paperclip): wat weten we er wel van? */
export async function describeForeignHire(ctx: AppContext, spec: AgentSpec | null, branch: Branch | null, agentId: string | null): Promise<string> {
  if (!spec || !branch) {
    return "Let op: deze aanname kwam niet via HQ binnen. Sjabloon en tak zijn onbekend, dus HQ kon de bezetting niet controleren.";
  }
  const check = await checkStaffing(ctx, spec, branch, { exceptAgentId: agentId ?? undefined });
  return [...(check.blocker ? [`⚠️ HQ zou dit weigeren: ${check.blocker}`] : []), ...check.lines].join("\n");
}
