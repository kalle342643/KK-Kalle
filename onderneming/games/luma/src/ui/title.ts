// Titelscherm: logo, beste score, PLAY, DAILY en de knoppen voor collectie, instellingen en geluid.
import type { SaveData } from "../contracts";
import { dayKey } from "../sim/rng";
import { COMET, CRYSTAL, GEAR, PLAY } from "./icons";
import { button, h, icon, setText, type Ctx } from "./kit";
import { SoundButton } from "./sound";
import { num, shortDate } from "./text";

export interface TitleActions {
  openCollection(opener: HTMLElement): void;
  openSettings(opener: HTMLElement): void;
}

export class TitleScreen {
  readonly el: HTMLElement;
  readonly play: HTMLButtonElement;
  private readonly best: HTMLElement;
  private readonly bestNum: HTMLElement;
  private readonly wallet: HTMLButtonElement;
  private readonly walletNum: HTMLElement;
  private readonly dailyDate: HTMLElement;
  private readonly dailyBest: HTMLElement;
  private readonly daily: HTMLButtonElement;
  readonly sound: SoundButton;

  constructor(ctx: Ctx, actions: TitleActions) {
    this.walletNum = h("span", {}, "0");
    this.wallet = button(
      ctx,
      { cls: "lu-chip lu-glassy lu-wallet", aria: "Collection" },
      [icon(COMET, "lu-ico lu-ico-c"), h("span", { class: "lu-sep" }), icon(CRYSTAL, "lu-ico lu-crystal"), this.walletNum],
      () => actions.openCollection(this.wallet),
    );
    const settings = button(ctx, { cls: "lu-round lu-glassy", aria: "Settings" }, [icon(GEAR)], () =>
      actions.openSettings(settings),
    );
    this.sound = new SoundButton(ctx, "lu-round lu-glassy");

    const logo = h("h1", { class: "lu-logo", "aria-label": "LUMA" });
    "LUMA".split("").forEach((ch, i) => logo.append(h("span", { "aria-hidden": "true", style: `--i:${i}` }, ch)));

    this.bestNum = h("span", {}, "0");
    this.best = h("div", { class: "lu-best lu-in", style: "--i:3" }, h("span", { class: "lu-over" }, "Best"), this.bestNum);

    this.play = button(ctx, { cls: "lu-primary", aria: "Play" }, [icon(PLAY), "PLAY"], () => ctx.handlers.onPlay("endless"));
    this.dailyDate = h("span", {});
    this.dailyBest = h("b", {});
    this.daily = button(
      ctx,
      { cls: "lu-glassy lu-daily" },
      [
        h("span", { class: "lu-daily-l" }, h("span", { class: "lu-daily-dot" }), h("span", { class: "lu-daily-k" }, "DAILY")),
        h("span", { class: "lu-daily-v" }, this.dailyDate, this.dailyBest),
      ],
      () => ctx.handlers.onPlay("daily"),
    );

    this.el = h(
      "section",
      { class: "lu-screen lu-title", "aria-label": "LUMA" },
      h(
        "div",
        { class: "lu-topbar lu-in", style: "--i:0" },
        this.wallet,
        h("div", { class: "lu-topbar-r" }, this.sound.el, settings),
      ),
      h(
        "div",
        { class: "lu-hero" },
        h("div", { class: "lu-in", style: "--i:1" }, logo),
        h("p", { class: "lu-tagline lu-in", style: "--i:2" }, "every orbit is a note"),
        this.best,
      ),
      h(
        "div",
        { class: "lu-actions" },
        h("div", { class: "lu-in", style: "--i:4;width:100%;display:grid;justify-items:center" }, this.play),
        h("div", { class: "lu-in", style: "--i:5;width:100%;display:grid;justify-items:center" }, this.daily),
        h("div", { class: "lu-tip lu-in", style: "--i:6" }, "tap · release · sing"),
        h(
          "div",
          { class: "lu-keys lu-in", style: "--i:7" },
          h("kbd", {}, "Space"),
          " release  ·  ",
          h("kbd", {}, "P"),
          " pause",
        ),
      ),
    );
  }

  update(save: SaveData): void {
    setText(this.bestNum, num(save.best));
    this.best.hidden = save.best <= 0;
    setText(this.walletNum, num(save.shards));
    this.wallet.setAttribute("aria-label", `Collection, ${save.shards} shards`);
    const today = dayKey(new Date());
    setText(this.dailyDate, shortDate(today));
    const todayBest = save.bestDaily && save.bestDaily.date === today ? save.bestDaily.score : null;
    setText(this.dailyBest, todayBest === null ? "New constellation" : `Best ${num(todayBest)}`);
    this.daily.setAttribute(
      "aria-label",
      `Daily constellation, ${shortDate(today)}${todayBest === null ? "" : `, today's best ${todayBest}`}`,
    );
  }
}
