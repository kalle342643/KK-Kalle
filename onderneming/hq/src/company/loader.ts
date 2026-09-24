import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * "Bedrijf als code": de holding, de eerste agents, skills, routines en sjablonen staan als
 * Markdown/YAML in onderneming/company. HQ leest ze in en zet ze in Paperclip (bootstrap).
 */

const ROLES = ["ceo", "cto", "cmo", "cfo", "security", "engineer", "designer", "pm", "qa", "devops", "researcher", "general"] as const;

/** Iconen die Paperclip accepteert (Paperclip 2026.916.1). */
export const AGENT_ICONS = [
  "bot", "cpu", "brain", "zap", "rocket", "code", "terminal", "shield", "eye", "search", "wrench", "hammer",
  "lightbulb", "sparkles", "star", "heart", "flame", "bug", "cog", "database", "globe", "lock", "mail",
  "message-square", "file-code", "git-branch", "package", "puzzle", "target", "wand", "atom", "circuit-board",
  "radar", "swords", "telescope", "microscope", "crown", "gem", "hexagon", "pentagon", "fingerprint",
] as const;

export const agentFrontmatter = z.object({
  name: z.string().min(1),
  role: z.enum(ROLES),
  title: z.string().min(1),
  icon: z.enum(AGENT_ICONS).optional(),
  description: z.string().min(1),
  model: z.string().min(1),
  effort: z.enum(["low", "medium", "high"]).optional(),
  budgetEur: z.number().nonnegative(),
  heartbeat: z
    .object({ enabled: z.boolean(), intervalSec: z.number().int().positive().optional() })
    .default({ enabled: false }),
  skills: z.array(z.string()).default([]),
  maxTurnsPerRun: z.number().int().positive().optional(),
  timeoutSec: z.number().int().positive().optional(),
  canCreateAgents: z.boolean().default(false),
  /** Rol-sleutel die HQ onthoudt (bv. 'ceo', 'analyst') zodat andere onderdelen de agent kunnen vinden. */
  hqRole: z.string().optional(),
  reportsTo: z.string().optional(),
});

export type AgentSpec = z.infer<typeof agentFrontmatter> & { key: string; instructions: string };

export const skillFrontmatter = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().min(1),
  tagline: z.string().optional(),
});

export type SkillSpec = z.infer<typeof skillFrontmatter> & { markdown: string };

export const routineSpec = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  assignee: z.string().min(1),
  cron: z.string().min(9),
  priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
});

export type RoutineSpec = z.infer<typeof routineSpec>;

export const companySpec = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  timezone: z.string().default("Europe/Amsterdam"),
  requireBoardApprovalForNewAgents: z.boolean().default(true),
  routines: z.array(routineSpec).default([]),
  /** Routines die niet meer nodig zijn: `bootstrap` pauzeert ze in Paperclip (op titel). */
  retiredRoutines: z.array(z.string().min(1)).default([]),
});

export type CompanySpec = z.infer<typeof companySpec>;

export const branchTemplateSpec = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  monthlyBudgetEur: z.number().nonnegative(),
  agents: z
    .array(
      z.object({
        template: z.string().min(1),
        name: z.string().min(1),
        lead: z.boolean().default(false),
      }),
    )
    .min(1),
  routines: z.array(routineSpec).default([]),
});

export type BranchTemplate = z.infer<typeof branchTemplateSpec> & { key: string };

export interface CompanyDefinition {
  dir: string;
  company: CompanySpec;
  agents: AgentSpec[];
  skills: SkillSpec[];
  agentTemplates: AgentSpec[];
  branchTemplates: BranchTemplate[];
}

export function splitFrontmatter(text: string): { data: unknown; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error("Bestand mist frontmatter (--- ... ---).");
  return { data: parseYaml(m[1]!), body: m[2]!.trim() };
}

function readDir(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext) && !f.startsWith("_"))
    .sort()
    .map((f) => join(dir, f));
}

function loadAgent(path: string): AgentSpec {
  const { data, body } = splitFrontmatter(readFileSync(path, "utf8"));
  const parsed = agentFrontmatter.safeParse(data);
  if (!parsed.success) throw new Error(`${path}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return { ...parsed.data, key: basename(path, ".md"), instructions: body };
}

/** Standaardlocatie: onderneming/company naast de hq-map. */
export function defaultCompanyDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/company of dist/company → ../../../company
  return resolve(here, "..", "..", "..", "company");
}

export function loadCompany(dir = defaultCompanyDir()): CompanyDefinition {
  const companyPath = join(dir, "company.yaml");
  if (!existsSync(companyPath)) throw new Error(`Geen company.yaml gevonden in ${dir}`);
  const company = companySpec.parse(parseYaml(readFileSync(companyPath, "utf8")));
  const skills = readDir(join(dir, "skills"), ".md").map((path) => {
    const text = readFileSync(path, "utf8");
    const { data } = splitFrontmatter(text);
    const parsed = skillFrontmatter.safeParse(data);
    if (!parsed.success) throw new Error(`${path}: ${parsed.error.message}`);
    return { ...parsed.data, markdown: text.trim() + "\n" };
  });
  const branchTemplates = readDir(join(dir, "templates", "branches"), ".yaml").map((path) => {
    const parsed = branchTemplateSpec.safeParse(parseYaml(readFileSync(path, "utf8")));
    if (!parsed.success) throw new Error(`${path}: ${parsed.error.message}`);
    return { ...parsed.data, key: basename(path, ".yaml") };
  });
  const def: CompanyDefinition = {
    dir,
    company,
    agents: readDir(join(dir, "agents"), ".md").map(loadAgent),
    skills,
    agentTemplates: readDir(join(dir, "templates", "agents"), ".md").map(loadAgent),
    branchTemplates,
  };
  validateReferences(def);
  return def;
}

/** Vangt tikfouten vroeg af: onbekende skills, sjablonen of toegewezen agents. */
export function validateReferences(def: CompanyDefinition): void {
  const skillNames = new Set(def.skills.map((s) => s.name));
  const templateKeys = new Set(def.agentTemplates.map((t) => t.key));
  const problems: string[] = [];
  for (const a of [...def.agents, ...def.agentTemplates]) {
    for (const s of a.skills) if (!skillNames.has(s)) problems.push(`${a.key}: onbekende skill '${s}'`);
  }
  const holdingAgents = new Set(def.agents.map((a) => a.name));
  for (const r of def.company.routines) {
    if (!holdingAgents.has(r.assignee)) problems.push(`routine '${r.title}': onbekende agent '${r.assignee}'`);
  }
  for (const b of def.branchTemplates) {
    const names = new Set(b.agents.map((a) => a.name));
    if (b.agents.filter((a) => a.lead).length !== 1) problems.push(`tak-sjabloon ${b.key}: precies één lead nodig`);
    for (const a of b.agents) if (!templateKeys.has(a.template)) problems.push(`tak-sjabloon ${b.key}: onbekend agent-sjabloon '${a.template}'`);
    for (const r of b.routines) if (!names.has(r.assignee)) problems.push(`tak-sjabloon ${b.key}: routine '${r.title}' voor onbekende agent '${r.assignee}'`);
  }
  if (problems.length) throw new Error(`Fouten in ${def.dir}:\n- ${problems.join("\n- ")}`);
}

/** Vult {{VARIABELEN}} in instructies en routinebeschrijvingen in. */
export function render(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (whole, key: string) => vars[key] ?? whole);
}
