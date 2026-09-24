import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AppContext } from "../domain/context.js";
import { listCodeProjects } from "./projects.js";
import { actorIdOf, HELPER_STALE_MS, helperActorIdOf, helperLabel, sessionOnBranch, startHelper, stopAllHelpers, stopHelper, touchSession } from "./sessions.js";

/**
 * Live meldingen van Claude Code (hooks). Het script deploy/claude-code/hq-hook.mjs stuurt bij het begin,
 * bij een nieuwe opdracht, bij tools en aan het eind een klein bericht. Het haalt er zelf al alles uit
 * wat geheim kan zijn: HQ krijgt alleen de soort stap en een korte omschrijving (zoekvraag, adres,
 * bestandsnaam), nooit bestandsinhoud of omgevingsvariabelen.
 */

export const hookSchema = z.object({
  event: z.enum(["ping", "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "SubagentStart", "SubagentStop", "SessionEnd"]),
  sessionId: z.string().regex(/^[\w.-]{1,100}$/),
  /** eigenaar/naam van de git-remote. */
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/).max(120).nullish(),
  branch: z.string().max(200).nullish(),
  /** Soort stap, zoals het script hem herkende. "helper" = de sessie zet een sub-agent in. */
  kind: z.enum(["search", "fetch", "crawl", "trends", "graph", "code", "test", "git", "skill", "helper"]).nullish(),
  detail: z.string().max(200).nullish(),
  /** De opdracht (alleen bij UserPromptSubmit), ingekort en zonder geheimen. */
  prompt: z.string().max(300).nullish(),
  /** cloud (claude.ai/code) of lokaal (terminal, desktop). */
  where: z.enum(["cloud", "local"]).nullish(),
  /** Stap van een sub-agent (of begin/einde ervan): zijn id en soort. */
  agentId: z.string().regex(/^[\w.-]{1,100}$/).nullish(),
  agentType: z.string().regex(/^[\w.: -]{1,80}$/).nullish(),
});

export type HookPayload = z.infer<typeof hookSchema>;

export function hookTokenOk(expected: string | undefined, header: string | undefined): boolean {
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const ICON: Record<NonNullable<HookPayload["kind"]>, string> = {
  search: "🔎",
  fetch: "🌐",
  crawl: "🌐",
  trends: "📈",
  graph: "🕸️",
  code: "✍️",
  test: "🧪",
  git: "📦",
  skill: "📘",
  helper: "🧑‍🤝‍🧑",
};

/** Per sessie per soort stap hooguit één kantoormelding per zoveel tijd. */
const GAP_MS = 10_000;
const lastShown = new Map<string, number>();

function shouldShow(key: string): boolean {
  if (Date.now() - (lastShown.get(key) ?? 0) < GAP_MS) return false;
  lastShown.set(key, Date.now());
  if (lastShown.size > 2000) lastShown.delete(lastShown.keys().next().value!);
  return true;
}

/**
 * Wat de sessie een helper vroeg. Claude Code meldt dat bij het inzetten (de tool Agent/Task, met een
 * korte omschrijving); het begin van de helper komt daarna, met zijn id maar zonder omschrijving.
 */
const PENDING_MS = 3 * 60_000;
const pendingTasks = new Map<string, Array<{ type: string; task: string | null; at: number }>>();

function rememberTask(sessionId: string, type: string, task: string | null): void {
  const now = Date.now();
  const list = (pendingTasks.get(sessionId) ?? []).filter((p) => now - p.at < PENDING_MS);
  list.push({ type, task, at: now });
  pendingTasks.set(sessionId, list.slice(-10));
  if (pendingTasks.size > 500) pendingTasks.delete(pendingTasks.keys().next().value!);
}

function takeTask(sessionId: string, type: string): string | null {
  const now = Date.now();
  const list = (pendingTasks.get(sessionId) ?? []).filter((p) => now - p.at < PENDING_MS);
  const i = list.findIndex((p) => p.type.toLowerCase() === type.toLowerCase());
  const [hit] = i >= 0 ? list.splice(i, 1) : [];
  pendingTasks.set(sessionId, list);
  return hit?.task ?? null;
}

export async function handleHook(ctx: AppContext, p: HookPayload): Promise<{ ok: true; session: string | null }> {
  if (p.event === "ping") return { ok: true, session: null };
  const projects = await listCodeProjects(ctx.db);
  const project = p.repo ? projects.find((x) => x.repo?.toLowerCase() === p.repo!.toLowerCase()) : undefined;
  const projectKey = project?.key ?? null;
  const now = ctx.now();
  // Dezelfde branch van hetzelfde project = dezelfde sessie als die HQ al aan de commits zag.
  const onBranch = projectKey && p.branch ? await sessionOnBranch(ctx.db, projectKey, p.branch, now) : undefined;
  const id = onBranch?.id ?? `${p.where === "cloud" ? "cloud" : "local"}:${p.sessionId}`;
  const actorId = actorIdOf(id);
  const name = project?.name ?? p.repo ?? "een project";
  const source = p.where === "cloud" ? "cloud" : "local";

  // Alles van een helper (sub-agent) hoort bij zijn eigen poppetje; de sessie blijft "bezig".
  if (p.agentId && (p.event === "SubagentStart" || p.event === "SubagentStop" || p.event === "PreToolUse" || p.event === "PostToolUse")) {
    await touchSession(ctx.db, { id, projectKey, source, branch: p.branch ?? null, at: now });
    await handleHelper(ctx, p, { id, actorId, projectKey, name, now, agentId: p.agentId });
    return { ok: true, session: id };
  }

  let action: string | null = null;
  let title: string | null = null;
  let newTask = false;
  let ended = false;
  let event: { text: string; action: string } | null = null;
  switch (p.event) {
    case "SessionStart":
      action = "▶️ Begonnen";
      event = { text: `Claude Code start aan ${name}`, action: "started" };
      break;
    case "UserPromptSubmit":
      // Een bericht van Claude Code zelf (bv. <task-notification> van een helper), geen opdracht van jou.
      if (p.prompt && !p.prompt.trim().startsWith("<")) {
        title = p.prompt;
        newTask = true;
        action = `📋 ${p.prompt}`;
        event = { text: `Nieuwe opdracht voor Claude Code (${name}): ${p.prompt}`, action: "task" };
      }
      break;
    case "PreToolUse":
    case "PostToolUse":
      if (p.kind === "helper") {
        // De sessie zet een helper in. Het poppetje komt pas bij het begin van de helper (met zijn id);
        // hier onthouden we alleen wat hij moet doen.
        const label = helperLabel(p.agentType ?? "general-purpose");
        rememberTask(id, p.agentType ?? "general-purpose", p.detail ?? null);
        action = `${ICON.helper} ${label}${p.detail ? `: ${p.detail}` : ""}`;
      } else if (p.kind) {
        action = `${ICON[p.kind]} ${p.detail ?? p.kind}`;
        if (shouldShow(`${id}:${p.kind}`)) event = { text: action, action: "tool" };
      }
      break;
    case "Stop": {
      // Helpers kunnen op de achtergrond doorwerken terwijl de sessie zelf al stopt.
      const busy = await activeHelpers(ctx, id, now);
      if (busy) {
        action = `⏳ Wacht op ${busy === 1 ? "een helper" : `${busy} helpers`}`;
        event = { text: `Claude Code (${name}) wacht op ${busy === 1 ? "een helper" : `${busy} helpers`}`, action: "waiting" };
      } else {
        action = "✅ Klaar, wacht op jou";
        event = { text: `Claude Code is klaar met ${name}`, action: "stopped" };
      }
      break;
    }
    case "SessionEnd":
      ended = true;
      action = "👋 Sessie gesloten";
      break;
    default:
      break;
  }
  await touchSession(ctx.db, { id, projectKey, source, branch: p.branch ?? null, title, action, at: now, ended, newTask });
  if (ended) await stopAllHelpers(ctx.db, id, now);
  if (event) {
    await ctx.events.emit({
      type: "code.session",
      agentId: actorId,
      text: event.text,
      data: { project: projectKey, projectName: name, action: event.action, kind: p.kind ?? null, branch: p.branch ?? null },
    });
  }
  return { ok: true, session: id };
}

async function activeHelpers(ctx: AppContext, sessionId: string, now: Date): Promise<number> {
  const rows = await ctx.db.query<{ n: string | number }>(
    "select count(*) as n from code_helpers where session_id = $1 and ended_at is null and last_activity_at >= $2",
    [sessionId, new Date(now.getTime() - HELPER_STALE_MS).toISOString()],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Begin, stappen en einde van een helper. */
async function handleHelper(
  ctx: AppContext,
  p: HookPayload,
  s: { id: string; actorId: string; projectKey: string | null; name: string; now: Date; agentId: string },
): Promise<void> {
  const type = p.agentType ?? "general-purpose";
  const label = helperLabel(type);
  const helperActor = helperActorIdOf(s.id, s.agentId);
  const data = { project: s.projectKey, projectName: s.name, session: s.actorId, label, agentType: type };
  const emit = (action: string, text: string, extra: Record<string, unknown> = {}) =>
    ctx.events.emit({ type: "code.helper", agentId: helperActor, targetAgentId: s.actorId, text, data: { ...data, action, ...extra } });

  if (p.event === "SubagentStop") {
    const row = await stopHelper(ctx.db, s.id, s.agentId, s.now);
    if (row) await emit("stop", `📨 ${label} levert op${row.task ? `: ${row.task}` : ""}`, { task: row.task, tools: row.tools });
    return;
  }
  const step = p.event === "SubagentStart" || !p.kind || p.kind === "helper" ? null : `${ICON[p.kind]} ${p.detail ?? p.kind}`;
  const task = p.event === "SubagentStart" ? takeTask(s.id, type) : null;
  const { created, row } = await startHelper(ctx.db, { sessionId: s.id, agentId: s.agentId, agentType: type, task, action: step, at: s.now, tool: Boolean(step) });
  // Nieuw (ook als het begin-bericht gemist werd): de sessie zet iemand in.
  if (created) await emit("start", `${ICON.helper} ${label} erbij${row.task ? `: ${row.task}` : ""}`, { task: row.task });
  if (step && shouldShow(`${helperActor}:${p.kind}`)) await emit("tool", step, { kind: p.kind });
}
