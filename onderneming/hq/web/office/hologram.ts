/**
 * De kennisgraaf als hologram boven de sokkel in de kennisbank: gloeiende knopen en lijnen die
 * langzaam draaien. Zoekt een agent iets op, dan lichten de knopen op die over zijn vraag gaan.
 */
import * as THREE from "three";
import type { KnowledgeGraph } from "../../src/office/types.js";

const HOLO = ["#38d9ff", "#7c9cff", "#b38cff", "#ff7ad9", "#5ef0b6", "#ffd166", "#6ee7ff", "#a3e635"];

export interface LaidOutGraph {
  positions: Float32Array;
  groups: number[];
}

/** Krachtgestuurde indeling in 3D (klein en snel genoeg voor een paar honderd knopen). */
export function layoutGraph(graph: KnowledgeGraph, iterations = 90): LaidOutGraph {
  const n = graph.nodes.length;
  const index = new Map(graph.nodes.map((node, k) => [node.id, k]));
  const groupIds = new Map<string, number>();
  const groups = graph.nodes.map((node) => {
    const key = node.group ?? node.kind;
    if (!groupIds.has(key)) groupIds.set(key, groupIds.size);
    return groupIds.get(key)!;
  });
  const gCount = Math.max(groupIds.size, 1);
  const pos = new Float32Array(n * 3);
  // Begin: elke groep rond een eigen punt op een bol (Fibonacci), zodat clusters snel ontstaan.
  const centers: THREE.Vector3[] = [];
  for (let g = 0; g < gCount; g++) {
    const y = 1 - (2 * (g + 0.5)) / gCount;
    const r = Math.sqrt(1 - y * y);
    const phi = g * Math.PI * (3 - Math.sqrt(5));
    centers.push(new THREE.Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r).multiplyScalar(0.8));
  }
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let k = 0; k < n; k++) {
    const c = centers[groups[k]!]!;
    pos[k * 3] = c.x + rnd() * 0.3;
    pos[k * 3 + 1] = c.y + rnd() * 0.3;
    pos[k * 3 + 2] = c.z + rnd() * 0.3;
  }
  const edges = graph.edges
    .map((e) => [index.get(e.source), index.get(e.target)] as const)
    .filter((e): e is readonly [number, number] => e[0] !== undefined && e[1] !== undefined);
  const disp = new Float32Array(n * 3);
  const k2 = 0.18;
  for (let it = 0; it < iterations; it++) {
    disp.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i * 3]! - pos[j * 3]!;
        const dy = pos[i * 3 + 1]! - pos[j * 3 + 1]!;
        const dz = pos[i * 3 + 2]! - pos[j * 3 + 2]!;
        const d2 = dx * dx + dy * dy + dz * dz + 0.0004;
        const f = (k2 * k2) / d2 / 4;
        disp[i * 3] = disp[i * 3]! + dx * f;
        disp[i * 3 + 1] = disp[i * 3 + 1]! + dy * f;
        disp[i * 3 + 2] = disp[i * 3 + 2]! + dz * f;
        disp[j * 3] = disp[j * 3]! - dx * f;
        disp[j * 3 + 1] = disp[j * 3 + 1]! - dy * f;
        disp[j * 3 + 2] = disp[j * 3 + 2]! - dz * f;
      }
    }
    for (const [a, b] of edges) {
      const dx = pos[a * 3]! - pos[b * 3]!;
      const dy = pos[a * 3 + 1]! - pos[b * 3 + 1]!;
      const dz = pos[a * 3 + 2]! - pos[b * 3 + 2]!;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-4;
      const f = (d / k2) * 0.02;
      disp[a * 3] = disp[a * 3]! - (dx / d) * f;
      disp[a * 3 + 1] = disp[a * 3 + 1]! - (dy / d) * f;
      disp[a * 3 + 2] = disp[a * 3 + 2]! - (dz / d) * f;
      disp[b * 3] = disp[b * 3]! + (dx / d) * f;
      disp[b * 3 + 1] = disp[b * 3 + 1]! + (dy / d) * f;
      disp[b * 3 + 2] = disp[b * 3 + 2]! + (dz / d) * f;
    }
    const temp = 0.06 * (1 - it / iterations) + 0.004;
    for (let i = 0; i < n; i++) {
      const dx = disp[i * 3]!;
      const dy = disp[i * 3 + 1]!;
      const dz = disp[i * 3 + 2]!;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
      const m = Math.min(len, temp) / len;
      pos[i * 3] = pos[i * 3]! + dx * m;
      pos[i * 3 + 1] = pos[i * 3 + 1]! + dy * m;
      pos[i * 3 + 2] = pos[i * 3 + 2]! + dz * m;
      // Zachte trek naar het midden, zodat losse knopen niet wegdrijven.
      pos[i * 3] = pos[i * 3]! * 0.995;
      pos[i * 3 + 1] = pos[i * 3 + 1]! * 0.995;
      pos[i * 3 + 2] = pos[i * 3 + 2]! * 0.995;
    }
  }
  // Schaal naar een bol met straal 1.
  let max = 0.001;
  for (let i = 0; i < n; i++) max = Math.max(max, Math.hypot(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!));
  for (let i = 0; i < n * 3; i++) pos[i] = pos[i]! / max;
  return { positions: pos, groups };
}

const vertex = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  varying vec3 vColor;
  uniform float scale;
  void main() {
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = size * scale;
  }
`;
const fragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor * (0.6 + core), core);
  }
`;

export class Hologram {
  readonly group = new THREE.Group();
  private readonly spin = new THREE.Group();
  private points: THREE.Points | null = null;
  private lines: THREE.LineSegments | null = null;
  private nodes: KnowledgeGraph["nodes"] = [];
  private baseSizes = new Float32Array(0);
  private baseColors = new Float32Array(0);
  private glow = new Map<number, number>();
  private readonly material: THREE.ShaderMaterial;
  radius = 1.15;
  stats = { nodes: 0, edges: 0, source: "hq" as "hq" | "graphify" };

  constructor(anchor: THREE.Vector3) {
    this.group.position.copy(anchor);
    this.group.add(this.spin);
    this.material = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 1 } },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    // Lichtbundel van de sokkel omhoog.
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 0.8, 1.7, 40, 1, true),
      new THREE.MeshBasicMaterial({ color: "#38d9ff", transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    beam.position.y = -0.7;
    this.group.add(beam);
  }

  setGraph(graph: KnowledgeGraph): void {
    this.stats = { nodes: graph.totalNodes, edges: graph.totalEdges, source: graph.source };
    if (this.points) this.spin.remove(this.points);
    if (this.lines) this.spin.remove(this.lines);
    this.nodes = graph.nodes;
    const n = graph.nodes.length;
    if (!n) return;
    const laid = layoutGraph(graph);
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) positions[i] = laid.positions[i]! * this.radius;
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const maxDeg = Math.max(1, ...graph.nodes.map((x) => x.degree));
    graph.nodes.forEach((node, k) => {
      const c = new THREE.Color(HOLO[laid.groups[k]! % HOLO.length]!);
      colors.set([c.r, c.g, c.b], k * 3);
      sizes[k] = 5 + 11 * Math.sqrt(node.degree / maxDeg);
    });
    this.baseSizes = sizes.slice();
    this.baseColors = colors.slice();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    this.points = new THREE.Points(geo, this.material);
    this.spin.add(this.points);

    const index = new Map(graph.nodes.map((node, k) => [node.id, k]));
    const seg: number[] = [];
    const segColors: number[] = [];
    for (const e of graph.edges) {
      const a = index.get(e.source);
      const b = index.get(e.target);
      if (a === undefined || b === undefined) continue;
      seg.push(positions[a * 3]!, positions[a * 3 + 1]!, positions[a * 3 + 2]!, positions[b * 3]!, positions[b * 3 + 1]!, positions[b * 3 + 2]!);
      segColors.push(colors[a * 3]!, colors[a * 3 + 1]!, colors[a * 3 + 2]!, colors[b * 3]!, colors[b * 3 + 1]!, colors[b * 3 + 2]!);
    }
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3));
    lgeo.setAttribute("color", new THREE.Float32BufferAttribute(segColors, 3));
    this.lines = new THREE.LineSegments(
      lgeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.spin.add(this.lines);
  }

  /** Laat de knopen oplichten die over een vraag gaan. Geeft het aantal treffers. */
  highlight(text: string, seconds = 6): number {
    const terms = text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3);
    let hits = 0;
    this.nodes.forEach((node, k) => {
      const label = node.label.toLowerCase();
      if (terms.some((t) => label.includes(t))) {
        this.glow.set(k, seconds);
        hits += 1;
      }
    });
    if (!hits && this.nodes.length) {
      // Niets gevonden: laat een paar willekeurige knopen flikkeren ("zoeken").
      for (let k = 0; k < 4; k++) this.glow.set(Math.floor(Math.random() * this.nodes.length), seconds / 2);
    }
    return hits;
  }

  update(dt: number, t: number, zoom: number): void {
    this.spin.rotation.y += dt * 0.18;
    this.spin.position.y = Math.sin(t * 0.8) * 0.05;
    this.material.uniforms.scale!.value = Math.max(0.6, zoom) * (window.devicePixelRatio > 1 ? 1.4 : 1);
    if (!this.points || !this.glow.size) return;
    const sizes = this.points.geometry.getAttribute("size") as THREE.BufferAttribute;
    const colors = this.points.geometry.getAttribute("color") as THREE.BufferAttribute;
    for (const [k, left] of [...this.glow]) {
      const next = left - dt;
      if (next <= 0) {
        this.glow.delete(k);
        sizes.setX(k, this.baseSizes[k]!);
        colors.setXYZ(k, this.baseColors[k * 3]!, this.baseColors[k * 3 + 1]!, this.baseColors[k * 3 + 2]!);
      } else {
        this.glow.set(k, next);
        const pulse = 1 + 0.6 * (0.5 + 0.5 * Math.sin(t * 9 + k));
        sizes.setX(k, this.baseSizes[k]! * 1.8 * pulse);
        colors.setXYZ(k, 1, 0.95, 0.6);
      }
    }
    sizes.needsUpdate = true;
    colors.needsUpdate = true;
  }
}
