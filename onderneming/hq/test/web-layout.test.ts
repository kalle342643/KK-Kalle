import { describe, expect, it } from "vitest";
import { buildLayout, roomAt, type LayoutAgent } from "../web/office/layout.js";
import { canStep, cellOf, findPath, isBlocked, lineOfSight, pathLength } from "../web/office/path.js";

const agent = (id: string, branch: string, extra: Partial<LayoutAgent> = {}): LayoutAgent => ({
  id,
  name: id,
  branch,
  hqRole: null,
  template: null,
  role: "general",
  status: "idle",
  ...extra,
});

function company(perBranch: Record<string, number>, pending = 1) {
  const agents: LayoutAgent[] = [agent("atlas", "holding", { hqRole: "ceo", role: "ceo" }), agent("argus", "holding", { hqRole: "analyst" })];
  for (const [slug, n] of Object.entries(perBranch)) {
    for (let k = 0; k < n; k++) agents.push(agent(`${slug}-${k}`, slug, k === 0 ? { template: "tak-lead", hqRole: "lead" } : {}));
  }
  for (let k = 0; k < pending; k++) agents.push(agent(`nieuw-${k}`, "games", { status: "pending_approval" }));
  const branches = Object.keys(perBranch).map((slug) => ({ slug, name: slug, template: slug }));
  return buildLayout({ branches, agents });
}

describe("plattegrond", () => {
  it("geeft elke agent een bureau, de CEO de directiekamer en sollicitanten een plek in de hal", () => {
    const layout = company({ games: 7, content: 5, saas: 6 });
    expect(layout.deskOf.get("atlas")).toBe("desk-ceo");
    expect(layout.deskOf.get("owner")).toBe("desk-owner");
    expect(layout.deskOf.get("hq-bot")).toBe("desk-bot");
    expect(layout.rooms.find((r) => r.id === "dept-holding")).toMatchObject({ kind: "control", name: "Controlekamer" });
    expect(layout.furniture.some((f) => f.type === "kanban" && f.roomId === "meeting")).toBe(true);
    expect(layout.furniture.some((f) => f.type === "vault")).toBe(true);
    expect(layout.desks.find((d) => d.id === layout.deskOf.get("argus"))!.roomId).toBe("dept-holding");
    const lead = layout.desks.find((d) => d.agentId === "games-0")!;
    expect(lead).toMatchObject({ roomId: "dept-games", lead: true });
    for (let k = 0; k < 7; k++) expect(layout.deskOf.has(`games-${k}`)).toBe(true);
    expect(layout.deskOf.has("nieuw-0")).toBe(false);
    expect(layout.benchOf.get("nieuw-0")).toBe("bench-0");
    // Elke afdeling heeft minstens één vrij bureau voor een nieuwe collega.
    for (const slug of ["games", "content", "saas"]) {
      expect(layout.desks.some((d) => d.roomId === `dept-${slug}` && d.agentId === null)).toBe(true);
    }
    expect(roomAt(layout, lead.seat.x, lead.seat.z)?.id).toBe("dept-games");
  });

  it("kamers overlappen niet en liggen binnen het gebouw", () => {
    const layout = company({ games: 7, content: 5, saas: 6, extra: 3 });
    const walled = layout.rooms.filter((r) => r.kind !== "hall" && r.kind !== "corridor");
    for (const a of walled) {
      expect(a.rect.x + a.rect.w).toBeLessThanOrEqual(layout.width);
      expect(a.rect.z + a.rect.d).toBeLessThanOrEqual(layout.depth);
      for (const b of walled) {
        if (a === b) continue;
        const overlap =
          a.rect.x < b.rect.x + b.rect.w && b.rect.x < a.rect.x + a.rect.w && a.rect.z < b.rect.z + b.rect.d && b.rect.z < a.rect.z + a.rect.d;
        expect(overlap, `${a.id} overlapt ${b.id}`).toBe(false);
      }
    }
  });

  it("vanaf de ingang is elk bureau, elke kamer en elke plek bereikbaar", () => {
    const layout = company({ games: 7, content: 5, saas: 6 });
    const from = layout.entrance;
    const targets = [
      ...layout.desks.map((d) => ({ name: `zit ${d.id}`, p: d.seat })),
      ...layout.desks.map((d) => ({ name: `bezoek ${d.id}`, p: d.visitor })),
      ...layout.pois.map((p) => ({ name: `plek ${p.id}`, p: p.spot })),
    ];
    for (const t of targets) {
      const path = findPath(layout.grid, from, t.p);
      expect(path, t.name).not.toBeNull();
      const end = path!.at(-1)!;
      // Zitplekken op een bank of bank mogen op een geblokkeerde cel liggen: dan eindigt de route ernaast.
      expect(Math.hypot(end.x - t.p.x, end.z - t.p.z), t.name).toBeLessThan(1.3);
    }
  });

  it("zitplekken aan bureaus en plekken voor bezoekers liggen op vrije vloer", () => {
    const layout = company({ games: 7 });
    for (const d of layout.desks) {
      const seat = cellOf(d.seat);
      const visitor = cellOf(d.visitor);
      expect(isBlocked(layout.grid, seat.i, seat.j), `stoel ${d.id}`).toBe(false);
      expect(isBlocked(layout.grid, visitor.i, visitor.j), `bezoek ${d.id}`).toBe(false);
    }
    for (const p of layout.pois.filter((x) => !x.seated)) {
      const c = cellOf(p.spot);
      expect(isBlocked(layout.grid, c.i, c.j), p.id).toBe(false);
    }
  });

  it("groeit mee: honderd agents in vijf takken", () => {
    const layout = company({ games: 30, content: 20, saas: 20, shop: 15, blog: 13 }, 5);
    // 100 agents plus jij (eigen kantoor) en de HQ-bot (controlekamer).
    expect(layout.deskOf.size).toBe(102);
    expect(layout.rooms.filter((r) => r.kind === "corridor").length).toBeGreaterThan(1);
    const far = layout.desks.find((d) => d.agentId === "blog-12")!;
    const path = findPath(layout.grid, layout.entrance, far.seat)!;
    expect(path).not.toBeNull();
    expect(pathLength(layout.entrance, path)).toBeGreaterThan(10);
  });

  it("verdeelt afdelingen gelijk over de rijen: geen afdeling alleen in een lege zaal", () => {
    // Iets te breed voor één rij: dan wordt het gebouw iets breder in plaats van een tweede, halflege rij.
    const oneRow = company({ games: 7, content: 5, saas: 6 });
    const depts = (l: typeof oneRow) => l.rooms.filter((r) => r.kind === "dept" || r.kind === "control");
    expect(new Set(depts(oneRow).map((r) => r.rect.z)).size).toBe(1);
    // Veel takken: meerdere rijen, en elke rij is ongeveer even vol (geen zaal die meer dan twee keer zo breed is als nodig).
    const many = company({ a: 8, b: 8, c: 8, d: 8, e: 8, f: 8, g: 8 });
    const rows = new Map<number, number>();
    for (const r of depts(many)) rows.set(r.rect.z, (rows.get(r.rect.z) ?? 0) + 1);
    expect(rows.size).toBeGreaterThan(1);
    for (const r of depts(many)) {
      const seats = many.desks.filter((d) => d.roomId === r.id).length;
      expect(r.rect.w).toBeLessThan(Math.max(10, 3 * Math.ceil(Math.sqrt(seats * 1.4)) + 2) * 2);
    }
  });

  it("zitplekken weten hoe hoog ze zijn (stoel, bank, kruk)", () => {
    const layout = company({ games: 3 });
    expect(layout.pois.find((p) => p.kind === "bench")!.spot.y).toBeCloseTo(0.368);
    expect(layout.pois.find((p) => p.kind === "stool")!.spot.y).toBeCloseTo(0.696);
    expect(layout.pois.find((p) => p.kind === "meeting-seat")!.spot.y).toBeCloseTo(0.384);
    // Bureaustoelen gebruiken de standaardhoogte.
    expect(layout.desks[0]!.seat.y).toBeUndefined();
  });

  it("muren houden je tegen, deuren niet", () => {
    const layout = company({ games: 3 });
    const ceo = layout.rooms.find((r) => r.id === "ceo")!;
    const door = ceo.door!;
    // Door de deur naar beneden (de gang in) mag; ernaast zit een muur.
    expect(canStep(layout.grid, door.x, door.z - 1, 0, 1)).toBe(true);
    expect(canStep(layout.grid, door.x + 3, door.z - 1, 0, 1)).toBe(false);
    expect(lineOfSight(layout.grid, { x: door.x + 4.5, z: door.z - 1.5 }, { x: door.x + 4.5, z: door.z + 1.5 })).toBe(false);
  });
});
