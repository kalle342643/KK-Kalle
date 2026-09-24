/**
 * Schermen, borden en bordjes: canvas-texturen die we steeds opnieuw kunnen tekenen
 * (monitoren met de taak van een agent, het projectenbord, de cijfermuur).
 */
import * as THREE from "three";

export class CanvasScreen {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh;

  constructor(width: number, height: number, pxPerUnit = 256, opts: { glow?: boolean; transparent?: boolean } = {}) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.max(32, Math.round(width * pxPerUnit));
    this.canvas.height = Math.max(32, Math.round(height * pxPerUnit));
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const material = opts.glow
      ? new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false, transparent: opts.transparent ?? false })
      : new THREE.MeshStandardMaterial({ map: this.texture, roughness: 0.9, metalness: 0, transparent: opts.transparent ?? false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  }

  get w(): number {
    return this.canvas.width;
  }
  get h(): number {
    return this.canvas.height;
  }

  draw(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    this.ctx.save();
    this.ctx.clearRect(0, 0, this.w, this.h);
    fn(this.ctx, this.w, this.h);
    this.ctx.restore();
    this.texture.needsUpdate = true;
  }
}

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Tekst in een vak, afgekapt met … als het niet past. Geeft het aantal gebruikte regels. */
export function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): number {
  const words = text.split(/\s+/).filter(Boolean);
  let line = "";
  let lines = 0;
  for (let k = 0; k < words.length; k++) {
    const test = line ? `${line} ${words[k]}` : words[k]!;
    if (ctx.measureText(test).width > maxWidth && line) {
      if (lines === maxLines - 1) {
        let cut = line;
        while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
        ctx.fillText(`${cut}…`, x, y + lines * lineHeight);
        return lines + 1;
      }
      ctx.fillText(line, x, y + lines * lineHeight);
      lines += 1;
      line = words[k]!;
    } else {
      line = test;
    }
  }
  if (line) {
    let cut = line;
    while (cut.length > 1 && ctx.measureText(cut).width > maxWidth) cut = cut.slice(0, -1);
    ctx.fillText(cut === line ? line : `${cut}…`, x, y + lines * lineHeight);
    lines += 1;
  }
  return lines;
}

/** Een monitor: bij werk de taak en wat "code", anders een rustige schermbeveiliging. */
export function drawMonitor(
  s: CanvasScreen,
  state: { working: boolean; task: string | null; accent: string; name: string; paused: boolean; t: number },
): void {
  s.draw((ctx, w, h) => {
    if (state.paused) {
      ctx.fillStyle = "#1a1f2b";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#56607a";
      ctx.font = `600 ${h * 0.2}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("⏸", w / 2, h * 0.62);
      return;
    }
    if (!state.working) {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "#1c2437");
      g.addColorStop(1, "#27324d");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = state.accent;
      ctx.globalAlpha = 0.85;
      ctx.font = `700 ${h * 0.17}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(state.name, w / 2, h * 0.56);
      ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = "#0f1522";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = state.accent;
    ctx.fillRect(0, 0, w, h * 0.2);
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${h * 0.12}px ${FONT}`;
    ctx.textAlign = "left";
    fitText(ctx, state.task ?? "Aan het werk", w * 0.05, h * 0.145, w * 0.9, h * 0.14, 1);
    // Scrollende "code".
    const rows = 6;
    for (let r = 0; r < rows; r++) {
      const seed = Math.floor(state.t * 2) + r;
      const len = 0.25 + ((seed * 37) % 60) / 100;
      const indent = ((seed * 13) % 3) * 0.06;
      ctx.fillStyle = r % 3 === 0 ? "#7dd3fc" : r % 3 === 1 ? "#a7f3d0" : "#fcd34d";
      ctx.globalAlpha = 0.85;
      roundRect(ctx, w * (0.06 + indent), h * (0.28 + r * 0.115), w * len * 0.8, h * 0.055, h * 0.02);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

/** Bordje op de muur met de naam van de kamer. */
export function drawSign(s: CanvasScreen, text: string, accent: string, sub?: string): void {
  s.draw((ctx, w, h) => {
    roundRect(ctx, 2, 2, w - 4, h - 4, h * 0.2);
    ctx.fillStyle = "#fbfaf7";
    ctx.fill();
    ctx.fillStyle = accent;
    roundRect(ctx, 2, 2, h * 0.28, h - 4, h * 0.14);
    ctx.fill();
    ctx.fillStyle = "#1d2433";
    ctx.textAlign = "left";
    ctx.font = `700 ${h * (sub ? 0.36 : 0.46)}px ${FONT}`;
    fitText(ctx, text, h * 0.45, sub ? h * 0.48 : h * 0.64, w - h * 0.6, h * 0.4, 1);
    if (sub) {
      ctx.fillStyle = "#5b6477";
      ctx.font = `500 ${h * 0.24}px ${FONT}`;
      fitText(ctx, sub, h * 0.45, h * 0.82, w - h * 0.6, h * 0.3, 1);
    }
  });
}
