import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AppContext } from "../domain/context.js";
import { listCodeProjects } from "./projects.js";
import { actorIdOf, sessionOnBranch, touchSession } from "./sessions.js";

/**
 * Live meldingen van Claude Code (hooks). Het script deploy/claude-code/hq-hook.mjs stuurt bij het begin,
 * bij een nieuwe opdracht, bij tools en aan het eind een klein bericht. Het haalt er zelf al alles uit
 * wat geheim kan zijn: HQ krijgt alleen de soort stap en een korte omschrijving (zoekvraag, adres,
 * bestandsnaam), nooit bestandsinhoud of omgevingsvariabelen.
 */

export const hookSchema = z.object({
  event: z.enum(["ping", "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "SubagentStop", "SessionEnd"]),
  sessionId: z.string().regex(/^[\w.-]{1,100}$/),
  /** eigenaar/naam van de git-remote. */
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/).max(120).nullish(),
  branch: z.string().max(200).nullish(),
  /** Soort stap, zoals het script hem herkende. */
  kind: z.enum(["search", "fetch", "crawl", "trends", "graph", "code", "test", "git", "skill"]).nullish(),
  detail: z.string().max(200).nullish(),
  /** De opdracht (alleen bij UserPromptSubmit), ingekort en zonder geheimen. */
  prompt: z.string().max(300).nullish(),
  /** cloud (claude.ai/code) of lokaal (terminal, desktop). */
  where: z.enum(["cloud", "local"]).nullish(),
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
};

/** Per sessie per soort stap hooguit één kantoormelding per zoveel tijd. */
const GAP_MS = 10_000;
const lastShown = new Map<string, number>();

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
      if (p.prompt) {
        title = p.prompt;
        newTask = true;
        action = `📋 ${p.prompt}`;
        event = { text: `Nieuwe opdracht voor Claude Code (${name}): ${p.prompt}`, action: "task" };
      }
      break;
    case "PreToolUse":
    case "PostToolUse":
      if (p.kind) {
        action = `${ICON[p.kind]} ${p.detail ?? p.kind}`;
        const key = `${id}:${p.kind}`;
        if (Date.now() - (lastShown.get(key) ?? 0) >= GAP_MS) {
          lastShown.set(key, Date.now());
          if (lastShown.size > 2000) lastShown.delete(lastShown.keys().next().value!);
          event = { text: action, action: "tool" };
        }
      }
      break;
    case "Stop":
      action = "✅ Klaar, wacht op jou";
      event = { text: `Claude Code is klaar met ${name}`, action: "stopped" };
      break;
    case "SessionEnd":
      ended = true;
      action = "👋 Sessie gesloten";
      break;
    default:
      break;
  }
  await touchSession(ctx.db, {
    id,
    projectKey,
    source: p.where === "cloud" ? "cloud" : "local",
    branch: p.branch ?? null,
    title,
    action,
    at: now,
    ended,
    newTask,
  });
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
