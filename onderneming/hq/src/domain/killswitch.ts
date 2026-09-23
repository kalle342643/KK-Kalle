import { audit } from "./audit.js";
import { DomainError } from "./branches.js";
import { errorMessage, type Actor, type AppContext } from "./context.js";
import { getSetting, setSetting } from "./settings.js";

export interface HaltState {
  halted: boolean;
  reason: string | null;
  at: string | null;
  by: string | null;
  /** Agents die HQ zelf gepauzeerd heeft; alleen die worden bij /resume weer aangezet. */
  pausedAgentIds: string[];
}

const KEY = "halt";
const EMPTY: HaltState = { halted: false, reason: null, at: null, by: null, pausedAgentIds: [] };

export async function haltState(ctx: Pick<AppContext, "db">): Promise<HaltState> {
  return (await getSetting<HaltState>(ctx.db, KEY)) ?? EMPTY;
}

export async function isHalted(ctx: Pick<AppContext, "db">): Promise<boolean> {
  return (await haltState(ctx)).halted;
}

/** Gooit een 423-fout als alles op stop staat. Gebruik vóór elke actie die geld of werk kost. */
export async function assertNotHalted(ctx: Pick<AppContext, "db">): Promise<void> {
  const s = await haltState(ctx);
  if (s.halted) throw new DomainError(`Alles staat op stop (${s.reason ?? "kill switch"}). Probeer het later opnieuw.`, 423);
}

export interface HaltResult {
  pausedAgents: number;
  cancelledRuns: number;
  errors: string[];
}

/**
 * De kill switch. Drie lagen:
 * 1. het bedrijf in Paperclip op 'paused' (nieuwe wake-ups worden geweigerd),
 * 2. elke actieve agent pauzeren,
 * 3. lopende runs afbreken.
 * Daarnaast weigert de HQ-API alle agent-acties zolang `halted` aan staat.
 */
export async function halt(ctx: AppContext, reason: string, actor: Actor): Promise<HaltResult> {
  const previous = await haltState(ctx);
  const result: HaltResult = { pausedAgents: 0, cancelledRuns: 0, errors: [] };
  // Eerst lokaal op stop, zodat agents meteen geblokkeerd zijn, ook als Paperclip onbereikbaar is.
  await setSetting(ctx.db, KEY, {
    ...previous,
    halted: true,
    reason,
    at: ctx.now().toISOString(),
    by: actor,
  } satisfies HaltState);

  const pausedIds = new Set(previous.pausedAgentIds);
  try {
    await ctx.paperclip.updateCompany(ctx.companyId, { status: "paused" });
  } catch (err) {
    result.errors.push(`bedrijf pauzeren: ${errorMessage(err)}`);
  }
  try {
    for (const agent of await ctx.paperclip.listAgents(ctx.companyId)) {
      if (agent.status === "paused" || agent.status === "terminated" || agent.status === "pending_approval") continue;
      try {
        await ctx.paperclip.pauseAgent(agent.id);
        pausedIds.add(agent.id);
        result.pausedAgents += 1;
      } catch (err) {
        result.errors.push(`${agent.name} pauzeren: ${errorMessage(err)}`);
      }
    }
  } catch (err) {
    result.errors.push(`agents ophalen: ${errorMessage(err)}`);
  }
  try {
    for (const run of await ctx.paperclip.listLiveRuns(ctx.companyId)) {
      try {
        await ctx.paperclip.cancelRun(run.id);
        result.cancelledRuns += 1;
      } catch (err) {
        result.errors.push(`run ${run.id} stoppen: ${errorMessage(err)}`);
      }
    }
  } catch (err) {
    result.errors.push(`runs ophalen: ${errorMessage(err)}`);
  }

  await setSetting(ctx.db, KEY, {
    halted: true,
    reason,
    at: ctx.now().toISOString(),
    by: actor,
    pausedAgentIds: [...pausedIds],
  } satisfies HaltState);
  await audit(ctx.db, actor, "halt", { reason, ...result });
  ctx.log.warn("kill switch geactiveerd", { reason, ...result });
  return result;
}

export async function resume(ctx: AppContext, actor: Actor): Promise<{ resumedAgents: number; errors: string[] }> {
  const state = await haltState(ctx);
  const errors: string[] = [];
  let resumedAgents = 0;
  try {
    await ctx.paperclip.updateCompany(ctx.companyId, { status: "active" });
  } catch (err) {
    errors.push(`bedrijf activeren: ${errorMessage(err)}`);
  }
  const stillPaused: string[] = [];
  for (const agentId of state.pausedAgentIds) {
    try {
      await ctx.paperclip.resumeAgent(agentId);
      resumedAgents += 1;
    } catch (err) {
      stillPaused.push(agentId);
      errors.push(`agent ${agentId} hervatten: ${errorMessage(err)}`);
    }
  }
  await setSetting(ctx.db, KEY, { ...EMPTY, pausedAgentIds: stillPaused } satisfies HaltState);
  await audit(ctx.db, actor, "resume", { resumedAgents, errors });
  ctx.log.info("kill switch opgeheven", { resumedAgents, errors });
  return { resumedAgents, errors };
}
