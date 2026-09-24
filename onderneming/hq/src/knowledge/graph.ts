import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../db/index.js";
import { experimentCode } from "../domain/codes.js";
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "../office/types.js";

/** Het graph.json-formaat van Graphify (networkx node-link). */
export interface NodeLinkGraph {
  directed?: boolean;
  multigraph?: boolean;
  graph?: Record<string, unknown>;
  nodes: Array<{ id: string; label?: string; community?: number | string | null; file_type?: string; kind?: string; [k: string]: unknown }>;
  links?: Array<{ source: string; target: string; relation?: string; [k: string]: unknown }>;
  edges?: Array<{ source: string; target: string; relation?: string; [k: string]: unknown }>;
}

export const GRAPHIFY_GRAPH = join("graphify-out", "graph.json");
export const HQ_GRAPH = join(".hq", "graph.json");

/** Waar staat de beste graaf? Die van Graphify (met betekenis-verbanden) gaat voor op de eigen HQ-graaf. */
export function graphPath(vaultDir: string | undefined): { path: string; source: "graphify" | "hq" } | null {
  if (!vaultDir) return null;
  const graphify = join(vaultDir, GRAPHIFY_GRAPH);
  if (existsSync(graphify)) return { path: graphify, source: "graphify" };
  const hq = join(vaultDir, HQ_GRAPH);
  if (existsSync(hq)) return { path: hq, source: "hq" };
  return null;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * Bouwt een graaf uit wat HQ weet: takken, experimenten, lessen, notities, tags en de agents die ze schreven.
 * Werkt altijd, ook zonder Graphify of API-sleutel.
 */
export async function buildHqGraph(db: Db, agentNames: Map<string, string> = new Map()): Promise<NodeLinkGraph> {
  const nodes = new Map<string, NodeLinkGraph["nodes"][number]>();
  const links: NonNullable<NodeLinkGraph["links"]> = [];
  const add = (id: string, label: string, kind: string, group: string | null) => {
    if (!nodes.has(id)) nodes.set(id, { id, label, kind, community: group, file_type: "document" });
  };
  const link = (source: string, target: string, relation: string) => {
    if (nodes.has(source) && nodes.has(target)) links.push({ source, target, relation, confidence: "EXTRACTED" });
  };
  const agentNode = (id: string | null | undefined, group: string | null) => {
    if (!id) return null;
    const key = `agent:${id}`;
    add(key, agentNames.get(id) ?? "Agent", "agent", group);
    return key;
  };

  const branches = await db.query<{ id: number; slug: string; name: string }>("select id, slug, name from branches");
  const slugOf = new Map(branches.map((b) => [b.id, b.slug]));
  for (const b of branches) add(`tak:${b.slug}`, b.name, "tak", b.slug);

  const experiments = await db.query<{
    id: number;
    branch_id: number;
    title: string;
    status: string;
    parent_id: number | null;
    lead_agent_id: string | null;
  }>("select id, branch_id, title, status, parent_id, lead_agent_id from experiments order by id desc limit 300");
  for (const e of experiments) {
    const group = slugOf.get(e.branch_id) ?? null;
    add(`exp:${e.id}`, `${experimentCode(e.id)} ${clip(e.title, 48)}`, "experiment", group);
    link(`exp:${e.id}`, `tak:${group}`, "hoort bij");
    const lead = agentNode(e.lead_agent_id, group);
    if (lead) link(lead, `exp:${e.id}`, "leidt");
  }
  for (const e of experiments) if (e.parent_id) link(`exp:${e.id}`, `exp:${e.parent_id}`, "vervolg op");

  const lessons = await db.query<{
    id: number;
    branch_id: number | null;
    experiment_id: number | null;
    lesson: string;
    tags: string[] | null;
    created_by: string;
  }>("select id, branch_id, experiment_id, lesson, tags, created_by from lessons order by id desc limit 600");
  for (const l of lessons) {
    const group = l.branch_id ? (slugOf.get(l.branch_id) ?? null) : null;
    add(`les:${l.id}`, clip(l.lesson, 60), "les", group);
    if (l.experiment_id) link(`les:${l.id}`, `exp:${l.experiment_id}`, "geleerd uit");
    else if (group) link(`les:${l.id}`, `tak:${group}`, "gaat over");
    for (const t of l.tags ?? []) {
      add(`tag:${t}`, `#${t}`, "tag", "tag");
      link(`les:${l.id}`, `tag:${t}`, "gaat over");
    }
    const author = l.created_by.startsWith("agent:") ? agentNode(l.created_by.slice(6), group) : null;
    if (author) link(author, `les:${l.id}`, "schreef");
  }

  const notes = await db.query<{
    id: number;
    agent_id: string | null;
    title: string;
    tags: string[] | null;
    branch_id: number | null;
    experiment_id: number | null;
  }>("select id, agent_id, title, tags, branch_id, experiment_id from notes order by id desc limit 600");
  for (const n of notes) {
    const group = n.branch_id ? (slugOf.get(n.branch_id) ?? null) : null;
    add(`notitie:${n.id}`, clip(n.title, 60), "notitie", group);
    if (n.experiment_id) link(`notitie:${n.id}`, `exp:${n.experiment_id}`, "over");
    else if (group) link(`notitie:${n.id}`, `tak:${group}`, "over");
    for (const t of n.tags ?? []) {
      add(`tag:${t}`, `#${t}`, "tag", "tag");
      link(`notitie:${n.id}`, `tag:${t}`, "gaat over");
    }
    const author = agentNode(n.agent_id, group);
    if (author) link(author, `notitie:${n.id}`, "schreef");
  }

  return {
    directed: false,
    multigraph: false,
    graph: { source: "hq", builtAt: new Date().toISOString() },
    nodes: [...nodes.values()],
    links,
  };
}

/** Maakt een weergave-graaf: hoogstens `maxNodes` knopen, de best verbonden eerst. */
export function toKnowledgeGraph(
  g: NodeLinkGraph,
  source: "graphify" | "hq",
  builtAt: string | null,
  maxNodes = 400,
): KnowledgeGraph {
  const rawLinks = g.links ?? g.edges ?? [];
  const degree = new Map<string, number>();
  for (const l of rawLinks) {
    degree.set(String(l.source), (degree.get(String(l.source)) ?? 0) + 1);
    degree.set(String(l.target), (degree.get(String(l.target)) ?? 0) + 1);
  }
  const all: KnowledgeNode[] = g.nodes.map((n) => ({
    id: String(n.id),
    label: String(n.label ?? n.id),
    kind: String(n.kind ?? n.file_type ?? "concept"),
    group: n.community === undefined || n.community === null ? null : String(n.community),
    degree: degree.get(String(n.id)) ?? 0,
  }));
  const kept = [...all].sort((a, b) => b.degree - a.degree).slice(0, maxNodes);
  const keep = new Set(kept.map((n) => n.id));
  const edges: KnowledgeEdge[] = rawLinks
    .filter((l) => keep.has(String(l.source)) && keep.has(String(l.target)))
    .map((l) => ({ source: String(l.source), target: String(l.target), relation: l.relation ? String(l.relation) : null }));
  return { source, builtAt, nodes: kept, edges, totalNodes: all.length, totalEdges: rawLinks.length };
}

/** Leest een graph.json van schijf. Geeft null bij een ontbrekend of kapot bestand. */
export function readGraphFile(path: string): { graph: NodeLinkGraph; builtAt: string } | null {
  try {
    const graph = JSON.parse(readFileSync(path, "utf8")) as NodeLinkGraph;
    if (!Array.isArray(graph.nodes)) return null;
    return { graph, builtAt: statSync(path).mtime.toISOString() };
  } catch {
    return null;
  }
}

/** De graaf voor het kantoor: van Graphify als die er is, anders de HQ-graaf (van schijf of vers uit de database). */
export async function loadKnowledgeGraph(
  db: Db,
  vaultDir: string | undefined,
  opts: { maxNodes?: number; agentNames?: Map<string, string> } = {},
): Promise<KnowledgeGraph> {
  const found = graphPath(vaultDir);
  if (found) {
    const file = readGraphFile(found.path);
    if (file) return toKnowledgeGraph(file.graph, found.source, file.builtAt, opts.maxNodes);
  }
  const fresh = await buildHqGraph(db, opts.agentNames);
  return toKnowledgeGraph(fresh, "hq", new Date().toISOString(), opts.maxNodes);
}
