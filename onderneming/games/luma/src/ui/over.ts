// Game over: oorzaak, score met optellen, NEW BEST-feest, statistieken en RETRY (meteen bereikbaar).
import type { GameOverInfo } from "../contracts";
import { dayKey } from "../sim/rng";
import { CRYSTAL, HOME, RETRY } from "./icons";
import { button, h, icon, setText, srOnly, type Ctx } from "./kit";
import { causeLine, num, shortDate } from "./text";

const SPARKS = 18;

export class OverScreen {
  readonly el: HTMLElement;
  readonly retry: HTMLButtonElement;
  private readonly daily: HTMLElement;
  private readonly cause: HTMLElement;
  private readonly score: HTMLElement;
  private readonly live: HTMLElement;
  private readonly bestKey: HTMLElement;
  private readonly bestVal: HTMLElement;
  private readonly stat: Record<"stars" | "perfects" | "combo" | "near", HTMLElement>;
  private readonly earned: HTMLElement;
  private readonly total: HTMLElement;
  private raf = 0;

  constructor(private readonly ctx: Ctx) {
    this.retry = button(ctx, { cls: "lu-primary" }, [icon(RETRY), "RETRY"], () => ctx.handlers.onRetry());
    const home = button(ctx, { cls: "lu-ghost lu-glassy" }, [icon(HOME), "HOME"], () => ctx.handlers.onHome());
    this.daily = h("div", { class: "lu-over lu-go-daily" });
    this.cause = h("div", { class: "lu-go-cause" });
    this.score = h("div", { class: "lu-go-n", "aria-hidden": "true" }, "0");
    this.live = srOnly("", true);
    const burst = h("div", { class: "lu-go-burst", "aria-hidden": "true" });
    const colors = ["var(--lu-accent)", "var(--lu-ring)", "#fff", "var(--lu-star)", "#ff7ad9"];
    for (let i = 0; i < SPARKS; i++) {
      const a = (360 / SPARKS) * i + (i % 2 ? 7 : -5);
      const d = 90 + ((i * 37) % 70);
      burst.append(h("i", { style: `--a:${a}deg;--d:${d}px;--k:${i % 6};--c:${colors[i % colors.length] ?? "#fff"}` }));
    }
    this.bestKey = h("span", { class: "lu-over" }, "Best");
    this.bestVal = h("b", {}, "0");
    const cell = (label: string): [HTMLElement, HTMLElement] => {
      const v = h("b", {}, "0");
      return [h("div", { class: "lu-stat" }, v, h("span", {}, label)), v];
    };
    const [c1, v1] = cell("Stars");
    const [c2, v2] = cell("Perfect");
    const [c3, v3] = cell("Combo");
    const [c4, v4] = cell("Near miss");
    this.stat = { stars: v1, perfects: v2, combo: v3, near: v4 };
    this.earned = h("b", {}, "+0");
    this.total = h("em", {}, "0");

    this.el = h(
      "section",
      { class: "lu-screen lu-go", "aria-label": "Run over" },
      h(
        "div",
        { class: "lu-go-w" },
        h(
          "div",
          { class: "lu-go-a" },
          h("div", { class: "lu-in", style: "--i:0;display:grid;gap:8px;justify-items:center" }, this.daily, this.cause),
          h("div", { class: "lu-go-score lu-in", style: "--i:1" }, burst, this.score),
          this.live,
          h("span", { class: "lu-newbest", "aria-hidden": "true" }, "NEW BEST"),
          h("div", { class: "lu-go-best lu-in", style: "--i:2" }, this.bestKey, this.bestVal),
        ),
        h(
          "div",
          { class: "lu-go-b" },
          h("div", { class: "lu-stats lu-glassy lu-in", style: "--i:2" }, c1, c2, c3, c4),
          h(
            "div",
            { class: "lu-go-shards lu-in", style: "--i:3" },
            icon(CRYSTAL, "lu-ico lu-crystal"),
            this.earned,
            h("span", {}, "earned · "),
            this.total,
            h("span", {}, "total"),
          ),
          h("div", { class: "lu-go-btns lu-in", style: "--i:3" }, this.retry, home),
        ),
      ),
    );
  }

  show(info: GameOverInfo): void {
    const daily = info.mode === "daily";
    const day = dayKey(new Date());
    this.daily.hidden = !daily;
    setText(this.daily, daily ? `Daily · ${shortDate(day)}` : "");
    setText(this.cause, causeLine(info.cause, info.zoneReached));
    setText(this.bestKey, daily ? "Today's best" : "Best");
    setText(this.bestVal, num(Math.max(info.best, info.score)));
    this.el.classList.toggle("is-best", info.newBest);
    setText(this.stat.stars, num(info.stats.captures));
    setText(this.stat.perfects, num(info.stats.perfects));
    setText(this.stat.combo, info.stats.bestCombo > 0 ? `×${info.stats.bestCombo}` : "0");
    setText(this.stat.near, num(info.stats.nearMisses));
    setText(this.earned, `+${num(info.shardsEarned)}`);
    setText(this.total, num(info.shardsTotal));
    setText(
      this.live,
      `Score ${info.score}.${info.newBest ? " New best!" : ""} ${causeLine(info.cause, info.zoneReached)}.`,
    );
    this.score.style.setProperty("--d", String(Math.max(3, num(info.score).length)));
    this.countUp(info.score);
  }

  hide(): void {
    cancelAnimationFrame(this.raf);
  }

  /** Score telt op in ~0.8 s; bij reduced motion meteen de eindwaarde. */
  private countUp(target: number): void {
    cancelAnimationFrame(this.raf);
    if (this.ctx.motion.reduced || target <= 0) {
      this.score.textContent = num(target);
      return;
    }
    const start = performance.now();
    const dur = Math.min(1100, 420 + target * 6);
    let shown = -1;
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 4);
      const v = Math.round(target * eased);
      if (v !== shown) {
        shown = v;
        this.score.textContent = num(v);
      }
      if (t < 1) this.raf = requestAnimationFrame(tick);
    };
    this.score.textContent = "0";
    this.raf = requestAnimationFrame(tick);
  }
}
