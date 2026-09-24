/**
 * Looproutes door het kantoor: een raster met muren op de randen tussen cellen en
 * geblokkeerde cellen (meubels). A* met diagonale stappen, zonder door hoeken te snijden.
 * Geen DOM of three.js hier, zodat dit los te testen is.
 */

export interface Grid {
  w: number;
  h: number;
  /** 1 = meubel of iets anders waar je niet doorheen kunt lopen. */
  blocked: Uint8Array;
  /** 1 = muur aan de oostkant van cel (i, j), dus tussen i en i+1. */
  wallE: Uint8Array;
  /** 1 = muur aan de zuidkant van cel (i, j), dus tussen j en j+1. */
  wallS: Uint8Array;
}

export interface Pt {
  x: number;
  z: number;
}

export function createGrid(w: number, h: number): Grid {
  return { w, h, blocked: new Uint8Array(w * h), wallE: new Uint8Array(w * h), wallS: new Uint8Array(w * h) };
}

export const inBounds = (g: Grid, i: number, j: number) => i >= 0 && j >= 0 && i < g.w && j < g.h;
const at = (g: Grid, i: number, j: number) => j * g.w + i;

export function isBlocked(g: Grid, i: number, j: number): boolean {
  return !inBounds(g, i, j) || g.blocked[at(g, i, j)] === 1;
}

export function block(g: Grid, i: number, j: number): void {
  if (inBounds(g, i, j)) g.blocked[at(g, i, j)] = 1;
}

export function blockRect(g: Grid, x: number, z: number, w: number, d: number): void {
  for (let i = Math.floor(x); i < Math.ceil(x + w); i++) for (let j = Math.floor(z); j < Math.ceil(z + d); j++) block(g, i, j);
}

/** Muur langs een rasterlijn: horizontaal (z vast) of verticaal (x vast), van a tot b in cellen. */
export function addWall(g: Grid, orientation: "h" | "v", line: number, a: number, b: number): void {
  for (let k = Math.min(a, b); k < Math.max(a, b); k++) {
    if (orientation === "h") {
      // Rand tussen rij line-1 en line, kolom k.
      if (inBounds(g, k, line - 1)) g.wallS[at(g, k, line - 1)] = 1;
    } else if (inBounds(g, line - 1, k)) {
      g.wallE[at(g, line - 1, k)] = 1;
    }
  }
}

export function removeWall(g: Grid, orientation: "h" | "v", line: number, a: number, b: number): void {
  for (let k = Math.min(a, b); k < Math.max(a, b); k++) {
    if (orientation === "h") {
      if (inBounds(g, k, line - 1)) g.wallS[at(g, k, line - 1)] = 0;
    } else if (inBounds(g, line - 1, k)) {
      g.wallE[at(g, line - 1, k)] = 0;
    }
  }
}

/** Mag je in één stap van (i, j) naar (i+di, j+dj)? Diagonaal alleen als beide rechte omwegen vrij zijn. */
export function canStep(g: Grid, i: number, j: number, di: number, dj: number): boolean {
  const ni = i + di;
  const nj = j + dj;
  if (isBlocked(g, ni, nj)) return false;
  if (di !== 0 && dj !== 0) {
    return canStep(g, i, j, di, 0) && canStep(g, i + di, j, 0, dj) && canStep(g, i, j, 0, dj) && canStep(g, i, j + dj, di, 0);
  }
  if (di === 1) return g.wallE[at(g, i, j)] === 0;
  if (di === -1) return g.wallE[at(g, ni, j)] === 0;
  if (dj === 1) return g.wallS[at(g, i, j)] === 0;
  if (dj === -1) return g.wallS[at(g, i, nj)] === 0;
  return true;
}

export const cellOf = (p: Pt) => ({ i: Math.floor(p.x), j: Math.floor(p.z) });
export const center = (i: number, j: number): Pt => ({ x: i + 0.5, z: j + 0.5 });

/** Dichtstbijzijnde vrije cel (breedte-eerst), voor als een doel of start op een meubel ligt. */
export function nearestFree(g: Grid, i: number, j: number): { i: number; j: number } | null {
  if (!isBlocked(g, i, j)) return { i, j };
  const seen = new Uint8Array(g.w * g.h);
  const queue: Array<[number, number]> = [[i, j]];
  if (inBounds(g, i, j)) seen[at(g, i, j)] = 1;
  while (queue.length) {
    const [ci, cj] = queue.shift()!;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const ni = ci + di;
      const nj = cj + dj;
      if (!inBounds(g, ni, nj) || seen[at(g, ni, nj)]) continue;
      seen[at(g, ni, nj)] = 1;
      if (!isBlocked(g, ni, nj)) return { i: ni, j: nj };
      queue.push([ni, nj]);
    }
  }
  return null;
}

class Heap {
  private items: number[] = [];
  constructor(private readonly score: Float64Array) {}
  get size() {
    return this.items.length;
  }
  push(n: number) {
    const a = this.items;
    a.push(n);
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.score[a[p]!]! <= this.score[a[k]!]!) break;
      [a[p], a[k]] = [a[k]!, a[p]!];
      k = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < a.length && this.score[a[l]!]! < this.score[a[m]!]!) m = l;
        if (r < a.length && this.score[a[r]!]! < this.score[a[m]!]!) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k]!, a[m]!];
        k = m;
      }
    }
    return top;
  }
}

const DIRS: Array<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * Route van `from` naar `to` (wereldcoördinaten). Geeft de tussenpunten (celmiddens, zonder start)
 * en als laatste het exacte doel. Null als er geen route is.
 */
export function findPath(g: Grid, from: Pt, to: Pt): Pt[] | null {
  const s0 = cellOf(from);
  const t0 = cellOf(to);
  const s = nearestFree(g, s0.i, s0.j);
  const t = nearestFree(g, t0.i, t0.j);
  if (!s || !t) return null;
  const n = g.w * g.h;
  const gScore = new Float64Array(n).fill(Infinity);
  const fScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const start = at(g, s.i, s.j);
  const goal = at(g, t.i, t.j);
  const h = (i: number, j: number) => {
    const dx = Math.abs(i - t.i);
    const dz = Math.abs(j - t.j);
    return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
  };
  gScore[start] = 0;
  fScore[start] = h(s.i, s.j);
  const open = new Heap(fScore);
  open.push(start);
  while (open.size) {
    const cur = open.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const ci = cur % g.w;
    const cj = (cur - ci) / g.w;
    for (const [di, dj, cost] of DIRS) {
      if (!canStep(g, ci, cj, di, dj)) continue;
      const nb = at(g, ci + di, cj + dj);
      if (closed[nb]) continue;
      const tentative = gScore[cur]! + cost;
      if (tentative < gScore[nb]!) {
        gScore[nb] = tentative;
        fScore[nb] = tentative + h(ci + di, cj + dj);
        came[nb] = cur;
        open.push(nb);
      }
    }
  }
  if (start !== goal && came[goal] === -1) return null;
  const cells: number[] = [];
  for (let c = goal; c !== start && c !== -1; c = came[c]!) cells.push(c);
  cells.reverse();
  const pts = cells.map((c) => center(c % g.w, Math.floor(c / g.w)));
  // Als het doel zelf vrij is: eindig precies op het doel, anders in het midden van de dichtste vrije cel.
  if (!isBlocked(g, t0.i, t0.j)) {
    if (pts.length) pts[pts.length - 1] = { x: to.x, z: to.z };
    else pts.push({ x: to.x, z: to.z });
  }
  return smoothPath(g, from, pts);
}

/** Kan je in een rechte lijn van a naar b lopen (zonder muren of meubels te raken)? */
export function lineOfSight(g: Grid, a: Pt, b: Pt): boolean {
  let { i, j } = cellOf(a);
  const end = cellOf(b);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const stepI = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepJ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepI ? Math.abs(1 / dx) : Infinity;
  const tDeltaZ = stepJ ? Math.abs(1 / dz) : Infinity;
  let tMaxX = stepI > 0 ? (i + 1 - a.x) / dx : stepI < 0 ? (a.x - i) / -dx : Infinity;
  let tMaxZ = stepJ > 0 ? (j + 1 - a.z) / dz : stepJ < 0 ? (a.z - j) / -dz : Infinity;
  let guard = 0;
  while ((i !== end.i || j !== end.j) && guard++ < 1000) {
    if (Math.abs(tMaxX - tMaxZ) < 1e-9) {
      // Precies door een hoek: beide buren moeten vrij zijn.
      if (!canStep(g, i, j, stepI, stepJ)) return false;
      i += stepI;
      j += stepJ;
      tMaxX += tDeltaX;
      tMaxZ += tDeltaZ;
    } else if (tMaxX < tMaxZ) {
      if (!canStep(g, i, j, stepI, 0)) return false;
      i += stepI;
      tMaxX += tDeltaX;
    } else {
      if (!canStep(g, i, j, 0, stepJ)) return false;
      j += stepJ;
      tMaxZ += tDeltaZ;
    }
  }
  return true;
}

/** Laat onnodige knikken weg: sla tussenpunten over zolang er een vrije rechte lijn is. */
export function smoothPath(g: Grid, from: Pt, pts: Pt[]): Pt[] {
  if (pts.length <= 1) return pts;
  const out: Pt[] = [];
  let anchor = from;
  let k = 0;
  while (k < pts.length) {
    let far = k;
    for (let m = pts.length - 1; m > k; m--) {
      if (clearLine(g, anchor, pts[m]!)) {
        far = m;
        break;
      }
    }
    out.push(pts[far]!);
    anchor = pts[far]!;
    k = far + 1;
  }
  return out;
}

/** Rechte lijn met wat ruimte aan beide kanten, zodat poppetjes niet langs muurhoeken schuren. */
function clearLine(g: Grid, a: Pt, b: Pt, margin = 0.2): boolean {
  if (!lineOfSight(g, a, b)) return false;
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const px = (-(b.z - a.z) / len) * margin;
  const pz = ((b.x - a.x) / len) * margin;
  return (
    lineOfSight(g, { x: a.x + px, z: a.z + pz }, { x: b.x + px, z: b.z + pz }) &&
    lineOfSight(g, { x: a.x - px, z: a.z - pz }, { x: b.x - px, z: b.z - pz })
  );
}

export const pathLength = (from: Pt, pts: Pt[]) =>
  pts.reduce((sum, p, k) => sum + Math.hypot(p.x - (k ? pts[k - 1]!.x : from.x), p.z - (k ? pts[k - 1]!.z : from.z)), 0);
