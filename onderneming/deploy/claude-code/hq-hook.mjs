#!/usr/bin/env node
// Claude Code-hook voor het kantoor van HQ: meldt wanneer Claude Code begint, een opdracht krijgt,
// het web op gaat, code aanpast of tests draait, en wanneer het klaar is. Zo zie je in de werkplaats
// live wat er gebeurt.
//
// Privacy: er gaat nooit bestandsinhoud, een volledig commando of een omgevingsvariabele mee. Alleen
// de soort stap en een korte omschrijving (zoekvraag, adres zonder query, bestandsnaam), met alles wat
// op een sleutel lijkt vervangen door •••. Het script wacht hooguit 2 seconden, print niets en eindigt
// altijd met 0: het kan Claude Code nooit ophouden of blokkeren.
//
// Instellen: HQ_HOOK_URL en HQ_HOOK_TOKEN als omgevingsvariabelen, of ~/.config/hq/hook.json met
// {"url": "...", "token": "..."}. Zie onderneming/docs/SETUP.md, "Claude Code live in het kantoor".
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const finish = () => process.exit(0);
setTimeout(finish, 2500).unref();

function config() {
  if (process.env.HQ_HOOK_URL && process.env.HQ_HOOK_TOKEN) return { url: process.env.HQ_HOOK_URL, token: process.env.HQ_HOOK_TOKEN };
  try {
    const c = JSON.parse(readFileSync(join(homedir(), ".config", "hq", "hook.json"), "utf8"));
    if (c.url && c.token) return c;
  } catch {
    // geen configuratie: niets doen
  }
  return null;
}

// Sleutels, tokens en lange willekeurige reeksen worden •••.
const SECRET =
  /(sk-[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Za-z0-9+/_=-]{32,})/g;
export const scrub = (s, n) =>
  String(s ?? "")
    .replace(SECRET, "•••")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);

export function shortUrl(raw) {
  try {
    const u = new URL(raw);
    return scrub(`${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`, 90);
  } catch {
    return scrub(raw, 90);
  }
}

const firstArg = (s) => {
  const m = String(s).match(/^\s*(?:"([^"]*)"|'([^']*)'|(\S+))/);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
};

/** Welke stap is dit? Alleen wat in het kantoor iets zegt; de rest (lezen, zoeken in code) blijft stil. */
export function classify(tool, input = {}) {
  switch (tool) {
    case "WebSearch":
      return input.query ? { kind: "search", detail: scrub(input.query, 90) } : null;
    case "WebFetch":
      return input.url ? { kind: "fetch", detail: shortUrl(input.url) } : null;
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "NotebookEdit": {
      const file = input.file_path ?? input.notebook_path;
      return file ? { kind: "code", detail: scrub(basename(String(file)), 80) } : null;
    }
    case "Skill": {
      const skill = input.skill ?? input.name ?? input.command;
      return skill ? { kind: "skill", detail: scrub(skill, 60) } : null;
    }
    case "Bash": {
      const cmd = String(input.command ?? "");
      let m;
      if ((m = cmd.match(/\bhq-web\s+(.+)/))) return { kind: "crawl", detail: shortUrl(firstArg(m[1])) };
      if ((m = cmd.match(/\bhq-trends\s+(.+)/))) return { kind: "trends", detail: scrub(firstArg(m[1]), 60) };
      if ((m = cmd.match(/\b(?:hq-graaf|graphify)\s+(\w+)/))) return { kind: "graph", detail: scrub(m[1], 30) };
      if ((m = cmd.match(/\b((?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\S*|npx\s+(?:vitest|jest|playwright\s+test)|vitest|jest|pytest|go\s+test|cargo\s+test)\b/)))
        return { kind: "test", detail: scrub(m[1], 40) };
      if ((m = cmd.match(/\bgit\s+(commit|push)\b/))) return { kind: "git", detail: m[1] };
      return null;
    }
    default:
      return null;
  }
}

function git(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { timeout: 800, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** eigenaar/naam uit de git-remote (https, ssh of een proxy-adres dat op /eigenaar/naam eindigt). */
export function repoFromRemote(remote) {
  if (!remote) return null;
  const m = String(remote).replace(/\.git$/, "").match(/[:/]([\w.-]+)\/([\w.-]+)\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

async function main() {
  const cfg = config();
  if (!cfg) finish();
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const h = JSON.parse(raw || "{}");
  const event = h.hook_event_name;
  const cwd = h.cwd || process.cwd();
  const payload = {
    event,
    sessionId: String(h.session_id ?? "onbekend").replace(/[^\w.-]/g, "").slice(0, 100) || "onbekend",
    repo: repoFromRemote(git(cwd, ["remote", "get-url", "origin"])),
    branch: git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    where: process.env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE || process.env.CLAUDE_CODE_REMOTE ? "cloud" : "local",
  };
  if (event === "UserPromptSubmit") {
    payload.prompt = scrub(h.prompt, 200);
    if (!payload.prompt) finish();
  } else if (event === "PreToolUse" || event === "PostToolUse") {
    const step = classify(h.tool_name, h.tool_input ?? {});
    if (!step) finish();
    Object.assign(payload, step);
  } else if (!["SessionStart", "Stop", "SessionEnd"].includes(event)) {
    finish();
  }
  await fetch(cfg.url, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(2000),
  }).catch(() => undefined);
  finish();
}

// Alleen uitvoeren als script, niet bij importeren (tests).
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch(finish);
