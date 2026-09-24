import type { Db } from "../db/index.js";
import { errorMessage, type AppContext } from "../domain/context.js";
import { experimentCode } from "../domain/codes.js";
import type { KnowledgeGraph } from "../office/types.js";
import { graphPath, loadKnowledgeGraph } from "./graph.js";
import { graphifyExtract, graphifyQuery, semanticExtractionEnabled } from "./graphify.js";
import { syncVault, type VaultSyncResult } from "./vault.js";

const STOPWORDS = new Set(
  "de het een en van voor met hoe wat die dat dit deze waar wie wel niet ook als bij naar over uit aan om tot door dan maar zijn is was wordt worden kan kun kunnen moet moeten ons onze mijn jouw hun hebben heeft had heb zou zal the and for with how what are this that from into your our".split(
    " ",
  ),
);

/** Woorden uit een vraag, geschikt voor een OF-zoekopdracht in Postgres. */
export function searchTerms(question: string, max = 10): string[] {
  const words = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, max);
}

async function rankedSearch<T>(db: Db, sql: (tsquery: string) => string, terms: string[], limit: number): Promise<T[]> {
  if (!terms.length) return [];
  return db.query<T>(sql("$1"), [terms.join(" | "), limit]);
}

export interface KnowledgeAnswer {
  question: string;
  lessons: Array<{ id: number; lesson: string; tags: string[]; experiment: string | null }>;
  notes: Array<{ id: number; title: string; excerpt: string; author: string; tags: string[] }>;
  /** Uitvoer van `graphify query` (knopen en verbanden rond je vraag), als de kennisgraaf er is. */
  graph: string | null;
  graphSource: "graphify" | "hq" | null;
  tip: string;
}

/**
 * Hoeveel lessen en notities er zijn. Een graaf helpt pas bij een flinke kennisbank: bij een paar dozijn
 * notities vindt gewoon zoeken hetzelfde, en kost graaf-uitvoer alleen extra tokens (docs/ONDERZOEK-AGENTS.md).
 */
export async function knowledgeSize(db: Db): Promise<number> {
  const rows = await db.query<{ n: string | number }>("select (select count(*) from lessons) + (select count(*) from notes) as n");
  return Number(rows[0]?.n ?? 0);
}

/** Beantwoordt een vraag van een agent uit de kennisbank en laat hem in het kantoor naar de Graphify-kamer lopen. */
export async function askKnowledge(ctx: AppContext, question: string, agentId: string | null, opts: { emit?: boolean } = {}): Promise<KnowledgeAnswer> {
  const terms = searchTerms(question);
  const lessons = await rankedSearch<{ id: number; lesson: string; tags: string[] | null; experiment_id: number | null }>(
    ctx.db,
    (q) => `select l.id, l.lesson, l.tags, l.experiment_id
      from lessons l, to_tsquery('simple', ${q}) q
      where to_tsvector('simple', l.lesson || ' ' || coalesce(l.evidence, '') || ' ' || array_to_string(l.tags, ' ')) @@ q
      order by ts_rank(to_tsvector('simple', l.lesson || ' ' || coalesce(l.evidence, '')), q) desc, l.id desc limit $2`,
    terms,
    6,
  );
  const notes = await rankedSearch<{ id: number; title: string; body: string; author: string; tags: string[] | null }>(
    ctx.db,
    (q) => `select n.id, n.title, n.body, n.author, n.tags
      from notes n, to_tsquery('simple', ${q}) q
      where to_tsvector('simple', n.title || ' ' || n.body || ' ' || array_to_string(n.tags, ' ')) @@ q
      order by ts_rank(to_tsvector('simple', n.title || ' ' || n.body), q) desc, n.id desc limit $2`,
    terms,
    6,
  );
  let graph: string | null = null;
  if ((await knowledgeSize(ctx.db)) >= ctx.config.knowledge.graphifyMinNotes) {
    try {
      graph = await graphifyQuery(ctx.config, question);
    } catch (err) {
      ctx.log.warn("graphify query mislukt", { error: errorMessage(err) });
    }
  }
  const graphSource = graph ? (graphPath(ctx.config.knowledge.vaultDir)?.source ?? null) : null;

  // Een agent die iets opzoekt, loopt in het kantoor naar de kennisbank; als jij zoekt, blijft het stil.
  if (opts.emit !== false) {
    await ctx.events.emit({
      type: "knowledge.query",
      agentId,
      text: question,
      data: { lessons: lessons.length, notes: notes.length, graph: Boolean(graph), terms },
    });
  }

  const found = lessons.length + notes.length + (graph ? 1 : 0);
  return {
    question,
    lessons: lessons.map((l) => ({
      id: l.id,
      lesson: l.lesson,
      tags: l.tags ?? [],
      experiment: l.experiment_id ? experimentCode(l.experiment_id) : null,
    })),
    notes: notes.map((n) => ({
      id: n.id,
      title: n.title,
      excerpt: n.body.length > 600 ? `${n.body.slice(0, 599)}…` : n.body,
      author: n.author,
      tags: n.tags ?? [],
    })),
    graph,
    graphSource,
    tip: found
      ? "Gebruik dit als startpunt en controleer het bij de bron. Schrijf nieuwe inzichten terug met POST /api/agent/notes."
      : "Niets gevonden. Probeer andere woorden, of zoek het uit en schrijf het daarna op met POST /api/agent/notes.",
  };
}

const nameCache = new WeakMap<AppContext, { at: number; names: Map<string, string> }>();

/** Namen van de agents (voor de kennisbank en de graaf), een minuut in het geheugen. */
export async function agentNameMap(ctx: AppContext): Promise<Map<string, string>> {
  const cached = nameCache.get(ctx);
  if (cached && Date.now() - cached.at < 60_000) return cached.names;
  try {
    const agents = await ctx.paperclip.listAgents(ctx.companyId);
    const names = new Map(agents.filter((a) => a.status !== "terminated").map((a) => [a.id, a.name]));
    nameCache.set(ctx, { at: Date.now(), names });
    return names;
  } catch {
    return cached?.names ?? new Map();
  }
}

/** Schrijft de kennisbank-map bij (als HQ_VAULT_DIR of ~/vault bestaat). */
export async function runVaultSync(ctx: AppContext): Promise<VaultSyncResult | null> {
  const dir = ctx.config.knowledge.vaultDir;
  if (!dir) return null;
  return syncVault(ctx, dir, await agentNameMap(ctx));
}

/** De nachtelijke ronde: kennisbank bijwerken en (met sleutel) Graphify de graaf laten opbouwen. */
export async function rebuildKnowledge(ctx: AppContext): Promise<string> {
  const synced = await runVaultSync(ctx);
  if (!synced) return "Geen kennisbank-map ingesteld (HQ_VAULT_DIR).";
  let message = `kennisbank: ${synced.written} bijgewerkt, ${synced.removed} verwijderd`;
  const size = await knowledgeSize(ctx.db);
  const min = ctx.config.knowledge.graphifyMinNotes;
  if (semanticExtractionEnabled(ctx.config) && size < min) {
    message += `; Graphify-extractie wacht tot er ${min} lessen en notities zijn (nu ${size}), tot die tijd de gratis HQ-graaf`;
  } else if (semanticExtractionEnabled(ctx.config)) {
    const res = await graphifyExtract(ctx.config);
    message += `; graphify: ${res.message}`;
    if (!res.ok) throw new Error(message);
  } else {
    message += "; Graphify-extractie staat uit (geen GRAPHIFY_API_KEY), HQ-graaf gebruikt";
  }
  const graph = await knowledgeGraph(ctx, 1);
  await ctx.events.emit({
    type: "knowledge.rebuilt",
    text: `Kennisgraaf bijgewerkt: ${graph.totalNodes} knopen, ${graph.totalEdges} verbanden`,
    data: { source: graph.source, nodes: graph.totalNodes, edges: graph.totalEdges },
  });
  return message;
}

export async function knowledgeGraph(ctx: AppContext, maxNodes = 400): Promise<KnowledgeGraph> {
  return loadKnowledgeGraph(ctx.db, ctx.config.knowledge.vaultDir, { maxNodes, agentNames: await agentNameMap(ctx) });
}
