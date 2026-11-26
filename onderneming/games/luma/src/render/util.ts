// Kleine hulpjes voor de renderer: kleuren per zone, dempen, gedeelde GLSL.
import { Color } from "three";
import { ZONES, zoneTheme } from "../theme";

/** Zonekleuren, al omgezet naar lineaire kleur (klaar voor shaders). */
export interface ZoneColors {
  void: Color;
  nebulaA: Color;
  nebulaB: Color;
  star: Color;
  ring: Color;
  accent: Color;
  trail: Color;
}

const zoneCache: ZoneColors[] = [];

/** Lineaire kleuren van een zone (gecached, nooit nieuwe objecten per frame). */
export function zoneColors(zone: number): ZoneColors {
  const n = ZONES.length;
  const i = ((zone % n) + n) % n;
  let zc = zoneCache[i];
  if (!zc) {
    const c = zoneTheme(i).colors;
    zc = {
      void: new Color().setHex(c.void),
      nebulaA: new Color().setHex(c.nebulaA),
      nebulaB: new Color().setHex(c.nebulaB),
      star: new Color().setHex(c.star),
      ring: new Color().setHex(c.ring),
      accent: new Color().setHex(c.accent),
      trail: new Color().setHex(c.trail),
    };
    zoneCache[i] = zc;
  }
  return zc;
}

/** Framerate-onafhankelijk naar een doel toe bewegen. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Ruis en fbm voor shaders. FBM_OCT moet als define gezet zijn. */
export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < FBM_OCT; i++) {
    v += a * vnoise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}
`;

/** 3D-ruis voor het oppervlak van sterren. */
export const NOISE3_GLSL = /* glsl */ `
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z);
}
`;

/** Een vlak (1x1) met de positie in wereldeenheden als varying vP (via uniform uSize = halve breedte). */
export const QUAD_VERT = /* glsl */ `
uniform vec2 uSize;
varying vec2 vP;
void main() {
  vP = position.xy * uSize * 2.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
