import { listApprovals, type ApprovalRecord } from "../domain/approvals.js";
import { recentAudit } from "../domain/audit.js";
import { listBranches } from "../domain/branches.js";
import { errorMessage, type AppContext } from "../domain/context.js";
import { experimentCode, listExperiments, snapshot } from "../domain/experiments.js";
import { haltState } from "../domain/killswitch.js";
import { recentLedger, totals } from "../domain/ledger.js";
import { searchLessons } from "../domain/lessons.js";
import { formatEur, usdCentsToEur } from "../domain/money.js";
import { computePortfolio } from "../domain/portfolio.js";
import { addLocalDays, localDayKey, startOfLocalDay, startOfLocalMonth } from "../domain/time.js";
import type { PcAgent } from "../paperclip/types.js";

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

const STATUS_LABEL: Record<string, string> = {
  running: "werkt",
  idle: "idle",
  active: "idle",
  paused: "gepauzeerd",
  error: "fout",
  pending_approval: "wacht op jou",
  terminated: "gestopt",
};

function bar(fraction: number, tone: "ok" | "warn" = "ok"): string {
  const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  return `<span class="bar ${tone}"><span style="width:${pct}%"></span></span>`;
}

function approvalRow(a: ApprovalRecord): string {
  return `<li class="approval" data-id="${a.id}">
    <div><strong>#${a.id} ${esc(a.title)}</strong>${a.amountEur !== null && !a.title.includes("€") ? ` · ${esc(formatEur(a.amountEur))}` : ""}</div>
    ${a.summary ? `<pre>${esc(a.summary.slice(0, 700))}</pre>` : ""}
    <div class="actions">
      <button data-decide="approve">✅ ${a.kind === "budget_override" ? "Verhoog en hervat" : "Goedkeuren"}</button>
      <button data-decide="reject" class="secondary">${a.kind === "budget_override" ? "⏸ Laat gepauzeerd" : "❌ Afwijzen"}</button>
    </div>
  </li>`;
}

export async function renderDashboard(ctx: AppContext): Promise<string> {
  const tz = ctx.config.timezone;
  const today = startOfLocalDay(ctx.now(), tz);
  const tomorrow = addLocalDays(today, 1, tz);
  const halt = await haltState(ctx);
  const day = await totals(ctx.db, { from: today, to: tomorrow });
  const month = await totals(ctx.db, { from: startOfLocalMonth(ctx.now(), tz), to: tomorrow });
  const portfolio = await computePortfolio(ctx);
  const pending = await listApprovals(ctx.db, { status: ["pending"], limit: 30 });
  const running = await listExperiments(ctx.db, { status: ["running"] });
  const branches = await listBranches(ctx.db);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  let agents: PcAgent[] = [];
  let agentError = "";
  const costToday = new Map<string, number>();
  try {
    agents = (await ctx.paperclip.listAgents(ctx.companyId)).filter((a) => a.status !== "terminated");
    for (const c of await ctx.paperclip.costsByAgent(ctx.companyId, { from: today.toISOString(), to: tomorrow.toISOString() })) {
      costToday.set(c.agentId, usdCentsToEur(c.costCents, ctx.config.money.usdToEur));
    }
  } catch (err) {
    agentError = errorMessage(err);
  }

  const experimentRows: string[] = [];
  for (const e of running) {
    const s = await snapshot(ctx, e);
    const value = s.trustedValue ?? s.untrustedValue ?? 0;
    experimentRows.push(`<li>
      <div><strong>${experimentCode(e.id)}</strong> ${esc(e.title)} <span class="muted">· ${esc(s.branch.name)}</span></div>
      <div class="row"><span>${esc(e.metricName)} ${value}/${e.metricTarget}${s.trustedValue === null && s.untrustedValue !== null ? " (agent)" : ""}</span>${bar(value / e.metricTarget)}</div>
      <div class="row"><span>budget ${esc(formatEur(s.spentEur))} / ${esc(formatEur(e.budgetEur))}</span>${bar(s.budgetUsedPct, s.budgetUsedPct > 0.8 ? "warn" : "ok")}</div>
      <div class="muted">nog ${s.daysLeft ?? "?"} dagen</div>
    </li>`);
  }

  const agentCards = agents
    .map((a) => {
      const hq = (a.metadata?.hq ?? {}) as Record<string, unknown>;
      const status = STATUS_LABEL[a.status] ?? a.status;
      return `<li class="agent ${esc(a.status)}">
        <div class="agent-head"><strong>${esc(a.name)}</strong><span class="pill">${esc(status)}</span></div>
        <div class="muted">${esc(a.title ?? a.role)}${hq.branch ? ` · ${esc(hq.branch)}` : ""}</div>
        <div>vandaag ${esc(formatEur(costToday.get(a.id) ?? 0))}</div>
        <div class="muted small">maand ${esc(formatEur(usdCentsToEur(a.spentMonthlyCents, ctx.config.money.usdToEur)))} van ${esc(formatEur(usdCentsToEur(a.budgetMonthlyCents, ctx.config.money.usdToEur)))} · laatst actief ${a.lastHeartbeatAt ? esc(new Date(a.lastHeartbeatAt).toLocaleString("nl-NL", { timeZone: tz, dateStyle: "short", timeStyle: "short" })) : "nog nooit"}</div>
      </li>`;
    })
    .join("");

  const branchRows = portfolio.branches
    .map(
      (b) => `<tr><td>${esc(b.branch.name)}</td><td>${esc(formatEur(b.currentBudgetEur))}</td><td>${esc(formatEur(b.committedEur))}</td>
      <td>${esc(formatEur(b.last30.revenue))}</td><td>${esc(formatEur(b.last30.cost))}</td><td>${b.roi === null ? "–" : `${b.roi}×`}</td></tr>`,
    )
    .join("");

  const ledgerRows = (await recentLedger(ctx.db, 30))
    .filter((l) => l.amountEur > 0)
    .slice(0, 12)
    .map(
      (l) => `<tr><td>${esc(localDayKey(l.occurredAt, tz).slice(5))}</td><td>${esc(l.kind === "revenue" ? "omzet" : l.kind === "spend" ? "uitgave" : "AI")}</td>
      <td class="num ${l.kind === "revenue" ? "pos" : ""}">${esc(formatEur(l.amountEur))}</td><td>${esc(branchName.get(l.branchId ?? -1) ?? "")}</td><td class="muted">${esc(l.source)}</td></tr>`,
    )
    .join("");

  const lessons = (await searchLessons(ctx.db, { limit: 8 }))
    .map((l) => `<li>${esc(l.lesson)}${l.tags.length ? ` <span class="muted">#${l.tags.map(esc).join(" #")}</span>` : ""}</li>`)
    .join("");

  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  const who = (actor: string) =>
    actor.startsWith("agent:") ? agentName.get(actor.slice(6)) ?? "agent" : actor === "owner" ? "jij" : actor;
  const auditRows = (await recentAudit(ctx.db, 15))
    .map(
      (a) =>
        `<li><span class="muted">${esc(a.at.toLocaleString("nl-NL", { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }))}</span> ${esc(who(a.actor))} · ${esc(a.action)}</li>`,
    )
    .join("");

  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HQ</title>
<style>
:root { --bg:#f6f7f9; --card:#fff; --text:#1d2433; --muted:#6b7385; --line:#e3e6ec; --accent:#2f6fec; --ok:#1f9d63; --warn:#d98a06; --bad:#d64545; }
@media (prefers-color-scheme: dark) { :root { --bg:#11141a; --card:#1a1f27; --text:#e7eaf0; --muted:#9aa3b2; --line:#2a313c; --accent:#6d9cff; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width:1100px; margin:0 auto; padding:16px; display:grid; gap:16px; grid-template-columns:repeat(auto-fit, minmax(min(100%, 420px), 1fr)); }
header { max-width:1100px; margin:0 auto; padding:16px 16px 0; display:flex; flex-wrap:wrap; gap:12px; align-items:center; justify-content:space-between; }
h1 { font-size:20px; margin:0; } h2 { font-size:15px; margin:0 0 10px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
section { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px; min-width:0; }
.wide { grid-column:1 / -1; }
.kpis { display:flex; gap:10px; flex-wrap:wrap; }
.kpi { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:8px 12px; }
.kpi b { display:block; font-size:18px; }
ul { list-style:none; padding:0; margin:0; display:grid; gap:10px; }
li { border-top:1px solid var(--line); padding-top:10px; } li:first-child { border-top:0; padding-top:0; }
.muted { color:var(--muted); } .small { font-size:12px; }
.row { display:flex; justify-content:space-between; gap:8px; align-items:center; }
.bar { flex:0 0 45%; height:8px; background:var(--line); border-radius:4px; overflow:hidden; }
.bar span { display:block; height:100%; background:var(--ok); } .bar.warn span { background:var(--warn); }
table { width:100%; border-collapse:collapse; font-size:14px; } td, th { text-align:left; padding:6px 4px; border-top:1px solid var(--line); }
.table-wrap { overflow-x:auto; }
.num { text-align:right; } .pos { color:var(--ok); }
pre { white-space:pre-wrap; font:inherit; color:var(--muted); margin:6px 0; }
button { font:inherit; border:0; border-radius:8px; padding:8px 12px; background:var(--accent); color:#fff; cursor:pointer; }
button.secondary { background:var(--line); color:var(--text); } button.danger { background:var(--bad); }
.actions { display:flex; gap:8px; flex-wrap:wrap; }
.agents { grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); }
.agent { border:1px solid var(--line); border-radius:10px; padding:10px; }
.agent-head { display:flex; justify-content:space-between; }
.pill { font-size:12px; border-radius:99px; padding:1px 8px; background:var(--line); }
.agent.running .pill { background:var(--ok); color:#fff; } .agent.paused .pill, .agent.error .pill { background:var(--warn); color:#fff; }
.banner { background:var(--bad); color:#fff; border-radius:10px; padding:10px 14px; grid-column:1 / -1; }
</style>
</head>
<body>
<header>
  <h1>🏢 HQ</h1>
  <div class="kpis">
    <div class="kpi"><span class="muted">vandaag</span><b>${esc(formatEur(day.revenue))}</b><span class="muted small">kosten ${esc(formatEur(day.cost))}</span></div>
    <div class="kpi"><span class="muted">deze maand</span><b>${esc(formatEur(month.revenue))}</b><span class="muted small">kosten ${esc(formatEur(month.cost))} / max ${esc(formatEur(portfolio.allowanceEur))}</span></div>
  </div>
  <div class="actions">${
    halt.halted
      ? `<button id="resume">▶️ Hervat alles</button>`
      : `<button id="halt" class="danger">⛔ Noodstop</button>`
  }</div>
</header>
<main>
  ${halt.halted ? `<div class="banner">⛔ Noodstop actief: ${esc(halt.reason)}</div>` : ""}
  <section class="wide"><h2>Wacht op jou (${pending.length})</h2>
    ${pending.length ? `<ul>${pending.map(approvalRow).join("")}</ul>` : `<p class="muted">Niets te beslissen.</p>`}
  </section>
  <section class="wide"><h2>Agents (${agents.length})</h2>
    ${agentError ? `<p class="muted">Paperclip onbereikbaar: ${esc(agentError)}</p>` : `<ul class="agents" style="display:grid">${agentCards}</ul>`}
  </section>
  <section><h2>Lopende experimenten (${running.length})</h2>${running.length ? `<ul>${experimentRows.join("")}</ul>` : `<p class="muted">Geen.</p>`}</section>
  <section><h2>Takken (30 dagen)</h2><div class="table-wrap"><table><tr><th>Tak</th><th>Budget</th><th>Vast</th><th>Omzet</th><th>Kosten</th><th>ROI</th></tr>${branchRows}</table></div></section>
  <section><h2>Grootboek</h2><div class="table-wrap"><table>${ledgerRows || "<tr><td class='muted'>Nog niets geboekt.</td></tr>"}</table></div></section>
  <section><h2>Lessen</h2>${lessons ? `<ul>${lessons}</ul>` : `<p class="muted">Nog geen lessen.</p>`}</section>
  <section><h2>Logboek</h2><ul>${auditRows}</ul></section>
</main>
<script>
async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
  if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error || res.statusText); return false; }
  return true;
}
document.querySelectorAll("[data-decide]").forEach((btn) => btn.addEventListener("click", async () => {
  const li = btn.closest("[data-id]");
  if (await post("/api/owner/approvals/" + li.dataset.id + "/decide", { decision: btn.dataset.decide })) location.reload();
}));
const haltBtn = document.getElementById("halt");
if (haltBtn) haltBtn.addEventListener("click", async () => {
  if (!confirm("Alle agents stoppen?")) return;
  if (await post("/api/owner/halt", { reason: "noodstop via dashboard" })) location.reload();
});
const resumeBtn = document.getElementById("resume");
if (resumeBtn) resumeBtn.addEventListener("click", async () => { if (await post("/api/owner/resume")) location.reload(); });
</script>
</body>
</html>`;
}
