// Muziektheorie per zone: toonladder, akkoorden en de vaste akkoordenreeks.
import { zoneTheme } from "../theme";

export interface Key {
  root: number;
  scale: readonly number[];
  bpm: number;
}

const FALLBACK: readonly number[] = [0, 2, 4, 7, 9];

export function keyFor(zone: number): Key {
  const m = zoneTheme(zone).music;
  return { root: m.root, scale: m.scale.length > 0 ? m.scale : FALLBACK, bpm: m.bpm };
}

/** MIDI-noot van trap i van de toonladder (mag negatief of boven de octaaf zijn). */
export function degree(key: Key, i: number): number {
  const n = key.scale.length;
  const oct = Math.floor(i / n);
  const idx = i - oct * n;
  return key.root + (key.scale[idx] ?? 0) + 12 * oct;
}

/** Akkoordenreeks in trappen: elk akkoord duurt twee maten. */
export const PROGRESSION: readonly number[] = [0, 4, 2, 3];

/** Drie akkoordtonen op trap d, gestapeld om de andere trap; halve-toonbotsingen worden een octaaf. */
export function chordTones(key: Key, d: number): [number, number, number] {
  const a = degree(key, d);
  let b = degree(key, d + 2);
  let c = degree(key, d + 4);
  if (clash(a, b)) b = a + 12;
  if (clash(a, c) || clash(b, c)) c = inScale(key, a + 7) ? a + 7 : a + 12;
  if (c === b) c = b + 12;
  return [a, b, c];
}

/** Grondtoon van het akkoord voor de baspuls, in het lage register (± G1..G2). */
export function bassNote(key: Key, d: number): number {
  let m = degree(key, d) - 24;
  while (m > 43) m -= 12;
  while (m < 31) m += 12;
  return m;
}

/** Drone onder het akkoord: grondtoon en (als die in de ladder past) de kwint. */
export function droneNotes(key: Key, d: number): [number, number] {
  const r = bassNote(key, d) + 12;
  return [r, inScale(key, r + 7) ? r + 7 : r + 12];
}

export function inScale(key: Key, midi: number): boolean {
  const pc = (((midi - key.root) % 12) + 12) % 12;
  return key.scale.includes(pc);
}

/** Leg een noot in het bereik [lo, hi] door octaven te verschuiven. */
export function fold(midi: number, lo: number, hi: number): number {
  let m = midi;
  while (m < lo) m += 12;
  while (m > hi) m -= 12;
  return m;
}

function clash(a: number, b: number): boolean {
  const d = Math.abs(a - b) % 12;
  return d === 1 || d === 11;
}
