// Alle Engelse teksten van de UI op één plek.
import type { DeathCause } from "../sim/types";
import { zoneTheme } from "../theme";

export function zoneName(zone: number): string {
  return zoneTheme(zone).name;
}

export function zoneTagline(zone: number): string {
  return zoneTheme(zone).tagline;
}

export function causeLine(cause: DeathCause, zone: number): string {
  switch (cause) {
    case "burnout":
      return `Burned up in ${zoneName(zone)}`;
    case "void":
      return "Lost to the void";
    case "blackhole":
      return "Swallowed by a black hole";
    case "star":
      return "Flew into a star";
  }
}

/** "2026-11-26" naar "Nov 26". */
export function shortDate(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return key;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
  } catch {
    return key;
  }
}

/** Getal met duizendtal-scheiding. */
export function num(n: number): string {
  const v = Math.max(0, Math.floor(n));
  return v < 1000 ? String(v) : v.toLocaleString("en-US");
}
