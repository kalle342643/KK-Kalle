import { z } from "zod";
import { audit } from "../domain/audit.js";
import { DomainError } from "../domain/branches.js";
import type { AppContext } from "../domain/context.js";
import { haltState } from "../domain/killswitch.js";
import { OWNER_ID } from "./profiles.js";

/**
 * Jij geeft een agent een taak vanuit het kantoor. Dat wordt een Paperclip-taak (issue) op naam van die
 * agent; Paperclip maakt de agent daarvoor wakker. In het kantoor loop jij er zelf even naartoe.
 */

export const taskSchema = z.object({
  title: z.string().trim().min(3, "schrijf in een paar woorden wat er moet gebeuren").max(200),
  description: z.string().trim().max(4000).optional(),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
});

export type TaskInput = z.infer<typeof taskSchema>;

export async function giveTask(ctx: AppContext, agentId: string, input: TaskInput): Promise<{ issueId: string; identifier: string | null }> {
  const halt = await haltState(ctx);
  if (halt.halted) throw new DomainError("De noodstop staat aan. Hervat eerst, dan kun je weer taken geven.", 423);
  const agent = await ctx.paperclip.getAgent(agentId).catch(() => null);
  if (!agent || agent.companyId !== ctx.companyId) throw new DomainError("Onbekende agent.", 404);
  if (agent.status === "terminated" || agent.status === "pending_approval") {
    throw new DomainError(`${agent.name} kan nu geen taken krijgen (${agent.status === "terminated" ? "vertrokken" : "nog niet aangenomen"}).`);
  }
  const issue = await ctx.paperclip.createIssue(ctx.companyId, {
    title: input.title,
    priority: input.priority,
    assigneeAgentId: agentId,
    description: [input.description ?? "", "", "_Opdracht van Kalle, via het kantoor. Vragen? Zet ze in een reactie op deze taak._"].join("\n").trim(),
  });
  await audit(ctx.db, "owner", "task.give", { agentId, issueId: issue.id, title: input.title });
  await ctx.events.emit({
    type: "talk",
    agentId: OWNER_ID,
    targetAgentId: agentId,
    text: `Nieuwe taak voor jou: ${input.title}`,
    data: { kind: "delegate", issueId: issue.id, identifier: issue.identifier ?? null, issueTitle: input.title, by: "owner" },
  });
  return { issueId: issue.id, identifier: issue.identifier ?? null };
}
