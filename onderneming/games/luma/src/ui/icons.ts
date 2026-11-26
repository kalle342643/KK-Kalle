// Iconen als inline SVG: geen externe plaatjes. Ze erven de tekstkleur (currentColor).

const svg = (body: string, view = "0 0 24 24"): string =>
  `<svg viewBox="${view}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" focusable="false">${body}</svg>`;

/** Kristal (scherf): facetten met verschillende dekking. */
export const CRYSTAL = `<svg viewBox="0 0 24 24" focusable="false"><path d="M12 1.8 18.6 8.4 12 22.2 5.4 8.4Z" fill="currentColor" opacity=".28"/><path d="M12 1.8 18.6 8.4H12Z" fill="currentColor" opacity=".95"/><path d="M12 1.8 5.4 8.4H12Z" fill="currentColor" opacity=".6"/><path d="M5.4 8.4H12V22.2Z" fill="currentColor" opacity=".42"/><path d="M18.6 8.4H12V22.2Z" fill="currentColor" opacity=".78"/><path d="M12 1.8 18.6 8.4 12 22.2 5.4 8.4Z" fill="none" stroke="currentColor" stroke-width=".9" stroke-linejoin="round"/></svg>`;

export const PAUSE = svg(`<path d="M9 6.5v11M15 6.5v11" stroke-width="2.2"/>`);
export const PLAY = `<svg viewBox="0 0 24 24" focusable="false"><path d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10.2-6.4a.8.8 0 0 0 0-1.4L9.2 4.9a.8.8 0 0 0-1.2.7Z" fill="currentColor"/></svg>`;
export const HOME = svg(`<path d="M4 11.2 12 4.5l8 6.7"/><path d="M6.5 9.5V19h11V9.5"/><path d="M10.2 19v-4.6h3.6V19"/>`);
export const RETRY = svg(`<path d="M19.2 12a7.2 7.2 0 1 1-2.1-5.1"/><path d="M19.4 4.6v4.2h-4.2"/>`);
export const CLOSE = svg(`<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke-width="1.8"/>`);
export const GEAR = svg(
  `<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"/><circle cx="12" cy="12" r="6.6"/>`,
);
export const SOUND_ON = svg(
  `<path d="M4.5 9.5h3l4.5-3.8v12.6l-4.5-3.8h-3Z" fill="currentColor" fill-opacity=".18"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.5a8 8 0 0 1 0 11"/>`,
);
export const SOUND_OFF = svg(
  `<path d="M4.5 9.5h3l4.5-3.8v12.6l-4.5-3.8h-3Z" fill="currentColor" fill-opacity=".18"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>`,
);
/** Collectie: een komeet in een baan. */
export const COMET = svg(
  `<circle cx="12" cy="12" r="7.6" stroke-opacity=".35" stroke-dasharray="1.6 2.6"/><path d="M5.6 16.2A7.6 7.6 0 0 0 16.4 18.2" stroke-width="2.2" stroke-opacity=".7"/><circle cx="17.6" cy="17.1" r="2.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" opacity=".8"/>`,
);
export const CHECK = svg(`<path d="M5.5 12.5l4.2 4.2 8.8-9.4" stroke-width="2"/>`);
export const LOCK = svg(`<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.4"/><path d="M8.6 10.5V8a3.4 3.4 0 0 1 6.8 0v2.5"/>`);
export const SPARK = svg(`<path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/>`);
export const TAP = svg(
  `<circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="7" stroke-opacity=".55"/><circle cx="12" cy="12" r="10.4" stroke-opacity=".25"/>`,
);
