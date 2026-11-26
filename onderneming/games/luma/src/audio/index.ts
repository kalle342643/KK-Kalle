// LUMA-audio: een komeet die zingt. Alles is gesynthetiseerd met de Web Audio API, er zijn geen geluidsbestanden.
// Vóór unlock() doet elke methode niets en gooit nooit een fout.
import type { AudioEngine, GamePhase, Settings } from "../contracts";
import type { SimEvent, World } from "../sim/types";
import { buildGraph, type Graph } from "./graph";
import { Music } from "./music";
import { Sfx } from "./sfx";
import { clamp, glide, realtime, taper } from "./util";

export interface AudioOptions {
  /** Eigen context, bijvoorbeeld een OfflineAudioContext om geluid te testen. */
  context?: BaseAudioContext;
}

/** Hoe ver de planner vooruit noten zet (s). */
const LOOKAHEAD = 0.16;
/** Wekker voor de planner als er even geen frames komen (ms); de noottijden komen altijd uit de AudioContext. */
const WAKE_MS = 50;

const DEFAULT_SETTINGS: Settings = { muted: false, musicVolume: 0.8, sfxVolume: 0.9, reducedMotion: false, quality: "high" };

/** Muziekbus en sfx-bus op vol volume (vóór de instelling). */
const MUSIC_LEVEL = 0.85;
const SFX_LEVEL = 1;

interface Core {
  ctx: BaseAudioContext;
  rt: AudioContext | null;
  graph: Graph;
  music: Music;
  sfx: Sfx;
}

type ContextCtor = new (opts?: AudioContextOptions) => AudioContext;

function contextCtor(): ContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: ContextCtor; webkitAudioContext?: ContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function createAudio(opts: AudioOptions = {}): AudioEngine {
  let core: Core | null = null;
  let owned = false;
  let unlocked = false;
  let disposed = false;
  let settings: Settings = { ...DEFAULT_SETTINGS };
  let zone = 0;
  let phase: GamePhase = "title";
  let phaseApplied: GamePhase | null = null;
  let intensity = 0;
  let wake: ReturnType<typeof setInterval> | null = null;
  let muteTimer: ReturnType<typeof setTimeout> | null = null;
  /** Web Audio werkt hier niet (te oude browser): niet steeds opnieuw proberen. */
  let broken = false;
  /** resume() vanuit een gebaar loopt nog: geluid mag al ingepland worden. */
  let resuming = false;

  const hidden = (): boolean => typeof document !== "undefined" && document.visibilityState === "hidden";

  function ensureCore(): Core | null {
    if (core) return core;
    if (broken) return null;
    let ctx = opts.context ?? null;
    try {
      if (!ctx) {
        const Ctor = contextCtor();
        if (!Ctor) {
          broken = true;
          return null;
        }
        ctx = new Ctor({ latencyHint: "interactive" });
        owned = true;
      }
      const graph = buildGraph(ctx, {
        music: MUSIC_LEVEL * taper(settings.musicVolume),
        sfx: SFX_LEVEL * taper(settings.sfxVolume),
        master: settings.muted ? 0 : 1,
      });
      const music = new Music(graph, zone);
      const sfx = new Sfx(graph, music);
      core = { ctx, rt: realtime(ctx), graph, music, sfx };
      return core;
    } catch {
      // Bijvoorbeeld geen ConstantSourceNode: dan blijft het spel stil, maar het draait.
      broken = true;
      const rt = ctx && owned ? realtime(ctx) : null;
      if (rt) rt.close().catch(() => undefined);
      return null;
    }
  }

  /** Mag er nu geluid gemaakt worden? */
  function live(c: Core | null): c is Core {
    if (!c || !unlocked || disposed || settings.muted) return false;
    if (!c.rt) return true;
    return c.rt.state === "running" || (resuming && !hidden());
  }

  /** Context laten lopen of stilzetten naar zichtbaarheid en dempen. */
  function syncRunning(): void {
    const c = core;
    if (!c?.rt || !unlocked || disposed) return;
    const rt = c.rt;
    if (rt.state === "closed") return;
    const want = !settings.muted && !hidden();
    if (want && rt.state !== "running") {
      rt.resume().catch(() => undefined);
    } else if (!want && rt.state === "running") {
      if (hidden()) {
        rt.suspend().catch(() => undefined);
      } else {
        // Gedempt: eerst uitfaden, dan stilzetten (spaart batterij).
        if (muteTimer) clearTimeout(muteTimer);
        muteTimer = setTimeout(() => {
          muteTimer = null;
          if (settings.muted && rt.state === "running") rt.suspend().catch(() => undefined);
        }, 300);
      }
    }
  }

  function onVisibility(): void {
    syncRunning();
  }

  function pump(): void {
    const c = core;
    if (!live(c)) return;
    const now = c.ctx.currentTime;
    c.music.tick(now, now + LOOKAHEAD);
  }

  function applySettings(c: Core): void {
    const now = c.ctx.currentTime;
    c.graph.music.level(MUSIC_LEVEL * taper(settings.musicVolume), now, 0.08);
    c.graph.sfx.level(SFX_LEVEL * taper(settings.sfxVolume), now, 0.08);
    glide(c.graph.master.gain, settings.muted ? 0 : 1, now, settings.muted ? 0.03 : 0.12);
  }

  function playSilence(rt: AudioContext): void {
    // iOS Safari: een stille buffer binnen de tik ontgrendelt de uitvoer.
    const b = rt.createBuffer(1, 1, rt.sampleRate);
    const s = rt.createBufferSource();
    s.buffer = b;
    s.connect(rt.destination);
    s.onended = () => s.disconnect();
    s.start(0);
  }

  function setZoneInner(z: number): void {
    if (!Number.isFinite(z)) return;
    const next = Math.max(0, Math.floor(z));
    if (next === zone) return;
    zone = next;
    if (core) core.music.setZone(next);
  }

  function intensityTarget(world: World): number {
    const prog = 1 - Math.exp(-Math.max(0, world.score) / 18);
    const combo = Math.min(world.combo, 5) / 5;
    const speed = clamp((world.speed - 7) / 6, 0, 1);
    return clamp(0.18 + 0.55 * prog + 0.12 * combo + 0.15 * speed, 0, 1);
  }

  return {
    async unlock(): Promise<void> {
      if (disposed) return;
      let resumed: Promise<void> | null = null;
      try {
        const c = ensureCore();
        if (!c) return;
        const first = !unlocked;
        unlocked = true;
        if (first) applySettings(c);
        if (c.rt && c.rt.state !== "closed") {
          // Alles hieronder gebeurt synchroon binnen het gebaar, vóór de eerste await.
          if (c.rt.state !== "running") playSilence(c.rt);
          if (!hidden() && c.rt.state !== "running") {
            resumed = c.rt.resume();
            resuming = true;
          }
          if (!wake && typeof setInterval === "function") wake = setInterval(pump, WAKE_MS);
          if (first && typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
          if (settings.muted) syncRunning();
        }
      } catch {
        return;
      }
      if (resumed) {
        try {
          await resumed;
        } catch {
          // Geweigerd buiten een gebaar: de volgende tik probeert het opnieuw.
        }
        resuming = false;
        // Gedempt tijdens het ontgrendelen: nu alsnog stilzetten.
        if (settings.muted) syncRunning();
      }
    },

    events(events: readonly SimEvent[], world: World): void {
      const c = core;
      if (!live(c) || events.length === 0) return;
      try {
        const now = c.ctx.currentTime;
        for (const e of events) {
          switch (e.type) {
            case "start":
              c.music.restore(now);
              setZoneInner(world.zone);
              intensity = Math.min(intensity, 0.2);
              c.sfx.start(now);
              break;
            case "capture":
              c.sfx.capture(e, now);
              break;
            case "release":
              c.sfx.release(e, now);
              break;
            case "shard":
              c.sfx.shard(e, now);
              break;
            case "zone":
              setZoneInner(e.zone);
              break;
            case "nearMiss":
              c.sfx.nearMiss(e, now);
              break;
            case "heat":
              c.sfx.heat(e, now);
              break;
            case "death":
              c.music.tapeStop(now);
              c.sfx.updateTension(0, c.music.currentKey(), now);
              c.sfx.death(e, now);
              intensity *= 0.5;
              break;
          }
        }
      } catch {
        // Geluid mag het spel nooit laten vastlopen.
      }
    },

    update(dt: number, world: World, ph: GamePhase): void {
      phase = ph;
      const c = core;
      if (!live(c)) return;
      try {
        const now = c.ctx.currentTime;
        if (phaseApplied !== phase) {
          c.music.setPhase(phase, now);
          phaseApplied = phase;
        }
        const step = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.25);
        const alive = world.comet.state.mode !== "dead";
        let target = intensity;
        if (phase === "playing") target = alive ? intensityTarget(world) : 0;
        else if (phase !== "paused") target = 0;
        const tau = target > intensity ? 2.5 : 1.2;
        intensity += (target - intensity) * (1 - Math.exp(-step / tau));
        c.music.intensity = intensity;
        c.music.tick(now, now + LOOKAHEAD);

        const st = world.comet.state;
        const heat = phase === "playing" && st.mode === "orbit" ? st.heat : 0;
        c.sfx.updateTension(heat, c.music.currentKey(), now);
      } catch {
        // Geluid mag het spel nooit laten vastlopen.
      }
    },

    setZone(z: number): void {
      if (disposed) return;
      setZoneInner(z);
    },

    setSettings(s: Settings): void {
      if (disposed) return;
      settings = {
        ...s,
        musicVolume: clamp(Number.isFinite(s.musicVolume) ? s.musicVolume : 0, 0, 1),
        sfxVolume: clamp(Number.isFinite(s.sfxVolume) ? s.sfxVolume : 0, 0, 1),
      };
      const c = core;
      if (!c || !unlocked) return;
      try {
        if (!settings.muted) syncRunning();
        applySettings(c);
        if (settings.muted) syncRunning();
      } catch {
        // negeren
      }
    },

    uiClick(): void {
      const c = core;
      if (!live(c)) return;
      try {
        c.sfx.click(c.ctx.currentTime);
      } catch {
        // negeren
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (wake) clearInterval(wake);
      wake = null;
      if (muteTimer) clearTimeout(muteTimer);
      muteTimer = null;
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
      const c = core;
      core = null;
      if (!c) return;
      try {
        c.sfx.stopAll();
        c.music.dispose();
        c.graph.dispose();
        if (owned && c.rt && c.rt.state !== "closed") c.rt.close().catch(() => undefined);
      } catch {
        // negeren
      }
    },
  };
}
