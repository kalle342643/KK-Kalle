/**
 * De regisseur: vertaalt wat er echt gebeurt (HQ- en Paperclip-gebeurtenissen) naar wat de
 * poppetjes doen. Werken → aan het bureau typen. Iets tegen een collega zeggen → ernaartoe lopen
 * en praten. Iets opzoeken → naar de kennisbank. Een verzoek → naar jouw bureau.
 * Daarnaast wat 'leven' als er niets gebeurt (koffie, een praatje), en overleg als een
 * afdeling met drie of meer tegelijk aan het werk is.
 */
import * as THREE from "three";
import type { CodeSession, OfficeAgent, OfficeEvent, OfficeSnapshot } from "../../src/office/types.js";
import { act, Actor, face, run, say, sitHere, standUp, wait, walkTo, type ActorInfo } from "./actors.js";
import { defaultLook, type Assets } from "./assets.js";
import type { Hologram } from "./hologram.js";
import { BOT_ID, OWNER_ID, roomAt, WORKSHOP_SLUG, type Desk, type Layout, type Poi, type PoiKind, type Spot } from "./layout.js";
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
  private meeting: { branch: string; members: Set<string>; chatter: number } | null = null;
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
    this.assignSessionDesks([...this.actors.values()].filter((a) => a.info.kind === "claude").map((a) => a.id));
    for (const a of this.actors.values()) {
      a.meeting = null;
      a.home = this.homeOf(a.id);
      if (!a.home) continue;
      const hired = previous?.benchOf.has(a.id) && !layout.benchOf.has(a.id) && layout.deskOf.has(a.id);
      a.clear();
      if (hired) {
        a.queue(standUp(), say("🎉 Aangenomen! Op naar mijn bureau.", 4, "happy"), act("jump"), walkTo(() => this.grid, a.home, { sit: true }));
      } else if (a.seated || !previous) {
        a.place(a.home, true);
      } else {
        a.queue(walkTo(() => this.grid, a.home, { sit: true }));
      }
    }
  }

  private deskOf(id: string): Desk | undefined {
    const deskId = this.layout.deskOf.get(id);
    return deskId ? this.layout.desks.find((d) => d.id === deskId) : undefined;
  }

  /** Sessies aan de bureaus van de werkplaats: wie er al zat blijft zitten, nieuwe krijgen een vrij bureau. */
  private assignSessionDesks(ids: string[]): void {
    const desks = this.layout.desks.filter((d) => d.id.startsWith(`${WORKSHOP_SLUG}:`));
    const wanted = new Set(ids);
    for (const [actorId, deskId] of [...this.sessionDesks]) {
      if (!wanted.has(actorId) || !desks.some((d) => d.id === deskId)) {
        this.sessionDesks.delete(actorId);
        this.deskOccupant.delete(deskId);
      }
    }
    for (const id of ids) {
      if (this.sessionDesks.has(id)) continue;
      const free = desks.find((d) => !this.deskOccupant.has(d.id));
      if (!free) break;
      this.sessionDesks.set(id, free.id);
      this.deskOccupant.set(free.id, id);
    }
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

  /** Nieuwe momentopname: poppetjes toevoegen, bijwerken of laten vertrekken. */
  sync(snap: OfficeSnapshot, first = false): void {
    this.snap = snap;
    const sessions = new Map((snap.code?.sessions ?? []).filter((s) => s.state !== "done").map((s) => [s.actorId, s] as const));
    this.assignSessionDesks([...sessions.keys()]);
    const wanted = new Map<string, OfficeAgent | null>([
      [OWNER_ID, null],
      [BOT_ID, null],
      ...snap.agents.filter((a) => a.status !== "terminated").map((a) => [a.id, a] as const),
      ...[...sessions.keys()].map((id) => [id, null] as const),
    ]);
    for (const [id, agent] of wanted) {
      const session = sessions.get(id);
      const info = session ? this.sessionInfo(session) : this.infoFor(id, agent);
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
      const status = session ? (session.state === "working" ? "running" : "idle") : (agent?.status ?? "idle");
      // Bij binnenkomst niet iedereen tegelijk laten roepen hoe het met ze gaat.
      if (actor.status !== status && !isNew && !first && !session) this.statusChanged(actor, actor.status, status);
      actor.setStatus(status);
      if (agent) actor.setWorking(agent.status === "running", agent.currentTask);
      if (session) actor.setWorking(session.state === "working", session.lastAction ?? session.title);
    }
    for (const [id, actor] of [...this.actors]) {
      if (wanted.has(id)) continue;
      // Vertrokken: loop naar de uitgang en verdwijn. Een Claude Code-sessie is dan klaar.
      actor.clear();
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
        if (!this.meeting?.members.has(a.id) && a.home && (!a.seated || dist(a.pos, a.home) > 0.2) && a.queueLength < 2) {
          a.queue(...this.goHome(a));
        }
        if (text) a.say(`📋 ${short(text, 70)}`, 4.5, "info");
        break;
      }
      case "run.finished": {
        if (!a) return;
        a.setWorking(false, null);
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
          a.say(approved ? "✅ Goedgekeurd, dank je!" : "❌ Afgewezen… oké.", 4, approved ? "happy" : "alert");
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
            if (home && roomAt(this.layout, home.x, home.z)?.id === roomId && Math.random() < 0.7) x.say(pick(["🎉", "💶", "🙌", "Yes!"]), 3, "happy");
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
        if (a) a.say(red ? "😬 Tests rood, ik kijk ernaar" : "✅ Tests weer groen", 4, red ? "alert" : "happy");
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
    if (!target || a.queueLength >= 3 || (this.meeting?.members.has(a.id) && target && this.meeting.members.has(target.id))) {
      a.say(line, 6, "talk");
      if (target) setTimeout(() => target.say(reply(kind), 3, "happy"), 1800);
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
        if (target.id !== OWNER_ID) {
          target.say(reply(kind), 3, "happy");
          if (!target.seated && target.idle) target.queue(face(() => a.pos), act("emote-yes"));
        } else {
          target.say("👀", 2, "info");
        }
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
        this.actor(OWNER_ID)?.say(paper ? "📥 Ik kijk ernaar" : "📊 Dank je!", 3, "info");
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
    // Een paar reageren; de rest loopt gewoon terug naar de eigen plek.
    const speakers = new Set([...this.actors.keys()].sort(() => Math.random() - 0.5).slice(0, 3));
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
      const occupant = desk.agentId ?? this.deskOccupant.get(desk.id);
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
          const name = this.meeting ? (snap.branches.find((b) => b.slug === this.meeting!.branch)?.name ?? this.meeting.branch) : "";
          status = this.meeting ? `💬 Overleg ${name} (${this.meeting.members.size})` : `📋 ${snap.projects.filter((p) => p.status === "running").length} lopende projecten`;
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
          status = down
            ? `🔴 ${down} ${down === 1 ? "site ligt" : "sites liggen"} eruit`
            : sessions.length
              ? `🤖 ${working}/${sessions.length} Claude-sessies bezig`
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

  /** Drie of meer van één afdeling tegelijk aan het werk: dan overleggen ze in de vergaderzaal. */
  private updateMeeting(): void {
    if (this.halted || !this.snap) return;
    const byBranch = new Map<string, Actor[]>();
    for (const agent of this.snap.agents) {
      const a = this.actors.get(agent.id);
      if (!a || !a.working || agent.hqRole === "ceo") continue;
      byBranch.set(agent.branch, [...(byBranch.get(agent.branch) ?? []), a]);
    }
    if (this.meeting) {
      const still = (byBranch.get(this.meeting.branch) ?? []).filter((a) => this.meeting!.members.has(a.id));
      if (still.length < 2) {
        for (const id of this.meeting.members) {
          const a = this.actors.get(id);
          if (!a) continue;
          a.meeting = null;
          a.queue(say(pick(["👍 Goed overleg", "Aan de slag!", "✅"]), 2.5, "happy"), ...this.goHome(a));
        }
        this.meeting = null;
        return;
      }
      this.meeting.chatter -= 2;
      if (this.meeting.chatter <= 0) {
        this.meeting.chatter = 4 + Math.random() * 5;
        const m = pick([...this.meeting.members]);
        this.actors.get(m)?.say(pick(["💬", "🤔", "💡", "📊", "👍"]), 2.5, "info");
      }
      return;
    }
    for (const [branch, list] of byBranch) {
      if (list.length < 3) continue;
      const seats = this.layout.pois.filter((p) => p.kind === "meeting-seat");
      const members = list.slice(0, seats.length);
      this.meeting = { branch, members: new Set(members.map((a) => a.id)), chatter: 3 };
      members.forEach((a, k) => {
        a.meeting = branch;
        a.clear();
        const seat = seats[k]!;
        this.reserved.set(seat.id, a.id);
        a.queue(standUp(), say("💬 Overleg!", 2.5, "info"), walkTo(() => this.grid, seat.spot, { sit: true }));
      });
      return;
    }
  }

  /** Als er niets gebeurt: koffie halen, een praatje, even op de bank. */
  private ambient(): void {
    if (this.liveliness === "calm") return;
    const lively = this.liveliness === "lively";
    for (const a of this.actors.values()) {
      if (a.restless > 0) continue;
      a.restless = (lively ? 15 : 45) + Math.random() * (lively ? 35 : 90);
      if (a.info.kind !== "agent" || !a.idle || a.working || a.meeting || !a.home) continue;
      if (a.status !== "idle" && a.status !== "active") continue;
      const roll = Math.random();
      if (roll < 0.35) {
        const poi = this.freePoi(["coffee"], a.id);
        if (!poi) continue;
        a.queue(standUp(), walkTo(() => this.grid, poi.spot), act("interact-right", 1.8), say("☕", 3, "info"), wait(2), ...this.goHome(a));
      } else if (roll < 0.6) {
        const other = pick([...this.actors.values()].filter((x) => x !== a && x.info.kind === "agent" && x.idle && !x.working && x.seated));
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

function reply(kind: string): string {
  if (kind === "delegate") return pick(["👍 Komt goed!", "Ik pak het op", "✅ Doe ik"]);
  return pick(["Top, dank je!", "Helder 👌", "Ik kijk ernaar", "👍"]);
}
