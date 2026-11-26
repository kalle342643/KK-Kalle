// Achtergrond: een nevel over het hele scherm en drie lagen sterren die met parallax meebewegen.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Vector2,
  Vector3,
  type PerspectiveCamera,
  type Scene,
} from "three";
import { NOISE_GLSL, type ZoneColors } from "./util";

const NEBULA_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const NEBULA_FRAG = /* glsl */ `
uniform vec2 uRes;
uniform vec2 uCam;
uniform float uTime;
uniform vec3 uVoid;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uAccent;
uniform float uPulse;
${NOISE_GLSL}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  // Nevel ligt ver weg: kleine parallax met de camera.
  vec2 p = uv * 2.1 + uCam * 0.022;
  float t = uTime * 0.018;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 2.8 * q + vec2(1.7, 9.2) + t * 1.4), fbm(p + 2.8 * q + vec2(8.3, 2.8) - t));
  float f = fbm(p + 2.2 * r);
  vec3 col = uVoid;
  col = mix(col, uA * 1.25, smoothstep(0.35, 1.0, f));
  col = mix(col, uB * 1.35, smoothstep(0.5, 1.2, length(q) + r.y * 0.35) * 0.8);
  // Donkere stofbanen.
  float dust = smoothstep(0.32, 0.72, fbm(p * 1.7 + r * 1.3 + 4.0));
  col *= 0.42 + 0.58 * dust;
  // Lichte slierten.
  float wisp = pow(clamp(f * 1.12, 0.0, 1.0), 5.0);
  col += mix(uA, uB, clamp(q.x * 1.3, 0.0, 1.0)) * wisp * 1.6;
  col += uAccent * wisp * uPulse * 1.5;
  // Iets lichter boven in beeld: het licht komt van voren.
  col *= 0.8 + 0.35 * smoothstep(-0.6, 0.7, uv.y);
  gl_FragColor = vec4(max(col, uVoid), 1.0);
}
`;

const STAR_VERT = /* glsl */ `
uniform vec3 uCenter;
uniform float uTile;
uniform float uTime;
uniform float uScale;
uniform float uSize;
attribute vec4 aInfo;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 off = mod(position.xy - uCenter.xy + 0.5 * uTile, uTile) - 0.5 * uTile;
  vec3 wp = vec3(uCenter.xy + off, position.z);
  vec4 mv = modelViewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  float edge = 1.0 - smoothstep(0.36, 0.5, max(abs(off.x), abs(off.y)) / uTile);
  float tw = 0.55 + 0.45 * sin(uTime * aInfo.y + aInfo.x);
  tw = mix(1.0, tw * tw, 0.8);
  vAlpha = edge * tw;
  // Kleur: wit, koel blauw of warm.
  vec3 cool = vec3(0.62, 0.78, 1.0);
  vec3 warm = vec3(1.0, 0.78, 0.55);
  vColor = aInfo.w < 0.33 ? cool : (aInfo.w > 0.85 ? warm : vec3(1.0));
  vColor *= 0.5 + aInfo.z * 1.6;
  gl_PointSize = max(1.0, uSize * (0.6 + aInfo.z) * uScale / -mv.z);
}
`;

const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = exp(-d * d * 6.0) + exp(-d * d * 60.0);
  a *= 1.0 - smoothstep(0.8, 1.0, d);
  gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
}
`;

interface Layer {
  points: Points;
  geometry: BufferGeometry;
  material: ShaderMaterial;
  depth: number;
  count: number;
  u: {
    uCenter: { value: Vector3 };
    uTile: { value: number };
    uTime: { value: number };
    uScale: { value: number };
    uSize: { value: number };
  };
}

// Diepte onder het speelvlak, grootte van een tegel, aantal, puntgrootte (wereldeenheden).
const LAYERS: readonly { depth: number; count: number; size: number }[] = [
  { depth: 14, count: 260, size: 0.42 },
  { depth: 42, count: 700, size: 0.6 },
  { depth: 110, count: 1700, size: 1.05 },
];

export class Background {
  private readonly nebula: Mesh;
  private readonly nebulaMat: ShaderMaterial;
  private readonly quad: PlaneGeometry;
  private readonly layers: Layer[] = [];
  private readonly nu = {
    uRes: { value: new Vector2(1, 1) },
    uCam: { value: new Vector2() },
    uTime: { value: 0 },
    uVoid: { value: new Color() },
    uA: { value: new Color() },
    uB: { value: new Color() },
    uAccent: { value: new Color() },
    uPulse: { value: 0 },
  };
  private readonly dir = new Vector3();

  constructor(scene: Scene) {
    this.quad = new PlaneGeometry(2, 2);
    this.nebulaMat = new ShaderMaterial({
      uniforms: this.nu,
      vertexShader: NEBULA_VERT,
      fragmentShader: NEBULA_FRAG,
      defines: { FBM_OCT: 5 },
      depthTest: false,
      depthWrite: false,
    });
    this.nebula = new Mesh(this.quad, this.nebulaMat);
    this.nebula.frustumCulled = false;
    this.nebula.renderOrder = -100;
    scene.add(this.nebula);

    for (const def of LAYERS) {
      const tile = 2.3 * (def.depth + 34);
      const pos = new Float32Array(def.count * 3);
      const info = new Float32Array(def.count * 4);
      for (let i = 0; i < def.count; i++) {
        pos[i * 3] = Math.random() * tile;
        pos[i * 3 + 1] = Math.random() * tile;
        pos[i * 3 + 2] = -def.depth - Math.random() * def.depth * 0.3;
        info[i * 4] = Math.random() * 6.283;
        info[i * 4 + 1] = 0.6 + Math.random() * 2.6;
        // Meeste sterren klein, een paar fel.
        info[i * 4 + 2] = Math.pow(Math.random(), 3.2);
        info[i * 4 + 3] = Math.random();
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(pos, 3));
      geometry.setAttribute("aInfo", new BufferAttribute(info, 4));
      const u = {
        uCenter: { value: new Vector3() },
        uTile: { value: tile },
        uTime: { value: 0 },
        uScale: { value: 400 },
        uSize: { value: def.size },
      };
      const material = new ShaderMaterial({
        uniforms: u,
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        blending: AdditiveBlending,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const points = new Points(geometry, material);
      points.frustumCulled = false;
      points.renderOrder = -90;
      scene.add(points);
      this.layers.push({ points, geometry, material, depth: def.depth, count: def.count, u });
    }
  }

  setQuality(low: boolean): void {
    this.nebulaMat.defines = { FBM_OCT: low ? 3 : 5 };
    this.nebulaMat.needsUpdate = true;
    for (const l of this.layers) l.geometry.setDrawRange(0, low ? Math.floor(l.count * 0.55) : l.count);
  }

  setResolution(w: number, h: number): void {
    this.nu.uRes.value.set(w, h);
  }

  /** Kleuren van de huidige (overvloeiende) zone. */
  setColors(c: ZoneColors, pulse: number): void {
    this.nu.uVoid.value.copy(c.void);
    this.nu.uA.value.copy(c.nebulaA);
    this.nu.uB.value.copy(c.nebulaB);
    this.nu.uAccent.value.copy(c.accent);
    this.nu.uPulse.value = pulse;
  }

  update(camera: PerspectiveCamera, time: number, scale: number): void {
    this.nu.uTime.value = time;
    this.nu.uCam.value.set(camera.position.x, camera.position.y);
    camera.getWorldDirection(this.dir);
    for (const l of this.layers) {
      // Midden van de tegel: waar de kijkrichting deze diepte raakt.
      const z = -l.depth;
      const k = this.dir.z < -1e-3 ? (z - camera.position.z) / this.dir.z : 0;
      l.u.uCenter.value.set(camera.position.x + this.dir.x * k, camera.position.y + this.dir.y * k, z);
      l.u.uTime.value = time;
      l.u.uScale.value = scale;
    }
  }

  dispose(): void {
    this.quad.dispose();
    this.nebulaMat.dispose();
    for (const l of this.layers) {
      l.geometry.dispose();
      l.material.dispose();
    }
  }
}
