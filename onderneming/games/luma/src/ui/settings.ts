// Instellingen: geluid, volumes, rustige beweging en beeldkwaliteit. Elke wijziging gaat meteen naar onSettings.
import type { Quality, Settings } from "../contracts";
import { button, h, type Ctx } from "./kit";
import { Sheet } from "./sheet";

interface Slider {
  input: HTMLInputElement;
  value: HTMLElement;
}

export class SettingsSheet {
  readonly sheet: Sheet;
  private readonly mute: HTMLButtonElement;
  private readonly calm: HTMLButtonElement;
  private readonly music: Slider;
  private readonly sfx: Slider;
  private readonly quality: Record<Quality, HTMLButtonElement>;

  constructor(ctx: Ctx, onClose: () => void) {
    this.sheet = new Sheet(ctx, "settings", "Settings", [], onClose, "lu-settings");

    // Schakelaar; bij "Sound" betekent aan juist muted = false.
    const toggle = (label: string, key: "muted" | "reducedMotion"): HTMLButtonElement =>
      button(ctx, { cls: "lu-switch", attrs: { role: "switch", "aria-label": label } }, [], () => {
        ctx.patchSettings({ [key]: !ctx.settings()[key] });
      });
    this.mute = toggle("Sound", "muted");
    this.calm = toggle("Reduced motion", "reducedMotion");

    const slider = (label: string, key: "musicVolume" | "sfxVolume"): Slider => {
      const input = h("input", {
        type: "range",
        class: "lu-range",
        min: 0,
        max: 100,
        step: 1,
        "aria-label": label,
        "data-ui": true,
      });
      const value = h("span", { class: "lu-row-v", "aria-hidden": "true" });
      input.addEventListener("input", () => {
        const v = Number(input.value) / 100;
        paint({ input, value }, v);
        ctx.patchSettings({ [key]: v });
      });
      // Pijltjes en Home/End horen bij de schuif, niet bij het spel.
      input.addEventListener("keydown", (e) => e.stopPropagation());
      return { input, value };
    };
    this.music = slider("Music volume", "musicVolume");
    this.sfx = slider("Effects volume", "sfxVolume");

    const seg = (q: Quality, label: string): HTMLButtonElement =>
      button(ctx, { cls: "", attrs: { role: "radio" } }, [label], () => ctx.patchSettings({ quality: q }));
    this.quality = { low: seg("low", "Low"), high: seg("high", "High") };

    const row = (label: string, sub: string | null, control: HTMLElement): HTMLElement =>
      h("div", { class: "lu-row" }, h("div", { class: "lu-row-l" }, h("b", {}, label), sub ? h("span", {}, sub) : null), control);

    this.sheet.body.append(
      h(
        "div",
        { class: "lu-rows" },
        row("Sound", null, this.mute),
        row("Music", null, h("div", { class: "lu-slide" }, this.music.input, this.music.value)),
        row("Effects", null, h("div", { class: "lu-slide" }, this.sfx.input, this.sfx.value)),
        row("Reduced motion", "calmer effects and menus", this.calm),
        row(
          "Quality",
          "lower saves battery",
          h("div", { class: "lu-seg", role: "radiogroup", "aria-label": "Quality" }, this.quality.low, this.quality.high),
        ),
      ),
      h("p", { class: "lu-credits" }, h("b", {}, "LUMA"), " · made by KK Holding"),
    );
  }

  get el(): HTMLElement {
    return this.sheet.el;
  }

  update(s: Settings): void {
    this.mute.setAttribute("aria-checked", String(!s.muted));
    this.calm.setAttribute("aria-checked", String(s.reducedMotion));
    // Tijdens slepen niet terugzetten: dan springt de schuif.
    if (document.activeElement !== this.music.input) paint(this.music, s.musicVolume);
    if (document.activeElement !== this.sfx.input) paint(this.sfx, s.sfxVolume);
    this.music.input.disabled = s.muted;
    this.sfx.input.disabled = s.muted;
    for (const q of ["low", "high"] as const) this.quality[q].setAttribute("aria-checked", String(s.quality === q));
  }
}

function paint(slider: Slider, v: number): void {
  const pct = Math.round(Math.min(1, Math.max(0, v)) * 100);
  if (slider.input.value !== String(pct)) slider.input.value = String(pct);
  slider.input.style.setProperty("--v", `${pct}%`);
  slider.value.textContent = `${pct}%`;
}
