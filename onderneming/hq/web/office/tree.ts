/**
 * De stamboom: wie wat doet en onder wie. Jij bovenaan, daaronder de hoofdagent (of Atlas, de CEO), dan de
 * afdelingen met hun agents. Wie nergens onder hangt, staat los. Gewoon rekenwerk (geen DOM), zodat het te testen is.
 */
import type { CodeSession, OfficeAgent, OfficeSnapshot } from "../../src/office/types.js";
import { OWNER_ID } from "./layout.js";

export type Tone = "good" | "warn" | "info" | "bad" | "muted";

export interface TreeNode {
  /** Poppetje in het kantoor (agent-id, `cc:<sessie>` of `owner`); een afdeling heeft `team:<slug>`. */
  id: string;
  name: string;
  role: string;
  kind: "you" | "boss" | "team" | "lead" | "agent" | "session";
  status: { label: string; tone: Tone };
  model: string | null;
  /** Waar hij nu mee bezig is (of wat hij het laatst deed). */
  detail: string | null;
  /** Kleine regel eronder: repository, kosten, sinds wanneer. */
  meta: string | null;
  /** Kleur van de afdeling (voor de rand). */
  accent: string | null;
  children: TreeNode[];
}

export interface TreeTeam {
  id: string;
  name: string;
  members: number;
  working: number;
  waiting: number;
  models: string[];
  accent: string | null;
}

export interface Tree {
  root: TreeNode;
  /** Wat nergens onder hangt: los van elkaar. */
  loose: TreeNode[];
  teams: TreeTeam[];
  /** Hoeveel oudere, afgeronde hoofdagent-opdrachten niet getoond worden. */
  hidden: number;
}

const SESSION_STATUS: Record<string, { label: string; tone: Tone }> = {
  working: { label: "bezig", tone: "good" },
  waiting: { label: "wacht op jou", tone: "warn" },
  review: { label: "klaar, kijk even", tone: "info" },
  done: { label: "klaar", tone: "muted" },
  failed: { label: "vastgelopen", tone: "bad" },
  archived: { label: "gearchiveerd", tone: "muted" },
};

const AGENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  running: { label: "bezig", tone: "good" },
  active: { label: "klaar voor werk", tone: "info" },
  idle: { label: "rustig", tone: "muted" },
  paused: { label: "pauze", tone: "warn" },
  error: { label: "fout", tone: "bad" },
  pending_approval: { label: "wacht op jouw ja", tone: "warn" },
  terminated: { label: "vertrokken", tone: "muted" },
};

const usd = (n: number | null | undefined) => (n ? `$${n >= 100 ? Math.round(n) : n.toFixed(2)} API-waarde` : null);

function sessionNode(s: CodeSession, modelName: (m: string | null) => string, projectName: string | null): TreeNode {
  const a = s.account;
  const bucket = a?.bucket ?? (s.state === "working" ? "working" : s.state === "idle" ? "review" : "done");
  const boss = a?.kind === "hoofdagent";
  // Naam = waar hij aan werkt (de titel); de rol staat erboven. Zo lees je de boom als een takenlijst.
  const label = s.label ?? `Claude · ${projectName ?? "een project"}`;
  return {
    id: s.actorId,
    name: boss ? (s.title?.replace(/^Hoofdagent:\s*/, "") ?? "Hoofdagent") : (s.title ?? label),
    role: boss ? "Hoofdagent" : a?.role ? a.role[0]!.toUpperCase() + a.role.slice(1) : a?.team ? "Agent" : label,
    kind: boss ? "boss" : a?.role?.toLowerCase() === "lead" ? "lead" : "session",
    status: SESSION_STATUS[bucket] ?? { label: bucket, tone: "muted" },
    model: a?.model ? modelName(a.model) : null,
    detail: bucket === "waiting" && a?.needsAction ? `Wacht op jou: ${a.needsAction}` : s.lastAction,
    meta: [a?.repo ?? null, usd(a?.costUsd)].filter(Boolean).join(" · ") || null,
    accent: null,
    children: [],
  };
}

function agentNode(ag: OfficeAgent, modelName: (m: string | null) => string, accent: string | null): TreeNode {
  const lead = ag.hqRole === "lead" || ag.template === "tak-lead";
  return {
    id: ag.id,
    name: ag.nickname || ag.name,
    role: ag.title ?? ag.role,
    kind: ag.hqRole === "ceo" ? "boss" : lead ? "lead" : "agent",
    status: AGENT_STATUS[ag.status] ?? { label: ag.status, tone: "muted" },
    model: ag.model ? modelName(ag.model) : null,
    detail: ag.status === "running" ? ag.currentTask : ag.pauseReason,
    meta: ag.budgetMonthEur ? `€${Math.round(ag.spentMonthEur)} van €${Math.round(ag.budgetMonthEur)} deze maand` : null,
    accent,
    children: [],
  };
}

const teamNode = (id: string, name: string, accent: string | null): TreeNode => ({
  id,
  name,
  role: "Afdeling",
  kind: "team",
  status: { label: "", tone: "muted" },
  model: null,
  detail: null,
  meta: null,
  accent,
  children: [],
});

/** Werkt er iemand in deze tak van de boom? Dan komt hij bovenaan. */
const rank = (n: TreeNode): number => {
  const own = n.status.tone === "warn" ? 0 : n.status.label === "bezig" ? 1 : n.status.tone === "bad" ? 2 : n.status.tone === "info" ? 3 : 4;
  return Math.min(own, ...n.children.map(rank));
};
const sortTree = (list: TreeNode[]): TreeNode[] => {
  for (const n of list) n.children = sortTree(n.children);
  return list.sort((a, b) => rank(a) - rank(b));
};

function teamsOf(nodes: TreeNode[]): TreeTeam[] {
  const out: TreeTeam[] = [];
  const walk = (n: TreeNode) => {
    if (n.kind === "team") {
      const members: TreeNode[] = [];
      const collect = (m: TreeNode) => {
        if (m.kind !== "team") members.push(m);
        m.children.forEach(collect);
      };
      n.children.forEach(collect);
      out.push({
        id: n.id,
        name: n.name,
        members: members.length,
        working: members.filter((m) => m.status.label === "bezig").length,
        waiting: members.filter((m) => m.status.label.startsWith("wacht")).length,
        models: [...new Set(members.map((m) => m.model).filter((m): m is string => Boolean(m)))],
        accent: n.accent,
      });
    }
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

export function buildTree(
  snap: OfficeSnapshot,
  opts: { modelName: (m: string | null) => string; accentOf?: (slug: string) => string | null; ownerName?: string; /** Hoeveel afgeronde opdrachten zonder afdeling je nog ziet. */ maxBosses?: number },
): Tree {
  const accentOf = opts.accentOf ?? (() => null);
  const root: TreeNode = {
    id: OWNER_ID,
    name: opts.ownerName ?? "Jij",
    role: "Eigenaar · jij plant",
    kind: "you",
    status: { label: "", tone: "info" },
    model: null,
    detail: null,
    meta: null,
    accent: null,
    children: [],
  };
  const loose: TreeNode[] = [];
  let hidden = 0;

  // ---- Paperclip-agents (op je server): CEO → afdelingen → lead → de rest.
  const agents = snap.agents.filter((a) => a.status !== "terminated");
  const ceo = agents.find((a) => a.hqRole === "ceo") ?? null;
  const ceoNode = ceo ? agentNode(ceo, opts.modelName, null) : null;
  if (ceoNode) root.children.push(ceoNode);
  const top = ceoNode ?? root;
  const agentNodes = new Map(agents.map((a) => [a.id, agentNode(a, opts.modelName, accentOf(a.branch))] as const));
  if (ceo && ceoNode) agentNodes.set(ceo.id, ceoNode);
  for (const b of snap.branches.filter((x) => x.slug !== "holding")) {
    const members = agents.filter((a) => a.branch === b.slug && a !== ceo);
    if (!members.length) continue;
    const team = teamNode(`team:${b.slug}`, b.name, accentOf(b.slug));
    const lead = members.find((a) => a.hqRole === "lead" || a.template === "tak-lead") ?? null;
    const head = lead ? agentNodes.get(lead.id)! : null;
    if (head) team.children.push(head);
    // Onder wie hij werkt (reportsTo) als dat een collega uit dezelfde afdeling is, anders onder de lead.
    const upAgent = new Map<string, string>();
    const loops = (child: string, parent: string) => {
      for (let at: string | undefined = parent, n = 0; at && n < 50; at = upAgent.get(at), n++) if (at === child) return true;
      return false;
    };
    for (const m of members) {
      if (m === lead) continue;
      const boss = m.reportsTo && m.reportsTo !== m.id && members.some((x) => x.id === m.reportsTo) && !loops(m.id, m.reportsTo) ? m.reportsTo : null;
      if (boss) upAgent.set(m.id, boss);
      (boss ? agentNodes.get(boss)!.children : (head?.children ?? team.children)).push(agentNodes.get(m.id)!);
    }
    top.children.push(team);
  }
  // Algemene agents (de analist e.d.) direct onder de CEO.
  for (const a of agents) {
    if (a === ceo || snap.branches.some((b) => b.slug === a.branch && b.slug !== "holding")) continue;
    top.children.push(agentNodes.get(a.id)!);
  }

  // ---- Claude Code-sessies: hoofdagent → afdelingen → sessies (via de tags ouder/afdeling/rol).
  // Zonder gegevens van je account (kantoor op je server) tellen alleen sessies die nog niet klaar zijn.
  const sessions = snap.code.sessions.filter((s) => s.account || s.state !== "done");
  const projectName = (s: CodeSession) => snap.code.projects.find((p) => p.key === s.projectKey)?.name ?? null;
  const nodes = new Map(sessions.map((s) => [s.id, sessionNode(s, opts.modelName, projectName(s))] as const));
  const bosses = sessions.filter((s) => s.account?.kind === "hoofdagent");
  const teamNodes = new Map<string, TreeNode>();
  const placed = new Set<string>();
  // Wie onder wie hangt (sessie → ouder), om rondjes te voorkomen (A startte B en B startte A).
  const up = new Map<string, string>();
  const wouldLoop = (child: string, parent: string) => {
    for (let at: string | undefined = parent, n = 0; at && n < 50; at = up.get(at), n++) if (at === child) return true;
    return false;
  };
  const hang = (child: string, parent: string): boolean => {
    if (child === parent || wouldLoop(child, parent)) return false;
    nodes.get(parent)!.children.push(nodes.get(child)!);
    up.set(child, parent);
    placed.add(child);
    return true;
  };
  const teamFor = (slug: string, name: string) => {
    let t = teamNodes.get(slug);
    if (!t) {
      t = teamNode(`team:afd-${slug}`, name, accentOf(`afd-${slug}`));
      teamNodes.set(slug, t);
    }
    return t;
  };
  // Afdelingsleden: onder een collega uit dezelfde afdeling als die hen startte, anders direct onder de afdeling.
  for (const s of sessions) {
    const a = s.account;
    if (!a?.team || a.kind !== "afdeling") continue;
    const team = teamFor(a.team, a.teamName ?? a.team);
    const parent = a.parentId ? sessions.find((x) => x.id === a.parentId) : undefined;
    if (!(parent?.account?.team === a.team && hang(s.id, parent.id))) {
      team.children.push(nodes.get(s.id)!);
      placed.add(s.id);
    }
  }
  // Een afdeling hoort bij de hoofdagent die haar startte (de ouder van een van haar leden).
  const teamParent = new Map<string, string>();
  for (const s of sessions) {
    const a = s.account;
    if (!a?.team || !a.parentId || teamParent.has(a.team)) continue;
    const parent = sessions.find((x) => x.id === a.parentId);
    if (parent && parent.account?.team !== a.team) teamParent.set(a.team, parent.id);
  }
  // Overige sessies die iemand anders startte (zonder afdeling): onder die ouder.
  for (const s of sessions) {
    const a = s.account;
    if (placed.has(s.id) || !a?.parentId || a.kind === "hoofdagent" || !nodes.has(a.parentId)) continue;
    hang(s.id, a.parentId);
  }
  for (const [slug, team] of teamNodes) {
    const parentId = teamParent.get(slug);
    const parent = parentId ? nodes.get(parentId) : undefined;
    (parent ?? root).children.push(team);
  }
  // De hoofdagent-opdrachten onder jou. Afgeronde zonder afdeling: alleen de laatste paar, de rest tellen we.
  const keepQuiet = opts.maxBosses ?? 3;
  let quietShown = 0;
  const shownBosses = bosses.filter((s) => {
    const quiet = nodes.get(s.id)!.children.length === 0 && ["done", "archived"].includes(s.account!.bucket);
    if (!quiet) return true;
    quietShown += 1;
    return quietShown <= keepQuiet;
  });
  hidden = bosses.length - shownBosses.length;
  for (const s of shownBosses) root.children.push(nodes.get(s.id)!);
  for (const s of sessions) {
    if (placed.has(s.id) || s.account?.kind === "hoofdagent") continue;
    if (s.account?.bucket === "archived") continue;
    loose.push(nodes.get(s.id)!);
  }

  sortTree(root.children);
  sortTree(loose);
  return { root, loose, teams: teamsOf(root.children), hidden };
}
