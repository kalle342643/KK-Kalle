// Automatische speler: voor het titelscherm (de wereld speelt zichzelf) en voor de tests (is elke wereld haalbaar?).
import { SIM } from "./config";
import { findStar } from "./world";
import type { Star, World } from "./types";

export interface AutopilotOptions {
  /** 0 = mikt op een PERFECT, 1 = mikt op het midden van de ring. */
  sloppiness?: number;
}

/** Volgende ster op het pad: de laagste index boven die van de huidige ster, geen zwart gat. */
export function nextTarget(world: World): Star | undefined {
  const state = world.comet.state;
  if (state.mode !== "orbit") return undefined;
  const current = findStar(world, state.starId);
  const fromIndex = current ? current.index : -1;
  let best: Star | undefined;
  for (const s of world.stars) {
    if (s.kind === "blackhole" || s.index <= fromIndex || s.visited) continue;
    if (!best || s.index < best.index) best = s;
  }
  return best;
}

/** Moet de automatische speler nu tikken? */
export function autopilotTap(world: World, opts: AutopilotOptions = {}): boolean {
  const state = world.comet.state;
  if (state.mode !== "orbit" || state.time < SIM.minOrbitTime + 0.15) return false;
  const target = nextTarget(world);
  if (!target) return false;
  const comet = world.comet;
  const speed = Math.hypot(comet.vel.x, comet.vel.y) || 1;
  const ux = comet.vel.x / speed;
  const uy = comet.vel.y / speed;

  // Waar staat het doel als we er zijn? Schat de vliegtijd en voorspel een mover.
  const dist = Math.hypot(target.pos.x - comet.pos.x, target.pos.y - comet.pos.y);
  const eta = Math.max(0, dist - target.ring) / world.speed;
  const aim = predict(target, eta);

  const rx = aim.x - comet.pos.x;
  const ry = aim.y - comet.pos.y;
  const along = rx * ux + ry * uy;
  if (along <= 0) return false;
  const b = Math.abs(rx * uy - ry * ux);
  const minOrbit = target.core * SIM.minOrbitFactor + SIM.minOrbitMargin;
  // Hoe heter de baan, hoe minder kieskeurig: liever een gewone vangst dan opbranden.
  const sloppy = Math.min(1, Math.max(opts.sloppiness ?? 0, (state.heat - 0.45) * 2));
  const ideal = minOrbit + SIM.perfectWindow * 0.5 + sloppy * Math.max(0, target.baseRing * 0.6 - minOrbit);
  const tolerance = 0.22 + sloppy * 0.5;
  if (Math.abs(b - ideal) > tolerance) return false;
  if (along - target.ring > SIM.maxFlightDistance * 0.9) return false;

  // Niets dodelijks onderweg.
  for (const s of world.stars) {
    if (s.id === target.id || s.id === state.starId) continue;
    const sx = s.pos.x - comet.pos.x;
    const sy = s.pos.y - comet.pos.y;
    const a = sx * ux + sy * uy;
    if (a <= 0 || a > along) continue;
    const off = Math.abs(sx * uy - sy * ux);
    const danger = s.kind === "blackhole" ? s.pull * 0.75 : s.core + 0.3;
    if (off < danger) return false;
  }
  return true;
}

function predict(s: Star, t: number): { x: number; y: number } {
  if (s.kind !== "mover") return s.pos;
  return { x: s.base.x + s.moveAmp * Math.sin(s.phase + s.freq * t), y: s.base.y };
}
