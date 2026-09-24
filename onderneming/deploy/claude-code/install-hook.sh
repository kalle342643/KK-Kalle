#!/usr/bin/env bash
# Zet de HQ-hook in Claude Code, zodat het kantoor live ziet wat Claude Code doet (opdracht, web,
# code, tests, helpers, klaar), en installeert twee helpers (sub-agents): onderzoeker en reviewer.
# Werkt op je eigen computer en in een cloud-omgeving van Claude Code.
#
#   Lokaal:  bash install-hook.sh https://<server>.<tailnet>.ts.net/api/hooks/claude-code <HQ_HOOK_TOKEN>
#   Cloud:   zet HQ_HOOK_URL en HQ_HOOK_TOKEN als omgevingsvariabelen van de omgeving, en als setup-script:
#            curl -fsSL https://raw.githubusercontent.com/kalle342643/KK-Kalle/main/onderneming/deploy/claude-code/install-hook.sh | bash
#
# Idempotent: opnieuw draaien kan geen kwaad. Weghalen: verwijder de regels met hq-kantoor.mjs uit
# ~/.claude/settings.json.
set -euo pipefail

SCRIPT_URL="${HQ_HOOK_SCRIPT_URL:-https://raw.githubusercontent.com/kalle342643/KK-Kalle/main/onderneming/deploy/claude-code/hq-hook.mjs}"
here=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; fi

command -v node >/dev/null || { echo "Node.js ontbreekt (Claude Code heeft het ook nodig)." >&2; exit 1; }
mkdir -p "$HOME/.claude/hooks"
if [[ -n "$here" && -f "$here/hq-hook.mjs" ]]; then
  cp "$here/hq-hook.mjs" "$HOME/.claude/hooks/hq-kantoor.mjs"
else
  curl -fsSL "$SCRIPT_URL" -o "$HOME/.claude/hooks/hq-kantoor.mjs"
fi

# Twee helpers (sub-agents) voor Claude Code: een onderzoeker (zoekt iets uit op het web) en een reviewer
# (kijkt klaar werk na met frisse ogen). Een bestand dat je zelf aanpaste (zonder de regel "Geïnstalleerd
# door HQ") blijft staan. Overslaan: HQ_SKIP_AGENTS=1.
AGENTS_URL="${HQ_AGENTS_URL:-https://raw.githubusercontent.com/kalle342643/KK-Kalle/main/onderneming/deploy/claude-code/agents}"
if [[ "${HQ_SKIP_AGENTS:-}" != "1" ]]; then
  mkdir -p "$HOME/.claude/agents"
  for a in onderzoeker reviewer; do
    target="$HOME/.claude/agents/$a.md"
    if [[ -f "$target" ]] && ! grep -q "Geïnstalleerd door HQ" "$target"; then
      echo "ℹ️  $target heb je zelf aangepast; die laat ik staan."
      continue
    fi
    if [[ -n "$here" && -f "$here/agents/$a.md" ]]; then
      cp "$here/agents/$a.md" "$target"
    else
      curl -fsSL "$AGENTS_URL/$a.md" -o "$target.tmp" && mv "$target.tmp" "$target"
    fi
  done
fi

# Adres en geheim als argumenten: bewaren in ~/.config/hq/hook.json (alleen voor jou leesbaar).
# In de cloud komen ze uit de omgevingsvariabelen en schrijven we niets weg.
if [[ $# -ge 2 ]]; then
  mkdir -p "$HOME/.config/hq"
  (umask 077 && HQ_URL_ARG="$1" HQ_TOKEN_ARG="$2" node -e '
    const fs = require("fs");
    fs.writeFileSync(process.env.HOME + "/.config/hq/hook.json", JSON.stringify({ url: process.env.HQ_URL_ARG, token: process.env.HQ_TOKEN_ARG }) + "\n");
  ')
fi

# De hooks in ~/.claude/settings.json zetten, zonder bestaande instellingen aan te raken.
# ("$HOME" staat bewust letterlijk in het commando: de shell van Claude Code vult het later in.)
# shellcheck disable=SC2016
node -e '
  const fs = require("fs"), path = require("path"), os = require("os");
  const file = path.join(os.homedir(), ".claude", "settings.json");
  let s = {};
  try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  s.hooks = s.hooks || {};
  const command = "node \"$HOME/.claude/hooks/hq-kantoor.mjs\"";
  const events = {
    SessionStart: null,
    UserPromptSubmit: null,
    PreToolUse: "WebSearch|WebFetch|Bash|Edit|Write|MultiEdit|NotebookEdit|Skill|Agent|Task",
    SubagentStart: null,
    SubagentStop: null,
    Stop: null,
    SessionEnd: null,
  };
  for (const [event, matcher] of Object.entries(events)) {
    const groups = (s.hooks[event] = s.hooks[event] || []);
    const ours = groups.find((g) => (g.hooks || []).some((h) => h.command === command));
    if (ours) {
      // Al geïnstalleerd: alleen de lijst met tools bijwerken (nieuwe versies kijken naar meer tools).
      if (matcher) ours.matcher = matcher;
      continue;
    }
    groups.push({ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command, timeout: 5 }] });
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
'
echo "✅ HQ-hook staat klaar. Nieuwe Claude Code-sessies verschijnen nu live in de werkplaats, met hun helpers."
[[ "${HQ_SKIP_AGENTS:-}" == "1" ]] || echo "✅ Helpers 'onderzoeker' en 'reviewer' staan in ~/.claude/agents (Claude Code zet ze zelf in waar het past)."
