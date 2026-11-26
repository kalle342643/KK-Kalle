// Pauzescherm: glazen paneel met RESUME, HOME en een snelle geluidsknop.
import { HOME, PLAY } from "./icons";
import { button, h, icon, setText, type Ctx } from "./kit";
import { SoundButton } from "./sound";
import { num } from "./text";

export class PausedScreen {
  readonly el: HTMLElement;
  readonly resume: HTMLButtonElement;
  readonly sound: SoundButton;
  private readonly score: HTMLElement;

  constructor(ctx: Ctx) {
    this.resume = button(ctx, { cls: "lu-primary" }, [icon(PLAY), "RESUME"], () => ctx.handlers.onResume());
    const home = button(ctx, { cls: "lu-ghost lu-glassy" }, [icon(HOME), "HOME"], () => ctx.handlers.onHome());
    this.sound = new SoundButton(ctx, "lu-round lu-glassy");
    this.score = h("div", { class: "lu-pz-score" }, "0");
    this.el = h(
      "section",
      { class: "lu-screen lu-center", role: "dialog", "aria-modal": "true", "aria-label": "Paused" },
      h(
        "div",
        { class: "lu-panel lu-glassy lu-in", "data-ui": true },
        h("div", { class: "lu-over" }, "Paused"),
        this.score,
        this.resume,
        h("div", { class: "lu-panel-row" }, home, this.sound.el),
        h("div", { class: "lu-pz-k" }, "press ", h("kbd", {}, "P"), " to resume"),
      ),
    );
  }

  update(score: number): void {
    setText(this.score, num(score));
  }
}
