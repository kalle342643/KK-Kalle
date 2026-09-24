/**
 * Wat er op de borden en schermen in het kantoor staat: het projectenbord in de vergaderzaal,
 * de whiteboards per afdeling, de cijfermuur in de controlekamer en het scherm van de CEO.
 * Echte cijfers uit HQ; de uitgebreide versies (met tooltips) staan in de panelen.
 */
import type { CodeProject, OfficeBranch, OfficeProject, OfficeSnapshot } from "../../src/office/types.js";
import { FONT, fitText, roundRect, type CanvasScreen } from "./screens.js";

const eur = (n: number, digits = 0) =>
  new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: digits, minimumFractionDigits: digits })
    .format(n)
    .replace(/ /g, " ");

/** Kolommen van het projectenbord. */
export const COLUMNS: Array<{ key: string; label: string; statuses: OfficeProject["status"][]; color: string }> = [
  { key: "proposed", label: "Voorstel", statuses: ["proposed", "approved"], color: "#8a93a6" },
  { key: "running", label: "Loopt", statuses: ["running"], color: "#2a78d6" },
  { key: "keep", label: "Geslaagd", statuses: ["keep"], color: "#0ca30c" },
  { key: "iterate", label: "Nieuwe poging", statuses: ["iterate"], color: "#eda100" },
  { key: "stopped", label: "Gestopt", statuses: ["killed", "rejected"], color: "#d03b3b" },
];

export function progressOf(p: OfficeProject): number {
  return p.value === null || !p.target ? 0 : Math.max(0, Math.min(1, p.value / p.target));
}

export function drawKanban(s: CanvasScreen, projects: OfficeProject[], accentOf: (branch: string) => string): void {
  s.draw((ctx, w, h) => {
    ctx.fillStyle = "#f7f3ea";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#3a3024";
    ctx.font = `800 ${h * 0.085}px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText("📋 Projectenbord", w * 0.02, h * 0.1);
    const colW = (w * 0.96) / COLUMNS.length;
    COLUMNS.forEach((col, k) => {
      const x = w * 0.02 + k * colW;
      const items = projects.filter((p) => col.statuses.includes(p.status)).slice(0, 5);
      const total = projects.filter((p) => col.statuses.includes(p.status)).length;
      ctx.fillStyle = col.color;
      roundRect(ctx, x + 4, h * 0.14, colW - 8, h * 0.075, 8);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${h * 0.05}px ${FONT}`;
      ctx.fillText(`${col.label} (${total})`, x + 14, h * 0.195);
      items.forEach((p, n) => {
        const y = h * 0.24 + n * h * 0.15;
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "rgba(0,0,0,0.12)";
        ctx.shadowBlur = 6;
        roundRect(ctx, x + 6, y, colW - 12, h * 0.135, 8);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = accentOf(p.branch);
        roundRect(ctx, x + 6, y, 8, h * 0.135, 4);
        ctx.fill();
        ctx.fillStyle = "#1d2433";
        ctx.font = `700 ${h * 0.042}px ${FONT}`;
        fitText(ctx, `${p.code} ${p.title}`, x + 20, y + h * 0.05, colW - 34, h * 0.045, 1);
        ctx.fillStyle = "#e7e3da";
        roundRect(ctx, x + 20, y + h * 0.08, colW - 40, h * 0.025, 6);
        ctx.fill();
        ctx.fillStyle = col.color;
        roundRect(ctx, x + 20, y + h * 0.08, Math.max(6, (colW - 40) * progressOf(p)), h * 0.025, 6);
        ctx.fill();
        ctx.fillStyle = "#5b6477";
        ctx.font = `500 ${h * 0.032}px ${FONT}`;
        fitText(ctx, `${p.metric} ${p.value ?? "–"}/${p.target} · ${eur(p.spentEur)}`, x + 20, y + h * 0.128, colW - 34, h * 0.035, 1);
      });
    });
  });
}

export function drawWhiteboard(s: CanvasScreen, branch: OfficeBranch | undefined, projects: OfficeProject[], accent: string): void {
  s.draw((ctx, w, h) => {
    ctx.fillStyle = "#fbfbf8";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, w, h * 0.12);
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 ${h * 0.085}px ${FONT}`;
    ctx.textAlign = "left";
    fitText(ctx, branch ? `${branch.name} · ${eur(branch.monthlyBudgetEur)}/mnd` : "Afdeling", w * 0.03, h * 0.09, w * 0.94, h * 0.1, 1);
    const mine = projects.filter((p) => p.branch === branch?.slug && ["running", "proposed", "keep", "iterate"].includes(p.status)).slice(0, 4);
    if (!mine.length) {
      ctx.fillStyle = "#8a93a6";
      ctx.font = `600 ${h * 0.08}px ${FONT}`;
      ctx.fillText("Nog geen experimenten", w * 0.05, h * 0.4);
      ctx.font = `500 ${h * 0.06}px ${FONT}`;
      ctx.fillText("De ideeënraad komt woensdag bij elkaar.", w * 0.05, h * 0.55);
      return;
    }
    mine.forEach((p, k) => {
      const y = h * 0.2 + k * h * 0.2;
      ctx.fillStyle = "#1d2433";
      ctx.font = `700 ${h * 0.07}px ${FONT}`;
      fitText(ctx, `${p.code} ${p.title}`, w * 0.04, y + h * 0.06, w * 0.92, h * 0.07, 1);
      ctx.fillStyle = "#e7e3da";
      roundRect(ctx, w * 0.04, y + h * 0.1, w * 0.6, h * 0.045, 8);
      ctx.fill();
      ctx.fillStyle = p.status === "keep" ? "#0ca30c" : accent;
      roundRect(ctx, w * 0.04, y + h * 0.1, Math.max(8, w * 0.6 * progressOf(p)), h * 0.045, 8);
      ctx.fill();
      ctx.fillStyle = "#5b6477";
      ctx.font = `600 ${h * 0.055}px ${FONT}`;
      ctx.fillText(`${p.value ?? "–"}/${p.target} ${p.metric}`, w * 0.67, y + h * 0.14);
    });
  });
}

/** De cijfermuur in de controlekamer: omzet en kosten, projecten en de dag van vandaag. */
export function drawVideoWall(screens: CanvasScreen[], snap: OfficeSnapshot, accentOf: (branch: string) => string): void {
  const [a, b, c] = screens;
  if (a) {
    a.draw((ctx, w, h) => {
      screenBg(ctx, w, h, "Omzet en kosten · 14 dagen");
      const days = snap.stats.days.slice(-14);
      const max = Math.max(1, ...days.map((d) => Math.max(d.revenueEur, d.costEur)));
      const left = w * 0.08;
      const right = w * 0.96;
      const top = h * 0.24;
      const bottom = h * 0.84;
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      for (let k = 0; k <= 3; k++) {
        const y = bottom - ((bottom - top) * k) / 3;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
      }
      const line = (key: "revenueEur" | "costEur", color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        days.forEach((d, k) => {
          const x = left + ((right - left) * k) / Math.max(1, days.length - 1);
          const y = bottom - ((bottom - top) * d[key]) / max;
          if (k) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.stroke();
      };
      line("costEur", "#d95926");
      line("revenueEur", "#3987e5");
      ctx.font = `600 ${h * 0.065}px ${FONT}`;
      ctx.fillStyle = "#3987e5";
      ctx.fillText("● omzet", left, h * 0.95);
      ctx.fillStyle = "#d95926";
      ctx.fillText("● kosten", left + w * 0.22, h * 0.95);
      ctx.fillStyle = "#c3c2b7";
      ctx.textAlign = "right";
      ctx.fillText(`max ${eur(max)}`, right, h * 0.95);
    });
  }
  if (b) {
    b.draw((ctx, w, h) => {
      screenBg(ctx, w, h, "Lopende projecten");
      const running = snap.projects.filter((p) => p.status === "running").slice(0, 5);
      if (!running.length) {
        ctx.fillStyle = "#c3c2b7";
        ctx.font = `600 ${h * 0.08}px ${FONT}`;
        ctx.fillText("Nog geen lopende projecten", w * 0.06, h * 0.5);
      }
      running.forEach((p, k) => {
        const y = h * 0.28 + k * h * 0.14;
        ctx.fillStyle = "#ffffff";
        ctx.font = `700 ${h * 0.06}px ${FONT}`;
        ctx.textAlign = "left";
        fitText(ctx, `${p.code} ${p.title}`, w * 0.05, y, w * 0.55, h * 0.06, 1);
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        roundRect(ctx, w * 0.62, y - h * 0.045, w * 0.33, h * 0.05, 6);
        ctx.fill();
        ctx.fillStyle = accentOf(p.branch);
        roundRect(ctx, w * 0.62, y - h * 0.045, Math.max(6, w * 0.33 * progressOf(p)), h * 0.05, 6);
        ctx.fill();
      });
    });
  }
  if (c) {
    c.draw((ctx, w, h) => {
      screenBg(ctx, w, h, "Vandaag");
      const k = snap.kpis;
      const tiles: Array<[string, string]> = [
        ["Omzet vandaag", eur(k.revenueTodayEur, 2)],
        ["AI-kosten vandaag", eur(k.costTodayEur, 2)],
        ["Deze maand", `${eur(k.revenueMonthEur)} / ${eur(k.costMonthEur)}`],
        ["Wacht op jou", String(k.pendingApprovals)],
      ];
      tiles.forEach(([label, value], n) => {
        const x = w * 0.05 + (n % 2) * w * 0.47;
        const y = h * 0.3 + Math.floor(n / 2) * h * 0.33;
        ctx.fillStyle = "#c3c2b7";
        ctx.font = `600 ${h * 0.055}px ${FONT}`;
        ctx.textAlign = "left";
        ctx.fillText(label, x, y);
        ctx.fillStyle = "#ffffff";
        ctx.font = `800 ${h * 0.1}px ${FONT}`;
        fitText(ctx, value, x, y + h * 0.13, w * 0.43, h * 0.1, 1);
      });
    });
  }
}

export function drawKpiScreen(s: CanvasScreen, snap: OfficeSnapshot): void {
  s.draw((ctx, w, h) => {
    screenBg(ctx, w, h, "Holding · deze maand");
    const k = snap.kpis;
    const used = k.allowanceMonthEur ? Math.min(1, k.costMonthEur / k.allowanceMonthEur) : 0;
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 ${h * 0.16}px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(eur(k.revenueMonthEur), w * 0.06, h * 0.52);
    ctx.fillStyle = "#c3c2b7";
    ctx.font = `600 ${h * 0.065}px ${FONT}`;
    ctx.fillText("omzet", w * 0.06, h * 0.63);
    ctx.fillText(`AI ${eur(k.costMonthEur)} van ${eur(k.allowanceMonthEur)}`, w * 0.06, h * 0.8);
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    roundRect(ctx, w * 0.06, h * 0.85, w * 0.88, h * 0.06, 8);
    ctx.fill();
    ctx.fillStyle = used > 0.85 ? "#d03b3b" : "#3987e5";
    roundRect(ctx, w * 0.06, h * 0.85, Math.max(8, w * 0.88 * used), h * 0.06, 8);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "right";
    ctx.font = `700 ${h * 0.08}px ${FONT}`;
    ctx.fillText(`🧪 ${k.runningExperiments}`, w * 0.94, h * 0.52);
  });
}

function screenBg(ctx: CanvasRenderingContext2D, w: number, h: number, title: string): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#141a28");
  g.addColorStop(1, "#1c2436");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${h * 0.075}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(title, w * 0.05, h * 0.13);
}

/** Hoe lang geleden, kort: "net", "12 min", "3 u", "2 d". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "–";
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 90) return "net";
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86_400) return `${Math.round(s / 3600)} u`;
  return `${Math.round(s / 86_400)} d`;
}

/** De stand van een project in één oogopslag, in woorden én kleur (niet alleen kleur). */
export function codeStatus(p: CodeProject): Array<{ icon: string; text: string; tone: "good" | "bad" | "warn" | "muted" }> {
  const out: Array<{ icon: string; text: string; tone: "good" | "bad" | "warn" | "muted" }> = [];
  const h = p.health;
  if (h.state === "down") out.push({ icon: "●", text: `Ligt eruit${h.status ? ` (${h.status})` : ""}`, tone: "bad" });
  else if (h.state === "up") out.push({ icon: "●", text: `Online${h.uptime24h !== null ? ` · ${Math.round(h.uptime24h * 100)}% vandaag` : ""}`, tone: "good" });
  else out.push({ icon: "○", text: p.url || p.healthUrl ? "Nog niet gecontroleerd" : "Geen site-adres", tone: "muted" });
  if (p.empty) out.push({ icon: "∅", text: "Nog geen code op GitHub", tone: "warn" });
  if (p.ci?.state === "failed") out.push({ icon: "✖", text: "Tests rood", tone: "bad" });
  else if (p.ci?.state === "passed") out.push({ icon: "✔", text: "Tests groen", tone: "good" });
  else if (p.ci?.state === "running") out.push({ icon: "◌", text: "Tests lopen", tone: "warn" });
  if (p.deploy) {
    const failed = p.deploy.state === "failure" || p.deploy.state === "error";
    out.push({ icon: failed ? "✖" : "🚀", text: failed ? "Uitrollen mislukt" : `Live gezet ${ago(p.deploy.at)} geleden`, tone: failed ? "bad" : "good" });
  }
  if (p.openPrs.length) out.push({ icon: "⇄", text: `${p.openPrs.length} open PR`, tone: "muted" });
  if (p.error) out.push({ icon: "⚠", text: p.error, tone: "warn" });
  return out;
}

const TONE = { good: "#1f9d63", bad: "#e5484d", warn: "#d99a00", muted: "#8a93a6" } as const;

export function drawCodeBoard(s: CanvasScreen, p: CodeProject | undefined, sessions: number): void {
  s.draw((ctx, w, h) => {
    ctx.fillStyle = "#141a26";
    ctx.fillRect(0, 0, w, h);
    if (!p) return;
    const down = p.health.state === "down";
    ctx.fillStyle = down ? "#5c1d22" : "#d97757";
    ctx.fillRect(0, 0, w, h * 0.16);
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 ${h * 0.1}px ${FONT}`;
    ctx.textAlign = "left";
    fitText(ctx, `${down ? "🔴 " : ""}${p.name}`, w * 0.04, h * 0.115, w * 0.92, h * 0.1, 1);
    let y = h * 0.27;
    ctx.font = `600 ${h * 0.068}px ${FONT}`;
    for (const line of codeStatus(p).slice(0, 5)) {
      ctx.fillStyle = TONE[line.tone];
      ctx.fillText(line.icon, w * 0.05, y);
      ctx.fillStyle = "#e6ebf5";
      fitText(ctx, line.text, w * 0.13, y, w * 0.83, h * 0.07, 1);
      y += h * 0.1;
    }
    // Onderaan: wat er op jou wacht en wie eraan werkt.
    const mine = p.backlog?.ownerCount ?? 0;
    ctx.fillStyle = mine ? "#3b2f14" : "#1d2433";
    roundRect(ctx, w * 0.04, h * 0.8, w * 0.44, h * 0.15, 10);
    ctx.fill();
    ctx.fillStyle = "#1d2433";
    roundRect(ctx, w * 0.52, h * 0.8, w * 0.44, h * 0.15, 10);
    ctx.fill();
    ctx.font = `700 ${h * 0.062}px ${FONT}`;
    ctx.fillStyle = mine ? "#ffd166" : "#8a93a6";
    fitText(ctx, mine ? `📋 ${mine} voor jou` : "📋 niets voor jou", w * 0.07, h * 0.9, w * 0.4, h * 0.07, 1);
    ctx.fillStyle = sessions ? "#ffb38a" : "#8a93a6";
    fitText(ctx, sessions ? `🤖 ${sessions} ${sessions === 1 ? "sessie" : "sessies"}` : "🤖 niemand bezig", w * 0.55, h * 0.9, w * 0.4, h * 0.07, 1);
  });
}
