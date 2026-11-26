// UI van LUMA: HTML/CSS-laag boven het WebGL-canvas. Alleen elementen met data-ui vangen tikken;
// de rest van het scherm laat alles door naar het spel.
import type { GameOverInfo, SaveData, Settings, Ui, UiHandlers } from "../contracts";
import type { SimEvent, World } from "../sim/types";
import { css, zoneTheme } from "../theme";
import { Banner } from "./banner";
import { CollectionSheet } from "./collection";
import { Hud } from "./hud";
import { Motion, setShown, type Ctx } from "./kit";
import { OverScreen } from "./over";
import { PausedScreen } from "./paused";
import { SettingsSheet } from "./settings";
import { CSS, STYLE_ID } from "./styles";
import { TitleScreen } from "./title";

type Phase = "title" | "playing" | "paused" | "over";

const DEFAULT_SETTINGS: Settings = { muted: false, musicVolume: 0.7, sfxVolume: 0.8, reducedMotion: false, quality: "high" };
/** Zo lang na de dood negeren knoppen een druk (tegen doortikken); RETRY blijft ruim binnen 0.6 s bereikbaar. */
const OVER_GUARD_MS = 320;

function injectStyle(): HTMLStyleElement {
  const existing = document.getElementById(STYLE_ID);
  if (existing instanceof HTMLStyleElement) return existing;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
  return style;
}

export function createUi(root: HTMLElement, handlers: UiHandlers): Ui {
  const style = injectStyle();
  root.classList.add("luma-ui");

  const motion = new Motion();
  let settings: Settings = { ...DEFAULT_SETTINGS };
  let phase: Phase = "title";
  let zone = -1;
  /** Eerste-run-hint: aan zolang er nog nooit gevangen is (runs === 0 bij het eerste titelscherm). */
  let hintPending: boolean | null = null;

  const ctx: Ctx = {
    handlers,
    motion,
    guardUntil: 0,
    settings: () => settings,
    patchSettings(patch) {
      settings = { ...settings, ...patch };
      syncSettings();
      handlers.onSettings({ ...settings });
    },
  };

  const hud = new Hud(ctx);
  const banner = new Banner(ctx);
  const title = new TitleScreen(ctx, {
    openCollection: (opener) => openSheet("collection", opener),
    openSettings: (opener) => openSheet("settings", opener),
  });
  const paused = new PausedScreen(ctx);
  const over = new OverScreen(ctx);
  const collection = new CollectionSheet(ctx, () => closeSheets(true));
  const settingsSheet = new SettingsSheet(ctx, () => closeSheets(true));

  root.replaceChildren(hud.el, banner.el, title.el, paused.el, over.el, collection.el, settingsSheet.el);
  for (const el of [hud.el, title.el, paused.el, over.el]) setShown(el, false);

  // --- thema en beweging ---
  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const applyMotion = (): void => {
    motion.reduced = settings.reducedMotion || (mq?.matches ?? false);
    root.classList.toggle("lu-rm", motion.reduced);
  };
  mq?.addEventListener?.("change", applyMotion);
  root.style.setProperty("--lu-spring", motion.spring);

  function applyZone(z: number): void {
    if (z === zone) return;
    zone = z;
    const c = zoneTheme(z).colors;
    root.style.setProperty("--lu-accent", css(c.accent));
    root.style.setProperty("--lu-ring", css(c.ring));
    root.style.setProperty("--lu-star", css(c.star));
    root.style.setProperty("--lu-trail", css(c.trail));
    root.style.setProperty("--lu-neb", css(c.nebulaB));
  }

  function syncSettings(): void {
    applyMotion();
    title.sound.sync(settings.muted);
    paused.sound.sync(settings.muted);
    settingsSheet.update(settings);
  }

  // --- sheets ---
  function openSheet(which: "collection" | "settings", opener: HTMLElement): void {
    closeSheets(false);
    title.el.inert = true;
    if (which === "collection") collection.sheet.show(opener);
    else settingsSheet.sheet.show(opener);
  }

  function closeSheets(returnFocus: boolean): void {
    const wasOpen = collection.sheet.open || settingsSheet.sheet.open;
    // Eerst het titelscherm weer bruikbaar maken, anders kan de opener geen focus krijgen.
    if (wasOpen && phase === "title") title.el.inert = false;
    collection.sheet.hide(returnFocus);
    settingsSheet.sheet.hide(returnFocus);
    if (wasOpen && returnFocus) {
      // Focus terug naar de opener; die zat in het titelscherm dat net weer bruikbaar is.
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !title.el.contains(active)) title.play.focus({ preventScroll: true });
    }
  }

  function sheetOpen(): boolean {
    return collection.sheet.open || settingsSheet.sheet.open;
  }

  // --- schermwissel ---
  function show(next: Phase): void {
    phase = next;
    setShown(title.el, next === "title");
    setShown(hud.el, next === "playing" || next === "paused");
    hud.setDim(next === "paused");
    hud.pauseBtn.tabIndex = next === "playing" ? 0 : -1;
    setShown(paused.el, next === "paused");
    setShown(over.el, next === "over");
    if (next !== "over") over.hide();
    if (next !== "playing") banner.stop();
    if (next !== "title") closeSheets(false);
    else if (sheetOpen()) title.el.inert = true;
  }

  /** Tijdens het spelen mag geen knop focus houden: anders vangt hij Space/Enter. */
  function blurUi(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && root.contains(active)) active.blur();
  }

  // P = terug op de sheets (Escape niet: dat verlaat op CrazyGames het volledige scherm).
  const onKey = (e: KeyboardEvent): void => {
    if (e.code !== "KeyP" || e.repeat || !sheetOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    closeSheets(true);
  };
  document.addEventListener("keydown", onKey, true);

  applyZone(0);
  syncSettings();

  return {
    showTitle(next: SaveData): void {
      settings = { ...next.settings };
      if (hintPending === null) hintPending = next.runs === 0;
      applyZone(0);
      syncSettings();
      title.update(next);
      collection.update(next);
      show("title");
      title.play.focus({ preventScroll: true });
    },

    showPlaying(_mode: "endless" | "daily"): void {
      const resuming = phase === "paused";
      if (!resuming) {
        applyZone(0);
        hud.reset(hintPending === true);
      }
      show("playing");
      blurUi();
    },

    showPaused(): void {
      paused.update(hud.currentScore);
      show("paused");
      paused.resume.focus({ preventScroll: true });
    },

    showGameOver(info: GameOverInfo, next: SaveData): void {
      applyZone(info.zoneReached);
      ctx.guardUntil = performance.now() + OVER_GUARD_MS;
      over.show(info);
      title.update(next);
      collection.update(next);
      show("over");
      over.retry.focus({ preventScroll: true });
    },

    hud(world: World, events: readonly SimEvent[]): void {
      applyZone(world.zone);
      if (hud.update(world, events)) hintPending = false;
    },

    zoneBanner(z: number): void {
      applyZone(z);
      banner.show(z);
    },

    refreshSave(next: SaveData): void {
      settings = { ...next.settings };
      syncSettings();
      title.update(next);
      collection.update(next);
    },

    dispose(): void {
      document.removeEventListener("keydown", onKey, true);
      mq?.removeEventListener?.("change", applyMotion);
      over.hide();
      banner.stop();
      root.replaceChildren();
      root.classList.remove("luma-ui", "lu-rm");
      for (const p of ["--lu-accent", "--lu-ring", "--lu-star", "--lu-trail", "--lu-neb", "--lu-spring"]) root.style.removeProperty(p);
      style.remove();
    },
  };
}
