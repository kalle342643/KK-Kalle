// Zones: elke zone heeft een eigen kleur en toonsoort. Render, audio en UI lezen dit.

export interface ZoneTheme {
  /** Naam die groot in beeld komt bij binnenkomst. */
  name: string;
  /** Korte ondertitel. */
  tagline: string;
  /** Kleuren als hex-getal (0xRRGGBB). */
  colors: {
    /** Diepe achtergrond. */
    void: number;
    /** Nevel, eerste laag. */
    nebulaA: number;
    /** Nevel, tweede laag. */
    nebulaB: number;
    /** Kleur van een gewone ster. */
    star: number;
    /** Kleur van een vangring. */
    ring: number;
    /** Accent: combo, perfect, scherven. */
    accent: number;
    /** Staart van de komeet. */
    trail: number;
  };
  /** Muziek: grondtoon als MIDI-nootnummer en de toonladder als halve-toonstappen vanaf de grondtoon. */
  music: {
    root: number;
    scale: readonly number[];
    /** Tempo in BPM voor de puls. */
    bpm: number;
  };
}

export const ZONES: readonly ZoneTheme[] = [
  {
    name: "Aurora",
    tagline: "waar het licht begint",
    colors: {
      void: 0x03040c,
      nebulaA: 0x0b3a4a,
      nebulaB: 0x2a0f4d,
      star: 0x9ff6ff,
      ring: 0x5ee7ff,
      accent: 0xb7ff6a,
      trail: 0x7af0ff,
    },
    music: { root: 57, scale: [0, 2, 4, 7, 9], bpm: 96 },
  },
  {
    name: "Ember Reach",
    tagline: "sterren die nog gloeien",
    colors: {
      void: 0x0a0306,
      nebulaA: 0x4a1408,
      nebulaB: 0x3d0a2e,
      star: 0xffc38a,
      ring: 0xff8a4c,
      accent: 0xffe066,
      trail: 0xff9a5c,
    },
    music: { root: 55, scale: [0, 3, 5, 7, 10], bpm: 104 },
  },
  {
    name: "Glass Sea",
    tagline: "stil, helder, diep",
    colors: {
      void: 0x02060a,
      nebulaA: 0x0a2f3f,
      nebulaB: 0x0d1f4a,
      star: 0xdffcff,
      ring: 0x8fd8ff,
      accent: 0x7dffd2,
      trail: 0xbfefff,
    },
    music: { root: 60, scale: [0, 2, 4, 7, 11], bpm: 110 },
  },
  {
    name: "Violet Deep",
    tagline: "de nacht onder de nacht",
    colors: {
      void: 0x05020b,
      nebulaA: 0x2d0b52,
      nebulaB: 0x4a0b3a,
      star: 0xe3b8ff,
      ring: 0xc77dff,
      accent: 0xff7ad9,
      trail: 0xd49bff,
    },
    music: { root: 58, scale: [0, 2, 3, 7, 8], bpm: 116 },
  },
  {
    name: "Solar Choir",
    tagline: "iedereen zingt mee",
    colors: {
      void: 0x0a0702,
      nebulaA: 0x4a3208,
      nebulaB: 0x4a0f0a,
      star: 0xfff2b0,
      ring: 0xffd24c,
      accent: 0xffffff,
      trail: 0xffe28a,
    },
    music: { root: 62, scale: [0, 4, 5, 7, 9], bpm: 124 },
  },
  {
    name: "The Hush",
    tagline: "voorbij de laatste ster",
    colors: {
      void: 0x000000,
      nebulaA: 0x101828,
      nebulaB: 0x1c0c24,
      star: 0xffffff,
      ring: 0xa0a8ff,
      accent: 0xff4d6d,
      trail: 0xe8e8ff,
    },
    music: { root: 53, scale: [0, 1, 5, 7, 10], bpm: 132 },
  },
];

/** Aantal sterren per zone. */
export const STARS_PER_ZONE = 12;

export function zoneTheme(zone: number): ZoneTheme {
  const n = ZONES.length;
  const theme = ZONES[((zone % n) + n) % n];
  if (!theme) throw new Error("onmogelijke zone");
  return theme;
}

/** Hex-getal naar CSS-kleur. */
export function css(hex: number, alpha = 1): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
}
