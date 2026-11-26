// Sterren, vangringen, zwarte gaten en scherven. Meshes per ster worden hergebruikt (pool, sleutel = star.id).
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Mesh,
  Object3D,
  OctahedronGeometry,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  type PerspectiveCamera,
  type Scene,
} from "three";
import { SIM } from "../sim/config";
import type { Star, World } from "../sim/types";
import { NOISE3_GLSL, NOISE_GLSL, QUAD_VERT, damp, zoneColors } from "./util";

// ---------- shaders ----------

const CORE_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vO;
void main() {
  vO = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const CORE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uHeat;
uniform float uFlash;
uniform float uSeed;
varying vec3 vN;
varying vec3 vV;
varying vec3 vO;
${NOISE3_GLSL}
void main() {
  float mu = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  vec3 p = vO * 3.2 + vec3(uSeed, uSeed * 0.7, uTime * 0.25);
  float g = vnoise3(p) * 0.6 + vnoise3(p * 2.3 + uTime * 0.2) * 0.4;
  vec3 hot = mix(uColor, vec3(1.0), 0.8);
  vec3 col = mix(uColor * 0.9, hot * 1.9, pow(mu, 1.6));
  col *= 0.7 + 0.6 * g;
  col += uColor * pow(1.0 - mu, 2.5) * 0.8;
  float flare = uHeat * uHeat * (0.75 + 0.25 * sin(uTime * (6.0 + uHeat * 20.0)));
  col = mix(col, vec3(1.0, 0.42, 0.22) * 4.0 * (0.7 + g * 0.6), flare * 0.7);
  col *= 1.0 + uFlash * 1.5 + flare * 1.2;
  gl_FragColor = vec4(col, 1.0);
}
`;

// Gloed en corona: vlak naar de camera, vP in eenheden van de kernstraal.
const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uAccent;
uniform float uTime;
uniform float uHeat;
uniform float uFlash;
uniform float uGiant;
uniform float uSeed;
uniform vec2 uSize;
varying vec2 vP;
${NOISE_GLSL}
void main() {
  float r = length(vP);
  float edge = 1.0 - smoothstep(uSize.x * 0.65, uSize.x, r);
  float o = max(r - 0.92, 0.0);
  vec2 dir = vP / max(r, 1e-4);
  // Corona: stralen uit ruis in poolcoördinaten zonder naad (richting als invoer).
  float rays = fbm(dir * (2.2 + uGiant * 1.5) + vec2(uSeed) + vec2(0.0, -r * 0.35 + uTime * 0.12));
  rays = pow(rays, 2.0) * 2.2;
  float halo = exp(-o * 3.2) * 0.55 + exp(-o * 0.9) * 0.07;
  float corona = rays * exp(-o * (1.7 - uGiant * 0.6)) * 0.45;
  vec3 c = mix(uColor, uAccent, uGiant * 0.35 * smoothstep(0.3, 2.5, o));
  float heat = uHeat * uHeat;
  c = mix(c, vec3(1.0, 0.35, 0.15), heat * 0.6);
  vec3 col = c * (halo + corona * (0.55 + uGiant * 0.5)) * (1.0 + uFlash * 1.2 + heat * 1.5);
  gl_FragColor = vec4(col * edge, 1.0);
}
`;

const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uAccent;
uniform float uR;
uniform float uInner;
uniform float uTime;
uniform float uHeat;
uniform float uApproach;
uniform float uLock;
uniform float uShimmer;
uniform float uEntry;
uniform float uPerfect;
uniform float uDanger;
uniform float uVisited;
uniform float uFlash;
uniform float uDir;
uniform float uDashes;
varying vec2 vP;
const float TAU = 6.2831853;
float arc(float a, float head, float width) {
  float d = abs(mod(a - head + 3.1415927, TAU) - 3.1415927);
  return exp(-d * d / width);
}
void main() {
  float r = length(vP);
  float aa = fwidth(r);
  float a = atan(vP.y, vP.x);
  // Hitte: van ringkleur naar heet rood, op het eind wit; sneller kloppen.
  float hp = 0.5 + 0.5 * sin(uTime * (3.5 + uHeat * 16.0));
  vec3 hot = mix(vec3(1.0, 0.22, 0.06), vec3(1.0, 0.88, 0.8), smoothstep(0.78, 1.0, uHeat));
  vec3 col = mix(uColor, hot * 1.3, smoothstep(0.12, 0.65, uHeat));
  col = mix(col, uAccent, uPerfect * uLock);
  col = mix(col, vec3(1.0, 0.18, 0.12), uDanger * uLock);

  float w = mix(0.03, 0.07, uLock) + uHeat * 0.035;
  float d = abs(r - uR);
  float line = 1.0 - smoothstep(w - aa, w + aa, d);
  float glow = exp(-d * d / (0.05 + 0.1 * uLock + 0.08 * uHeat));

  // Streepjes net buiten de ring, die langzaam draaien en bij het vastklikken naar binnen schuiven.
  float dashR = uR + mix(0.36, 0.17, uLock);
  float dd = abs(r - dashR);
  float seg = fract(a / TAU * uDashes + uTime * 0.05 * uDir * (1.0 + 2.0 * uLock));
  float dashMask = smoothstep(0.45, 0.55, seg) * (1.0 - smoothstep(0.9, 1.0, seg));
  float dw = 0.016 + 0.01 * uLock;
  float dash = dashMask * (1.0 - smoothstep(dw - aa, dw + aa, dd));

  // Vastklikken: twee lichtbogen lopen vanaf de kant van de komeet om de ring heen.
  float sh = 0.0;
  if (uShimmer < 1.0) {
    float e = 1.0 - pow(1.0 - uShimmer, 2.0);
    float fade = 1.0 - uShimmer;
    sh = (arc(a, uEntry + e * 3.1415927, 0.08) + arc(a, uEntry - e * 3.1415927, 0.08)) * fade;
    sh *= exp(-d * d / 0.02);
  }

  // Een zweem kleur binnen de ring: het vanggebied.
  float fill = smoothstep(uR, uR * 0.25, r) * (0.025 + 0.05 * uApproach + 0.06 * uLock);

  // PERFECT: de scheerbaan rond de kern licht op en fonkelt.
  float pd = abs(r - uInner);
  float spark = 0.55 + 0.45 * sin(a * 14.0 - uTime * 9.0);
  float pband = exp(-pd * pd / 0.006) * uPerfect * uLock * spark;

  float inten = (0.85 + 0.9 * uApproach + 1.3 * uLock) * mix(1.0, 0.42, uVisited) * (1.0 + uFlash * 2.5);
  inten *= mix(1.0, 0.55 + 0.9 * hp, smoothstep(0.08, 0.45, uHeat));
  vec3 outc = col * (line * 1.7 + glow * 0.32 + dash * (0.45 + 0.9 * uLock) + fill) * inten;
  outc += col * sh * 3.0;
  outc += uAccent * pband * 2.6;
  gl_FragColor = vec4(outc, 1.0);
}
`;

const TRACK_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec2 uSize;
uniform float uTime;
varying vec2 vP;
void main() {
  float aa = fwidth(vP.y) + 1e-4;
  float len = uSize.x - 0.2;
  float inside = 1.0 - smoothstep(len, len + 0.05, abs(vP.x));
  float dots = smoothstep(0.35, 0.5, fract(vP.x * 1.6)) * (1.0 - smoothstep(0.65, 0.8, fract(vP.x * 1.6)));
  float line = (1.0 - smoothstep(0.012, 0.012 + aa * 1.5, abs(vP.y))) * dots * inside;
  // Eindstreepjes.
  float cap = (1.0 - smoothstep(0.02, 0.02 + aa * 1.5, abs(abs(vP.x) - len))) * (1.0 - smoothstep(0.12, 0.14, abs(vP.y)));
  float glow = exp(-vP.y * vP.y * 60.0) * inside * 0.12;
  gl_FragColor = vec4(uColor * (line * 0.45 + cap * 0.7 + glow), 1.0);
}
`;

// Zwart gat: voorvermenigvuldigde alfa. rgb = licht, a = hoeveel het de achtergrond opslokt.
const HOLE_FRAG = /* glsl */ `
uniform vec3 uA;
uniform vec3 uB;
uniform float uCore;
uniform float uPull;
uniform float uTime;
uniform float uNear;
uniform float uSeed;
varying vec2 vP;
${NOISE_GLSL}
void main() {
  float r = length(vP);
  float rc = r / uCore;
  float a = atan(vP.y, vP.x);
  // Zwaartekrachtput: de achtergrond wordt donker naar het midden.
  float well = smoothstep(uPull * 1.05, uCore * 1.1, r);
  float dark = 0.7 * pow(well, 1.6);
  float hor = 1.0 - smoothstep(0.96, 1.02, rc);
  // Accretieschijf: spiraal die naar binnen draait.
  float lr = log(max(rc, 1e-3));
  float rot = uTime * 1.6 / pow(max(rc, 1.0), 1.5) + 2.6 * lr;
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 q = mat2(cs, -sn, sn, cs) * (vP / uCore);
  float n = fbm(q * 1.7 + uSeed);
  float arms = 0.5 + 0.5 * sin(2.0 * a - 7.0 * lr + uTime * 2.2);
  float disk = smoothstep(1.02, 1.3, rc) * (1.0 - smoothstep(1.6, 3.8, rc));
  // Dopplerglans: de ene kant van de schijf is feller.
  float beam = 0.6 + 0.55 * cos(a - 0.7);
  float swirl = disk * (0.25 + 0.95 * n * n * 1.6) * (0.45 + 0.55 * arms) * beam;
  vec3 col = mix(uB, uA, n) * swirl * 2.2;
  col += mix(uA, vec3(1.0), 0.6) * exp(-(rc - 1.1) * (rc - 1.1) * 30.0) * smoothstep(0.98, 1.05, rc) * 1.6 * beam;
  // Fotonenring en een vage lensring verder weg.
  float pr = rc - 1.06;
  col += vec3(1.0, 0.95, 0.9) * exp(-pr * pr / 0.0012) * 2.2;
  float lr2 = rc - (2.75 + 0.06 * sin(a * 3.0 + uTime * 0.7));
  col += mix(uB, vec3(1.0), 0.4) * exp(-lr2 * lr2 / 0.004) * 0.35;
  // Rimpels die naar binnen kruipen.
  float rip = pow(0.5 + 0.5 * sin(r * 4.2 + uTime * 3.0), 12.0) * well * (1.0 - well) * 0.5;
  col += uB * rip * 0.6;
  col *= 1.0 + uNear * 2.5;
  col *= 1.0 - hor;
  float alpha = max(hor, dark);
  gl_FragColor = vec4(col, alpha);
}
`;

const SHARD_VERT = /* glsl */ `
varying vec3 vPos;
varying vec3 vColor;
void main() {
  vec4 p = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  p = instanceMatrix * p;
  #endif
  #ifdef USE_INSTANCING_COLOR
  vColor = instanceColor;
  #else
  vColor = vec3(1.0);
  #endif
  vec4 mv = modelViewMatrix * p;
  vPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const SHARD_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vPos;
varying vec3 vColor;
void main() {
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  vec3 v = normalize(-vPos);
  float f = abs(dot(n, v));
  float glint = pow(f, 18.0) * 4.0;
  vec3 col = vColor * (0.9 + 1.6 * f) + vec3(1.0) * glint;
  gl_FragColor = vec4(col, 1.0);
}
`;

const GLINT_VERT = /* glsl */ `
uniform float uTime;
uniform float uScale;
attribute float aSeed;
attribute vec3 aColor;
varying vec3 vColor;
varying float vTw;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vTw = 0.55 + 0.45 * sin(uTime * 3.0 + aSeed * 6.283);
  vColor = aColor;
  gl_PointSize = 1.4 * uScale / -mv.z * (0.8 + 0.4 * vTw);
}
`;

const GLINT_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vTw;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float cross = exp(-abs(c.x) * 40.0) * exp(-abs(c.y) * 3.0) + exp(-abs(c.y) * 40.0) * exp(-abs(c.x) * 3.0);
  float a = (cross * vTw * 0.9 + exp(-d * d * 9.0) * 0.5) * (1.0 - smoothstep(0.75, 1.0, d));
  gl_FragColor = vec4(vColor * a * 1.6, 1.0);
}
`;

// ---------- types ----------

interface StarVis {
  id: number;
  seen: number;
  group: Group;
  core: Mesh;
  glow: Mesh;
  ring: Mesh;
  track: Mesh;
  cu: {
    uColor: { value: Color };
    uTime: { value: number };
    uHeat: { value: number };
    uFlash: { value: number };
    uSeed: { value: number };
  };
  gu: {
    uColor: { value: Color };
    uAccent: { value: Color };
    uTime: { value: number };
    uHeat: { value: number };
    uFlash: { value: number };
    uGiant: { value: number };
    uSeed: { value: number };
    uSize: { value: Vector2 };
  };
  ru: {
    uColor: { value: Color };
    uAccent: { value: Color };
    uSize: { value: Vector2 };
    uR: { value: number };
    uInner: { value: number };
    uTime: { value: number };
    uHeat: { value: number };
    uApproach: { value: number };
    uLock: { value: number };
    uShimmer: { value: number };
    uEntry: { value: number };
    uPerfect: { value: number };
    uDanger: { value: number };
    uVisited: { value: number };
    uFlash: { value: number };
    uDir: { value: number };
    uDashes: { value: number };
  };
  tu: { uColor: { value: Color }; uSize: { value: Vector2 }; uTime: { value: number } };
  approach: number;
  lock: number;
  locked: boolean;
  shimmer: number;
  pop: number;
  heat: number;
  flash: number;
  perfect: number;
  visited: number;
}

interface HoleVis {
  id: number;
  seen: number;
  mesh: Mesh;
  u: {
    uA: { value: Color };
    uB: { value: Color };
    uCore: { value: number };
    uPull: { value: number };
    uTime: { value: number };
    uNear: { value: number };
    uSeed: { value: number };
    uSize: { value: Vector2 };
  };
}

/** Wat de sterren per frame van de rest weten. */
export interface StarFrame {
  time: number;
  dt: number;
  cometX: number;
  cometY: number;
  flying: boolean;
  orbitStarId: number;
  heat: number;
  aimStarId: number | null;
  aimPerfect: boolean;
  aimDanger: boolean;
  camera: PerspectiveCamera;
  scale: number;
}

const SHARD_MAX = 96;
const GLOW_K = 7.5;
const GIANT_GLOW_K = 9.5;

export class Stars {
  private readonly scene: Scene;
  private readonly sphere: SphereGeometry;
  private readonly quad: PlaneGeometry;
  private readonly active: StarVis[] = [];
  private readonly free: StarVis[] = [];
  private readonly byId = new Map<number, StarVis>();
  private readonly holes: HoleVis[] = [];
  private readonly freeHoles: HoleVis[] = [];
  private readonly holeById = new Map<number, HoleVis>();
  private frameNo = 0;

  private readonly shardMesh: InstancedMesh;
  private readonly shardMat: ShaderMaterial;
  private readonly shardGeo: OctahedronGeometry;
  private readonly glintGeo: BufferGeometry;
  private readonly glintMat: ShaderMaterial;
  private readonly glintPos: Float32Array;
  private readonly glintSeed: Float32Array;
  private readonly glintCol: Float32Array;
  private readonly glintAttrs: BufferAttribute[];
  private readonly glintU = { uTime: { value: 0 }, uScale: { value: 400 } };
  private readonly shardU = { uTime: { value: 0 } };
  private readonly dummy = new Object3D();
  private readonly tmpColor = new Color();

  constructor(scene: Scene, low: boolean) {
    this.scene = scene;
    this.sphere = new SphereGeometry(1, low ? 24 : 40, low ? 16 : 28);
    this.quad = new PlaneGeometry(1, 1);

    this.shardGeo = new OctahedronGeometry(1, 0);
    this.shardMat = new ShaderMaterial({ uniforms: this.shardU, vertexShader: SHARD_VERT, fragmentShader: SHARD_FRAG });
    this.shardMesh = new InstancedMesh(this.shardGeo, this.shardMat, SHARD_MAX);
    this.shardMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.shardMesh.setColorAt(0, this.tmpColor.setRGB(1, 1, 1));
    this.shardMesh.count = 0;
    this.shardMesh.frustumCulled = false;
    this.shardMesh.renderOrder = 30;
    scene.add(this.shardMesh);

    this.glintPos = new Float32Array(SHARD_MAX * 3);
    this.glintSeed = new Float32Array(SHARD_MAX);
    this.glintCol = new Float32Array(SHARD_MAX * 3);
    this.glintGeo = new BufferGeometry();
    this.glintAttrs = [
      new BufferAttribute(this.glintPos, 3).setUsage(DynamicDrawUsage),
      new BufferAttribute(this.glintSeed, 1).setUsage(DynamicDrawUsage),
      new BufferAttribute(this.glintCol, 3).setUsage(DynamicDrawUsage),
    ];
    this.glintGeo.setAttribute("position", this.glintAttrs[0] as BufferAttribute);
    this.glintGeo.setAttribute("aSeed", this.glintAttrs[1] as BufferAttribute);
    this.glintGeo.setAttribute("aColor", this.glintAttrs[2] as BufferAttribute);
    this.glintGeo.setDrawRange(0, 0);
    this.glintMat = new ShaderMaterial({
      uniforms: this.glintU,
      vertexShader: GLINT_VERT,
      fragmentShader: GLINT_FRAG,
      blending: AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const glints = new Points(this.glintGeo, this.glintMat);
    glints.frustumCulled = false;
    glints.renderOrder = 31;
    scene.add(glints);
  }

  /** Laat een ster kort oplichten (vangst). */
  flashStar(id: number, amount: number): void {
    const v = this.byId.get(id);
    if (v) v.flash = Math.max(v.flash, amount);
  }

  nearMiss(id: number): void {
    const h = this.holeById.get(id);
    if (h) h.u.uNear.value = 1;
  }

  /** Alle meshes vrijgeven (nieuwe wereld). */
  clear(): void {
    while (this.active.length > 0) {
      const v = this.active.pop();
      if (v) this.releaseStar(v);
    }
    while (this.holes.length > 0) {
      const h = this.holes.pop();
      if (h) this.releaseHole(h);
    }
  }

  update(world: World, f: StarFrame): void {
    this.frameNo++;
    const stars = world.stars;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      if (!s) continue;
      if (s.kind === "blackhole") this.updateHole(s, f);
      else this.updateStar(s, f);
    }
    // Opruimen wat de sim niet meer heeft.
    for (let i = this.active.length - 1; i >= 0; i--) {
      const v = this.active[i];
      if (v && v.seen !== this.frameNo) {
        this.active[i] = this.active[this.active.length - 1] as StarVis;
        this.active.pop();
        this.releaseStar(v);
      }
    }
    for (let i = this.holes.length - 1; i >= 0; i--) {
      const h = this.holes[i];
      if (h && h.seen !== this.frameNo) {
        this.holes[i] = this.holes[this.holes.length - 1] as HoleVis;
        this.holes.pop();
        this.releaseHole(h);
      }
    }
    this.updateShards(world, f);
  }

  private updateStar(s: Star, f: StarFrame): void {
    let v = this.byId.get(s.id);
    if (!v) v = this.acquireStar(s);
    v.seen = this.frameNo;
    const dt = f.dt;
    v.group.position.set(s.pos.x, s.pos.y, 0);
    v.glow.quaternion.copy(f.camera.quaternion);

    // Nadering van de vliegende komeet.
    const dx = f.cometX - s.pos.x;
    const dy = f.cometY - s.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const near = f.flying ? Math.max(0, Math.min(1, 1 - (dist - s.ring) / 7)) : 0;
    v.approach = damp(v.approach, near * near, 6, dt);

    // Vastklikken op het doel van de richtlijn.
    const isAim = f.aimStarId === s.id;
    if (isAim && !v.locked) {
      v.shimmer = 0;
      v.pop = 1;
    }
    v.locked = isAim;
    v.lock = damp(v.lock, isAim ? 1 : 0, isAim ? 22 : 9, dt);
    v.shimmer = Math.min(1, v.shimmer + dt / 0.42);
    v.pop = damp(v.pop, 0, 9, dt);
    if (isAim) v.perfect = damp(v.perfect, f.aimPerfect ? 1 : 0, 16, dt);
    else v.perfect = damp(v.perfect, 0, 8, dt);

    const orbiting = f.orbitStarId === s.id;
    v.heat = damp(v.heat, orbiting ? f.heat : 0, orbiting ? 10 : 3, dt);
    v.flash = damp(v.flash, 0, 4.5, dt);
    v.visited = damp(v.visited, s.visited && !orbiting ? 1 : 0, 2, dt);

    // Kern en gloed.
    const giant = s.kind === "giant";
    const breathe = 1 + 0.015 * Math.sin(f.time * 2.1 + s.id) + v.heat * v.heat * 0.08 * Math.sin(f.time * 22);
    v.core.scale.setScalar(s.core * breathe);
    v.cu.uTime.value = f.time;
    v.cu.uHeat.value = v.heat;
    v.cu.uFlash.value = v.flash;
    const k = giant ? GIANT_GLOW_K : GLOW_K;
    v.glow.scale.setScalar(s.core * 2 * k);
    v.gu.uTime.value = f.time;
    v.gu.uHeat.value = v.heat;
    v.gu.uFlash.value = v.flash + v.lock * 0.25;

    // Ring: volgt star.ring (pulse) met een klein 'pop' bij het vastklikken.
    const r = s.ring * (1 + 0.05 * v.pop);
    const half = r + 0.8;
    v.ring.scale.set(half * 2, half * 2, 1);
    const ru = v.ru;
    ru.uSize.value.set(half, half);
    ru.uR.value = r;
    ru.uTime.value = f.time;
    ru.uHeat.value = v.heat;
    ru.uApproach.value = v.approach;
    ru.uLock.value = v.lock;
    ru.uShimmer.value = v.shimmer;
    ru.uEntry.value = Math.atan2(dy, dx);
    ru.uPerfect.value = v.perfect;
    ru.uDanger.value = isAim && f.aimDanger ? 1 : 0;
    ru.uVisited.value = v.visited;
    ru.uFlash.value = v.flash;

    if (s.kind === "mover") {
      v.track.visible = true;
      v.track.position.set(s.base.x - s.pos.x, 0, -0.01);
      v.tu.uTime.value = f.time;
    }
  }

  private acquireStar(s: Star): StarVis {
    const v = this.free.pop() ?? this.createStar();
    v.id = s.id;
    v.approach = 0;
    v.lock = 0;
    v.locked = false;
    v.shimmer = 1;
    v.pop = 0;
    v.heat = 0;
    v.flash = 0;
    v.perfect = 0;
    v.visited = s.visited ? 1 : 0;
    const zc = zoneColors(s.zone);
    const giant = s.kind === "giant";
    v.cu.uColor.value.copy(zc.star);
    v.cu.uSeed.value = (s.id * 7.31) % 50;
    v.gu.uColor.value.copy(zc.star);
    v.gu.uAccent.value.copy(zc.accent);
    v.gu.uGiant.value = giant ? 1 : 0;
    v.gu.uSeed.value = (s.id * 3.17) % 40;
    const k = giant ? GIANT_GLOW_K : GLOW_K;
    v.gu.uSize.value.set(k, k);
    v.ru.uColor.value.copy(zc.ring);
    v.ru.uAccent.value.copy(zc.accent);
    v.ru.uInner.value = s.core * SIM.minOrbitFactor + SIM.minOrbitMargin + SIM.perfectWindow * 0.5;
    v.ru.uDir.value = s.id % 2 === 0 ? 1 : -1;
    v.ru.uDashes.value = giant ? 56 : 40;
    v.track.visible = s.kind === "mover";
    if (s.kind === "mover") {
      const hw = s.moveAmp + 0.2;
      v.track.scale.set(hw * 2, 0.4, 1);
      v.tu.uSize.value.set(hw, 0.2);
      v.tu.uColor.value.copy(zc.ring);
    }
    v.group.visible = true;
    this.byId.set(s.id, v);
    this.active.push(v);
    return v;
  }

  private releaseStar(v: StarVis): void {
    v.group.visible = false;
    if (this.byId.get(v.id) === v) this.byId.delete(v.id);
    this.free.push(v);
  }

  private createStar(): StarVis {
    const cu = {
      uColor: { value: new Color() },
      uTime: { value: 0 },
      uHeat: { value: 0 },
      uFlash: { value: 0 },
      uSeed: { value: 0 },
    };
    const gu = {
      uColor: { value: new Color() },
      uAccent: { value: new Color() },
      uTime: { value: 0 },
      uHeat: { value: 0 },
      uFlash: { value: 0 },
      uGiant: { value: 0 },
      uSeed: { value: 0 },
      uSize: { value: new Vector2(GLOW_K, GLOW_K) },
    };
    const ru = {
      uColor: { value: new Color() },
      uAccent: { value: new Color() },
      uSize: { value: new Vector2(1, 1) },
      uR: { value: 1 },
      uInner: { value: 1 },
      uTime: { value: 0 },
      uHeat: { value: 0 },
      uApproach: { value: 0 },
      uLock: { value: 0 },
      uShimmer: { value: 1 },
      uEntry: { value: 0 },
      uPerfect: { value: 0 },
      uDanger: { value: 0 },
      uVisited: { value: 0 },
      uFlash: { value: 0 },
      uDir: { value: 1 },
      uDashes: { value: 40 },
    };
    const tu = { uColor: { value: new Color() }, uSize: { value: new Vector2(1, 0.2) }, uTime: { value: 0 } };
    const additive = { blending: AdditiveBlending, transparent: true, depthTest: false, depthWrite: false };
    const core = new Mesh(
      this.sphere,
      new ShaderMaterial({ uniforms: cu, vertexShader: CORE_VERT, fragmentShader: CORE_FRAG, depthTest: false }),
    );
    core.renderOrder = 20;
    const glow = new Mesh(
      this.quad,
      new ShaderMaterial({ uniforms: gu, vertexShader: QUAD_VERT, fragmentShader: GLOW_FRAG, defines: { FBM_OCT: 3 }, ...additive }),
    );
    glow.renderOrder = 21;
    const ring = new Mesh(
      this.quad,
      new ShaderMaterial({ uniforms: ru, vertexShader: QUAD_VERT, fragmentShader: RING_FRAG, ...additive }),
    );
    ring.renderOrder = 10;
    const track = new Mesh(
      this.quad,
      new ShaderMaterial({ uniforms: tu, vertexShader: QUAD_VERT, fragmentShader: TRACK_FRAG, ...additive }),
    );
    track.renderOrder = 9;
    const group = new Group();
    group.add(track, ring, core, glow);
    for (const m of [core, glow, ring, track]) m.frustumCulled = false;
    this.scene.add(group);
    return {
      id: -1,
      seen: 0,
      group,
      core,
      glow,
      ring,
      track,
      cu,
      gu,
      ru,
      tu,
      approach: 0,
      lock: 0,
      locked: false,
      shimmer: 1,
      pop: 0,
      heat: 0,
      flash: 0,
      perfect: 0,
      visited: 0,
    };
  }

  private updateHole(s: Star, f: StarFrame): void {
    let h = this.holeById.get(s.id);
    if (!h) {
      h = this.freeHoles.pop() ?? this.createHole();
      h.id = s.id;
      const zc = zoneColors(s.zone);
      h.u.uA.value.copy(zc.accent);
      h.u.uB.value.copy(zc.ring);
      h.u.uCore.value = s.core;
      h.u.uPull.value = s.pull;
      h.u.uSeed.value = (s.id * 5.13) % 30;
      const half = Math.max(s.pull, s.core * 4) * 1.08;
      h.u.uSize.value.set(half, half);
      h.mesh.scale.set(half * 2, half * 2, 1);
      h.u.uNear.value = 0;
      h.mesh.visible = true;
      this.holeById.set(s.id, h);
      this.holes.push(h);
    }
    h.seen = this.frameNo;
    h.mesh.position.set(s.pos.x, s.pos.y, 0);
    h.u.uTime.value = f.time;
    h.u.uNear.value = damp(h.u.uNear.value, 0, 3, f.dt);
  }

  private createHole(): HoleVis {
    const u = {
      uA: { value: new Color() },
      uB: { value: new Color() },
      uCore: { value: 0.6 },
      uPull: { value: 4 },
      uTime: { value: 0 },
      uNear: { value: 0 },
      uSeed: { value: 0 },
      uSize: { value: new Vector2(1, 1) },
    };
    const mat = new ShaderMaterial({
      uniforms: u,
      vertexShader: QUAD_VERT,
      fragmentShader: HOLE_FRAG,
      defines: { FBM_OCT: 4 },
      transparent: true,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new Mesh(this.quad, mat);
    mesh.renderOrder = 5;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return { id: -1, seen: 0, mesh, u };
  }

  private releaseHole(h: HoleVis): void {
    h.mesh.visible = false;
    if (this.holeById.get(h.id) === h) this.holeById.delete(h.id);
    this.freeHoles.push(h);
  }

  private updateShards(world: World, f: StarFrame): void {
    let n = 0;
    const t = f.time;
    const shards = world.shards;
    for (let i = 0; i < shards.length && n < SHARD_MAX; i++) {
      const sh = shards[i];
      if (!sh || sh.taken) continue;
      const bob = Math.sin(t * 2.4 + sh.id * 1.7) * 0.14;
      const d = this.dummy;
      d.position.set(sh.pos.x, sh.pos.y + bob, 0.3);
      d.rotation.set(0.5 + Math.sin(t * 0.7 + sh.id) * 0.4, t * 1.8 + sh.id, 0.3);
      d.scale.set(0.2, 0.32, 0.2);
      d.updateMatrix();
      this.shardMesh.setMatrixAt(n, d.matrix);
      const zc = zoneColors(sh.zone);
      this.tmpColor.copy(zc.accent).multiplyScalar(1.3);
      this.shardMesh.setColorAt(n, this.tmpColor);
      this.glintPos[n * 3] = sh.pos.x;
      this.glintPos[n * 3 + 1] = sh.pos.y + bob;
      this.glintPos[n * 3 + 2] = 0.35;
      this.glintSeed[n] = (sh.id * 0.618) % 1;
      this.glintCol[n * 3] = zc.accent.r;
      this.glintCol[n * 3 + 1] = zc.accent.g;
      this.glintCol[n * 3 + 2] = zc.accent.b;
      n++;
    }
    this.shardMesh.count = n;
    this.shardMesh.instanceMatrix.clearUpdateRanges();
    this.shardMesh.instanceMatrix.addUpdateRange(0, Math.max(1, n) * 16);
    this.shardMesh.instanceMatrix.needsUpdate = true;
    const ic = this.shardMesh.instanceColor;
    if (ic) {
      ic.clearUpdateRanges();
      ic.addUpdateRange(0, Math.max(1, n) * 3);
      ic.needsUpdate = true;
    }
    this.shardU.uTime.value = t;
    this.glintU.uTime.value = t;
    this.glintU.uScale.value = f.scale;
    this.glintGeo.setDrawRange(0, n);
    for (let i = 0; i < this.glintAttrs.length; i++) {
      const attr = this.glintAttrs[i];
      if (!attr) continue;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, Math.max(1, n) * attr.itemSize);
      attr.needsUpdate = true;
    }
  }

  dispose(): void {
    const mats = new Set<ShaderMaterial>();
    const collect = (m: Mesh): void => {
      if (m.material instanceof ShaderMaterial) mats.add(m.material);
    };
    for (const v of [...this.active, ...this.free]) {
      collect(v.core);
      collect(v.glow);
      collect(v.ring);
      collect(v.track);
    }
    for (const h of [...this.holes, ...this.freeHoles]) collect(h.mesh);
    for (const m of mats) m.dispose();
    this.sphere.dispose();
    this.quad.dispose();
    this.shardGeo.dispose();
    this.shardMat.dispose();
    this.shardMesh.dispose();
    this.glintGeo.dispose();
    this.glintMat.dispose();
  }
}
