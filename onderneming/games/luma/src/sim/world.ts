// Wereld maken en vooruit genereren. Alles volgt uit het zaadje: dezelfde seed geeft dezelfde sterren.
import { STARS_PER_ZONE } from "../theme";
import { SIM } from "./config";
import { Rng } from "./rng";
import type { Shard, Star, StarKind, Vec2, World } from "./types";

/** Moeilijkheid 0..1 uit het volgnummer van een ster. */
export function difficulty(index: number): number {
  return Math.min(1, index / 90);
}

export function createWorld(seed: number): World {
  const start: Star = {
    id: 0,
    kind: "normal",
    base: { x: 0, y: 0 },
    pos: { x: 0, y: 0 },
    core: 0.8,
    ring: 3.2,
    baseRing: 3.2,
    phase: 0,
    moveAmp: 0,
    freq: 0,
    zone: 0,
    index: 0,
    visited: true,
    pull: 0,
  };
  const radius = 2.1;
  const world: World = {
    seed: seed >>> 0,
    rngState: seed >>> 0,
    time: 0,
    stars: [start],
    shards: [],
    comet: {
      pos: { x: radius, y: 0 },
      prev: { x: radius, y: 0 },
      vel: { x: 0, y: SIM.speedStart },
      state: { mode: "orbit", starId: 0, angle: 0, radius, targetRadius: radius, dir: 1, time: 0, heat: 0 },
    },
    score: 0,
    combo: 0,
    zone: 0,
    speed: SIM.speedStart,
    stats: { captures: 0, perfects: 0, bestCombo: 0, shards: 0, nearMisses: 0, time: 0 },
    events: [{ type: "start", seed: seed >>> 0 }],
    nextStarId: 1,
    nextShardId: 0,
    generatedTo: 0,
    lastIndex: 0,
  };
  extendWorld(world, SIM.generateAhead);
  return world;
}

function pickKind(rng: Rng, index: number): StarKind {
  const d = difficulty(index);
  if (index < 4) return "normal";
  const giant = 0.07;
  const pulse = index >= 6 ? 0.12 + 0.18 * d : 0;
  const mover = index >= 10 ? 0.1 + 0.22 * d : 0;
  const r = rng.next();
  if (r < giant) return "giant";
  if (r < giant + pulse) return "pulse";
  if (r < giant + pulse + mover) return "mover";
  return "normal";
}

function makeStar(world: World, rng: Rng, kind: StarKind, pos: Vec2, index: number): Star {
  const d = difficulty(index);
  let core = rng.range(0.55, 0.85);
  let ring = rng.range(2.7, 3.3) - 0.8 * d;
  let moveAmp = 0;
  let freq = 0;
  let pull = 0;
  switch (kind) {
    case "giant":
      core = rng.range(1.2, 1.45);
      ring = rng.range(4.0, 4.6) - 0.5 * d;
      break;
    case "pulse":
      ring = rng.range(2.9, 3.4) - 0.6 * d;
      freq = rng.range(1.4, 2.2) + 0.8 * d;
      break;
    case "mover":
      moveAmp = rng.range(2.2, 3.6) + 1.2 * d;
      freq = rng.range(0.55, 0.9) + 0.4 * d;
      break;
    case "blackhole":
      core = rng.range(0.55, 0.75);
      ring = 0;
      pull = rng.range(3.3, 4.3);
      break;
    case "normal":
      break;
  }
  const phase = rng.range(0, Math.PI * 2);
  const base = { x: pos.x, y: pos.y };
  const star: Star = {
    id: world.nextStarId++,
    kind,
    base,
    pos: { x: base.x + moveAmp * Math.sin(phase), y: base.y },
    core,
    ring: kind === "pulse" ? ring * (1 + 0.32 * Math.sin(phase)) : ring,
    baseRing: ring,
    phase,
    moveAmp,
    freq,
    zone: Math.floor(index / STARS_PER_ZONE),
    index,
    visited: false,
    pull,
  };
  return star;
}

function addShardsBetween(world: World, rng: Rng, a: Star, b: Star): void {
  const count = 2 + Math.floor(rng.next() * 3);
  // Licht gebogen boog tussen de twee sterren, buiten beide ringen.
  const bend = rng.range(-1.6, 1.6);
  const dx = b.base.x - a.base.x;
  const dy = b.base.y - a.base.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1);
    const curve = Math.sin(t * Math.PI) * bend;
    const p = { x: a.base.x + dx * t + nx * curve, y: a.base.y + dy * t + ny * curve };
    const clearA = Math.hypot(p.x - a.base.x, p.y - a.base.y) > a.baseRing + a.moveAmp + 0.4;
    const clearB = Math.hypot(p.x - b.base.x, p.y - b.base.y) > b.baseRing + b.moveAmp + 0.4;
    if (!clearA || !clearB) continue;
    const shard: Shard = { id: world.nextShardId++, pos: p, taken: false, zone: b.zone };
    world.shards.push(shard);
  }
}

/** Genereer sterren tot `ahead` eenheden voorbij de komeet. */
export function extendWorld(world: World, ahead: number): void {
  const target = world.comet.pos.y + ahead;
  if (world.generatedTo >= target) return;
  const rng = new Rng(world.rngState);
  let prev = lastPathStar(world);
  while (world.generatedTo < target) {
    const index = world.lastIndex + 1;
    const d = difficulty(index);
    const kind = pickKind(rng, index);
    const gap = rng.range(7.2, 9.4) + 2.2 * d + (kind === "giant" ? 1.2 : 0);
    let x = prev.base.x + rng.range(-6.5, 6.5);
    // Trek terug naar het midden als het pad naar de rand loopt.
    if (Math.abs(x) > SIM.laneHalfWidth) x = Math.sign(x) * SIM.laneHalfWidth - rng.range(0, 3) * Math.sign(x);
    const pos = { x, y: prev.base.y + gap };
    const star = makeStar(world, rng, kind, pos, index);
    world.stars.push(star);
    addShardsBetween(world, rng, prev, star);

    // Zwarte gaten naast het pad, vanaf ster 16.
    if (index >= 16 && rng.chance(0.16 + 0.22 * d)) {
      const side = rng.sign();
      const mid = { x: (prev.base.x + x) / 2 + side * rng.range(4.4, 6.2), y: (prev.base.y + pos.y) / 2 };
      if (Math.abs(mid.x) < SIM.fieldHalfWidth - 2 && clearOfStars(world, mid, 2.2)) {
        world.stars.push(makeStar(world, rng, "blackhole", mid, index));
      }
    }

    world.lastIndex = index;
    world.generatedTo = pos.y;
    prev = star;
  }
  world.rngState = rng.state;
}

function clearOfStars(world: World, p: Vec2, margin: number): boolean {
  for (const s of world.stars) {
    const reach = s.kind === "blackhole" ? s.pull : s.baseRing + s.moveAmp;
    if (Math.hypot(p.x - s.base.x, p.y - s.base.y) < reach + margin) return false;
  }
  return true;
}

function lastPathStar(world: World): Star {
  for (let i = world.stars.length - 1; i >= 0; i--) {
    const s = world.stars[i];
    if (s && s.kind !== "blackhole") return s;
  }
  throw new Error("wereld zonder sterren");
}

/** Ruim sterren en scherven ver achter de komeet op. */
export function pruneWorld(world: World): void {
  const limit = world.comet.pos.y - SIM.pruneBehind;
  const state = world.comet.state;
  const keepId = state.mode === "orbit" ? state.starId : -1;
  world.stars = world.stars.filter((s) => s.base.y >= limit || s.id === keepId);
  world.shards = world.shards.filter((s) => s.pos.y >= limit && !s.taken);
}

export function findStar(world: World, id: number): Star | undefined {
  for (const s of world.stars) if (s.id === id) return s;
  return undefined;
}
