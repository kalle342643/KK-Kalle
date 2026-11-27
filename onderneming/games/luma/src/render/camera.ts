// Camera: kijkt schuin omlaag op het speelvlak, volgt de komeet met vooruitblik en past zich aan de beeldverhouding aan.
import { PerspectiveCamera } from "three";
import { damp } from "./util";

export interface CameraFrame {
  dt: number;
  time: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mode: "orbit" | "fly" | "dead";
  /** Volgende ster op het pad (in een baan), anders hasTarget = false. */
  hasTarget: boolean;
  targetX: number;
  targetY: number;
  title: boolean;
}

const TILT = (24 * Math.PI) / 180;
const TITLE_TILT = (42 * Math.PI) / 180;

export class CameraRig {
  readonly camera = new PerspectiveCamera(50, 1, 0.5, 900);
  reducedMotion = false;
  private aspect = 1;
  private fx = 0;
  private fy = 0;
  private dist = 30;
  private tilt = TILT;
  private kick = 0;
  private kickV = 0;
  private kickX = 0;
  private kickY = 0;
  private shake = 0;
  private snapNext = true;

  setAspect(aspect: number): void {
    this.aspect = Math.max(0.2, aspect);
    // Staand beeld krijgt een iets wijdere blik.
    this.camera.fov = this.aspect < 1 ? 54 : 46;
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Volgende update springt direct naar de komeet (nieuwe run). */
  snap(): void {
    this.snapNext = true;
    this.kick = 0;
    this.kickV = 0;
    this.shake = 0;
  }

  /** Klein duwtje bij een vangst, in de richting (dx, dy). */
  kickCapture(strength: number, dx: number, dy: number): void {
    if (this.reducedMotion) return;
    this.kickV += strength * 6;
    this.kickX = dx;
    this.kickY = dy;
  }

  shakeDeath(): void {
    if (this.reducedMotion) return;
    this.shake = 1;
  }

  /** Pixels per wereldeenheid op afstand 1 (voor puntgroottes). */
  pixelScale(heightPx: number): number {
    return heightPx / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  update(f: CameraFrame): void {
    const dt = f.dt;
    const halfFov = (this.camera.fov * Math.PI) / 360;
    // Benodigde halve hoogte: genoeg breedte op een telefoon, genoeg vooruit op een breed scherm.
    const halfH = Math.max(10.5, 8.6 / this.aspect);
    let wantDist = halfH / Math.tan(halfFov);
    // Komeet in het onderste deel van beeld, zodat de volgende ster ruim zichtbaar is.
    const bias = halfH * (this.aspect < 1 ? 0.3 : 0.2);

    let ax = 0;
    let ay = 0;
    const speed = Math.sqrt(f.vx * f.vx + f.vy * f.vy) || 1;
    if (f.mode === "fly") {
      ax = (f.vx / speed) * 4.5;
      ay = (f.vy / speed) * 4.5;
    } else if (f.mode === "orbit" && f.hasTarget) {
      ax = (f.targetX - f.x) * 0.38;
      ay = (f.targetY - f.y) * 0.38;
      const l = Math.sqrt(ax * ax + ay * ay);
      if (l > 6) {
        ax = (ax / l) * 6;
        ay = (ay / l) * 6;
      }
    }
    let tx = f.x + ax;
    let ty = f.y + ay + bias;
    let wantTilt = TILT;
    if (f.title) {
      // Titelscherm: verder weg, langzaam zweven.
      wantDist *= 1.6;
      wantTilt = TITLE_TILT;
      const r = this.reducedMotion ? 0.3 : 1;
      // Kijk langs het pad heen: de sterren lopen schuin door een hoek, het midden blijft vrij voor het logo.
      tx = f.x + 6.5 + Math.sin(f.time * 0.071) * 3.2 * r;
      ty = f.y + 14 + Math.sin(f.time * 0.053 + 1.3) * 2.2 * r;
    }

    if (this.snapNext) {
      this.fx = tx;
      this.fy = ty;
      this.snapNext = false;
    } else {
      const lambda = f.mode === "dead" ? 1.2 : 2.6;
      this.fx = damp(this.fx, tx, lambda, dt);
      this.fy = damp(this.fy, ty, lambda, dt);
    }
    this.dist = damp(this.dist, wantDist, 1.6, dt);
    this.tilt = damp(this.tilt, wantTilt, 1.6, dt);

    // Veer voor het vangduwtje.
    this.kickV += (-90 * this.kick - 11 * this.kickV) * dt;
    this.kick += this.kickV * dt;
    this.shake = Math.max(0, this.shake - dt * 1.4);

    const d = this.dist * (1 - 0.035 * this.kick);
    let px = this.fx + this.kickX * this.kick * 0.25;
    let py = this.fy + this.kickY * this.kick * 0.25;
    if (this.shake > 0) {
      const s = this.shake * this.shake * 1.1;
      const t = f.time;
      px += s * (Math.sin(t * 47.1) * 0.6 + Math.sin(t * 23.3 + 1.7) * 0.4);
      py += s * (Math.sin(t * 39.7 + 0.4) * 0.6 + Math.sin(t * 19.1 + 2.9) * 0.4);
    }
    const cam = this.camera;
    cam.position.set(px, py - d * Math.sin(this.tilt), d * Math.cos(this.tilt));
    cam.lookAt(px, py, 0);
    if (this.shake > 0) cam.rotateZ(Math.sin(f.time * 31.0) * this.shake * this.shake * 0.02);
    cam.updateMatrixWorld();
  }
}
