// Richtlijn: waar kom je uit als je nu loslaat? Render tekent hiermee de richtlijn en laat de doelring oplichten.
// Rekent met een rechte lijn (zwarte gaten buigen de echte vlucht nog wat af).
import { SIM } from "./config";
import type { World } from "./types";

export interface AimPreview {
  /** Ster waarvan je de ring raakt, of null. */
  starId: number | null;
  /** Je raakt hem rakelings: PERFECT. */
  perfect: boolean;
  /** Je vliegt recht op een kern of horizon af. */
  danger: boolean;
  /** Afstand tot het eerste raakpunt (of de maximale vliegafstand). */
  distance: number;
}

const NONE: AimPreview = { starId: null, perfect: false, danger: false, distance: 0 };

export function aimPreview(world: World): AimPreview {
  const state = world.comet.state;
  if (state.mode !== "orbit") return NONE;
  const c = world.comet;
  const len = Math.hypot(c.vel.x, c.vel.y) || 1;
  const ux = c.vel.x / len;
  const uy = c.vel.y / len;

  let best: AimPreview = { starId: null, perfect: false, danger: false, distance: SIM.maxFlightDistance };
  for (const s of world.stars) {
    if (s.id === state.starId) continue;
    const rx = s.pos.x - c.pos.x;
    const ry = s.pos.y - c.pos.y;
    const along = rx * ux + ry * uy;
    if (along <= 0) continue;
    const b = Math.abs(rx * uy - ry * ux);
    if (s.kind === "blackhole") {
      if (b < s.core + 0.2) {
        const hit = along - Math.sqrt(Math.max(0, (s.core + 0.2) ** 2 - b * b));
        if (hit < best.distance) best = { starId: null, perfect: false, danger: true, distance: hit };
      }
      continue;
    }
    if (b > s.ring) continue;
    const hit = along - Math.sqrt(Math.max(0, s.ring * s.ring - b * b));
    if (hit >= best.distance) continue;
    const minOrbit = s.core * SIM.minOrbitFactor + SIM.minOrbitMargin;
    best = {
      starId: b < s.core ? null : s.id,
      perfect: b >= s.core && b <= minOrbit + SIM.perfectWindow,
      danger: b < s.core,
      distance: Math.max(0, hit),
    };
  }
  return best;
}
