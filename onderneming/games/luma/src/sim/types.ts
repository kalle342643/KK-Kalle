// Gedeelde types van de simulatie. De simulatie is puur: geen DOM, geen three.js, geen audio.
// Render, audio en UI lezen deze types alleen.

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * normal    gewone ster: vang, draai, laat los.
 * pulse     de vangring ademt in en uit: timing.
 * mover     de ster schuift heen en weer; je baan schuift mee.
 * giant     grote ster, brede ring, bonuspunten, langzamer verval.
 * blackhole geen vangring: trekt je baan krom tijdens de vlucht; de horizon is dodelijk.
 */
export type StarKind = "normal" | "pulse" | "mover" | "giant" | "blackhole";

export interface Star {
  id: number;
  kind: StarKind;
  /** Rustpositie (voor movers het midden van de beweging). */
  base: Vec2;
  /** Huidige positie. */
  pos: Vec2;
  /** Straal van de kern: aanraken is dood. Voor een zwart gat: de horizon. */
  core: number;
  /** Huidige straal van de vangring (0 voor een zwart gat). */
  ring: number;
  /** Straal van de vangring in rust. */
  baseRing: number;
  /** Fase voor pulse/mover, radialen. */
  phase: number;
  /** Uitslag van een mover, wereldeenheden (0 voor de rest). */
  moveAmp: number;
  /** Hoeksnelheid van pulse/mover, rad/s. */
  freq: number;
  /** Zone waarin de ster ligt (kleur en toonsoort). */
  zone: number;
  /** Volgnummer: de hoeveelste ster van de run (0 = start). */
  index: number;
  /** Al eens gevangen. */
  visited: boolean;
  /** Invloedstraal van een zwart gat (0 voor de rest). */
  pull: number;
}

export interface Shard {
  id: number;
  pos: Vec2;
  taken: boolean;
  zone: number;
}

export type DeathCause = "void" | "star" | "blackhole" | "burnout";

export interface OrbitState {
  mode: "orbit";
  starId: number;
  /** Hoek ten opzichte van het middelpunt van de ster, radialen. */
  angle: number;
  /** Huidige straal. */
  radius: number;
  /** Straal waar de baan naartoe zakt na het vangen. */
  targetRadius: number;
  /** +1 tegen de klok in, -1 met de klok mee. */
  dir: 1 | -1;
  /** Seconden in deze baan. */
  time: number;
  /** 0..1: hoe dicht de baan bij opbranden is. */
  heat: number;
}

export interface FlyState {
  mode: "fly";
  /** Ster die je net verliet: die vangt je niet tot je zijn ring uit bent. */
  leftStarId: number | null;
  /** Seconden in de lucht. */
  time: number;
  /** Zwarte gaten waar je deze vlucht al rakelings langs scheerde. */
  nearIds: number[];
}

export interface DeadState {
  mode: "dead";
  cause: DeathCause;
  /** Seconden sinds de dood. */
  time: number;
}

export type CometState = OrbitState | FlyState | DeadState;

export interface Comet {
  pos: Vec2;
  /** Positie bij de vorige stap (voor interpolatie in render). */
  prev: Vec2;
  vel: Vec2;
  state: CometState;
}

export type SimEvent =
  | { type: "start"; seed: number }
  | {
      type: "capture";
      starId: number;
      kind: StarKind;
      perfect: boolean;
      combo: number;
      score: number;
      gained: number;
      zone: number;
      /** Hoeveelste gevangen ster van de run (1 = eerste na de start). */
      count: number;
      pos: Vec2;
    }
  | { type: "release"; starId: number; pos: Vec2; dir: Vec2 }
  | { type: "shard"; shardId: number; total: number; pos: Vec2 }
  | { type: "zone"; zone: number }
  | { type: "nearMiss"; starId: number; pos: Vec2 }
  | { type: "heat"; starId: number; heat: number }
  | { type: "death"; cause: DeathCause; pos: Vec2; score: number };

export interface SimInput {
  /** Tik/klik/spatie in deze stap. */
  tap: boolean;
}

export interface WorldStats {
  captures: number;
  perfects: number;
  bestCombo: number;
  shards: number;
  nearMisses: number;
  /** Seconden gespeeld. */
  time: number;
}

export interface World {
  seed: number;
  /** Interne toestand van de generator, zodat het vervolg van de wereld vastligt. */
  rngState: number;
  time: number;
  stars: Star[];
  shards: Shard[];
  comet: Comet;
  score: number;
  combo: number;
  zone: number;
  /** Lineaire snelheid van de komeet, eenheden/s. */
  speed: number;
  stats: WorldStats;
  /** Gebeurtenissen sinds de laatste drainEvents(). */
  events: SimEvent[];
  /** Volgende id's. */
  nextStarId: number;
  nextShardId: number;
  /** y-coördinaat tot waar de wereld gegenereerd is. */
  generatedTo: number;
  /** Laatste ster die gegenereerd is (index). */
  lastIndex: number;
}
