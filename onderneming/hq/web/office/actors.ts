/**
 * Een poppetje in het kantoor: model met animaties, naamkaartje, tekstballon, en een
 * takenlijst (lopen, zitten, praten, iets doen). Wat ze doen bepaalt director.ts.
 */
import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Assets } from "./assets.js";
import { SEAT, type Spot } from "./layout.js";
import { findPath, type Grid, type Pt } from "./path.js";
import type { World } from "./world.js";

export type Clip = "idle" | "walk" | "sprint" | "sit" | "emote-yes" | "emote-no" | "interact-right" | "pick-up" | "holding-both" | "jump" | "crouch";
export type BubbleKind = "talk" | "think" | "alert" | "happy" | "info";

export interface ActorInfo {
  id: string;
  /** extra = figurant: geen naam, doet niets, kost niets (alleen voor de sfeer). */
  kind: "agent" | "owner" | "bot" | "guest" | "claude" | "extra";
  name: string;
  label: string;
  role: string;
  accent: string;
  look: number;
}

interface Task {
  start(a: Actor): void;
  /** true = klaar */
  update(a: Actor, dt: number): boolean;
}

const WALK_SPEED = 1.7;
const RUN_SPEED = 3.2;
/** In de 'sit'-animatie zitten de heupen op deze hoogte (bedoeld voor op de grond); op een stoel tillen we het poppetje op. */
const SIT_HIP = 0.042;

export class Actor {
  readonly root = new THREE.Group();
  info: ActorInfo;
  private model!: THREE.Object3D;
  private mixer!: THREE.AnimationMixer;
  private actions = new Map<Clip, THREE.AnimationAction>();
  private current: Clip | null = null;
  private bones: { armL?: THREE.Object3D; armR?: THREE.Object3D; head?: THREE.Object3D } = {};
  private readonly tagEl: HTMLElement;
  private readonly bubbleEl: HTMLElement;
  private readonly hitbox: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private carry: THREE.Object3D | null = null;
  private tasks: Task[] = [];
  private task: Task | null = null;
  private bubbleLeft = 0;
  private turnGoal: number | null = null;
  private typing = { l: 0, r: 0, h: 0 };

  /** Waar hij hoort (zijn stoel), en of hij daar zit. */
  home: Spot | null = null;
  seated = false;
  /** Hoogte van de zitting waar hij op zit. */
  seatY: number = SEAT.chair;
  /** Wat de agent nu echt doet (uit Paperclip/HQ). */
  status = "idle";
  working = false;
  taskText: string | null = null;
  /** Tijd tot hij weer iets 'uit zichzelf' mag doen (koffie, praatje). */
  restless = 20 + Math.random() * 40;
  meeting: string | null = null;
  visible = true;

  constructor(
    private readonly world: World,
    private readonly assets: Assets,
    info: ActorInfo,
  ) {
    this.info = info;
    this.world.actorsLayer.add(this.root);

    this.tagEl = document.createElement("div");
    this.tagEl.className = "agent-tag";
    this.tagEl.innerHTML = `<span class="dot"></span><span class="nm"></span><span class="ic"></span>`;
    this.tagEl.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.world.onPick?.({ kind: "agent", id: this.info.id }, ev);
    });
    const tag = new CSS2DObject(this.tagEl);
    tag.position.set(0, 1.42, 0);
    tag.center.set(0.5, 1);
    this.root.add(tag);

    this.bubbleEl = document.createElement("div");
    this.bubbleEl.className = "bubble";
    const bubble = new CSS2DObject(this.bubbleEl);
    bubble.position.set(0, 1.78, 0);
    bubble.center.set(0.5, 1);
    this.root.add(bubble);

    this.hitbox = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.35, 10), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitbox.position.y = 0.68;
    this.root.add(this.hitbox);
    this.world.registerPick(this.hitbox, { kind: "agent", id: info.id });

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.52, 36),
      new THREE.MeshBasicMaterial({ color: info.accent, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.ring.visible = false;
    this.root.add(this.ring);

    this.setLook(info.look);
    this.setInfo(info);
  }

  get id(): string {
    return this.info.id;
  }
  get pos(): Pt {
    return { x: this.root.position.x, z: this.root.position.z };
  }
  get idle(): boolean {
    return !this.task && this.tasks.length === 0;
  }
  get queueLength(): number {
    return this.tasks.length + (this.task ? 1 : 0);
  }

  setLook(index: number): void {
    if (this.model) {
      this.root.remove(this.model);
      this.mixer.stopAllAction();
    }
    const { root, clips } = this.assets.character(index);
    this.model = root;
    this.root.add(root);
    this.mixer = new THREE.AnimationMixer(root);
    this.actions.clear();
    for (const clip of clips) {
      const action = this.mixer.clipAction(clip);
      this.actions.set(clip.name as Clip, action);
    }
    this.bones = {};
    root.traverse((o) => {
      if (o.name === "arm-left") this.bones.armL = o;
      if (o.name === "arm-right") this.bones.armR = o;
      if (o.name === "head") this.bones.head = o;
    });
    const was = this.current;
    this.current = null;
    this.play(was ?? (this.seated ? "sit" : "idle"), 0);
    this.info.look = index;
    this.applyStatusLook();
  }

  setInfo(info: ActorInfo): void {
    const lookChanged = info.look !== this.info.look;
    this.info = info;
    this.tagEl.style.setProperty("--accent", info.accent);
    (this.ring.material as THREE.MeshBasicMaterial).color.set(info.accent);
    this.tagEl.querySelector(".nm")!.textContent = info.label;
    this.tagEl.classList.toggle("special", info.kind !== "agent");
    // Alleen wie echt iets doet heeft een naam: een figurant heeft geen naamkaartje.
    this.tagEl.classList.toggle("extra", info.kind === "extra");
    if (lookChanged) this.setLook(info.look);
  }

  setStatus(status: string): void {
    this.status = status;
    this.tagEl.dataset.status = status;
    const icon = this.tagEl.querySelector(".ic")!;
    icon.textContent = status === "paused" ? "💤" : status === "error" ? "⚠️" : status === "pending_approval" ? "🙋" : "";
    // Gepauzeerd = doet niets en kost niets: dan ook geen naam, alleen 💤.
    this.tagEl.classList.toggle("nameless", status === "paused");
    this.applyStatusLook();
  }

  setWorking(working: boolean, task: string | null): void {
    this.working = working;
    this.taskText = task;
    this.tagEl.classList.toggle("working", working);
  }

  private applyStatusLook(): void {
    const dim = this.status === "paused";
    this.model?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && "color" in m) m.color.set(dim ? "#8b93a6" : "#ffffff");
    });
  }

  select(on: boolean): void {
    this.ring.visible = on;
    this.tagEl.classList.toggle("selected", on);
  }

  setTagMode(mode: "full" | "compact" | "hidden"): void {
    this.tagEl.dataset.mode = mode;
  }

  // ---------------------------------------------------------------- tekstballon

  say(text: string, seconds = 4, kind: BubbleKind = "talk"): void {
    this.bubbleEl.textContent = text;
    this.bubbleEl.className = `bubble show ${kind}`;
    this.bubbleLeft = seconds;
  }

  hush(): void {
    this.bubbleLeft = 0;
    this.bubbleEl.className = "bubble";
  }

  // ---------------------------------------------------------------- animaties

  play(clip: Clip, fade = 0.22, once = false): number {
    const action = this.actions.get(clip) ?? this.actions.get("idle");
    if (!action) return 0;
    if (this.current === clip && !once) return action.getClip().duration;
    const prev = this.current ? this.actions.get(this.current) : undefined;
    action.reset();
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    action.clampWhenFinished = once;
    action.timeScale = clip === "walk" ? 1.25 : 1;
    action.fadeIn(fade).play();
    if (prev && prev !== action) prev.fadeOut(fade);
    this.current = clip;
    return action.getClip().duration / action.timeScale;
  }

  /** Basishouding als er niets te doen is. */
  rest(): void {
    this.play(this.seated ? "sit" : "idle");
  }

  holdPaper(on: boolean): void {
    if (on && !this.carry) {
      const paper = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.22), new THREE.MeshStandardMaterial({ color: "#ffffff" }));
      paper.position.set(0, 0.62, 0.32);
      paper.rotation.x = -0.4;
      this.root.add(paper);
      this.carry = paper;
    } else if (!on && this.carry) {
      this.root.remove(this.carry);
      this.carry = null;
    }
  }

  // ---------------------------------------------------------------- taken

  clear(): void {
    this.tasks = [];
    this.task = null;
    this.holdPaper(false);
  }

  queue(...tasks: Task[]): this {
    this.tasks.push(...tasks);
    return this;
  }

  place(spot: Spot, seated: boolean): void {
    this.root.position.set(spot.x, 0, spot.z);
    this.root.rotation.y = spot.facing;
    this.seated = seated;
    this.seatY = spot.y ?? SEAT.chair;
    this.rest();
    this.model.position.y = this.liftGoal();
  }

  /** Hoe hoog het model moet hangen: op de zitting als hij zit, anders op de vloer. */
  private liftGoal(): number {
    return this.seated && this.current === "sit" ? this.seatY - SIT_HIP : 0;
  }

  update(dt: number, t: number, grid: Grid): void {
    if (!this.task && this.tasks.length) {
      this.task = this.tasks.shift()!;
      this.task.start(this);
    }
    if (this.task && this.task.update(this, dt)) this.task = null;
    if (this.turnGoal !== null) {
      const cur = this.root.rotation.y;
      const diff = Math.atan2(Math.sin(this.turnGoal - cur), Math.cos(this.turnGoal - cur));
      this.root.rotation.y = cur + diff * Math.min(1, dt * 10);
      if (Math.abs(diff) < 0.02) this.turnGoal = null;
    }
    // Eerst de typ-houding van vorige keer terugdraaien (niet elke clip zet de armen zelf terug).
    const { armL, armR, head } = this.bones;
    if (armL) armL.rotation.x -= this.typing.l;
    if (armR) armR.rotation.x -= this.typing.r;
    if (head) head.rotation.x -= this.typing.h;
    this.typing = { l: 0, r: 0, h: 0 };
    this.mixer.update(dt);
    const lift = this.liftGoal();
    this.model.position.y += (lift - this.model.position.y) * Math.min(1, dt * 12);
    // Typen aan het bureau: armen naar voren en een beetje tikken.
    if (this.seated && this.working && this.current === "sit") {
      this.typing = {
        l: -1.05 - Math.sin(t * 17) * 0.1,
        r: -1.05 - Math.sin(t * 17 + Math.PI) * 0.1,
        h: 0.12 + Math.sin(t * 1.3) * 0.03,
      };
      if (armL) armL.rotation.x += this.typing.l;
      if (armR) armR.rotation.x += this.typing.r;
      if (head) head.rotation.x += this.typing.h;
    }
    if (this.bubbleLeft > 0) {
      this.bubbleLeft -= dt;
      if (this.bubbleLeft <= 0) this.hush();
    }
    this.restless -= dt;
    void grid;
  }

  turnTo(angle: number): void {
    this.turnGoal = angle;
  }

  faceTowards(p: Pt): void {
    const dx = p.x - this.root.position.x;
    const dz = p.z - this.root.position.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.01) this.turnGoal = Math.atan2(dx, dz);
  }

  dispose(): void {
    this.world.unregisterPick(this.hitbox);
    this.world.actorsLayer.remove(this.root);
    this.tagEl.remove();
    this.bubbleEl.remove();
  }
}

// ---------------------------------------------------------------- taken

/** Loop naar een plek (om meubels en muren heen). */
export function walkTo(grid: () => Grid, spot: Spot | Pt, opts: { run?: boolean; sit?: boolean; exact?: boolean } = {}): Task {
  let path: Pt[] = [];
  let k = 0;
  return {
    start(a) {
      if (a.seated) a.seated = false;
      const found = findPath(grid(), a.pos, spot);
      path = found ?? [{ x: spot.x, z: spot.z }];
      // Zitplekken op een bank of stoel: de laatste stap mag over het meubel.
      if (opts.exact || opts.sit) {
        const last = path[path.length - 1];
        if (!last || Math.hypot(last.x - spot.x, last.z - spot.z) > 0.05) path.push({ x: spot.x, z: spot.z });
      }
      k = 0;
      if (path.length) a.play(opts.run ? "sprint" : "walk");
    },
    update(a, dt) {
      const speed = opts.run ? RUN_SPEED : WALK_SPEED;
      let budget = speed * dt;
      while (budget > 0 && k < path.length) {
        const p = path[k]!;
        const dx = p.x - a.root.position.x;
        const dz = p.z - a.root.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.001) {
          k += 1;
          continue;
        }
        const step = Math.min(dist, budget);
        a.root.position.x += (dx / dist) * step;
        a.root.position.z += (dz / dist) * step;
        a.turnTo(Math.atan2(dx, dz));
        budget -= step;
        if (step >= dist) k += 1;
      }
      if (k >= path.length) {
        if ("facing" in spot) a.turnTo(spot.facing);
        if (opts.sit) {
          a.seated = true;
          a.seatY = ("y" in spot ? spot.y : undefined) ?? SEAT.chair;
          if ("facing" in spot) a.root.rotation.y = spot.facing;
        }
        a.rest();
        return true;
      }
      return false;
    },
  };
}

export function sitHere(spot: Spot): Task {
  return {
    start(a) {
      a.root.position.set(spot.x, 0, spot.z);
      a.root.rotation.y = spot.facing;
      a.seated = true;
      a.seatY = spot.y ?? SEAT.chair;
      a.rest();
    },
    update: () => true,
  };
}

export function standUp(): Task {
  return {
    start(a) {
      a.seated = false;
      a.rest();
    },
    update: () => true,
  };
}

/** Speel een animatie een tijdje (of één keer). */
export function act(clip: Clip, seconds?: number): Task {
  let left = 0;
  return {
    start(a) {
      const d = a.play(clip, 0.2, seconds === undefined);
      left = seconds ?? d;
    },
    update(a, dt) {
      left -= dt;
      if (left <= 0) {
        a.rest();
        return true;
      }
      return false;
    },
  };
}

export function wait(seconds: number): Task {
  let left = seconds;
  return {
    start() {
      left = seconds;
    },
    update(_a, dt) {
      left -= dt;
      return left <= 0;
    },
  };
}

export function run(fn: (a: Actor) => void): Task {
  return { start: fn, update: () => true };
}

export function say(text: string, seconds = 4, kind: BubbleKind = "talk"): Task {
  return run((a) => a.say(text, seconds, kind));
}

export function face(p: Pt | (() => Pt)): Task {
  return run((a) => a.faceTowards(typeof p === "function" ? p() : p));
}
