/**
 * De 3D-wereld: camera (van schuin boven, zoals The Sims), licht, vloeren, muren die je
 * inkijkt, meubels uit de plattegrond, borden en schermen. Poppetjes zitten in actors.ts.
 */
import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Assets, FurnitureName } from "./assets.js";
import type { Furniture, Layout, Room } from "./layout.js";
import { CanvasScreen, drawSign, FONT, roundRect } from "./screens.js";

export type PickKind =
  | "agent"
  | "desk"
  | "kanban"
  | "video-wall"
  | "vault"
  | "owner-desk"
  | "red-button"
  | "hologram"
  | "whiteboard"
  | "code-project"
  | "room";

export interface Pick {
  kind: PickKind;
  id: string;
}

interface WallMesh {
  mesh: THREE.Mesh;
  outer: boolean;
  glass: boolean;
  full: number;
  /** Buitenkant van een gevelmuur (voor het wegknippen naar de camera toe). */
  outward: THREE.Vector2 | null;
}

const PITCH = 0.62;
/** Zo ver kun je uitzoomen (op een telefoon past het hele gebouw er dan in). */
const MIN_ZOOM = 0.15;
const box = (w: number, h: number, d: number, color: string, opts: { y?: number; rough?: number; emissive?: string } = {}) => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.85, metalness: 0, emissive: opts.emissive ?? "#000000" }),
  );
  mesh.position.y = (opts.y ?? 0) + h / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

function floorTexture(kind: string, color: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const base = new THREE.Color(color);
  const shade = (f: number) => `#${base.clone().multiplyScalar(f).getHexString()}`;
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 256);
  if (kind === "wood") {
    // Planken van een halve eenheid breed, met naden en wat nerf.
    for (let r = 0; r < 4; r++) {
      const y = r * 64;
      g.fillStyle = r % 2 ? shade(0.96) : shade(1);
      g.fillRect(0, y, 256, 64);
      g.fillStyle = shade(0.86);
      g.fillRect(0, y, 256, 2);
      const off = (r * 97) % 256;
      g.fillRect(off, y, 2, 64);
      g.fillRect((off + 128) % 256, y, 2, 64);
      g.globalAlpha = 0.18;
      for (let k = 0; k < 5; k++) {
        g.fillStyle = shade(0.8);
        g.fillRect(((k * 53 + r * 31) % 240) + 8, y + 12 + ((k * 17) % 40), 36, 1.5);
      }
      g.globalAlpha = 1;
    }
  } else if (kind === "tile") {
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        g.fillStyle = (i + j) % 2 ? shade(0.97) : shade(1.02);
        g.fillRect(i * 64 + 1, j * 64 + 1, 62, 62);
      }
    g.fillStyle = shade(0.82);
    for (let k = 0; k <= 4; k++) {
      g.fillRect(k * 64 - 1, 0, 2, 256);
      g.fillRect(0, k * 64 - 1, 256, 2);
    }
  } else if (kind === "carpet") {
    for (let k = 0; k < 900; k++) {
      g.fillStyle = Math.random() > 0.5 ? shade(0.95) : shade(1.04);
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    g.strokeStyle = shade(0.9);
    g.lineWidth = 2;
    g.strokeRect(1, 1, 254, 254);
  } else if (kind === "tech") {
    g.strokeStyle = "rgba(56, 217, 255, 0.28)";
    g.lineWidth = 2;
    for (let k = 0; k <= 4; k++) {
      g.beginPath();
      g.moveTo(k * 64, 0);
      g.lineTo(k * 64, 256);
      g.moveTo(0, k * 64);
      g.lineTo(256, k * 64);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

const FLOOR_STYLE: Record<Room["kind"], string> = {
  hall: "tile",
  corridor: "tile",
  ceo: "wood",
  owner: "wood",
  knowledge: "tech",
  meeting: "carpet",
  pantry: "tile",
  dept: "wood",
  control: "carpet",
  workshop: "tile",
};

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly labels = new CSS2DRenderer();
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 600);
  readonly office = new THREE.Group();
  readonly actorsLayer = new THREE.Group();
  private readonly timer = new THREE.Timer();
  layout!: Layout;

  /** Monitoren per bureau-id, whiteboards per tak, en de grote borden. */
  readonly monitors = new Map<string, CanvasScreen>();
  readonly whiteboards = new Map<string, CanvasScreen>();
  kanban: CanvasScreen | null = null;
  readonly videoWall: CanvasScreen[] = [];
  kpiScreen: CanvasScreen | null = null;
  /** Werkplaats: een bord per project (sleutel → scherm). */
  readonly codeBoards = new Map<string, CanvasScreen>();
  inboxPapers: THREE.Group | null = null;
  hologramAnchor = new THREE.Vector3();
  readonly roomLabels = new Map<string, HTMLElement>();
  readonly deskLamps = new Map<string, THREE.Mesh>();

  onPick: ((pick: Pick | null, ev: PointerEvent | MouseEvent) => void) | null = null;
  onHover: ((pick: Pick | null) => void) | null = null;

  private readonly pickables: Array<{ object: THREE.Object3D; pick: Pick }> = [];
  private readonly walls: WallMesh[] = [];
  private readonly updaters = new Set<(dt: number, t: number) => void>();
  private readonly target = new THREE.Vector3();
  private yaw = Math.PI / 4;
  private yawGoal = Math.PI / 4;
  private zoom = 1;
  private zoomGoal = 1;
  private targetGoal: THREE.Vector3 | null = null;
  private viewHeight = 30;
  private lastWallYaw = Number.NaN;
  private readonly sun = new THREE.DirectionalLight("#fff4e6", 2.1);
  private readonly hemi = new THREE.HemisphereLight("#ffffff", "#aab3c5", 1.75);
  private readonly raycaster = new THREE.Raycaster();
  private alarm = 0;
  private readonly alarmLight = new THREE.PointLight("#ff3b3b", 0, 0, 1.4);

  constructor(
    private readonly container: HTMLElement,
    private readonly assets: Assets,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = "office-canvas";
    container.appendChild(this.renderer.domElement);
    this.labels.domElement.className = "office-labels";
    container.appendChild(this.labels.domElement);

    this.scene.add(this.hemi);
    this.sun.castShadow = true;
    const mobile = Math.min(window.innerWidth, window.innerHeight) < 600;
    this.sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.alarmLight);
    this.scene.add(this.office, this.actorsLayer);
    this.bindControls();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  addUpdater(fn: (dt: number, t: number) => void): () => void {
    this.updaters.add(fn);
    return () => this.updaters.delete(fn);
  }

  registerPick(object: THREE.Object3D, pick: Pick): void {
    this.pickables.push({ object, pick });
  }

  unregisterPick(object: THREE.Object3D): void {
    const k = this.pickables.findIndex((p) => p.object === object);
    if (k >= 0) this.pickables.splice(k, 1);
  }

  // ---------------------------------------------------------------- opbouw

  build(layout: Layout): void {
    this.layout = layout;
    for (const child of [...this.office.children]) this.office.remove(child);
    this.pickables.splice(0, this.pickables.length, ...this.pickables.filter((p) => p.pick.kind === "agent"));
    this.walls.length = 0;
    this.monitors.clear();
    this.whiteboards.clear();
    this.videoWall.length = 0;
    this.kanban = null;
    this.kpiScreen = null;
    this.codeBoards.clear();
    this.inboxPapers = null;
    for (const el of this.roomLabels.values()) el.remove();
    this.roomLabels.clear();

    // Sokkel onder het hele gebouw: een diorama.
    // Net onder de vloeren (die tot y = -0.08 reiken), anders flikkeren ze door elkaar heen.
    const base = box(layout.width + 0.8, 0.5, layout.depth + 0.8, "#2b3348");
    base.position.set(layout.width / 2, -0.09 - 0.25, layout.depth / 2);
    base.castShadow = false;
    this.office.add(base);

    for (const room of layout.rooms) this.buildFloor(room);
    this.buildWalls(layout);
    for (const f of layout.furniture) {
      try {
        this.buildFurniture(f);
      } catch (err) {
        console.warn("meubel bouwen mislukt", f.type, err);
      }
    }
    for (const room of layout.rooms) this.buildRoomLabel(room);

    // Schaduwen precies om het gebouw.
    const span = Math.max(layout.width, layout.depth);
    this.sun.position.set(layout.width / 2 + span * 0.35, span * 0.9, layout.depth / 2 + span * 0.55);
    this.sun.target.position.set(layout.width / 2, 0, layout.depth / 2);
    const cam = this.sun.shadow.camera;
    cam.left = -span * 0.8;
    cam.right = span * 0.8;
    cam.top = span * 0.8;
    cam.bottom = -span * 0.8;
    cam.near = 1;
    cam.far = span * 3;
    cam.updateProjectionMatrix();
    this.lastWallYaw = Number.NaN;
  }

  private buildFloor(room: Room): void {
    const { x, z, w, d } = room.rect;
    const style = FLOOR_STYLE[room.kind];
    const tinted = room.kind === "dept" || room.kind === "control" || room.kind === "workshop";
    const color = tinted ? room.floor : style === "wood" ? (room.kind === "owner" ? "#e8dcc9" : "#e5d2b3") : room.floor;
    const tex = floorTexture(style, color);
    tex.repeat.set(w / 2, d / 2);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), mat);
    floor.position.set(x + w / 2, -0.04, z + d / 2);
    floor.receiveShadow = true;
    this.office.add(floor);
    if (tinted) {
      // Gekleurde rand langs de binnenkant van de afdeling.
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(w - 0.4, 0.02, 0.12),
        new THREE.MeshStandardMaterial({ color: room.accent, roughness: 0.6 }),
      );
      edge.position.set(x + w / 2, 0.011, z + d - 0.3);
      this.office.add(edge);
    }
    if (room.kind !== "hall" && room.kind !== "corridor") {
      const hit = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ visible: false }));
      hit.rotation.x = -Math.PI / 2;
      hit.position.set(x + w / 2, 0.02, z + d / 2);
      this.office.add(hit);
      this.registerPick(hit, { kind: "room", id: room.id });
    }
  }

  private buildWalls(layout: Layout): void {
    const solid = new THREE.MeshStandardMaterial({ color: "#f3efe8", roughness: 0.9 });
    const outerMat = new THREE.MeshStandardMaterial({ color: "#e9e2d6", roughness: 0.9 });
    const glass = new THREE.MeshStandardMaterial({ color: "#bfe6ff", roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false });
    const cap = new THREE.MeshStandardMaterial({ color: "#c9c1b4", roughness: 0.8 });
    for (const seg of layout.walls) {
      const horizontal = seg.z1 === seg.z2;
      const len = horizontal ? Math.abs(seg.x2 - seg.x1) : Math.abs(seg.z2 - seg.z1);
      if (len <= 0) continue;
      const thick = seg.outer ? 0.2 : seg.glass ? 0.06 : 0.12;
      const geo = new THREE.BoxGeometry(horizontal ? len + thick : thick, 1, horizontal ? thick : len + thick);
      geo.translate(0, 0.5, 0);
      const mesh = new THREE.Mesh(geo, seg.glass ? glass : seg.outer ? outerMat : solid);
      mesh.position.set(horizontal ? (seg.x1 + seg.x2) / 2 : seg.x1, 0, horizontal ? seg.z1 : (seg.z1 + seg.z2) / 2);
      mesh.castShadow = !seg.glass;
      mesh.receiveShadow = true;
      mesh.scale.y = seg.height;
      if (!seg.glass) {
        const top = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? len + thick : thick + 0.02, 0.04, horizontal ? thick + 0.02 : len + thick), cap);
        top.position.y = 1;
        top.scale.y = 1 / Math.max(seg.height, 0.01);
        mesh.add(top);
      }
      this.office.add(mesh);
      let outward: THREE.Vector2 | null = null;
      if (seg.outer) {
        if (horizontal) outward = new THREE.Vector2(0, seg.z1 <= 0.01 ? -1 : 1);
        else outward = new THREE.Vector2(seg.x1 <= 0.01 ? -1 : 1, 0);
      }
      this.walls.push({ mesh, outer: seg.outer, glass: seg.glass, full: seg.outer ? 2.1 : seg.height, outward });
    }
  }

  /** Gevels aan de kant van de camera worden laag, zodat je naar binnen kijkt. */
  private updateCutaway(): void {
    if (Math.abs(this.yaw - this.lastWallYaw) < 0.01) return;
    this.lastWallYaw = this.yaw;
    const view = new THREE.Vector2(Math.sin(this.yaw), Math.cos(this.yaw));
    for (const w of this.walls) {
      if (!w.outer || !w.outward) continue;
      const facing = w.outward.dot(view) > 0.2;
      w.mesh.scale.y = facing ? 0.22 : w.full;
      const top = w.mesh.children[0];
      if (top) top.scale.y = 1 / w.mesh.scale.y;
    }
  }

  private model(name: FurnitureName, f: Furniture, opts: { dx?: number; dz?: number; rot?: number; y?: number; scale?: number } = {}): THREE.Object3D {
    const obj = this.assets.make(name);
    const rot = f.rot + (opts.rot ?? 0);
    const dx = opts.dx ?? 0;
    const dz = opts.dz ?? 0;
    // Verschuiving in het assenstelsel van het meubel.
    obj.position.set(f.x + dx * Math.cos(rot) + dz * Math.sin(rot), opts.y ?? 0, f.z - dx * Math.sin(rot) + dz * Math.cos(rot));
    obj.rotation.y = rot;
    if (opts.scale) obj.scale.setScalar(opts.scale);
    this.office.add(obj);
    return obj;
  }

  private buildFurniture(f: Furniture): void {
    const A = this.assets;
    switch (f.type) {
      case "desk": {
        const desk = this.model("desk", f);
        const top = A.size("desk").y;
        this.model("computerScreen", f, { dz: -0.18, y: top });
        this.model("computerKeyboard", f, { dz: 0.2, y: top });
        this.model("computerMouse", f, { dx: 0.32, dz: 0.2, y: top });
        // Scherm met de taak: iets voor het beeldscherm van het model.
        const screen = new CanvasScreen(0.5, 0.3, 320, { glow: true });
        screen.mesh.position.set(f.x, top + 0.29, f.z - 0.18 + 0.075);
        this.office.add(screen.mesh);
        if (f.ref) this.monitors.set(f.ref, screen);
        if (f.ref && hashNum(f.ref) % 3 === 0) this.model("plantSmall2", f, { dx: -0.42, dz: -0.2, y: top });
        if (f.ref && hashNum(f.ref) % 4 === 1) this.model("lampSquareTable", f, { dx: -0.42, dz: -0.2, y: top });
        if (f.ref) this.registerPick(desk, { kind: "desk", id: f.ref });
        break;
      }
      case "exec-desk": {
        const desk = this.model("desk", f, { rot: Math.PI, scale: 1.25 });
        const top = A.size("desk").y * 1.25;
        this.model("computerScreen", f, { dz: 0.2, y: top, rot: Math.PI });
        this.model("lampRoundTable", f, { dx: -0.9, dz: 0.1, y: top });
        if (f.color) tint(desk, f.color, 0.35);
        if (f.ref === "desk-owner") this.registerPick(desk, { kind: "owner-desk", id: "owner" });
        else if (f.ref) this.registerPick(desk, { kind: "desk", id: f.ref });
        break;
      }
      case "chair":
        this.model(f.roomId === "meeting" ? "chairModernCushion" : "chairDesk", f, { dz: f.roomId === "meeting" ? 0 : -0.08 });
        break;
      case "plant":
        this.model("pottedPlant", f);
        break;
      case "bookshelf": {
        if ((f.w ?? 2) >= 2) {
          this.model("bookcaseClosedWide", f);
          this.model("books", f, { y: A.size("bookcaseClosedWide").y, dx: -0.2 });
          // Boeken op de planken (gemeten: planken op 0,11, 0,50 en 0,88 m), met hier en daar een gat.
          const seed = hashNum(`${f.x}:${f.z}`);
          [0.112, 0.496, 0.88].forEach((y, level) => {
            for (let k = 0; k < 4; k++) {
              if ((seed >> (level * 4 + k)) % 4 === 0) continue;
              this.model("books", f, { dx: -0.45 + k * 0.3, dz: 0.02, y, rot: (((seed >> (k + level)) % 3) - 1) * 0.12 });
            }
          });
        } else {
          this.model("bookcaseOpen", f);
        }
        break;
      }
      case "cabinet":
        this.model("sideTableDrawers", f);
        this.office.add(trophy(f.x, A.size("sideTableDrawers").y, f.z));
        break;
      case "counter": {
        const n = Math.round(f.w ?? 3);
        for (let k = 0; k < n; k++) this.model(k === 2 ? "kitchenSink" : "kitchenCabinet", f, { dx: -n / 2 + 0.5 + k });
        break;
      }
      case "coffee":
        this.model("kitchenCoffeeMachine", f, { y: A.size("kitchenCabinet").y });
        this.model("kitchenMicrowave", f, { dx: 1.1, y: A.size("kitchenCabinet").y });
        break;
      case "fridge":
        this.model("kitchenFridgeLarge", f);
        break;
      case "sofa":
        this.model("loungeSofaLong", f);
        break;
      case "round-table":
        this.model("tableRound", f);
        break;
      case "stool":
        this.model("stoolBar", f);
        break;
      case "water":
        this.office.add(waterCooler(f.x, f.z));
        break;
      case "meeting-table":
        this.office.add(meetingTable(f.x, f.z, f.w ?? 5, f.d ?? 2));
        break;
      case "reception": {
        const r = new THREE.Group();
        const body = box(f.w ?? 3, 0.8, 0.8, "#f7f4ee");
        const strip = box((f.w ?? 3) + 0.02, 0.12, 0.82, "#7c4dff", { y: 0.55 });
        const top = box((f.w ?? 3) + 0.2, 0.06, 1, "#d9cdb8", { y: 0.8 });
        r.add(body, strip, top);
        r.position.set(f.x, 0, f.z);
        this.office.add(r);
        this.model("radio", f, { dx: 0.9, y: 0.86 });
        this.model("plantSmall3", f, { dx: -1.1, y: 0.86 });
        break;
      }
      case "bench":
        this.model("loungeSofa", f, { dx: -0.95 });
        this.model("loungeSofa", f, { dx: 0.95 });
        break;
      case "rug": {
        const rug = new THREE.Mesh(
          new THREE.BoxGeometry(f.w ?? 3, 0.02, f.d ?? 2),
          new THREE.MeshStandardMaterial({ color: f.color ?? "#c9a06a", roughness: 1 }),
        );
        rug.position.set(f.x, 0.012, f.z);
        rug.receiveShadow = true;
        this.office.add(rug);
        break;
      }
      case "terminal": {
        const t = new THREE.Group();
        t.add(box(0.5, 0.9, 0.4, "#2a3550"));
        const screen = new CanvasScreen(0.5, 0.36, 256, { glow: true });
        screen.draw((ctx, w, h) => {
          ctx.fillStyle = "#0b1a2e";
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = "#38d9ff";
          ctx.lineWidth = 3;
          for (let k = 0; k < 7; k++) {
            ctx.beginPath();
            ctx.arc(w * (0.2 + 0.1 * k), h * (0.3 + ((k * 37) % 50) / 100), 6, 0, Math.PI * 2);
            ctx.stroke();
          }
        });
        screen.mesh.position.set(0, 1.05, 0.08);
        screen.mesh.rotation.x = -0.5;
        t.add(screen.mesh);
        t.position.set(f.x, 0, f.z);
        t.rotation.y = f.rot + Math.PI;
        this.office.add(t);
        break;
      }
      case "hologram": {
        const ped = new THREE.Group();
        const baseMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.9, 1.05, 0.35, 40),
          new THREE.MeshStandardMaterial({ color: "#1f2a44", roughness: 0.5, metalness: 0.3 }),
        );
        baseMesh.position.y = 0.175;
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.88, 0.035, 12, 64),
          new THREE.MeshBasicMaterial({ color: "#38d9ff", toneMapped: false }),
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.36;
        ped.add(baseMesh, ring);
        ped.position.set(f.x, 0, f.z);
        this.office.add(ped);
        this.hologramAnchor.set(f.x, 1.9, f.z);
        const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 3.2, 12), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.set(f.x, 1.6, f.z);
        this.office.add(hit);
        this.registerPick(hit, { kind: "hologram", id: "graphify" });
        break;
      }
      case "whiteboard": {
        const wb = whiteboardStand(f.w ?? 3);
        wb.group.position.set(f.x, 0, f.z);
        wb.group.rotation.y = f.rot;
        this.office.add(wb.group);
        if (f.ref) this.whiteboards.set(f.ref, wb.screen);
        if (f.ref) this.registerPick(wb.group, { kind: "whiteboard", id: f.ref });
        break;
      }
      case "kanban": {
        const w = f.w ?? 5;
        const s = new CanvasScreen(w, 1.5, 200, {});
        s.mesh.position.set(f.x, 1.35, f.z + 0.02);
        const frame = box(w + 0.12, 1.62, 0.06, "#4b3f33", { y: 0.54 });
        frame.position.set(f.x, 0.54, f.z - 0.02);
        this.office.add(frame, s.mesh);
        this.kanban = s;
        this.registerPick(s.mesh, { kind: "kanban", id: "projects" });
        this.registerPick(frame, { kind: "kanban", id: "projects" });
        break;
      }
      case "video-wall": {
        const w = f.w ?? 6;
        const n = w >= 5 ? 3 : 2;
        const sw = (w - 0.2 * (n - 1)) / n;
        const group = new THREE.Group();
        for (let k = 0; k < n; k++) {
          const s = new CanvasScreen(sw, 1.25, 220, { glow: true });
          s.mesh.position.set(-w / 2 + sw / 2 + k * (sw + 0.2), 1.5, 0.09);
          const bezel = box(sw + 0.1, 1.35, 0.08, "#161b27", { y: 0.825 });
          bezel.position.set(s.mesh.position.x, 0.825, 0.02);
          group.add(bezel, s.mesh);
          this.videoWall.push(s);
          this.registerPick(s.mesh, { kind: "video-wall", id: "stats" });
        }
        const console = box(w * 0.8, 0.75, 0.45, "#2c3447", { y: 0 });
        console.position.set(0, 0.375, 0.1);
        group.add(console);
        group.position.set(f.x, 0, f.z);
        this.office.add(group);
        this.registerPick(console, { kind: "video-wall", id: "stats" });
        break;
      }
      case "vault": {
        const v = vault();
        v.position.set(f.x, 0, f.z);
        v.rotation.y = f.rot;
        this.office.add(v);
        this.registerPick(v, { kind: "vault", id: "ledger" });
        break;
      }
      case "red-button": {
        const b = redButton();
        b.position.set(f.x, 0, f.z);
        this.office.add(b);
        this.registerPick(b, { kind: "red-button", id: "halt" });
        break;
      }
      case "inbox": {
        const tray = new THREE.Group();
        const y = A.size("desk").y * 1.25;
        const bottom = box(0.42, 0.03, 0.32, "#6b5a45", { y });
        tray.add(bottom);
        const papers = new THREE.Group();
        papers.position.y = y + 0.03;
        tray.add(papers);
        tray.position.set(f.x, 0, f.z);
        this.office.add(tray);
        this.inboxPapers = papers;
        break;
      }
      case "code-board": {
        // Een scherm op een voet: de stand van één project (live, tests, uitrol, wat op jou wacht).
        const w = f.w ?? 2.8;
        const s = new CanvasScreen(w, 1.45, 210, { glow: true });
        s.mesh.position.set(f.x, 1.5, f.z + 0.1);
        const bezel = box(w + 0.1, 1.55, 0.06, "#161b27", { y: 0.72 });
        bezel.position.set(f.x, 0.72, f.z + 0.05);
        const foot = box(0.5, 0.72, 0.22, "#2c3447", { y: 0 });
        foot.position.set(f.x, 0.36, f.z);
        this.office.add(foot, bezel, s.mesh);
        if (f.ref) {
          this.codeBoards.set(f.ref, s);
          for (const o of [s.mesh, bezel, foot]) this.registerPick(o, { kind: "code-project", id: f.ref });
        }
        break;
      }
      case "screen": {
        const s = new CanvasScreen(f.w ?? 2.6, 1.3, 200, { glow: true });
        s.mesh.position.set(f.x, 1.55, f.z + 0.12);
        const bezel = box((f.w ?? 2.6) + 0.1, 1.4, 0.06, "#161b27", { y: 0.85 });
        bezel.position.set(f.x, 0.85, f.z + 0.06);
        this.office.add(bezel, s.mesh);
        if (f.label === "kpi") this.kpiScreen = s;
        this.registerPick(s.mesh, { kind: "video-wall", id: "stats" });
        break;
      }
      case "sign": {
        const w = f.w ?? 2.6;
        if (f.label === "logo") {
          const s = new CanvasScreen(w, 0.9, 200, {});
          s.draw((ctx, cw, ch) => {
            roundRect(ctx, 4, 4, cw - 8, ch - 8, 18);
            ctx.fillStyle = "#1f2537";
            ctx.fill();
            ctx.fillStyle = "#ffffff";
            ctx.font = `800 ${ch * 0.36}px ${FONT}`;
            ctx.textAlign = "center";
            ctx.fillText("🏢 HQ", cw / 2, ch * 0.5);
            ctx.font = `500 ${ch * 0.17}px ${FONT}`;
            ctx.fillStyle = "#b9c3dc";
            ctx.fillText("AI-holding", cw / 2, ch * 0.77);
          });
          s.mesh.position.set(f.x, 1.55, f.z + 0.12);
          this.office.add(s.mesh);
        } else {
          const s = new CanvasScreen(w, 0.5, 220, {});
          drawSign(s, f.label ?? "", f.color ?? "#5b6b86");
          s.mesh.position.set(f.x, 1.65, f.z + 0.12);
          this.office.add(s.mesh);
        }
        break;
      }
      case "window": {
        const pane = new THREE.Mesh(
          new THREE.PlaneGeometry(f.w ?? 1.6, 1.0),
          new THREE.MeshBasicMaterial({ color: "#a9d8ff", toneMapped: false }),
        );
        pane.position.set(f.x, 1.25, f.z + 0.115);
        pane.name = "window";
        const frame = box((f.w ?? 1.6) + 0.12, 1.12, 0.04, "#ffffff", { y: 0.69 });
        frame.position.set(f.x, 0.69, f.z + 0.1);
        const bar = box(0.04, 1.0, 0.03, "#ffffff", { y: 0.75 });
        bar.position.set(f.x, 0.75, f.z + 0.125);
        this.office.add(frame, pane, bar);
        break;
      }
      case "entrance": {
        this.model("rugDoormat", f, { dx: 0, dz: 0.8, rot: 0 });
        const frameMat = "#5b4a3a";
        const top = box(0.3, 0.12, 3.1, frameMat, { y: 2.0 });
        top.position.set(0, 2.06, f.z);
        const l = box(0.3, 2.1, 0.12, frameMat);
        l.position.set(0, 1.05, f.z - 1.5);
        const r = box(0.3, 2.1, 0.12, frameMat);
        r.position.set(0, 1.05, f.z + 1.5);
        this.office.add(top, l, r);
        break;
      }
      default:
        break;
    }
  }

  private buildRoomLabel(room: Room): void {
    if (room.kind === "corridor") return;
    const el = document.createElement("div");
    el.className = `room-label room-${room.kind}`;
    el.style.setProperty("--accent", room.accent);
    el.innerHTML = `<span class="rl-name"></span><span class="rl-status"></span>`;
    el.querySelector(".rl-name")!.textContent = room.kind === "hall" ? "Receptie" : room.name;
    const obj = new CSS2DObject(el);
    const { x, z, w } = room.rect;
    obj.position.set(room.kind === "hall" ? x + w / 2 : x + w / 2, room.kind === "hall" ? 2.6 : 2.7, room.kind === "hall" ? 3.2 : z + 0.6);
    obj.center.set(0.5, 1);
    this.office.add(obj);
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.onPick?.({ kind: "room", id: room.id }, ev);
    });
    this.roomLabels.set(room.id, el);
  }

  setRoomStatus(roomId: string, status: string, busy: boolean): void {
    const el = this.roomLabels.get(roomId);
    if (!el) return;
    const s = el.querySelector(".rl-status")!;
    if (s.textContent !== status) s.textContent = status;
    el.classList.toggle("busy", busy);
  }

  /** Papieren op jouw bureau: één per openstaand verzoek (max 12 zichtbaar). */
  setInbox(count: number): void {
    const p = this.inboxPapers;
    if (!p) return;
    const want = Math.min(count, 12);
    while (p.children.length < want) {
      const k = p.children.length;
      const sheet = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.012, 0.26),
        new THREE.MeshStandardMaterial({ color: k % 3 === 2 ? "#fff3c4" : "#ffffff", roughness: 0.9 }),
      );
      sheet.position.set((Math.random() - 0.5) * 0.03, k * 0.016, (Math.random() - 0.5) * 0.03);
      sheet.rotation.y = (Math.random() - 0.5) * 0.25;
      sheet.castShadow = true;
      p.add(sheet);
    }
    while (p.children.length > want) p.remove(p.children[p.children.length - 1]!);
  }

  setAlarm(on: boolean): void {
    this.alarm = on ? 1 : 0;
  }

  setNight(night: boolean): void {
    this.hemi.intensity = night ? 0.9 : 1.75;
    this.hemi.color.set(night ? "#9fb2ff" : "#ffffff");
    this.sun.intensity = night ? 0.7 : 2.1;
    this.sun.color.set(night ? "#b8c6ff" : "#fff4e6");
    this.office.traverse((o) => {
      if (o.name === "window") ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(night ? "#27365f" : "#a9d8ff");
    });
  }

  // ---------------------------------------------------------------- camera

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.labels.setSize(w, h);
    this.applyCamera();
  }

  private applyCamera(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const aspect = w / Math.max(h, 1);
    const vh = this.viewHeight / this.zoom;
    this.camera.left = (-vh * aspect) / 2;
    this.camera.right = (vh * aspect) / 2;
    this.camera.top = vh / 2;
    this.camera.bottom = -vh / 2;
    const dist = 120;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * Math.cos(PITCH) * dist,
      this.target.y + Math.sin(PITCH) * dist,
      this.target.z + Math.cos(this.yaw) * Math.cos(PITCH) * dist,
    );
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Hele gebouw in beeld (of een deel ervan), binnen het stuk scherm dat niet onder de
   * bovenbalk, het logboek of een open paneel zit (insets, in pixels).
   */
  fit(rect?: { x: number; z: number; w: number; d: number }, animate = false): void {
    const r = rect ?? { x: 0, z: 0, w: this.layout.width, d: this.layout.depth };
    const center = new THREE.Vector3(r.x + r.w / 2, 0, r.z + r.d / 2);
    const saved = { target: this.target.clone(), zoom: this.zoom };
    this.target.copy(center);
    this.zoom = 1;
    this.applyCamera();
    this.camera.updateMatrixWorld(true);
    const inv = this.camera.matrixWorldInverse;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [px, pz] of [
      [r.x, r.z],
      [r.x + r.w, r.z],
      [r.x, r.z + r.d],
      [r.x + r.w, r.z + r.d],
    ] as const) {
      for (const py of [0, 2.2]) {
        const v = new THREE.Vector3(px, py, pz).applyMatrix4(inv);
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
      }
    }
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const ins = this.insets;
    const freeW = Math.max(120, w - ins.left - ins.right);
    const freeH = Math.max(120, h - ins.top - ins.bottom);
    // Zoom zo dat de breedte en de hoogte van het gebouw in het vrije stuk passen.
    const zoom = THREE.MathUtils.clamp(
      Math.min((this.viewHeight * freeH) / (h * (maxY - minY)), (this.viewHeight * freeW) / (h * (maxX - minX))) / 1.04,
      MIN_ZOOM,
      6,
    );
    const upp = this.viewHeight / zoom / h;
    const goal = this.shifted(center, (minX + maxX) / 2 - ((ins.left - ins.right) / 2) * upp, (minY + maxY) / 2 + ((ins.top - ins.bottom) / 2) * upp);
    if (animate) {
      this.target.copy(saved.target);
      this.zoom = saved.zoom;
      this.targetGoal = goal;
      this.zoomGoal = zoom;
    } else {
      this.target.copy(goal);
      this.zoom = this.zoomGoal = zoom;
      this.targetGoal = null;
    }
    this.applyCamera();
  }

  /** Vrije ruimte rond het beeld (pixels) die de bovenbalk, knoppen en panelen innemen. */
  readonly insets = { top: 76, right: 12, bottom: 64, left: 12 };

  /** Een punt op de vloer, verschoven met (vx, vy) in beeldrichting (rechts, omhoog). */
  private shifted(p: THREE.Vector3, vx: number, vy: number): THREE.Vector3 {
    const right = new THREE.Vector3(Math.cos(this.yawGoal), 0, -Math.sin(this.yawGoal));
    const forward = new THREE.Vector3(-Math.sin(this.yawGoal), 0, -Math.cos(this.yawGoal));
    return p.clone().addScaledVector(right, vx).addScaledVector(forward, vy / Math.sin(PITCH));
  }

  /** Camera naar een punt (midden van het vrije stuk scherm), eventueel iets inzoomen. */
  focus(x: number, z: number, zoom?: number): void {
    if (zoom) this.zoomGoal = Math.max(this.zoomGoal, zoom);
    const h = this.container.clientHeight || window.innerHeight;
    const upp = this.viewHeight / this.zoomGoal / h;
    const ins = this.insets;
    this.targetGoal = this.shifted(new THREE.Vector3(x, 0, z), -((ins.left - ins.right) / 2) * upp, ((ins.top - ins.bottom) / 2) * upp);
  }

  rotate(steps: number): void {
    this.yawGoal += (steps * Math.PI) / 2;
  }

  zoomBy(f: number): void {
    this.zoomGoal = THREE.MathUtils.clamp(this.zoomGoal * f, MIN_ZOOM, 6);
  }

  /** Schermpositie (pixels) van een punt in het kantoor. */
  screenOf(x: number, y: number, z: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  get zoomLevel(): number {
    return this.zoom;
  }

  /** Wereldpositie op de vloer onder een schermpunt. */
  private groundAt(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, hit) ? hit : null;
  }

  pickAt(clientX: number, clientY: number): Pick | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const objects = this.pickables.map((p) => p.object);
    const hits = this.raycaster.intersectObjects(objects, true);
    const order: PickKind[] = ["agent", "red-button", "vault", "video-wall", "kanban", "hologram", "owner-desk", "code-project", "whiteboard", "desk", "room"];
    let best: Pick | null = null;
    let bestRank = Infinity;
    let bestDist = Infinity;
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      let entry: { object: THREE.Object3D; pick: Pick } | undefined;
      while (o && !entry) {
        entry = this.pickables.find((p) => p.object === o);
        o = o.parent;
      }
      if (!entry) continue;
      const rank = order.indexOf(entry.pick.kind);
      if (rank < bestRank || (rank === bestRank && hit.distance < bestDist)) {
        best = entry.pick;
        bestRank = rank;
        bestDist = hit.distance;
      }
    }
    return best;
  }

  private bindControls(): void {
    const el = this.renderer.domElement;
    el.style.touchAction = "none";
    const pointers = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number; t: number } | null = null;
    let moved = 0;
    let pinch: { dist: number; angle: number; zoom: number; yaw: number } | null = null;
    let rotating = false;

    const panBy = (dx: number, dy: number) => {
      const h = this.container.clientHeight || window.innerHeight;
      const perPx = this.viewHeight / this.zoom / h;
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this.target.addScaledVector(right, -dx * perPx);
      this.target.addScaledVector(forward, (dy * perPx) / Math.sin(PITCH));
      this.targetGoal = null;
      this.clampTarget();
    };

    el.addEventListener("pointerdown", (ev) => {
      el.setPointerCapture(ev.pointerId);
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pointers.size === 1) {
        start = { x: ev.clientX, y: ev.clientY, t: performance.now() };
        moved = 0;
        rotating = ev.button === 2 || ev.shiftKey;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), angle: Math.atan2(b!.y - a!.y, b!.x - a!.x), zoom: this.zoom, yaw: this.yaw };
      }
    });
    el.addEventListener("pointermove", (ev) => {
      const prev = pointers.get(ev.pointerId);
      if (!prev) {
        if (ev.pointerType === "mouse") this.hoverAt(ev.clientX, ev.clientY);
        return;
      }
      const dx = ev.clientX - prev.x;
      const dy = ev.clientY - prev.y;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      moved += Math.abs(dx) + Math.abs(dy);
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const angle = Math.atan2(b!.y - a!.y, b!.x - a!.x);
        this.zoom = this.zoomGoal = THREE.MathUtils.clamp((pinch.zoom * dist) / Math.max(pinch.dist, 1), MIN_ZOOM, 6);
        this.yaw = this.yawGoal = pinch.yaw - (angle - pinch.angle);
        return;
      }
      if (rotating) {
        this.yaw -= dx * 0.008;
        this.yawGoal = this.yaw;
        return;
      }
      panBy(dx, dy);
    });
    const end = (ev: PointerEvent) => {
      const wasSingle = pointers.size === 1;
      pointers.delete(ev.pointerId);
      if (pointers.size < 2) pinch = null;
      if (wasSingle && start && moved < 8 && performance.now() - start.t < 600) {
        this.onPick?.(this.pickAt(ev.clientX, ev.clientY), ev);
      }
      if (rotating && pointers.size === 0) {
        // Klik naar het dichtstbijzijnde kwartslag.
        this.yawGoal = Math.round((this.yaw - Math.PI / 4) / (Math.PI / 2)) * (Math.PI / 2) + Math.PI / 4;
        rotating = false;
      }
      if (pointers.size === 0) start = null;
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("contextmenu", (ev) => ev.preventDefault());
    el.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        const before = this.groundAt(ev.clientX, ev.clientY);
        const factor = Math.exp(-ev.deltaY * 0.0015);
        this.zoom = this.zoomGoal = THREE.MathUtils.clamp(this.zoom * factor, MIN_ZOOM, 6);
        this.applyCamera();
        const after = this.groundAt(ev.clientX, ev.clientY);
        if (before && after) {
          this.target.add(before.sub(after));
          this.targetGoal = null;
          this.clampTarget();
        }
      },
      { passive: false },
    );
    window.addEventListener("keydown", (ev) => {
      if ((ev.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      const step = 40;
      if (ev.key === "ArrowLeft") panBy(step, 0);
      else if (ev.key === "ArrowRight") panBy(-step, 0);
      else if (ev.key === "ArrowUp") panBy(0, step);
      else if (ev.key === "ArrowDown") panBy(0, -step);
      else if (ev.key === "+" || ev.key === "=") this.zoomBy(1.25);
      else if (ev.key === "-") this.zoomBy(0.8);
      else if (ev.key === "q" || ev.key === "Q") this.rotate(-1);
      else if (ev.key === "e" || ev.key === "E") this.rotate(1);
      else return;
      ev.preventDefault();
    });
  }

  private hoverAt(x: number, y: number): void {
    const pick = this.pickAt(x, y);
    const clickable = pick && pick.kind !== "room";
    this.renderer.domElement.style.cursor = clickable ? "pointer" : "grab";
    this.onHover?.(clickable ? pick : null);
  }

  private clampTarget(): void {
    if (!this.layout) return;
    this.target.x = THREE.MathUtils.clamp(this.target.x, -2, this.layout.width + 2);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -2, this.layout.depth + 2);
  }

  // ---------------------------------------------------------------- lus

  start(): void {
    this.timer.connect(document);
    const loop = (now: number) => {
      this.timer.update(now);
      const dt = Math.min(this.timer.getDelta(), 0.1);
      const t = this.timer.getElapsed();
      this.yaw += (this.yawGoal - this.yaw) * Math.min(1, dt * 8);
      this.zoom += (this.zoomGoal - this.zoom) * Math.min(1, dt * 8);
      if (this.targetGoal) {
        this.target.lerp(this.targetGoal, Math.min(1, dt * 5));
        if (this.target.distanceTo(this.targetGoal) < 0.01) this.targetGoal = null;
      }
      this.applyCamera();
      this.updateCutaway();
      if (this.alarm) {
        this.alarmLight.intensity = 30 + Math.sin(t * 6) * 25;
        this.alarmLight.position.set(this.target.x, 6, this.target.z);
      } else {
        this.alarmLight.intensity = 0;
      }
      for (const fn of this.updaters) fn(dt, t);
      this.renderer.render(this.scene, this.camera);
      this.labels.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

// ---------------------------------------------------------------- losse objecten

function hashNum(s: string): number {
  let h = 0;
  for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) >>> 0;
  return h;
}

function tint(obj: THREE.Object3D, color: string, amount: number): void {
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m && "color" in m) {
      const copy = m.clone();
      copy.color.lerp(new THREE.Color(color), amount);
      (o as THREE.Mesh).material = copy;
    }
  });
}

function trophy(x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: "#e8b93a", roughness: 0.35, metalness: 0.6 });
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.06, 0.2, 16), gold);
  cup.position.y = 0.2;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.1, 8), gold);
  stem.position.y = 0.08;
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.16), new THREE.MeshStandardMaterial({ color: "#3b2f25" }));
  foot.position.y = 0.02;
  g.add(cup, stem, foot);
  g.position.set(x, y, z);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function waterCooler(x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const body = box(0.4, 0.85, 0.4, "#f2f4f7");
  const bottle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.16, 0.45, 20),
    new THREE.MeshStandardMaterial({ color: "#7cc4ff", transparent: true, opacity: 0.75, roughness: 0.2 }),
  );
  bottle.position.y = 1.08;
  g.add(body, bottle);
  g.position.set(x, 0, z);
  return g;
}

function meetingTable(x: number, z: number, w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const top = box(w - 0.3, 0.08, d - 0.3, "#b98b5e", { y: 0.62, rough: 0.6 });
  g.add(top);
  for (const [lx, lz] of [
    [-w / 2 + 0.4, -d / 2 + 0.4],
    [w / 2 - 0.4, -d / 2 + 0.4],
    [-w / 2 + 0.4, d / 2 - 0.4],
    [w / 2 - 0.4, d / 2 - 0.4],
  ] as const) {
    const leg = box(0.08, 0.62, 0.08, "#5a4633");
    leg.position.set(lx, 0.31, lz);
    g.add(leg);
  }
  // Laptops en een telefoon in het midden.
  const phone = box(0.4, 0.05, 0.4, "#2a2f3a", { y: 0.7 });
  g.add(phone);
  g.position.set(x, 0, z);
  return g;
}

function whiteboardStand(w: number): { group: THREE.Group; screen: CanvasScreen } {
  const group = new THREE.Group();
  const screen = new CanvasScreen(w, 1.2, 200, {});
  screen.mesh.position.set(0, 1.35, 0.05);
  const frame = box(w + 0.1, 1.3, 0.05, "#c9ced8", { y: 0.7 });
  frame.position.z = 0.0;
  const legL = box(0.06, 0.8, 0.3, "#8a93a6");
  legL.position.set(-w / 2 + 0.1, 0.4, 0);
  const legR = box(0.06, 0.8, 0.3, "#8a93a6");
  legR.position.set(w / 2 - 0.1, 0.4, 0);
  group.add(frame, screen.mesh, legL, legR);
  return { group, screen };
}

function vault(): THREE.Group {
  const g = new THREE.Group();
  const body = box(0.9, 1.05, 0.8, "#4a5163", { rough: 0.45 });
  const door = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 0.06, 32),
    new THREE.MeshStandardMaterial({ color: "#c0c7d4", roughness: 0.3, metalness: 0.7 }),
  );
  door.rotation.x = Math.PI / 2;
  door.position.set(0, 0.55, 0.42);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 8, 24), new THREE.MeshStandardMaterial({ color: "#e8b93a", metalness: 0.6, roughness: 0.3 }));
  handle.position.set(0, 0.55, 0.47);
  const coin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, 0.03, 20),
    new THREE.MeshStandardMaterial({ color: "#f5c542", metalness: 0.7, roughness: 0.3 }),
  );
  coin.position.set(0.2, 1.08, 0);
  g.add(body, door, handle, coin);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function redButton(): THREE.Group {
  const g = new THREE.Group();
  const post = box(0.35, 0.95, 0.35, "#2a2f3a");
  const btn = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.18, 0.1, 24),
    new THREE.MeshStandardMaterial({ color: "#e0342f", emissive: "#6b0f0c", roughness: 0.35 }),
  );
  btn.position.y = 1.0;
  btn.name = "red-button-cap";
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.22, 0.42),
    new THREE.MeshStandardMaterial({ color: "#d6f0ff", transparent: true, opacity: 0.25, roughness: 0.1 }),
  );
  glass.position.y = 1.06;
  const stripes = box(0.36, 0.08, 0.36, "#f5c542", { y: 0.2 });
  g.add(post, stripes, btn, glass);
  return g;
}
