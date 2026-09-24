import { experimentCode } from "../domain/codes.js";
import { errorMessage, type AppContext } from "../domain/context.js";
import type { ExperimentStatus } from "../domain/experiments.js";
import { BOT_ID } from "../office/profiles.js";
import { askKnowledge, searchTerms } from "./service.js";

/**
 * Vooronderzoek bij een experimentvoorstel: wat weet de holding hier al over? HQ zoekt het zelf op
 * (de HQ-bot loopt daarvoor in het kantoor naar de kennisruimte), zodat een afgeschoten idee niet
 * ongemerkt terugkomt en jij bij het goedkeuren ziet wat er eerder gebeurde.
 */

export interface SimilarExperiment {
  code: string;
  title: string;
  status: ExperimentStatus;
  reason: string | null;
  /** Hoeveel van de kernwoorden overeenkomen (0-1). */
  overlap: number;
}

export interface ProposalKnowledge {
  similar: SimilarExperiment[];
  lessons: Array<{ id: number; lesson: string; experiment: string | null }>;
  notes: Array<{ id: number; title: string }>;
  graph: boolean;
}

const STATUS_LABEL: Record<ExperimentStatus, string> = {
  proposed: "wacht op jouw besluit",
  approved: "goedgekeurd",
  running: "loopt nog",
  keep: "KEEP",
  iterate: "ITERATE",
  killed: "afgeschoten",
  rejected: "door jou afgewezen",
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Experimenten die op dit voorstel lijken: minstens twee gedeelde kernwoorden en een kwart overlap. */
export async function similarExperiments(
  ctx: AppContext,
  p: { id: number; title: string; hypothesis: string },
  limit = 3,
): Promise<SimilarExperiment[]> {
  const mine = new Set(searchTerms(`${p.title} ${p.hypothesis}`, 40));
  if (mine.size < 2) return [];
  const rows = await ctx.db.query<{ id: number; title: string; hypothesis: string; status: ExperimentStatus; decision_reason: string | null }>(
    "select id, title, hypothesis, status, decision_reason from experiments where id <> $1 order by id desc limit 300",
    [p.id],
  );
  const scored: SimilarExperiment[] = [];
  for (const r of rows) {
    const theirs = new Set(searchTerms(`${r.title} ${r.hypothesis}`, 40));
    let shared = 0;
    for (const w of theirs) if (mine.has(w)) shared++;
    const overlap = shared / Math.max(1, Math.min(mine.size, theirs.size));
    if (shared >= 2 && overlap >= 0.25) {
      scored.push({ code: experimentCode(r.id), title: r.title, status: r.status, reason: r.decision_reason, overlap: Math.round(overlap * 100) / 100 });
    }
  }
  return scored.sort((a, b) => b.overlap - a.overlap).slice(0, limit);
}

export async function proposalKnowledge(ctx: AppContext, p: { id: number; title: string; hypothesis: string }): Promise<ProposalKnowledge> {
  const similar = await similarExperiments(ctx, p);
  // Lessen van de experimenten die erop lijken gaan voor: dat is precies wat je wilt weten.
  const ids = similar.map((s) => Number(s.code.slice(4)));
  const own = ids.length
    ? await ctx.db.query<{ id: number; lesson: string; experiment_id: number | null }>(
        "select id, lesson, experiment_id from lessons where experiment_id = any($1::int[]) order by id desc limit 3",
        [ids],
      )
    : [];
  const answer = await askKnowledge(ctx, `${p.title}. ${clip(p.hypothesis, 200)}`, BOT_ID);
  const lessons = [
    ...own.map((l) => ({ id: l.id, lesson: l.lesson, experiment: l.experiment_id ? experimentCode(l.experiment_id) : null })),
    ...answer.lessons.map((l) => ({ id: l.id, lesson: l.lesson, experiment: l.experiment })),
  ].filter((l, i, all) => all.findIndex((x) => x.id === l.id) === i);
  return {
    similar,
    lessons: lessons.slice(0, 4),
    notes: answer.notes.slice(0, 3).map((n) => ({ id: n.id, title: n.title })),
    graph: Boolean(answer.graph),
  };
}

/** Vangt fouten af: het vooronderzoek mag een voorstel nooit tegenhouden. */
export async function safeProposalKnowledge(
  ctx: AppContext,
  p: { id: number; title: string; hypothesis: string },
): Promise<ProposalKnowledge | null> {
  try {
    return await proposalKnowledge(ctx, p);
  } catch (err) {
    ctx.log.warn("vooronderzoek in de kennisbank mislukt", { error: errorMessage(err) });
    return null;
  }
}

/** Regels voor het goedkeuringsbericht aan de eigenaar (Telegram en kantoor). */
export function knowledgeSummaryLines(k: ProposalKnowledge): string[] {
  if (!k.similar.length && !k.lessons.length && !k.notes.length) {
    return ["📚 Kennisbank: niets vergelijkbaars gevonden (nieuw terrein)."];
  }
  const lines = ["📚 Uit de kennisbank:"];
  for (const s of k.similar.slice(0, 2)) {
    lines.push(`• Lijkt op ${s.code} "${clip(s.title, 60)}" (${STATUS_LABEL[s.status]}${s.reason ? `: ${clip(s.reason, 80)}` : ""})`);
  }
  for (const l of k.lessons.slice(0, 2)) lines.push(`• Les: ${clip(l.lesson, 110)}${l.experiment ? ` (${l.experiment})` : ""}`);
  if (!k.lessons.length && k.notes.length) lines.push(`• Notitie: ${clip(k.notes[0]!.title, 90)}`);
  return lines;
}

/** Wat de agent terugkrijgt: kort wat HQ vond en wat hij ermee moet. */
export function knowledgeAdvice(k: ProposalKnowledge | null): string {
  if (!k) return "De kennisbank kon niet worden doorzocht; controleer zelf met hq kennis.";
  const dead = k.similar.filter((s) => s.status === "killed" || s.status === "rejected");
  if (dead.length) {
    return `Let op: ${dead.map((s) => s.code).join(", ")} lijkt hierop en werd ${dead.length > 1 ? "afgeschoten of afgewezen" : STATUS_LABEL[dead[0]!.status]}. Leg in je taak uit wat er nu anders is, of trek het voorstel in.`;
  }
  const open = k.similar.filter((s) => s.status === "proposed" || s.status === "approved" || s.status === "running");
  if (open.length) return `${open.map((s) => s.code).join(", ")} lijkt hierop en loopt nog. Voorkom dubbel werk: stem af met de lead.`;
  if (k.lessons.length) return `HQ vond ${k.lessons.length} les(sen) die hierover gaan; ze staan bij je voorstel. Noem in je taak wat je ervan meenam.`;
  return "Niets vergelijkbaars in de kennisbank. Schrijf na afloop op wat je leerde.";
}
