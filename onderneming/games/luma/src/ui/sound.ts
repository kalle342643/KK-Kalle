// Geluidsknop (aan/uit). Er kunnen er meer zijn (titel, pauze); de UI houdt ze gelijk via sync().
import { SOUND_OFF, SOUND_ON } from "./icons";
import { button, type Ctx } from "./kit";

export class SoundButton {
  readonly el: HTMLButtonElement;
  private muted: boolean | null = null;

  constructor(ctx: Ctx, cls: string) {
    this.el = button(ctx, { cls }, [], () => ctx.patchSettings({ muted: !ctx.settings().muted }));
    this.sync(ctx.settings().muted);
  }

  sync(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    this.el.innerHTML = "";
    const span = document.createElement("span");
    span.className = "lu-ico";
    span.setAttribute("aria-hidden", "true");
    span.innerHTML = muted ? SOUND_OFF : SOUND_ON;
    this.el.append(span);
    this.el.setAttribute("aria-label", "Sound");
    this.el.setAttribute("aria-pressed", String(!muted));
  }
}
