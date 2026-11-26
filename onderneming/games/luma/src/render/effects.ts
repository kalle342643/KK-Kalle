// Schokgolven: uitdijende ringen bij een vangst of een nieuwe zone. Vaste pool.
import { AdditiveBlending, Color, Mesh, PlaneGeometry, ShaderMaterial, Vector2, type Scene } from "three";
import { QUAD_VERT } from "./util";

const WAVE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uR;
uniform float uW;
uniform float uI;
varying vec2 vP;
void main() {
  float r = length(vP);
  float d = (r - uR) / uW;
  float band = exp(-d * d);
  float crisp = exp(-d * d * 18.0);
  float inner = smoothstep(uR, 0.0, r) * 0.06;
  vec3 col = uColor * (band * 0.8 + crisp * 1.4 + inner) * uI;
  gl_FragColor = vec4(col, 1.0);
}
`;

interface Wave {
  mesh: Mesh;
  u: {
    uColor: { value: Color };
    uR: { value: number };
    uW: { value: number };
    uI: { value: number };
    uSize: { value: Vector2 };
  };
  t: number;
  life: number;
  r0: number;
  r1: number;
  width: number;
  intensity: number;
  x: number;
  y: number;
}

const POOL = 14;

export class Effects {
  private readonly waves: Wave[] = [];
  private readonly quad = new PlaneGeometry(1, 1);
  private next = 0;

  constructor(scene: Scene) {
    for (let i = 0; i < POOL; i++) {
      const u = {
        uColor: { value: new Color() },
        uR: { value: 0 },
        uW: { value: 0.2 },
        uI: { value: 0 },
        uSize: { value: new Vector2(1, 1) },
      };
      const mat = new ShaderMaterial({
        uniforms: u,
        vertexShader: QUAD_VERT,
        fragmentShader: WAVE_FRAG,
        blending: AdditiveBlending,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const mesh = new Mesh(this.quad, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 45;
      scene.add(mesh);
      this.waves.push({ mesh, u, t: 1, life: 1, r0: 0, r1: 1, width: 0.2, intensity: 1, x: 0, y: 0 });
    }
  }

  /** Nieuwe schokgolf vanaf (x, y). */
  wave(x: number, y: number, r0: number, r1: number, life: number, width: number, color: Color, intensity: number): void {
    const w = this.waves[this.next];
    this.next = (this.next + 1) % POOL;
    if (!w) return;
    w.t = 0;
    w.life = life;
    w.r0 = r0;
    w.r1 = r1;
    w.width = width;
    w.intensity = intensity;
    w.x = x;
    w.y = y;
    w.u.uColor.value.copy(color);
    const half = r1 + width * 3;
    w.mesh.scale.set(half * 2, half * 2, 1);
    w.u.uSize.value.set(half, half);
    w.mesh.position.set(x, y, 0.02);
    w.mesh.visible = true;
  }

  update(dt: number): void {
    for (let i = 0; i < this.waves.length; i++) {
      const w = this.waves[i];
      if (!w || !w.mesh.visible) continue;
      w.t += dt / w.life;
      if (w.t >= 1) {
        w.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - w.t, 3);
      w.u.uR.value = w.r0 + (w.r1 - w.r0) * e;
      w.u.uW.value = w.width * (0.6 + 0.8 * w.t);
      const fade = 1 - w.t;
      w.u.uI.value = w.intensity * fade * fade;
    }
  }

  clear(): void {
    for (const w of this.waves) w.mesh.visible = false;
  }

  dispose(): void {
    for (const w of this.waves) {
      if (w.mesh.material instanceof ShaderMaterial) w.mesh.material.dispose();
    }
    this.quad.dispose();
  }
}
