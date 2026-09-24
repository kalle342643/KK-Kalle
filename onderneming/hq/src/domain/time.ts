/** Tijdhelpers voor lokale dagen (Europe/Amsterdam) zonder extra dependencies. */

const DAY_MS = 86_400_000;

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(instant: Date, timeZone: string): LocalParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Verschil tussen lokale tijd en UTC in minuten op dat moment (zomertijd telt mee). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** UTC-moment van lokale middernacht voor de dag waarin `instant` valt. */
export function startOfLocalDay(instant: Date, timeZone: string): Date {
  const p = localParts(instant, timeZone);
  const guess = Date.UTC(p.year, p.month - 1, p.day);
  let result = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  const check = offsetMinutes(new Date(result), timeZone);
  result = guess - check * 60_000;
  return new Date(result);
}

/** Lokale middernacht `days` dagen verderop (robuust rond zomertijdwissels). */
export function addLocalDays(dayStart: Date, days: number, timeZone: string): Date {
  return startOfLocalDay(new Date(dayStart.getTime() + days * DAY_MS + 12 * 3_600_000), timeZone);
}

/** "2026-09-23" in lokale tijd. */
export function localDayKey(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function startOfLocalMonth(instant: Date, timeZone: string): Date {
  const p = localParts(instant, timeZone);
  const firstOfMonth = new Date(Date.UTC(p.year, p.month - 1, 1, 12));
  return startOfLocalDay(firstOfMonth, timeZone);
}

export function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / DAY_MS;
}

const dateFmt = new Map<string, Intl.DateTimeFormat>();

/** "wo 23 sep" */
export function formatShortDate(instant: Date, timeZone: string): string {
  let f = dateFmt.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("nl-NL", { timeZone, weekday: "short", day: "numeric", month: "short" });
    dateFmt.set(timeZone, f);
  }
  return f.format(instant);
}

export function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * DAY_MS);
}
