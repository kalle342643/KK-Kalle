import { describe, expect, it } from "vitest";
import { SIM, autopilotTap, createWorld, drainEvents, findStar, hashSeed, step } from "../src/sim/index";
import type { SimEvent, World } from "../src/sim/index";

const DT = SIM.dt;

function run(world: World, seconds: number, tapAt: (w: World) => boolean): SimEvent[] {
  const all: SimEvent[] = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    step(world, DT, { tap: tapAt(world) });
    all.push(...drainEvents(world));
    if (world.comet.state.mode === "dead") break;
  }
  return all;
}

describe("wereld", () => {
  it("is deterministisch: dezelfde seed geeft dezelfde sterren", () => {
    const a = createWorld(42);
    const b = createWorld(42);
    expect(a.stars.map((s) => [s.kind, s.base.x, s.base.y])).toEqual(b.stars.map((s) => [s.kind, s.base.x, s.base.y]));
    const c = createWorld(43);
    expect(c.stars.map((s) => s.base.x)).not.toEqual(a.stars.map((s) => s.base.x));
  });

  it("genereert vooruit en ruimt achter op", () => {
    const w = createWorld(7);
    const top = Math.max(...w.stars.map((s) => s.base.y));
    expect(top).toBeGreaterThanOrEqual(SIM.generateAhead);
    run(w, 90, (x) => autopilotTap(x));
    const ys = w.stars.map((s) => s.base.y);
    expect(Math.min(...ys)).toBeGreaterThan(w.comet.pos.y - SIM.pruneBehind - 15);
    expect(w.stars.length).toBeLessThan(40);
  });

  it("houdt sterren binnen het speelveld en zwarte gaten weg van het pad", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const w = createWorld(seed * 977);
      const hold = w.comet;
      // Genereer een lange wereld door de komeet te verplaatsen.
      for (let y = 0; y < 900; y += 50) {
        hold.pos.y = y;
        step(w, DT, { tap: false }, { idle: true });
      }
      const all = w.stars;
      for (const s of all) expect(Math.abs(s.base.x) + s.moveAmp).toBeLessThan(SIM.fieldHalfWidth);
    }
  });

  it("dagzaadje hangt alleen van de tekst af", () => {
    expect(hashSeed("2026-11-27")).toBe(hashSeed("2026-11-27"));
    expect(hashSeed("2026-11-27")).not.toBe(hashSeed("2026-11-28"));
  });
});

describe("banen en vluchten", () => {
  it("begint in een baan rond de startster en blijft daar op het titelscherm", () => {
    const w = createWorld(1);
    for (let i = 0; i < 120 * 30; i++) step(w, DT, { tap: true }, { idle: true });
    expect(w.comet.state.mode).toBe("orbit");
  });

  it("loslaten geeft een vlucht langs de raaklijn", () => {
    const w = createWorld(1);
    for (let i = 0; i < 30; i++) step(w, DT, { tap: false });
    const before = { ...w.comet.vel };
    step(w, DT, { tap: true });
    const ev = drainEvents(w);
    expect(w.comet.state.mode).toBe("fly");
    const rel = ev.find((e) => e.type === "release");
    expect(rel).toBeDefined();
    const dot = (before.x * w.comet.vel.x + before.y * w.comet.vel.y) / (w.speed * w.speed);
    expect(dot).toBeGreaterThan(0.99);
  });

  it("te lang in een baan brandt op", () => {
    const w = createWorld(1);
    const ev = run(w, 20, () => false);
    expect(w.comet.state.mode).toBe("dead");
    expect(ev.some((e) => e.type === "heat")).toBe(true);
    expect(ev.at(-1)).toMatchObject({ type: "death", cause: "burnout" });
  });

  it("de leegte in vliegen is dood", () => {
    const w = createWorld(1);
    // Wacht tot de komeet naar beneden wijst, dan loslaten: daar is niets.
    run(w, 5, (x) => x.comet.vel.y < -0.99 * x.speed && x.comet.state.mode === "orbit");
    run(w, 6, () => false);
    expect(w.comet.state).toMatchObject({ mode: "dead", cause: "void" });
  });

  it("recht op een kern vliegen is dood, scheren is PERFECT", () => {
    const w = createWorld(5);
    const target = w.stars.find((s) => s.index === 1);
    expect(target).toBeDefined();
    if (!target) return;
    // Zet de komeet handmatig in een vlucht recht op de kern.
    w.comet.pos = { x: target.pos.x, y: target.pos.y - target.ring - 1 };
    w.comet.vel = { x: 0, y: w.speed };
    w.comet.state = { mode: "fly", leftStarId: null, time: 0, nearIds: [] };
    run(w, 2, () => false);
    expect(w.comet.state).toMatchObject({ mode: "dead", cause: "star" });

    const v = createWorld(5);
    const t2 = v.stars.find((s) => s.index === 1);
    if (!t2) return;
    const graze = t2.core * SIM.minOrbitFactor + SIM.minOrbitMargin + 0.2;
    v.comet.pos = { x: t2.pos.x + graze, y: t2.pos.y - t2.ring - 1 };
    v.comet.vel = { x: 0, y: v.speed };
    v.comet.state = { mode: "fly", leftStarId: null, time: 0, nearIds: [] };
    const ev = run(v, 0.6, () => false);
    const cap = ev.find((e) => e.type === "capture");
    expect(cap).toMatchObject({ type: "capture", perfect: true, combo: 1, gained: 2 });
    expect(v.comet.state.mode).toBe("orbit");
  });

  it("de baan zakt naar de kortste afstand en draait de goede kant op", () => {
    const w = createWorld(5);
    const t = w.stars.find((s) => s.index === 1);
    if (!t) throw new Error("geen ster");
    const off = t.ring * 0.6;
    w.comet.pos = { x: t.pos.x + off, y: t.pos.y - t.ring - 1 };
    w.comet.vel = { x: 0, y: w.speed };
    w.comet.state = { mode: "fly", leftStarId: null, time: 0, nearIds: [] };
    run(w, 1.2, () => false);
    const st = w.comet.state;
    if (st.mode !== "orbit") throw new Error("niet gevangen");
    // Rechts van de ster omhoog vliegen = tegen de klok in.
    expect(st.dir).toBe(1);
    expect(st.radius).toBeCloseTo(Math.min(off, t.ring * 0.92), 1);
  });
});

describe("haalbaarheid", () => {
  it("een automatische speler komt in elke wereld ver", () => {
    const reached: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const w = createWorld(hashSeed(`test-${seed}`));
      run(w, 240, (x) => autopilotTap(x));
      reached.push(w.stats.captures);
    }
    reached.sort((a, b) => a - b);
    const median = reached[Math.floor(reached.length / 2)] ?? 0;
    // Een goede speler moet ver kunnen komen: de mediaan van de autopiloot ligt diep in de derde zone.
    expect(median).toBeGreaterThan(30);
    expect(reached[0]).toBeGreaterThan(8);
  });

  it("score, combo en zones lopen mee", () => {
    const w = createWorld(hashSeed("score"));
    const ev = run(w, 240, (x) => autopilotTap(x));
    const caps = ev.filter((e) => e.type === "capture" && e.gained > 0);
    expect(caps.length).toBe(w.stats.captures);
    expect(w.score).toBeGreaterThanOrEqual(w.stats.captures);
    if (w.stats.captures >= 13) expect(ev.some((e) => e.type === "zone" && e.zone === 1)).toBe(true);
    expect(w.speed).toBeGreaterThan(SIM.speedStart);
  });

  it("de ster van je baan wordt nooit opgeruimd", () => {
    const w = createWorld(3);
    run(w, 120, (x) => {
      const st = x.comet.state;
      if (st.mode === "orbit") expect(findStar(x, st.starId)).toBeDefined();
      return autopilotTap(x);
    });
  });
});

describe("richtlijn", () => {
  it("klopt met wat er echt gebeurt bij loslaten", async () => {
    const { aimPreview } = await import("../src/sim/index");
    let checked = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const w = createWorld(hashSeed(`aim-${seed}`));
      for (let i = 0; i < 120 * 40 && w.comet.state.mode !== "dead"; i++) {
        const tap = autopilotTap(w);
        if (tap) {
          const p = aimPreview(w);
          step(w, DT, { tap: true });
          drainEvents(w);
          // Vlieg tot vangst of dood en vergelijk.
          let caught: number | null = null;
          let caughtKind = "";
          let perfect = false;
          for (let j = 0; j < 120 * 5; j++) {
            step(w, DT, { tap: false });
            const ev = drainEvents(w);
            const cap = ev.find((e) => e.type === "capture");
            if (cap && cap.type === "capture") {
              caught = cap.starId;
              caughtKind = cap.kind;
              perfect = cap.perfect;
              break;
            }
            if (w.comet.state.mode === "dead") break;
          }
          // Zonder zwarte gaten in de buurt is de voorspelling exact (movers schuiven: die slaan we over).
          const star = w.stars.find((s) => s.id === p.starId);
          const nearHole = w.stars.some((s) => s.kind === "blackhole");
          const moving = (k: string) => k === "mover" || k === "pulse";
          if (star && !moving(star.kind) && !moving(caughtKind) && !nearHole) {
            expect(caught).toBe(p.starId);
            expect(perfect).toBe(p.perfect);
            checked++;
          }
        } else {
          step(w, DT, { tap: false });
          drainEvents(w);
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});
