import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.js";
import { GRAPHIFY_GRAPH, graphPath } from "./graph.js";

/**
 * Graphify (https://pypi.org/project/graphifyy) draait als los programma. HQ gebruikt twee commando's:
 * - `graphify query` om de graaf te doorzoeken (lokaal, geen AI, een fractie van een seconde);
 * - `graphify extract` om de graaf op te bouwen uit de kennisbank (gebruikt een AI-model, dus 's nachts).
 */

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function run(bin: string, args: string[], opts: { timeoutMs: number; env?: NodeJS.ProcessEnv; cwd?: string }): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout: opts.timeoutMs, env: opts.env ?? process.env, cwd: opts.cwd, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout ?? ""), stderr: String(stderr ?? err?.message ?? "") }),
    );
  });
}

/** Doorzoekt de beste beschikbare graaf. Geeft null als Graphify of de graaf ontbreekt. */
export async function graphifyQuery(config: Config, question: string, budgetTokens = 1200): Promise<string | null> {
  const found = graphPath(config.knowledge.vaultDir);
  if (!found) return null;
  const res = await run(config.knowledge.graphifyBin, ["query", question, "--graph", found.path, "--budget", String(budgetTokens)], {
    timeoutMs: 20_000,
  });
  if (!res.ok) return null;
  const out = res.stdout.trim();
  // Graphify zet een uitleg over het budget bovenaan; die is voor agents niet nuttig.
  return out.replace(/^\[i\][^\n]*\n+/m, "").slice(0, 12_000) || null;
}

export function semanticExtractionEnabled(config: Config): boolean {
  return Boolean(config.knowledge.vaultDir && config.knowledge.graphifyApiKey);
}

/**
 * Bouwt de Graphify-graaf opnieuw op (alleen gewijzigde notities, Graphify houdt een cache bij).
 * Kost AI-tokens; daarom alleen met een eigen sleutel (GRAPHIFY_API_KEY) en een goedkoop model.
 */
export async function graphifyExtract(config: Config): Promise<{ ok: boolean; message: string }> {
  const k = config.knowledge;
  if (!k.vaultDir) return { ok: false, message: "HQ_VAULT_DIR is niet ingesteld" };
  if (!k.graphifyApiKey) return { ok: false, message: "GRAPHIFY_API_KEY is niet ingesteld (alleen de HQ-graaf wordt gebruikt)" };
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG };
  if (k.graphifyBackend === "claude") env.ANTHROPIC_API_KEY = k.graphifyApiKey;
  else env[`${k.graphifyBackend.toUpperCase()}_API_KEY`] = k.graphifyApiKey;
  const res = await run(
    k.graphifyBin,
    ["extract", k.vaultDir, "--backend", k.graphifyBackend, "--model", k.graphifyModel, "--max-concurrency", "2"],
    { timeoutMs: 30 * 60_000, env, cwd: k.vaultDir },
  );
  const tail = (res.stdout + res.stderr).trim().split("\n").slice(-3).join(" | ");
  if (!res.ok) return { ok: false, message: `graphify extract mislukte: ${tail.slice(0, 500)}` };
  const exists = existsSync(join(k.vaultDir, GRAPHIFY_GRAPH));
  return { ok: exists, message: exists ? tail.slice(0, 300) : "graphify gaf geen graph.json" };
}
