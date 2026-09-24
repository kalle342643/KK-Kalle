import type { AppContext } from "../domain/context.js";
import type { OfficeCode } from "../office/types.js";
import { listCodeProjects, summarize, uptime24h } from "./projects.js";
import { listSessions } from "./sessions.js";

/** De werkplaats zoals het kantoor hem laat zien: projecten met hun stand, en de sessies van nu. */
export async function codeOverview(ctx: AppContext): Promise<OfficeCode> {
  const now = ctx.now();
  const [projects, sessions, uptime] = await Promise.all([listCodeProjects(ctx.db), listSessions(ctx.db, now), uptime24h(ctx.db, now)]);
  const active = new Map<string, number>();
  for (const s of sessions) {
    if (s.projectKey && s.state !== "done") active.set(s.projectKey, (active.get(s.projectKey) ?? 0) + 1);
  }
  return {
    projects: projects.map((p) => summarize(p, { uptime: uptime.get(p.key) ?? null, activeSessions: active.get(p.key) ?? 0 })),
    sessions,
    github: Boolean(ctx.config.code.githubToken),
    hooks: Boolean(ctx.config.code.hookToken),
  };
}

/** Een paar regels voor het dagrapport: wat staat er live, wat is rood, wat wacht op jou. */
export async function codeReportLines(ctx: AppContext): Promise<string[]> {
  const { projects } = await codeOverview(ctx);
  if (!projects.length) return [];
  const lines = ["", "🛠️ Werkplaats"];
  for (const p of projects) {
    const bits: string[] = [];
    if (p.health.state === "down") bits.push(`🔴 ligt eruit${p.health.note ? ` (${p.health.note})` : ""}`);
    else if (p.health.state === "up") bits.push(`🟢 online${p.health.uptime24h !== null ? ` (${Math.round(p.health.uptime24h * 100)}% vandaag)` : ""}`);
    if (p.ci?.state === "failed") bits.push("tests rood");
    if (p.deploy && (p.deploy.state === "failure" || p.deploy.state === "error")) bits.push("uitrollen mislukt");
    if (p.openPrs.length) bits.push(`${p.openPrs.length} open PR`);
    if (p.backlog?.ownerCount) bits.push(`${p.backlog.ownerCount} ${p.backlog.ownerCount === 1 ? "punt wacht" : "punten wachten"} op jou`);
    if (p.empty) bits.push("nog geen code op GitHub");
    if (p.error) bits.push(`⚠️ ${p.error}`);
    lines.push(`• ${p.name}: ${bits.length ? bits.join(", ") : "niets bijzonders"}`);
  }
  return lines;
}
