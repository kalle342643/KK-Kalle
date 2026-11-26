// De komeet: felle kop, lange lintstaart (triangle strip die vervaagt en smaller wordt), vonkjes en de richtlijn.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DynamicDrawUsage,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  type PerspectiveCamera,
  type Scene,
} from "three";
import type { Skin } from "../contracts";
import { P_DOT, P_FLICKER, P_GLINT, type Particles } from "./particles";
import { NOISE_GLSL, QUAD_VERT, damp } from "./util";

const MAX_SAMPLES = 220;
const TRAIL_LIFE = 1.25;
const TRAIL_WIDTH = 0.42;

/** Vonkjes per seconde per stijl. */
const SPARK_RATE: readonly number[] = [26, 90, 46, 70, 34];

const STYLE: Record<Skin["style"], number> = { smooth: 0, sparkle: 1, prism: 2, ember: 3, void: 4 };

const TRAIL_VERT = /* glsl */ `
attribute float aAge;
attribute float aSide;
varying float vAge;
varying float vSide;
void main() {
  vAge = aAge;
  vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const TRAIL_FRAG = /* glsl */ `
uniform vec3 uA;
uniform vec3 uB;
uniform float uTime;
uniform float uStyle;
uniform float uFade;
uniform float uBoost;
varying float vAge;
varying float vSide;
${NOISE_GLSL}
vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}
void main() {
  float s = abs(vSide);
  float core = exp(-s * s * 22.0);
  float body = exp(-s * s * 3.2) * (1.0 - s * s);
  float life = 1.0 - vAge;
  float fade = life * life * (0.4 + 0.6 * life);
  vec3 c = mix(uA, uB, smoothstep(0.0, 0.8, vAge));
  float white = 1.0;
  if (uStyle > 1.5 && uStyle < 2.5) {
    c = hsv(fract(vAge * 1.3 - uTime * 0.45), 0.7, 1.0);
  } else if (uStyle > 2.5 && uStyle < 3.5) {
    c = mix(vec3(1.0, 0.82, 0.5), c, smoothstep(0.0, 0.35, vAge));
  } else if (uStyle > 3.5) {
    white = 0.15;
    body *= 0.8 + 0.6 * s;
  }
  vec3 col = c * body * 1.5 + mix(vec3(1.0), c, 0.35) * core * (1.3 - vAge) * white;
  if (uStyle > 0.5 && uStyle < 1.5) {
    // Glitter in de staart.
    float g = hash12(vec2(floor(vAge * 160.0), floor(uTime * 20.0) + floor(vSide * 3.0)));
    col += vec3(1.0, 0.95, 0.8) * step(0.92, g) * 2.5 * body;
  }
  // Uiteenvallen bij de dood.
  float n = vnoise(vec2(vAge * 24.0, vSide * 2.0 + uTime * 2.0));
  float dissolve = smoothstep(1.0 - uFade - 0.15, 1.0 - uFade + 0.15, n);
  col *= fade * mix(dissolve, 1.0, uFade * uFade) * uFade * uBoost;
  gl_FragColor = vec4(col, 1.0);
}
`;

const HEAD_FRAG = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uGlow;
uniform float uTime;
uniform float uVoid;
uniform float uBoost;
uniform float uAlive;
varying vec2 vP;
void main() {
  float r = length(vP);
  float core = 1.0 - smoothstep(0.1, 0.2, r);
  float glow = exp(-r * r * 7.0) * 1.4 + exp(-r * 2.4) * 0.3;
  // Anamorfe lensflare: een dunne horizontale streep.
  float streak = exp(-abs(vP.y) * 40.0) * exp(-abs(vP.x) * 1.1) * 0.55;
  float flick = 0.92 + 0.08 * sin(uTime * 37.0) * sin(uTime * 23.0);
  vec3 col;
  float alpha = 0.0;
  if (uVoid > 0.5) {
    float rim = exp(-pow((r - 0.17) / 0.045, 2.0));
    col = uGlow * (rim * 3.5 + glow * 0.9 + streak) + uCore * core;
    alpha = core;
  } else {
    col = uCore * core * 4.5 + uGlow * (glow * 1.5 + streak) * flick;
  }
  float edge = 1.0 - smoothstep(2.0, 2.5, max(abs(vP.x), abs(vP.y) * 1.0));
  gl_FragColor = vec4(col * uBoost * uAlive * edge, alpha * uAlive);
}
`;

// Richtlijn: getaperde stippellijn langs de raaklijn.
const AIM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec2 uSize;
uniform float uTime;
uniform float uShow;
uniform float uPerfect;
uniform float uLock;
uniform float uDanger;
varying vec2 vP;
${NOISE_GLSL}
void main() {
  float len = uSize.x * 2.0;
  float t = clamp((vP.x + uSize.x) / len, 0.0, 1.0);
  float aa = fwidth(vP.y) + 1e-4;
  float w = mix(0.055, 0.012, t) * (1.0 + 0.4 * uLock);
  float band = 1.0 - smoothstep(w - aa, w + aa, abs(vP.y));
  float n = mix(7.0, 11.0, uPerfect);
  float ph = t * n - uTime * mix(1.6, 3.2, uLock);
  float f = fract(ph);
  float dots = smoothstep(0.15, 0.3, f) * (1.0 - smoothstep(0.55, 0.7, f));
  // Bij PERFECT: fonkelende stippen.
  float tw = hash12(vec2(floor(ph), floor(uTime * 14.0)));
  float sparkle = mix(1.0, 0.5 + 1.3 * step(0.45, tw), uPerfect);
  float fade = pow(1.0 - t, 1.4) * smoothstep(0.0, 0.07, t);
  float glow = exp(-vP.y * vP.y / (0.004 + 0.006 * uLock)) * 0.25 * (1.0 - t);
  float jitter = 1.0 + uDanger * 0.35 * sin(uTime * 40.0);
  vec3 col = uColor * (band * dots * sparkle * 1.4 + glow) * fade * uShow * jitter;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Wat de komeet per frame krijgt. */
export interface CometFrame {
  time: number;
  dt: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  alive: boolean;
  orbiting: boolean;
  orbitTime: number;
  heat: number;
  /** Richtlijn tonen (alleen tijdens het spelen, in een baan). */
  aim: boolean;
  aimColor: Color;
  aimLock: boolean;
  aimPerfect: boolean;
  aimDanger: boolean;
  camera: PerspectiveCamera;
  particles: Particles;
}

export class Comet {
  private readonly trailGeo: BufferGeometry;
  private readonly trailMat: ShaderMaterial;
  private readonly trailPos: Float32Array;
  private readonly trailAge: Float32Array;
  private readonly trailSide: Float32Array;
  private readonly posAttr: BufferAttribute;
  private readonly ageAttr: BufferAttribute;
  private readonly sx = new Float32Array(MAX_SAMPLES);
  private readonly sy = new Float32Array(MAX_SAMPLES);
  private readonly st = new Float32Array(MAX_SAMPLES);
  private n = 0;
  private readonly head: Mesh;
  private readonly headMat: ShaderMaterial;
  private readonly aim: Mesh;
  private readonly aimMat: ShaderMaterial;
  private readonly quad: PlaneGeometry;
  private readonly tu = {
    uA: { value: new Color() },
    uB: { value: new Color() },
    uTime: { value: 0 },
    uStyle: { value: 0 },
    uFade: { value: 1 },
    uBoost: { value: 1 },
  };
  private readonly hu = {
    uCore: { value: new Color() },
    uGlow: { value: new Color() },
    uTime: { value: 0 },
    uVoid: { value: 0 },
    uBoost: { value: 1 },
    uAlive: { value: 1 },
    uSize: { value: new Vector2(2.5, 2.5) },
  };
  private readonly au = {
    uColor: { value: new Color() },
    uSize: { value: new Vector2(1.75, 0.15) },
    uTime: { value: 0 },
    uShow: { value: 0 },
    uPerfect: { value: 0 },
    uLock: { value: 0 },
    uDanger: { value: 0 },
  };
  private skinCore = new Color(1, 1, 1);
  private skinA = new Color();
  private skinB = new Color();
  private style = 0;
  private emitAcc = 0;
  private fade = 1;
  private boost = 1;
  private lastX = 0;
  private lastY = 0;
  private readonly tmp = new Color();
  private readonly aimCol = new Color();

  constructor(scene: Scene) {
    const verts = MAX_SAMPLES + 1;
    this.trailPos = new Float32Array(verts * 2 * 3);
    this.trailAge = new Float32Array(verts * 2);
    this.trailSide = new Float32Array(verts * 2);
    for (let i = 0; i < verts; i++) {
      this.trailSide[i * 2] = 1;
      this.trailSide[i * 2 + 1] = -1;
    }
    const index = new Uint16Array(MAX_SAMPLES * 6);
    for (let i = 0; i < MAX_SAMPLES; i++) {
      const a = i * 2;
      index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    this.trailGeo = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.trailPos, 3).setUsage(DynamicDrawUsage);
    this.ageAttr = new BufferAttribute(this.trailAge, 1).setUsage(DynamicDrawUsage);
    this.trailGeo.setAttribute("position", this.posAttr);
    this.trailGeo.setAttribute("aAge", this.ageAttr);
    this.trailGeo.setAttribute("aSide", new BufferAttribute(this.trailSide, 1));
    this.trailGeo.setIndex(new BufferAttribute(index, 1));
    this.trailGeo.setDrawRange(0, 0);
    this.trailMat = new ShaderMaterial({
      uniforms: this.tu,
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      defines: { FBM_OCT: 1 },
      blending: AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const trail = new Mesh(this.trailGeo, this.trailMat);
    trail.frustumCulled = false;
    trail.renderOrder = 40;
    scene.add(trail);

    this.quad = new PlaneGeometry(1, 1);
    this.headMat = new ShaderMaterial({
      uniforms: this.hu,
      vertexShader: QUAD_VERT,
      fragmentShader: HEAD_FRAG,
      transparent: true,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      depthTest: false,
      depthWrite: false,
    });
    this.head = new Mesh(this.quad, this.headMat);
    this.head.scale.set(5, 5, 1);
    this.head.frustumCulled = false;
    this.head.renderOrder = 50;
    scene.add(this.head);

    this.aimMat = new ShaderMaterial({
      uniforms: this.au,
      vertexShader: QUAD_VERT,
      fragmentShader: AIM_FRAG,
      defines: { FBM_OCT: 1 },
      blending: AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.aim = new Mesh(this.quad, this.aimMat);
    this.aim.frustumCulled = false;
    this.aim.renderOrder = 35;
    this.aim.visible = false;
    scene.add(this.aim);
  }

  setSkin(skin: Skin): void {
    this.skinCore.setHex(skin.core);
    this.skinA.setHex(skin.trailA);
    this.skinB.setHex(skin.trailB);
    this.style = STYLE[skin.style];
    this.tu.uA.value.copy(this.skinA);
    this.tu.uB.value.copy(this.skinB);
    this.tu.uStyle.value = this.style;
    this.hu.uCore.value.copy(this.skinCore);
    this.hu.uGlow.value.copy(this.skinA);
    this.hu.uVoid.value = this.style === 4 ? 1 : 0;
  }

  reset(): void {
    this.n = 0;
    this.fade = 1;
    this.emitAcc = 0;
    this.trailGeo.setDrawRange(0, 0);
    this.hu.uAlive.value = 1;
    this.au.uShow.value = 0;
  }

  /** Korte opflakkering (vangst). */
  pulse(amount: number): void {
    this.boost = Math.max(this.boost, 1 + amount);
  }

  /** De komeet spat uiteen. */
  shatter(x: number, y: number, vx: number, vy: number, p: Particles): void {
    const n = p.count(240);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1.5 + Math.pow(Math.random(), 1.5) * 13;
      const c = i % 3 === 0 ? this.skinCore : i % 3 === 1 ? this.skinA : this.skinB;
      p.emit(
        x,
        y,
        0.3,
        Math.cos(a) * s + vx * 0.25,
        Math.sin(a) * s + vy * 0.25,
        (Math.random() - 0.5) * 3,
        0.9 + Math.random() * 1.6,
        this.style === 4 && c === this.skinB ? this.skinA : c,
        2 + Math.random() * 3,
        0.14 + Math.random() * 0.3,
        1.4 + Math.random(),
        0,
        i % 4 === 0 ? P_GLINT : i % 4 === 1 ? P_FLICKER : P_DOT,
      );
    }
  }

  update(f: CometFrame): void {
    const t = f.time;
    this.boost = damp(this.boost, 1, 5, f.dt);
    this.tu.uTime.value = t;
    this.tu.uBoost.value = this.boost;
    this.hu.uTime.value = t;
    this.hu.uBoost.value = this.boost;

    if (f.alive) {
      this.fade = 1;
      this.hu.uAlive.value = damp(this.hu.uAlive.value, 1, 10, f.dt);
      this.lastX = f.x;
      this.lastY = f.y;
      // Nieuw monster als er genoeg tijd of afstand is.
      const dx = f.x - (this.sx[0] ?? 0);
      const dy = f.y - (this.sy[0] ?? 0);
      if (this.n === 0 || t - (this.st[0] ?? 0) >= 1 / 100 || dx * dx + dy * dy > 0.04) this.pushSample(f.x, f.y, t);
      this.emitSparks(f);
    } else {
      this.fade = damp(this.fade, 0, 2.4, f.dt);
      this.hu.uAlive.value = 0;
    }
    this.tu.uFade.value = this.fade;
    this.head.position.set(this.lastX, this.lastY, 0.4);
    this.head.quaternion.copy(f.camera.quaternion);
    const sc = 4.6 + 0.6 * (this.boost - 1);
    this.head.scale.set(sc, sc, 1);
    this.hu.uSize.value.set(sc / 2, sc / 2);
    this.buildTrail(t);
    this.updateAim(f);
  }

  private pushSample(x: number, y: number, t: number): void {
    const m = Math.min(this.n, MAX_SAMPLES - 1);
    this.sx.copyWithin(1, 0, m);
    this.sy.copyWithin(1, 0, m);
    this.st.copyWithin(1, 0, m);
    this.sx[0] = x;
    this.sy[0] = y;
    this.st[0] = t;
    this.n = m + 1;
  }

  private buildTrail(t: number): void {
    // Oude monsters vallen weg.
    while (this.n > 0 && t - (this.st[this.n - 1] ?? 0) > TRAIL_LIFE) this.n--;
    // Punt 0 is de kop zelf, daarna de monsters.
    const count = this.n + 1;
    if (count < 2) {
      this.trailGeo.setDrawRange(0, 0);
      return;
    }
    const P = this.trailPos;
    let nx = 0;
    let ny = 1;
    for (let i = 0; i < count; i++) {
      const x = i === 0 ? this.lastX : (this.sx[i - 1] ?? 0);
      const y = i === 0 ? this.lastY : (this.sy[i - 1] ?? 0);
      const age = i === 0 ? 0 : Math.min(1, (t - (this.st[i - 1] ?? 0)) / TRAIL_LIFE);
      // Richting uit de buren.
      const ia = Math.max(0, i - 1);
      const ib = Math.min(count - 1, i + 1);
      const ax = ia === 0 ? this.lastX : (this.sx[ia - 1] ?? 0);
      const ay = ia === 0 ? this.lastY : (this.sy[ia - 1] ?? 0);
      const bx = ib === 0 ? this.lastX : (this.sx[ib - 1] ?? 0);
      const by = ib === 0 ? this.lastY : (this.sy[ib - 1] ?? 0);
      const tx = ax - bx;
      const ty = ay - by;
      const tl = Math.sqrt(tx * tx + ty * ty);
      if (tl > 1e-5) {
        nx = -ty / tl;
        ny = tx / tl;
      }
      const life = 1 - age;
      const w = TRAIL_WIDTH * Math.pow(life, 0.9) * (0.55 + 0.45 * Math.min(1, age * 14 + 0.2));
      const o = i * 6;
      P[o] = x + nx * w;
      P[o + 1] = y + ny * w;
      P[o + 2] = 0.05;
      P[o + 3] = x - nx * w;
      P[o + 4] = y - ny * w;
      P[o + 5] = 0.05;
      this.trailAge[i * 2] = age;
      this.trailAge[i * 2 + 1] = age;
    }
    this.posAttr.clearUpdateRanges();
    this.posAttr.addUpdateRange(0, count * 6);
    this.posAttr.needsUpdate = true;
    this.ageAttr.clearUpdateRanges();
    this.ageAttr.addUpdateRange(0, count * 2);
    this.ageAttr.needsUpdate = true;
    this.trailGeo.setDrawRange(0, (count - 1) * 6);
  }

  private emitSparks(f: CometFrame): void {
    const p = f.particles;
    const rate = (SPARK_RATE[this.style] ?? 30) * p.density;
    this.emitAcc += rate * f.dt;
    // Hitte: extra gloeiende vonken.
    const hot = f.orbiting ? Math.max(0, f.heat - 0.45) * 2 : 0;
    this.emitAcc += hot * 40 * p.density * f.dt;
    const speed = Math.sqrt(f.vx * f.vx + f.vy * f.vy) || 1;
    const ux = f.vx / speed;
    const uy = f.vy / speed;
    let guard = 0;
    while (this.emitAcc >= 1 && guard++ < 16) {
      this.emitAcc -= 1;
      const a = Math.random() * Math.PI * 2;
      const j = Math.random() * 0.9;
      const bx = f.x - ux * Math.random() * 0.3;
      const by = f.y - uy * Math.random() * 0.3;
      let c: Color = Math.random() < 0.5 ? this.skinA : this.skinB;
      let kind = P_DOT;
      let gravity = 0;
      let life = 0.5 + Math.random() * 0.6;
      let size = 0.1 + Math.random() * 0.12;
      let inten = 1.6;
      switch (this.style) {
        case 1:
          kind = Math.random() < 0.6 ? P_GLINT : P_FLICKER;
          size = 0.16 + Math.random() * 0.22;
          c = Math.random() < 0.4 ? this.skinCore : c;
          inten = 2.4;
          break;
        case 2:
          c = this.tmp.setHSL((f.time * 0.4 + Math.random() * 0.3) % 1, 0.85, 0.62);
          kind = Math.random() < 0.3 ? P_GLINT : P_DOT;
          break;
        case 3:
          kind = P_FLICKER;
          gravity = 5;
          life = 0.6 + Math.random() * 0.7;
          c = Math.random() < 0.3 ? this.skinCore : c;
          inten = 2.6;
          break;
        case 4:
          c = this.skinA;
          inten = 1.3;
          break;
        default:
          break;
      }
      if (hot > 0 && Math.random() < hot * 0.5) {
        c = this.tmp.setRGB(1, 0.35 + Math.random() * 0.3, 0.12);
        kind = P_FLICKER;
        inten = 3;
      }
      p.emit(
        bx,
        by,
        0.2,
        -ux * 1.2 + Math.cos(a) * j,
        -uy * 1.2 + Math.sin(a) * j,
        Math.random() * 0.4,
        life,
        c,
        inten,
        size,
        1.8,
        gravity,
        kind,
      );
    }
    if (this.emitAcc > 16) this.emitAcc = 0;
  }

  private updateAim(f: CometFrame): void {
    const u = this.au;
    const want = f.aim && f.alive && f.orbiting && f.orbitTime > 0.12 ? 1 : 0;
    u.uShow.value = damp(u.uShow.value, want, want ? 7 : 16, f.dt);
    u.uLock.value = damp(u.uLock.value, f.aimLock ? 1 : 0, 18, f.dt);
    u.uPerfect.value = damp(u.uPerfect.value, f.aimPerfect ? 1 : 0, 18, f.dt);
    u.uDanger.value = damp(u.uDanger.value, f.aimDanger ? 1 : 0, 18, f.dt);
    this.aimCol.lerp(f.aimColor, 1 - Math.exp(-14 * f.dt));
    u.uColor.value.copy(this.aimCol).multiplyScalar(0.9 + 0.8 * u.uLock.value);
    u.uTime.value = f.time;
    this.aim.visible = u.uShow.value > 0.01;
    if (!this.aim.visible) return;
    const speed = Math.sqrt(f.vx * f.vx + f.vy * f.vy) || 1;
    const ux = f.vx / speed;
    const uy = f.vy / speed;
    const len = 3.5 + 0.6 * u.uLock.value;
    const start = 0.25;
    this.aim.position.set(f.x + ux * (start + len / 2), f.y + uy * (start + len / 2), 0.1);
    this.aim.rotation.set(0, 0, Math.atan2(uy, ux));
    this.aim.scale.set(len, 0.3, 1);
    u.uSize.value.set(len / 2, 0.15);
  }

  dispose(): void {
    this.trailGeo.dispose();
    this.trailMat.dispose();
    this.headMat.dispose();
    this.aimMat.dispose();
    this.quad.dispose();
  }
}
