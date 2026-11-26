// Kleine bouwstenen voor de UI: elementen maken, knoppen, beweging en gedeelde context.
import type { Settings, UiHandlers } from "../contracts";

export type Child = Node | string | null | undefined | false;
type AttrValue = string | number | boolean | null | undefined;

/** Element maken met attributen en kinderen. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, AttrValue> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === "class") el.className = String(value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

/** Inline SVG (vaste strings uit icons.ts) in een span. */
export function icon(svg: string, cls = "lu-ico"): HTMLSpanElement {
  const span = h("span", { class: cls, "aria-hidden": "true" });
  span.innerHTML = svg;
  return span;
}

/** Tekst alleen zetten als hij verandert. */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** Visueel verborgen, wel voorgelezen. */
export function srOnly(text = "", live = false): HTMLSpanElement {
  return h("span", { class: "lu-sr", "aria-live": live ? "polite" : null, "aria-atomic": live ? "true" : null }, text);
}

/** Veerachtige easing: een gedempte veer, bemonsterd als CSS linear(). Valt terug op een cubic-bezier. */
function springEasing(): string {
  const fallback = "cubic-bezier(.34,1.56,.64,1)";
  try {
    if (typeof CSS === "undefined" || !CSS.supports("transition-timing-function", "linear(0, 1)")) return fallback;
  } catch {
    return fallback;
  }
  const zeta = 0.52;
  const omega = 11;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const pts: string[] = [];
  const n = 36;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const decay = Math.exp(-zeta * omega * t);
    const x = i === n ? 1 : 1 - decay * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
    pts.push(x.toFixed(4));
  }
  return `linear(${pts.join(", ")})`;
}

/** Beweging via de Web Animations API, met een rustige variant voor reduced motion. */
export class Motion {
  reduced = false;
  readonly spring = springEasing();
  readonly out = "cubic-bezier(.16,1,.3,1)";

  play(el: Element, full: Keyframe[], calm: Keyframe[] | null, opts: KeyframeAnimationOptions): Animation | null {
    if (typeof el.animate !== "function") return null;
    const frames = this.reduced ? calm : full;
    if (!frames) return null;
    try {
      return el.animate(frames, opts);
    } catch {
      // Oude browser zonder linear(): zelfde beweging met een gewone easing.
      return el.animate(frames, { ...opts, easing: this.out });
    }
  }
}

/** Gedeelde context voor alle schermen. */
export interface Ctx {
  handlers: UiHandlers;
  motion: Motion;
  /** Tot dit tijdstip (performance.now) negeren knoppen een druk, tegen per-ongeluk-tikken na een dood. */
  guardUntil: number;
  settings(): Settings;
  /** Instelling wijzigen; roept onSettings aan en werkt de hele UI bij. */
  patchSettings(patch: Partial<Settings>): void;
}

interface ButtonOpts {
  cls: string;
  label?: string;
  aria?: string;
  attrs?: Record<string, AttrValue>;
  /** Geen klikgeluid (bijvoorbeeld als het knopje uitgeschakeld is). */
  silent?: () => boolean;
}

/** Knop met data-ui, klikgeluid en de bescherming tegen per-ongeluk-tikken. */
export function button(ctx: Ctx, opts: ButtonOpts, content: Child[], onPress: () => void): HTMLButtonElement {
  const el = h(
    "button",
    { type: "button", class: `lu-btn ${opts.cls}`, "data-ui": true, "aria-label": opts.aria ?? null, ...opts.attrs },
    ...content,
  );
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    if (performance.now() < ctx.guardUntil) return;
    if (el.getAttribute("aria-disabled") === "true") return;
    if (!opts.silent?.()) ctx.handlers.onClick();
    onPress();
  });
  return el;
}

/** Scherm tonen of verbergen; verborgen schermen zijn niet focusbaar. */
export function setShown(el: HTMLElement, on: boolean): void {
  el.classList.toggle("is-on", on);
  el.inert = !on;
  if (on) el.removeAttribute("aria-hidden");
  else el.setAttribute("aria-hidden", "true");
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
