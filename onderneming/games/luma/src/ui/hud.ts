// HUD tijdens het spelen. hud() draait elk frame: de DOM wordt alleen aangeraakt als een waarde verandert.
import type { SimEvent, World } from "../sim/types";
import { CRYSTAL, PAUSE, TAP } from "./icons";
import { button, clamp01, h, icon, type Ctx } from "./kit";

const FLOATS = 5;
/** Snel erin, zacht uitlopen. */
const OUT = "cubic-bezier(.16,1,.3,1)";

export class Hud {
  readonly el: HTMLElement;
  readonly pauseBtn: HTMLButtonElement;
  private readonly scoreNum: HTMLSpanElement;
  private readonly scoreGlow: HTMLSpanElement;
  private readonly shardNum: HTMLSpanElement;
  private readonly shardChip: HTMLElement;
  private readonly combo: HTMLElement;
  private readonly comboText: HTMLElement;
  private readonly near: HTMLElement;
  private readonly heat: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly floats: HTMLElement[] = [];
  private nextFloat = 0;
  private comboAnim: Animation | null = null;
  private nearAnim: Animation | null = null;

  private score = -1;
  private shards = -1;
  private heatLevel = -1;
  private heatClass = "";
  private hintOn = false;

  constructor(private readonly ctx: Ctx) {
    this.pauseBtn = button(ctx, { cls: "lu-round lu-glassy lu-pause", aria: "Pause (P)" }, [icon(PAUSE)], () =>
      ctx.handlers.onPause(),
    );
    this.scoreNum = h("span", { class: "lu-score-n" }, "0");
    this.scoreGlow = h("span", { class: "lu-score-g", "aria-hidden": "true" });
    this.shardNum = h("span", {}, "0");
    this.shardChip = h(
      "div",
      { class: "lu-chip lu-glassy lu-shards", "aria-label": "Shards this run" },
      icon(CRYSTAL, "lu-ico lu-crystal"),
      this.shardNum,
    );
    this.comboText = h("span", { class: "lu-combo-t" });
    this.combo = h("div", { class: "lu-combo", "aria-hidden": "true" }, this.comboText);
    this.near = h(
      "div",
      { class: "lu-near", "aria-hidden": "true" },
      h("span", { class: "lu-near-t" }, "NEAR MISS"),
      h("span", { class: "lu-near-l" }),
    );
    this.heat = h("div", { class: "lu-heat", "aria-hidden": "true" }, h("i"));
    this.hint = h(
      "div",
      { class: "lu-hint", "aria-hidden": "true" },
      icon(TAP, "lu-ico lu-hint-i"),
      h("span", { class: "lu-hint-t" }, "Tap / Space to release"),
      h("span", { class: "lu-hint-s" }, "fly into the next ring"),
    );
    for (let i = 0; i < FLOATS; i++) this.floats.push(h("span", { class: "lu-float", "aria-hidden": "true" }));

    this.el = h(
      "section",
      { class: "lu-screen lu-hud", "aria-label": "Game" },
      this.heat,
      h("div", { class: "lu-score", "aria-hidden": "true" }, this.scoreGlow, this.scoreNum),
      this.shardChip,
      this.pauseBtn,
      this.combo,
      this.near,
      this.hint,
      ...this.floats,
    );
  }

  /** Nieuwe run: alles terug naar nul. */
  reset(showHint: boolean): void {
    this.score = -1;
    this.shards = -1;
    this.heatLevel = -1;
    this.comboAnim?.cancel();
    this.nearAnim?.cancel();
    for (const f of this.floats) f.getAnimations?.().forEach((a) => a.cancel());
    this.setHeat(0);
    this.setHint(showHint);
  }

  setDim(dim: boolean): void {
    this.el.classList.toggle("is-dim", dim);
  }

  get currentScore(): number {
    return Math.max(0, this.score);
  }

  /** Geeft true terug als in deze frame de eerste vangst viel (dan kan de hint weg). */
  update(world: World, events: readonly SimEvent[]): boolean {
    let captured = false;
    if (world.score !== this.score) {
      const text = String(world.score);
      // Lengte als custom property: lange scores krimpen in plaats van te botsen met de knoppen.
      if (text.length !== String(Math.max(0, this.score)).length || this.score < 0) {
        this.scoreNum.style.setProperty("--d", String(Math.max(3, text.length)));
      }
      this.score = world.score;
      this.scoreNum.textContent = text;
    }
    if (world.stats.shards !== this.shards) {
      this.shards = world.stats.shards;
      this.shardNum.textContent = String(world.stats.shards);
    }
    const state = world.comet.state;
    this.setHeat(state.mode === "orbit" ? state.heat : 0);

    for (const ev of events) {
      switch (ev.type) {
        case "capture":
          captured = true;
          this.bump(ev.perfect);
          if (ev.gained > 0) this.float(`+${ev.gained}`, ev.perfect ? "is-perfect" : "");
          if (ev.perfect) this.showCombo(ev.combo);
          break;
        case "nearMiss":
          this.nearMiss();
          break;
        case "shard":
          this.shardBump();
          break;
        case "death":
          this.setHeat(0);
          break;
        default:
          break;
      }
    }
    if (captured) this.setHint(false);
    return captured;
  }

  setHint(on: boolean): void {
    if (on === this.hintOn) return;
    this.hintOn = on;
    this.hint.classList.toggle("is-on", on);
  }

  private setHeat(heat: number): void {
    // Pas vanaf 0.6 zichtbaar; in stapjes van 5% zodat de DOM zelden verandert.
    const level = heat < 0.6 ? 0 : Math.round(clamp01((heat - 0.6) / 0.4) * 20) / 20;
    if (level === this.heatLevel) return;
    this.heatLevel = level;
    this.heat.style.opacity = level === 0 ? "0" : (0.3 + 0.7 * level).toFixed(2);
    const cls = level === 0 ? "" : heat >= 0.85 ? "crit" : "hot";
    if (cls !== this.heatClass) {
      this.heatClass = cls;
      this.heat.classList.toggle("is-hot", cls !== "");
      this.heat.classList.toggle("is-crit", cls === "crit");
    }
  }

  private bump(perfect: boolean): void {
    const m = this.ctx.motion;
    const s = perfect ? 1.26 : 1.12;
    m.play(
      this.scoreNum,
      [
        { transform: "scale(1)", easing: "cubic-bezier(.2,.9,.3,1)" },
        { transform: `scale(${s})`, offset: 0.14, easing: m.spring },
        { transform: "scale(1)" },
      ],
      null,
      { duration: perfect ? 620 : 480 },
    );
    m.play(
      this.scoreGlow,
      [
        { opacity: 0, transform: "scale(.5)", easing: OUT },
        { opacity: perfect ? 1 : 0.55, transform: "scale(1)", offset: 0.15, easing: "ease-in" },
        { opacity: 0, transform: "scale(1.3)" },
      ],
      [{ opacity: perfect ? 0.6 : 0.3, easing: "ease-out" }, { opacity: 0 }],
      { duration: perfect ? 700 : 450 },
    );
  }

  private float(text: string, cls: string): void {
    const el = this.floats[this.nextFloat];
    this.nextFloat = (this.nextFloat + 1) % FLOATS;
    if (!el) return;
    el.getAnimations?.().forEach((a) => a.cancel());
    el.textContent = text;
    el.className = `lu-float ${cls}`;
    this.ctx.motion.play(
      el,
      [
        { opacity: 0, transform: "translateY(10px) scale(.8)", easing: OUT },
        { opacity: 1, transform: "translateY(0) scale(1)", offset: 0.2 },
        { opacity: 1, transform: "translateY(-6px) scale(1)", offset: 0.55, easing: "ease-in" },
        { opacity: 0, transform: "translateY(-26px) scale(.96)" },
      ],
      [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }],
      { duration: 900 },
    );
  }

  private showCombo(combo: number): void {
    const tier = combo >= 8 ? 4 : combo >= 5 ? 3 : combo >= 2 ? 2 : 1;
    this.combo.dataset.tier = String(tier);
    this.comboText.textContent = "PERFECT";
    if (combo >= 2) this.comboText.append(h("i", {}, `\u00d7${combo}`));
    this.comboAnim?.cancel();
    const m = this.ctx.motion;
    const lift = 1 + tier * 0.03;
    this.comboAnim = m.play(
      this.combo,
      [
        { opacity: 0, transform: "translateY(14px) scale(.55)", filter: "blur(6px)", easing: OUT },
        { opacity: 1, transform: `translateY(0) scale(${lift + 0.08})`, filter: "blur(0px)", offset: 0.14, easing: m.spring },
        { opacity: 1, transform: `translateY(0) scale(${lift})`, filter: "blur(0px)", offset: 0.34 },
        { opacity: 1, transform: `translateY(0) scale(${lift})`, filter: "blur(0px)", offset: 0.74, easing: "ease-in" },
        { opacity: 0, transform: `translateY(-12px) scale(${lift * 0.96})`, filter: "blur(4px)" },
      ],
      [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }],
      { duration: 1150 + tier * 80 },
    );
  }

  private nearMiss(): void {
    this.nearAnim?.cancel();
    this.nearAnim = this.ctx.motion.play(
      this.near,
      [
        { opacity: 0, transform: "scaleX(1.5)", filter: "blur(8px)", easing: OUT },
        { opacity: 1, transform: "scaleX(1)", filter: "blur(0px)", offset: 0.16 },
        { opacity: 1, transform: "scaleX(1)", filter: "blur(0px)", offset: 0.6, easing: "ease-in" },
        { opacity: 0, transform: "scaleX(.92)", filter: "blur(3px)" },
      ],
      [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }],
      { duration: 850 },
    );
  }

  private shardBump(): void {
    const m = this.ctx.motion;
    m.play(
      this.shardChip,
      [
        { transform: "scale(1)", easing: OUT },
        { transform: "scale(1.16)", offset: 0.15, easing: m.spring },
        { transform: "scale(1)" },
      ],
      null,
      { duration: 520 },
    );
    this.float("+1", "is-shard");
  }
}
