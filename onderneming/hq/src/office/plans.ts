/**
 * Kalle plant zelf. Zijn plan gaat als taak naar Atlas (de CEO), die het uitwerkt met de skill `plan-van-kalle`:
 * eerlijke kritiek, de goedkoopste echte test, een afdeling (een nieuwe tak vraagt hij bij Kalle aan) en de
 * verdeling over agents. Een plan komt uit het kantoor (van Kalle zelf) of van de hoofdagent op zijn Claude-account
 * (met HQ_PLAN_TOKEN). Geld, nieuwe agents en publiceren blijven altijd een verzoek aan Kalle.
 */
import { z } from "zod";
import { audit } from "../domain/audit.js";
import { DomainError } from "../domain/branches.js";
import type { AppContext } from "../domain/context.js";
import { haltState } from "../domain/killswitch.js";
import { OWNER_ID } from "./profiles.js";

export const planSchema = z.object({
  plan: z.string().trim().min(10, "schrijf je plan in minstens een paar woorden").max(8000),
  title: z.string().trim().min(3).max(120).optional(),
  /** Van de hoofdagent: de sessie waarin hij het plan uitwerkte (om terug te vinden). */
  session: z.url().max(300).optional(),
});

export type PlanInput = z.infer<typeof planSchema>;

export interface PlanSent {
  issueId: string;
  identifier: string | null;
  agentId: string;
  agentName: string;
}

/** Titel van de taak: de opgegeven titel, anders de eerste regel van het plan. */
export function planTitleOf(input: Pick<PlanInput, "plan" | "title">): string {
  if (input.title) return input.title;
  const first =
    input.plan
      .split(/\r?\n/)
      .map((l) => l.replace(/^#+\s*/, "").trim())
      .find(Boolean) ?? "Plan";
  return first.length > 80 ? `${first.slice(0, 79).trimEnd()}…` : first;
}

export async function sendPlanToCeo(ctx: AppContext, input: PlanInput, from: "owner" | "hoofdagent"): Promise<PlanSent> {
  const halt = await haltState(ctx);
  if (halt.halted) throw new DomainError("De noodstop staat aan. Hervat eerst, dan kan Atlas je plan oppakken.", 423);
  const agents = await ctx.paperclip.listAgents(ctx.companyId);
  const ceo = agents.find((a) => a.status !== "terminated" && ((a.metadata?.hq as { hqRole?: unknown } | undefined)?.hqRole === "ceo" || a.role === "ceo"));
  if (!ceo) throw new DomainError("Er is nog geen CEO (Atlas). Zet eerst het bedrijf neer met `hq bootstrap`.", 409);
  if (ceo.status === "pending_approval") throw new DomainError(`${ceo.name} is nog niet aangenomen; keur hem eerst goed.`, 409);
  const short = planTitleOf(input);
  const title = `Plan van Kalle: ${short}`;
  const origin =
    from === "hoofdagent"
      ? `_Uitgewerkt door de hoofdagent op Kalles Claude-account${input.session ? ` (${input.session})` : ""}._`
      : "_Plan van Kalle, via het kantoor._";
  const description = [
    input.plan,
    "",
    "---",
    origin,
    "Werk dit uit met je skill `plan-van-kalle`. Kalle plant zelf: bedenk er geen ander plan omheen, maar zeg eerlijk wat zwak is en wat de goedkoopste echte test is.",
  ].join("\n");
  const issue = await ctx.paperclip.createIssue(ctx.companyId, { title, priority: "high", assigneeAgentId: ceo.id, description });
  await audit(ctx.db, from === "owner" ? "owner" : "system", "plan.send", { agentId: ceo.id, issueId: issue.id, title: short, from });
  await ctx.events.emit({
    type: "talk",
    agentId: OWNER_ID,
    targetAgentId: ceo.id,
    text: `Nieuw plan voor jou: ${short}`,
    data: { kind: "delegate", issueId: issue.id, identifier: issue.identifier ?? null, issueTitle: title, by: from },
  });
  if (from === "hoofdagent") {
    // Kwam het niet van jou in het kantoor, dan hoor je het meteen (en kun je het stoppen).
    await ctx.notifier
      .send({ text: `🧭 De hoofdagent gaf ${ceo.name} een plan: ${short}. Klopt dat niet? Pauzeer ${ceo.name} in het kantoor of stuur /stop.` })
      .catch((err) => ctx.log.warn("plan: melding versturen mislukt", { error: String(err) }));
  }
  return { issueId: issue.id, identifier: issue.identifier ?? null, agentId: ceo.id, agentName: ceo.name };
}
