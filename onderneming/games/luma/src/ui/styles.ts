// Alle CSS van de UI. Kleuren volgen de zone via custom properties op de root (--lu-accent enz.).

export const STYLE_ID = "luma-ui-style";

export const CSS = String.raw`
@property --lu-accent { syntax: "<color>"; inherits: true; initial-value: #b7ff6a; }
@property --lu-ring { syntax: "<color>"; inherits: true; initial-value: #5ee7ff; }
@property --lu-star { syntax: "<color>"; inherits: true; initial-value: #9ff6ff; }
@property --lu-trail { syntax: "<color>"; inherits: true; initial-value: #7af0ff; }
@property --lu-neb { syntax: "<color>"; inherits: true; initial-value: #2a0f4d; }

.luma-ui {
  --lu-display: "Unbounded", ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --lu-sans: "Space Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --lu-ink: rgb(246 247 255);
  --lu-dim: rgb(236 240 255 / .66);
  --lu-faint: rgb(236 240 255 / .4);
  --lu-line: rgb(255 255 255 / .15);
  --lu-line-hi: rgb(255 255 255 / .24);
  --lu-glass: rgb(14 16 32 / .42);
  --lu-glass-hi: rgb(255 255 255 / .07);
  --lu-spring: cubic-bezier(.34,1.56,.64,1);
  --lu-out: cubic-bezier(.16,1,.3,1);
  --lu-pt: max(16px, env(safe-area-inset-top));
  --lu-pr: max(16px, env(safe-area-inset-right));
  --lu-pb: max(16px, env(safe-area-inset-bottom));
  --lu-pl: max(16px, env(safe-area-inset-left));
  --lu-glow: color-mix(in srgb, var(--lu-ring) 55%, transparent);
  position: fixed;
  inset: 0;
  overflow: hidden;
  color: var(--lu-ink);
  font-family: var(--lu-sans);
  font-size: 16px;
  line-height: 1.3;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  -webkit-user-select: none;
  user-select: none;
  transition: --lu-accent 1.4s ease, --lu-ring 1.4s ease, --lu-star 1.4s ease, --lu-trail 1.4s ease, --lu-neb 1.4s ease;
}
.luma-ui *, .luma-ui *::before, .luma-ui *::after { box-sizing: border-box; }
.luma-ui [data-ui] { pointer-events: auto; }
.luma-ui [hidden] { display: none !important; }
.lu-sr { position: absolute !important; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.lu-ico { display: inline-grid; place-items: center; width: 1.25em; height: 1.25em; flex: none; }
.lu-ico svg { width: 100%; height: 100%; display: block; overflow: visible; }
.lu-crystal { color: var(--lu-accent); filter: drop-shadow(0 0 6px color-mix(in srgb, var(--lu-accent) 60%, transparent)); }

/* ---- schermen ---- */
.lu-screen {
  position: absolute;
  inset: 0;
  padding: var(--lu-pt) var(--lu-pr) var(--lu-pb) var(--lu-pl);
  opacity: 0;
  visibility: hidden;
  transition: opacity .26s ease, visibility 0s linear .26s;
}
.lu-screen.is-on { opacity: 1; visibility: visible; transition: opacity .42s var(--lu-out), visibility 0s; }
.lu-in { opacity: 0; }
.is-on .lu-in { animation: lu-rise .8s var(--lu-out) both; animation-delay: calc(var(--i, 0) * 70ms); }
@keyframes lu-rise {
  from { opacity: 0; transform: translateY(18px) scale(.98); filter: blur(6px); }
  to { opacity: 1; transform: none; filter: none; }
}

/* ---- glas ---- */
.lu-glassy {
  background: linear-gradient(180deg, rgb(255 255 255 / .075), rgb(255 255 255 / .02)), var(--lu-glass);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
  backdrop-filter: blur(18px) saturate(150%);
  border: 1px solid var(--lu-line);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .08), 0 20px 60px -20px rgb(0 0 0 / .6);
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .lu-glassy { background: rgb(10 12 26 / .9); }
}

/* ---- knoppen ---- */
.lu-btn {
  -webkit-appearance: none;
  appearance: none;
  margin: 0;
  border: 0;
  padding: 0 20px;
  min-width: 44px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .6em;
  font: inherit;
  color: inherit;
  background: none;
  border-radius: 999px;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  white-space: nowrap;
  position: relative;
  transition: transform .5s var(--lu-spring), background-color .25s ease, box-shadow .35s ease, border-color .25s ease, opacity .2s ease, color .25s ease;
}
.lu-btn:focus { outline: none; }
.lu-btn:focus-visible { outline: 1.5px solid rgb(255 255 255 / .9); outline-offset: 4px; }
.lu-btn:active { transform: scale(.95); transition-duration: .08s; }
.lu-btn[aria-disabled="true"] { cursor: default; }
.lu-btn[aria-disabled="true"]:active { transform: none; }

.lu-primary {
  height: 64px;
  width: min(320px, 100%);
  font-family: var(--lu-display);
  font-weight: 600;
  font-size: 16px;
  letter-spacing: .34em;
  padding-left: calc(20px + .34em);
  color: #070812;
  background:
    radial-gradient(120% 140% at 50% -20%, #fff 0%, rgb(255 255 255 / .92) 45%, color-mix(in srgb, var(--lu-ring) 55%, #fff) 100%);
  box-shadow:
    inset 0 0 0 1px rgb(255 255 255 / .7),
    inset 0 -6px 16px -6px color-mix(in srgb, var(--lu-ring) 70%, transparent),
    0 0 0 1px color-mix(in srgb, var(--lu-ring) 40%, transparent),
    0 12px 44px -8px color-mix(in srgb, var(--lu-ring) 75%, transparent),
    0 0 90px -20px color-mix(in srgb, var(--lu-accent) 70%, transparent);
}
.lu-primary .lu-ico { width: 18px; height: 18px; margin-left: -.34em; }
.lu-primary::after {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  background: linear-gradient(105deg, transparent 30%, rgb(255 255 255 / .9) 48%, transparent 66%);
  background-size: 250% 100%;
  mix-blend-mode: soft-light;
  animation: lu-sheen 4.8s ease-in-out infinite;
  pointer-events: none;
}
@keyframes lu-sheen { 0%, 55% { background-position: 130% 0; } 100% { background-position: -130% 0; } }

.lu-ghost {
  height: 52px;
  font-family: var(--lu-display);
  font-weight: 600;
  font-size: 13px;
  letter-spacing: .26em;
  padding-left: calc(20px + .26em);
  color: var(--lu-ink);
}
.lu-ghost .lu-ico { width: 18px; height: 18px; margin-left: -.26em; }
.lu-round { width: 44px; height: 44px; padding: 0; border-radius: 50%; color: var(--lu-ink); }
.lu-round .lu-ico { width: 20px; height: 20px; }
@media (hover: hover) {
  .lu-primary:hover { box-shadow: inset 0 0 0 1px #fff, inset 0 -6px 16px -6px color-mix(in srgb, var(--lu-ring) 70%, transparent), 0 0 0 1px color-mix(in srgb, var(--lu-ring) 60%, transparent), 0 14px 54px -6px color-mix(in srgb, var(--lu-ring) 90%, transparent), 0 0 120px -16px color-mix(in srgb, var(--lu-accent) 80%, transparent); transform: translateY(-1px); }
  .lu-glassy.lu-btn:hover { border-color: var(--lu-line-hi); background-color: rgb(255 255 255 / .06); }
}

.lu-chip {
  height: 44px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px 0 12px;
  border-radius: 999px;
  font-family: var(--lu-display);
  font-weight: 600;
  font-size: 14px;
  letter-spacing: .06em;
  font-variant-numeric: tabular-nums;
}
.lu-chip .lu-ico { width: 18px; height: 18px; }

.lu-over { font-family: var(--lu-display); font-weight: 600; font-size: 11px; letter-spacing: .38em; text-transform: uppercase; color: var(--lu-dim); }

/* ---- titel ---- */
.lu-title { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: 1fr auto; justify-items: center; text-align: center; }
.lu-topbar { position: absolute; top: var(--lu-pt); left: var(--lu-pl); right: var(--lu-pr); display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.lu-topbar-r { display: flex; gap: 10px; }
.lu-wallet { padding-left: 8px; gap: 6px; }
.lu-wallet .lu-ico-c { width: 26px; height: 26px; color: var(--lu-ink); opacity: .9; }
.lu-wallet .lu-sep { width: 1px; height: 18px; background: var(--lu-line-hi); margin: 0 4px 0 2px; }
.lu-hero { align-self: start; padding-top: clamp(76px, 15vh, 190px); display: grid; justify-items: center; gap: clamp(10px, 2vh, 18px); width: 100%; }
.lu-logo {
  margin: 0;
  display: flex;
  justify-content: center;
  font-family: var(--lu-display);
  font-weight: 300;
  font-size: clamp(54px, min(18.5vw, 19vh), 184px);
  line-height: 1;
  letter-spacing: .26em;
  padding-left: .26em;
  filter: drop-shadow(0 0 22px var(--lu-glow)) drop-shadow(0 0 2px rgb(255 255 255 / .6));
}
.lu-logo span {
  display: block;
  background: linear-gradient(100deg, #fff 0%, #fff 38%, var(--lu-ring) 46%, var(--lu-accent) 50%, #fff 58%, #fff 100%);
  background-size: 320% 100%;
  background-position: 100% 0;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation: lu-shimmer 7s cubic-bezier(.45,0,.2,1) infinite;
  animation-delay: calc(var(--i) * .16s);
}
@keyframes lu-shimmer { 0%, 40% { background-position: 100% 0; } 85%, 100% { background-position: 0% 0; } }
.lu-tagline { margin: 0; max-width: 100%; text-wrap: balance; font-family: var(--lu-sans); font-weight: 400; font-size: clamp(13px, 1.4vh + 5px, 18px); letter-spacing: .34em; padding-left: .34em; text-transform: lowercase; color: var(--lu-dim); }
.lu-best { display: inline-flex; align-items: baseline; gap: 10px; margin-top: 4px; font-family: var(--lu-display); font-weight: 300; font-size: 20px; letter-spacing: .06em; font-variant-numeric: tabular-nums; }
.lu-best .lu-over { font-size: 10px; }
.lu-actions { display: grid; justify-items: center; gap: 12px; width: 100%; padding-bottom: clamp(8px, 3vh, 40px); }
.lu-daily { height: 56px; width: min(320px, 100%); justify-content: space-between; padding: 0 18px 0 22px; text-align: left; }
.lu-daily-k { font-family: var(--lu-display); font-weight: 600; font-size: 13px; letter-spacing: .26em; }
.lu-daily-v { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.15; font-size: 12px; color: var(--lu-dim); font-variant-numeric: tabular-nums; }
.lu-daily-v b { font-weight: 700; color: var(--lu-ink); letter-spacing: .04em; }
.lu-daily-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--lu-accent); box-shadow: 0 0 10px var(--lu-accent); margin-right: 10px; flex: none; animation: lu-blink 2.4s ease-in-out infinite; }
.lu-daily-l { display: flex; align-items: center; }
@keyframes lu-blink { 50% { opacity: .35; } }
.lu-tip { margin-top: 6px; font-size: 11px; letter-spacing: .5em; padding-left: .5em; text-transform: lowercase; color: var(--lu-faint); }
.lu-keys { display: none; margin-top: -4px; font-size: 11px; letter-spacing: .12em; color: var(--lu-faint); }
.lu-keys kbd { font: inherit; font-weight: 700; color: var(--lu-dim); padding: 1px 6px; border: 1px solid var(--lu-line); border-radius: 5px; }
@media (hover: hover) and (pointer: fine) { .lu-keys { display: block; } }

@media (orientation: landscape) and (max-height: 560px) {
  .lu-title { grid-template-rows: 1fr; grid-template-columns: 1.15fr 1fr; align-items: center; padding-top: calc(var(--lu-pt) + 44px); }
  .lu-hero { align-self: center; padding-top: 0; }
  .lu-logo { font-size: clamp(52px, min(12vw, 24vh), 140px); }
  .lu-actions { padding-bottom: 0; }
  .lu-keys { display: none; }
}

/* ---- HUD ---- */
.lu-hud { padding: 0; }
.lu-hud .lu-pause { position: absolute; top: var(--lu-pt); left: var(--lu-pl); }
.lu-hud.is-dim .lu-pause, .lu-hud.is-dim .lu-hint, .lu-hud.is-dim .lu-heat { opacity: 0; visibility: hidden; }
.lu-hud.is-dim .lu-score { opacity: .35; filter: blur(2px); }
.lu-score {
  position: absolute;
  top: calc(var(--lu-pt) + 2px);
  left: 88px;
  right: 88px;
  text-align: center;
  pointer-events: none;
  transition: opacity .3s ease, filter .3s ease;
}
.lu-score-n {
  display: inline-block;
  font-family: var(--lu-display);
  font-weight: 300;
  font-size: clamp(28px, min(14vmin, calc((100vw - 184px) / (var(--d, 3) * .92))), 112px);
  line-height: 1;
  letter-spacing: .02em;
  font-variant-numeric: tabular-nums;
  transform-origin: 50% 40%;
  text-shadow: 0 0 28px var(--lu-glow), 0 0 2px rgb(255 255 255 / .5);
}
.lu-score-g { position: absolute; left: 50%; top: 50%; width: 220px; height: 220px; margin: -110px 0 0 -110px; border-radius: 50%; background: radial-gradient(closest-side, color-mix(in srgb, var(--lu-accent) 45%, transparent), transparent); opacity: 0; pointer-events: none; }
.lu-shards { position: absolute; top: var(--lu-pt); right: var(--lu-pr); }
.lu-float {
  position: absolute;
  top: calc(var(--lu-pt) + clamp(54px, 14vmin + 8px, 124px));
  left: 50%;
  margin-left: -60px;
  width: 120px;
  text-align: center;
  font-family: var(--lu-display);
  font-weight: 600;
  font-size: 16px;
  letter-spacing: .08em;
  color: var(--lu-ink);
  opacity: 0;
  pointer-events: none;
  text-shadow: 0 0 12px var(--lu-glow);
}
.lu-float.is-perfect { color: var(--lu-accent); font-size: 19px; text-shadow: 0 0 14px color-mix(in srgb, var(--lu-accent) 70%, transparent); }
.lu-float.is-shard { top: calc(var(--lu-pt) + 50px); left: auto; right: var(--lu-pr); margin: 0; width: 80px; text-align: right; font-size: 14px; color: var(--lu-accent); }
.lu-combo {
  position: absolute;
  top: 29%;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  pointer-events: none;
  opacity: 0;
}
.lu-combo-t {
  font-family: var(--lu-display);
  font-weight: 800;
  font-size: min(22px, 6vw);
  letter-spacing: .28em;
  padding-left: .28em;
  white-space: nowrap;
  color: var(--lu-accent);
  text-shadow: 0 0 18px color-mix(in srgb, var(--lu-accent) 75%, transparent);
}
.lu-combo-t i { font-style: normal; font-weight: 300; letter-spacing: .04em; margin-left: .2em; }
.lu-combo[data-tier="2"] .lu-combo-t { font-size: min(26px, 6.6vw); }
.lu-combo[data-tier="3"] .lu-combo-t, .lu-combo[data-tier="4"] .lu-combo-t {
  font-size: min(30px, 7vw);
  letter-spacing: .22em;
  padding-left: .22em;
  background: linear-gradient(90deg, var(--lu-accent), #fff 50%, var(--lu-ring));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  text-shadow: none;
  filter: drop-shadow(0 0 14px color-mix(in srgb, var(--lu-accent) 70%, transparent));
}
.lu-combo[data-tier="4"] .lu-combo-t { font-size: min(34px, 7.4vw); background-image: linear-gradient(90deg, #ff5ec4, var(--lu-accent), #5ee7ff, #fff, #ff5ec4); background-size: 200% 100%; animation: lu-prism 1.2s linear infinite; }
@keyframes lu-prism { to { background-position: -200% 0; } }
.lu-near { position: absolute; top: 37%; left: 0; right: 0; display: grid; justify-items: center; gap: 8px; pointer-events: none; opacity: 0; }
.lu-near-t { font-family: var(--lu-display); font-weight: 600; font-size: 13px; letter-spacing: .6em; padding-left: .6em; color: #fff; text-shadow: 0 0 14px var(--lu-glow); }
.lu-near-l { width: min(240px, 60vw); height: 1px; background: linear-gradient(90deg, transparent, #fff, transparent); box-shadow: 0 0 10px var(--lu-ring); }
.lu-heat { position: absolute; inset: 0; opacity: 0; pointer-events: none; transition: opacity .25s ease; }
.lu-heat i { position: absolute; inset: 0; background: radial-gradient(ellipse 75% 70% at 50% 50%, transparent 52%, rgb(255 60 50 / .16) 74%, rgb(255 36 64 / .5) 100%); box-shadow: inset 0 0 60px 6px rgb(255 50 60 / .42); }
.lu-heat.is-hot i { animation: lu-heat .72s ease-in-out infinite alternate; }
.lu-heat.is-crit i { animation-duration: .32s; }
@keyframes lu-heat { from { opacity: .45; } to { opacity: 1; } }
.lu-hint { position: absolute; left: 0; right: 0; bottom: calc(var(--lu-pb) + 13vh); display: grid; justify-items: center; gap: 12px; pointer-events: none; opacity: 0; transform: translateY(10px); transition: opacity .5s ease, transform .6s var(--lu-out); }
.lu-hint.is-on { opacity: 1; transform: none; }
.lu-hint-i { width: 42px; height: 42px; color: var(--lu-ink); animation: lu-tap 1.6s var(--lu-out) infinite; }
.lu-hint-t { font-family: var(--lu-display); font-weight: 600; font-size: min(13px, 3.6vw); letter-spacing: .3em; padding-left: .3em; text-transform: uppercase; color: var(--lu-ink); text-shadow: 0 0 16px var(--lu-glow); }
.lu-hint-s { font-size: 12px; letter-spacing: .14em; color: var(--lu-dim); }
@keyframes lu-tap { 0% { transform: scale(.86); opacity: .5; } 30% { transform: scale(1); opacity: 1; } 100% { transform: scale(.86); opacity: .5; } }

/* ---- zone-banner ---- */
.lu-banner { position: absolute; left: var(--lu-pl); right: var(--lu-pr); top: 20%; display: grid; justify-items: center; text-align: center; gap: 10px; pointer-events: none; opacity: 0; }
.lu-banner-o { font-family: var(--lu-display); font-weight: 600; font-size: 11px; letter-spacing: .6em; padding-left: .6em; color: var(--lu-accent); text-shadow: 0 0 12px color-mix(in srgb, var(--lu-accent) 70%, transparent); }
.lu-banner-l { width: min(200px, 50vw); height: 1px; background: linear-gradient(90deg, transparent, var(--lu-ring), transparent); }
.lu-banner-n { margin: 0; font-family: var(--lu-display); font-weight: 300; font-size: clamp(28px, min(8.4vw, 10vh), 84px); line-height: 1.1; letter-spacing: .16em; padding-left: .16em; text-transform: uppercase; text-wrap: balance; color: #fff; text-shadow: 0 0 30px var(--lu-glow), 0 0 2px #fff; overflow-wrap: anywhere; }
.lu-banner-t { font-size: clamp(12px, 1.4vh + 6px, 16px); letter-spacing: .4em; padding-left: .4em; color: var(--lu-dim); }

/* ---- paneel (pauze, game over) ---- */
.lu-center { display: grid; place-items: center; overflow-y: auto; }
.lu-panel { width: min(380px, 100%); border-radius: 28px; padding: 26px 22px 22px; display: grid; gap: 14px; justify-items: center; text-align: center; position: relative; }
.lu-panel .lu-primary, .lu-panel .lu-ghost { width: 100%; }
.lu-panel-row { display: flex; gap: 10px; width: 100%; }
.lu-panel-row .lu-ghost { flex: 1; width: auto; }
.lu-panel-row .lu-round { width: 52px; height: 52px; }
.lu-pz-score { font-family: var(--lu-display); font-weight: 300; font-size: 56px; line-height: 1; letter-spacing: .02em; font-variant-numeric: tabular-nums; text-shadow: 0 0 24px var(--lu-glow); margin: 2px 0 8px; }
.lu-pz-k { font-size: 12px; letter-spacing: .14em; color: var(--lu-faint); }
.lu-pz-k kbd { font: inherit; font-weight: 700; color: var(--lu-dim); padding: 1px 6px; border: 1px solid var(--lu-line); border-radius: 5px; }

/* ---- game over ---- */
.lu-go { display: grid; place-items: center; overflow-y: auto; overflow-x: hidden; }
.lu-go-w { width: min(420px, 100%); display: grid; gap: clamp(10px, 2vh, 18px); justify-items: center; text-align: center; padding: 8px 0; }
.lu-go-a, .lu-go-b { display: grid; gap: clamp(10px, 1.8vh, 16px); justify-items: center; width: 100%; }
.lu-go-cause { text-wrap: balance; font-family: var(--lu-display); font-weight: 600; font-size: 12px; letter-spacing: .32em; padding-left: .32em; text-transform: uppercase; color: var(--lu-dim); max-width: 100%; }
.lu-go-daily { color: var(--lu-accent); font-size: 11px; }
.lu-go-score { position: relative; display: grid; place-items: center; }
.lu-go-n { position: relative; font-family: var(--lu-display); font-weight: 300; font-size: clamp(48px, min(26vw, 15vh, calc((100vw - 48px) / (var(--d, 3) * .8))), 150px); line-height: 1; letter-spacing: .02em; font-variant-numeric: tabular-nums; text-shadow: 0 0 36px var(--lu-glow), 0 0 2px rgb(255 255 255 / .6); }
.lu-go-burst { position: absolute; left: 50%; top: 50%; width: 1px; height: 1px; pointer-events: none; }
.lu-go-burst::before { content: ""; position: absolute; left: -160px; top: -160px; width: 320px; height: 320px; border-radius: 50%; background: radial-gradient(closest-side, color-mix(in srgb, var(--lu-accent) 55%, transparent), color-mix(in srgb, var(--lu-ring) 18%, transparent) 55%, transparent); opacity: 0; }
.lu-go-burst i { position: absolute; left: -3px; top: -3px; width: 6px; height: 6px; border-radius: 50%; background: var(--c, #fff); box-shadow: 0 0 10px var(--c, #fff); opacity: 0; }
.lu-go-burst i:nth-child(3n) { width: 3px; height: 12px; border-radius: 2px; left: -1.5px; top: -6px; }
.is-on.is-best .lu-go-burst::before { animation: lu-burst 1.6s var(--lu-out) .15s both; }
.is-on.is-best .lu-go-burst i { animation: lu-spark 1.3s var(--lu-out) both; animation-delay: calc(.12s + var(--k) * 18ms); }
@keyframes lu-burst { 0% { opacity: 0; transform: scale(.2); } 25% { opacity: 1; } 100% { opacity: .55; transform: scale(1.2); } }
@keyframes lu-spark {
  0% { opacity: 0; transform: rotate(var(--a)) translateY(0) scale(.4); }
  12% { opacity: 1; }
  100% { opacity: 0; transform: rotate(var(--a)) translateY(calc(var(--d) * -1)) scale(1); }
}
.lu-newbest { display: none; height: 30px; align-items: center; padding: 0 14px 0 calc(14px + .36em); border-radius: 999px; font-family: var(--lu-display); font-weight: 800; font-size: 11px; letter-spacing: .36em; color: #070812; background: linear-gradient(90deg, var(--lu-accent), #fff, var(--lu-ring)); background-size: 200% 100%; box-shadow: 0 0 30px -4px color-mix(in srgb, var(--lu-accent) 80%, transparent); }
.is-best .lu-newbest { display: inline-flex; }
.is-on.is-best .lu-newbest { animation: lu-pop .7s var(--lu-spring) .2s both, lu-slide 3s linear .9s infinite; }
@keyframes lu-pop { from { opacity: 0; transform: scale(.5); } to { opacity: 1; transform: none; } }
@keyframes lu-slide { to { background-position: -200% 0; } }
.lu-go-best { display: flex; gap: 10px; align-items: baseline; font-variant-numeric: tabular-nums; }
.lu-go-best b { font-family: var(--lu-display); font-weight: 600; font-size: 16px; letter-spacing: .04em; }
.lu-go-best .lu-over { font-size: 10px; }
.lu-stats { width: 100%; border-radius: 22px; padding: 6px; display: grid; grid-template-columns: repeat(4, 1fr); }
.lu-stat { display: grid; gap: 6px; padding: 12px 4px 11px; justify-items: center; position: relative; }
.lu-stat + .lu-stat::before { content: ""; position: absolute; left: 0; top: 22%; bottom: 22%; width: 1px; background: var(--lu-line); }
.lu-stat b { font-family: var(--lu-display); font-weight: 600; font-size: 20px; line-height: 1; font-variant-numeric: tabular-nums; }
.lu-stat span { font-size: 10px; letter-spacing: .16em; text-transform: uppercase; color: var(--lu-dim); line-height: 1.2; }
.lu-go-shards { display: flex; align-items: center; justify-content: center; gap: 8px; font-variant-numeric: tabular-nums; color: var(--lu-dim); font-size: 13px; letter-spacing: .06em; flex-wrap: wrap; }
.lu-go-shards .lu-ico { width: 18px; height: 18px; }
.lu-go-shards b { font-family: var(--lu-display); font-weight: 600; color: var(--lu-accent); font-size: 15px; }
.lu-go-shards em { font-style: normal; color: var(--lu-ink); font-weight: 700; }
.lu-go-btns { display: grid; gap: 10px; width: min(320px, 100%); }
.lu-go-btns .lu-primary, .lu-go-btns .lu-ghost { width: 100%; }
@media (max-width: 360px) {
  .lu-stats { grid-template-columns: repeat(2, 1fr); }
  .lu-stat:nth-child(3)::before { display: none; }
}
@media (orientation: landscape) and (max-height: 560px) {
  .lu-go-w { width: min(820px, 100%); grid-template-columns: 1fr 1fr; align-items: center; gap: 28px; }
  .lu-go-n { font-size: clamp(44px, min(22vh, calc((50vw - 72px) / (var(--d, 3) * .8))), 120px); }
  .lu-row { min-height: 52px; }
  .lu-sheet-h { padding-top: 12px; padding-bottom: 6px; }
  .lu-go-btns { grid-template-columns: 1.4fr 1fr; width: 100%; }
  .lu-go-btns .lu-primary { height: 56px; }
  .lu-go-btns .lu-ghost { height: 56px; }
  .lu-stat { padding: 10px 2px 9px; }
}

/* ---- sheets (collectie, instellingen) ---- */
.lu-sheet { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); align-items: end; justify-items: center; padding: 0; }
.lu-scrim { position: absolute; inset: 0; background: radial-gradient(120% 90% at 50% 100%, rgb(2 3 10 / .78), rgb(2 3 10 / .5)); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.lu-sheet-p {
  position: relative;
  width: 100%;
  max-height: calc(100% - var(--lu-pt) - 28px);
  display: flex;
  flex-direction: column;
  border-radius: 30px 30px 0 0;
  border-bottom: 0;
  padding: 0 0 var(--lu-pb);
  transform: translateY(40px);
  transition: transform .6s var(--lu-spring);
}
.lu-sheet.is-on .lu-sheet-p { transform: none; }
.lu-sheet-h { display: flex; align-items: center; gap: 12px; padding: 18px max(18px, env(safe-area-inset-right)) 12px max(22px, env(safe-area-inset-left)); }
.lu-sheet-h h2 { margin: 0; flex: 1; font-family: var(--lu-display); font-weight: 600; font-size: 15px; letter-spacing: .32em; text-transform: uppercase; }
.lu-sheet-b { overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; padding: 4px max(18px, env(safe-area-inset-right)) 18px max(18px, env(safe-area-inset-left)); -webkit-overflow-scrolling: touch; scrollbar-width: thin; scrollbar-color: rgb(255 255 255 / .2) transparent; }
.lu-sheet-b::-webkit-scrollbar { width: 6px; }
.lu-sheet-b::-webkit-scrollbar-thumb { background: rgb(255 255 255 / .2); border-radius: 3px; }
.lu-grab { position: absolute; top: 8px; left: 50%; width: 36px; height: 4px; margin-left: -18px; border-radius: 2px; background: rgb(255 255 255 / .22); }
@media (min-width: 720px) and (min-height: 561px), (orientation: landscape) and (max-height: 560px) {
  .lu-sheet { align-items: center; padding: var(--lu-pt) var(--lu-pr) var(--lu-pb) var(--lu-pl); }
  .lu-sheet-p { width: min(880px, 100%); max-height: 100%; border-radius: 28px; border-bottom: 1px solid var(--lu-line); padding-bottom: 6px; transform: translateY(24px) scale(.97); }
  .lu-settings .lu-sheet-p { width: min(520px, 100%); }
  .lu-grab { display: none; }
}

/* ---- collectie ---- */
.lu-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(148px, 100%), 1fr)); gap: 12px; }
.lu-card { border-radius: 22px; padding: 14px 12px 12px; display: grid; justify-items: center; gap: 8px; text-align: center; position: relative; transition: border-color .3s ease, box-shadow .4s ease, transform .5s var(--lu-spring); }
.lu-card.is-sel { border-color: color-mix(in srgb, var(--lu-accent) 70%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--lu-accent) 35%, transparent), 0 0 40px -10px color-mix(in srgb, var(--lu-accent) 60%, transparent), 0 20px 60px -20px rgb(0 0 0 / .6); }
.lu-card-n { font-family: var(--lu-display); font-weight: 600; font-size: 13px; letter-spacing: .22em; padding-left: .22em; text-transform: uppercase; }
.lu-card-s { font-size: 11px; letter-spacing: .12em; color: var(--lu-faint); text-transform: lowercase; margin-top: -4px; }
.lu-card .lu-btn { width: 100%; height: 44px; font-family: var(--lu-display); font-weight: 600; font-size: 11px; letter-spacing: .22em; padding: 0 10px 0 calc(10px + .22em); gap: 6px; border: 1px solid var(--lu-line-hi); background: rgb(255 255 255 / .05); }
.lu-card .lu-btn .lu-ico { width: 15px; height: 15px; }
.lu-card .lu-btn.is-buy { color: #070812; background: linear-gradient(180deg, #fff, color-mix(in srgb, var(--lu-accent) 45%, #fff)); border-color: transparent; }
.lu-card .lu-btn.is-buy .lu-ico { color: #070812; }
.lu-card .lu-btn.is-poor { color: var(--lu-faint); background: transparent; border-style: dashed; }
.lu-card .lu-btn.is-on { color: var(--lu-accent); border-color: color-mix(in srgb, var(--lu-accent) 50%, transparent); background: color-mix(in srgb, var(--lu-accent) 10%, transparent); }
.lu-card .lu-cost { letter-spacing: .06em; }

/* komeet-voorbeeld: een baan met staart */
.lu-pv { position: relative; width: 104px; height: 104px; }
.lu-pv::before { content: ""; position: absolute; left: 50%; top: 50%; width: 10px; height: 10px; margin: -5px; border-radius: 50%; background: #fff; box-shadow: 0 0 12px 3px var(--lu-ring), 0 0 30px 8px color-mix(in srgb, var(--lu-ring) 40%, transparent); opacity: .85; }
.lu-pv::after { content: ""; position: absolute; inset: 16px; border-radius: 50%; border: 1px dashed rgb(255 255 255 / .1); }
.lu-orbit { position: absolute; inset: 16px; border-radius: 50%; animation: lu-spin 3.4s linear infinite; filter: drop-shadow(0 0 5px var(--ta)); }
.lu-trail {
  position: absolute; inset: 0; border-radius: 50%;
  background: conic-gradient(from 90deg, transparent 0turn, transparent .42turn, color-mix(in srgb, var(--tb) 35%, transparent) .7turn, var(--tb) .86turn, var(--ta) .995turn, transparent 1turn);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4.5px), #000 calc(100% - .5px), transparent 100%);
  mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4.5px), #000 calc(100% - .5px), transparent 100%);
}
.lu-head { position: absolute; top: 50%; right: -4px; width: 13px; height: 13px; margin-top: -6.5px; border-radius: 50%; background: var(--core); box-shadow: 0 0 0 1px rgb(255 255 255 / .5), 0 0 10px 2px var(--ta), 0 0 22px 4px color-mix(in srgb, var(--ta) 60%, transparent); }
.lu-orbit b { position: absolute; width: 4px; height: 4px; margin: -2px; border-radius: 50%; background: var(--ta); box-shadow: 0 0 6px var(--ta); opacity: 0; }
@keyframes lu-spin { to { transform: rotate(1turn); } }
.lu-pv[data-style="sparkle"] .lu-orbit b { background: #fff; animation: lu-twinkle 1.1s ease-in-out infinite; animation-delay: calc(var(--k) * -.23s); }
@keyframes lu-twinkle { 0%, 100% { opacity: 0; transform: scale(.4); } 50% { opacity: 1; transform: scale(1.2); } }
.lu-pv[data-style="prism"] .lu-trail { animation: lu-hue 3s linear infinite; }
.lu-pv[data-style="prism"] .lu-head { box-shadow: 0 0 0 1px #fff, 0 0 12px 3px #ff5ec4, 0 0 22px 6px rgb(94 231 255 / .6); }
@keyframes lu-hue { to { filter: hue-rotate(360deg); } }
.lu-pv[data-style="ember"] .lu-head { animation: lu-flicker .18s steps(2) infinite alternate; }
.lu-pv[data-style="ember"] .lu-orbit b { background: var(--tb); animation: lu-ember 1.2s ease-out infinite; animation-delay: calc(var(--k) * -.3s); }
@keyframes lu-flicker { to { transform: scale(1.18); filter: brightness(1.3); } }
@keyframes lu-ember { 0% { opacity: 1; transform: translate(0, 0) scale(1); } 100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(.2); } }
.lu-pv[data-style="void"]::before { background: #0a0a12; box-shadow: 0 0 0 1.5px rgb(199 125 255 / .8), 0 0 16px 4px rgb(199 125 255 / .5); }
.lu-pv[data-style="void"] .lu-head { box-shadow: 0 0 0 2px var(--ta), 0 0 12px 3px var(--ta), 0 0 26px 6px color-mix(in srgb, var(--ta) 55%, transparent); }
.lu-pv[data-style="void"] .lu-trail { background: conic-gradient(from 90deg, transparent 0turn, transparent .5turn, color-mix(in srgb, var(--ta) 25%, transparent) .78turn, var(--ta) .995turn, transparent 1turn); }

/* ---- instellingen ---- */
.lu-rows { display: grid; }
.lu-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 64px; padding: 6px 4px; border-bottom: 1px solid var(--lu-line); }
.lu-row:last-child { border-bottom: 0; }
.lu-row-l { display: grid; gap: 2px; min-width: 0; }
.lu-row-l b { font-weight: 500; font-size: 15px; letter-spacing: .02em; }
.lu-row-l span { font-size: 12px; color: var(--lu-faint); }
.lu-row-v { font-variant-numeric: tabular-nums; font-size: 12px; color: var(--lu-dim); width: 3.2em; text-align: right; flex: none; }
.lu-slide { display: flex; align-items: center; gap: 10px; flex: 1; max-width: 260px; }
.lu-range { -webkit-appearance: none; appearance: none; flex: 1; min-width: 96px; height: 44px; margin: 0; background: transparent; cursor: pointer; touch-action: pan-y; --v: 50%; }
.lu-range:focus { outline: none; }
.lu-range::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: linear-gradient(90deg, var(--lu-ring) 0, var(--lu-accent) var(--v), rgb(255 255 255 / .14) var(--v)); }
.lu-range::-moz-range-track { height: 4px; border-radius: 2px; background: rgb(255 255 255 / .14); }
.lu-range::-moz-range-progress { height: 4px; border-radius: 2px; background: linear-gradient(90deg, var(--lu-ring), var(--lu-accent)); }
.lu-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 22px; height: 22px; margin-top: -9px; border-radius: 50%; background: #fff; border: 0; box-shadow: 0 0 0 4px color-mix(in srgb, var(--lu-accent) 22%, transparent), 0 0 16px color-mix(in srgb, var(--lu-accent) 70%, transparent); transition: transform .4s var(--lu-spring); }
.lu-range::-moz-range-thumb { width: 22px; height: 22px; border-radius: 50%; background: #fff; border: 0; box-shadow: 0 0 0 4px color-mix(in srgb, var(--lu-accent) 22%, transparent), 0 0 16px color-mix(in srgb, var(--lu-accent) 70%, transparent); }
.lu-range:active::-webkit-slider-thumb { transform: scale(1.15); }
.lu-range:focus-visible::-webkit-slider-thumb { outline: 2px solid #fff; outline-offset: 3px; }
.lu-range:focus-visible::-moz-range-thumb { outline: 2px solid #fff; outline-offset: 3px; }
.lu-range:disabled { opacity: .4; cursor: default; }
.lu-switch { width: 60px; height: 44px; padding: 0; border-radius: 22px; flex: none; }
.lu-switch::before { content: ""; position: absolute; left: 6px; right: 6px; top: 8px; bottom: 8px; border-radius: 14px; background: rgb(255 255 255 / .12); border: 1px solid var(--lu-line); transition: background-color .3s ease, border-color .3s ease, box-shadow .3s ease; }
.lu-switch::after { content: ""; position: absolute; left: 10px; top: 12px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgb(0 0 0 / .4); transition: transform .5s var(--lu-spring); }
.lu-switch[aria-checked="true"]::before { background: color-mix(in srgb, var(--lu-accent) 70%, #fff 0%); border-color: transparent; box-shadow: 0 0 18px -2px color-mix(in srgb, var(--lu-accent) 70%, transparent); }
.lu-switch[aria-checked="true"]::after { transform: translateX(20px); }
.lu-seg { display: inline-flex; padding: 3px; border-radius: 999px; border: 1px solid var(--lu-line); background: rgb(255 255 255 / .04); flex: none; }
.lu-seg .lu-btn { min-width: 72px; height: 40px; min-height: 40px; padding: 0 14px; font-weight: 500; font-size: 13px; letter-spacing: .08em; color: var(--lu-dim); }
.lu-seg .lu-btn[aria-checked="true"] { background: #fff; color: #070812; box-shadow: 0 0 18px -4px color-mix(in srgb, var(--lu-ring) 80%, transparent); }
.lu-credits { margin: 18px 0 2px; text-align: center; font-size: 11px; letter-spacing: .32em; padding-left: .32em; text-transform: uppercase; color: var(--lu-faint); }
.lu-credits b { font-family: var(--lu-display); font-weight: 600; color: var(--lu-dim); letter-spacing: .4em; }

/* liggende telefoon: compacte kaarten */
@media (orientation: landscape) and (max-height: 560px) {
  .lu-grid { grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 10px; }
  .lu-card { padding: 10px 8px 8px; gap: 6px; }
  .lu-pv { width: 80px; height: 80px; }
  .lu-pv::after, .lu-orbit { inset: 12px; }
  .lu-card-n { font-size: 11px; letter-spacing: .16em; padding-left: .16em; }
  .lu-card .lu-btn { font-size: 10px; letter-spacing: .14em; padding: 0 6px 0 calc(6px + .14em); }
}

/* ---- rustige beweging ---- */
.lu-rm *, .lu-rm *::before, .lu-rm *::after { animation-iteration-count: 1 !important; }
.lu-rm .lu-logo span, .lu-rm .lu-primary::after, .lu-rm .lu-daily-dot, .lu-rm .lu-hint-i, .lu-rm .lu-orbit, .lu-rm .lu-orbit b,
.lu-rm .lu-trail, .lu-rm .lu-head, .lu-rm .lu-combo-t, .lu-rm .lu-heat i, .lu-rm .lu-go-burst i, .lu-rm .lu-newbest { animation: none !important; }
.lu-rm .lu-orbit { transform: rotate(-40deg); }
.lu-rm .lu-pv[data-style="sparkle"] .lu-orbit b, .lu-rm .lu-pv[data-style="ember"] .lu-orbit b { opacity: .8; }
.lu-rm .is-on .lu-in { animation: lu-fade .3s ease both; animation-delay: 0s; }
.lu-rm .lu-sheet-p { transform: none !important; transition: none; }
.lu-rm .lu-btn, .lu-rm .lu-switch::after { transition-duration: .15s; }
.lu-rm .lu-btn:active { transform: none; }
.lu-rm .is-on.is-best .lu-go-burst::before { animation: lu-fade .4s ease both; opacity: .5; }
.lu-rm .lu-heat i { opacity: .8; }
@keyframes lu-fade { from { opacity: 0; } to { opacity: 1; } }
`;
