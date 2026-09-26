import type { AppContext } from "../domain/context.js";
import type { GitHubApi } from "./github.js";
import { listCodeProjects, saveCodeProject, slugify } from "./projects.js";

/** Wat GitHub per repository teruggeeft in /user/repos (alleen wat we gebruiken). */
interface GhUserRepo {
  full_name: string;
  name: string;
  homepage: string | null;
  description: string | null;
  archived?: boolean;
  disabled?: boolean;
}

/** Gangbare adressen voor een gezondheidscheck. De eerste die echt antwoordt, wint. */
export const HEALTH_PATHS = ["/api/gezondheid", "/api/health", "/health"];

/** Het veld "website" van een repository als bruikbaar adres (ook zonder https:// ervoor). */
export function siteUrl(homepage: string | null | undefined): string | null {
  const raw = homepage?.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".") ? u.toString().replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

/**
 * Zoekt de gezondheidscheck van een site. Alleen een antwoord dat er echt zo uitziet telt (JSON, of een korte tekst
 * met "ok"): veel sites geven op elk adres hun gewone pagina terug, en dat is geen gezondheidscheck.
 */
export async function findHealthUrl(site: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  for (const path of HEALTH_PATHS) {
    const target = new URL(path, `${site}/`).toString();
    try {
      const res = await fetchImpl(target, { signal: AbortSignal.timeout(5_000), headers: { "user-agent": "HQ-werkplaats" } });
      if (res.status !== 200) continue;
      const type = res.headers.get("content-type") ?? "";
      const text = (await res.text()).slice(0, 2_000);
      if (type.includes("json") || (!type.includes("html") && /\b(ok|healthy|gezond)\b/i.test(text))) return target;
    } catch {
      // Niet bereikbaar of te traag: probeer het volgende adres.
    }
  }
  return null;
}

/**
 * Volgt vanzelf elke repository waar het GitHub-token bij kan en die HQ nog niet kent. Zo hoef je in het kantoor
 * niets meer toe te voegen. Wat je ooit weghaalde, komt niet terug; gearchiveerde repositories slaat HQ over.
 */
export async function followNewRepos(ctx: AppContext, gh: GitHubApi, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const known = await listCodeProjects(ctx.db, { archived: true });
  const knownRepos = new Set(known.map((p) => p.repo?.toLowerCase()).filter(Boolean));
  const keys = new Set(known.map((p) => p.key));
  const added: Array<{ key: string; name: string }> = [];
  for (const r of await gh.get<GhUserRepo[]>("/user/repos?per_page=100&sort=pushed")) {
    if (r.archived || r.disabled || knownRepos.has(r.full_name.toLowerCase())) continue;
    const name = (r.name.length >= 2 ? r.name : r.full_name).slice(0, 40);
    let key = slugify(name);
    for (let i = 2; keys.has(key); i++) key = `${slugify(name).slice(0, 36)}-${i}`;
    keys.add(key);
    const url = siteUrl(r.homepage);
    await saveCodeProject(
      ctx,
      { key, name, repo: r.full_name, url, healthUrl: url ? await findHealthUrl(url, fetchImpl) : null, description: r.description?.slice(0, 300) ?? null },
      "system",
    );
    added.push({ key, name });
  }
  if (added.length) {
    const names = added.map((a) => a.name);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} en ${names.at(-1)}`;
    await ctx.notifier.send({
      text: `🛠️ Werkplaats: ik volg nu ${list}. Die kwamen mee met je GitHub-token. Niet volgen? Haal ze weg in het kantoor; dan komen ze niet terug.`,
    });
    for (const a of added) {
      await ctx.events.emit({ type: "code.backlog", text: `${a.name} staat in de werkplaats`, data: { project: a.key, projectName: a.name, added: [] } });
    }
  }
  return added.map((a) => a.name);
}
