// Gedeeld omhulsel voor de collectie en de instellingen: scrim, glazen paneel, kop met sluitknop.
import { CLOSE } from "./icons";
import { button, h, icon, setShown, type Child, type Ctx } from "./kit";

export class Sheet {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  readonly closeBtn: HTMLButtonElement;
  private opener: HTMLElement | null = null;
  open = false;

  constructor(ctx: Ctx, id: string, title: string, headExtra: Child[], onClose: () => void, cls = "") {
    const titleId = `lu-${id}-title`;
    this.closeBtn = button(ctx, { cls: "lu-round lu-glassy", aria: "Close" }, [icon(CLOSE)], onClose);
    const scrim = h("div", { class: "lu-scrim", "data-ui": true, "aria-hidden": "true" });
    scrim.addEventListener("click", () => onClose());
    this.body = h("div", { class: "lu-sheet-b" });
    this.el = h(
      "section",
      { class: `lu-screen lu-sheet ${cls}`, role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
      scrim,
      h(
        "div",
        { class: "lu-sheet-p lu-glassy", "data-ui": true },
        h("span", { class: "lu-grab", "aria-hidden": "true" }),
        h("div", { class: "lu-sheet-h" }, h("h2", { id: titleId }, title), ...headExtra, this.closeBtn),
        this.body,
      ),
    );
    setShown(this.el, false);
  }

  show(opener: HTMLElement | null): void {
    this.opener = opener;
    this.open = true;
    setShown(this.el, true);
    this.body.scrollTop = 0;
    this.closeBtn.focus({ preventScroll: true });
  }

  hide(returnFocus: boolean): void {
    if (!this.open) return;
    this.open = false;
    setShown(this.el, false);
    if (returnFocus && this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    this.opener = null;
  }
}
