import { errorMessage, type AppContext } from "../domain/context.js";
import { usdCentsToEur } from "../domain/money.js";
import type { AgentValue } from "./types.js";

/**
 * De nut-meter: wat kost een agent, en wat levert hij aantoonbaar op? Een agent die geld kost maar in 30 dagen
 * geen les, notitie, voorstel, meting, verzoek of taak voor een collega opleverde, is "voor de sier".
 * Allemaal gewoon tellen in de database: dit kost zelf geen AI.
 */

export const VALUE_DAYS = 30;
/** Onder dit bedrag in 30 dagen zeggen we nog niets: te weinig uitgegeven om over nut te oordelen. */
export const VALUE_MIN_COST_EUR = 1;

const round2 = (n: number) => Math.round(n * 100) / 100;

type Counts = Map<string, number>;

async function countBy(ctx: AppContext, sql: string, params: unknown[]): Promise<Counts> {
  const rows = await ctx.db.query<{ agent_id: string | null; n: string | number }>(sql, params);
  return new Map(rows.filter((r) => r.agent_id).map((r) => [r.agent_id!, Number(r.n)]));
}

/** Rekent de nut-meter uit voor alle agents (behalve vertrokken). */
export async function computeAgentValues(ctx: AppContext): Promise<AgentValue[]> {
  const now = ctx.now();
  const from = new Date(now.getTime() - VALUE_DAYS * 86_400_000).toISOString();
  const to = new Date(now.getTime() + 86_400_000).toISOString();
  const agents = (await ctx.paperclip.listAgents(ctx.companyId)).filter((a) => a.status !== "terminated");
  const cost = new Map<string, number>();
  for (const c of await ctx.paperclip.costsByAgent(ctx.companyId, { from, to })) cost.set(c.agentId, usdCentsToEur(c.costCents, ctx.config.money.usdToEur));

  const [runs, failed, lessons, notes, proposals, measurements, requests, delegations] = await Promise.all([
    countBy(ctx, "select agent_id, count(*) as n from office_events where type = 'run.finished' and at >= $1 group by agent_id", [from]),
    countBy(ctx, "select agent_id, count(*) as n from office_events where type = 'run.finished' and data->>'status' in ('failed', 'timed_out', 'error') and at >= $1 group by agent_id", [from]),
    countBy(ctx, "select substr(created_by, 7) as agent_id, count(*) as n from lessons where created_by like 'agent:%' and created_at >= $1 group by 1", [from]),
    countBy(ctx, "select agent_id, count(*) as n from notes where created_at >= $1 group by agent_id", [from]),
    countBy(ctx, "select proposed_by_agent_id as agent_id, count(*) as n from experiments where created_at >= $1 group by 1", [from]),
    countBy(ctx, "select substr(reported_by, 7) as agent_id, count(*) as n from metrics where reported_by like 'agent:%' and recorded_at >= $1 group by 1", [from]),
    // Een voorstel maakt zelf ook een verzoek aan jou; dat telt niet dubbel.
    countBy(ctx, "select requested_by_agent_id as agent_id, count(*) as n from approvals where kind <> 'experiment_start' and created_at >= $1 group by 1", [from]),
    countBy(ctx, "select agent_id, count(*) as n from office_events where type = 'talk' and data->>'kind' = 'delegate' and at >= $1 group by agent_id", [from]),
  ]);

  const out: AgentValue[] = agents.map((a) => {
    const outputs = {
      lessons: lessons.get(a.id) ?? 0,
      notes: notes.get(a.id) ?? 0,
      proposals: proposals.get(a.id) ?? 0,
      measurements: measurements.get(a.id) ?? 0,
      requests: requests.get(a.id) ?? 0,
      delegations: delegations.get(a.id) ?? 0,
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

/** Regels voor het rapport: wie kost geld zonder resultaat? Leeg als iedereen iets oplevert. */
export function valueReportLines(values: AgentValue[], names: Map<string, string>): string[] {
  const idle = values.filter((v) => v.verdict === "niets");
  if (!idle.length) return [];
  const eur = (n: number) => `€${n.toFixed(2).replace(".", ",")}`;
  return [
    "",
    `💤 Kost geld zonder aantoonbaar resultaat (${VALUE_DAYS} dagen): ${idle
      .slice(0, 6)
      .map((v) => `${names.get(v.agentId) ?? "onbekend"} ${eur(v.costEur)}`)
      .join(" · ")}. Geen les, notitie, voorstel, meting of taak. Pauzeren kan in het kantoor.`,
  ];
}
