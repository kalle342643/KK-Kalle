/**
 * Een kleine GitHub-client voor de werkplaats. Alleen lezen. Onthoudt per adres de ETag, zodat een
 * ongewijzigde pagina als 304 terugkomt: dat telt niet mee voor de limiet van GitHub (5000 per uur).
 */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/** Wat de werkplaats van GitHub nodig heeft. In tests vervangen door een nep-versie. */
export interface GitHubApi {
  get<T>(path: string): Promise<T>;
}

const HHMM = (d: Date) => d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });

function explain(status: number, path: string, body: unknown, reset: Date | null): string {
  const msg = body && typeof body === "object" && "message" in body ? String((body as { message: unknown }).message) : "";
  if (status === 401) return "GitHub-token ongeldig of verlopen (HQ_GITHUB_TOKEN).";
  if (status === 403 && reset) return `GitHub-limiet bereikt; weer vrij om ${HHMM(reset)}.`;
  if (status === 403) return "Het token mag dit niet lezen: geef het leesrechten op deze repository.";
  if (status === 404) return "Niet gevonden, of het token heeft geen toegang tot deze repository.";
  if (status === 409) return "De repository is nog leeg.";
  return `GitHub gaf ${status}${msg ? `: ${msg}` : ""} (${path})`;
}

export class GitHubClient implements GitHubApi {
  private readonly cache = new Map<string, { etag: string; data: unknown }>();
  remaining: number | null = null;
  reset: Date | null = null;

  constructor(
    private readonly token: string | undefined,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly base = "https://api.github.com",
  ) {}

  async get<T>(path: string): Promise<T> {
    const url = `${this.base}${path}`;
    const cached = this.cache.get(url);
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "kk-holding-hq",
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (cached) headers["if-none-match"] = cached.etag;
    const res = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(20_000) });
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    if (remaining !== null) this.remaining = Number(remaining);
    if (reset !== null) this.reset = new Date(Number(reset) * 1000);
    if (res.status === 304 && cached) return cached.data as T;
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const limited = res.status === 429 || (res.status === 403 && this.remaining === 0);
      throw new GitHubError(res.status, path, explain(res.status, path, body, limited ? this.reset : null));
    }
    const data = (await res.json()) as T;
    const etag = res.headers.get("etag");
    if (etag) {
      this.cache.set(url, { etag, data });
      if (this.cache.size > 800) this.cache.delete(this.cache.keys().next().value!);
    }
    return data;
  }
}

/** Het bericht van een commit: eerste regel als titel, en de Claude Code-sessie als die erin staat. */
export function parseCommitMessage(message: string): { title: string; sessionUrl: string | null; sessionId: string | null } {
  const title = (message.split("\n")[0] ?? "").trim().slice(0, 200);
  const m = message.match(/https:\/\/claude\.ai\/code\/(session_[A-Za-z0-9]{8,64})/);
  return { title, sessionUrl: m ? `https://claude.ai/code/${m[1]}` : null, sessionId: m ? m[1]! : null };
}

/** Een GitHub-bestand (contents-API) als tekst. */
export function decodeContent(file: { content?: string; encoding?: string }): string {
  if (!file.content) return "";
  return file.encoding === "base64" ? Buffer.from(file.content, "base64").toString("utf8") : file.content;
}
