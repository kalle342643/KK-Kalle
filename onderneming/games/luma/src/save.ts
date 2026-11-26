// Opslag in localStorage. Werkt ook als opslag geblokkeerd is (privévenster, artifact-preview): dan blijft alles in het geheugen.
import { SKINS, type SaveData, type Settings } from "./contracts";

const KEY = "luma.save.v1";

export function defaultSettings(): Settings {
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return { muted: false, musicVolume: 0.8, sfxVolume: 0.9, reducedMotion: reduced, quality: coarse ? "low" : "high" };
}

export function defaultSave(): SaveData {
  return {
    version: 1,
    best: 0,
    bestDaily: null,
    shards: 0,
    unlocked: ["spark"],
    skin: "spark",
    runs: 0,
    settings: defaultSettings(),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function num(v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** Lees en controleer: een kapotte of oude opslag geeft nooit een crash. */
export function parseSave(raw: string | null): SaveData {
  const base = defaultSave();
  if (!raw) return base;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return base;
  }
  if (!isRecord(data) || data.version !== 1) return base;
  const known = new Set(SKINS.map((s) => s.id));
  const unlocked = Array.isArray(data.unlocked)
    ? data.unlocked.filter((id): id is string => typeof id === "string" && known.has(id))
    : [];
  if (!unlocked.includes("spark")) unlocked.unshift("spark");
  const skin = typeof data.skin === "string" && unlocked.includes(data.skin) ? data.skin : "spark";
  const s = isRecord(data.settings) ? data.settings : {};
  const settings: Settings = {
    muted: typeof s.muted === "boolean" ? s.muted : base.settings.muted,
    musicVolume: num(s.musicVolume, base.settings.musicVolume, 0, 1),
    sfxVolume: num(s.sfxVolume, base.settings.sfxVolume, 0, 1),
    reducedMotion: typeof s.reducedMotion === "boolean" ? s.reducedMotion : base.settings.reducedMotion,
    quality: s.quality === "low" || s.quality === "high" ? s.quality : base.settings.quality,
  };
  const bd = isRecord(data.bestDaily) ? data.bestDaily : null;
  return {
    version: 1,
    best: Math.floor(num(data.best, 0)),
    bestDaily: bd && typeof bd.date === "string" ? { date: bd.date, score: Math.floor(num(bd.score, 0)) } : null,
    shards: Math.floor(num(data.shards, 0)),
    unlocked: [...new Set(unlocked)],
    skin,
    runs: Math.floor(num(data.runs, 0)),
    settings,
  };
}

export function loadSave(): SaveData {
  try {
    return parseSave(localStorage.getItem(KEY));
  } catch {
    return defaultSave();
  }
}

export function storeSave(save: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Opslag niet beschikbaar: het spel werkt gewoon door.
  }
}

/** Koop een skin. Geeft de nieuwe opslag terug, of null als het niet kan. */
export function buySkin(save: SaveData, id: string): SaveData | null {
  const skin = SKINS.find((s) => s.id === id);
  if (!skin || save.unlocked.includes(id) || save.shards < skin.cost) return null;
  return { ...save, shards: save.shards - skin.cost, unlocked: [...save.unlocked, id], skin: id };
}

export function selectSkin(save: SaveData, id: string): SaveData | null {
  if (!save.unlocked.includes(id)) return null;
  return { ...save, skin: id };
}

/** Verwerk een afgelopen run. */
export function recordRun(
  save: SaveData,
  run: { score: number; shards: number; mode: "endless" | "daily"; day: string },
): { save: SaveData; newBest: boolean } {
  let newBest = false;
  let best = save.best;
  let bestDaily = save.bestDaily;
  if (run.mode === "endless") {
    if (run.score > best) {
      best = run.score;
      newBest = run.score > 0;
    }
  } else {
    const prev = bestDaily && bestDaily.date === run.day ? bestDaily.score : -1;
    if (run.score > prev) {
      bestDaily = { date: run.day, score: run.score };
      newBest = run.score > Math.max(prev, 0);
    }
  }
  return {
    save: { ...save, best, bestDaily, shards: save.shards + run.shards, runs: save.runs + 1 },
    newBest,
  };
}
