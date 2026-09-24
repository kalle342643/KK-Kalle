/**
 * 3D-modellen laden: poppetjes en meubels van Kenney (CC0, zie web/assets/CREDITS.md).
 * Elk meubel wordt genormaliseerd: midden van de voetafdruk op (0, 0), onderkant op de vloer.
 */
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

/** 1 rastercel = 1 eenheid; Kenney-modellen zijn kleiner, dus alles gaat maal deze factor. */
export const MODEL_SCALE = 1.6;

export const CHARACTERS = [
  "male-a",
  "male-b",
  "male-c",
  "male-d",
  "male-e",
  "male-f",
  "female-a",
  "female-b",
  "female-c",
  "female-d",
  "female-e",
  "female-f",
] as const;

/** Standaard-uiterlijk voor vaste rollen (jij kiest zelf iets anders in het kantoor). */
export const DEFAULT_LOOK = { ceo: 3, analyst: 10, bot: 2, owner: 0 } as const;

export const FURNITURE = [
  "desk",
  "deskCorner",
  "chairDesk",
  "computerScreen",
  "computerKeyboard",
  "computerMouse",
  "laptop",
  "lampSquareTable",
  "lampRoundTable",
  "lampSquareFloor",
  "lampRoundFloor",
  "bookcaseOpen",
  "bookcaseClosedWide",
  "bookcaseOpenLow",
  "bookcaseClosed",
  "books",
  "plantSmall1",
  "plantSmall2",
  "plantSmall3",
  "pottedPlant",
  "trashcan",
  "coatRackStanding",
  "cardboardBoxClosed",
  "cardboardBoxOpen",
  "rugRectangle",
  "rugRound",
  "rugRounded",
  "rugSquare",
  "rugDoormat",
  "loungeSofa",
  "loungeSofaLong",
  "loungeChair",
  "loungeDesignChair",
  "loungeChairRelax",
  "tableCoffee",
  "tableCoffeeGlass",
  "kitchenCoffeeMachine",
  "kitchenFridgeLarge",
  "kitchenCabinet",
  "kitchenCabinetUpper",
  "kitchenSink",
  "kitchenMicrowave",
  "kitchenBar",
  "stoolBar",
  "tableRound",
  "chair",
  "chairCushion",
  "chairModernCushion",
  "chairRounded",
  "table",
  "tableCross",
  "televisionModern",
  "speaker",
  "speakerSmall",
  "benchCushion",
  "bench",
  "sideTable",
  "sideTableDrawers",
  "radio",
  "cabinetTelevision",
  "lampWall",
  "toaster",
  "kitchenBlender",
  "pillowBlue",
] as const;

export type FurnitureName = (typeof FURNITURE)[number];

interface CharacterAsset {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

/** Voor de losse demo (één HTML-bestand): modellen als base64 in de pagina. */
declare global {
  interface Window {
    HQ_ASSET_DATA?: Record<string, string>;
  }
}

function dataUrl(path: string): string | null {
  const b64 = window.HQ_ASSET_DATA?.[path];
  if (!b64) return null;
  return `data:${path.endsWith(".png") ? "image/png" : "model/gltf-binary"};base64,${b64}`;
}

function decodeBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  return bytes.buffer;
}

export class Assets {
  private readonly furniture = new Map<string, THREE.Object3D>();
  private readonly sizes = new Map<string, THREE.Vector3>();
  private readonly characters: CharacterAsset[] = [];
  private readonly loader: GLTFLoader;

  constructor(private readonly base: string) {
    if (window.HQ_ASSET_DATA) {
      // Losse demo-pagina: die mag vaak geen fetch() doen van blob:/data:-adressen (Content-Security-Policy),
      // een <img> wel. Zonder createImageBitmap laadt three.js texturen via <img>.
      (window as { createImageBitmap?: unknown }).createImageBitmap = undefined;
    }
    const manager = new THREE.LoadingManager();
    // In de losse demo verwijzen texturen naar ingebakken data in plaats van naar de server.
    manager.setURLModifier((url) => {
      const rel = url.replace(/^.*?assets\//, "");
      return dataUrl(rel) ?? url;
    });
    this.loader = new GLTFLoader(manager);
  }

  private async gltf(rel: string): Promise<GLTF> {
    const inline = window.HQ_ASSET_DATA?.[rel];
    const resourcePath = `${this.base}${rel.slice(0, rel.lastIndexOf("/") + 1)}`;
    if (inline) {
      const buffer = decodeBase64(inline);
      return new Promise((resolve, reject) => this.loader.parse(buffer, resourcePath, resolve, reject));
    }
    return this.loader.loadAsync(`${this.base}${rel}`);
  }

  async load(onProgress?: (done: number, total: number) => void): Promise<void> {
    // De modellen van HQ zijn met meshopt gecomprimeerd; de losse demo heeft ze ongecomprimeerd bij zich,
    // omdat WebAssembly (de uitpakker) daar niet mag. Dus pas laden als het nodig is.
    if (!window.HQ_ASSET_DATA) {
      const { MeshoptDecoder } = await import("three/examples/jsm/libs/meshopt_decoder.module.js");
      this.loader.setMeshoptDecoder(MeshoptDecoder);
    }
    const total = FURNITURE.length + CHARACTERS.length;
    let done = 0;
    const tick = () => onProgress?.(++done, total);
    const furniture = FURNITURE.map(async (name) => {
      try {
        const g = await this.gltf(`furniture/${name}.glb`);
        this.furniture.set(name, this.normalize(g.scene));
      } catch (err) {
        console.warn("meubel ontbreekt", name, err);
      }
      tick();
    });
    const characters = CHARACTERS.map(async (name, k) => {
      const g = await this.gltf(`characters/character-${name}.glb`);
      g.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = false;
          const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (m) {
            m.roughness = 0.85;
            m.metalness = 0;
          }
        }
      });
      g.scene.scale.setScalar(MODEL_SCALE);
      this.characters[k] = { scene: g.scene, clips: g.animations };
      tick();
    });
    await Promise.all([...furniture, ...characters]);
  }

  private normalize(scene: THREE.Object3D): THREE.Object3D {
    scene.scale.setScalar(MODEL_SCALE);
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const center = box.getCenter(new THREE.Vector3());
    scene.position.set(-center.x, -box.min.y, -center.z);
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (m && "roughness" in m) {
          m.roughness = Math.max(m.roughness ?? 0.8, 0.75);
          m.metalness = Math.min(m.metalness ?? 0, 0.15);
        }
      }
    });
    const wrapper = new THREE.Group();
    wrapper.add(scene);
    const size = box.getSize(new THREE.Vector3());
    wrapper.userData.size = size;
    return wrapper;
  }

  has(name: FurnitureName): boolean {
    return this.furniture.has(name);
  }

  /** Een kopie van een meubel (geometrie en materialen worden gedeeld). */
  make(name: FurnitureName): THREE.Object3D {
    const template = this.furniture.get(name);
    if (!template) return new THREE.Group();
    const copy = template.clone(true);
    copy.userData.size = template.userData.size;
    return copy;
  }

  /** Afmetingen (breedte x, hoogte y, diepte z) na schaal. */
  size(name: FurnitureName): THREE.Vector3 {
    return (this.furniture.get(name)?.userData.size as THREE.Vector3 | undefined) ?? new THREE.Vector3(1, 1, 1);
  }

  /** Een nieuw poppetje met eigen skelet (voor eigen animaties). */
  character(index: number): { root: THREE.Object3D; clips: THREE.AnimationClip[] } {
    const asset = this.characters[((index % CHARACTERS.length) + CHARACTERS.length) % CHARACTERS.length]!;
    const root = cloneSkinned(asset.scene);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.material) {
        // Eigen materiaal per poppetje: dan kunnen we er één laten oplichten of vervagen.
        mesh.material = (mesh.material as THREE.Material).clone();
      }
    });
    return { root, clips: asset.clips };
  }
}

/** Voorspelbaar standaard-uiterlijk voor een agent zonder gekozen poppetje. */
export function defaultLook(id: string, hqRole: string | null): number {
  if (hqRole === "ceo") return DEFAULT_LOOK.ceo;
  if (hqRole === "analyst") return DEFAULT_LOOK.analyst;
  if (id === "hq-bot") return DEFAULT_LOOK.bot;
  if (id === "owner") return DEFAULT_LOOK.owner;
  let h = 2166136261;
  for (let k = 0; k < id.length; k++) h = Math.imul(h ^ id.charCodeAt(k), 16777619);
  return (h >>> 0) % CHARACTERS.length;
}
