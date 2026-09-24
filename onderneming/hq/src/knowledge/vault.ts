import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { AppContext } from "../domain/context.js";
import { experimentCode } from "../domain/codes.js";
import { buildHqGraph, HQ_GRAPH } from "./graph.js";

/**
 * De kennisbank als map met Markdown-notities (een Obsidian-vault). HQ schrijft er takken, experimenten,
 * lessen, notities en agents in, met [[links]] ertussen. Graphify maakt daar een kennisgraaf van.
 * De database blijft de bron; deze map wordt steeds opnieuw bijgewerkt.
 */

export const slug = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "x";

const yamlValue = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return `[${v.map((x) => JSON.stringify(String(x))).join(", ")}]`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(String(v));
};

function note(frontmatter: Record<string, unknown>, body: string): string {
  const fm = Object.entries(frontmatter)
    .filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${k}: ${yamlValue(v)}`)
    .join("\n");
  return `---\n${fm}\n---\n\n${body.trim()}\n`;
}

export interface VaultSyncResult {
  written: number;
  unchanged: number;
  removed: number;
  files: number;
}

/** Schrijft de hele kennisbank. Alleen gewijzigde bestanden worden aangeraakt (goed voor Graphify's cache). */
export async function syncVault(ctx: AppContext, vaultDir: string, agentNames: Map<string, string>): Promise<VaultSyncResult> {
  const files = new Map<string, string>();
  const agentLink = (id: string | null | undefined) => (id && agentNames.has(id) ? `[[${slug(agentNames.get(id)!)}]]` : null);

  const branches = await ctx.db.query<{ id: number; slug: string; name: string; description: string | null; status: string }>(
    "select id, slug, name, description, status from branches order by id",
  );
  const branchSlug = new Map(branches.map((b) => [b.id, b.slug]));

  const experiments = await ctx.db.query<{
    id: number;
    branch_id: number;
    parent_id: number | null;
    title: string;
    hypothesis: string;
    metric_name: string;
    metric_target: string | number;
    budget_eur: string | number;
    status: string;
    prediction: string | null;
    evidence_links: string[] | null;
    lead_agent_id: string | null;
    decision_reason: string | null;
    started_at: string | Date | null;
    ended_at: string | Date | null;
  }>("select * from experiments order by id");

  const lessons = await ctx.db.query<{
    id: number;
    branch_id: number | null;
    experiment_id: number | null;
    lesson: string;
    evidence: string | null;
    tags: string[] | null;
    created_by: string;
    created_at: string | Date;
  }>("select * from lessons order by id");

  const notes = await ctx.db.query<{
    id: number;
    agent_id: string | null;
    author: string;
    title: string;
    body: string;
    tags: string[] | null;
    branch_id: number | null;
    experiment_id: number | null;
    created_at: string | Date;
  }>("select * from notes order by id");

  for (const b of branches) {
    const exps = experiments.filter((e) => e.branch_id === b.id);
    files.set(
      join("Takken", `${b.slug}.md`),
      note(
        { type: "tak", naam: b.name, status: b.status },
        [
          `# Tak: ${b.name}`,
          b.description ?? "",
          exps.length ? `## Experimenten\n${exps.map((e) => `- [[${experimentCode(e.id)}]] ${e.title} (${e.status})`).join("\n")}` : "",
        ].join("\n\n"),
      ),
    );
  }

  for (const e of experiments) {
    const code = experimentCode(e.id);
    const expLessons = lessons.filter((l) => l.experiment_id === e.id);
    files.set(
      join("Experimenten", `${code}.md`),
      note(
        {
          type: "experiment",
          tak: branchSlug.get(e.branch_id),
          status: e.status,
          metric: e.metric_name,
          doel: Number(e.metric_target),
          budget_eur: Number(e.budget_eur),
          gestart: e.started_at ? new Date(e.started_at).toISOString().slice(0, 10) : null,
          geëindigd: e.ended_at ? new Date(e.ended_at).toISOString().slice(0, 10) : null,
        },
        [
          `# ${code}: ${e.title}`,
          `Tak: [[${branchSlug.get(e.branch_id)}]]${agentLink(e.lead_agent_id) ? ` · Lead: ${agentLink(e.lead_agent_id)}` : ""}${e.parent_id ? ` · Vervolg op [[${experimentCode(e.parent_id)}]]` : ""}`,
          `## Hypothese\n${e.hypothesis}`,
          `## Succes\n${e.metric_name} ≥ ${Number(e.metric_target)}`,
          e.prediction ? `## Voorspelling vooraf\n${e.prediction}` : "",
          e.decision_reason ? `## Uitkomst (${e.status})\n${e.decision_reason}` : "",
          e.evidence_links?.length ? `## Bronnen\n${e.evidence_links.map((u) => `- ${u}`).join("\n")}` : "",
          expLessons.length ? `## Lessen\n${expLessons.map((l) => `- [[les-${l.id}]]`).join("\n")}` : "",
        ].join("\n\n"),
      ),
    );
  }

  for (const l of lessons) {
    const author = l.created_by.startsWith("agent:") ? agentLink(l.created_by.slice(6)) : l.created_by === "owner" ? "de eigenaar" : null;
    files.set(
      join("Lessen", `les-${l.id}.md`),
      note(
        {
          type: "les",
          tak: l.branch_id ? branchSlug.get(l.branch_id) : null,
          experiment: l.experiment_id ? experimentCode(l.experiment_id) : null,
          tags: l.tags ?? [],
          datum: new Date(l.created_at).toISOString().slice(0, 10),
        },
        [
          `# Les ${l.id}`,
          l.lesson,
          l.evidence ? `**Bewijs:** ${l.evidence}` : "",
          [
            l.experiment_id ? `Uit [[${experimentCode(l.experiment_id)}]]` : null,
            l.branch_id ? `Tak [[${branchSlug.get(l.branch_id)}]]` : null,
            author ? `Door ${author}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
          (l.tags ?? []).map((t) => `#${t}`).join(" "),
        ].join("\n\n"),
      ),
    );
  }

  for (const n of notes) {
    const folder = slug(n.author || "onbekend");
    files.set(
      join("Notities", folder, `notitie-${n.id}-${slug(n.title)}.md`),
      note(
        {
          type: "notitie",
          auteur: n.author,
          tak: n.branch_id ? branchSlug.get(n.branch_id) : null,
          experiment: n.experiment_id ? experimentCode(n.experiment_id) : null,
          tags: n.tags ?? [],
          datum: new Date(n.created_at).toISOString().slice(0, 10),
        },
        [
          `# ${n.title}`,
          n.body,
          [
            agentLink(n.agent_id) ? `Door ${agentLink(n.agent_id)}` : null,
            n.experiment_id ? `Over [[${experimentCode(n.experiment_id)}]]` : null,
            n.branch_id ? `Tak [[${branchSlug.get(n.branch_id)}]]` : null,
          ]
            .filter(Boolean)
            .join(" · "),
          (n.tags ?? []).map((t) => `#${t}`).join(" "),
        ].join("\n\n"),
      ),
    );
  }

  for (const [id, name] of agentNames) {
    const wrote = [
      ...lessons.filter((l) => l.created_by === `agent:${id}`).map((l) => `- [[les-${l.id}]]`),
      ...notes.filter((n) => n.agent_id === id).map((n) => `- ${n.title}`),
    ];
    const leads = experiments.filter((e) => e.lead_agent_id === id).map((e) => `- [[${experimentCode(e.id)}]]`);
    files.set(
      join("Agents", `${slug(name)}.md`),
      note(
        { type: "agent", naam: name, id },
        [`# ${name}`, leads.length ? `## Leidt\n${leads.join("\n")}` : "", wrote.length ? `## Schreef\n${wrote.join("\n")}` : ""].join(
          "\n\n",
        ),
      ),
    );
  }

  files.set(
    "README.md",
    [
      "# Kennisbank",
      "",
      "Het gedeelde geheugen van de agents. HQ schrijft deze map automatisch; wijzigingen met de hand worden overschreven.",
      "Agents voegen kennis toe via HQ (`POST /api/agent/notes` of `/api/agent/lessons`) en zoeken via `GET /api/agent/knowledge?q=…`.",
      "",
      "Mappen: Takken, Experimenten, Lessen, Notities en Agents. Graphify maakt hier een kennisgraaf van (graphify-out/).",
    ].join("\n"),
  );
  // Graphify hoeft HQ's eigen graaf niet als bron te lezen.
  files.set(".graphifyignore", ".hq/\n");

  let written = 0;
  let unchanged = 0;
  for (const [rel, content] of files) {
    const path = join(vaultDir, rel);
    if (existsSync(path) && readFileSync(path, "utf8") === content) {
      unchanged += 1;
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    written += 1;
  }

  // Verwijder wat niet meer bestaat (alleen in de mappen die HQ beheert).
  let removed = 0;
  const managed = ["Takken", "Experimenten", "Lessen", "Notities", "Agents"];
  const expected = new Set([...files.keys()].map((k) => k.split("\\").join("/")));
  const walk = (dir: string): string[] =>
    existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]))
      : [];
  for (const top of managed) {
    for (const file of walk(join(vaultDir, top))) {
      const rel = relative(vaultDir, file).split("\\").join("/");
      if (file.endsWith(".md") && !expected.has(rel)) {
        rmSync(file);
        removed += 1;
      }
    }
  }

  // De eigen HQ-graaf, zodat `graphify query` ook werkt voordat Graphify zelf gedraaid heeft.
  const graph = await buildHqGraph(ctx.db, agentNames);
  const graphFile = join(vaultDir, HQ_GRAPH);
  mkdirSync(dirname(graphFile), { recursive: true });
  writeFileSync(graphFile, JSON.stringify(graph));

  return { written, unchanged, removed, files: files.size };
}
