import { audit } from "../domain/audit.js";
import { errorMessage, type AppContext } from "../domain/context.js";
import { isHalted } from "../domain/killswitch.js";
import { usdCentsToEur } from "../domain/money.js";
import type { AgentValue } from "./types.js";

/**
 * De nut-meter: wat kost een agent, en wat levert hij aantoonbaar op? Een agent die geld kost maar in 30 dagen
 * geen les, notitie, voorstel, meting, verzoek, taak voor een collega of afgeronde opdracht opleverde, is
 * "voor de sier". Allemaal gewoon tellen in de database: dit kost zelf geen AI.
 */

export const VALUE_DAYS = 30;
/** Onder dit bedrag in 30 dagen zeggen we nog niets: te weinig uitgegeven om over nut te oordelen. */
export const VALUE_MIN_COST_EUR = 1;
/** Een nieuwe agent, of een die jij weer aanzette, krijgt zoveel dagen voordat de nut-meter hem pauzeert. */
export const VALUE_GRACE_DAYS = 14;

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

type Counts = Map<string, number>;

async function countBy(ctx: AppContext, sql: string, params: unknown[]): Promise<Counts> {
  const rows = await ctx.db.query<{ agent_id: string | null; n: string | number }>(sql, params);
  return new Map(rows.filter((r) => r.agent_id).map((r) => [r.agent_id!, Number(r.n)]));
}

/** Per agent het laatste moment dat de nut-meter hem pauzeerde, als jij hem daarna niet weer aanzette. */
async function autoPaused(ctx: AppContext): Promise<Map<string, string>> {
  const rows = await ctx.db.query<{ agent_id: string; action: string; at: Date | string }>(
    `select details->>'agentId' as agent_id, action, max(at) as at from audit_log
     where action in ('agent.autopause', 'agent.resume') and details ? 'agentId' group by 1, 2`,
  );
  const last = new Map<string, { pause?: string; resume?: string }>();
  for (const r of rows) {
    const at = new Date(r.at).toISOString();
    const entry = last.get(r.agent_id) ?? {};
    if (r.action === "agent.autopause") entry.pause = at;
    else entry.resume = at;
    last.set(r.agent_id, entry);
  }
  const out = new Map<string, string>();
  for (const [id, e] of last) if (e.pause && (!e.resume || e.resume < e.pause)) out.set(id, e.pause);
  return out;
}

/** Rekent de nut-meter uit voor alle agents (behalve vertrokken). */
export async function computeAgentValues(ctx: AppContext): Promise<AgentValue[]> {
  const now = ctx.now();
  const from = new Date(now.getTime() - VALUE_DAYS * DAY_MS).toISOString();
  const to = new Date(now.getTime() + DAY_MS).toISOString();
  const agents = (await ctx.paperclip.listAgents(ctx.companyId)).filter((a) => a.status !== "terminated");
  const cost = new Map<string, number>();
  for (const c of await ctx.paperclip.costsByAgent(ctx.companyId, { from, to })) cost.set(c.agentId, usdCentsToEur(c.costCents, ctx.config.money.usdToEur));

  const [runs, failed, lessons, notes, proposals, measurements, requests, delegations, tasks, paused] = await Promise.all([
    countBy(ctx, "select agent_id, count(*) as n from office_events where type = 'run.finished' and at >= $1 group by agent_id", [from]),
    countBy(ctx, "select agent_id, count(*) as n from office_events where type = 'run.finished' and data->>'status' in ('failed', 'timed_out', 'error') and at >= $1 group by agent_id", [from]),
    countBy(ctx, "select substr(created_by, 7) as agent_id, count(*) as n from lessons where created_by like 'agent:%' and created_at >= $1 group by 1", [from]),
    countBy(ctx, "select agent_id, count(*) as n from notes where created_at >= $1 group by agent_id", [from]),
    countBy(ctx, "select proposed_by_agent_id as agent_id, count(*) as n from experiments where created_at >= $1 group by 1", [from]),
    countBy(ctx, "select substr(reported_by, 7) as agent_id, count(*) as n from metrics where reported_by like 'agent:%' and recorded_at >= $1 group by 1", [from]),
    // Een voorstel maakt zelf ook een verzoek aan jou; dat telt niet dubbel.
    countBy(ctx, "select requested_by_agent_id as agent_id, count(*) as n from approvals where kind <> 'experiment_start' and created_at >= $1 group by 1", [from]),
    countBy(ctx, "select agent_id, count(*) as n from office_events where type = 'talk' and data->>'kind' = 'delegate' and at >= $1 group by agent_id", [from]),
    // Een bouwer of schrijver levert in de taak zelf: een afgeronde opdracht van iemand anders telt mee.
    countBy(ctx, "select agent_id, count(*) as n from office_events where type = 'task.done' and at >= $1 group by agent_id", [from]),
    autoPaused(ctx),
  ]);

  const out: AgentValue[] = agents.map((a) => {
    const outputs = {
      lessons: lessons.get(a.id) ?? 0,
      notes: notes.get(a.id) ?? 0,
      proposals: proposals.get(a.id) ?? 0,
      measurements: measurements.get(a.id) ?? 0,
      requests: requests.get(a.id) ?? 0,
      delegations: delegations.get(a.id) ?? 0,
      tasks: tasks.get(a.id) ?? 0,
    };
    const outputTotal = Object.values(outputs).reduce((s, n) => s + n, 0);
    const costEur = round2(cost.get(a.id) ?? 0);
    const verdict: AgentValue["verdict"] = outputTotal > 0 ? "levert" : costEur >= VALUE_MIN_COST_EUR ? "niets" : "rustig";
    return {
      agentId: a.id,
      costEur,
      runs: runs.get(a.id) ?? 0,
      failedRuns: failed.get(a.id) ?? 0,
      outputs,
      outputTotal,
      verdict,
      costPerOutputEur: outputTotal > 0 && costEur > 0 ? round2(costEur / outputTotal) : null,
      autoPausedAt: a.status === "paused" ? (paused.get(a.id) ?? null) : null,
    };
  });
  // Wie geld kost zonder resultaat bovenaan, daarna de duurste.
  return out.sort((x, y) => Number(y.verdict === "niets") - Number(x.verdict === "niets") || y.costEur - x.costEur);
}

const cache = new WeakMap<AppContext, { at: number; values: AgentValue[] }>();

/** Idem, maar hooguit eens in de vijf minuten echt uitgerekend (het kantoor vraagt vaak). */
export async function agentValues(ctx: AppContext): Promise<AgentValue[]> {
  const hit = cache.get(ctx);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.values;
  try {
    const values = await computeAgentValues(ctx);
    cache.set(ctx, { at: Date.now(), values });
    return values;
  } catch (err) {
    ctx.log.warn("nut-meter uitrekenen mislukt", { error: errorMessage(err) });
    return hit?.values ?? [];
  }
}

export interface AutoPauseResult {
  paused: Array<{ agentId: string; name: string; costEur: number }>;
  /** Waarom er (deels) niets gebeurde: uitgezet, noodstop, of te veel tegelijk (dan klopt de meting vast niet). */
  skipped: string | null;
}

/**
 * Wat niets oplevert, kost ook niets meer: agents die in 30 dagen geld kostten zonder resultaat, gaan op pauze.
 * In het kantoor houden ze hun plek, zonder naam. Jij zet ze met één klik weer aan (en dan hebben ze weer
 * twee weken). Nooit meer dan de helft tegelijk: dan is eerder de meting kapot dan het hele team nutteloos.
 */
export async function pauseIdleAgents(ctx: AppContext): Promise<AutoPauseResult> {
  const result: AutoPauseResult = { paused: [], skipped: null };
  if (!ctx.config.value.autoPause) return { ...result, skipped: "automatisch pauzeren staat uit (HQ_AUTO_PAUSE)" };
  if (await isHalted(ctx)) return { ...result, skipped: "noodstop: alles staat al stil" };
  const now = ctx.now().getTime();
  const agents = new Map((await ctx.paperclip.listAgents(ctx.companyId)).map((a) => [a.id, a] as const));
  const active = [...agents.values()].filter((a) => !["paused", "terminated", "pending_approval"].includes(a.status));
  const resumed = await countBy(
    ctx,
    `select details->>'agentId' as agent_id, count(*) as n from audit_log
     where action = 'agent.resume' and at >= $1 group by 1`,
    [new Date(now - VALUE_GRACE_DAYS * DAY_MS).toISOString()],
  );
  const candidates = (await computeAgentValues(ctx)).filter((v) => {
    const agent = agents.get(v.agentId);
    if (v.verdict !== "niets" || !agent || !active.includes(agent)) return false;
    if (resumed.has(agent.id)) return false; // jij zette hem net weer aan: eerst laten zien wat hij doet
    const created = agent.createdAt ? Date.parse(agent.createdAt) : Number.NaN;
    return !(now - created < VALUE_GRACE_DAYS * DAY_MS); // nieuw: eerst een eerlijke kans
  });
  if (!candidates.length) return result;
  if (candidates.length > Math.floor(active.length / 2)) {
    const skipped = `${candidates.length} van de ${active.length} agents zouden op pauze gaan; dat is te veel om te vertrouwen`;
    ctx.log.warn("nut-meter: niet automatisch gepauzeerd", { reden: skipped });
    await ctx.notifier.send({
      text: `⚠️ Nut-meter: bij ${candidates.length} van de ${active.length} agents is niets terug te vinden. Ik pauzeer niemand, want dan klopt de meting waarschijnlijk niet (loopt het kantoor wel mee met Paperclip?). Kijk in het kantoor bij Statistieken.`,
    });
    return { ...result, skipped };
  }
  for (const v of candidates) {
    const agent = agents.get(v.agentId)!;
    try {
      const updated = await ctx.paperclip.pauseAgent(agent.id);
      await audit(ctx.db, "job:nut-meter", "agent.autopause", { agentId: agent.id, name: agent.name, costEur: v.costEur, days: VALUE_DAYS });
      await ctx.events.emit({
        type: "agent.status",
        agentId: agent.id,
        text: `${agent.name} is gepauzeerd door de nut-meter: kostte €${v.costEur.toFixed(2).replace(".", ",")} zonder resultaat`,
        data: { from: agent.status, to: updated.status, by: "nut-meter" },
      });
      result.paused.push({ agentId: agent.id, name: agent.name, costEur: v.costEur });
    } catch (err) {
      ctx.log.warn("nut-meter: pauzeren mislukt", { agent: agent.name, error: errorMessage(err) });
    }
  }
  cache.delete(ctx);
  if (result.paused.length) {
    const eur = (n: number) => `€${n.toFixed(2).replace(".", ",")}`;
    await ctx.notifier.send({
      text: [
        `💤 Nut-meter: ${result.paused.map((p) => `${p.name} (${eur(p.costEur)})`).join(", ")} ${result.paused.length === 1 ? "staat" : "staan"} op pauze.`,
        `In ${VALUE_DAYS} dagen kostte dat geld zonder les, notitie, voorstel, meting of afgeronde taak. In het kantoor ${result.paused.length === 1 ? "zit hij" : "zitten ze"} er nog, zonder naam.`,
        "Toch nodig? Klik op het poppetje en kies ▶️ Hervatten, het liefst met een duidelijke taak erbij.",
      ].join("\n"),
    });
  }
  return result;
}

/** Regels voor het rapport: wie kost geld zonder resultaat en draait nog? Leeg als iedereen iets oplevert. */
export function valueReportLines(values: AgentValue[], names: Map<string, string>, paused: Set<string> = new Set()): string[] {
  const idle = values.filter((v) => v.verdict === "niets" && !paused.has(v.agentId));
  if (!idle.length) return [];
  const eur = (n: number) => `€${n.toFixed(2).replace(".", ",")}`;
  return [
    "",
    `💤 Kost geld zonder aantoonbaar resultaat (${VALUE_DAYS} dagen): ${idle
      .slice(0, 6)
      .map((v) => `${names.get(v.agentId) ?? "onbekend"} ${eur(v.costEur)}`)
      .join(" · ")}. Geen les, notitie, voorstel, meting of afgeronde taak. Pauzeren kan in het kantoor.`,
  ];
}
