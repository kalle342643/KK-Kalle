// Collectie: kaarten voor alle skins met een CSS-komeet in een baan; kopen, kiezen, gekozen.
import { SKINS, type SaveData, type Skin } from "../contracts";
import { css } from "../theme";
import { CHECK, CRYSTAL, LOCK } from "./icons";
import { button, h, icon, setText, type Ctx } from "./kit";
import { Sheet } from "./sheet";
import { num } from "./text";

const STYLE_NAME: Record<Skin["style"], string> = {
  smooth: "pure light",
  sparkle: "sparkling trail",
  prism: "shifting colors",
  ember: "burning embers",
  void: "a dark heart",
};

type CardState = "selected" | "owned" | "buy" | "poor";

interface Card {
  skin: Skin;
  el: HTMLElement;
  btn: HTMLButtonElement;
  state: CardState | null;
}

/** Komeet-voorbeeld: ster in het midden, komeet met staart in een draaiende baan. */
function preview(skin: Skin): HTMLElement {
  const orbit = h("div", { class: "lu-orbit" }, h("i", { class: "lu-trail" }), h("i", { class: "lu-head" }));
  if (skin.style === "sparkle" || skin.style === "ember") {
    // Deeltjes langs de staart, achter de kop (tegen de klok in vanaf rechts).
    const n = skin.style === "sparkle" ? 6 : 5;
    for (let k = 0; k < n; k++) {
      const deg = 18 + k * 26;
      const rad = (-deg * Math.PI) / 180;
      const x = 50 + 50 * Math.cos(rad);
      const y = 50 + 50 * Math.sin(rad);
      const dx = Math.cos(rad) * 10;
      const dy = Math.sin(rad) * 10 - 4;
      orbit.append(
        h("b", { style: `left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--k:${k};--dx:${dx.toFixed(1)}px;--dy:${dy.toFixed(1)}px` }),
      );
    }
  }
  return h(
    "div",
    {
      class: "lu-pv",
      "data-style": skin.style,
      "aria-hidden": "true",
      style: `--core:${css(skin.core)};--ta:${css(skin.trailA)};--tb:${css(skin.trailB)}`,
    },
    orbit,
  );
}

export class CollectionSheet {
  readonly sheet: Sheet;
  private readonly wallet: HTMLElement;
  private readonly cards: Card[] = [];
  private save: SaveData | null = null;

  constructor(
    private readonly ctx: Ctx,
    onClose: () => void,
  ) {
    this.wallet = h("span", {}, "0");
    const chip = h("div", { class: "lu-chip lu-glassy", "aria-label": "Shards" }, icon(CRYSTAL, "lu-ico lu-crystal"), this.wallet);
    this.sheet = new Sheet(ctx, "collection", "Collection", [chip], onClose);
    const grid = h("div", { class: "lu-grid", role: "list" });
    for (const skin of SKINS) {
      const card: Card = { skin, el: h("div"), btn: h("button"), state: null };
      card.btn = button(ctx, { cls: "", silent: () => card.state === "selected" || card.state === "poor" }, [], () => this.press(card));
      card.el = h(
        "div",
        { class: "lu-card lu-glassy", role: "listitem" },
        preview(skin),
        h("div", { class: "lu-card-n" }, skin.name),
        h("div", { class: "lu-card-s" }, STYLE_NAME[skin.style]),
        card.btn,
      );
      this.cards.push(card);
      grid.append(card.el);
    }
    this.sheet.body.append(grid);
  }

  get el(): HTMLElement {
    return this.sheet.el;
  }

  update(save: SaveData): void {
    this.save = save;
    setText(this.wallet, num(save.shards));
    for (const card of this.cards) {
      const { skin } = card;
      const owned = skin.cost === 0 || save.unlocked.includes(skin.id);
      const state: CardState = save.skin === skin.id ? "selected" : owned ? "owned" : save.shards >= skin.cost ? "buy" : "poor";
      if (state === card.state) continue;
      card.state = state;
      this.render(card, state);
    }
  }

  private render(card: Card, state: CardState): void {
    const { btn, skin } = card;
    btn.replaceChildren();
    btn.className = "lu-btn";
    card.el.classList.toggle("is-sel", state === "selected");
    switch (state) {
      case "selected":
        btn.classList.add("is-on");
        btn.append(icon(CHECK), "EQUIPPED");
        btn.setAttribute("aria-disabled", "true");
        btn.setAttribute("aria-label", `${skin.name}, equipped`);
        break;
      case "owned":
        btn.append("SELECT");
        btn.removeAttribute("aria-disabled");
        btn.setAttribute("aria-label", `Select ${skin.name}`);
        break;
      case "buy":
        btn.classList.add("is-buy");
        btn.append("BUY", icon(CRYSTAL), h("span", { class: "lu-cost" }, num(skin.cost)));
        btn.removeAttribute("aria-disabled");
        btn.setAttribute("aria-label", `Buy ${skin.name} for ${skin.cost} shards`);
        break;
      case "poor":
        btn.classList.add("is-poor");
        btn.append(icon(LOCK), icon(CRYSTAL), h("span", { class: "lu-cost" }, num(skin.cost)));
        btn.setAttribute("aria-disabled", "true");
        btn.setAttribute("aria-label", `${skin.name}, costs ${skin.cost} shards, not enough shards yet`);
        break;
    }
  }

  private press(card: Card): void {
    if (!this.save) return;
    if (card.state === "owned") this.ctx.handlers.onSelectSkin(card.skin.id);
    else if (card.state === "buy") this.ctx.handlers.onBuySkin(card.skin.id);
  }
}
