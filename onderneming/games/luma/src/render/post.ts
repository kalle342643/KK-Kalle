// Nabewerking: bloom en een laatste pass met chromatische aberratie, vignet, filmkorrel, flits en golf.
import {
  Color,
  HalfFloatType,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

/** Sterkte van de bloom (de pass vermenigvuldigt intern nog met 3 en telt vijf mips op). */
const BLOOM = 0.28;

/** Bloom die op een lagere resolutie kan draaien. */
class ScaledBloomPass extends UnrealBloomPass {
  scale = 1;
  override setSize(width: number, height: number): void {
    super.setSize(Math.max(2, Math.round(width * this.scale)), Math.max(2, Math.round(height * this.scale)));
  }
}

const FINAL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FINAL_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform float uTime;
uniform float uCA;
uniform float uGrain;
uniform float uDesat;
uniform float uWave;
uniform vec3 uWaveColor;
uniform vec3 uFlash;
uniform float uExposure;
varying vec2 vUv;
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec2 c = vUv - 0.5;
  float aspect = uRes.x / uRes.y;
  vec2 ca = c * dot(c, c) * uCA;
  vec3 col;
  col.r = texture2D(tDiffuse, vUv - ca).r;
  col.g = texture2D(tDiffuse, vUv - ca * 0.3).g;
  col.b = texture2D(tDiffuse, vUv + ca).b;

  // Kleurgolf bij een nieuwe zone.
  vec2 q = vec2(c.x * aspect, c.y);
  float rq = length(q);
  if (uWave > 0.0 && uWave < 1.0) {
    float front = uWave * 1.6;
    float band = exp(-pow((rq - front) / 0.11, 2.0));
    float behind = smoothstep(front, front - 0.6, rq) * (1.0 - uWave);
    col += uWaveColor * (band * 1.4 + behind * 0.25) * (1.0 - uWave);
  }
  col += uFlash;

  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(l) * vec3(0.92, 0.96, 1.08), uDesat);

  // Vignet.
  vec2 v = c * vec2(aspect > 1.0 ? 1.0 : 1.25, aspect > 1.0 ? 1.25 : 1.0);
  float vig = smoothstep(0.95, 0.2, length(v));
  col *= mix(0.35, 1.0, vig);
  col *= uExposure;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // Filmkorrel na de tonemapping, het sterkst in de midtonen.
  float g = hash(gl_FragCoord.xy + fract(uTime * 7.31) * 517.0) - 0.5;
  float m = 1.0 - abs(dot(gl_FragColor.rgb, vec3(0.333)) - 0.4) * 1.4;
  gl_FragColor.rgb += g * uGrain * max(m, 0.25);
}
`;

export class Post {
  readonly composer: EffectComposer;
  private readonly bloom: ScaledBloomPass;
  private readonly final: ShaderPass;
  readonly u = {
    tDiffuse: { value: null },
    uRes: { value: new Vector2(1, 1) },
    uTime: { value: 0 },
    uCA: { value: 0.018 },
    uGrain: { value: 0.045 },
    uDesat: { value: 0 },
    uWave: { value: 0 },
    uWaveColor: { value: new Color() },
    uFlash: { value: new Color(0, 0, 0) },
    uExposure: { value: 1 },
  };
  private readonly renderer: WebGLRenderer;
  private low = false;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera, low: boolean) {
    this.renderer = renderer;
    this.low = low;
    this.composer = new EffectComposer(renderer, this.makeTarget(low));
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new ScaledBloomPass(new Vector2(256, 256), BLOOM, 0, 0.85);
    this.composer.addPass(this.bloom);
    // Strakkere bloom: de brede mips wegen minder mee.
    const factors = this.bloom.compositeMaterial.uniforms["bloomFactors"];
    if (factors) factors.value = [1.0, 0.7, 0.45, 0.25, 0.12];
    const mat = new ShaderMaterial({
      uniforms: this.u,
      vertexShader: FINAL_VERT,
      fragmentShader: FINAL_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.final = new ShaderPass(mat);
    this.composer.addPass(this.final);
    this.applyQuality();
  }

  private makeTarget(low: boolean): WebGLRenderTarget {
    const size = new Vector2();
    this.renderer.getDrawingBufferSize(size);
    return new WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: HalfFloatType,
      samples: low ? 0 : 4,
    });
  }

  setQuality(low: boolean): void {
    if (low === this.low) return;
    this.low = low;
    this.composer.reset(this.makeTarget(low));
    this.applyQuality();
  }

  private applyQuality(): void {
    this.bloom.scale = this.low ? 0.5 : 1;
    this.u.uGrain.value = this.low ? 0 : 0.045;
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.u.uRes.value.set(width * pixelRatio, height * pixelRatio);
  }

  /** Bloomsterkte (bijv. zachter bij reducedMotion-flitsen). */
  setBloomStrength(s: number): void {
    this.bloom.strength = s;
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.bloom.dispose();
    this.final.dispose();
    this.composer.dispose();
  }
}
