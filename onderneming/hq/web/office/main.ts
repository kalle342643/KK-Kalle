/**
 * Het kantoor opstarten: gegevens ophalen (HQ of het demobedrijf), 3D-modellen laden, het gebouw
 * neerzetten, de poppetjes erin en de panelen eromheen. Daarna luistert het naar wat er gebeurt en
 * werkt het de borden, schermen en het hologram bij.
 */
import * as THREE from "three";
import type { OfficeSnapshot } from "../../src/office/types.js";
import { Assets, CHARACTERS } from "./assets.js";
import { drawCodeBoard, drawKanban, drawKpiScreen, drawVideoWall, drawWhiteboard } from "./boards.js";
import { HttpError, LiveSource, type DataSource } from "./data.js";
import { DemoSource } from "./demo.js";
import { Director } from "./director.js";
import { Hologram } from "./hologram.js";
import { buildLayout, OWNER_ID, workshopSeats, type Layout, type LayoutWorkshop } from "./layout.js";
import { Ui } from "./ui.js";
import { World } from "./world.js";

const app = document.getElementById("app")!;
const mode = app.dataset.mode === "demo" ? "demo" : "live";
const assetBase = app.dataset.assets ?? "/static/assets/";

function bootText(text: string, error = false): void {
  const boot = app.querySelector<HTMLElement>(".boot");
  const p = boot?.querySelector("p");
  if (p) p.textContent = text;
  boot?.classList.toggle("error", error);
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

const isNight = () => {
  const h = new Date().getHours();
  return h < 7 || h >= 21;
};

/** De werkplaats: een bord per project, bureaus voor de sessies (in stappen van drie). */
function workshopOf(snap: OfficeSnapshot): LayoutWorkshop | undefined {
  const live = snap.code.sessions.filter((s) => s.state !== "done");
  // Helpers (sub-agents) krijgen ook een bureau, naast hun sessie.
  const active = live.length + live.reduce((n, s) => n + (s.helpers?.length ?? 0), 0);
  if (!snap.code.projects.length && !active) return undefined;
  return { projects: snap.code.projects.map((p) => ({ key: p.key, name: p.name })), seats: workshopSeats(active) };
}

/** Welke dingen bepalen de plattegrond? Verandert dit, dan bouwen we het kantoor opnieuw op. */
function layoutKey(snap: OfficeSnapshot): string {
  return JSON.stringify([
    snap.branches.map((b) => [b.slug, b.name, b.template]),
    snap.agents
      .filter((a) => a.status !== "terminated")
      .map((a) => [a.id, a.name, a.branch, a.hqRole, a.template, a.status === "pending_approval"])
      .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    ownerName(snap),
    workshopOf(snap) ?? null,
  ]);
}

const ownerName = (snap: OfficeSnapshot) => snap.people.find((p) => p.id === OWNER_ID)?.nickname ?? undefined;

function layoutFor(snap: OfficeSnapshot): Layout {
  return buildLayout({
    branches: snap.branches.map((b) => ({ slug: b.slug, name: b.name, template: b.template })),
    agents: snap.agents.map((a) => ({ id: a.id, name: a.name, branch: a.branch, hqRole: a.hqRole, template: a.template, role: a.role, status: a.status })),
    ownerName: ownerName(snap),
    workshop: workshopOf(snap),
  });
}

/** Kleine portretjes van de 12 poppetjes voor de uiterlijk-kiezer. */
function makeThumbs(assets: Assets): string[] {
  const size = 112;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#ffffff", "#9aa3b5", 2.3));
  const sun = new THREE.DirectionalLight("#ffffff", 1.5);
  sun.position.set(1.5, 2.5, 3);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 20);
  camera.position.set(0.7, 1.15, 2.7);
  camera.lookAt(0, 0.72, 0);
  const out: string[] = [];
  for (let k = 0; k < CHARACTERS.length; k++) {
    const { root, clips } = assets.character(k);
    const idle = clips.find((c) => c.name === "idle");
    if (idle) {
      const mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(idle).play();
      mixer.update(0.4);
    }
    scene.add(root);
    renderer.render(scene, camera);
    out.push(renderer.domElement.toDataURL("image/png"));
    scene.remove(root);
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}

async function boot(): Promise<void> {
  if (!webglAvailable()) {
    bootText("Je browser kan geen 3D tekenen (WebGL staat uit). Het overzicht werkt wel.", true);
    return;
  }
  const source: DataSource = mode === "demo" ? new DemoSource() : new LiveSource();
  const assets = new Assets(assetBase);
  bootText("Kantoor laden…");
  let snap: OfficeSnapshot;
  try {
    [snap] = await Promise.all([
      source.snapshot(),
      assets.load((done, total) => bootText(`3D-modellen laden… ${Math.round((done / total) * 100)}%`)),
    ]);
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      bootText("Niet ingelogd. Open het kantoor via de link met ?token=… (je HQ_ADMIN_TOKEN).", true);
    } else {
      bootText(`Laden mislukt: ${err instanceof Error ? err.message : String(err)}. Ververs de pagina om het opnieuw te proberen.`, true);
    }
    return;
  }

  const stage = document.createElement("div");
  stage.className = "stage";
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  app.replaceChildren(stage, overlay);

  const world = new World(stage, assets);
  let layout = layoutFor(snap);
  let key = layoutKey(snap);
  world.build(layout);
  world.setNight(isNight());

  const hologram = new Hologram(world.hologramAnchor);
  world.scene.add(hologram.group);
  const loadGraph = () =>
    source
      .graph()
      .then((g) => hologram.setGraph(g))
      .catch((err) => console.warn("kennisgraaf laden mislukt", err));
  void loadGraph();

  let thumbs: string[] = [];
  let ui: Ui | null = null;
  const director = new Director(world, assets, hologram, {
    label: (id) => ui?.label(id) ?? "Iemand",
    toast: (text, kind, actorId) => ui?.toast(text, kind, actorId),
  });
  director.setLayout(layout);

  const accentOf = (branch: string) => layout.rooms.find((r) => r.id === layout.roomOfBranch.get(branch))?.accent ?? "#5b6b86";
  const drawBoards = (s: OfficeSnapshot) => {
    if (world.kanban) drawKanban(world.kanban, s.projects, accentOf);
    for (const [slug, screen] of world.whiteboards) drawWhiteboard(screen, s.branches.find((b) => b.slug === slug), s.projects, accentOf(slug));
    if (world.videoWall.length) drawVideoWall(world.videoWall, s, accentOf);
    if (world.kpiScreen) drawKpiScreen(world.kpiScreen, s);
    for (const [key, screen] of world.codeBoards) {
      drawCodeBoard(screen, s.code.projects.find((p) => p.key === key), s.code.sessions.filter((x) => x.projectKey === key && x.state !== "done").length);
    }
  };

  const apply = (s: OfficeSnapshot, first = false) => {
    snap = s;
    const nextKey = layoutKey(s);
    if (nextKey !== key) {
      key = nextKey;
      layout = layoutFor(s);
      world.build(layout);
      world.setNight(isNight());
      hologram.group.position.copy(world.hologramAnchor);
      director.setLayout(layout);
    }
    director.sync(s, first);
    ui?.update(s);
    drawBoards(s);
  };

  // Momentopname opnieuw ophalen na gebeurtenissen (gebundeld, zodat een reeks gebeurtenissen één keer ophaalt).
  let refreshing: Promise<void> | null = null;
  let again = false;
  const refresh = async (): Promise<void> => {
    if (refreshing) {
      again = true;
      return refreshing;
    }
    refreshing = (async () => {
      try {
        apply(await source.snapshot());
      } catch (err) {
        if (err instanceof HttpError && err.status === 401) ui?.toast("⚠️ Niet meer ingelogd: open de link met ?token=… opnieuw", "bad");
        else console.warn("verversen mislukt", err);
      }
    })();
    await refreshing;
    refreshing = null;
    if (again) {
      again = false;
      await refresh();
    }
  };
  let soonTimer: number | undefined;
  const soon = () => {
    clearTimeout(soonTimer);
    soonTimer = window.setTimeout(() => void refresh(), mode === "demo" ? 300 : 1200);
  };

  ui = new Ui(overlay, { source, director, world, thumbs: () => thumbs, refresh, layout: () => layout });
  // Pas nu in beeld brengen: de bovenbalk en knoppen staan er, dus de camera weet welk stuk vrij is.
  world.fit();
  apply(snap, true);

  world.onPick = (pick) => {
    if (pick) ui?.pick(pick);
    else ui?.close();
  };
  world.onHover = (pick) => ui?.hover(pick);

  // Naamkaartjes kleiner als je ver uitzoomt, zodat het niet één grote wolk tekst wordt.
  let tagClock = 0;
  let tagMode = "";
  world.addUpdater((dt, t) => {
    director.update(dt, t);
    hologram.update(dt, t, world.zoomLevel);
    tagClock -= dt;
    if (tagClock <= 0) {
      tagClock = 0.3;
      const z = world.zoomLevel;
      const next = z < 0.32 ? "tiny" : z < 0.6 ? "hidden" : z < 1.05 ? "compact" : "full";
      if (next !== tagMode) {
        tagMode = next;
        app.dataset.tags = next;
      }
    }
  });
  world.start();

  source.subscribe(
    (e) => {
      director.handle(e);
      ui?.addEvent(e);
      if (e.type === "knowledge.rebuilt") void loadGraph();
      soon();
    },
    (ok) => ui?.setConnected(ok),
  );
  // Vangnet: ook zonder gebeurtenissen af en toe verversen (kosten, status uit Paperclip).
  window.setInterval(() => void refresh(), mode === "demo" ? 20_000 : 45_000);
  window.setInterval(() => world.setNight(isNight()), 5 * 60_000);

  // Portretjes pas na de eerste frames maken: dan staat het kantoor al in beeld.
  window.setTimeout(() => {
    try {
      thumbs = makeThumbs(assets);
    } catch (err) {
      console.warn("portretjes maken mislukt", err);
    }
  }, 600);

  if (mode === "demo") ui.toast("👋 Welkom in het demo-kantoor. Klik op een poppetje, een bord of je bureau.", "info");
  // Voor wie wil meekijken in de console (en voor de tests).
  (window as unknown as { hq: unknown }).hq = { world, director, ui, source, refresh };
}

void boot();
