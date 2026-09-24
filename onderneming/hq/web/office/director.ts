/**
 * De regisseur: vertaalt wat er echt gebeurt (HQ- en Paperclip-gebeurtenissen) naar wat de
 * poppetjes doen. Werken → aan het bureau typen. Iets tegen een collega zeggen → ernaartoe lopen
 * en praten. Iets opzoeken → naar de kennisbank. Een verzoek → naar jouw bureau.
 * Daarnaast wat 'leven' als er niets gebeurt (koffie, een praatje), en overleg als een
 * afdeling met drie of meer tegelijk aan het werk is.
 */
import * as THREE from "three";
import type { CodeHelper, CodeSession, OfficeAgent, OfficeEvent, OfficeSnapshot } from "../../src/office/types.js";
import { act, Actor, face, run, say, sitHere, standUp, wait, walkTo, type ActorInfo } from "./actors.js";
import { defaultLook, type Assets } from "./assets.js";
import type { Hologram } from "./hologram.js";
import { BOT_ID, OWNER_ID, roomAt, WORKSHOP_SLUG, type Desk, type Layout, type Poi, type PoiKind, type Spot } from "./layout.js";
import { isBlocked } from "./path.js";
import { drawMonitor } from "./screens.js";
import type { World } from "./world.js";

export interface DirectorHooks {
  /** Naam zoals jij hem kent (bijnaam of naam). */
  label(id: string | null): string;
  toast(text: string, kind?: "info" | "good" | "warn" | "bad", actorId?: string | null): void;
}

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;
const euro = (n: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n).replace(/ /g, " ");
const short = (s: string | null | undefined, n = 90) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export type Liveliness = "calm" | "normal" | "lively";

export class Director {
  readonly actors = new Map<string, Actor>();
  snap: OfficeSnapshot | null = null;
  layout!: Layout;
  liveliness: Liveliness = "normal";
  private selected: string | null = null;
  private halted = false;
  /** Twee of meer agents die tegelijk aan dezelfde klus werken, zitten samen aan de vergadertafel. */
  private meeting: { groupId: string; title: string | null; members: Set<string> } | null = null;
  private readonly reserved = new Map<string, string>();
  private readonly monitorState = new Map<string, string>();
  /** Werkplaats: welke Claude Code-sessie aan welk bureau zit (en andersom). */
  private readonly sessionDesks = new Map<string, string>();
  private readonly deskOccupant = new Map<string, string>();
  /** Even stil na een noodstop of hervatten: anders roept iedereen tegelijk iets. */
  private hush = 0;
  private monitorClock = 0;
  private roomClock = 0;
  private meetingClock = 0;
  private readonly effects: Array<{ obj: THREE.Object3D; life: number; vel: THREE.Vector3; spin: number }> = [];
  follow: string | null = null;

  constructor(
    private readonly world: World,
    private readonly assets: Assets,
    private readonly hologram: Hologram,
    private readonly hooks: DirectorHooks,
  ) {}

  private get grid() {
    return this.layout.grid;
  }

  // ---------------------------------------------------------------- opbouw

  /**
   * Nieuwe plattegrond (er kwam iemand of een afdeling bij). Wie zat, zit meteen op zijn nieuwe
   * plek; wie onderweg was, loopt vanaf waar hij is naar huis; wie net is aangenomen, staat op van
   * de bank en loopt naar zijn nieuwe bureau.
   */
  setLayout(layout: Layout): void {
    const previous = this.layout as Layout | undefined;
    this.layout = layout;
    this.reserved.clear();
    this.meeting = null;
    this.monitorState.clear();
    this.assignSessionDesks(this.workshopActors());
    this.syncExtras();
    for (const a of this.actors.values()) {
      a.meeting = null;
      a.home = this.homeOf(a.id);
      if (!a.home) continue;
      const hired = previous?.benchOf.has(a.id) && !layout.benchOf.has(a.id) && layout.deskOf.has(a.id);
      a.clear();
      if (hired) {
        a.queue(standUp(), say("🎉 Aangenomen! Op naar mijn bureau.", 4, "happy"), act("jump"), walkTo(() => this.grid, a.home, { sit: true }));
      } else if (a.seated || !previous || this.offFloor(a)) {
        a.place(a.home, true);
      } else {
        a.queue(walkTo(() => this.grid, a.home, { sit: true }));
      }
    }
  }

  /** Staat hij na een verbouwing niet meer op de vloer? (Zonder figuranten wordt het gebouw kleiner.) */
  private offFloor(a: Actor): boolean {
    const { x, z } = a.pos;
    return !roomAt(this.layout, x, z) || isBlocked(this.grid, Math.floor(x), Math.floor(z));
  }

  private deskOf(id: string): Desk | undefined {
    const deskId = isExtraId(id) ? id.slice(4) : this.layout.deskOf.get(id);
    return deskId ? this.layout.desks.find((d) => d.id === deskId) : undefined;
  }

  /**
   * Figuranten: aan elk bureau dat de plattegrond daarvoor vrijhoudt, zit een poppetje zonder naam. Ze halen
   * koffie en kijken uit het raam, maar werken niet, praten niet mee en kosten niets. Alleen voor de sfeer:
   * wie een naam heeft, doet echt iets.
   */
  private syncExtras(): void {
    const desks = this.layout.desks.filter((d) => d.extra);
    const wanted = new Set(desks.map((d) => `fig:${d.id}`));
    for (const [id, actor] of [...this.actors]) {
      if (!isExtraId(id) || wanted.has(id)) continue;
      actor.dispose();
      this.actors.delete(id);
    }
    for (const desk of desks) {
      const id = `fig:${desk.id}`;
      if (this.actors.has(id)) continue;
      const room = this.layout.rooms.find((r) => r.id === desk.roomId);
      const actor = new Actor(this.world, this.assets, {
        id,
        kind: "extra",
        name: "Figurant",
        label: "",
        role: "Doet niets en kost niets: alleen voor de sfeer",
        accent: room?.accent ?? "#5b6b86",
        look: defaultLook(id, null),
      });
      actor.setStatus("idle");
      actor.home = desk.seat;
      actor.place(desk.seat, true);
      this.actors.set(id, actor);
    }
  }

  /**
   * Sessies aan de bureaus van de werkplaats: wie er al zat blijft zitten, nieuwe krijgen een vrij bureau.
   * Een helper (sub-agent) krijgt het vrije bureau het dichtst bij zijn sessie.
   */
  private assignSessionDesks(ids: string[]): void {
    const desks = this.layout.desks.filter((d) => d.id.startsWith(`${WORKSHOP_SLUG}:`));
    const wanted = new Set(ids);
    for (const [actorId, deskId] of [...this.sessionDesks]) {
      if (!wanted.has(actorId) || !desks.some((d) => d.id === deskId)) {
        this.sessionDesks.delete(actorId);
        this.deskOccupant.delete(deskId);
      }
    }
    // Eerst de sessies, dan pas de helpers: die zoeken hun sessie op.
    for (const id of [...ids].sort((a, b) => Number(isHelperId(a)) - Number(isHelperId(b)))) {
      if (this.sessionDesks.has(id)) continue;
      const parentDesk = isHelperId(id) ? desks.find((d) => d.id === this.sessionDesks.get(parentOf(id))) : undefined;
      const free = desks
        .filter((d) => !this.deskOccupant.has(d.id))
        .sort((a, b) => (parentDesk ? dist(a.seat, parentDesk.seat) - dist(b.seat, parentDesk.seat) : 0))[0];
      if (!free) break;
      this.sessionDesks.set(id, free.id);
      this.deskOccupant.set(free.id, id);
    }
  }

  /** Iedereen die in de werkplaats hoort: de sessies en hun helpers. */
  private workshopActors(): string[] {
    const out: string[] = [];
    for (const s of this.snap?.code?.sessions ?? []) {
      if (s.state === "done") continue;
      out.push(s.actorId, ...(s.helpers ?? []).map((h) => h.actorId));
    }
    return out;
  }

  /** Waar een helper staat als hij zijn sessie iets komt vragen of brengen. */
  private visitorOf(actorId: string): Spot | null {
    const deskId = this.sessionDesks.get(actorId);
    return (deskId ? this.layout.desks.find((d) => d.id === deskId)?.visitor : undefined) ?? null;
  }

  private homeOf(id: string): Spot | null {
    const sessionDesk = this.sessionDesks.get(id);
    if (sessionDesk) return this.layout.desks.find((d) => d.id === sessionDesk)?.seat ?? null;
    const desk = this.deskOf(id);
    if (desk) return desk.seat;
    const bench = this.layout.benchOf.get(id);
    const poi = bench ? this.layout.pois.find((p) => p.id === bench) : undefined;
    return poi?.spot ?? null;
  }

  private accentOf(agent: OfficeAgent | null, id: string): string {
    if (id === OWNER_ID) return "#7c4dff";
    if (id === BOT_ID) return "#14b8a6";
    if (agent?.hqRole === "ceo") return "#d4a017";
    const room = this.layout.rooms.find((r) => r.id === this.layout.roomOfBranch.get(agent?.branch ?? "holding"));
    return room?.accent ?? "#5b6b86";
  }

  private infoFor(id: string, agent: OfficeAgent | null): ActorInfo {
    const snap = this.snap!;
    if (id === OWNER_ID || id === BOT_ID) {
      const p = snap.people.find((x) => x.id === id);
      const name = id === OWNER_ID ? "Jij" : "HQ-bot";
      return {
        id,
        kind: id === OWNER_ID ? "owner" : "bot",
        name,
        label: p?.nickname || name,
        role: id === OWNER_ID ? "Eigenaar" : "Stuurt jou de berichten en houdt de cijfers bij",
        accent: this.accentOf(null, id),
        look: p?.avatar ?? defaultLook(id, null),
      };
    }
    const a = agent!;
    return {
      id,
      kind: "agent",
      name: a.name,
      label: a.nickname || a.name,
      role: a.title ?? a.role,
      accent: this.accentOf(a, id),
      look: a.avatar ?? defaultLook(id, a.hqRole),
    };
  }

  /** Een Claude Code-sessie als poppetje: oranje label met het project, de opdracht als rol. */
  private sessionInfo(s: CodeSession): ActorInfo {
    const project = this.snap?.code.projects.find((p) => p.key === s.projectKey)?.name ?? "een project";
    return {
      id: s.actorId,
      kind: "claude",
      name: `Claude · ${project}`,
      label: `Claude · ${project}`,
      role: s.title ?? "Claude Code",
      accent: "#d97757",
      look: defaultLook(`claude:${s.projectKey ?? s.id}`, null),
    };
  }

  /** Een helper van een sessie: lichter oranje, met wat hij moet uitzoeken als rol. */
  private helperInfo(s: CodeSession, helper: CodeHelper): ActorInfo {
    const project = this.snap?.code.projects.find((p) => p.key === s.projectKey)?.name ?? "een project";
    return {
      id: helper.actorId,
      kind: "claude",
      name: `${helper.label} · ${project}`,
      label: `↳ ${helper.label}`,
      role: helper.task ?? `Helper van Claude · ${project}`,
      accent: "#e9a27f",
      look: defaultLook(`helper:${helper.agentType}:${helper.actorId}`, null),
    };
  }

  /** Nieuwe momentopname: poppetjes toevoegen, bijwerken of laten vertrekken. */
  sync(snap: OfficeSnapshot, first = false): void {
    this.snap = snap;
    const sessions = new Map((snap.code?.sessions ?? []).filter((s) => s.state !== "done").map((s) => [s.actorId, s] as const));
    const helpers = new Map<string, { session: CodeSession; helper: CodeHelper }>();
    for (const session of sessions.values()) for (const helper of session.helpers ?? []) helpers.set(helper.actorId, { session, helper });
    this.assignSessionDesks(this.workshopActors());
    const wanted = new Map<string, OfficeAgent | null>([
      [OWNER_ID, null],
      [BOT_ID, null],
      ...snap.agents.filter((a) => a.status !== "terminated").map((a) => [a.id, a] as const),
      ...[...sessions.keys()].map((id) => [id, null] as const),
      ...[...helpers.keys()].map((id) => [id, null] as const),
    ]);
    for (const [id, agent] of wanted) {
      const session = sessions.get(id);
      const helping = helpers.get(id);
      const info = helping ? this.helperInfo(helping.session, helping.helper) : session ? this.sessionInfo(session) : this.infoFor(id, agent);
      let actor = this.actors.get(id);
      const isNew = !actor;
      const home = this.homeOf(id);
      if (!actor) {
        actor = new Actor(this.world, this.assets, info);
        this.actors.set(id, actor);
        actor.home = home;
        const status = agent?.status ?? "idle";
        if (first || !home) {
          if (home) actor.place(home, true);
          else actor.place(this.layout.entrance, false);
        } else if (helping) {
          // Een helper duikt op naast zijn sessie (Claude splitst werk af), hoort de opdracht en gaat ernaast aan de slag.
          const brief = this.visitorOf(helping.session.actorId) ?? home;
          actor.place(brief, false);
          this.burst(brief.x, brief.z, "confetti", 8);
          const task = helping.helper.task;
          actor.queue(say(task ? `👋 Ik zoek het uit: ${short(task, 60)}` : "👋 Waarmee kan ik helpen?", 4, "happy"), wait(1.5), walkTo(() => this.grid, home, { sit: true }));
        } else {
          // Nieuw: komt binnen door de voordeur. Een sollicitant gaat op de bank zitten, een nieuwe collega naar zijn bureau.
          actor.place(this.layout.entrance, false);
          const hello = session
            ? `👋 Claude Code hier, ik werk aan ${info.name.replace(/^Claude · /, "")}`
            : status === "pending_approval"
              ? `👋 Hoi! Ik ben ${info.label}`
              : `👋 Hallo allemaal, ik ben ${info.label}`;
          actor.queue(say(hello, 5, "happy"), walkTo(() => this.grid, home, { sit: true }));
        }
      } else {
        actor.setInfo(info);
        const moved = home && actor.home && (Math.abs(home.x - actor.home.x) > 0.01 || Math.abs(home.z - actor.home.z) > 0.01);
        actor.home = home;
        if (moved && actor.idle) actor.place(home!, true);
      }
      const status = helping || session?.state === "working" ? "running" : session ? "idle" : (agent?.status ?? "idle");
      // Bij binnenkomst niet iedereen tegelijk laten roepen hoe het met ze gaat.
      if (actor.status !== status && !isNew && !first && !session && !helping) this.statusChanged(actor, actor.status, status);
      actor.setStatus(status);
      if (agent) {
        actor.setWorking(agent.status === "running", agent.currentTask);
        actor.job = agent.status === "running" ? (agent.job ?? null) : null;
      }
      if (session) actor.setWorking(session.state === "working", session.lastAction ?? session.title);
      if (helping) actor.setWorking(true, helping.helper.lastAction ?? helping.helper.task);
    }
    for (const [id, actor] of [...this.actors]) {
      if (wanted.has(id) || isExtraId(id)) continue;
      actor.clear();
      if (isHelperId(id)) {
        // Een helper is klaar: brengt zijn verslag naar de sessie en is weer weg (hij bestond alleen voor deze klus).
        const back = this.visitorOf(parentOf(id));
        actor.queue(
          standUp(),
          ...(back ? [walkTo(() => this.grid, back), run((a) => a.turnTo(back.facing))] : []),
          say("📨 Hier is mijn verslag", 3, "happy"),
          act("interact-right", 1.4),
          run((a) => {
            this.burst(a.pos.x, a.pos.z, "confetti", 8);
            this.remove(a.id);
          }),
        );
        continue;
      }
      // Vertrokken: loop naar de uitgang en verdwijn. Een Claude Code-sessie is dan klaar.
      const bye = actor.info.kind === "claude" ? "✅ Klaar, tot de volgende!" : "👋 Doei!";
      actor.queue(standUp(), say(bye, 3, "info"), walkTo(() => this.grid, this.layout.entrance), run((a) => this.remove(a.id)));
    }
    this.world.setInbox(snap.approvals.length);
    this.setHalted(snap.halted, false);
  }

  private remove(id: string): void {
    const a = this.actors.get(id);
    if (!a) return;
    a.dispose();
    this.actors.delete(id);
    if (this.selected === id) this.selected = null;
  }

  private statusChanged(a: Actor, from: string, to: string): void {
    const quiet = this.hush > 0 || this.halted;
    if (to === "paused" && from !== "paused") {
      if (!quiet) a.say("💤 Gepauzeerd", 4, "info");
      if (a.home && !a.seated) {
        a.clear();
        a.queue(walkTo(() => this.grid, a.home, { sit: true }));
      }
    } else if (from === "paused" && to !== "paused" && to !== "terminated" && !quiet) {
      a.say("☀️ Weer aan de slag", 3, "happy");
    }
  }

  select(id: string | null): void {
    if (this.selected) this.actors.get(this.selected)?.select(false);
    this.selected = id;
    if (id) this.actors.get(id)?.select(true);
  }

  // ---------------------------------------------------------------- hulpjes

  private freePoi(kinds: PoiKind[], actorId: string, near?: { x: number; z: number }): Poi | null {
    const options = this.layout.pois.filter((p) => kinds.includes(p.kind) && (!this.reserved.has(p.id) || this.reserved.get(p.id) === actorId));
    if (!options.length) return null;
    const chosen = near ? options.sort((a, b) => dist(a.spot, near) - dist(b.spot, near))[0]! : pick(options);
    this.reserved.set(chosen.id, actorId);
    return chosen;
  }

  private release(actorId: string): void {
    for (const [poi, who] of [...this.reserved]) if (who === actorId) this.reserved.delete(poi);
  }

  /** Terug naar je eigen stoel (of de bank in de hal). */
  private goHome(a: Actor) {
    return [
      run((x) => this.release(x.id)),
      a.home ? walkTo(() => this.grid, a.home, { sit: true }) : wait(0),
    ];
  }

  /** Waar ga je staan om met iemand te praten? */
  private approach(target: Actor): Spot {
    const desk = this.deskOf(target.id);
    if (desk && target.seated) return desk.visitor;
    const p = target.pos;
    for (const [dx, dz] of [
      [0, 0.9],
      [0.9, 0],
      [-0.9, 0],
      [0, -0.9],
    ] as const) {
      const i = Math.floor(p.x + dx);
      const j = Math.floor(p.z + dz);
      if (i >= 0 && j >= 0 && i < this.grid.w && j < this.grid.h && !this.grid.blocked[j * this.grid.w + i]) {
        return { x: p.x + dx, z: p.z + dz, facing: Math.atan2(-dx, -dz) };
      }
    }
    return { x: p.x, z: p.z + 1, facing: Math.PI };
  }

  private actor(id: string | null | undefined): Actor | undefined {
    return id ? this.actors.get(id) : undefined;
  }

  // ---------------------------------------------------------------- gebeurtenissen

  handle(e: OfficeEvent): void {
    if (!this.layout) return;
    const a = this.actor(e.agentId);
    const text = e.text ?? "";
    switch (e.type) {
      case "run.started": {
        if (!a) return;
        a.setWorking(true, text || a.taskText);
        a.setStatus("running");
        a.job = typeof e.data.groupId === "string" ? { groupId: e.data.groupId, title: typeof e.data.groupTitle === "string" ? e.data.groupTitle : null } : null;
        if (!this.meeting?.members.has(a.id) && a.home && (!a.seated || dist(a.pos, a.home) > 0.2) && a.queueLength < 2) {
          a.queue(...this.goHome(a));
        }
        if (text) a.say(`📋 ${short(text, 70)}`, 4.5, "info");
        break;
      }
      case "run.finished": {
        if (!a) return;
        a.setWorking(false, null);
        a.job = null;
        if (a.status === "running") a.setStatus("idle");
        const failed = e.data.status === "failed" || e.data.status === "timed_out";
        const tools = typeof e.data.tools === "string" ? ` · ${e.data.tools}` : "";
        a.say(failed ? "⚠️ Dat lukte niet" : `✅ Klaar${tools}`, tools ? 4 : 3, failed ? "alert" : "happy");
        break;
      }
      case "agent.tool": {
        // Een agent op het web of in de kennisgraaf: kort in beeld, zonder hem van zijn bureau te halen.
        if (!a || this.hush > 0) return;
        a.setWorking(true, a.taskText);
        a.say(short(text, 64), 3.2, "info");
        if (e.data.kind === "graph") this.hologram.highlight(String(e.data.detail ?? ""), 2.5);
        break;
      }
      case "talk":
      case "notify": {
        if (!a) return;
        const target = e.type === "notify" ? this.actor(OWNER_ID) : (this.actor(e.targetAgentId) ?? this.actor(OWNER_ID));
        this.talk(a, target ?? null, text, String(e.data.kind ?? (e.type === "notify" ? "notify" : "comment")));
        break;
      }
      case "task.done":
        if (a && this.hush <= 0) a.say(`☑️ Af: ${short(text, 60)}`, 4, "happy");
        break;
      case "knowledge.query": {
        if (!a) return;
        this.visitKnowledge(a, text, "query");
        break;
      }
      case "knowledge.write": {
        if (!a) {
          this.hologram.highlight(text, 4);
          return;
        }
        this.visitKnowledge(a, text, "write");
        break;
      }
      case "knowledge.rebuilt":
        this.hologram.highlight("", 3);
        this.hooks.toast(`🧠 ${text || "Kennisgraaf bijgewerkt"}`, "info");
        break;
      case "approval.requested": {
        const bringer = a ?? this.actor(BOT_ID);
        if (!bringer) return;
        const amount = typeof e.data.amountEur === "number" && e.data.amountEur > 0 ? ` (${euro(e.data.amountEur)})` : "";
        this.deliver(bringer, `🙋 ${short(text, 80)}${amount}`, true);
        break;
      }
      case "approval.decided": {
        const approved = e.data.status === "approved";
        if (a) {
          a.say(approved ? "✅ Goedgekeurd" : "❌ Afgewezen", 4, approved ? "happy" : "alert");
          if (a.idle && !a.seated) a.queue(act(approved ? "jump" : "emote-no"));
        }
        this.actor(OWNER_ID)?.say(approved ? "👍" : "👎", 2, "info");
        break;
      }
      case "agent.hired":
        // De momentopname voegt de sollicitant toe (hij loopt dan binnen); hier alleen een melding.
        this.hooks.toast(`🙋 ${text || "Nieuwe sollicitant"} bij de receptie`, "info", e.agentId);
        break;
      case "agent.status": {
        if (!a) return;
        const to = String(e.data.to ?? a.status);
        this.statusChanged(a, a.status, to);
        a.setStatus(to);
        break;
      }
      case "budget.stop":
        if (a) {
          a.say("🛑 Mijn budget is op", 6, "alert");
          a.setStatus("paused");
        }
        break;
      case "revenue": {
        const amount = typeof e.data.amountEur === "number" ? e.data.amountEur : 0;
        const roomId = this.layout.roomOfBranch.get(String(e.data.branch ?? "holding")) ?? "dept-holding";
        const room = this.layout.rooms.find((r) => r.id === roomId);
        if (room) {
          this.burst(room.rect.x + room.rect.w / 2, room.rect.z + room.rect.d / 2, "#f5c542", 14);
          for (const x of this.actors.values()) {
            const home = x.home;
            if (home && roomAt(this.layout, home.x, home.z)?.id === roomId && Math.random() < 0.7) x.say(pick(["🎉", "💶", "🙌"]), 3, "happy");
          }
        }
        this.actor(BOT_ID)?.say(`💶 +${euro(amount)}`, 5, "happy");
        break;
      }
      case "metric": {
        if (!a) return;
        const poi = this.layout.pois.find((p) => p.kind === "whiteboard" && p.roomId === this.layout.roomOfBranch.get(this.snap?.agents.find((x) => x.id === a.id)?.branch ?? ""));
        if (poi && a.queueLength < 2) {
          a.queue(standUp(), walkTo(() => this.grid, poi.spot), act("interact-right", 2.2), say(`📈 ${short(text, 60)}`, 4, "info"), ...this.goHome(a));
        } else {
          a.say(`📈 ${short(text, 60)}`, 4, "info");
        }
        break;
      }
      case "experiment.started": {
        if (a) a.say(`🚀 ${short(text, 70)}`, 5, "happy");
        const roomId = this.layout.roomOfBranch.get(String(e.data.branch ?? ""));
        const room = this.layout.rooms.find((r) => r.id === roomId);
        if (room) this.burst(room.rect.x + room.rect.w - 3.5, room.rect.z + 1, "#8bd3ff", 10);
        break;
      }
      case "experiment.verdict": {
        const verdict = String(e.data.verdict ?? "");
        const roomId = this.layout.roomOfBranch.get(String(e.data.branch ?? ""));
        const members = [...this.actors.values()].filter((x) => x.home && roomAt(this.layout, x.home.x, x.home.z)?.id === roomId);
        if (verdict === "keep") {
          const room = this.layout.rooms.find((r) => r.id === roomId);
          if (room) this.burst(room.rect.x + room.rect.w / 2, room.rect.z + room.rect.d / 2, "#7cf29a", 24);
          for (const m of members) m.say(pick(["🎉 KEEP!", "🥳", "🙌"]), 4, "happy");
        } else if (verdict === "kill") {
          a?.say(`🪦 ${short(text, 60)}`, 5, "alert");
        } else if (verdict === "iterate") {
          a?.say(`🔁 ${short(text, 60)}`, 5, "info");
        }
        break;
      }
      case "message.sent": {
        const bot = this.actor(BOT_ID);
        if (!bot) return;
        const report = /dagrapport|weekoverzicht|📊/i.test(text);
        if (report && bot.queueLength < 2) {
          this.deliver(bot, "📊 Je rapport staat klaar", false);
        } else {
          bot.say(`📨 ${short(text, 80)}`, 4.5, "info");
          if (bot.seated && bot.idle) bot.queue(standUp(), act("interact-right", 1.6), sitHere(bot.home ?? { x: bot.pos.x, z: bot.pos.z, facing: 0 }));
        }
        break;
      }
      case "agent.profile": {
        // De volgende momentopname zet de nieuwe naam en het uiterlijk; hier alleen de reactie.
        if (!a) return;
        if (e.data.changed === "avatar") a.say("✨ Nieuwe look!", 3, "happy");
        else if (typeof e.data.nickname === "string") a.say(`✨ Ik heet nu ${e.data.nickname}`, 3, "happy");
        else a.say("🙂 Gewoon weer mijn eigen naam", 3, "info");
        if (a.idle && !a.seated) a.queue(act("jump"));
        break;
      }
      case "code.session": {
        if (!a || this.hush > 0) return;
        const action = String(e.data.action ?? "");
        if (action === "task") {
          const task = text.replace(/^Nieuwe opdracht[^:]*:\s*/, "");
          a.setWorking(true, `📋 ${task}`);
          a.say(`📋 ${short(task, 80)}`, 5, "info");
        } else if (action === "tool") {
          a.setWorking(true, a.taskText);
          a.say(short(text, 64), 3, "info");
        } else if (action === "stopped") {
          a.setWorking(false, a.taskText);
          a.say("✅ Klaar, jouw beurt!", 4, "happy");
          if (a.seated && a.idle) a.queue(standUp(), act("emote-yes", 1.2), sitHere(a.home ?? { x: a.pos.x, z: a.pos.z, facing: 0 }));
        } else if (action === "started") {
          a.say("👋 Aan de slag", 3, "happy");
        } else if (action === "waiting") {
          a.say("⏳ Even wachten op mijn helpers", 4, "info");
        }
        break;
      }
      case "code.helper": {
        if (this.hush > 0) return;
        const action = String(e.data.action ?? "");
        const label = String(e.data.label ?? "Helper");
        const parent = this.actor(e.targetAgentId);
        if (action === "start") {
          const task = typeof e.data.task === "string" ? e.data.task : null;
          parent?.say(`🧑‍🤝‍🧑 ${label} erbij${task ? `: ${short(task, 50)}` : ""}`, 4, "info");
        } else if (action === "tool") {
          if (a) {
            a.setWorking(true, text);
            a.say(short(text, 64), 3, "info");
          }
        } else if (action === "stop") {
          a?.say("📨 Klaar, ik breng het verslag", 3, "happy");
        }
        break;
      }
      case "code.commit": {
        if (e.data.summary) return;
        if (a) {
          a.setWorking(true, `✍️ ${text}`);
          a.say(`✍️ ${short(text, 60)}`, 4, "info");
        }
        this.boardBurst(String(e.data.project ?? ""), "#8bd3ff", 5);
        break;
      }
      case "code.pr": {
        const action = String(e.data.action ?? "");
        if (a) a.say(action === "merged" ? "🎉 Samengevoegd!" : action === "opened" ? `🔀 ${short(text, 60)}` : "🚪 PR gesloten", 4, action === "merged" ? "happy" : "info");
        if (action === "merged") this.boardBurst(String(e.data.project ?? ""), "confetti", 18);
        break;
      }
      case "code.ci": {
        const red = e.data.state === "failed";
        if (a) a.say(red ? "😬 Tests rood" : "✅ Tests weer groen", 4, red ? "alert" : "happy");
        break;
      }
      case "code.deploy":
        if (e.data.state === "success") this.boardBurst(String(e.data.project ?? ""), "confetti", 14);
        break;
      case "code.health": {
        // De HQ-bot rent naar het bord van dat project.
        const down = e.data.state === "down";
        const bot = this.actor(BOT_ID);
        const poi = this.layout.pois.find((p) => p.id === `code-board-${String(e.data.project ?? "")}`);
        if (bot && poi && bot.queueLength < 2) {
          bot.queue(
            standUp(),
            walkTo(() => this.grid, poi.spot, { run: down }),
            run((x) => x.turnTo(poi.spot.facing)),
            say(down ? "🚨 Deze ligt eruit!" : "😮‍💨 Weer online", 5, down ? "alert" : "happy"),
            act("interact-right", 2),
            ...this.goHome(bot),
          );
        }
        break;
      }
      case "code.backlog": {
        const added = Array.isArray(e.data.added) ? e.data.added.length : 0;
        const bot = this.actor(BOT_ID);
        if (added && bot) this.deliver(bot, `📋 ${short(text, 80)}`, false);
        break;
      }
      case "halt":
        this.setHalted(true, true);
        break;
      case "resume":
        this.setHalted(false, true);
        break;
      default:
        break;
    }
  }

  private talk(a: Actor, target: Actor | null, text: string, kind: string): void {
    const line = kind === "delegate" ? `📝 ${short(text, 90)}` : `💬 ${short(text, 110)}`;
    // Druk bezig of samen in overleg: gewoon zeggen, niet heen en weer lopen.
    // De ontvanger zegt niets terug (dat zou verzonnen zijn): hij laat alleen zien dat het binnenkwam.
    const received = kind === "delegate" ? "📥" : "👀";
    if (!target || a.queueLength >= 3 || (this.meeting?.members.has(a.id) && target && this.meeting.members.has(target.id))) {
      a.say(line, 6, "talk");
      if (target && target.id !== OWNER_ID) setTimeout(() => target.say(received, 2.5, "info"), 1800);
      return;
    }
    const spot = this.approach(target);
    const duration = Math.min(7, 2.5 + text.length * 0.035);
    a.queue(
      standUp(),
      walkTo(() => this.grid, spot),
      face(() => target.pos),
      say(line, duration, "talk"),
      act(kind === "delegate" ? "interact-right" : "emote-yes", Math.min(duration, 2.2)),
      run(() => {
        target.say(received, 2.5, "info");
        if (target.id !== OWNER_ID && !target.seated && target.idle) target.queue(face(() => a.pos));
      }),
      wait(Math.max(0.8, duration - 2.2)),
      ...this.goHome(a),
    );
  }

  private visitKnowledge(a: Actor, text: string, mode: "query" | "write"): void {
    if (a.queueLength >= 3) {
      a.say(mode === "query" ? `🔎 ${short(text, 70)}` : `📘 ${short(text, 70)}`, 5, "info");
      this.hologram.highlight(text, 5);
      return;
    }
    const poi = this.freePoi(mode === "write" ? ["shelf"] : ["shelf", "terminal", "hologram"], a.id);
    if (!poi) {
      a.say(`🔎 ${short(text, 70)}`, 5, "info");
      return;
    }
    const anchor = this.world.hologramAnchor;
    a.queue(
      standUp(),
      walkTo(() => this.grid, poi.spot),
      poi.kind === "hologram" ? face({ x: anchor.x, z: anchor.z }) : run((x) => x.turnTo(poi.spot.facing)),
      run(() => {
        const hits = this.hologram.highlight(text, mode === "query" ? 7 : 4);
        void hits;
      }),
      say(mode === "query" ? `🔎 ${short(text, 80)}` : `📘 ${short(text, 80)}`, 5.5, "info"),
      act(mode === "write" ? "pick-up" : "interact-right", mode === "write" ? undefined : 3.2),
      ...this.goHome(a),
    );
  }

  /** Iets naar jouw bureau brengen (verzoek of rapport). */
  private deliver(a: Actor, line: string, paper: boolean): void {
    const poi = this.freePoi(["visitor"], a.id);
    if (!poi || a.queueLength >= 3) {
      a.say(line, 6, "talk");
      return;
    }
    a.queue(
      standUp(),
      run((x) => x.holdPaper(true)),
      walkTo(() => this.grid, poi.spot),
      run((x) => x.turnTo(poi.spot.facing)),
      say(line, 6, "talk"),
      act("emote-yes", 1.4),
      run((x) => {
        x.holdPaper(false);
        if (paper) this.world.setInbox((this.snap?.approvals.length ?? 0) + 1);
        // Jij zegt niets (dat zou verzonnen zijn); het verzoek ligt nu op je bureau.
        this.actor(OWNER_ID)?.say(paper ? "📥" : "📊", 2.5, "info");
      }),
      wait(0.8),
      ...this.goHome(a),
    );
  }

  /** Muntjes of confetti bij het bord van een project in de werkplaats. */
  private boardBurst(projectKey: string, color: string, n: number): void {
    const board = this.layout.furniture.find((f) => f.type === "code-board" && f.ref === projectKey);
    if (board) this.burst(board.x, board.z + 0.8, color, n);
  }

  private setHalted(on: boolean, announce: boolean): void {
    if (this.halted === on) return;
    this.halted = on;
    this.hush = 5;
    this.world.setAlarm(on);
    // Een paar reageren (figuranten niet: die doen niets); de rest loopt gewoon terug naar de eigen plek.
    const speakers = new Set(
      [...this.actors.keys()]
        .filter((id) => !isExtraId(id))
        .sort(() => Math.random() - 0.5)
        .slice(0, 3),
    );
    if (on) {
      this.meeting = null;
      for (const a of this.actors.values()) {
        a.clear();
        a.meeting = null;
        if (a.home) a.queue(walkTo(() => this.grid, a.home, { sit: true, run: announce }));
        if (announce && speakers.has(a.id)) a.say(pick(["⏸ Noodstop!", "😮 Alles stil", "⏸ Oké, ik stop"]), 4, "alert");
      }
    } else if (announce) {
      for (const a of this.actors.values()) if (speakers.has(a.id)) a.say(pick(["▶️ Weer aan!", "🙌", "☀️ Daar gaan we"]), 3, "happy");
    }
  }

  // ---------------------------------------------------------------- elke frame

  update(dt: number, t: number): void {
    if (!this.layout) return;
    this.hush = Math.max(0, this.hush - dt);
    for (const a of this.actors.values()) a.update(dt, t, this.grid);
    if (this.follow) {
      const a = this.actors.get(this.follow);
      if (a) this.world.focus(a.pos.x, a.pos.z);
    }
    this.updateEffects(dt);
    this.monitorClock -= dt;
    if (this.monitorClock <= 0) {
      this.monitorClock = 0.45;
      this.updateMonitors(t);
    }
    this.roomClock -= dt;
    if (this.roomClock <= 0) {
      this.roomClock = 1;
      this.updateRooms();
    }
    this.meetingClock -= dt;
    if (this.meetingClock <= 0) {
      this.meetingClock = 2;
      this.updateMeeting();
    }
    if (!this.halted) this.ambient();
  }

  private updateMonitors(t: number): void {
    for (const desk of this.layout.desks) {
      const screen = this.world.monitors.get(desk.id);
      if (!screen) continue;
      const occupant = desk.agentId ?? this.deskOccupant.get(desk.id) ?? (desk.extra ? `fig:${desk.id}` : undefined);
      const a = occupant ? this.actors.get(occupant) : undefined;
      const room = this.layout.rooms.find((r) => r.id === desk.roomId);
      const working = Boolean(a?.working);
      const paused = a?.status === "paused";
      const key = `${working}|${paused}|${a?.info.label ?? ""}|${a?.taskText ?? ""}`;
      if (!working && this.monitorState.get(desk.id) === key) continue;
      this.monitorState.set(desk.id, key);
      drawMonitor(screen, {
        working,
        task: a?.taskText ?? null,
        accent: room?.accent ?? "#5b6b86",
        // Een figurant heeft geen naam, ook niet op zijn scherm.
        name: a ? a.info.label : "vrij",
        paused,
        t,
      });
    }
  }

  private updateRooms(): void {
    const snap = this.snap;
    if (!snap) return;
    const inRoom = new Map<string, Actor[]>();
    for (const a of this.actors.values()) {
      const r = roomAt(this.layout, a.pos.x, a.pos.z);
      if (r) inRoom.set(r.id, [...(inRoom.get(r.id) ?? []), a]);
    }
    for (const room of this.layout.rooms) {
      const here = inRoom.get(room.id) ?? [];
      let status = "";
      let busy = false;
      switch (room.kind) {
        case "dept":
        case "control": {
          const members = [...this.actors.values()].filter((a) => a.home && roomAt(this.layout, a.home.x, a.home.z)?.id === room.id && a.info.kind === "agent");
          const working = members.filter((a) => a.working).length;
          busy = working > 0;
          status = members.length ? `${working}/${members.length} aan het werk` : room.kind === "control" ? "cijfers live" : "nog leeg";
          if (room.kind === "control") status = `📊 ${status}`;
          break;
        }
        case "knowledge": {
          const n = here.length;
          busy = n > 0;
          status = n ? `🔎 ${n} ${n === 1 ? "zoekt" : "zoeken"} iets op` : `${snap.knowledge.nodes} knopen · ${snap.knowledge.source === "graphify" ? "Graphify" : "HQ-graaf"}`;
          break;
        }
        case "meeting": {
          busy = Boolean(this.meeting);
          status = this.meeting
            ? `🤝 Samen aan: ${short(this.meeting.title ?? "één klus", 40)} (${this.meeting.members.size})`
            : `📋 ${snap.projects.filter((p) => p.status === "running").length} lopende projecten`;
          break;
        }
        case "owner":
          busy = snap.approvals.length > 0;
          status = snap.approvals.length ? `📥 ${snap.approvals.length} ${snap.approvals.length === 1 ? "verzoek wacht" : "verzoeken wachten"} op jou` : "niets te beslissen";
          break;
        case "pantry": {
          const n = here.length;
          busy = n > 0;
          status = n ? `☕ ${n} aan de koffie` : "rustig";
          break;
        }
        case "ceo": {
          const ceo = snap.agents.find((a) => a.hqRole === "ceo");
          busy = ceo?.status === "running";
          status = ceo ? (ceo.status === "running" ? "aan het werk" : ceo.status === "paused" ? "gepauzeerd" : "beschikbaar") : "vacature";
          break;
        }
        case "workshop": {
          const sessions = snap.code.sessions.filter((s) => s.state !== "done");
          const working = sessions.filter((s) => s.state === "working").length;
          const down = snap.code.projects.filter((p) => p.health.state === "down").length;
          busy = working > 0 || down > 0;
          const helping = sessions.reduce((n, s) => n + (s.helpers?.length ?? 0), 0);
          status = down
            ? `🔴 ${down} ${down === 1 ? "site ligt" : "sites liggen"} eruit`
            : sessions.length
              ? `🤖 ${working}/${sessions.length} Claude-sessies bezig${helping ? ` · 🧑‍🤝‍🧑 ${helping} ${helping === 1 ? "helper" : "helpers"}` : ""}`
              : `${snap.code.projects.length} ${snap.code.projects.length === 1 ? "project" : "projecten"}`;
          break;
        }
        case "hall": {
          const pending = snap.agents.filter((a) => a.status === "pending_approval").length;
          busy = pending > 0;
          status = pending ? `🙋 ${pending} ${pending === 1 ? "sollicitant" : "sollicitanten"}` : "";
          break;
        }
        default:
          break;
      }
      this.world.setRoomStatus(room.id, status, busy);
    }
  }

  /**
   * Werken twee of meer agents tegelijk aan dezelfde klus (dezelfde Paperclip-taak, of subtaken van één taak zoals
   * de ideeënraad), dan zitten ze samen aan de vergadertafel. Wie klaar is, gaat terug naar zijn bureau. Verder
   * werkt iedereen aan zijn eigen bureau: het kantoor laat geen overleg zien dat er niet is.
   */
  private updateMeeting(): void {
    if (this.halted || !this.snap) return;
    const byJob = new Map<string, Actor[]>();
    for (const a of this.actors.values()) {
      if (a.info.kind !== "agent" || !a.working || !a.job) continue;
      byJob.set(a.job.groupId, [...(byJob.get(a.job.groupId) ?? []), a]);
    }
    const seats = this.layout.pois.filter((p) => p.kind === "meeting-seat");
    const leave = (a: Actor) => {
      a.meeting = null;
      a.clear();
      a.queue(...this.goHome(a));
    };
    const join = (a: Actor, groupId: string) => {
      const seat = seats.find((s) => !this.reserved.has(s.id) || this.reserved.get(s.id) === a.id);
      if (!seat) return false;
      a.meeting = groupId;
      a.clear();
      this.reserved.set(seat.id, a.id);
      a.queue(standUp(), walkTo(() => this.grid, seat.spot, { sit: true }));
      return true;
    };
    if (this.meeting) {
      const m = this.meeting;
      const working = byJob.get(m.groupId) ?? [];
      // Wie klaar is met zijn deel, gaat terug; wie er later bij komt, schuift aan.
      for (const id of [...m.members]) {
        const a = this.actors.get(id);
        if (a && working.includes(a)) continue;
        m.members.delete(id);
        if (a) leave(a);
      }
      if (m.members.size + working.filter((a) => !m.members.has(a.id)).length < 2) {
        for (const id of m.members) {
          const a = this.actors.get(id);
          if (a) leave(a);
        }
        this.meeting = null;
        return;
      }
      for (const a of working) if (!m.members.has(a.id) && join(a, m.groupId)) m.members.add(a.id);
      return;
    }
    for (const [groupId, list] of byJob) {
      if (list.length < 2 || seats.length < 2) continue;
      const m = { groupId, title: list[0]!.job?.title ?? null, members: new Set<string>() };
      this.meeting = m;
      for (const a of list) if (join(a, groupId)) m.members.add(a.id);
      return;
    }
  }

  /** Als er niets gebeurt: koffie halen, een praatje, even op de bank. Figuranten doen alleen dit. */
  private ambient(): void {
    if (this.liveliness === "calm") return;
    const lively = this.liveliness === "lively";
    // Wie gepauzeerd is, blijft zitten (en praat ook niet terug).
    const social = (x: Actor) => (x.info.kind === "agent" || x.info.kind === "extra") && x.status !== "paused";
    for (const a of this.actors.values()) {
      if (a.restless > 0) continue;
      a.restless = (lively ? 15 : 45) + Math.random() * (lively ? 35 : 90);
      if (!social(a) || !a.idle || a.working || a.meeting || !a.home) continue;
      if (a.status !== "idle" && a.status !== "active") continue;
      const roll = Math.random();
      if (roll < 0.35) {
        const poi = this.freePoi(["coffee"], a.id);
        if (!poi) continue;
        a.queue(standUp(), walkTo(() => this.grid, poi.spot), act("interact-right", 1.8), say("☕", 3, "info"), wait(2), ...this.goHome(a));
      } else if (roll < 0.6) {
        const other = pick([...this.actors.values()].filter((x) => x !== a && social(x) && x.idle && !x.working && x.seated));
        if (!other) continue;
        a.queue(
          standUp(),
          walkTo(() => this.grid, this.approach(other)),
          face(() => other.pos),
          say(pick(["😄", "☕?", "🎮", "📈", "🙌", "🤔"]), 2.5, "info"),
          run(() => other.say(pick(["😂", "👍", "🙂", "💡"]), 2.5, "info")),
          act("emote-yes"),
          wait(1.5),
          ...this.goHome(a),
        );
      } else if (roll < 0.75) {
        const poi = this.freePoi(["water"], a.id);
        if (!poi) continue;
        a.queue(standUp(), walkTo(() => this.grid, poi.spot), act("interact-right", 1.5), say("💧", 2, "info"), ...this.goHome(a));
      } else if (roll < 0.88) {
        const poi = this.freePoi(["sofa", "stool"], a.id);
        if (!poi) continue;
        a.queue(standUp(), walkTo(() => this.grid, poi.spot, { sit: true }), say("😌", 2.5, "info"), wait(6 + Math.random() * 6), ...this.goHome(a));
      } else {
        const poi = this.freePoi(["window"], a.id);
        if (!poi) continue;
        a.queue(standUp(), walkTo(() => this.grid, poi.spot), wait(4), ...this.goHome(a));
      }
    }
  }

  // ---------------------------------------------------------------- effecten

  /** Muntjes of confetti. */
  private burst(x: number, z: number, color: string, n: number): void {
    for (let k = 0; k < n; k++) {
      const coin = new THREE.Mesh(
        color === "#f5c542" ? new THREE.CylinderGeometry(0.09, 0.09, 0.025, 14) : new THREE.BoxGeometry(0.1, 0.02, 0.06),
        new THREE.MeshStandardMaterial({ color: color === "#f5c542" ? color : pick(["#ff7ad9", "#7c9cff", "#5ef0b6", "#ffd166", "#f87171"]), metalness: 0.3, roughness: 0.4 }),
      );
      coin.position.set(x + (Math.random() - 0.5) * 1.2, 1.2, z + (Math.random() - 0.5) * 1.2);
      this.world.actorsLayer.add(coin);
      this.effects.push({
        obj: coin,
        life: 1.8 + Math.random() * 0.8,
        vel: new THREE.Vector3((Math.random() - 0.5) * 1.6, 2.5 + Math.random() * 2, (Math.random() - 0.5) * 1.6),
        spin: (Math.random() - 0.5) * 12,
      });
    }
  }

  private updateEffects(dt: number): void {
    for (const e of [...this.effects]) {
      e.life -= dt;
      e.vel.y -= 6 * dt;
      e.obj.position.addScaledVector(e.vel, dt);
      e.obj.rotation.x += e.spin * dt;
      e.obj.rotation.z += e.spin * 0.7 * dt;
      if (e.obj.position.y < 0.03) {
        e.obj.position.y = 0.03;
        e.vel.set(0, 0, 0);
        e.spin = 0;
      }
      if (e.life <= 0) {
        this.world.actorsLayer.remove(e.obj);
        this.effects.splice(this.effects.indexOf(e), 1);
      }
    }
  }
}

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Helpers hebben het id van hun sessie + "~" + hun eigen id. */
export const isHelperId = (id: string) => id.startsWith("cc:") && id.includes("~");

/** Figuranten hebben "fig:" + het id van hun bureau. */
export const isExtraId = (id: string) => id.startsWith("fig:");
export const parentOf = (id: string) => id.slice(0, id.lastIndexOf("~"));
