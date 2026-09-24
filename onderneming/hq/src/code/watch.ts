import { errorMessage, type AppContext } from "../domain/context.js";
import type { CiState } from "../office/types.js";
import { parseBacklog } from "./backlog.js";
import { decodeContent, GitHubError, parseCommitMessage, type GitHubApi } from "./github.js";
import { listCodeProjects, saveHealth, saveState, type CodeProjectRow, type HealthState, type ProjectState } from "./projects.js";
import { actorIdOf, sessionOnBranch, setSessionPr, touchSession } from "./sessions.js";

/**
 * De werkplaats bijhouden: per project om de paar minuten GitHub bekijken (commits, pull requests,
 * tests, uitrol, backlog) en de site controleren. Wat verandert, wordt een kantoorgebeurtenis; een
 * site die eruit ligt of een productie-uitrol die mislukt, krijg je ook als bericht.
 */

interface GhRepo {
  default_branch: string;
  html_url: string;
  size: number;
  pushed_at: string | null;
}
interface GhBranch {
  name: string;
  commit: { sha: string };
}
interface GhCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author: { date: string } | null; committer: { date: string } | null };
}
interface GhPull {
  number: number;
  title: string;
  html_url: string;
  draft: boolean;
  updated_at: string;
  merged_at?: string | null;
  state: string;
  head: { ref: string; sha: string };
}
interface GhRun {
  status: string;
  conclusion: string | null;
  html_url: string;
  updated_at: string;
}
interface GhCombinedStatus {
  state: string;
  total_count: number;
  statuses: Array<{ state: string; target_url: string | null; context: string; updated_at: string }>;
}
interface GhDeployment {
  id: number;
  sha: string;
  environment: string;
  production_environment?: boolean;
  created_at: string;
}
interface GhDeploymentStatus {
  state: string;
  environment_url?: string | null;
  target_url?: string | null;
  created_at: string;
}

/** Welke branches volgen we? De hoofdbranch, die van Claude Code en die van open pull requests. */
const MAX_TRACKED = 14;
/** Per ronde per project hooguit zoveel losse commitmeldingen; de rest samengevat. */
const MAX_COMMIT_EVENTS = 4;

const FAILED = new Set(["failure", "timed_out", "startup_failure", "action_required"]);

export class CodeWatcher {
  private pollTimer: NodeJS.Timeout | undefined;
  private healthTimer: NodeJS.Timeout | undefined;
  private stopped = true;
  private polling = false;

  constructor(
    private readonly ctx: AppContext,
    private readonly gh: GitHubApi | null,
    private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = fetch,
  ) {}

  start(): void {
    this.stopped = false;
    const poll = async () => {
      if (this.stopped) return;
      await this.pollAll();
      if (!this.stopped) this.pollTimer = setTimeout(() => void poll(), this.ctx.config.code.pollMs);
    };
    const health = async () => {
      if (this.stopped) return;
      await this.checkAll();
      if (!this.stopped) this.healthTimer = setTimeout(() => void health(), this.ctx.config.code.healthMs);
    };
    // Even wachten na het opstarten, zodat HQ eerst zijn andere werk doet.
    this.pollTimer = setTimeout(() => void poll(), 5_000);
    this.healthTimer = setTimeout(() => void health(), 8_000);
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearTimeout(this.healthTimer);
  }

  // ---------------------------------------------------------------- GitHub

  async pollAll(): Promise<void> {
    if (!this.gh || this.polling) return;
    this.polling = true;
    try {
      for (const p of await listCodeProjects(this.ctx.db)) {
        if (!p.repo) continue;
        await this.pollProject(p);
      }
    } catch (err) {
      this.ctx.log.warn("werkplaats: bijhouden mislukt", { error: errorMessage(err) });
    } finally {
      this.polling = false;
    }
  }

  /** Eén project bij GitHub bijwerken. Fouten komen in de status van het project (zichtbaar in het kantoor). */
  async pollProject(p: CodeProjectRow): Promise<void> {
    const gh = this.gh!;
    const repo = p.repo!;
    const prev = p.state;
    const first = !prev.polledAt;
    const next: ProjectState = { ...prev, error: null, polledAt: this.ctx.now().toISOString() };
    try {
      const info = await gh.get<GhRepo>(`/repos/${repo}`);
      next.defaultBranch = info.default_branch;
      next.repoUrl = info.html_url;
      let branches: GhBranch[] = [];
      try {
        branches = await gh.get<GhBranch[]>(`/repos/${repo}/branches?per_page=100`);
      } catch (err) {
        if (!(err instanceof GitHubError && (err.status === 409 || err.status === 404))) throw err;
      }
      next.empty = branches.length === 0;
      if (next.empty) {
        await saveState(this.ctx.db, p.key, next);
        return;
      }

      const pulls = await gh.get<GhPull[]>(`/repos/${repo}/pulls?state=open&per_page=30`);
      const prBranches = new Set(pulls.map((pr) => pr.head.ref));
      const tracked = branches
        .filter((b) => b.name === info.default_branch || b.name.startsWith("claude/") || prBranches.has(b.name))
        .sort((a, b) => Number(b.name === info.default_branch) - Number(a.name === info.default_branch))
        .slice(0, MAX_TRACKED);

      await this.syncCommits(p, repo, tracked, next, first);
      await this.syncPulls(p, repo, pulls, next, first);
      await this.syncDefaultCi(p, repo, tracked, next, first);
      await this.syncDeploy(p, repo, next, first);
      await this.syncBacklog(p, repo, next, first);
    } catch (err) {
      next.error = err instanceof GitHubError ? err.message : `GitHub niet bereikbaar: ${errorMessage(err)}`;
      if (next.error !== prev.error) this.ctx.log.warn("werkplaats: GitHub-fout", { project: p.key, error: next.error });
    }
    await saveState(this.ctx.db, p.key, next);
  }

  private async syncCommits(p: CodeProjectRow, repo: string, tracked: GhBranch[], next: ProjectState, first: boolean): Promise<void> {
    const gh = this.gh!;
    const known = next.branches ?? {};
    const seen = new Set(next.seen ?? []);
    const fresh: Array<{ c: GhCommit; branch: string }> = [];
    // Bij de eerste keer alleen de laatste anderhalve dag: dan staan de sessies van nu meteen in de werkplaats.
    const since = new Date(this.ctx.now().getTime() - 36 * 3600_000).toISOString();
    for (const b of tracked) {
      if (known[b.name] === b.commit.sha) continue;
      const commits = await gh.get<GhCommit[]>(
        `/repos/${repo}/commits?sha=${encodeURIComponent(b.name)}&per_page=20${first || !known[b.name] ? `&since=${since}` : ""}`,
      );
      for (const c of commits) {
        if (seen.has(c.sha)) break;
        seen.add(c.sha);
        fresh.push({ c, branch: b.name });
      }
    }
    next.branches = Object.fromEntries(tracked.map((b) => [b.name, b.commit.sha]));
    next.seen = [...seen].slice(-300);

    // Oudste eerst verwerken, zodat de laatste actie van een sessie ook echt de laatste is.
    const at = (c: GhCommit) => new Date(c.commit.committer?.date ?? c.commit.author?.date ?? this.ctx.now());
    fresh.sort((a, b) => at(a.c).getTime() - at(b.c).getTime());
    let announced = 0;
    for (const { c, branch } of fresh) {
      const msg = parseCommitMessage(c.commit.message);
      const when = at(c);
      let actorId: string | null = null;
      const sessionId = msg.sessionId ?? (branch.startsWith("claude/") ? `branch:${p.key}:${branch}` : null);
      if (sessionId) {
        // Dezelfde branch = dezelfde sessie, ook als hij eerst via een hook binnenkwam.
        const onBranch = msg.sessionId ? undefined : await sessionOnBranch(this.ctx.db, p.key, branch, this.ctx.now());
        const id = onBranch?.id ?? sessionId;
        const { created } = await touchSession(this.ctx.db, {
          id,
          projectKey: p.key,
          source: "cloud",
          url: msg.sessionUrl,
          branch,
          title: msg.title,
          action: `✍️ ${msg.title}`,
          at: when,
          commit: true,
        });
        actorId = actorIdOf(id);
        if (created && !first) {
          await this.ctx.events.emit({
            type: "code.session",
            agentId: actorId,
            text: `Claude Code begint aan ${p.name}: ${msg.title}`,
            data: { project: p.key, action: "started", branch, url: msg.sessionUrl },
            sourceKey: `code:session:${id}:start`,
            at: when,
          });
        }
      }
      const isDefault = branch === next.defaultBranch;
      if (!next.lastCommit || new Date(next.lastCommit.at) <= when) {
        next.lastCommit = { sha: c.sha, title: msg.title, at: when.toISOString(), url: c.html_url, session: msg.sessionUrl, branch };
      }
      if (first) continue;
      if (announced < MAX_COMMIT_EVENTS) {
        announced += 1;
        await this.ctx.events.emit({
          type: "code.commit",
          agentId: actorId,
          text: msg.title,
          data: { project: p.key, projectName: p.name, branch, sha: c.sha.slice(0, 7), url: c.html_url, session: msg.sessionUrl, main: isDefault },
          sourceKey: `code:commit:${p.key}:${c.sha}`,
          at: when,
        });
      }
    }
    if (!first && fresh.length > MAX_COMMIT_EVENTS) {
      await this.ctx.events.emit({
        type: "code.commit",
        text: `…en nog ${fresh.length - MAX_COMMIT_EVENTS} commits op ${p.name}`,
        data: { project: p.key, projectName: p.name, summary: true },
      });
    }
  }

  private async syncPulls(p: CodeProjectRow, repo: string, pulls: GhPull[], next: ProjectState, first: boolean): Promise<void> {
    const gh = this.gh!;
    const before = new Map((next.prs ?? []).map((pr) => [pr.number, pr]));
    const prs: NonNullable<ProjectState["prs"]> = [];
    for (const pr of pulls.slice(0, 12)) {
      const old = before.get(pr.number);
      const ci = old && old.sha === pr.head.sha && old.ci !== "running" ? old.ci : (await this.ciFor(repo, pr.head.sha)).state;
      prs.push({ number: pr.number, title: pr.title, url: pr.html_url, draft: pr.draft, branch: pr.head.ref, ci, updatedAt: pr.updated_at, sha: pr.head.sha });
      const session = await sessionOnBranch(this.ctx.db, p.key, pr.head.ref, this.ctx.now());
      if (session) await setSessionPr(this.ctx.db, session.id, { number: pr.number, url: pr.html_url, state: "open", ci });
      if (first) continue;
      const actorId = session ? actorIdOf(session.id) : null;
      if (!old) {
        await this.ctx.events.emit({
          type: "code.pr",
          agentId: actorId,
          text: `PR #${pr.number}: ${pr.title}`,
          data: { project: p.key, projectName: p.name, action: "opened", number: pr.number, url: pr.html_url, draft: pr.draft },
          sourceKey: `code:pr:${p.key}:${pr.number}:opened`,
        });
      } else if (old.ci !== ci && (ci === "failed" || (old.ci === "failed" && ci === "passed"))) {
        await this.ctx.events.emit({
          type: "code.ci",
          agentId: actorId,
          text: ci === "failed" ? `Tests rood op PR #${pr.number}: ${pr.title}` : `Tests weer groen op PR #${pr.number}`,
          data: { project: p.key, projectName: p.name, state: ci, number: pr.number, url: pr.html_url },
        });
      }
    }
    // Weg uit de lijst: samengevoegd of gesloten.
    for (const [number, old] of before) {
      if (pulls.some((pr) => pr.number === number)) continue;
      let merged = false;
      try {
        const detail = await gh.get<GhPull>(`/repos/${repo}/pulls/${number}`);
        merged = Boolean(detail.merged_at);
      } catch {
        // Onbekend: dan heet hij gesloten.
      }
      const session = await sessionOnBranch(this.ctx.db, p.key, old.branch, this.ctx.now());
      if (session) await setSessionPr(this.ctx.db, session.id, { number, url: old.url, state: merged ? "merged" : "closed", ci: old.ci });
      await this.ctx.events.emit({
        type: "code.pr",
        agentId: session ? actorIdOf(session.id) : null,
        text: `${merged ? "Samengevoegd" : "Gesloten"}: PR #${number} ${old.title}`,
        data: { project: p.key, projectName: p.name, action: merged ? "merged" : "closed", number, url: old.url },
        sourceKey: `code:pr:${p.key}:${number}:${merged ? "merged" : "closed"}`,
      });
    }
    next.prs = prs;
  }

  private async syncDefaultCi(p: CodeProjectRow, repo: string, tracked: GhBranch[], next: ProjectState, first: boolean): Promise<void> {
    const main = tracked.find((b) => b.name === next.defaultBranch);
    if (!main) return;
    const prev = next.ci;
    if (prev && prev.sha === main.commit.sha && prev.state !== "running") return;
    const ci = await this.ciFor(repo, main.commit.sha);
    next.ci = { ...ci, sha: main.commit.sha };
    if (first || !prev || prev.state === ci.state) return;
    if (ci.state === "failed" || (prev.state === "failed" && ci.state === "passed")) {
      const text = ci.state === "failed" ? `Tests rood op ${next.defaultBranch} van ${p.name}` : `Tests weer groen op ${p.name}`;
      await this.ctx.events.emit({ type: "code.ci", text, data: { project: p.key, projectName: p.name, state: ci.state, url: ci.url, main: true } });
    }
  }

  /** De teststatus van één commit: GitHub Actions plus statussen van buiten (zoals Vercel). */
  async ciFor(repo: string, sha: string): Promise<{ state: CiState; url: string | null; at: string | null }> {
    const gh = this.gh!;
    let runs: GhRun[] = [];
    let combined: GhCombinedStatus | null = null;
    try {
      runs = (await gh.get<{ workflow_runs: GhRun[] }>(`/repos/${repo}/actions/runs?head_sha=${sha}&per_page=20`)).workflow_runs ?? [];
    } catch {
      // Geen Actions-rechten of geen workflows: dan alleen de statussen.
    }
    try {
      combined = await gh.get<GhCombinedStatus>(`/repos/${repo}/commits/${sha}/status`);
    } catch {
      // idem
    }
    const statuses = combined?.statuses ?? [];
    const failedRun = runs.find((r) => r.status === "completed" && r.conclusion && FAILED.has(r.conclusion));
    const failedStatus = statuses.find((s) => s.state === "failure" || s.state === "error");
    const running = runs.find((r) => r.status !== "completed") ?? statuses.find((s) => s.state === "pending");
    const latest = [...runs.map((r) => r.updated_at), ...statuses.map((s) => s.updated_at)].sort().pop() ?? null;
    if (failedRun || failedStatus) return { state: "failed", url: failedRun?.html_url ?? failedStatus?.target_url ?? null, at: latest };
    if (running) return { state: "running", url: "html_url" in running ? running.html_url : running.target_url, at: latest };
    if (runs.length || statuses.length) return { state: "passed", url: runs[0]?.html_url ?? statuses[0]?.target_url ?? null, at: latest };
    return { state: null, url: null, at: null };
  }

  private async syncDeploy(p: CodeProjectRow, repo: string, next: ProjectState, first: boolean): Promise<void> {
    const gh = this.gh!;
    let deployments: GhDeployment[];
    try {
      deployments = await gh.get<GhDeployment[]>(`/repos/${repo}/deployments?per_page=10`);
    } catch {
      return; // Geen rechten op deployments: dan weten we het niet.
    }
    const prod = deployments.find((d) => d.production_environment || /^production$/i.test(d.environment));
    if (!prod) return;
    const prev = next.deploy;
    if (prev && prev.id === prod.id && (prev.state === "success" || prev.state === "failure" || prev.state === "error" || prev.state === "inactive")) return;
    const statuses = await gh.get<GhDeploymentStatus[]>(`/repos/${repo}/deployments/${prod.id}/statuses?per_page=1`);
    const st = statuses[0];
    const state = st?.state ?? "pending";
    next.deploy = {
      id: prod.id,
      state,
      url: st?.environment_url || st?.target_url || null,
      at: st?.created_at ?? prod.created_at,
      environment: prod.environment,
      sha: prod.sha,
    };
    if (first || (prev?.id === prod.id && prev.state === state)) return;
    if (state === "success") {
      await this.ctx.events.emit({
        type: "code.deploy",
        text: `Nieuwe versie van ${p.name} staat live`,
        data: { project: p.key, projectName: p.name, state, url: next.deploy.url, sha: prod.sha.slice(0, 7) },
        sourceKey: `code:deploy:${p.key}:${prod.id}:success`,
      });
    } else if (state === "failure" || state === "error") {
      const text = `⚠️ Uitrollen van ${p.name} mislukt (${prod.environment}). De vorige versie draait nog.`;
      await this.ctx.events.emit({
        type: "code.deploy",
        text,
        data: { project: p.key, projectName: p.name, state, url: next.deploy.url, sha: prod.sha.slice(0, 7) },
        sourceKey: `code:deploy:${p.key}:${prod.id}:${state}`,
      });
      await this.ctx.notifier.send({ text }).catch(() => undefined);
    }
  }

  private async syncBacklog(p: CodeProjectRow, repo: string, next: ProjectState, first: boolean): Promise<void> {
    const gh = this.gh!;
    let file: { sha: string; content?: string; encoding?: string };
    try {
      file = await gh.get(`/repos/${repo}/contents/${p.backlogPath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(next.defaultBranch ?? "")}`);
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) {
        next.backlog = undefined;
        return;
      }
      throw err;
    }
    if (next.backlog?.sha === file.sha && next.backlog.path === p.backlogPath) return;
    const items = parseBacklog(decodeContent(file), this.ctx.config.code.ownerNames);
    const before = new Set((next.backlog?.items ?? []).filter((i) => i.owner).map((i) => i.title));
    next.backlog = { path: p.backlogPath, sha: file.sha, updatedAt: this.ctx.now().toISOString(), items };
    if (first) return;
    const added = items.filter((i) => i.owner && !before.has(i.title));
    const mine = items.filter((i) => i.owner).length;
    await this.ctx.events.emit({
      type: "code.backlog",
      text: added.length
        ? `${p.name}: ${added.length === 1 ? `nieuw punt voor jou: ${added[0]!.title}` : `${added.length} nieuwe punten voor jou`}`
        : `${p.name}: backlog bijgewerkt (${mine} ${mine === 1 ? "punt" : "punten"} voor jou)`,
      data: { project: p.key, projectName: p.name, added: added.map((i) => i.title), owner: mine, total: items.length },
    });
  }

  // ---------------------------------------------------------------- gezondheid

  async checkAll(): Promise<void> {
    try {
      for (const p of await listCodeProjects(this.ctx.db)) {
        if (p.healthUrl || p.url) await this.checkProject(p);
      }
      await this.ctx.db.query("delete from code_health where at < $1", [new Date(this.ctx.now().getTime() - 14 * 86_400_000).toISOString()]);
    } catch (err) {
      this.ctx.log.warn("werkplaats: gezondheidscheck mislukt", { error: errorMessage(err) });
    }
  }

  /** Eén controle. Twee mislukte controles op rij = ligt eruit (één hapering is nog geen storing). */
  async checkProject(p: CodeProjectRow): Promise<void> {
    const target = p.healthUrl ?? p.url!;
    const started = Date.now();
    let status: number | null = null;
    let note: string | null = null;
    try {
      const res = await this.fetchImpl(target, {
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
        headers: { "user-agent": "KK-Holding-HQ/1.0 (uptime-check)" },
      });
      status = res.status;
      await res.arrayBuffer().catch(() => undefined);
    } catch (err) {
      note = /timeout|abort/i.test(errorMessage(err)) ? "geen antwoord binnen 10 seconden" : `niet bereikbaar (${errorMessage(err).slice(0, 80)})`;
    }
    const ms = Date.now() - started;
    const ok = status !== null && (p.healthUrl ? status === 200 : status < 400);
    if (!ok && status !== null) {
      note = p.healthUrl && status === 503 ? "de gezondheidscheck zegt nee (503): vaak ligt de database eruit" : `de site gaf ${status}`;
    }
    await this.ctx.db.query("insert into code_health (project_key, ok, status, ms, at) values ($1, $2, $3, $4, $5)", [
      p.key,
      ok,
      status,
      ms,
      this.ctx.now().toISOString(),
    ]);

    const h = p.health;
    const now = this.ctx.now().toISOString();
    const next: HealthState = { ...h, status, ms, checkedAt: now, note: ok ? null : note };
    if (ok) {
      next.fails = 0;
      if (h.state !== "up") next.since = now;
      next.state = "up";
      if (h.state === "down") {
        const minutes = h.since ? Math.max(1, Math.round((Date.parse(now) - Date.parse(h.since)) / 60_000)) : null;
        const text = `🟢 ${p.name} is weer bereikbaar${minutes ? ` (lag ${minutes} min plat)` : ""}.`;
        await this.ctx.events.emit({ type: "code.health", text, data: { project: p.key, projectName: p.name, state: "up", status, minutes } });
        await this.ctx.notifier.send({ text }).catch(() => undefined);
      }
    } else {
      next.fails = (h.fails ?? 0) + 1;
      if (next.fails >= 2 && h.state !== "down") {
        next.state = "down";
        next.since = now;
        const text = `🔴 ${p.name} ligt eruit: ${note ?? "onbekende fout"}. Adres: ${target}`;
        await this.ctx.events.emit({ type: "code.health", text, data: { project: p.key, projectName: p.name, state: "down", status, note } });
        await this.ctx.notifier.send({ text }).catch(() => undefined);
      } else if (!h.state) {
        next.state = "unknown";
      }
    }
    await saveHealth(this.ctx.db, p.key, next);
  }
}
