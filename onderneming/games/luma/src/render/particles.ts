// Eén gedeeld deeltjessysteem op de GPU. Een deeltje wordt één keer geschreven bij het afvuren;
// de shader rekent daarna zelf de baan uit. Ringbuffer: geen allocaties per frame.
import {
  AdditiveBlending,
  BufferGeometry,
  DynamicDrawUsage,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Points,
  ShaderMaterial,
  type Color,
} from "three";

/** Vormen van een deeltje. */
export const P_DOT = 0;
export const P_GLINT = 1;
export const P_FLICKER = 2;

// Per deeltje: x y z geboorte | vx vy vz leven | r g b grootte | demping zwaartekracht zaad vorm
const STRIDE = 16;

const VERT = /* glsl */ `
uniform float uTime;
uniform float uScale;
attribute float aBirth;
attribute vec4 aVel;
attribute vec4 aCol;
attribute vec4 aExt;
varying vec3 vColor;
varying float vAlpha;
varying float vKind;
varying float vSeed;
void main() {
  float age = uTime - aBirth;
  float k = age / aVel.w;
  if (age < 0.0 || k >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float drag = aExt.x;
  float f = drag > 0.0 ? (1.0 - exp(-drag * age)) / drag : age;
  vec3 p = position + aVel.xyz * f;
  p.y -= 0.5 * aExt.y * age * age;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float shrink = 1.0 - k * 0.65;
  gl_PointSize = max(1.0, aCol.w * uScale * shrink / -mv.z);
  float a = (1.0 - k);
  vAlpha = a * a * smoothstep(0.0, 0.04, age);
  vKind = aExt.w;
  vSeed = aExt.z;
  if (vKind > 1.5) {
    // Flikkeren: vonken en glitter.
    vAlpha *= 0.45 + 0.55 * step(0.0, sin(age * 40.0 + aExt.z * 30.0));
  }
  vColor = aCol.rgb;
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vKind;
varying float vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a;
  if (vKind > 0.5 && vKind < 1.5) {
    // Glinster: vierpuntige ster.
    float cross = exp(-abs(c.x) * 26.0) + exp(-abs(c.y) * 26.0);
    a = (cross * 0.7 + exp(-d * d * 10.0)) * (1.0 - smoothstep(0.7, 1.0, d));
  } else {
    a = exp(-d * d * 5.0) + exp(-d * d * 40.0) * 1.5;
    a *= 1.0 - smoothstep(0.8, 1.0, d);
  }
  gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
}
`;

export class Particles {
  readonly points: Points;
  /** Fractie van het aantal deeltjes (lager op "low"). */
  density = 1;
  private readonly data: Float32Array;
  private readonly buffer: InterleavedBuffer;
  private readonly geometry: BufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly capacity: number;
  private head = 0;
  private frameStart = 0;
  private frameCount = 0;
  private readonly u = { uTime: { value: 0 }, uScale: { value: 400 } };
  private now = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * STRIDE);
    for (let i = 0; i < capacity; i++) {
      this.data[i * STRIDE + 3] = -1e6; // geboren in het verre verleden: dood
      this.data[i * STRIDE + 7] = 1;
    }
    this.buffer = new InterleavedBuffer(this.data, STRIDE);
    this.buffer.setUsage(DynamicDrawUsage);
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute("position", new InterleavedBufferAttribute(this.buffer, 3, 0));
    this.geometry.setAttribute("aBirth", new InterleavedBufferAttribute(this.buffer, 1, 3));
    this.geometry.setAttribute("aVel", new InterleavedBufferAttribute(this.buffer, 4, 4));
    this.geometry.setAttribute("aCol", new InterleavedBufferAttribute(this.buffer, 4, 8));
    this.geometry.setAttribute("aExt", new InterleavedBufferAttribute(this.buffer, 4, 12));
    this.material = new ShaderMaterial({
      uniforms: this.u,
      vertexShader: VERT,
      fragmentShader: FRAG,
      blending: AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 60;
  }

  /** Klok en schaal (pixels per wereldeenheid op afstand 1) voor dit frame. */
  setFrame(time: number, scale: number): void {
    this.now = time;
    this.u.uTime.value = time;
    this.u.uScale.value = scale;
  }

  /** Aantal voor een uitbarsting, geschaald met de kwaliteit. */
  count(n: number): number {
    return Math.max(1, Math.round(n * this.density));
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    color: Color,
    intensity: number,
    size: number,
    drag: number,
    gravity: number,
    kind: number,
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    if (this.frameCount === 0) this.frameStart = i;
    this.frameCount++;
    const o = i * STRIDE;
    const d = this.data;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = this.now;
    d[o + 4] = vx;
    d[o + 5] = vy;
    d[o + 6] = vz;
    d[o + 7] = life;
    d[o + 8] = color.r * intensity;
    d[o + 9] = color.g * intensity;
    d[o + 10] = color.b * intensity;
    d[o + 11] = size;
    d[o + 12] = drag;
    d[o + 13] = gravity;
    d[o + 14] = Math.random();
    d[o + 15] = kind;
  }

  /** Uitbarsting in alle richtingen in het vlak. */
  burst(
    x: number,
    y: number,
    n: number,
    speedMin: number,
    speedMax: number,
    life: number,
    color: Color,
    intensity: number,
    size: number,
    kind: number,
    drag = 2.2,
  ): void {
    const total = this.count(n);
    for (let i = 0; i < total; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speedMin + (speedMax - speedMin) * Math.random();
      this.emit(
        x,
        y,
        0.2,
        Math.cos(a) * s,
        Math.sin(a) * s,
        (Math.random() - 0.3) * s * 0.3,
        life * (0.6 + Math.random() * 0.6),
        color,
        intensity * (0.6 + Math.random() * 0.8),
        size * (0.6 + Math.random() * 0.8),
        drag,
        0,
        kind,
      );
    }
  }

  /** Schrijf de nieuwe deeltjes van dit frame naar de GPU. */
  flush(): void {
    if (this.frameCount === 0) return;
    const b = this.buffer;
    b.clearUpdateRanges();
    if (this.frameCount >= this.capacity) {
      b.addUpdateRange(0, this.capacity * STRIDE);
    } else {
      const end = this.frameStart + this.frameCount;
      if (end <= this.capacity) {
        b.addUpdateRange(this.frameStart * STRIDE, this.frameCount * STRIDE);
      } else {
        b.addUpdateRange(this.frameStart * STRIDE, (this.capacity - this.frameStart) * STRIDE);
        b.addUpdateRange(0, (end - this.capacity) * STRIDE);
      }
    }
    b.needsUpdate = true;
    this.frameCount = 0;
  }

  /** Alles weg (nieuwe run). */
  clear(): void {
    for (let i = 0; i < this.capacity; i++) this.data[i * STRIDE + 3] = -1e6;
    // Bij de volgende flush gaat de hele buffer mee.
    this.frameStart = 0;
    this.frameCount = this.capacity;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
