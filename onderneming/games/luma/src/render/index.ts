// De renderer van LUMA: three.js met bloom en een eigen eindpass. Implementeert Renderer uit contracts.ts.
import { ACESFilmicToneMapping, Color, SRGBColorSpace, Scene, WebGLRenderer } from "three";
import type { FrameInfo, Quality, Renderer, Skin } from "../contracts";
import { SKINS } from "../contracts";
import { aimPreview, findStar, nextTarget } from "../sim";
import type { SimEvent, World } from "../sim/types";
import { Background } from "./background";
import { CameraRig } from "./camera";
import { Comet } from "./comet";
import { Effects } from "./effects";
import { P_DOT, P_FLICKER, P_GLINT, Particles } from "./particles";
import { Post } from "./post";
import { Stars, type StarFrame } from "./stars";
import { damp, zoneColors, type ZoneColors } from "./util";
import type { CometFrame } from "./comet";
import type { CameraFrame } from "./camera";

const ZONE_FADE = 2;
const PARTICLES = 7000;

function makeZoneColors(): ZoneColors {
  return {
    void: new Color(),
    nebulaA: new Color(),
    nebulaB: new Color(),
    star: new Color(),
    ring: new Color(),
    accent: new Color(),
    trail: new Color(),
  };
}

function copyZone(dst: ZoneColors, src: ZoneColors): void {
  dst.void.copy(src.void);
  dst.nebulaA.copy(src.nebulaA);
  dst.nebulaB.copy(src.nebulaB);
  dst.star.copy(src.star);
  dst.ring.copy(src.ring);
  dst.accent.copy(src.accent);
  dst.trail.copy(src.trail);
}

function lerpZone(dst: ZoneColors, a: ZoneColors, b: ZoneColors, t: number): void {
  dst.void.lerpColors(a.void, b.void, t);
  dst.nebulaA.lerpColors(a.nebulaA, b.nebulaA, t);
  dst.nebulaB.lerpColors(a.nebulaB, b.nebulaB, t);
  dst.star.lerpColors(a.star, b.star, t);
  dst.ring.lerpColors(a.ring, b.ring, t);
  dst.accent.lerpColors(a.accent, b.accent, t);
  dst.trail.lerpColors(a.trail, b.trail, t);
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  // three.js (r163+) kent alleen WebGL2: zonder WebGL2 geven we een duidelijke fout.
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: true,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    });
  } catch {
    gl = null;
  }
  if (!gl) throw new Error("LUMA needs WebGL2, which this browser or device does not offer.");

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, context: gl, antialias: false, powerPreference: "high-performance" });
  } catch (err) {
    throw new Error(`LUMA could not start WebGL: ${err instanceof Error ? err.message : String(err)}`);
  }
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 1);

  let quality: Quality = "high";
  let reduced = false;
  let width = Math.max(1, canvas.clientWidth || window.innerWidth || 1);
  let height = Math.max(1, canvas.clientHeight || window.innerHeight || 1);
  let pixelRatio = window.devicePixelRatio || 1;

  const scene = new Scene();
  const rig = new CameraRig();
  const background = new Background(scene);
  const stars = new Stars(scene, false);
  const effects = new Effects(scene);
  const comet = new Comet(scene);
  const particles = new Particles(PARTICLES);
  scene.add(particles.points);
  const post = new Post(renderer, scene, rig.camera, false);
  (window as unknown as { __dbg: unknown }).__dbg = { scene, post }; // DEBUG-REMOVE

  // Klokken: fx staat stil tijdens pauze, de achtergrond leeft altijd.
  let fxTime = 0;
  let bgTime = 0;
  let lastWorld: World | null = null;

  // Zonekleuren die overvloeien.
  let zone = 0;
  let zoneT = 1;
  const zoneFrom = makeZoneColors();
  const zoneMix = makeZoneColors();
  copyZone(zoneMix, zoneColors(0));
  let zonePulse = 0;

  // Schermeffecten.
  const flash = new Color(0, 0, 0);
  let desat = 0;
  let wave = 1;
  let caKick = 0;

  // Frametijd: gemiddelde over het laatste volle venster van ongeveer een seconde.
  let ftSum = 0;
  let ftCount = 0;
  let ftAvg = 16.7;

  const aimNeutral = new Color(0.55, 0.65, 0.8);
  const aimDanger = new Color(1, 0.12, 0.08);
  const aimColor = new Color();
  const tmpC = new Color();
  const white = new Color(1, 1, 1);

  const starFrame: StarFrame = {
    time: 0,
    dt: 0,
    cometX: 0,
    cometY: 0,
    flying: false,
    orbitStarId: -1,
    heat: 0,
    aimStarId: null,
    aimPerfect: false,
    aimDanger: false,
    camera: rig.camera,
    scale: 400,
  };
  const cometFrame: CometFrame = {
    time: 0,
    dt: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 1,
    alive: true,
    orbiting: true,
    orbitTime: 0,
    heat: 0,
    aim: false,
    aimColor,
    aimLock: false,
    aimPerfect: false,
    aimDanger: false,
    camera: rig.camera,
    particles,
  };
  const camFrame: CameraFrame = {
    dt: 0,
    time: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 1,
    mode: "orbit",
    hasTarget: false,
    targetX: 0,
    targetY: 0,
    title: true,
  };

  function lowQ(): boolean {
    return quality === "low";
  }

  function applySize(): void {
    const cap = lowQ() ? 1.25 : 2;
    const pr = Math.min(cap, Math.max(0.5, pixelRatio));
    renderer.setPixelRatio(pr);
    renderer.setSize(width, height, false);
    post.setSize(width, height, pr);
    background.setResolution(width * pr, height * pr);
    rig.setAspect(width / height);
  }

  function snapZone(z: number): void {
    zone = z;
    zoneT = 1;
    copyZone(zoneMix, zoneColors(z));
  }

  function resetAll(world: World): void {
    comet.reset();
    particles.clear();
    effects.clear();
    stars.clear();
    rig.snap();
    flash.setRGB(0, 0, 0);
    desat = 0;
    wave = 1;
    caKick = 0;
    snapZone(world.zone);
    lastWorld = world;
  }

  function addFlash(c: Color, amount: number): void {
    const k = reduced ? amount * 0.3 : amount;
    flash.r += c.r * k;
    flash.g += c.g * k;
    flash.b += c.b * k;
  }

  function handleEvent(ev: SimEvent, world: World, cx: number, cy: number): void {
    switch (ev.type) {
      case "capture": {
        const s = findStar(world, ev.starId);
        const zc = zoneColors(ev.zone);
        const sx = s ? s.pos.x : ev.pos.x;
        const sy = s ? s.pos.y : ev.pos.y;
        const ring = s ? s.ring : 3;
        const core = s ? s.core : 0.7;
        if (ev.perfect) {
          effects.wave(sx, sy, core, ring * 2.6, 0.85, 0.35, zc.accent, 2.4);
          effects.wave(sx, sy, core * 0.5, ring * 1.5, 0.6, 0.18, white, 1.6);
          particles.burst(ev.pos.x, ev.pos.y, 90, 3, 13, 1.1, zc.accent, 2.6, 0.26, P_GLINT, 2.4);
          particles.burst(sx, sy, 40, 1, 6, 1.4, zc.star, 2, 0.2, P_FLICKER, 1.6);
          addFlash(zc.accent, 0.16);
          caKick = Math.max(caKick, 1);
          stars.flashStar(ev.starId, 1);
          comet.pulse(0.9);
        } else {
          effects.wave(sx, sy, core, ring * 1.7, 0.65, 0.22, zc.ring, 1.5);
          particles.burst(ev.pos.x, ev.pos.y, 36, 2, 8, 0.8, zc.ring, 1.8, 0.2, P_DOT, 2.6);
          stars.flashStar(ev.starId, 0.6);
          comet.pulse(0.4);
        }
        const dx = sx - cx;
        const dy = sy - cy;
        const l = Math.sqrt(dx * dx + dy * dy) || 1;
        rig.kickCapture(ev.perfect ? 1 : 0.55, dx / l, dy / l);
        break;
      }
      case "release": {
        const zc = zoneColors(world.zone);
        const n = particles.count(16);
        for (let i = 0; i < n; i++) {
          const a = (Math.random() - 0.5) * 2.2;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const bx = -(ev.dir.x * ca - ev.dir.y * sa);
          const by = -(ev.dir.x * sa + ev.dir.y * ca);
          const sp = 1.5 + Math.random() * 3.5;
          particles.emit(ev.pos.x, ev.pos.y, 0.2, bx * sp, by * sp, 0, 0.35 + Math.random() * 0.35, zc.trail, 1.4, 0.16, 3, 0, P_DOT);
        }
        break;
      }
      case "shard": {
        const zc = zoneColors(world.zone);
        const n = particles.count(16);
        for (let i = 0; i < n; i++) {
          const life = 0.25 + Math.random() * 0.15;
          const jx = (Math.random() - 0.5) * 3;
          const jy = (Math.random() - 0.5) * 3;
          const vx = (cx - ev.pos.x) / life + jx + world.comet.vel.x * 0.6;
          const vy = (cy - ev.pos.y) / life + jy + world.comet.vel.y * 0.6;
          particles.emit(ev.pos.x, ev.pos.y, 0.3, vx, vy, 0, life, zc.accent, 2.6, 0.18, 0, 0, P_GLINT);
        }
        particles.burst(ev.pos.x, ev.pos.y, 10, 1, 4, 0.5, white, 2, 0.14, P_GLINT, 3);
        comet.pulse(0.3);
        break;
      }
      case "zone": {
        const zc = zoneColors(ev.zone);
        copyZone(zoneFrom, zoneMix);
        zone = ev.zone;
        zoneT = 0;
        wave = 0;
        post.u.uWaveColor.value.copy(zc.accent);
        zonePulse = 1;
        effects.wave(cx, cy, 1, 45, 1.8, 1.4, zc.accent, 1.6);
        effects.wave(cx, cy, 0.5, 30, 1.4, 0.5, zc.ring, 1.8);
        addFlash(zc.accent, 0.08);
        break;
      }
      case "nearMiss": {
        const zc = zoneColors(world.zone);
        stars.nearMiss(ev.starId);
        addFlash(zc.accent, 0.07);
        caKick = Math.max(caKick, 1.4);
        const v = world.comet.vel;
        const sp = Math.sqrt(v.x * v.x + v.y * v.y) || 1;
        const n = particles.count(34);
        for (let i = 0; i < n; i++) {
          const k = Math.random();
          const back = k * 3.5;
          const side = (Math.random() - 0.5) * 0.25;
          const px = ev.pos.x - (v.x / sp) * back - (v.y / sp) * side;
          const py = ev.pos.y - (v.y / sp) * back + (v.x / sp) * side;
          particles.emit(px, py, 0.25, v.x * 0.5, v.y * 0.5, 0, 0.25 + Math.random() * 0.25, k < 0.5 ? white : zc.accent, 2.4, 0.14, 4, 0, P_DOT);
        }
        comet.pulse(0.6);
        break;
      }
      case "death": {
        const v = world.comet.vel;
        comet.shatter(ev.pos.x, ev.pos.y, v.x, v.y, particles);
        effects.wave(ev.pos.x, ev.pos.y, 0.2, 9, 1.1, 0.5, tmpC.setRGB(1, 0.4, 0.3), 1.8);
        addFlash(tmpC.setRGB(1, 0.5, 0.4), 0.22);
        caKick = Math.max(caKick, 2);
        rig.shakeDeath();
        break;
      }
      case "heat":
      case "start":
        break;
    }
  }

  function frame(info: FrameInfo): void {
    const world = info.world;
    if (world !== lastWorld) resetAll(world);
    const realDt = Math.min(0.1, Math.max(0, info.dt));
    const paused = info.phase === "paused";
    const dt = paused ? 0 : realDt;
    fxTime += dt;
    bgTime += realDt;

    // Frametijd bijhouden.
    ftSum += realDt;
    ftCount++;
    if (ftSum >= 1) {
      ftAvg = (ftSum / ftCount) * 1000;
      ftSum = 0;
      ftCount = 0;
    } else if (ftCount > 0 && ftAvg === 16.7 && ftSum > 0.25) {
      ftAvg = (ftSum / ftCount) * 1000;
    }

    // Komeet tussen twee sim-stappen.
    const c = world.comet;
    const a = Math.min(1, Math.max(0, info.alpha));
    const cx = c.prev.x + (c.pos.x - c.prev.x) * a;
    const cy = c.prev.y + (c.pos.y - c.prev.y) * a;
    const state = c.state;
    const alive = state.mode !== "dead";
    const orbiting = state.mode === "orbit";

    for (let i = 0; i < info.events.length; i++) {
      const ev = info.events[i];
      if (ev) handleEvent(ev, world, cx, cy);
    }
    if (world.zone !== zone && zoneT >= 1) {
      // Zone veranderd zonder gebeurtenis: ook dan overvloeien.
      copyZone(zoneFrom, zoneMix);
      zone = world.zone;
      zoneT = 0;
    }
    if (zoneT < 1) {
      zoneT = Math.min(1, zoneT + realDt / ZONE_FADE);
      const e = zoneT * zoneT * (3 - 2 * zoneT);
      lerpZone(zoneMix, zoneFrom, zoneColors(zone), e);
    }
    zonePulse = damp(zonePulse, 0, 0.9, realDt);

    // Richtlijn.
    const playing = info.phase === "playing";
    const aim = orbiting && playing ? aimPreview(world) : null;
    const aimStar = aim && aim.starId !== null ? findStar(world, aim.starId) : undefined;
    if (aim && aim.danger) aimColor.copy(aimDanger);
    else if (aimStar && aim && aim.perfect) aimColor.copy(zoneColors(aimStar.zone).accent);
    else if (aimStar) aimColor.copy(zoneColors(aimStar.zone).ring);
    else aimColor.copy(aimNeutral);

    const heat = state.mode === "orbit" ? state.heat : 0;
    const scale = rig.pixelScale(height * Math.min(lowQ() ? 1.25 : 2, pixelRatio));

    // Camera.
    camFrame.dt = dt;
    camFrame.time = bgTime;
    camFrame.x = cx;
    camFrame.y = cy;
    camFrame.vx = c.vel.x;
    camFrame.vy = c.vel.y;
    camFrame.mode = state.mode;
    const target = orbiting ? nextTarget(world) : undefined;
    camFrame.hasTarget = target !== undefined;
    camFrame.targetX = target ? target.pos.x : 0;
    camFrame.targetY = target ? target.pos.y : 0;
    camFrame.title = info.phase === "title";
    rig.update(camFrame);

    // Sterren.
    starFrame.time = fxTime;
    starFrame.dt = dt;
    starFrame.cometX = cx;
    starFrame.cometY = cy;
    starFrame.flying = state.mode === "fly";
    starFrame.orbitStarId = state.mode === "orbit" ? state.starId : -1;
    starFrame.heat = heat;
    starFrame.aimStarId = aimStar ? aimStar.id : null;
    starFrame.aimPerfect = aim ? aim.perfect : false;
    starFrame.aimDanger = aim ? aim.danger : false;
    starFrame.scale = scale;
    stars.update(world, starFrame);

    // Komeet.
    particles.setFrame(fxTime, scale);
    cometFrame.time = fxTime;
    cometFrame.dt = dt;
    cometFrame.x = cx;
    cometFrame.y = cy;
    cometFrame.vx = c.vel.x;
    cometFrame.vy = c.vel.y;
    cometFrame.alive = alive;
    cometFrame.orbiting = orbiting;
    cometFrame.orbitTime = state.mode === "orbit" ? state.time : 0;
    cometFrame.heat = heat;
    cometFrame.aim = aim !== null;
    cometFrame.aimLock = aimStar !== undefined;
    cometFrame.aimPerfect = aim ? aim.perfect && aimStar !== undefined : false;
    cometFrame.aimDanger = aim ? aim.danger : false;
    comet.update(cometFrame);

    effects.update(dt);
    particles.flush();

    // Achtergrond.
    background.setColors(zoneMix, zonePulse);
    background.update(rig.camera, bgTime, scale);

    // Schermeffecten.
    const fd = Math.exp(-realDt * 7);
    flash.r *= fd;
    flash.g *= fd;
    flash.b *= fd;
    post.u.uFlash.value.copy(flash);
    desat = damp(desat, state.mode === "dead" ? 0.6 : 0, 2.5, realDt);
    post.u.uDesat.value = desat;
    if (wave < 1) wave = Math.min(1, wave + realDt / 1.6);
    post.u.uWave.value = wave;
    caKick = damp(caKick, 0, 4, realDt);
    post.u.uCA.value = 0.018 + (reduced ? 0.3 : 1) * caKick * 0.03;
    post.u.uTime.value = bgTime;
    post.u.uExposure.value = state.mode === "dead" ? 0.92 : 1;

    post.render(realDt);
  }

  applySize();
  comet.setSkin(SKINS[0] as Skin);

  return {
    frame,
    resize(w: number, h: number, pr: number): void {
      width = Math.max(1, Math.floor(w));
      height = Math.max(1, Math.floor(h));
      pixelRatio = pr > 0 ? pr : 1;
      applySize();
    },
    setSkin(skin: Skin): void {
      comet.setSkin(skin);
    },
    setQuality(q: Quality): void {
      if (q === quality) return;
      quality = q;
      const low = q === "low";
      post.setQuality(low);
      background.setQuality(low);
      particles.density = low ? 0.5 : 1;
      applySize();
    },
    setReducedMotion(on: boolean): void {
      reduced = on;
      rig.reducedMotion = on;
    },
    reset(world: World): void {
      resetAll(world);
    },
    frameTimeMs(): number {
      return ftAvg;
    },
    dispose(): void {
      background.dispose();
      stars.dispose();
      effects.dispose();
      comet.dispose();
      particles.dispose();
      post.dispose();
      renderer.dispose();
    },
  };
}
