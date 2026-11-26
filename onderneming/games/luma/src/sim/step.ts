// Eén stap van de simulatie. Puur en deterministisch: dezelfde wereld en invoer geven hetzelfde resultaat.
import { STARS_PER_ZONE } from "../theme";
import { SIM } from "./config";
import { extendWorld, findStar, pruneWorld } from "./world";
import type { DeathCause, FlyState, OrbitState, SimEvent, SimInput, Star, World } from "./types";

export interface StepOptions {
  /** Op het titelscherm: de baan brandt niet op en tikken doet niets. */
  idle?: boolean;
}

export function step(world: World, dt: number, input: SimInput, opts: StepOptions = {}): void {
  const comet = world.comet;
  comet.prev.x = comet.pos.x;
  comet.prev.y = comet.pos.y;
  world.time += dt;

  for (const s of world.stars) moveStar(s, dt);

  const state = comet.state;
  if (state.mode === "dead") {
    state.time += dt;
    return;
  }
  if (!opts.idle) world.stats.time += dt;

  if (state.mode === "orbit") {
    stepOrbit(world, state, dt, input, opts);
  } else {
    stepFly(world, state, dt);
  }

  if (comet.state.mode !== "dead") collectShards(world);
  extendWorld(world, SIM.generateAhead);
  pruneWorld(world);
}

/** Haal de gebeurtenissen op en maak de lijst leeg. */
export function drainEvents(world: World): SimEvent[] {
  const out = world.events;
  world.events = [];
  return out;
}

function moveStar(s: Star, dt: number): void {
  if (s.freq === 0) return;
  s.phase += s.freq * dt;
  if (s.kind === "mover") {
    s.pos.x = s.base.x + s.moveAmp * Math.sin(s.phase);
  } else if (s.kind === "pulse") {
    s.ring = s.baseRing * (1 + 0.32 * Math.sin(s.phase));
  }
}

export function heatLife(world: World, star: Star): number {
  const life = Math.max(SIM.heatLifeMin, SIM.heatLifeStart - SIM.heatLifePerCapture * world.stats.captures);
  return star.kind === "giant" ? life + SIM.giantHeatBonus : life;
}

function stepOrbit(world: World, state: OrbitState, dt: number, input: SimInput, opts: StepOptions): void {
  const comet = world.comet;
  const star = findStar(world, state.starId);
  if (!star) {
    // Kan niet gebeuren (de ster van je baan wordt niet opgeruimd), maar val veilig terug op vliegen.
    comet.state = { mode: "fly", leftStarId: null, time: 0, nearIds: [] };
    return;
  }
  // Loslaten gebruikt de richting die de speler zag: eerst loslaten, dan pas verder draaien.
  if (input.tap && !opts.idle && state.time >= SIM.minOrbitTime) {
    comet.state = { mode: "fly", leftStarId: star.id, time: 0, nearIds: [] };
    const len = Math.hypot(comet.vel.x, comet.vel.y) || 1;
    world.events.push({
      type: "release",
      starId: star.id,
      pos: { x: comet.pos.x, y: comet.pos.y },
      dir: { x: comet.vel.x / len, y: comet.vel.y / len },
    });
    stepFly(world, comet.state, dt);
    return;
  }
  state.time += dt;

  // Na het vangen zakt de baan vloeiend naar zijn straal.
  if (state.radius !== state.targetRadius) {
    const k = Math.min(1, dt / Math.max(1e-3, SIM.settleTime - Math.min(state.time, SIM.settleTime) + dt));
    state.radius += (state.targetRadius - state.radius) * k;
    if (Math.abs(state.radius - state.targetRadius) < 1e-3) state.radius = state.targetRadius;
  }

  const omega = (world.speed / state.radius) * state.dir;
  state.angle += omega * dt;
  const c = Math.cos(state.angle);
  const s = Math.sin(state.angle);
  comet.pos.x = star.pos.x + c * state.radius;
  comet.pos.y = star.pos.y + s * state.radius;
  // Raaklijn in de draairichting.
  comet.vel.x = -s * state.dir * world.speed;
  comet.vel.y = c * state.dir * world.speed;

  if (!opts.idle) {
    const before = state.heat;
    state.heat = Math.min(1, Math.max(0, (state.time - SIM.settleTime) / heatLife(world, star)));
    for (const mark of [0.6, 0.85]) {
      if (before < mark && state.heat >= mark) world.events.push({ type: "heat", starId: star.id, heat: mark });
    }
    if (state.heat >= 1) {
      die(world, "burnout");
      return;
    }
  }

}

function stepFly(world: World, state: FlyState, dt: number): void {
  const comet = world.comet;
  state.time += dt;

  // Zwarte gaten buigen de vlucht; de snelheid blijft gelijk, alleen de richting draait.
  for (const s of world.stars) {
    if (s.kind !== "blackhole") continue;
    const dx = s.pos.x - comet.pos.x;
    const dy = s.pos.y - comet.pos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > s.pull * s.pull) continue;
    const d = Math.sqrt(d2) || 1e-6;
    const a = SIM.gravity / Math.max(d2, 0.25);
    comet.vel.x += (dx / d) * a * dt;
    comet.vel.y += (dy / d) * a * dt;
  }
  const len = Math.hypot(comet.vel.x, comet.vel.y) || 1;
  comet.vel.x = (comet.vel.x / len) * world.speed;
  comet.vel.y = (comet.vel.y / len) * world.speed;

  comet.pos.x += comet.vel.x * dt;
  comet.pos.y += comet.vel.y * dt;

  for (const s of world.stars) {
    const dx = comet.pos.x - s.pos.x;
    const dy = comet.pos.y - s.pos.y;
    const dist = Math.hypot(dx, dy);

    if (dist < s.core) {
      die(world, s.kind === "blackhole" ? "blackhole" : "star");
      return;
    }
    if (s.kind === "blackhole") {
      if (dist < s.core + SIM.nearMissMargin && !state.nearIds.includes(s.id)) {
        state.nearIds.push(s.id);
        world.stats.nearMisses++;
        world.events.push({ type: "nearMiss", starId: s.id, pos: { x: comet.pos.x, y: comet.pos.y } });
      }
      continue;
    }
    if (s.id === state.leftStarId) {
      if (dist > s.ring + 0.1) state.leftStarId = null;
      continue;
    }
    if (dist <= s.ring) {
      if (tryCapture(world, s)) return;
    }
  }

  const flown = state.time * world.speed;
  if (flown > SIM.maxFlightDistance || Math.abs(comet.pos.x) > SIM.fieldHalfWidth) {
    die(world, "void");
  }
}

/**
 * Vang de komeet als hij niet recht op de kern afvliegt.
 * b = kortste afstand van de rechte vluchtlijn tot het middelpunt: dicht langs de kern scheren = PERFECT.
 */
function tryCapture(world: World, s: Star): boolean {
  const comet = world.comet;
  const rx = s.pos.x - comet.pos.x;
  const ry = s.pos.y - comet.pos.y;
  const speed = Math.hypot(comet.vel.x, comet.vel.y) || 1;
  const ux = comet.vel.x / speed;
  const uy = comet.vel.y / speed;
  const cross = rx * uy - ry * ux;
  const b = Math.abs(cross);
  const along = rx * ux + ry * uy;
  // Vlieg je er al vanaf (je kwam schuin de ring in en gaat er weer uit)? Dan vangt hij je toch, op de huidige afstand.
  const closest = along > 0 ? b : Math.hypot(rx, ry);
  if (closest < s.core) return false; // recht op de kern: geen redding, de botsing volgt.

  const minOrbit = s.core * SIM.minOrbitFactor + SIM.minOrbitMargin;
  const target = Math.min(Math.max(closest, minOrbit), s.ring * 0.92);
  const perfect = closest <= minOrbit + SIM.perfectWindow;

  const ox = comet.pos.x - s.pos.x;
  const oy = comet.pos.y - s.pos.y;
  // Draairichting uit het kruisproduct van (positie t.o.v. ster) en snelheid.
  const dir: 1 | -1 = ox * comet.vel.y - oy * comet.vel.x >= 0 ? 1 : -1;
  const radius = Math.hypot(ox, oy);

  comet.state = {
    mode: "orbit",
    starId: s.id,
    angle: Math.atan2(oy, ox),
    radius,
    targetRadius: target,
    dir,
    time: 0,
    heat: 0,
  };

  const fresh = !s.visited;
  s.visited = true;
  let gained = 0;
  if (fresh) {
    world.stats.captures++;
    if (perfect) {
      world.combo++;
      world.stats.perfects++;
      world.stats.bestCombo = Math.max(world.stats.bestCombo, world.combo);
    } else {
      world.combo = 0;
    }
    gained = 1 + (perfect ? world.combo : 0) + (s.kind === "giant" ? 2 : 0);
    world.score += gained;
    world.speed = Math.min(SIM.speedMax, SIM.speedStart + SIM.speedPerCapture * world.stats.captures);
  }

  world.events.push({
    type: "capture",
    starId: s.id,
    kind: s.kind,
    perfect: fresh && perfect,
    combo: world.combo,
    score: world.score,
    gained,
    zone: s.zone,
    count: world.stats.captures,
    pos: { x: comet.pos.x, y: comet.pos.y },
  });

  const zone = Math.floor(s.index / STARS_PER_ZONE);
  if (fresh && zone > world.zone) {
    world.zone = zone;
    world.events.push({ type: "zone", zone });
  }
  return true;
}

function collectShards(world: World): void {
  const p = world.comet.pos;
  const r2 = SIM.shardRadius * SIM.shardRadius;
  for (const sh of world.shards) {
    if (sh.taken) continue;
    const dx = sh.pos.x - p.x;
    const dy = sh.pos.y - p.y;
    if (dx * dx + dy * dy <= r2) {
      sh.taken = true;
      world.stats.shards++;
      world.events.push({ type: "shard", shardId: sh.id, total: world.stats.shards, pos: { x: sh.pos.x, y: sh.pos.y } });
    }
  }
}

function die(world: World, cause: DeathCause): void {
  world.comet.state = { mode: "dead", cause, time: 0 };
  world.combo = 0;
  world.events.push({ type: "death", cause, pos: { x: world.comet.pos.x, y: world.comet.pos.y }, score: world.score });
}
