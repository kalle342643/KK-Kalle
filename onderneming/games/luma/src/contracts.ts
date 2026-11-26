// Contracten tussen de onderdelen. main.ts verbindt ze; elk onderdeel kent alleen deze interfaces en de sim-types.
import type { SimEvent, World } from "./sim/types";

/** Kwaliteit van het beeld. "auto" zakt vanzelf als de framerate te laag is. */
export type Quality = "low" | "high";

export interface Settings {
  muted: boolean;
  musicVolume: number; // 0..1
  sfxVolume: number; // 0..1
  reducedMotion: boolean;
  quality: Quality;
}

/** Een uiterlijk voor de komeet, te kopen met scherven. */
export interface Skin {
  id: string;
  name: string;
  cost: number;
  /** Kern van de komeet. */
  core: number;
  /** Staart; bij twee kleuren loopt de staart van a naar b. */
  trailA: number;
  trailB: number;
  /** Bijzonder effect in de staart. */
  style: "smooth" | "sparkle" | "prism" | "ember" | "void";
}

export const SKINS: readonly Skin[] = [
  { id: "spark", name: "Spark", cost: 0, core: 0xffffff, trailA: 0x7af0ff, trailB: 0x7af0ff, style: "smooth" },
  { id: "dandelion", name: "Dandelion", cost: 40, core: 0xfff6d0, trailA: 0xffe28a, trailB: 0xff9a5c, style: "sparkle" },
  { id: "prism", name: "Prism", cost: 120, core: 0xffffff, trailA: 0xff5ec4, trailB: 0x5ee7ff, style: "prism" },
  { id: "ember", name: "Ember", cost: 220, core: 0xffd6a0, trailA: 0xff6a2a, trailB: 0xff2a6a, style: "ember" },
  { id: "eclipse", name: "Eclipse", cost: 400, core: 0x0a0a12, trailA: 0xc77dff, trailB: 0x1c0c24, style: "void" },
];

export interface SaveData {
  version: 1;
  best: number;
  bestDaily: { date: string; score: number } | null;
  shards: number;
  unlocked: string[];
  skin: string;
  runs: number;
  settings: Settings;
}

/** Wat render en audio per frame krijgen. */
export interface FrameInfo {
  world: World;
  /** 0..1: hoe ver tussen de vorige en de huidige sim-stap (voor vloeiende beweging). */
  alpha: number;
  /** Echte seconden sinds het vorige frame. */
  dt: number;
  /** Gebeurtenissen van dit frame. */
  events: readonly SimEvent[];
  /** Welke schermlaag actief is; op het titelscherm speelt de wereld als achtergrond. */
  phase: GamePhase;
}

export type GamePhase = "title" | "playing" | "paused" | "over";

export interface Renderer {
  /** Eén frame tekenen. */
  frame(info: FrameInfo): void;
  resize(width: number, height: number, pixelRatio: number): void;
  setSkin(skin: Skin): void;
  setQuality(q: Quality): void;
  setReducedMotion(on: boolean): void;
  /** Nieuwe run: wis staart, deeltjes en camera-sprongen. */
  reset(world: World): void;
  /** Gemiddelde frametijd in ms over de laatste seconde (voor automatische kwaliteit). */
  frameTimeMs(): number;
  dispose(): void;
}

export interface AudioEngine {
  /** Moet binnen een gebruikersactie (tik/klik) worden aangeroepen; daarna mag het geluid starten. */
  unlock(): Promise<void>;
  /** Gebeurtenissen uit de simulatie afspelen. */
  events(events: readonly SimEvent[], world: World): void;
  /** Elk frame: intensiteit van de muziek, 0..1 (uit score en combo). */
  update(dt: number, world: World, phase: GamePhase): void;
  setZone(zone: number): void;
  setSettings(settings: Settings): void;
  /** Klikgeluidje voor knoppen in menu's. */
  uiClick(): void;
  dispose(): void;
}

export interface UiHandlers {
  onPlay(mode: "endless" | "daily"): void;
  onRetry(): void;
  onHome(): void;
  onPause(): void;
  onResume(): void;
  onSettings(settings: Settings): void;
  onSelectSkin(id: string): void;
  onBuySkin(id: string): void;
  /** Elke knopdruk, voor het klikgeluid. */
  onClick(): void;
}

export interface GameOverInfo {
  score: number;
  best: number;
  newBest: boolean;
  mode: "endless" | "daily";
  stats: World["stats"];
  shardsEarned: number;
  shardsTotal: number;
  zoneReached: number;
  cause: import("./sim/types").DeathCause;
}

export interface Ui {
  showTitle(save: SaveData): void;
  showPlaying(mode: "endless" | "daily"): void;
  showPaused(): void;
  showGameOver(info: GameOverInfo, save: SaveData): void;
  /** Elk frame tijdens het spelen: score, combo, hitte. */
  hud(world: World, events: readonly SimEvent[]): void;
  /** Toon de zone-naam groot in beeld. */
  zoneBanner(zone: number): void;
  /** Werk winkel en scherven bij na een aankoop of keuze. */
  refreshSave(save: SaveData): void;
  dispose(): void;
}
