import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/api/app.js";
import { addLesson } from "../src/domain/lessons.js";
import { buildHqGraph, loadKnowledgeGraph, toKnowledgeGraph } from "../src/knowledge/graph.js";
import { graphifyExtract, graphifyQuery } from "../src/knowledge/graphify.js";
import { addNote } from "../src/knowledge/notes.js";
import { askKnowledge, rebuildKnowledge, searchTerms } from "../src/knowledge/service.js";
import { syncVault } from "../src/knowledge/vault.js";
import { createTestEnv, type TestEnv } from "./helpers/context.js";

let env: TestEnv;
let dir: string;
beforeEach(async () => {
  env = await createTestEnv();
  dir = mkdtempSync(join(tmpdir(), "hq-vault-"));
});
afterEach(async () => {
  await env.close();
  rmSync(dir, { recursive: true, force: true });
});

async function seedKnowledge() {
  await addLesson(env.ctx, { lesson: "Idle-games scoren slecht op mobiel bij CrazyGames.", branch: "games", tags: ["mobiel"] }, `agent:${env.lead.id}`);
  await addLesson(env.ctx, { lesson: "Korte levels verhogen de speeltijd per sessie.", branch: "games", tags: ["retentie"] }, "owner");
  await addNote(
    env.ctx,
    { title: "Retentie op mobiel", body: "Spelers op mobiel haken af na level 3 als de tutorial te lang is.", tags: ["mobiel", "retentie"], branch: "games" },
    `agent:${env.scout.id}`,
    "Rigel",
  );
}

describe("vragen aan de kennisbank", () => {
  it("haalt zoekwoorden uit een vraag zonder stopwoorden", () => {
    expect(searchTerms("Hoe verhoog ik de retentie op mobiel?")).toEqual(["verhoog", "retentie", "mobiel"]);
    expect(searchTerms("de en het")).toEqual([]);
  });

  it("vindt lessen en notities op losse woorden en laat de agent naar de kennisbank lopen", async () => {
    await seedKnowledge();
    const answer = await askKnowledge(env.ctx, "Wat weten we over retentie op mobiel?", env.lead.id);
    expect(answer.lessons.map((l) => l.lesson)).toEqual(
      expect.arrayContaining(["Idle-games scoren slecht op mobiel bij CrazyGames.", "Korte levels verhogen de speeltijd per sessie."]),
    );
    expect(answer.notes[0]).toMatchObject({ title: "Retentie op mobiel", author: "Rigel" });
    expect(answer.graph).toBeNull();
    const event = (await env.ctx.events.recent()).at(-1)!;
    expect(event).toMatchObject({ type: "knowledge.query", agentId: env.lead.id, text: "Wat weten we over retentie op mobiel?" });
  });

  it("agent-API: notitie schrijven en de kennisbank doorzoeken", async () => {
    const app = createApp(env.ctx);
    const auth = { authorization: `Bearer ${env.scout.token}`, "content-type": "application/json" };
    const created = await app.request("/api/agent/notes", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ title: "Concurrent X", body: "Concurrent X heeft 40 levels en een daily challenge.", tags: ["concurrentie"] }),
    });
    expect(created.status).toBe(201);
    expect((await env.ctx.events.recent()).at(-1)).toMatchObject({ type: "knowledge.write", agentId: env.scout.id, text: "Concurrent X" });

    const res = await app.request("/api/agent/knowledge?q=daily%20challenge%20concurrent", { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notes: Array<{ title: string; author: string }> };
    expect(body.notes[0]).toMatchObject({ title: "Concurrent X", author: "Rigel" });
    expect((await app.request("/api/agent/knowledge?q=x", { headers: auth })).status).toBe(400);
    // Lessen zoeken telt ook als 'iets opzoeken' in het kantoor.
    await app.request("/api/agent/lessons?q=mobiel", { headers: auth });
    expect((await env.ctx.events.recent()).at(-1)).toMatchObject({ type: "knowledge.query", text: "mobiel" });
  });
});

describe("de kennisbank-map (Obsidian) en de graaf", () => {
  it("schrijft notities met [[links]], alleen wat veranderde, en ruimt oude op", async () => {
    await seedKnowledge();
    const names = new Map([
      [env.lead.id, "Vega"],
      [env.scout.id, "Rigel"],
    ]);
    const first = await syncVault(env.ctx, dir, names);
    expect(first.written).toBe(first.files);
    const les = readFileSync(join(dir, "Lessen", "les-1.md"), "utf8");
    expect(les).toContain("type: \"les\"");
    expect(les).toContain("Tak [[games]]");
    expect(les).toContain("Door [[vega]]");
    expect(les).toContain("#mobiel");
    expect(existsSync(join(dir, "Takken", "games.md"))).toBe(true);
    expect(readFileSync(join(dir, "Agents", "rigel.md"), "utf8")).toContain("Retentie op mobiel");
    expect(existsSync(join(dir, "Notities", "rigel", "notitie-1-retentie-op-mobiel.md"))).toBe(true);
    expect(readFileSync(join(dir, ".graphifyignore"), "utf8")).toContain(".hq/");
    const graph = JSON.parse(readFileSync(join(dir, ".hq", "graph.json"), "utf8")) as { nodes: Array<{ id: string }> };
    expect(graph.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(["tak:games", "les:1", "notitie:1", "tag:mobiel", `agent:${env.scout.id}`]));

    const second = await syncVault(env.ctx, dir, names);
    expect(second.written).toBe(0);
    writeFileSync(join(dir, "Lessen", "les-99.md"), "oud");
    expect((await syncVault(env.ctx, dir, names)).removed).toBe(1);
  });

  it("bouwt de HQ-graaf en kort hem in op de best verbonden knopen", async () => {
    await seedKnowledge();
    const g = await buildHqGraph(env.db, new Map([[env.scout.id, "Rigel"]]));
    const kg = toKnowledgeGraph(g, "hq", null, 3);
    expect(kg.nodes).toHaveLength(3);
    expect(kg.totalNodes).toBeGreaterThan(3);
    expect(kg.nodes[0]!.degree).toBeGreaterThanOrEqual(kg.nodes[2]!.degree);
    for (const e of kg.edges) {
      expect(kg.nodes.some((n) => n.id === e.source) && kg.nodes.some((n) => n.id === e.target)).toBe(true);
    }
  });

  it("gebruikt de Graphify-graaf zodra die er is", async () => {
    mkdirSync(join(dir, "graphify-out"), { recursive: true });
    writeFileSync(
      join(dir, "graphify-out", "graph.json"),
      JSON.stringify({
        nodes: [
          { id: "a", label: "Retentie", community: 0, file_type: "document" },
          { id: "b", label: "Tutorial", community: 0, file_type: "document" },
        ],
        links: [{ source: "a", target: "b", relation: "semantically_similar_to" }],
      }),
    );
    const kg = await loadKnowledgeGraph(env.db, dir);
    expect(kg).toMatchObject({ source: "graphify", totalNodes: 2, totalEdges: 1 });
    expect(kg.edges[0]).toMatchObject({ relation: "semantically_similar_to" });
  });
});

describe("Graphify als programma", () => {
  /** Een nep-graphify die zijn argumenten en de sleutel terugmeldt, en bij 'extract' een graaf schrijft. */
  function fakeGraphify(): string {
    const bin = join(dir, "fake-graphify.sh");
    writeFileSync(
      bin,
      [
        "#!/bin/sh",
        'if [ "$1" = "query" ]; then echo "[i] budget-uitleg"; echo "NODE $2"; echo "ARGS $*"; exit 0; fi',
        'if [ "$1" = "extract" ]; then mkdir -p "$2/graphify-out"; echo \'{"nodes":[{"id":"x","label":"X"}],"links":[]}\' > "$2/graphify-out/graph.json"; echo "key=${ANTHROPIC_API_KEY:-geen}"; exit 0; fi',
        "exit 1",
      ].join("\n"),
    );
    chmodSync(bin, 0o755);
    return bin;
  }

  it("query doorzoekt de beste graaf en laat de budget-uitleg weg", async () => {
    env.ctx.config.knowledge = { ...env.ctx.config.knowledge, vaultDir: dir, graphifyBin: fakeGraphify() };
    expect(await graphifyQuery(env.ctx.config, "retentie")).toBeNull(); // nog geen graaf
    await seedKnowledge();
    await syncVault(env.ctx, dir, new Map());
    const out = (await graphifyQuery(env.ctx.config, "retentie mobiel"))!;
    expect(out).toContain("NODE retentie mobiel");
    expect(out).toContain(`--graph ${join(dir, ".hq", "graph.json")}`);
    expect(out).not.toContain("[i]");
    // Agents krijgen graaf-uitvoer pas bij een flinke kennisbank; daaronder is gewoon zoeken genoeg.
    expect((await askKnowledge(env.ctx, "retentie mobiel", null)).graph).toBeNull();
    env.ctx.config.knowledge.graphifyMinNotes = 3;
    expect((await askKnowledge(env.ctx, "retentie mobiel", null)).graph).toContain("NODE retentie mobiel");
  });

  it("extract draait alleen met een eigen sleutel en meldt de nieuwe graaf in het kantoor", async () => {
    env.ctx.config.knowledge = { ...env.ctx.config.knowledge, vaultDir: dir, graphifyBin: fakeGraphify() };
    expect((await graphifyExtract(env.ctx.config)).ok).toBe(false);
    const without = await rebuildKnowledge(env.ctx);
    expect(without).toContain("staat uit");

    env.ctx.config.knowledge.graphifyApiKey = "sk-test";
    // Met een sleutel, maar een kleine kennisbank: nog geen AI-kosten voor een graaf die weinig toevoegt.
    await seedKnowledge();
    expect(await rebuildKnowledge(env.ctx)).toContain("wacht tot er 100 lessen en notities zijn (nu 3)");
    env.ctx.config.knowledge.graphifyMinNotes = 0;
    const res = await graphifyExtract(env.ctx.config);
    expect(res).toMatchObject({ ok: true });
    expect(res.message).toContain("key=sk-test");
    const msg = await rebuildKnowledge(env.ctx);
    expect(msg).toContain("graphify:");
    const rebuilt = (await env.ctx.events.recent()).filter((e) => e.type === "knowledge.rebuilt").at(-1)!;
    expect(rebuilt.data).toMatchObject({ source: "graphify", nodes: 1 });
  });
});
