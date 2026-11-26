// LUMA: verbindt simulatie, beeld, geluid en UI. Vaste simulatiestap, vloeiend tekenen ertussen.
import { createAudio } from "./audio/index";
import { SKINS, type AudioEngine, type GamePhase, type Renderer, type SaveData, type Settings } from "./contracts";
import { createPlatform } from "./platform/index";
import { createRenderer } from "./render/index";
import { buySkin, loadSave, recordRun, selectSkin, storeSave } from "./save";
import { SIM, autopilotTap, createWorld, dayKey, drainEvents, hashSeed, step } from "./sim/index";
import type { SimEvent, World } from "./sim/index";
import { createUi } from "./ui/index";

type Mode = "endless" | "daily";

const params = new URLSearchParams(location.search);
/** ?autoplay: de autopiloot speelt ook tijdens een run (voor speeltests en opnames). */
const AUTOPLAY = params.has("autoplay");
const FIXED_SEED = params.has("seed") ? hashSeed(params.get("seed") ?? "") : null;

const canvas = document.getElementById("luma-canvas");
const uiRoot = document.getElementById("luma-ui");
if (!(canvas instanceof HTMLCanvasElement) || !(uiRoot instanceof HTMLElement)) throw new Error("pagina mist canvas of ui");

let save: SaveData = loadSave();
const platform = createPlatform();

let renderer: Renderer;
try {
  renderer = createRenderer(canvas);
} catch (err) {
  showFatal(err);
  throw err;
}
const audio: AudioEngine = createAudio();

let phase: GamePhase = "title";
let mode: Mode = "endless";
let world: World = createWorld(FIXED_SEED ?? randomSeed());
let tapQueued = false;
let accumulator = 0;
let last = performance.now();
let timeScale = 1;
let slowUntil = 0;
let deathAt = -1;
let qualityStrikes = 0;

const ui = createUi(uiRoot, {
  onPlay: (m) => void startRun(m),
  onRetry: () => void startRun(mode),
  onHome: () => goHome(),
  onPause: () => pause(),
  onResume: () => resume(),
  onSettings: (s) => applySettings(s, true),
  onSelectSkin: (id) => {
    const next = selectSkin(save, id);
    if (next) updateSave(next);
  },
  onBuySkin: (id) => {
    const next = buySkin(save, id);
    if (next) updateSave(next);
  },
  onClick: () => audio.uiClick(),
});

applySettings(save.settings, false);
applySkin();
resize();
renderer.reset(world);
ui.showTitle(save);
audio.setZone(0);
void platform.ready();

// --- invoer ---------------------------------------------------------------------------------

function isUiTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-ui]") !== null;
}

window.addEventListener(
  "pointerdown",
  (e) => {
    if (isUiTarget(e.target)) return;
    void audio.unlock();
    if (phase === "playing") {
      tapQueued = true;
      e.preventDefault();
    }
  },
  { passive: false },
);

// Geen Escape: dat sluit op CrazyGames het volledige scherm. Pauze is P of de knop.
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const playKey = e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW";
  if (phase === "playing") {
    if (playKey || (e.code === "Enter" && !isUiTarget(e.target))) {
      void audio.unlock();
      tapQueued = true;
      e.preventDefault();
    } else if (e.code === "KeyP") {
      pause();
      e.preventDefault();
    }
  } else if (phase === "paused" && e.code === "KeyP") {
    resume();
    e.preventDefault();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && phase === "playing") pause();
});
window.addEventListener("blur", () => {
  if (phase === "playing" && !AUTOPLAY) pause();
});
window.addEventListener("resize", resize);
window.visualViewport?.addEventListener("resize", resize);

// --- fasen ----------------------------------------------------------------------------------

function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] ?? Date.now() >>> 0;
}

function today(): string {
  return dayKey(new Date());
}

async function startRun(next: Mode): Promise<void> {
  void audio.unlock();
  mode = next;
  const seed = FIXED_SEED ?? (mode === "daily" ? hashSeed(`luma-daily-${today()}`) : randomSeed());
  world = createWorld(seed);
  renderer.reset(world);
  accumulator = 0;
  tapQueued = false;
  timeScale = 1;
  slowUntil = 0;
  deathAt = -1;
  phase = "playing";
  audio.setZone(0);
  ui.showPlaying(mode);
  platform.gameplayStart();
}

function goHome(): void {
  phase = "title";
  world = createWorld(randomSeed());
  renderer.reset(world);
  audio.setZone(0);
  ui.showTitle(save);
  platform.gameplayStop();
}

function pause(): void {
  if (phase !== "playing") return;
  phase = "paused";
  ui.showPaused();
  platform.gameplayStop();
}

function resume(): void {
  if (phase !== "paused") return;
  phase = "playing";
  last = performance.now();
  accumulator = 0;
  tapQueued = false;
  ui.showPlaying(mode);
  platform.gameplayStart();
}

function gameOver(): void {
  const state = world.comet.state;
  if (state.mode !== "dead") return;
  const day = today();
  const result = recordRun(save, { score: world.score, shards: world.stats.shards, mode, day });
  updateSave(result.save, false);
  phase = "over";
  platform.gameplayStop();
  if (result.newBest) platform.happy();
  ui.showGameOver(
    {
      score: world.score,
      best: mode === "daily" ? (save.bestDaily?.date === day ? save.bestDaily.score : world.score) : save.best,
      newBest: result.newBest,
      mode,
      stats: { ...world.stats },
      shardsEarned: world.stats.shards,
      shardsTotal: save.shards,
      zoneReached: world.zone,
      cause: state.cause,
    },
    save,
  );
}

function updateSave(next: SaveData, refresh = true): void {
  save = next;
  storeSave(save);
  applySkin();
  if (refresh) ui.refreshSave(save);
}

function applySettings(settings: Settings, persist: boolean): void {
  renderer.setQuality(settings.quality);
  renderer.setReducedMotion(settings.reducedMotion);
  audio.setSettings(settings);
  if (persist) updateSave({ ...save, settings });
}

function applySkin(): void {
  const skin = SKINS.find((s) => s.id === save.skin) ?? SKINS[0];
  if (skin) renderer.setSkin(skin);
}

function resize(): void {
  const vv = window.visualViewport;
  const w = Math.round(vv?.width ?? window.innerWidth);
  const h = Math.round(vv?.height ?? window.innerHeight);
  renderer.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
}

// --- lus ------------------------------------------------------------------------------------

function handleEvents(events: readonly SimEvent[], now: number): void {
  for (const e of events) {
    switch (e.type) {
      case "capture":
        if (e.perfect && !save.settings.reducedMotion) {
          timeScale = 0.55;
          slowUntil = now + 170;
        }
        break;
      case "zone":
        if (phase === "playing") ui.zoneBanner(e.zone);
        audio.setZone(e.zone);
        break;
      case "death":
        deathAt = now;
        timeScale = 0.35;
        slowUntil = now + 650;
        break;
      default:
        break;
    }
  }
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const realDt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;

  if (now > slowUntil) timeScale += (1 - timeScale) * Math.min(1, realDt * 8);
  const simulate = phase === "playing" || phase === "title" || phase === "over";
  const events: SimEvent[] = [];

  if (simulate) {
    accumulator += realDt * timeScale;
    let steps = 0;
    while (accumulator >= SIM.dt && steps < 12) {
      const title = phase === "title";
      const auto = title || AUTOPLAY;
      const tap = phase === "playing" && (tapQueued || (auto && autopilotTap(world)));
      const titleTap = title && autopilotTap(world, { sloppiness: 0.25 });
      step(world, SIM.dt, { tap: tap || titleTap });
      if (tap) tapQueued = false;
      events.push(...drainEvents(world));
      accumulator -= SIM.dt;
      steps++;
    }
    if (steps === 12) accumulator = 0;
  }

  handleEvents(events, now);
  audio.events(events, world);
  audio.update(realDt, world, phase);

  const alpha = simulate ? Math.min(1, accumulator / SIM.dt) : 1;
  renderer.frame({ world, alpha, dt: realDt, events, phase });
  if (phase === "playing") ui.hud(world, events);

  // Titelscherm: de wereld speelt zichzelf; na een val begint hij stil opnieuw.
  if (phase === "title" && world.comet.state.mode === "dead" && world.comet.state.time > 1.4) {
    world = createWorld(randomSeed());
    renderer.reset(world);
  }
  if (phase === "playing" && deathAt > 0 && now - deathAt > 900) {
    deathAt = -1;
    gameOver();
  }

  autoQuality();
}

/** Zakt de framerate lang onder de 40 fps, dan schakelt het beeld één keer terug naar "low". */
function autoQuality(): void {
  if (save.settings.quality === "low") return;
  if (renderer.frameTimeMs() > 25) qualityStrikes++;
  else qualityStrikes = Math.max(0, qualityStrikes - 2);
  if (qualityStrikes > 240) {
    qualityStrikes = 0;
    applySettings({ ...save.settings, quality: "low" }, true);
    ui.refreshSave(save);
  }
}

requestAnimationFrame((t) => {
  last = t;
  frame(t);
});

function showFatal(err: unknown): void {
  const msg = document.createElement("div");
  msg.setAttribute(
    "style",
    "position:fixed;inset:0;display:grid;place-items:center;color:#cfe;font:16px system-ui;text-align:center;padding:24px",
  );
  msg.textContent = "LUMA needs WebGL to shine. Try another browser or enable hardware acceleration.";
  document.body.appendChild(msg);
  console.error(err);
}

if (params.has("debug")) {
  (globalThis as unknown as { __luma: unknown }).__luma = {
    get world() {
      return world;
    },
    get phase() {
      return phase;
    },
    start: (m: Mode) => startRun(m),
    tap: () => {
      tapQueued = true;
    },
  };
}
