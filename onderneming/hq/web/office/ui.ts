/**
 * Alles om het 3D-kantoor heen: bovenbalk met cijfers, logboek, het paneel dat opent als je
 * ergens op klikt (een poppetje, het projectenbord, de cijfermuur, het team, de kennisbank,
 * jouw bureau), meldingen en de noodstop.
 */
import type { OfficeAgent, OfficeEvent, OfficeProject, OfficeSnapshot, ProjectDetail } from "../../src/office/types.js";
import { COLUMNS, progressOf } from "./boards.js";
import { hideTip, lineChart, pairedBars } from "./charts.js";
import type { DataSource } from "./data.js";
import type { Director, Liveliness } from "./director.js";
import { layoutGraph } from "./hologram.js";
import { BOT_ID, OWNER_ID, type Layout } from "./layout.js";
import type { Pick, World } from "./world.js";

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | ((ev: Event) => void)> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false) el.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const eur = (n: number, digits = 2) =>
  new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits })
    .format(n)
    .replace(/ /g, " ");
const time = (iso: string) => new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
function ago(iso: string | null): string {
  if (!iso) return "nog nooit";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "net";
  if (s < 3600) return `${Math.round(s / 60)} min geleden`;
  if (s < 86400) return `${Math.round(s / 3600)} uur geleden`;
  return `${Math.round(s / 86400)} dagen geleden`;
}
const modelName = (m: string | null) =>
  !m ? "–" : m.replace(/^claude-/, "").replace(/-(\d)(-(\d))?$/, " $1.$3").replace(/\.$/, "").replace(/^./, (c) => c.toUpperCase()).replace(/\.undefined/, "");

const STATUS: Record<string, { label: string; tone: string }> = {
  running: { label: "aan het werk", tone: "good" },
  idle: { label: "beschikbaar", tone: "muted" },
  active: { label: "beschikbaar", tone: "muted" },
  paused: { label: "gepauzeerd", tone: "warn" },
  error: { label: "loopt vast", tone: "bad" },
  pending_approval: { label: "wacht op jouw ja", tone: "info" },
  terminated: { label: "vertrokken", tone: "muted" },
};
const PROJECT_STATUS: Record<OfficeProject["status"], string> = {
  proposed: "voorstel",
  approved: "goedgekeurd",
  running: "loopt",
  keep: "geslaagd",
  iterate: "nieuwe poging",
  killed: "gestopt",
  rejected: "afgewezen",
};

export type PanelKind = "agent" | "approvals" | "projects" | "project" | "stats" | "team" | "knowledge" | "ledger" | "room" | "help";

export interface UiDeps {
  source: DataSource;
  director: Director;
  world: World;
  thumbs: () => string[];
  refresh: () => Promise<void>;
  layout: () => Layout;
}

export class Ui {
  private snap: OfficeSnapshot | null = null;
  private readonly events: OfficeEvent[] = [];
  private panel: { kind: PanelKind; arg?: string } | null = null;
  private readonly el: {
    top: HTMLElement;
    company: HTMLElement;
    status: HTMLElement;
    kpis: HTMLElement;
    feed: HTMLElement;
    feedList: HTMLElement;
    panel: HTMLElement;
    panelBody: HTMLElement;
    toasts: HTMLElement;
    banner: HTMLElement;
    hint: HTMLElement;
    conn: HTMLElement;
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly deps: UiDeps,
  ) {
    const mode = deps.source.mode;
    const company = h("b", { class: "company" }, "HQ");
    const status = h("span", { class: "pill" }, "…");
    const conn = h("span", { class: "conn", title: "Live verbinding" });
    const kpis = h("div", { class: "kpis" });
    const top = h(
      "header",
      { class: "topbar" },
      h("div", { class: "brand" }, h("span", { class: "logo", "aria-hidden": "true" }, "🏢"), company, status, conn),
      kpis,
      h(
        "nav",
        { class: "actions" },
        h("button", { onclick: () => this.open("projects"), title: "Alle projecten", "aria-label": "Projecten" }, "📋", h("span", {}, " Projecten")),
        h("button", { onclick: () => this.open("stats"), title: "Cijfers en grafieken", "aria-label": "Cijfers" }, "📊", h("span", {}, " Cijfers")),
        h("button", { onclick: () => this.open("team"), title: "Wie werkt er", "aria-label": "Team" }, "👥", h("span", {}, " Team")),
        h("button", { onclick: () => this.open("knowledge"), title: "Kennisbank", "aria-label": "Kennis" }, "🧠", h("span", {}, " Kennis")),
        h("button", { class: "danger", onclick: () => this.confirmHalt(), title: "Alles stoppen", "aria-label": "Noodstop" }, "🛑", h("span", {}, " Noodstop")),
      ),
    );
    const feedList = h("ol", { class: "feed-list", "aria-live": "polite" });
    const feed = h(
      "aside",
      { class: "feed" },
      h("button", { class: "feed-head", onclick: () => feed.classList.toggle("collapsed"), "aria-label": "Logboek in- of uitklappen" }, "📜 Wat er gebeurt"),
      feedList,
    );
    if (window.innerWidth < 700) feed.classList.add("collapsed");
    const panelBody = h("div", { class: "panel-body" });
    const panel = h(
      "aside",
      { class: "panel", hidden: true, "aria-label": "Details" },
      h("button", { class: "panel-close", onclick: () => this.close(), "aria-label": "Sluiten" }, "✕"),
      panelBody,
    );
    const controls = h(
      "div",
      { class: "controls" },
      h("button", { onclick: () => deps.world.rotate(-1), title: "Draai links (Q)", "aria-label": "Draai links" }, "⟲"),
      h("button", { onclick: () => deps.world.rotate(1), title: "Draai rechts (E)", "aria-label": "Draai rechts" }, "⟳"),
      h("button", { onclick: () => deps.world.zoomBy(1.3), title: "Inzoomen (+)", "aria-label": "Inzoomen" }, "+"),
      h("button", { onclick: () => deps.world.zoomBy(0.77), title: "Uitzoomen (-)", "aria-label": "Uitzoomen" }, "−"),
      h("button", { onclick: () => deps.world.fit(undefined, true), title: "Alles in beeld", "aria-label": "Alles in beeld" }, "⌂"),
      this.livelinessToggle(),
      h("button", { onclick: () => this.open("help"), title: "Uitleg", "aria-label": "Uitleg" }, "?"),
    );
    const toasts = h("div", { class: "toasts", "aria-live": "polite" });
    const banner = h("div", { class: "banner", hidden: true });
    const hint = h("div", { class: "hover-hint", hidden: true });
    root.replaceChildren(top, feed, panel, controls, toasts, banner, hint);
    if (mode === "demo") root.appendChild(h("div", { class: "demo-badge" }, "DEMO · verzonnen bedrijf, niets is echt"));
    this.el = { top, company, status, kpis, feed, feedList, panel, panelBody, toasts, banner, hint, conn };
    window.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") this.close();
    });
    window.addEventListener("pointermove", (ev) => {
      if (!this.el.hint.hidden) {
        this.el.hint.style.left = `${ev.clientX + 14}px`;
        this.el.hint.style.top = `${ev.clientY + 14}px`;
      }
    });
    window.addEventListener("resize", () => this.syncInsets());
    this.syncInsets();
  }

  /** Vertel de camera welk stuk scherm vrij is (niet onder de bovenbalk, knoppen of het paneel). */
  private syncInsets(): void {
    const ins = this.deps.world.insets;
    const mobile = window.innerWidth <= 760;
    ins.top = Math.round(this.el.top.getBoundingClientRect().bottom + 10);
    ins.left = 12;
    ins.right = mobile ? 56 : 12;
    ins.bottom = mobile ? 56 : 64;
    if (!this.el.panel.hidden) {
      const r = this.el.panel.getBoundingClientRect();
      if (mobile) ins.bottom = Math.round(window.innerHeight - r.top + 8);
      else ins.right = Math.round(window.innerWidth - r.left + 12);
    }
  }

  private livelinessToggle(): HTMLElement {
    const options: Array<[Liveliness, string, string]> = [
      ["calm", "🐢", "Rustig: alleen echt werk"],
      ["normal", "🙂", "Normaal: af en toe koffie of een praatje"],
      ["lively", "🎉", "Levendig: veel beweging"],
    ];
    const btn = h("button", { title: options[1]![2], "aria-label": "Levendigheid" }, options[1]![1]);
    let k = 1;
    try {
      const saved = localStorage.getItem("hq-liveliness");
      const idx = options.findIndex((o) => o[0] === saved);
      if (idx >= 0) k = idx;
    } catch {
      // geen opslag beschikbaar
    }
    const apply = () => {
      const [value, icon, title] = options[k]!;
      this.deps.director.liveliness = value;
      btn.textContent = icon;
      btn.title = title;
      try {
        localStorage.setItem("hq-liveliness", value);
      } catch {
        // geen opslag beschikbaar
      }
    };
    btn.addEventListener("click", () => {
      k = (k + 1) % options.length;
      apply();
      this.toast(options[k]![2], "info");
    });
    queueMicrotask(apply);
    return btn;
  }

  label(id: string | null): string {
    if (!id) return "Iemand";
    if (id === OWNER_ID) return this.snap?.people.find((p) => p.id === OWNER_ID)?.nickname || "Jij";
    if (id === BOT_ID) return this.snap?.people.find((p) => p.id === BOT_ID)?.nickname || "HQ-bot";
    const a = this.snap?.agents.find((x) => x.id === id);
    return a ? a.nickname || a.name : "Iemand";
  }

  setConnected(ok: boolean): void {
    this.el.conn.classList.toggle("ok", ok);
    this.el.conn.title = ok ? "Live verbonden met HQ" : "Verbinding weg, opnieuw verbinden…";
  }

  // ---------------------------------------------------------------- momentopname

  update(snap: OfficeSnapshot): void {
    this.snap = snap;
    if (!this.events.length) this.events.push(...snap.events);
    this.el.company.textContent = snap.companyName;
    this.el.status.textContent = snap.halted ? "⛔ Noodstop" : "🟢 Alles draait";
    this.el.status.className = `pill ${snap.halted ? "bad" : "good"}`;
    const working = snap.agents.filter((a) => a.status === "running").length;
    const k = snap.kpis;
    this.el.kpis.replaceChildren(
      chip("Vandaag", eur(k.revenueTodayEur), `kosten ${eur(k.costTodayEur)}`),
      chip("Deze maand", eur(k.revenueMonthEur, 0), `AI ${eur(k.costMonthEur, 0)} / ${eur(k.allowanceMonthEur, 0)}`),
      chip("Team", `${working}/${snap.agents.length}`, "aan het werk", () => this.open("team")),
      chip("Projecten", String(k.runningExperiments), "lopend", () => this.open("projects")),
      chip("Wacht op jou", String(k.pendingApprovals), k.pendingApprovals ? "beslis nu" : "niets", () => this.open("approvals"), k.pendingApprovals > 0),
    );
    this.el.banner.hidden = !snap.halted;
    if (snap.halted) {
      this.el.banner.replaceChildren(
        h("span", {}, `⛔ Noodstop actief: ${snap.haltReason ?? "alles staat stil"}`),
        h("button", { onclick: () => void this.act(() => this.deps.source.resume(), "") }, "▶️ Hervat alles"),
      );
    }
    if (snap.paperclipError) this.toastOnce(`paperclip:${snap.paperclipError}`, `⚠️ Paperclip onbereikbaar: ${snap.paperclipError}`, "warn");
    this.renderFeed();
    if (this.panel && this.panel.kind !== "project" && this.panel.kind !== "knowledge") this.render();
  }

  // ---------------------------------------------------------------- logboek

  addEvent(e: OfficeEvent): void {
    this.events.push(e);
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
    this.renderFeed();
    const important: Partial<Record<OfficeEvent["type"], "info" | "good" | "warn" | "bad">> = {
      "approval.requested": "info",
      revenue: "good",
      "experiment.verdict": "info",
      "budget.stop": "warn",
      halt: "bad",
      resume: "good",
      "agent.hired": "info",
    };
    const tone = important[e.type];
    if (tone && e.type !== "agent.hired") this.toast(this.describe(e), tone, e.agentId);
    if (this.panel?.kind === "agent" && (e.agentId === this.panel.arg || e.targetAgentId === this.panel.arg)) this.render();
  }

  describe(e: OfficeEvent): string {
    const who = this.label(e.agentId);
    const to = e.targetAgentId ? this.label(e.targetAgentId) : "jou";
    const t = e.text ?? "";
    switch (e.type) {
      case "run.started":
        return `▶️ ${who} begint${t ? `: ${t}` : ""}`;
      case "run.finished":
        return e.data.status === "failed" ? `⚠️ ${who}: dat lukte niet` : `✅ ${who} is klaar${t ? ` met ${t}` : ""}`;
      case "talk":
        return e.data.kind === "delegate" ? `📝 ${who} → ${to}: ${t.replace(/^Nieuwe taak voor jou: /, "nieuwe taak: ")}` : `💬 ${who} → ${to}: ${t}`;
      case "notify":
        return `💬 ${who} → jou: ${t}`;
      case "knowledge.query":
        return `🔎 ${who} zoekt in de kennisbank: ${t}`;
      case "knowledge.write":
        return `📘 ${who} schreef op: ${t}`;
      case "knowledge.rebuilt":
        return `🧠 ${t}`;
      case "approval.requested":
        return `🙋 ${e.agentId ? `${who} vraagt` : "Nieuw verzoek"}: ${t}${typeof e.data.amountEur === "number" && e.data.amountEur ? ` (${eur(e.data.amountEur)})` : ""}`;
      case "approval.decided":
        return `${e.data.status === "approved" ? "✅ Goedgekeurd" : "❌ Afgewezen"}: ${t}`;
      case "agent.hired":
        return `🧑‍💼 ${t}`;
      case "agent.status":
        return `ℹ️ ${t}`;
      case "budget.stop":
        return `🛑 ${who}: budget op, gepauzeerd`;
      case "revenue":
        return `💶 +${eur(Number(e.data.amountEur ?? 0))}${e.data.branch ? ` voor ${this.branchName(String(e.data.branch))}` : ""}${t ? ` · ${t}` : ""}`;
      case "metric":
        return `📈 ${who}: ${t}`;
      case "experiment.started":
        return `🚀 Gestart: ${t}`;
      case "experiment.verdict":
        return `🏁 ${t}`;
      case "message.sent":
        return `📨 ${this.label(BOT_ID)} stuurde je: ${t}`;
      case "agent.profile":
        return `✨ ${who}: ${t}`;
      case "halt":
        return `⛔ Noodstop: ${t}`;
      case "resume":
        return "▶️ Alles draait weer";
      default:
        return t;
    }
  }

  private branchName(slug: string): string {
    return this.snap?.branches.find((b) => b.slug === slug)?.name ?? slug;
  }

  private renderFeed(): void {
    const items = this.events.slice(-40).reverse();
    this.el.feedList.replaceChildren(
      ...items.map((e) =>
        h(
          "li",
          {
            class: `ev ev-${e.type.replace(".", "-")}`,
            onclick: () => {
              if (e.agentId) this.focusActor(e.agentId, true);
            },
          },
          h("time", {}, time(e.at)),
          h("span", {}, this.describe(e)),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- meldingen

  private readonly seenToasts = new Set<string>();
  private toastOnce(key: string, text: string, kind: "info" | "good" | "warn" | "bad"): void {
    if (this.seenToasts.has(key)) return;
    this.seenToasts.add(key);
    this.toast(text, kind);
  }

  toast(text: string, kind: "info" | "good" | "warn" | "bad" = "info", actorId?: string | null): void {
    const t = h("div", { class: `toast ${kind}`, role: "status" }, text);
    if (actorId) {
      t.classList.add("link");
      t.addEventListener("click", () => this.focusActor(actorId, true));
    }
    this.el.toasts.prepend(t);
    while (this.el.toasts.children.length > 4) this.el.toasts.lastElementChild?.remove();
    setTimeout(() => t.classList.add("out"), 5200);
    setTimeout(() => t.remove(), 5800);
  }

  hover(pick: Pick | null): void {
    const labels: Partial<Record<Pick["kind"], string>> = {
      agent: "Klik: wie is dit en waar werkt deze agent aan?",
      kanban: "📋 Projectenbord: alle projecten",
      "video-wall": "📊 Cijfers en grafieken",
      vault: "🔒 Kluis: omzet en kosten",
      "owner-desk": "📥 Jouw bureau: verzoeken",
      "red-button": "🛑 Noodstop",
      hologram: "🧠 Kennisgraaf (Graphify)",
      whiteboard: "Afdelingsbord: experimenten",
      desk: "Bureau",
    };
    const text = pick ? (pick.kind === "agent" ? `${this.label(pick.id)} · klik voor details` : labels[pick.kind]) : null;
    this.el.hint.hidden = !text;
    if (text) this.el.hint.textContent = text;
  }

  // ---------------------------------------------------------------- panelen

  pick(pick: Pick | null): void {
    if (!pick) return;
    switch (pick.kind) {
      case "agent":
        this.open("agent", pick.id);
        break;
      case "desk": {
        const desk = this.deps.layout().desks.find((d) => d.id === pick.id);
        if (desk?.agentId) this.open("agent", desk.agentId);
        else this.open("room", desk?.roomId);
        break;
      }
      case "kanban":
        this.open("projects");
        break;
      case "video-wall":
        this.open("stats");
        break;
      case "vault":
        this.open("ledger");
        break;
      case "owner-desk":
        this.open("approvals");
        break;
      case "red-button":
        this.confirmHalt();
        break;
      case "hologram":
        this.open("knowledge");
        break;
      case "whiteboard":
        this.open("projects");
        break;
      case "room":
        this.open("room", pick.id);
        break;
    }
  }

  open(kind: PanelKind, arg?: string): void {
    this.panel = { kind, arg };
    this.el.panel.hidden = false;
    this.el.panel.dataset.kind = kind;
    this.deps.director.select(kind === "agent" ? (arg ?? null) : null);
    if (kind !== "agent") this.deps.director.follow = null;
    this.render();
    this.syncInsets();
    // Staat het poppetje straks onder het paneel? Schuif dan het beeld een stukje op.
    const actor = kind === "agent" && arg ? this.deps.director.actors.get(arg) : undefined;
    if (actor) {
      const p = this.deps.world.screenOf(actor.pos.x, 0.8, actor.pos.z);
      const ins = this.deps.world.insets;
      if (p.x > window.innerWidth - ins.right || p.y > window.innerHeight - ins.bottom || p.y < ins.top) this.deps.world.focus(actor.pos.x, actor.pos.z);
    }
  }

  close(): void {
    this.panel = null;
    this.el.panel.hidden = true;
    this.deps.director.select(null);
    this.deps.director.follow = null;
    hideTip();
    this.syncInsets();
  }

  private render(): void {
    const p = this.panel;
    const snap = this.snap;
    if (!p || !snap) return;
    const body = this.el.panelBody;
    const scroll = body.scrollTop;
    switch (p.kind) {
      case "agent":
        body.replaceChildren(this.agentPanel(p.arg ?? ""));
        break;
      case "approvals":
        body.replaceChildren(this.approvalsPanel());
        break;
      case "projects":
        body.replaceChildren(this.projectsPanel());
        break;
      case "project":
        body.replaceChildren(h("p", { class: "muted" }, "Laden…"));
        void this.projectPanel(Number(p.arg)).then((el) => {
          if (this.panel?.kind === "project") body.replaceChildren(el);
        });
        return;
      case "stats":
        body.replaceChildren(this.statsPanel());
        this.drawStatsCharts(body);
        break;
      case "team":
        body.replaceChildren(this.teamPanel());
        break;
      case "knowledge":
        body.replaceChildren(this.knowledgePanel());
        break;
      case "ledger":
        body.replaceChildren(this.ledgerPanel());
        this.drawStatsCharts(body);
        break;
      case "room":
        body.replaceChildren(this.roomPanel(p.arg ?? ""));
        break;
      case "help":
        body.replaceChildren(this.helpPanel());
        break;
    }
    body.scrollTop = scroll;
  }

  private focusActor(id: string, select = false): void {
    const a = this.deps.director.actors.get(id);
    if (a) this.deps.world.focus(a.pos.x, a.pos.z, 1.6);
    if (select) this.open("agent", id);
  }

  /** Een knop uitvoeren; ok is de melding bij succes (leeg als de gebeurtenis zelf al een melding geeft). */
  private async act(fn: () => Promise<void>, ok: string): Promise<void> {
    try {
      await fn();
      if (ok) this.toast(ok, "good");
      await this.deps.refresh();
    } catch (err) {
      this.toast(`⚠️ ${err instanceof Error ? err.message : String(err)}`, "bad");
    }
  }

  // ---- een poppetje

  private agentPanel(id: string): HTMLElement {
    const snap = this.snap!;
    const agent = snap.agents.find((a) => a.id === id) ?? null;
    const person = snap.people.find((p) => p.id === id) ?? null;
    const actor = this.deps.director.actors.get(id);
    if (!agent && !person) return h("div", {}, h("p", { class: "muted" }, "Deze agent is er niet meer."));
    const name = agent?.name ?? (id === OWNER_ID ? "Jij" : "HQ-bot");
    const nickname = agent?.nickname ?? person?.nickname ?? "";
    const look = actor?.info.look ?? 0;
    const thumbs = this.deps.thumbs();

    const input = h("input", { type: "text", value: nickname, placeholder: name, maxlength: "30", "aria-label": "Bijnaam" }) as HTMLInputElement;
    const save = () =>
      void this.act(() => this.deps.source.setProfile(id, { nickname: input.value.trim() || null }), input.value.trim() ? `✨ Heet nu ${input.value.trim()}` : "Bijnaam weggehaald");
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") save();
    });
    const looks = h(
      "div",
      { class: "looks", hidden: true },
      ...thumbs.map((src, k) =>
        h(
          "button",
          {
            class: k === look ? "look on" : "look",
            title: `Poppetje ${k + 1}`,
            "aria-label": `Poppetje ${k + 1}`,
            onclick: () => void this.act(() => this.deps.source.setProfile(id, { avatar: k }), "✨ Nieuw uiterlijk"),
          },
          h("img", { src, alt: "" }),
        ),
      ),
    );
    const header = h(
      "div",
      { class: "agent-head" },
      h(
        "button",
        { class: "avatar", title: "Ander uiterlijk kiezen", onclick: () => (looks.hidden = !looks.hidden) },
        thumbs[look] ? h("img", { src: thumbs[look]!, alt: "" }) : "🙂",
        h("span", { class: "avatar-edit" }, "✎"),
      ),
      h(
        "div",
        { class: "agent-names" },
        h("h2", {}, nickname || name),
        h("p", { class: "muted" }, agent ? `${agent.title ?? agent.role}${nickname ? ` · Paperclip-naam ${name}` : ""}` : id === OWNER_ID ? "Eigenaar van de holding" : "Stuurt jou de berichten (Telegram) en houdt de cijfers bij"),
      ),
    );
    const rename = h("div", { class: "rename" }, input, h("button", { onclick: save }, "Opslaan"));
    const parts: Child[] = [header, rename, looks];

    if (agent) {
      const st = STATUS[agent.status] ?? { label: agent.status, tone: "muted" };
      const started = [...this.events].reverse().find((e) => e.type === "run.started" && e.agentId === id);
      const since = agent.status === "running" && started ? ` · sinds ${time(started.at)} (${ago(started.at).replace(" geleden", "")})` : "";
      const tokens = this.events
        .filter((e) => e.type === "run.finished" && e.agentId === id && new Date(e.at).toDateString() === new Date().toDateString())
        .reduce((s, e) => s + Number(e.data.tokensIn ?? 0) + Number(e.data.tokensOut ?? 0), 0);
      parts.push(
        h(
          "section",
          { class: "card now" },
          h("div", { class: "row" }, h("span", { class: `pill ${st.tone}` }, st.label), h("span", { class: "muted" }, this.branchName(agent.branch))),
          h("h3", {}, "Nu bezig met"),
          h("p", { class: agent.currentTask ? "task" : "muted" }, agent.currentTask ?? (agent.status === "paused" ? `Gepauzeerd${agent.pauseReason ? ` (${agent.pauseReason})` : ""}` : "Niets: wacht op een taak of de vaste routine"), since),
        ),
        h(
          "section",
          { class: "card grid2" },
          stat("Kosten vandaag", eur(agent.costTodayEur)),
          stat("Deze maand", `${eur(agent.spentMonthEur)} / ${eur(agent.budgetMonthEur, 0)}`, agent.budgetMonthEur ? agent.spentMonthEur / agent.budgetMonthEur : 0),
          stat("Model", modelName(agent.model)),
          stat("Laatst actief", ago(agent.lastActiveAt)),
          tokens ? stat("Tokens vandaag", tokens.toLocaleString("nl-NL")) : null,
        ),
      );
      const buttons = h(
        "div",
        { class: "buttons" },
        h("button", { onclick: () => this.follow(id) }, this.deps.director.follow === id ? "📍 Volgen uit" : "📍 Volgen"),
        agent.status === "paused"
          ? h("button", { onclick: () => void this.act(() => this.deps.source.setAgentPaused(id, false), `▶️ ${nickname || name} gaat weer aan het werk`) }, "▶️ Hervatten")
          : h("button", { class: "warn", onclick: () => void this.act(() => this.deps.source.setAgentPaused(id, true), `⏸ ${nickname || name} is gepauzeerd`) }, "⏸ Pauzeren"),
      );
      parts.push(buttons);
      const projects = snap.projects.filter((p) => p.leadAgentId === id && ["running", "proposed", "keep", "iterate"].includes(p.status));
      if (projects.length) parts.push(h("h3", {}, "Leidt"), ...projects.map((p) => this.projectCard(p)));
    } else if (id === OWNER_ID) {
      parts.push(h("h3", {}, `Op je bureau (${snap.approvals.length})`), this.approvalsList());
    } else {
      // De HQ-bot stuurt jou de berichten; in de controlekamer zie je hoe alles ervoor staat.
      const k = snap.kpis;
      const running = snap.projects.filter((p) => p.status === "running");
      const msgs = this.events.filter((e) => e.type === "message.sent").slice(-6).reverse();
      parts.push(
        h(
          "section",
          { class: "tiles" },
          tile("Omzet vandaag", eur(k.revenueTodayEur)),
          tile("AI-kosten vandaag", eur(k.costTodayEur)),
          tile("Deze maand", `${eur(k.revenueMonthEur, 0)} omzet`),
          tile("Wacht op jou", String(k.pendingApprovals)),
        ),
        h("div", { class: "buttons" }, h("button", { onclick: () => this.open("stats") }, "📊 Alle cijfers"), h("button", { onclick: () => this.open("projects") }, "📋 Projectenbord")),
        h("h3", {}, `Hoe gaan de projecten? (${running.length} lopend)`),
        ...(running.length ? running.map((p) => this.projectCard(p)) : [h("p", { class: "muted" }, "Er loopt nu geen project.")]),
        h("h3", {}, "Laatste berichten aan jou"),
        msgs.length ? h("ol", { class: "timeline" }, ...msgs.map((e) => h("li", {}, h("time", {}, time(e.at)), h("span", {}, e.text ?? "")))) : h("p", { class: "muted" }, "Nog niets verstuurd."),
      );
    }
    const mine = this.events.filter((e) => e.agentId === id || e.targetAgentId === id).slice(-10).reverse();
    if (mine.length && id !== BOT_ID) {
      parts.push(h("h3", {}, "Recent"), h("ol", { class: "timeline" }, ...mine.map((e) => h("li", {}, h("time", {}, time(e.at)), h("span", {}, this.describe(e))))));
    }
    return h("div", { class: "agent-panel" }, ...parts);
  }

  private follow(id: string): void {
    const d = this.deps.director;
    d.follow = d.follow === id ? null : id;
    this.render();
  }

  // ---- jouw bureau

  private approvalsList(): HTMLElement {
    const snap = this.snap!;
    if (!snap.approvals.length) return h("p", { class: "muted" }, "Niets te beslissen. 🎉");
    return h(
      "ul",
      { class: "approvals" },
      ...snap.approvals.map((a) =>
        h(
          "li",
          { class: "card" },
          h("div", { class: "row" }, h("b", {}, a.title), a.amountEur ? h("span", { class: "amount" }, eur(a.amountEur)) : null),
          h("p", { class: "muted" }, `${a.requestedByAgentId ? `${this.label(a.requestedByAgentId)} · ` : ""}${time(a.createdAt)}`),
          a.summary ? h("p", { class: "summary" }, a.summary) : null,
          h(
            "div",
            { class: "buttons" },
            h("button", { class: "good", onclick: () => void this.act(() => this.deps.source.decide(a.id, "approve"), "✅ Goedgekeurd") }, a.kind === "budget_override" ? "✅ Verhoog en hervat" : "✅ Goedkeuren"),
            h("button", { class: "bad", onclick: () => void this.act(() => this.deps.source.decide(a.id, "reject"), "❌ Afgewezen") }, a.kind === "budget_override" ? "⏸ Laat gepauzeerd" : "❌ Afwijzen"),
          ),
        ),
      ),
    );
  }

  private approvalsPanel(): HTMLElement {
    return h("div", {}, h("h2", {}, `📥 Jouw bureau (${this.snap!.approvals.length})`), h("p", { class: "muted" }, "Verzoeken van je agents. Hetzelfde als de knoppen in Telegram."), this.approvalsList());
  }

  // ---- projecten

  private projectCard(p: OfficeProject): HTMLElement {
    const pct = Math.round(progressOf(p) * 100);
    const num = (n: number) => n.toLocaleString("nl-NL");
    return h(
      "button",
      { class: `project-card st-${p.status}`, onclick: () => this.open("project", String(p.id)), style: `--accent:${this.accentOf(p.branch)}` },
      h("b", { class: "pc-title" }, `${p.code} ${p.title}`),
      h("div", { class: "pc-meta small" }, `${this.branchName(p.branch)}${p.leadAgentId ? ` · ${this.label(p.leadAgentId)}` : ""}`),
      h("div", { class: "progress", role: "progressbar", "aria-label": `${p.metric}: ${pct}% van het doel`, "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" }, h("i", { style: `width:${Math.max(2, pct)}%` })),
      h("div", { class: "pc-line small" }, h("span", {}, `${p.metric} ${p.value === null ? "–" : num(p.value)} / ${num(p.target)}${p.value !== null && !p.trusted ? " (agent)" : ""}`)),
      h(
        "div",
        { class: "pc-line small muted" },
        h("span", {}, `${eur(p.spentEur, 0)} / ${eur(p.budgetEur, 0)}`),
        p.revenueEur ? h("span", {}, `💶 ${eur(p.revenueEur, 0)}`) : null,
        p.status === "running" && p.daysLeft !== null ? h("span", {}, `nog ${p.daysLeft} d`) : null,
      ),
    );
  }

  private accentOf(branch: string): string {
    const room = this.deps.layout().rooms.find((r) => r.id === this.deps.layout().roomOfBranch.get(branch));
    return room?.accent ?? "#5b6b86";
  }

  private projectsPanel(): HTMLElement {
    const snap = this.snap!;
    const cols = COLUMNS.map((col) => {
      const items = snap.projects.filter((p) => col.statuses.includes(p.status));
      return h(
        "section",
        { class: "kanban-col" },
        h("h3", { style: `--col:${col.color}` }, `${col.label} (${items.length})`),
        ...(items.length ? items.map((p) => this.projectCard(p)) : [h("p", { class: "muted small" }, "–")]),
      );
    });
    return h(
      "div",
      { class: "projects-panel" },
      h("h2", {}, "📋 Alle projecten"),
      h("p", { class: "muted" }, "Elk project is een experiment: voorstel, jouw ja, bouwen, meten, en dan doorgaan of stoppen."),
      h("div", { class: "kanban" }, ...cols),
    );
  }

  private async projectPanel(id: number): Promise<HTMLElement> {
    let d: ProjectDetail;
    try {
      d = await this.deps.source.project(id);
    } catch (err) {
      return h("p", { class: "muted" }, `Kon project niet laden: ${err instanceof Error ? err.message : String(err)}`);
    }
    const p = d.project;
    const chartHost = h("div", { class: "chart-host" });
    const el = h(
      "div",
      { class: "project-panel" },
      h("button", { class: "back", onclick: () => this.open("projects") }, "← Alle projecten"),
      h("h2", {}, `${p.code} ${p.title}`),
      h("div", { class: "row" }, h("span", { class: `pill st-${p.status}` }, PROJECT_STATUS[p.status]), h("span", { class: "muted" }, `${p.branchName}${p.leadAgentId ? ` · lead ${this.label(p.leadAgentId)}` : ""}`)),
      h("section", { class: "card" }, h("h3", {}, "Hypothese"), h("p", {}, p.hypothesis), p.prediction ? h("p", { class: "muted" }, `Voorspelling vooraf: ${p.prediction}`) : null),
      h(
        "section",
        { class: "card grid2" },
        stat(`${p.metric} (doel ${p.target})`, `${p.value ?? "–"}${p.value !== null && !p.trusted ? " (agent)" : ""}`, progressOf(p)),
        stat("Budget", `${eur(p.spentEur)} / ${eur(p.budgetEur, 0)}`, p.budgetEur ? p.spentEur / p.budgetEur : 0),
        stat("Omzet", eur(p.revenueEur)),
        stat(p.status === "running" ? "Nog" : "Gestart", p.status === "running" ? `${p.daysLeft ?? "?"} dagen` : p.startedAt ? new Date(p.startedAt).toLocaleDateString("nl-NL") : "–"),
      ),
      h("h3", {}, `${p.metric} door de tijd`),
      chartHost,
      p.reason ? h("section", { class: "card" }, h("h3", {}, "Uitkomst"), h("p", {}, p.reason)) : null,
      d.lessons.length ? h("h3", {}, "Wat we leerden") : null,
      d.lessons.length ? h("ul", { class: "lessons" }, ...d.lessons.map((l) => h("li", {}, l.lesson))) : null,
      d.events.length ? h("h3", {}, "Tijdlijn") : null,
      d.events.length ? h("ol", { class: "timeline" }, ...d.events.map((e) => h("li", {}, h("time", {}, `${new Date(e.at).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })} ${time(e.at)}`), h("span", {}, this.describe(e))))) : null,
    );
    queueMicrotask(() => {
      const points = d.metrics.filter((m) => m.name === p.metric);
      if (points.length < 2) {
        chartHost.replaceChildren(h("p", { class: "muted small" }, points.length ? `Eén meting: ${points[0]!.value} (${points[0]!.source}).` : "Nog geen metingen."));
        return;
      }
      lineChart(
        chartHost,
        points.map((m) => new Date(m.at).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })),
        [{ name: p.metric, color: "var(--series-1)", values: points.map((m) => m.value) }],
        { format: (n) => Math.round(n).toLocaleString("nl-NL"), target: p.target, ariaLabel: `${p.metric} per meting` },
      );
    });
    return el;
  }

  // ---- cijfers

  private statsPanel(): HTMLElement {
    const snap = this.snap!;
    const k = snap.kpis;
    const s = snap.stats;
    const top = [...snap.agents].sort((a, b) => b.costTodayEur - a.costTodayEur).slice(0, 5).filter((a) => a.costTodayEur > 0);
    return h(
      "div",
      { class: "stats-panel" },
      h("h2", {}, "📊 Cijfers"),
      h("p", { class: "muted" }, `Uit de controlekamer van ${this.label(BOT_ID)}: hetzelfde als je dagrapport, maar live.`),
      h(
        "section",
        { class: "tiles" },
        tile("Omzet vandaag", eur(k.revenueTodayEur)),
        tile("AI-kosten vandaag", eur(k.costTodayEur)),
        tile("Omzet deze maand", eur(k.revenueMonthEur, 0)),
        tile("AI deze maand", `${eur(k.costMonthEur, 0)} / ${eur(k.allowanceMonthEur, 0)}`),
        tile("Runs vandaag", String(s.totals.runsToday)),
        tile("Tokens vandaag", s.totals.tokensToday.toLocaleString("nl-NL")),
      ),
      h("h3", {}, "Omzet en kosten per dag (30 dagen)"),
      h("div", { class: "chart-host", "data-chart": "days" }),
      h("h3", {}, "Per tak (30 dagen)"),
      h("div", { class: "chart-host", "data-chart": "branches" }),
      top.length ? h("h3", {}, "Wie kostte vandaag het meest") : null,
      top.length ? h("ol", { class: "rank" }, ...top.map((a) => h("li", {}, h("button", { class: "linkish", onclick: () => this.open("agent", a.id) }, a.nickname || a.name), h("span", {}, eur(a.costTodayEur))))) : null,
      this.deps.source.mode === "live" ? h("p", { class: "small" }, h("a", { href: "/overzicht" }, "Alles in één lijst (oud overzicht) →")) : null,
    );
  }

  private drawStatsCharts(body: HTMLElement): void {
    const snap = this.snap!;
    const days = body.querySelector<HTMLElement>('[data-chart="days"]');
    const branches = body.querySelector<HTMLElement>('[data-chart="branches"]');
    queueMicrotask(() => {
      if (days) {
        lineChart(
          days,
          snap.stats.days.map((d) => new Date(`${d.date}T12:00:00`).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })),
          [
            { name: "Omzet", color: "var(--series-1)", values: snap.stats.days.map((d) => d.revenueEur) },
            { name: "Kosten", color: "var(--series-2)", values: snap.stats.days.map((d) => d.costEur) },
          ],
          { format: (n) => eur(n, n >= 100 ? 0 : 2), ariaLabel: "Omzet en kosten per dag" },
        );
      }
      if (branches) {
        pairedBars(
          branches,
          snap.stats.branches.filter((b) => b.slug !== "holding" || b.cost30Eur > 0).map((b) => ({ label: b.name, values: [b.revenue30Eur, b.cost30Eur] })),
          [
            { name: "Omzet", color: "var(--series-1)" },
            { name: "Kosten", color: "var(--series-2)" },
          ],
          (n) => eur(n, 0),
        );
      }
    });
  }

  private ledgerPanel(): HTMLElement {
    const s = this.snap!.stats;
    return h(
      "div",
      {},
      h("h2", {}, "🔒 Kluis"),
      h("p", { class: "muted" }, "Omzet komt alleen uit Stripe, CSV-exports of van jou. Agents kunnen hier nooit iets boeken."),
      h("section", { class: "tiles" }, tile("Omzet 30 dagen", eur(s.totals.revenue30Eur)), tile("Kosten 30 dagen", eur(s.totals.cost30Eur)), tile("Resultaat", eur(s.totals.revenue30Eur - s.totals.cost30Eur))),
      h("h3", {}, "Omzet en kosten per dag (30 dagen)"),
      h("div", { class: "chart-host", "data-chart": "days" }),
      h("h3", {}, "Per tak"),
      h("div", { class: "chart-host", "data-chart": "branches" }),
    );
  }

  // ---- team

  private teamPanel(): HTMLElement {
    const snap = this.snap!;
    const person = (a: OfficeAgent) => {
      const st = STATUS[a.status] ?? { label: a.status, tone: "muted" };
      return h(
        "li",
        {},
        h(
          "button",
          { class: "person", onclick: () => this.focusActor(a.id, true) },
          h("span", { class: `dot ${st.tone}` }),
          h("b", {}, a.nickname || a.name),
          h("span", { class: "muted" }, ` ${a.title ?? a.role}${a.status === "pending_approval" ? " · sollicitant" : ""}`),
          h("span", { class: "model" }, modelName(a.model)),
        ),
      );
    };
    const ceo = snap.agents.find((a) => a.hqRole === "ceo");
    const groups = [
      { slug: "holding", name: "Controlekamer" },
      ...snap.branches.filter((b) => b.slug !== "holding").map((b) => ({ slug: b.slug, name: b.name })),
    ];
    return h(
      "div",
      { class: "team-panel" },
      h("h2", {}, "👥 Team"),
      h("p", { class: "muted" }, "Wie er werkt, voor wie, en met welk model. Klik op een naam om die agent in het kantoor te zien."),
      h(
        "ul",
        { class: "org" },
        h(
          "li",
          {},
          h("button", { class: "person owner", onclick: () => this.focusActor(OWNER_ID, true) }, h("span", { class: "dot info" }), h("b", {}, this.label(OWNER_ID)), h("span", { class: "muted" }, " eigenaar")),
          h(
            "ul",
            {},
            ceo ? person(ceo) : h("li", { class: "muted" }, "Nog geen CEO"),
            h(
              "li",
              {},
              h("ul", {}, ...groups.map((g) => {
                const members = snap.agents.filter((a) => (a.branch === g.slug || (g.slug === "holding" && !snap.branches.some((b) => b.slug === a.branch))) && a !== ceo);
                return h(
                  "li",
                  { class: "group", style: `--accent:${this.accentOf(g.slug)}` },
                  h("span", { class: "group-name" }, `${g.name} (${members.length})`),
                  h("ul", {}, ...(g.slug === "holding" ? [h("li", {}, h("button", { class: "person", onclick: () => this.focusActor(BOT_ID, true) }, h("span", { class: "dot good" }), h("b", {}, this.label(BOT_ID)), h("span", { class: "muted" }, " berichten & cijfers")))] : []), ...members.map(person)),
                );
              })),
            ),
          ),
        ),
      ),
    );
  }

  // ---- kennisbank

  private knowledgePanel(): HTMLElement {
    const snap = this.snap!;
    const canvas = h("canvas", { class: "graph-canvas", width: "640", height: "420", "aria-label": "Kennisgraaf" }) as HTMLCanvasElement;
    const search = h("input", { type: "search", placeholder: "Zoek in de graaf…", "aria-label": "Zoek in de kennisgraaf" }) as HTMLInputElement;
    const info = h("p", { class: "muted small" }, "Laden…");
    void this.deps.source.graph().then((graph) => {
      const laid = layoutGraph(graph, 80);
      const W = canvas.width;
      const H = canvas.height;
      const ctx = canvas.getContext("2d")!;
      const px = (k: number) => W / 2 + laid.positions[k * 3]! * W * 0.42;
      const py = (k: number) => H / 2 + laid.positions[k * 3 + 1]! * H * 0.42;
      const index = new Map(graph.nodes.map((n, k) => [n.id, k]));
      const colors = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
      let hover = -1;
      const draw = () => {
        const q = search.value.trim().toLowerCase();
        ctx.clearRect(0, 0, W, H);
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = getComputedStyle(canvas).color;
        for (const e of graph.edges) {
          const a = index.get(e.source);
          const b = index.get(e.target);
          if (a === undefined || b === undefined) continue;
          ctx.beginPath();
          ctx.moveTo(px(a), py(a));
          ctx.lineTo(px(b), py(b));
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        graph.nodes.forEach((n, k) => {
          const match = q && n.label.toLowerCase().includes(q);
          ctx.fillStyle = colors[laid.groups[k]! % colors.length]!;
          ctx.beginPath();
          ctx.arc(px(k), py(k), (match ? 7 : 3) + Math.sqrt(n.degree), 0, Math.PI * 2);
          ctx.fill();
          if (match || k === hover) {
            ctx.fillStyle = getComputedStyle(canvas).color;
            ctx.font = "12px system-ui, sans-serif";
            ctx.fillText(n.label, px(k) + 8, py(k) - 6);
          }
        });
      };
      canvas.addEventListener("pointermove", (ev) => {
        const r = canvas.getBoundingClientRect();
        const x = ((ev.clientX - r.left) / r.width) * W;
        const y = ((ev.clientY - r.top) / r.height) * H;
        let best = -1;
        let bestD = 18 * 18;
        graph.nodes.forEach((_, k) => {
          const d = (px(k) - x) ** 2 + (py(k) - y) ** 2;
          if (d < bestD) {
            best = k;
            bestD = d;
          }
        });
        if (best !== hover) {
          hover = best;
          draw();
        }
      });
      search.addEventListener("input", draw);
      info.textContent = `${graph.totalNodes} knopen en ${graph.totalEdges} verbanden (${graph.source === "graphify" ? "gemaakt door Graphify" : "HQ-graaf; Graphify vult die aan zodra het draait"})${graph.totalNodes > graph.nodes.length ? `, de ${graph.nodes.length} belangrijkste getoond` : ""}.`;
      draw();
    }).catch((err) => {
      info.textContent = `Kon de graaf niet laden: ${err instanceof Error ? err.message : String(err)}`;
    });
    return h(
      "div",
      { class: "knowledge-panel" },
      h("h2", {}, "🧠 Kennisbank · Graphify"),
      h("p", { class: "muted" }, "Alles wat agents leren en opschrijven (lessen, notities, experimenten) als één graaf. Wil een agent iets weten, dan loopt die hierheen en vraagt het eerst aan de graaf."),
      h("section", { class: "tiles" }, tile("Knopen", String(snap.knowledge.nodes)), tile("Verbanden", String(snap.knowledge.edges)), tile("Bron", snap.knowledge.source === "graphify" ? "Graphify" : "HQ")),
      search,
      canvas,
      info,
      this.deps.source.mode === "live" && snap.knowledge.source === "graphify" ? h("p", { class: "small" }, h("a", { href: "/kennis", target: "_blank", rel: "noopener" }, "Open de volledige Graphify-weergave →")) : null,
    );
  }

  // ---- kamers

  private roomPanel(roomId: string): HTMLElement {
    const layout = this.deps.layout();
    const room = layout.rooms.find((r) => r.id === roomId);
    const snap = this.snap!;
    if (!room) return h("p", {}, "Onbekende ruimte.");
    const text: Partial<Record<string, string>> = {
      ceo: "Hier werkt de CEO aan de strategie: welke takken, welke kansen, wie er bij moet.",
      knowledge: "De kennisbank met de Graphify-kennisgraaf. Agents lopen hierheen als ze iets willen weten of iets opschrijven.",
      meeting: "Vergaderzaal met het projectenbord. Werken drie of meer mensen van één afdeling tegelijk, dan overleggen ze hier.",
      pantry: "De koffiehoek. Agents die niets te doen hebben, halen hier koffie (dat kost niets, het is alleen voor de sfeer).",
      owner: "Jouw kantoor. Verzoeken van agents komen op je bureau terecht. De rode knop is de noodstop.",
      control: "De controlekamer van de HQ-bot: alle cijfers live op de schermen, en de kluis met het geld.",
      hall: "Receptie. Nieuwe agents wachten hier op de bank tot jij ze aanneemt.",
    };
    const parts: Child[] = [h("h2", {}, room.kind === "hall" ? "Receptie" : room.name), h("p", { class: "muted" }, text[room.kind] ?? "")];
    if (room.kind === "dept" && room.branch) {
      const branch = snap.branches.find((b) => b.slug === room.branch);
      const members = snap.agents.filter((a) => a.branch === room.branch);
      parts.push(
        h("section", { class: "tiles" }, tile("Budget", `${eur(branch?.monthlyBudgetEur ?? 0, 0)}/mnd`), tile("Mensen", String(members.length)), tile("Aan het werk", String(members.filter((a) => a.status === "running").length))),
        h("h3", {}, "Mensen"),
        h("ul", { class: "people" }, ...members.map((a) => h("li", {}, h("button", { class: "linkish", onclick: () => this.open("agent", a.id) }, a.nickname || a.name), h("span", { class: "muted" }, ` ${a.title ?? a.role}`)))),
        h("h3", {}, "Projecten"),
        ...snap.projects.filter((p) => p.branch === room.branch).slice(0, 8).map((p) => this.projectCard(p)),
      );
    }
    const shortcuts: Partial<Record<string, [string, PanelKind]>> = {
      knowledge: ["🧠 Open de kennisbank", "knowledge"],
      meeting: ["📋 Open het projectenbord", "projects"],
      owner: ["📥 Bekijk je verzoeken", "approvals"],
      control: ["📊 Bekijk de cijfers", "stats"],
    };
    const sc = shortcuts[room.kind];
    if (sc) parts.push(h("div", { class: "buttons" }, h("button", { onclick: () => this.open(sc[1]) }, sc[0])));
    parts.push(h("div", { class: "buttons" }, h("button", { onclick: () => this.deps.world.fit(room.rect, true) }, "🔍 Zoom in op deze ruimte")));
    return h("div", {}, ...parts);
  }

  private helpPanel(): HTMLElement {
    return h(
      "div",
      { class: "help" },
      h("h2", {}, "Hoe werkt het kantoor?"),
      h(
        "ul",
        {},
        h("li", {}, "Elk poppetje is een echte agent. Wat je ziet gebeurt echt: werken, praten, iets opzoeken, iets vragen."),
        h("li", {}, "Klik op een poppetje om te zien waar het mee bezig is, of om het een naam en een ander uiterlijk te geven."),
        h("li", {}, "Klik op het projectenbord (vergaderzaal), de schermen (controlekamer), de kluis, het hologram (kennisbank) of je bureau."),
        h("li", {}, "Slepen = bewegen, scrollen of knijpen = zoomen, Q/E of ⟲ ⟳ = draaien."),
        h("li", {}, "🐢 🙂 🎉 bepaalt hoeveel de poppetjes 'uit zichzelf' rondlopen (koffie, praatje). Dat is alleen sfeer en kost niets."),
      ),
      h("p", { class: "small muted" }, "3D-poppetjes en meubels: Kenney (www.kenney.nl), CC0."),
    );
  }

  private confirmHalt(): void {
    const reason = h("input", { type: "text", value: "noodstop via het kantoor", "aria-label": "Reden" }) as HTMLInputElement;
    const dialog = h(
      "div",
      { class: "modal", role: "dialog", "aria-modal": "true" },
      h(
        "div",
        { class: "modal-card" },
        h("h2", {}, "🛑 Alles stoppen?"),
        h("p", {}, "Alle agents worden gepauzeerd en lopende runs worden afgebroken. Je kunt daarna alles weer hervatten."),
        reason,
        h(
          "div",
          { class: "buttons" },
          h("button", { onclick: () => dialog.remove() }, "Annuleren"),
          h(
            "button",
            {
              class: "bad",
              onclick: () => {
                dialog.remove();
                void this.act(() => this.deps.source.halt(reason.value.trim() || "noodstop"), "");
              },
            },
            "🛑 Stop alles",
          ),
        ),
      ),
    );
    this.root.appendChild(dialog);
    reason.focus();
  }
}

function chip(label: string, value: string, sub: string, onClick?: () => void, alert = false): HTMLElement {
  return h(
    onClick ? "button" : "div",
    { class: `chip${alert ? " alert" : ""}`, ...(onClick ? { onclick: onClick } : {}) },
    h("span", { class: "chip-label" }, label),
    h("b", {}, value),
    h("span", { class: "chip-sub" }, sub),
  ) as HTMLElement;
}

function tile(label: string, value: string): HTMLElement {
  return h("div", { class: "tile" }, h("span", {}, label), h("b", {}, value));
}

function stat(label: string, value: string, fraction?: number): HTMLElement {
  return h(
    "div",
    { class: "stat" },
    h("span", { class: "muted small" }, label),
    h("b", {}, value),
    fraction === undefined ? null : h("div", { class: `progress${fraction > 0.85 ? " warn" : ""}` }, h("i", { style: `width:${Math.max(2, Math.min(100, fraction * 100))}%` })),
  );
}
