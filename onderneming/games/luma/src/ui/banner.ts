// Zone-banner: filmische titel in beeld, ~2.4 s, niet klikbaar.
import { h, setText, type Ctx } from "./kit";
import { zoneName, zoneTagline } from "./text";

export class Banner {
  readonly el: HTMLElement;
  private readonly over: HTMLElement;
  private readonly name: HTMLElement;
  private readonly tag: HTMLElement;
  private readonly line: HTMLElement;
  private anims: Animation[] = [];

  constructor(private readonly ctx: Ctx) {
    this.over = h("span", { class: "lu-banner-o" });
    this.line = h("span", { class: "lu-banner-l" });
    this.name = h("h2", { class: "lu-banner-n" });
    this.tag = h("span", { class: "lu-banner-t" });
    this.el = h("div", { class: "lu-banner", role: "status", "aria-live": "polite" }, this.over, this.line, this.name, this.tag);
  }

  show(zone: number): void {
    setText(this.over, `ZONE ${zone + 1}`);
    setText(this.name, zoneName(zone));
    setText(this.tag, zoneTagline(zone));
    this.stop();
    const m = this.ctx.motion;
    const dur = 2400;
    const out = m.out;
    const push = (anim: Animation | null): void => {
      if (anim) this.anims.push(anim);
    };
    push(
      m.play(
        this.el,
        [
          { opacity: 0, filter: "blur(14px)", transform: "scale(1.08)", easing: out },
          { opacity: 1, filter: "blur(0px)", transform: "scale(1)", offset: 0.24 },
          { opacity: 1, filter: "blur(0px)", transform: "scale(.985)", offset: 0.76, easing: "cubic-bezier(.5,0,.75,0)" },
          { opacity: 0, filter: "blur(10px)", transform: "scale(.96)" },
        ],
        [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }],
        { duration: dur },
      ),
    );
    push(
      m.play(
        this.line,
        [
          { transform: "scaleX(0)", opacity: 0, easing: out },
          { transform: "scaleX(1)", opacity: 1, offset: 0.4 },
          { transform: "scaleX(1.25)", opacity: 0 },
        ],
        null,
        { duration: dur },
      ),
    );
    push(
      m.play(
        this.tag,
        [
          { opacity: 0, transform: "translateY(6px)" },
          { opacity: 0, transform: "translateY(6px)", offset: 0.14, easing: out },
          { opacity: 1, transform: "translateY(0)", offset: 0.4 },
          { opacity: 1, transform: "translateY(0)" },
        ],
        null,
        { duration: dur },
      ),
    );
  }

  stop(): void {
    for (const a of this.anims) a.cancel();
    this.anims = [];
  }
}
