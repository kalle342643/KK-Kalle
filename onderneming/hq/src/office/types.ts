/**
 * Gedeelde typen tussen HQ (server) en het kantoor in de browser (web/office).
 * Dit bestand mag niets importeren: de browser-bundel neemt het mee.
 */

export type OfficeEventType =
  /** Een agent begint aan een run (zit aan zijn bureau te werken). */
  | "run.started"
  | "run.finished"
  /** Een agent zegt iets tegen een collega (reactie op een taak) of geeft hem een taak. */
  | "talk"
  /** Een agent zoekt iets op in de kennisbank (loopt naar de Graphify-kamer). */
  | "knowledge.query"
  /** Een agent schrijft iets in de kennisbank (les of notitie). */
  | "knowledge.write"
  /** De kennisgraaf is opnieuw opgebouwd. */
  | "knowledge.rebuilt"
  /** Een verzoek komt op jouw bureau terecht. */
  | "approval.requested"
  | "approval.decided"
  /** Een nieuwe agent solliciteert (wacht bij de receptie). */
  | "agent.hired"
  /** Status van een agent veranderde (bv. gepauzeerd, weer aan het werk, aangenomen). */
  | "agent.status"
  /** Een agent zit door zijn budget heen. */
  | "budget.stop"
  | "revenue"
  | "metric"
  | "experiment.started"
  | "experiment.verdict"
  /** Een agent stuurt jou een bericht. */
  | "notify"
  /** HQ stuurde jou een bericht (Telegram/WhatsApp); de HQ-bot in de controlekamer. */
  | "message.sent"
  /** Je gaf een agent een bijnaam of ander uiterlijk. */
  | "agent.profile"
  | "halt"
  | "resume";

export interface OfficeEvent {
  id: number;
  at: string;
  type: OfficeEventType;
  agentId: string | null;
  targetAgentId: string | null;
  text: string | null;
  data: Record<string, unknown>;
}

export type OfficeAgentStatus =
  | "active"
  | "paused"
  | "idle"
  | "running"
  | "error"
  | "pending_approval"
  | "terminated";

export interface OfficeAgent {
  id: string;
  name: string;
  role: string;
  title: string | null;
  status: OfficeAgentStatus;
  /** Slug van de tak; `holding` voor de CEO, de analist en andere algemene agents. */
  branch: string;
  /** Speciale rol in HQ: ceo, analyst of lead. */
  hqRole: string | null;
  /** Sjabloon waaruit de agent gemaakt is (verkenner, bouwer, ...). */
  template: string | null;
  reportsTo: string | null;
  model: string | null;
  costTodayEur: number;
  spentMonthEur: number;
  budgetMonthEur: number;
  lastActiveAt: string | null;
  pauseReason: string | null;
  /** Waar hij nu aan werkt (als er een run loopt). */
  currentTask: string | null;
  /** Door jou gekozen bijnaam en uiterlijk (poppetje 0-11). */
  nickname: string | null;
  avatar: number | null;
}

/** Jij en de HQ-bot lopen ook rond in het kantoor, maar zijn geen Paperclip-agents. */
export interface OfficePerson {
  id: "owner" | "hq-bot";
  name: string;
  nickname: string | null;
  avatar: number | null;
}

export type ProjectStatus = "proposed" | "approved" | "running" | "keep" | "iterate" | "killed" | "rejected";

/** Een project = een experiment, met alles wat je nodig hebt om te zien hoe het ervoor staat. */
export interface OfficeProject {
  id: number;
  code: string;
  title: string;
  branch: string;
  branchName: string;
  status: ProjectStatus;
  leadAgentId: string | null;
  metric: string;
  target: number;
  value: number | null;
  trusted: boolean;
  spentEur: number;
  budgetEur: number;
  revenueEur: number;
  daysLeft: number | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  reason: string | null;
  iteration: number;
  hypothesis: string;
  prediction: string | null;
}

export interface OfficeStats {
  /** Omzet en kosten per dag (oudste eerst), in de tijdzone van HQ. */
  days: Array<{ date: string; revenueEur: number; costEur: number }>;
  branches: Array<{ slug: string; name: string; revenue30Eur: number; cost30Eur: number; budgetEur: number }>;
  totals: { revenue30Eur: number; cost30Eur: number; tokensToday: number; runsToday: number };
}

export interface ProjectDetail {
  project: OfficeProject;
  metrics: Array<{ name: string; value: number; source: string; trusted: boolean; at: string }>;
  ledger: Array<{ kind: string; amountEur: number; source: string; description: string | null; at: string }>;
  lessons: Array<{ id: number; lesson: string; tags: string[]; at: string }>;
  events: OfficeEvent[];
}

export interface OfficeExperiment {
  id: number;
  code: string;
  title: string;
  metric: string;
  target: number;
  value: number | null;
  trusted: boolean;
  spentEur: number;
  budgetEur: number;
  daysLeft: number | null;
  leadAgentId: string | null;
}

export interface OfficeBranch {
  slug: string;
  name: string;
  template: string | null;
  status: string;
  monthlyBudgetEur: number;
  leadAgentId: string | null;
  experiments: OfficeExperiment[];
}

export interface OfficeApproval {
  id: number;
  title: string;
  kind: string;
  summary: string | null;
  amountEur: number | null;
  requestedByAgentId: string | null;
  createdAt: string;
}

export interface KnowledgeNode {
  id: string;
  label: string;
  /** Soort knoop (les, experiment, tak, agent, tag, notitie, of wat Graphify vond). */
  kind: string;
  /** Groep (Graphify-community of tak) voor de kleur. */
  group: string | null;
  /** Aantal verbindingen (bepaalt de grootte). */
  degree: number;
}

export interface KnowledgeEdge {
  source: string;
  target: string;
  relation: string | null;
}

export interface KnowledgeGraph {
  /** `graphify` als de graaf door Graphify gemaakt is, anders `hq` (opgebouwd uit lessen, notities en experimenten). */
  source: "graphify" | "hq";
  builtAt: string | null;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  /** Totalen vóór het inkorten voor de weergave. */
  totalNodes: number;
  totalEdges: number;
}

export interface OfficeSnapshot {
  generatedAt: string;
  companyName: string;
  halted: boolean;
  haltReason: string | null;
  timezone: string;
  kpis: {
    revenueTodayEur: number;
    costTodayEur: number;
    revenueMonthEur: number;
    costMonthEur: number;
    allowanceMonthEur: number;
    runningExperiments: number;
    pendingApprovals: number;
  };
  branches: OfficeBranch[];
  agents: OfficeAgent[];
  people: OfficePerson[];
  projects: OfficeProject[];
  stats: OfficeStats;
  approvals: OfficeApproval[];
  knowledge: { source: "graphify" | "hq"; nodes: number; edges: number; builtAt: string | null };
  events: OfficeEvent[];
  lastEventId: number;
  /** Fout bij het ophalen van agents uit Paperclip (kantoor toont dan wat het nog weet). */
  paperclipError: string | null;
}
