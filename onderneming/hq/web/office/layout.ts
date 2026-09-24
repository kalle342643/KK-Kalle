/**
 * De plattegrond van het kantoor, uitgerekend uit de takken en agents.
 * Bovenste rij: directie, kennisbank (Graphify), vergaderzaal, koffiehoek en jouw kantoor.
 * Daaronder de afdelingen (één per tak), met aan de westkant de hal met receptie en ingang.
 * Het kantoor groeit mee: meer agents → grotere afdelingen, meer takken → extra rijen.
 * Geen three.js hier: alleen getallen, zodat het te testen is.
 */
import { addWall, blockRect, createGrid, removeWall, type Grid } from "./path.js";

/** Vaste ids voor jou en de HQ-bot (geen Paperclip-agents, wel poppetjes in het kantoor). */
export const OWNER_ID = "owner";
export const BOT_ID = "hq-bot";

export type RoomKind = "hall" | "corridor" | "ceo" | "knowledge" | "meeting" | "pantry" | "owner" | "dept" | "control" | "workshop";

/** De werkplaats: waar Claude Code-sessies aan je projecten werken. */
export const WORKSHOP_SLUG = "werkplaats";

export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** Positie plus kijkrichting. facing = draaiing om de y-as; 0 kijkt naar +z (zuid, richting de camera). */
export interface Spot {
  x: number;
  z: number;
  facing: number;
  /** Zithoogte als je hier gaat zitten (standaard een bureaustoel). */
  y?: number;
}

/** Zithoogtes van de Kenney-meubels (gemeten, na schaal). */
export const SEAT = { chair: 0.374, meeting: 0.384, sofa: 0.368, stool: 0.696 } as const;

export interface Room {
  id: string;
  kind: RoomKind;
  name: string;
  rect: Rect;
  floor: string;
  accent: string;
  branch: string | null;
  door: { x: number; z: number; w: number } | null;
  glass: boolean;
}

export interface Desk {
  id: string;
  roomId: string;
  kind: "desk" | "exec" | "owner";
  x: number;
  z: number;
  width: number;
  seat: Spot;
  /** Waar een collega gaat staan om met je te praten (voor je bureau). */
  visitor: Spot;
  agentId: string | null;
  lead: boolean;
}

export type PoiKind =
  | "coffee"
  | "water"
  | "sofa"
  | "window"
  | "shelf"
  | "terminal"
  | "meeting-seat"
  | "visitor"
  | "bench"
  | "whiteboard"
  | "entrance"
  | "stool"
  | "hologram";

export interface Poi {
  id: string;
  kind: PoiKind;
  roomId: string;
  spot: Spot;
  /** Zitplek op een meubel (bank, stoel): de laatste stap mag over een geblokkeerde cel. */
  seated?: boolean;
}

export type FurnitureType =
  | "desk"
  | "exec-desk"
  | "chair"
  | "plant"
  | "bookshelf"
  | "whiteboard"
  | "screen"
  | "counter"
  | "coffee"
  | "fridge"
  | "water"
  | "sofa"
  | "round-table"
  | "stool"
  | "meeting-table"
  | "reception"
  | "bench"
  | "hologram"
  | "terminal"
  | "rug"
  | "red-button"
  | "inbox"
  | "sign"
  | "window"
  | "entrance"
  | "cabinet"
  | "lamp"
  | "kanban"
  | "vault"
  | "video-wall"
  | "code-board";

export interface Furniture {
  type: FurnitureType;
  x: number;
  z: number;
  rot: number;
  w?: number;
  d?: number;
  color?: string;
  roomId: string;
  /** Extra informatie: bureau-id, tak, tekst op een bord. */
  ref?: string;
  label?: string;
}

export interface WallSeg {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  height: number;
  glass: boolean;
  outer: boolean;
}

export interface Layout {
  width: number;
  depth: number;
  grid: Grid;
  rooms: Room[];
  desks: Desk[];
  pois: Poi[];
  furniture: Furniture[];
  walls: WallSeg[];
  /** agentId → bureau-id */
  deskOf: Map<string, string>;
  /** tak-slug → kamer-id */
  roomOfBranch: Map<string, string>;
  /** Wachtende sollicitanten → bankplek (poi-id) */
  benchOf: Map<string, string>;
  entrance: Spot;
}

export interface LayoutAgent {
  id: string;
  name: string;
  branch: string;
  hqRole: string | null;
  template: string | null;
  role: string;
  status: string;
}

export interface LayoutBranch {
  slug: string;
  name: string;
  template: string | null;
}

/** Wat de werkplaats nodig heeft: één bord per project en genoeg bureaus voor de sessies. */
export interface LayoutWorkshop {
  projects: Array<{ key: string; name: string }>;
  /** Aantal bureaus (de regisseur zet de sessies erop). */
  seats: number;
}

/** Bureaus in de werkplaats: in stappen van 3, zodat niet elke nieuwe sessie een verbouwing is. */
export const workshopSeats = (sessions: number) => Math.max(3, Math.ceil((sessions + 1) / 3) * 3);

/** Kleuren per soort tak (vloer licht, accent verzadigd). */
export const DEPT_COLORS: Record<string, { floor: string; accent: string }> = {
  games: { floor: "#ebe4fb", accent: "#8b5cf6" },
  content: { floor: "#e1f3e8", accent: "#1f9d63" },
  saas: { floor: "#e2ecfb", accent: "#2f7ff0" },
  generiek: { floor: "#fbeddd", accent: "#e0781f" },
  holding: { floor: "#f2ebe3", accent: "#a47551" },
  werkplaats: { floor: "#f6ebe3", accent: "#d97757" },
};
const EXTRA_COLORS = [
  { floor: "#fbe3ea", accent: "#e0457b" },
  { floor: "#dff4f4", accent: "#129a9a" },
  { floor: "#f4f1d9", accent: "#b59a12" },
  { floor: "#e6e8f4", accent: "#5b63b7" },
];

export function deptColor(template: string | null, index: number): { floor: string; accent: string } {
  return (template && DEPT_COLORS[template]) || EXTRA_COLORS[index % EXTRA_COLORS.length]!;
}

const HALL_W = 8;
const ROW_A_D = 8;
const CORRIDOR_D = 3;
const WALL_H = 0.62;
const OUTER_H = 1.05;
const GLASS_H = 1.25;

const isLead = (a: LayoutAgent) => a.hqRole === "lead" || a.template === "tak-lead";

export function buildLayout(input: { branches: LayoutBranch[]; agents: LayoutAgent[]; ownerName?: string; workshop?: LayoutWorkshop }): Layout {
  const agents = input.agents.filter((a) => a.status !== "terminated");
  const pending = agents.filter((a) => a.status === "pending_approval");
  const staff = agents.filter((a) => a.status !== "pending_approval");
  const ceo = staff.find((a) => a.hqRole === "ceo") ?? staff.find((a) => a.role === "ceo") ?? null;
  const branchSlugs = new Set(input.branches.map((b) => b.slug));

  // Wie zit waar: per tak, de rest (en de analist) bij de staf.
  const members = new Map<string, LayoutAgent[]>();
  for (const a of staff) {
    if (a === ceo) continue;
    const slug = a.branch !== "holding" && branchSlugs.has(a.branch) ? a.branch : "holding";
    members.set(slug, [...(members.get(slug) ?? []), a]);
  }
  const depts: Array<LayoutBranch & { index: number }> = [
    { slug: "holding", name: "Controlekamer", template: "holding", index: 0 },
    ...input.branches.filter((b) => b.slug !== "holding").map((b, k) => ({ ...b, index: k + 1 })),
  ];

  const workshop = input.workshop && (input.workshop.projects.length || input.workshop.seats > 0) ? input.workshop : null;
  if (workshop) depts.push({ slug: WORKSHOP_SLUG, name: "Werkplaats · Claude Code", template: WORKSHOP_SLUG, index: depts.length });

  const deptSpecs = depts.map((b) => {
    if (b.slug === WORKSHOP_SLUG) {
      const seats = Math.max(3, workshop!.seats);
      const cols = 3;
      const rows = Math.ceil(seats / cols);
      // Breed genoeg voor een bord per project aan de noordmuur.
      const w = Math.max(11, 3 * cols + 2, Math.ceil(6.4 + workshop!.projects.length * 3.2));
      return { branch: b, list: [] as LayoutAgent[], cols, rows, w, d: 3 * rows + 4 };
    }
    const list = [...(members.get(b.slug) ?? [])].sort(
      (x, y) =>
        Number(y.hqRole === "analyst") - Number(x.hqRole === "analyst") ||
        Number(isLead(y)) - Number(isLead(x)) ||
        x.name.localeCompare(y.name),
    );
    // In de controlekamer zit ook de HQ-bot (die jou de berichten stuurt).
    if (b.slug === "holding") list.unshift({ id: BOT_ID, name: "HQ-bot", branch: "holding", hqRole: "bot", template: null, role: "bot", status: "idle" });
    const seats = Math.max(2, list.length + 1); // altijd een vrij bureau voor een nieuwe collega
    const cols = Math.min(8, Math.max(2, Math.ceil(Math.sqrt(seats * 1.4))));
    const rows = Math.ceil(seats / cols);
    return { branch: b, list, cols, rows, w: Math.max(10, 3 * cols + 2), d: 3 * rows + 3 };
  });

  const special: Array<{ kind: RoomKind; name: string; w: number }> = [
    { kind: "ceo", name: "Directie", w: 9 },
    { kind: "knowledge", name: "Kennisbank · Graphify", w: 12 },
    { kind: "meeting", name: "Vergaderzaal", w: 9 },
    { kind: "pantry", name: "Koffiehoek", w: 8 },
    { kind: "owner", name: input.ownerName ? `Kantoor van ${input.ownerName}` : "Jouw kantoor", w: 9 },
  ];
  const rowAW = special.reduce((s, r) => s + r.w, 0);
  const deptW = deptSpecs.reduce((s, d) => s + d.w, 0);

  // Afdelingen in rijen verdelen, zo dat de rijen ongeveer even breed zijn (geen lege zalen).
  const rowCount = Math.max(1, Math.round(deptW / rowAW));
  const aim = deptW / rowCount;
  const rows: Array<typeof deptSpecs> = [];
  let cur: typeof deptSpecs = [];
  let curW = 0;
  for (const d of deptSpecs) {
    if (cur.length && rows.length < rowCount - 1 && curW + d.w / 2 > aim) {
      rows.push(cur);
      cur = [];
      curW = 0;
    }
    cur.push(d);
    curW += d.w;
  }
  if (cur.length) rows.push(cur);
  const rowW = Math.max(rowAW, ...rows.map((r) => r.reduce((s, d) => s + d.w, 0)));

  // Extra breedte eerlijk verdelen, zodat elke rij precies even breed is.
  const stretch = <T extends { w: number }>(list: T[]) => {
    const extra = rowW - list.reduce((s, r) => s + r.w, 0);
    const each = Math.floor(extra / list.length);
    list.forEach((r, k) => (r.w += each + (k === list.length - 1 ? extra - each * list.length : 0)));
  };
  stretch(special);
  rows.forEach(stretch);

  let depth = ROW_A_D + CORRIDOR_D;
  const rowZ: number[] = [];
  const rowD: number[] = [];
  rows.forEach((r, k) => {
    if (k > 0) depth += CORRIDOR_D;
    rowZ.push(depth);
    const d = Math.max(...r.map((x) => x.d));
    rowD.push(d);
    depth += d;
  });
  const width = HALL_W + rowW;

  const grid = createGrid(width, depth);
  const rooms: Room[] = [];
  const desks: Desk[] = [];
  const pois: Poi[] = [];
  const furniture: Furniture[] = [];
  const deskOf = new Map<string, string>();
  const roomOfBranch = new Map<string, string>();
  const benchOf = new Map<string, string>();

  const addRoom = (room: Room) => {
    rooms.push(room);
    const { x, z, w, d } = room.rect;
    if (room.kind === "hall" || room.kind === "corridor") return;
    addWall(grid, "h", z, x, x + w);
    addWall(grid, "h", z + d, x, x + w);
    addWall(grid, "v", x, z, z + d);
    addWall(grid, "v", x + w, z, z + d);
    if (room.door) removeWall(grid, "h", room.door.z, room.door.x, room.door.x + room.door.w);
  };
  const put = (f: Furniture, blockIt = true) => {
    furniture.push(f);
    if (blockIt && f.w && f.d) {
      const rotated = Math.abs(Math.sin(f.rot)) > 0.5;
      const w = rotated ? f.d : f.w;
      const d = rotated ? f.w : f.d;
      blockRect(grid, f.x - w / 2, f.z - d / 2, w, d);
    }
  };
  const poi = (p: Poi) => pois.push(p);

  // ---------------------------------------------------------------- hal, receptie en ingang
  addRoom({
    id: "hall",
    kind: "hall",
    name: "Hal",
    rect: { x: 0, z: 0, w: HALL_W, d: depth },
    floor: "#e9e6e1",
    accent: "#6b7385",
    branch: null,
    door: null,
    glass: false,
  });
  const entrance: Spot = { x: 0.6, z: ROW_A_D + 1.5, facing: Math.PI / 2 };
  put({ type: "entrance", x: 0, z: ROW_A_D + 1.5, rot: Math.PI / 2, w: 3, d: 0.3, roomId: "hall" }, false);
  poi({ id: "entrance", kind: "entrance", roomId: "hall", spot: entrance });
  put({ type: "sign", x: HALL_W / 2, z: 0.12, rot: 0, w: 4, d: 0.1, roomId: "hall", label: "logo" }, false);
  put({ type: "reception", x: 4.5, z: 4.5, rot: 0, w: 3, d: 1, roomId: "hall" });
  put({ type: "plant", x: 0.5, z: 0.5, rot: 0, w: 1, d: 1, roomId: "hall" });
  put({ type: "plant", x: HALL_W - 0.5, z: 0.5, rot: 0, w: 1, d: 1, roomId: "hall" });
  const benchZ = ROW_A_D + CORRIDOR_D + 1.5;
  put({ type: "bench", x: 4, z: benchZ, rot: 0, w: 4, d: 1, roomId: "hall" });
  for (let k = 0; k < 4; k++) {
    poi({ id: `bench-${k}`, kind: "bench", roomId: "hall", spot: { x: 2.5 + k, z: benchZ - 0.05, facing: 0, y: SEAT.sofa }, seated: true });
  }
  put({ type: "plant", x: 0.5, z: benchZ + 2, rot: 0, w: 1, d: 1, roomId: "hall" });
  pending.forEach((a, k) => benchOf.set(a.id, `bench-${Math.min(k, 3)}`));

  // Gangen (open vloer, verbonden met de hal).
  addRoom({
    id: "corridor-0",
    kind: "corridor",
    name: "Gang",
    rect: { x: HALL_W, z: ROW_A_D, w: rowW, d: CORRIDOR_D },
    floor: "#e9e6e1",
    accent: "#6b7385",
    branch: null,
    door: null,
    glass: false,
  });
  rows.forEach((_, k) => {
    if (k === 0) return;
    addRoom({
      id: `corridor-${k}`,
      kind: "corridor",
      name: "Gang",
      rect: { x: HALL_W, z: rowZ[k]! - CORRIDOR_D, w: rowW, d: CORRIDOR_D },
      floor: "#e9e6e1",
      accent: "#6b7385",
      branch: null,
      door: null,
      glass: false,
    });
  });
  put({ type: "plant", x: width - 0.5, z: ROW_A_D + 0.5, rot: 0, w: 1, d: 1, roomId: "corridor-0" });
  put({ type: "water", x: width - 0.5, z: ROW_A_D + 2.5, rot: -Math.PI / 2, w: 1, d: 1, roomId: "corridor-0" });
  poi({ id: "water-corridor", kind: "water", roomId: "corridor-0", spot: { x: width - 1.5, z: ROW_A_D + 2.5, facing: Math.PI / 2 } });

  // ---------------------------------------------------------------- bovenste rij
  let x = HALL_W;
  for (const s of special) {
    const rect = { x, z: 0, w: s.w, d: ROW_A_D };
    const room: Room = {
      id: s.kind,
      kind: s.kind,
      name: s.name,
      rect,
      floor: SPECIAL_FLOOR[s.kind as keyof typeof SPECIAL_FLOOR],
      accent: SPECIAL_ACCENT[s.kind as keyof typeof SPECIAL_ACCENT],
      branch: null,
      door: { x: x + 1, z: ROW_A_D, w: 2 },
      glass: s.kind === "knowledge" || s.kind === "meeting",
    };
    addRoom(room);
    furnishSpecial(room, { put, poi, desks, deskOf, ceo });
    x += s.w;
  }

  // ---------------------------------------------------------------- afdelingen
  rows.forEach((row, k) => {
    let rx = HALL_W;
    for (const spec of row) {
      const colors = deptColor(spec.branch.template, spec.branch.index);
      const rect = { x: rx, z: rowZ[k]!, w: spec.w, d: rowD[k]! };
      const room: Room = {
        id: `dept-${spec.branch.slug}`,
        kind: spec.branch.slug === "holding" ? "control" : spec.branch.slug === WORKSHOP_SLUG ? "workshop" : "dept",
        name: spec.branch.name,
        rect,
        floor: colors.floor,
        accent: colors.accent,
        branch: spec.branch.slug,
        door: { x: rx + 1, z: rect.z, w: 2 },
        glass: false,
      };
      addRoom(room);
      roomOfBranch.set(spec.branch.slug, room.id);
      if (room.kind === "workshop") furnishWorkshop(room, spec, workshop!, { put, poi, desks, deskOf });
      else furnishDept(room, spec, { put, poi, desks, deskOf });
      rx += spec.w;
    }
  });

  // Buitenmuren (het raster kent alleen oost- en zuidranden; noord en west tekenen we los).
  addWall(grid, "h", depth, 0, width);
  addWall(grid, "v", width, 0, depth);
  // De hal staat open naar de gangen: haal de oostmuur van de hal weg waar een gang begint.
  removeWall(grid, "v", HALL_W, ROW_A_D, ROW_A_D + CORRIDOR_D);
  rows.forEach((_, k) => {
    if (k > 0) removeWall(grid, "v", HALL_W, rowZ[k]! - CORRIDOR_D, rowZ[k]!);
  });

  const walls = collectWalls(grid, rooms, width, depth, entrance);
  return { width, depth, grid, rooms, desks, pois, furniture, walls, deskOf, roomOfBranch, benchOf, entrance };
}

const SPECIAL_FLOOR = {
  ceo: "#ede3d4",
  knowledge: "#1c2640",
  meeting: "#e6e9ef",
  pantry: "#f3eee6",
  owner: "#e9e2f5",
};
const SPECIAL_ACCENT = {
  ceo: "#b8872f",
  knowledge: "#38d9ff",
  meeting: "#5b6b86",
  pantry: "#e0781f",
  owner: "#7c4dff",
};

interface Ctx {
  put: (f: Furniture, blockIt?: boolean) => void;
  poi: (p: Poi) => void;
  desks: Desk[];
  deskOf: Map<string, string>;
}

function furnishSpecial(room: Room, c: Ctx & { ceo: LayoutAgent | null }): void {
  const { x, z, w, d } = room.rect;
  // Middens die precies op het raster vallen: oneven breedte (3, 5) op een celmidden, even breedte op een lijn.
  const cOdd = x + Math.floor(w / 2) + 0.5;
  const cEven = x + Math.round(w / 2);
  const id = room.id;
  const plant = (i: number, j: number) => c.put({ type: "plant", x: i + 0.5, z: j + 0.5, rot: 0, w: 1, d: 1, roomId: id });
  switch (room.kind) {
    case "ceo": {
      c.put({ type: "rug", x: cOdd, z: z + 4, rot: 0, w: 5, d: 3.4, roomId: id, color: "#c9a06a" }, false);
      const desk: Desk = {
        id: "desk-ceo",
        roomId: id,
        kind: "exec",
        x: cOdd,
        z: z + 3.5,
        width: 3,
        seat: { x: cOdd, z: z + 2.55, facing: 0 },
        visitor: { x: cOdd, z: z + 4.75, facing: Math.PI },
        agentId: c.ceo?.id ?? null,
        lead: false,
      };
      c.desks.push(desk);
      if (c.ceo) c.deskOf.set(c.ceo.id, desk.id);
      c.put({ type: "exec-desk", x: cOdd, z: z + 3.5, rot: 0, w: 3, d: 1, roomId: id, ref: desk.id });
      c.put({ type: "chair", x: desk.seat.x, z: desk.seat.z, rot: 0, roomId: id, ref: desk.id }, false);
      c.put({ type: "bookshelf", x: x + 2, z: z + 0.45, rot: 0, w: 2, d: 0.9, roomId: id });
      c.put({ type: "screen", x: cOdd + 1.5, z: z + 0.1, rot: 0, w: 2.6, d: 0.1, roomId: id, label: "kpi" }, false);
      c.put({ type: "cabinet", x: x + w - 0.5, z: z + 3, rot: -Math.PI / 2, w: 2, d: 0.8, roomId: id, label: "trofee" });
      plant(x, z + d - 1);
      plant(x + w - 1, z + d - 1);
      c.put({ type: "window", x: x + 4.2, z: 0, rot: 0, w: 1.6, d: 0.1, roomId: id }, false);
      break;
    }
    case "knowledge": {
      for (let k = 0; k < 4; k++) {
        const sx = x + 2 + k * 2.6;
        if (sx + 1 > x + w - 1) break;
        c.put({ type: "bookshelf", x: Math.round(sx), z: z + 0.45, rot: 0, w: 2, d: 0.9, roomId: id, color: "#243457" });
        c.poi({ id: `shelf-${k}`, kind: "shelf", roomId: id, spot: { x: Math.round(sx), z: z + 1.55, facing: Math.PI } });
      }
      c.put({ type: "bookshelf", x: x + 0.45, z: z + 4, rot: Math.PI / 2, w: 2, d: 0.9, roomId: id, color: "#243457" });
      c.put({ type: "bookshelf", x: x + w - 0.45, z: z + 4, rot: -Math.PI / 2, w: 2, d: 0.9, roomId: id, color: "#243457" });
      c.poi({ id: "shelf-w", kind: "shelf", roomId: id, spot: { x: x + 1.55, z: z + 4, facing: -Math.PI / 2 } });
      c.poi({ id: "shelf-e", kind: "shelf", roomId: id, spot: { x: x + w - 1.55, z: z + 4, facing: Math.PI / 2 } });
      const hz = z + 4;
      c.put({ type: "hologram", x: cEven, z: hz, rot: 0, w: 2, d: 2, roomId: id, label: "graphify" });
      for (const [k, dx] of [-3.5, 3.5].entries()) {
        c.put({ type: "terminal", x: cEven + dx, z: z + 6.5, rot: Math.PI, w: 1, d: 0.6, roomId: id });
        c.poi({ id: `terminal-${k}`, kind: "terminal", roomId: id, spot: { x: cEven + dx, z: z + 7.45, facing: Math.PI } });
      }
      for (const [k, dx] of [-1.5, 0, 1.5].entries()) {
        c.poi({ id: `holo-${k}`, kind: "hologram", roomId: id, spot: { x: cEven + dx, z: hz + 1.6, facing: Math.PI } });
      }
      c.put({ type: "sign", x: cEven, z: z + 0.1, rot: 0, w: 3.5, d: 0.1, roomId: id, label: "Kennisbank · Graphify" }, false);
      break;
    }
    case "meeting": {
      c.put({ type: "meeting-table", x: cOdd, z: z + 4, rot: 0, w: 5, d: 2, roomId: id });
      const y = SEAT.meeting;
      const seats: Spot[] = [
        { x: cOdd - 2, z: z + 2.6, facing: 0, y },
        { x: cOdd, z: z + 2.6, facing: 0, y },
        { x: cOdd + 2, z: z + 2.6, facing: 0, y },
        { x: cOdd - 2, z: z + 5.4, facing: Math.PI, y },
        { x: cOdd, z: z + 5.4, facing: Math.PI, y },
        { x: cOdd + 2, z: z + 5.4, facing: Math.PI, y },
        { x: cOdd - 3.05, z: z + 4, facing: Math.PI / 2, y },
        { x: cOdd + 3.05, z: z + 4, facing: -Math.PI / 2, y },
      ];
      seats.forEach((s, k) => {
        c.put({ type: "chair", x: s.x, z: s.z, rot: s.facing, roomId: id }, false);
        c.poi({ id: `meeting-${k}`, kind: "meeting-seat", roomId: id, spot: s });
      });
      // Het projectenbord: alle projecten als kaartjes in kolommen (klik voor het overzicht).
      c.put({ type: "kanban", x: cOdd, z: z + 0.12, rot: 0, w: Math.min(w - 2, 6), d: 0.1, roomId: id, label: "Projectenbord" }, false);
      plant(x + w - 1, z + d - 1);
      break;
    }
    case "pantry": {
      c.put({ type: "counter", x: x + 2.5, z: z + 0.5, rot: 0, w: 5, d: 1, roomId: id });
      c.put({ type: "coffee", x: x + 1.5, z: z + 0.45, rot: 0, roomId: id }, false);
      c.poi({ id: "coffee", kind: "coffee", roomId: id, spot: { x: x + 1.5, z: z + 1.5, facing: Math.PI } });
      c.poi({ id: "coffee-2", kind: "coffee", roomId: id, spot: { x: x + 3.5, z: z + 1.5, facing: Math.PI } });
      c.put({ type: "fridge", x: x + w - 0.5, z: z + 0.5, rot: 0, w: 1, d: 1, roomId: id });
      c.put({ type: "sofa", x: x + 0.5, z: z + 4.5, rot: Math.PI / 2, w: 3, d: 1, roomId: id });
      for (let k = 0; k < 2; k++) {
        c.poi({ id: `sofa-${k}`, kind: "sofa", roomId: id, spot: { x: x + 0.6, z: z + 3.9 + k * 1.2, facing: Math.PI / 2, y: SEAT.sofa }, seated: true });
      }
      c.put({ type: "round-table", x: x + 5.5, z: z + 5.5, rot: 0, w: 1, d: 1, roomId: id });
      c.put({ type: "stool", x: x + 4.6, z: z + 5.5, rot: Math.PI / 2, roomId: id }, false);
      c.put({ type: "stool", x: x + 6.4, z: z + 5.5, rot: -Math.PI / 2, roomId: id }, false);
      c.poi({ id: "stool-0", kind: "stool", roomId: id, spot: { x: x + 4.6, z: z + 5.5, facing: Math.PI / 2, y: SEAT.stool } });
      c.poi({ id: "stool-1", kind: "stool", roomId: id, spot: { x: x + 6.4, z: z + 5.5, facing: -Math.PI / 2, y: SEAT.stool } });
      c.poi({ id: "window-pantry", kind: "window", roomId: id, spot: { x: x + w - 2.5, z: z + 1.5, facing: Math.PI } });
      c.put({ type: "window", x: x + w - 2.5, z: 0, rot: 0, w: 1.6, d: 0.1, roomId: id }, false);
      plant(x + w - 1, z + d - 1);
      break;
    }
    case "owner": {
      c.put({ type: "rug", x: cOdd, z: z + 4, rot: 0, w: 5, d: 3.4, roomId: id, color: "#9b86d6" }, false);
      const desk: Desk = {
        id: "desk-owner",
        roomId: id,
        kind: "owner",
        x: cOdd,
        z: z + 3.5,
        width: 3,
        seat: { x: cOdd, z: z + 2.55, facing: 0 },
        visitor: { x: cOdd, z: z + 4.8, facing: Math.PI },
        agentId: OWNER_ID,
        lead: false,
      };
      c.desks.push(desk);
      c.deskOf.set(OWNER_ID, desk.id);
      c.put({ type: "exec-desk", x: cOdd, z: z + 3.5, rot: 0, w: 3, d: 1, roomId: id, ref: desk.id, color: "#6d5a9e" });
      c.put({ type: "chair", x: desk.seat.x, z: desk.seat.z, rot: 0, roomId: id, ref: "owner-chair" }, false);
      c.put({ type: "inbox", x: cOdd + 0.9, z: z + 3.45, rot: 0, roomId: id }, false);
      for (const [k, dx] of [-1.2, 0, 1.2].entries()) {
        c.poi({ id: `visitor-${k}`, kind: "visitor", roomId: id, spot: { x: cOdd + dx, z: z + 4.85, facing: Math.PI } });
      }
      c.put({ type: "red-button", x: x + w - 1.5, z: z + 1.5, rot: 0, w: 1, d: 1, roomId: id });
      c.put({ type: "bookshelf", x: x + 2, z: z + 0.45, rot: 0, w: 2, d: 0.9, roomId: id });
      c.put({ type: "window", x: cOdd + 0.5, z: 0, rot: 0, w: 1.6, d: 0.1, roomId: id }, false);
      plant(x, z + d - 1);
      break;
    }
    default:
      break;
  }
}

function furnishDept(
  room: Room,
  spec: { branch: LayoutBranch & { index: number }; list: LayoutAgent[]; cols: number; rows: number },
  c: Ctx,
): void {
  const { x, z, w, d } = room.rect;
  const id = room.id;
  for (let k = 0; k < spec.cols * spec.rows; k++) {
    const col = k % spec.cols;
    const row = Math.floor(k / spec.cols);
    const dx = x + 2 + 3 * col;
    const dz = z + 3.5 + 3 * row;
    const agent = spec.list[k] ?? null;
    // Je zit aan de zuidkant en kijkt naar je scherm (noord); de camera kijkt over je schouder mee.
    const desk: Desk = {
      id: agent?.id === BOT_ID ? "desk-bot" : `${id}:${k}`,
      roomId: id,
      kind: "desk",
      x: dx,
      z: dz,
      width: 2,
      seat: { x: dx, z: dz + 0.95, facing: Math.PI },
      visitor: { x: dx + 0.95, z: dz + 1.05, facing: -Math.PI / 2 },
      agentId: agent?.id ?? null,
      lead: Boolean(agent && isLead(agent)),
    };
    c.desks.push(desk);
    if (agent) c.deskOf.set(agent.id, desk.id);
    c.put({ type: "desk", x: dx, z: dz, rot: 0, w: 2, d: 1, roomId: id, ref: desk.id, color: room.accent });
    c.put({ type: "chair", x: desk.seat.x, z: desk.seat.z, rot: Math.PI, roomId: id, ref: desk.id }, false);
  }
  c.put({ type: "sign", x: x + 2, z: z + 0.1, rot: 0, w: 2.6, d: 0.1, roomId: id, label: room.name, color: room.accent }, false);
  if (room.kind === "control") {
    // Grote schermen met alle cijfers, en de kluis (het grootboek).
    const vw = Math.min(w - 5, 7);
    const vx = x + w - 1 - vw / 2;
    c.put({ type: "video-wall", x: vx, z: z + 0.3, rot: 0, w: vw, d: 0.4, roomId: id, label: "Cijfers" });
    c.poi({ id: "video-wall", kind: "whiteboard", roomId: id, spot: { x: vx, z: z + 1.45, facing: Math.PI } });
    c.put({ type: "vault", x: x + w - 1, z: z + d - 1, rot: -Math.PI / 4, w: 1, d: 1, roomId: id, label: "Kluis" });
    c.put({ type: "plant", x: x + 0.5, z: z + d - 0.5, rot: 0, w: 1, d: 1, roomId: id });
    return;
  }
  const wbx = x + w - 3.5;
  c.put({ type: "whiteboard", x: wbx, z: z + 0.35, rot: 0, w: 3, d: 0.5, roomId: id, ref: spec.branch.slug });
  c.poi({ id: `whiteboard-${spec.branch.slug}`, kind: "whiteboard", roomId: id, spot: { x: wbx, z: z + 1.45, facing: Math.PI } });
  c.put({ type: "plant", x: x + 0.5, z: z + d - 0.5, rot: 0, w: 1, d: 1, roomId: id });
  c.put({ type: "plant", x: x + w - 0.5, z: z + d - 0.5, rot: 0, w: 1, d: 1, roomId: id });
}

/**
 * De werkplaats: aan de noordmuur een bord per project (live, tests, uitrol, wat op jou wacht), daaronder
 * bureaus voor de Claude Code-sessies. De bureaus zijn nog van niemand: de regisseur zet de sessies erop.
 */
function furnishWorkshop(
  room: Room,
  spec: { cols: number; rows: number },
  workshop: LayoutWorkshop,
  c: Ctx,
): void {
  const { x, z, w, d } = room.rect;
  const id = room.id;
  c.put({ type: "sign", x: x + 2.4, z: z + 0.1, rot: 0, w: 3.2, d: 0.1, roomId: id, label: "Werkplaats", color: room.accent }, false);
  const boards = workshop.projects.slice(0, Math.max(1, Math.floor((w - 5.2) / 3.2)));
  boards.forEach((p, k) => {
    const bx = x + 5.6 + k * 3.2;
    c.put({ type: "code-board", x: bx, z: z + 0.2, rot: 0, w: 2.8, d: 0.3, roomId: id, ref: p.key, label: p.name });
    c.poi({ id: `code-board-${p.key}`, kind: "whiteboard", roomId: id, spot: { x: bx, z: z + 1.45, facing: Math.PI } });
  });
  const x0 = x + Math.max(2, (w - 3 * spec.cols) / 2 + 0.5);
  for (let k = 0; k < spec.cols * spec.rows; k++) {
    const col = k % spec.cols;
    const row = Math.floor(k / spec.cols);
    const dx = x0 + 3 * col;
    const dz = z + 4.5 + 3 * row;
    const desk: Desk = {
      id: `${WORKSHOP_SLUG}:${k}`,
      roomId: id,
      kind: "desk",
      x: dx,
      z: dz,
      width: 2,
      seat: { x: dx, z: dz + 0.95, facing: Math.PI },
      visitor: { x: dx + 0.95, z: dz + 1.05, facing: -Math.PI / 2 },
      agentId: null,
      lead: false,
    };
    c.desks.push(desk);
    c.put({ type: "desk", x: dx, z: dz, rot: 0, w: 2, d: 1, roomId: id, ref: desk.id, color: room.accent });
    c.put({ type: "chair", x: desk.seat.x, z: desk.seat.z, rot: Math.PI, roomId: id, ref: desk.id }, false);
  }
  c.put({ type: "plant", x: x + 0.5, z: z + d - 0.5, rot: 0, w: 1, d: 1, roomId: id });
  c.put({ type: "plant", x: x + w - 0.5, z: z + d - 0.5, rot: 0, w: 1, d: 1, roomId: id });
}

/** Zet de muren uit het raster om in zo lang mogelijke stukken, plus de noord- en westgevel. */
function collectWalls(grid: Grid, rooms: Room[], width: number, depth: number, entrance: Spot): WallSeg[] {
  const segs: WallSeg[] = [];
  const roomAt = (px: number, pz: number) =>
    rooms.find((r) => r.kind !== "hall" && r.kind !== "corridor" && px >= r.rect.x && px < r.rect.x + r.rect.w && pz >= r.rect.z && pz < r.rect.z + r.rect.d) ??
    null;
  const kindOf = (x1: number, z1: number, x2: number, z2: number) => {
    const outer = (z1 === z2 && (z1 === 0 || z1 === depth)) || (x1 === x2 && (x1 === 0 || x1 === width));
    const mx = (x1 + x2) / 2;
    const mz = (z1 + z2) / 2;
    const a = z1 === z2 ? roomAt(mx, mz - 0.1) : roomAt(mx - 0.1, mz);
    const b = z1 === z2 ? roomAt(mx, mz + 0.1) : roomAt(mx + 0.1, mz);
    const glass = !outer && Boolean(a?.glass || b?.glass);
    return { outer, glass, height: outer ? OUTER_H : glass ? GLASS_H : WALL_H };
  };
  // Horizontale randen (zuidkant van rij j) en verticale (oostkant van kolom i).
  for (let j = 0; j < grid.h; j++) {
    let start = -1;
    for (let i = 0; i <= grid.w; i++) {
      const on = i < grid.w && grid.wallS[j * grid.w + i] === 1;
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        // Knip ook bij een wissel van soort (glas/steen), zodat elk stuk één materiaal heeft.
        segs.push(...splitByKind(start, i, (a, b) => ({ x1: a, z1: j + 1, x2: b, z2: j + 1 }), kindOf));
        start = -1;
      }
    }
  }
  for (let i = 0; i < grid.w; i++) {
    let start = -1;
    for (let j = 0; j <= grid.h; j++) {
      const on = j < grid.h && grid.wallE[j * grid.w + i] === 1;
      if (on && start < 0) start = j;
      if (!on && start >= 0) {
        segs.push(...splitByKind(start, j, (a, b) => ({ x1: i + 1, z1: a, x2: i + 1, z2: b }), kindOf));
        start = -1;
      }
    }
  }
  segs.push({ x1: 0, z1: 0, x2: width, z2: 0, height: OUTER_H, glass: false, outer: true });
  // Westgevel met een opening voor de ingang.
  const e0 = entrance.z - 1.5;
  segs.push({ x1: 0, z1: 0, x2: 0, z2: e0, height: OUTER_H, glass: false, outer: true });
  segs.push({ x1: 0, z1: e0 + 3, x2: 0, z2: depth, height: OUTER_H, glass: false, outer: true });
  return segs;
}

function splitByKind(
  a: number,
  b: number,
  make: (a: number, b: number) => { x1: number; z1: number; x2: number; z2: number },
  kindOf: (x1: number, z1: number, x2: number, z2: number) => { outer: boolean; glass: boolean; height: number },
): WallSeg[] {
  const out: WallSeg[] = [];
  let start = a;
  let prev: ReturnType<typeof kindOf> | null = null;
  for (let k = a; k <= b; k++) {
    let cur: ReturnType<typeof kindOf> | null = null;
    if (k < b) {
      const m = make(k, k + 1);
      cur = kindOf(m.x1, m.z1, m.x2, m.z2);
    }
    if (prev && (!cur || cur.glass !== prev.glass || cur.outer !== prev.outer)) {
      out.push({ ...make(start, k), ...prev });
      start = k;
    }
    prev = cur;
  }
  return out;
}

/** In welke kamer ligt een punt? */
export function roomAt(layout: Layout, x: number, z: number): Room | null {
  const specific = layout.rooms.find(
    (r) => r.kind !== "hall" && r.kind !== "corridor" && x >= r.rect.x && x < r.rect.x + r.rect.w && z >= r.rect.z && z < r.rect.z + r.rect.d,
  );
  return specific ?? layout.rooms.find((r) => x >= r.rect.x && x < r.rect.x + r.rect.w && z >= r.rect.z && z < r.rect.z + r.rect.d) ?? null;
}
