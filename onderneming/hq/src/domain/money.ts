/** Geldhelpers. HQ rekent in euro's; Paperclip in (dollar)centen. */

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function usdCentsToEur(cents: number, usdToEur: number): number {
  return round2((cents / 100) * usdToEur);
}

/** Euro-budget → Paperclip-centen (naar boven afgerond, zodat een budget nooit kleiner uitvalt). */
export function eurToUsdCents(eur: number, usdToEur: number): number {
  return Math.ceil((eur / usdToEur) * 100);
}

const eurFormat = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });

export function formatEur(n: number): string {
  return eurFormat.format(round2(n));
}

/** "12,5%" */
export function formatPct(fraction: number): string {
  return `${round2(fraction * 100).toLocaleString("nl-NL")}%`;
}
