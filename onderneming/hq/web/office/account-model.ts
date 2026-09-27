/**
 * Het kantoor op je Claude-account, zonder browser: de sessielijst van de connector "Claude Code Remote" omzetten
 * naar een momentopname van het kantoor, zien wat er veranderde, en de opdracht voor de hoofdagent opstellen.
 * Alles hier is gewone rekenwerk (geen window, geen netwerk), zodat het te testen is.
 */
import type { CodeProject, CodeSession, CodeSessionAccount, OfficeAccount, OfficeEvent, OfficePerson, OfficeSnapshot } from "../../src/office/types.js";
import { OWNER_ID } from "./layout.js";

/** De connector zoals claude.ai hem noemt (ingebouwd, voor iedereen met Claude Code op het web). */
export const SERVER = "Claude Code Remote";
/** De repository van de holding: daar staan CLAUDE.md en de skill van de hoofdagent. */
export const HOLDING_REPO = "https://github.com/kalle342643/KK-Kalle";
export const HOOFDAGENT_TAG = "hoofdagent";
/** Kamer (slug) van de hoofdagent in het kantoor. */
export const HOOFDAGENT_ROOM = "hoofdagent";

/** Klaar = nog 6 uur aan het bureau (dan zie je het), daarna naar huis. */
const DONE_AT_DESK_MS = 6 * 3_600_000;
/** Wat langer dan twee weken stil is en klaar, laat het kantoor weg. */
const KEEP_MS = 14 * 86_400_000;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const list = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);

/** De sessies uit een antwoord van list_sessions (de lijst zit soms een laag dieper). */
export function sessionsFrom(payload: unknown): Obj[] {
  const o = obj(payload);
  const ccr = obj(o?.ccr);
  const raw = list(payload) ?? list(ccr?.data) ?? list(o?.data) ?? list(o?.sessions) ?? [];
  return raw.map(obj).filter((s): s is Obj => Boolean(s && str(s.id)));
}

export type Bucket = CodeSessionAccount["bucket"];

export function bucketOf(s: Obj): Bucket {
  const status = str(s.session_status) ?? "";
  if (status.includes("ARCHIVED")) return "archived";
  const b = str(s.status_bucket) ?? "";
  if (b.includes("WORKING")) return "working";
  if (b.includes("BLOCKED")) return "waiting";
  if (b.includes("REVIEW")) return "review";
  if (b.includes("FAILED")) return "failed";
  if (b.includes("COMPLETED")) return "done";
  if (status.includes("RUNNING")) return "working";
  if (status.includes("REQUIRES_ACTION")) return "waiting";
  return "done";
}

/** Tags lezen: `afdeling:<slug>`, `rol:<rol>`, `ouder:<sessie-id>`. */
export function tagValue(tags: string[], key: string): string | null {
  const hit = tags.find((t) => t.toLowerCase().startsWith(`${key}:`));
  return hit ? str(hit.slice(key.length + 1)) : null;
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/** "marketing-games" → "Marketing games". */
export function teamName(slug: string): string {
  const words = slug.replace(/-/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Afdeling";
}

/** "https://github.com/eigenaar/repo(.git)" → "eigenaar/repo". */
export function repoOf(s: Obj): string | null {
  const ctx = obj(s.session_context);
  for (const o of list(ctx?.outcomes) ?? []) {
    const repo = str(obj(obj(obj(o)?.git_repository)?.git_info)?.repo);
    if (repo) return repo;
  }
  for (const src of list(ctx?.sources) ?? []) {
    const url = str(obj(obj(src)?.git_repository)?.url);
    const m = url?.match(/github\.com\/([^/]+\/[^/.]+)/i);
    if (m) return m[1]!;
  }
  return null;
}

function branchOf(s: Obj): string | null {
  const ctx = obj(s.session_context);
  for (const o of list(ctx?.outcomes) ?? []) {
    const b = list(obj(obj(obj(o)?.git_repository)?.git_info)?.branches)?.map(str).find(Boolean);
    if (b) return b;
  }
  const current = obj(obj(s.external_metadata)?.current_branches);
  return current ? (Object.values(current).map(str).find(Boolean) ?? null) : null;
}

function summaryOf(s: Obj): Obj {
  return { ...(obj(obj(s.external_metadata)?.post_turn_summary) ?? {}), ...(obj(s.post_turn_summary) ?? {}) };
}

const isoOr = (v: unknown, fallback: string) => {
  const t = str(v);
  return t && !Number.isNaN(Date.parse(t)) ? t : fallback;
};

/** Eén sessie zoals het kantoor hem tekent. */
export function toCodeSession(s: Obj, now: number): CodeSession {
  const id = str(s.id)!;
  const tags = (list(s.tags) ?? []).map(str).filter((t): t is string => Boolean(t));
  const bucket = bucketOf(s);
  const summary = summaryOf(s);
  const meta = obj(s.external_metadata);
  const hoofdagent = tags.some((t) => t.toLowerCase() === HOOFDAGENT_TAG);
  const teamTag = tagValue(tags, "afdeling");
  const team = !hoofdagent && teamTag ? slugify(teamTag) || null : null;
  const kind: CodeSessionAccount["kind"] = hoofdagent ? "hoofdagent" : team ? "afdeling" : "los";
  const repo = repoOf(s);
  const envKind = str(s.environment_kind) ?? "";
  const where: CodeSessionAccount["where"] = envKind === "anthropic_cloud" ? "cloud" : envKind === "bridge" ? "computer" : "other";
  const role = tagValue(tags, "rol");
  const created = isoOr(s.created_at, new Date(now).toISOString());
  const updated = isoOr(s.updated_at, created);
  const working = bucket === "working";
  const task = str(s.task_summary) ?? str(meta?.task_summary);
  const lastAction = working ? (task ?? str(summary.recent_action)) : (str(summary.recent_action) ?? str(summary.status_detail) ?? task);
  const age = now - Date.parse(updated);
  const atDesk = bucket === "working" || bucket === "waiting" || bucket === "review" || bucket === "failed" || (bucket === "done" && age < DONE_AT_DESK_MS);
  const repoName = repo?.split("/")[1] ?? null;
  const teamLabel = team ? teamName(team) : null;
  const label = hoofdagent
    ? "Hoofdagent"
    : team
      ? `${role ? teamName(slugify(role)) : "Claude"} · ${teamLabel}`
      : `Claude · ${repoName ?? (where === "computer" ? "je computer" : "chat")}`;
  return {
    id,
    actorId: `cc:${id}`,
    projectKey: repo ? repo.toLowerCase() : null,
    source: where === "computer" ? "local" : "cloud",
    url: `https://claude.ai/code/${id}`,
    branch: branchOf(s),
    title: str(s.title),
    lastAction,
    startedAt: created,
    lastActivityAt: updated,
    state: working ? "working" : atDesk ? "idle" : "done",
    commits: 0,
    pr: null,
    helpers: [],
    helpersUsed: 0,
    room: hoofdagent ? HOOFDAGENT_ROOM : team ? `afd-${team}` : null,
    label,
    account: {
      bucket,
      kind,
      team,
      teamName: teamLabel,
      role,
      parentId: tagValue(tags, "ouder"),
      tags,
      model: str(obj(s.session_context)?.model) ?? str(meta?.last_served_model) ?? str(s.configured_model),
      costUsd: num(obj(meta?.usage)?.cost_usd),
      needsAction: str(summary.needs_action),
      statusDetail: str(summary.status_detail),
      where,
      unread: s.unread === true,
      repo,
    },
  };
}

/** Welke sessies het kantoor laat zien: alles wat loopt of wacht, en wat klaar is tot twee weken terug. */
export function visibleSessions(raw: Obj[], now: number): CodeSession[] {
  return raw
    .map((s) => toCodeSession(s, now))
    .filter((s) => {
      const age = now - Date.parse(s.lastActivityAt);
      const b = s.account!.bucket;
      if (b === "archived") return s.account!.kind !== "los" && age < KEEP_MS;
      return b !== "done" || age < KEEP_MS;
    })
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
}

export interface Routine {
  id: string;
  name: string;
  cron: string | null;
  nextRunAt: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
}

export function routinesFrom(payload: unknown): Routine[] {
  const o = obj(payload);
  const raw = list(o?.data) ?? list(o?.triggers) ?? list(payload) ?? [];
  return raw
    .map(obj)
    .filter((t): t is Obj => Boolean(t && str(t.id)))
    .map((t) => {
      const last = obj(t.last_run);
      const once = str(t.run_once_at);
      return {
        id: str(t.id)!,
        name: str(t.name) ?? "Routine",
        cron: str(t.cron_expression) ?? (once ? `eenmalig` : null),
        nextRunAt: str(t.next_run_at) ?? once,
        enabled: t.enabled !== false,
        lastRunAt: str(last?.fired_at),
        lastStatus: str(last?.status),
      };
    });
}

export interface Environment {
  id: string;
  name: string;
  kind: string | null;
}

export function environmentsFrom(payload: unknown): Environment[] {
  const o = obj(payload);
  const raw = list(o?.environments) ?? list(o?.data) ?? list(payload) ?? [];
  return raw
    .map(obj)
    .filter((e): e is Obj => Boolean(e && (str(e.environment_id) ?? str(e.id))))
    .map((e) => {
      const id = (str(e.environment_id) ?? str(e.id))!;
      return { id, name: str(e.name) ?? id, kind: str(e.kind) };
    });
}

/** Omgevingen voor Claude Cowork of je eigen computer kunnen geen repository openen: die slaan we over. */
const notCloud = (e: Environment) => /cowork|bridge/i.test(`${e.kind ?? ""} ${e.name}`);

/** De cloudomgeving voor een nieuwe sessie: die je het laatst gebruikte, anders de eerste die kan. */
export function pickEnvironment(sessions: Obj[], envs: Environment[]): string | null {
  const known = new Set(envs.map((e) => e.id));
  const recent = [...sessions]
    .filter((s) => str(s.environment_kind) === "anthropic_cloud" && str(s.environment_id))
    .sort((a, b) => Date.parse(str(b.updated_at) ?? "") - Date.parse(str(a.updated_at) ?? ""))
    .map((s) => str(s.environment_id)!)
    .find((id) => !envs.length || known.has(id));
  return recent ?? envs.find((e) => !notCloud(e))?.id ?? null;
}

/** De omgevingen om uit te kiezen (zonder Cowork en je eigen computer). */
export const cloudEnvironments = (envs: Environment[]) => envs.filter((e) => !notCloud(e));

/** Je gebruikslimiet zoals de laatst actieve sessie hem zag. */
export function limitFrom(sessions: Obj[]): OfficeAccount["limit"] {
  const latest = [...sessions]
    .filter((s) => obj(obj(s.external_metadata)?.rate_limit_info))
    .sort((a, b) => Date.parse(str(b.updated_at) ?? "") - Date.parse(str(a.updated_at) ?? ""))[0];
  const info = obj(obj(latest?.external_metadata)?.rate_limit_info);
  if (!info) return null;
  const resets = num(info.resetsAt);
  return {
    status: str(info.status) ?? "unknown",
    type: str(info.rateLimitType),
    resetsAt: resets ? new Date(resets * 1000).toISOString() : null,
  };
}

/** Een project per repository waar een sessie aan werkt (voor de borden in de werkplaats). */
function projectsOf(sessions: CodeSession[]): CodeProject[] {
  const seen = new Map<string, CodeProject>();
  for (const s of sessions) {
    const repo = s.account?.repo;
    if (!repo || !s.projectKey || seen.has(s.projectKey)) continue;
    seen.set(s.projectKey, {
      key: s.projectKey,
      name: repo.split("/")[1] ?? repo,
      repo,
      repoUrl: `https://github.com/${repo}`,
      url: null,
      healthUrl: null,
      branch: null,
      description: null,
      defaultBranch: null,
      empty: false,
      health: { state: "unknown", status: null, ms: null, checkedAt: null, since: null, uptime24h: null, note: null },
      deploy: null,
      ci: null,
      lastCommit: null,
      openPrs: [],
      backlog: null,
      activeSessions: 0,
      error: null,
      polledAt: null,
      source: "account",
    });
  }
  for (const p of seen.values()) p.activeSessions = sessions.filter((s) => s.projectKey === p.key && s.state !== "done").length;
  return [...seen.values()];
}

export interface AccountState {
  state: OfficeAccount["state"];
  message: string | null;
  updatedAt: number | null;
  sessions: Obj[];
  routines: Routine[];
  routinesError: string | null;
  environments: Environment[];
  owner: { nickname: string | null; avatar: number | null };
  events: OfficeEvent[];
  lastEventId: number;
}

export function accountSnapshot(st: AccountState, now: number): OfficeSnapshot {
  const sessions = visibleSessions(st.sessions, now);
  const recent = sessions.filter((s) => now - Date.parse(s.lastActivityAt) < 30 * 86_400_000);
  const teams = new Map<string, OfficeAccount["teams"][number]>();
  for (const s of sessions) {
    const a = s.account!;
    if (!a.team || a.bucket === "archived") continue;
    const t = teams.get(a.team) ?? { slug: a.team, name: a.teamName ?? teamName(a.team), sessions: 0, working: 0, waiting: 0 };
    t.sessions += 1;
    if (a.bucket === "working") t.working += 1;
    if (a.bucket === "waiting") t.waiting += 1;
    teams.set(a.team, t);
  }
  const count = (b: Bucket) => sessions.filter((s) => s.account!.bucket === b).length;
  const people: OfficePerson[] = [{ id: OWNER_ID, name: "Jij", nickname: st.owner.nickname, avatar: st.owner.avatar }];
  return {
    generatedAt: new Date(now).toISOString(),
    companyName: "KK Holding",
    halted: false,
    haltReason: null,
    timezone: "Europe/Amsterdam",
    kpis: { revenueTodayEur: 0, costTodayEur: 0, revenueMonthEur: 0, costMonthEur: 0, allowanceMonthEur: 0, runningExperiments: 0, pendingApprovals: 0 },
    branches: [],
    agents: [],
    people,
    projects: [],
    stats: { days: [], branches: [], totals: { revenue30Eur: 0, cost30Eur: 0, tokensToday: 0, runsToday: 0 }, agents: [] },
    approvals: [],
    knowledge: { source: "hq", nodes: 0, edges: 0, builtAt: null },
    events: st.events.slice(-60),
    lastEventId: st.lastEventId,
    paperclipError: null,
    code: { projects: projectsOf(sessions.filter((s) => s.state !== "done")), sessions, github: false, hooks: false },
    account: {
      state: st.state,
      message: st.message,
      updatedAt: st.updatedAt,
      teams: [...teams.values()].sort((a, b) => a.name.localeCompare(b.name)),
      routines: st.routines,
      routinesError: st.routinesError,
      environments: cloudEnvironments(st.environments).map((e) => ({ id: e.id, name: e.name })),
      limit: limitFrom(st.sessions),
      totals: {
        working: count("working"),
        waiting: count("waiting"),
        review: count("review"),
        failed: count("failed"),
        costUsd30d: Math.round(recent.reduce((sum, s) => sum + (s.account!.costUsd ?? 0), 0) * 100) / 100,
      },
    },
  };
}

/** Wat er tussen twee sessielijsten veranderde, als gebeurtenissen voor het logboek en de poppetjes. */
export function sessionChanges(before: CodeSession[], after: CodeSession[]): Array<Omit<OfficeEvent, "id" | "at">> {
  const old = new Map(before.map((s) => [s.id, s] as const));
  const out: Array<Omit<OfficeEvent, "id" | "at">> = [];
  for (const s of after) {
    const a = s.account!;
    const name = s.label ?? "Claude";
    const base = { type: "code.session" as const, agentId: s.actorId, targetAgentId: null };
    const data = { project: s.projectKey, projectName: a.repo?.split("/")[1] ?? null, session: s.id };
    const prev = old.get(s.id);
    if (!prev) {
      if (a.bucket === "archived" || a.bucket === "done") continue;
      out.push({ ...base, text: `${name} begint: ${s.title ?? "nieuwe sessie"}`, data: { ...data, action: "started" } });
      continue;
    }
    const was = prev.account!.bucket;
    if (was !== a.bucket) {
      const text: Record<Bucket, string> = {
        working: `${name} is aan het werk: ${s.lastAction ?? s.title ?? "nieuwe opdracht"}`,
        waiting: `${name} wacht op jou${a.needsAction ? `: ${a.needsAction}` : ""}`,
        review: `${name} is klaar, kijk je even? ${s.title ?? ""}`.trim(),
        done: `${name} is klaar: ${s.title ?? "sessie"}`,
        failed: `${name} liep vast: ${a.statusDetail ?? s.title ?? "sessie"}`,
        archived: `${name} is gearchiveerd`,
      };
      const action: Record<Bucket, string> = { working: "task", waiting: "needs-you", review: "stopped", done: "stopped", failed: "failed", archived: "archived" };
      out.push({ ...base, text: text[a.bucket], data: { ...data, action: action[a.bucket], bucket: a.bucket } });
    } else if (a.bucket === "working" && s.lastAction && s.lastAction !== prev.lastAction) {
      out.push({ ...base, text: s.lastAction, data: { ...data, action: "tool" } });
    }
  }
  return out;
}

export interface McpErrorLike {
  code?: unknown;
  message?: unknown;
  retryable?: unknown;
}

export type Trouble = { kind: "blocked" | "unavailable" | "transient" | "failed" | "gone"; message: string };

/** Wat een fout van de connector betekent en wat jij eraan kunt doen. */
export function explainError(err: unknown): Trouble {
  const e = (err ?? {}) as McpErrorLike;
  const code = typeof e.code === "string" ? e.code : "upstream_error";
  const message = typeof e.message === "string" ? e.message : err instanceof Error ? err.message : String(err);
  switch (code) {
    case "not_granted":
    case "capability_disabled":
    case "capability_removed":
      return { kind: "unavailable", message: "Deze weergave kan niet bij je Claude-account. Open het kantoor op claude.ai, ingelogd met je eigen account." };
    case "needs_reauth":
      return { kind: "blocked", message: "Je koppeling met Claude Code Remote is verlopen. Maak hem opnieuw aan in claude.ai → Instellingen → Connectors, en herlaad dan deze pagina." };
    case "server_not_connected":
    case "server_not_found":
      return { kind: "blocked", message: "Claude Code Remote staat niet aan voor je account. Zet hem aan in claude.ai → Instellingen → Connectors, en herlaad dan deze pagina." };
    case "selection_required":
      return { kind: "blocked", message: "Je hebt meer dan één koppeling met Claude Code Remote. Kies er één als claude.ai erom vraagt; herlaad de pagina als die vraag weg is." };
    case "not_in_manifest":
    case "consent_required":
      return { kind: "blocked", message: "Je gaf dit kantoor (nog) geen toegang tot je Claude-sessies. Herlaad de pagina en kies Toestaan." };
    case "blocked_by_policy":
    case "approval_required":
      return { kind: "blocked", message: "Je organisatie staat dit niet toe in een artifact." };
    case "server_unavailable":
    case "rate_limited":
      return { kind: "transient", message: "Claude Code Remote reageert even niet. Het kantoor probeert het vanzelf opnieuw." };
    case "tool_error":
      return { kind: "failed", message: `Claude Code Remote gaf een fout: ${message}` };
    case "user_changed":
      return { kind: "gone", message: "Je bent met een ander account ingelogd. Herlaad de pagina." };
    case "cancelled":
      return { kind: "failed", message: "Afgebroken." };
    case "bad_request":
    case "transform_error":
      return { kind: "failed", message: `Fout in het kantoor zelf: ${message}` };
    default:
      return e.retryable === true
        ? { kind: "transient", message: "Claude Code Remote reageert even niet. Het kantoor probeert het vanzelf opnieuw." }
        : { kind: "failed", message: `Er ging iets mis bij Claude Code Remote: ${message}` };
  }
}

/** De vaste rol van de hoofdagent (gaat mee als extra systeemprompt; de details staan in de skill in de repo). */
export const HOOFDAGENT_ROLE = [
  "Je bent de hoofdagent van KK Holding, de AI-holding van Kalle (18). Kalle stuurt zijn opdrachten en plannen vanuit",
  "zijn kantoor (een artifact op claude.ai): dat is voortaan zijn enige ingang. Hij plant zelf. Jij bekijkt zijn plan eerlijk,",
  "werkt het uit, maakt er een afdeling voor en verdeelt het werk over agents: Claude Code-sessies, en zodra zijn server",
  "draait ook de Paperclip-agents via HQ.",
  "",
  "Lees eerst CLAUDE.md en volg daarna de skill `hoofdagent` (.claude/skills/hoofdagent/SKILL.md): hoe je een afdeling",
  "maakt (tags `afdeling:<slug>`, `rol:<rol>` en `ouder:<jouw sessie-id>`), hoeveel sessies je mag starten en wat je nooit",
  "doet. Antwoord Kalle in het Nederlands: kort, eerst het antwoord.",
].join("\n");

export interface PlanRequest {
  text: string;
  /** Vervolg op een eerdere sessie van de hoofdagent. */
  followUp?: { id: string; title: string | null } | null;
}

/** Titel van de nieuwe sessie: de eerste regel van je opdracht, kort. */
export function planTitle(text: string): string {
  const first = text.trim().split(/\r?\n/)[0]!.replace(/\s+/g, " ");
  return `Hoofdagent: ${first.length > 60 ? `${first.slice(0, 59).trimEnd()}…` : first}`;
}

export function planPrompt(req: PlanRequest): string {
  const parts = ["Opdracht van Kalle, via zijn kantoor:", "", req.text.trim()];
  if (req.followUp) {
    parts.push(
      "",
      `Dit is een vervolg op je sessie "${req.followUp.title ?? "eerder werk"}" (${req.followUp.id}). Lees die eerst met get_session, dan weet je wat er al gebeurd is.`,
    );
  }
  return parts.join("\n");
}

/** De invoer voor create_session: een nieuwe hoofdagent in de repository van de holding. */
export function createSessionInput(req: PlanRequest, environmentId: string): Record<string, unknown> {
  return {
    prompt: planPrompt(req),
    title: planTitle(req.text),
    tags: [HOOFDAGENT_TAG],
    source_url: HOLDING_REPO,
    environment_id: environmentId,
    append_system_prompt: HOOFDAGENT_ROLE,
  };
}

/** Het sessie-id uit het antwoord van create_session (de vorm is niet vastgelegd: zoek het eerste sessie-id). */
export function sessionIdIn(payload: unknown, depth = 0): string | null {
  if (typeof payload === "string") return /^session_[A-Za-z0-9]+$/.test(payload) ? payload : null;
  if (depth > 4) return null;
  if (Array.isArray(payload)) {
    for (const x of payload) {
      const hit = sessionIdIn(x, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const o = obj(payload);
  if (!o) return null;
  for (const key of ["id", "session_id", "sessionId"]) {
    const hit = sessionIdIn(o[key], depth + 1);
    if (hit) return hit;
  }
  for (const v of Object.values(o)) {
    const hit = sessionIdIn(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}
