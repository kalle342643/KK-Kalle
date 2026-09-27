#!/usr/bin/env bash
# Zet de hook voor Claude Code in de cloud (claude.ai/code) in één keer klaar. Op de server, met sudo:
#   sudo bash /home/ai/KK-Kalle/onderneming/deploy/claude-code/cloud-hook.sh
#
# 1. Zet via Tailscale Funnel precies één adres open: /api/hooks. Daar kan alleen iemand met het geheim meldingen
#    sturen; het kantoor zelf blijft alleen via Tailscale bereikbaar.
# 2. Test dat adres met het geheim uit hq.env.
# 3. Laat zien wat je in je cloud-omgeving plakt (omgevingsvariabelen, domein, setup-script).
#    Staat HQ_PLAN_TOKEN in hq.env, dan ook HQ_URL en HQ_PLAN_TOKEN: daarmee geeft de hoofdagent plannen aan Atlas.
set -euo pipefail

AI_USER="${AI_USER:-ai}"
ENV_FILE="${HQ_ENV:-/home/$AI_USER/.config/hq/hq.env}"

fail() {
  echo "✖ $*" >&2
  exit 1
}
value() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '"' || true; }

[[ -r "$ENV_FILE" ]] || fail "Kan $ENV_FILE niet lezen. Draai dit met sudo, of zet HQ_ENV=<pad naar hq.env>."
token="$(value HQ_HOOK_TOKEN)"
plan_token="$(value HQ_PLAN_TOKEN)"
port="$(value HQ_PORT)"
port="${port:-8080}"
[[ -n "$token" ]] || fail "HQ_HOOK_TOKEN is leeg in $ENV_FILE. Vul een geheim in (openssl rand -hex 24) en herstart HQ."
command -v tailscale >/dev/null || fail "Tailscale ontbreekt. Draai eerst setup-vps.sh en daarna: tailscale up"

host="$(tailscale status --json 2>/dev/null | python3 -c 'import json, sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' 2>/dev/null || true)"
[[ -n "$host" ]] || fail "Tailscale is nog niet gekoppeld. Draai eerst: tailscale up"

echo "→ Funnel aan voor alleen /api/hooks. Staat Funnel nog uit in je tailnet, dan toont Tailscale een link om het aan te zetten."
tailscale funnel --bg --set-path /api/hooks "http://127.0.0.1:${port}/api/hooks"

url="https://${host}/api/hooks/claude-code"
echo "→ Testen: $url"
if curl -fsS --max-time 15 -X POST "$url" -H "Authorization: Bearer $token" -H "content-type: application/json" \
  -d '{"event":"ping","sessionId":"test"}' >/dev/null; then
  echo "✔ HQ antwoordt via Funnel."
else
  echo "⚠️  Nog geen antwoord. Draait HQ (als $AI_USER: systemctl --user status hq)? Funnel kan ook een minuut nodig hebben."
fi

plan_lines=""
if [[ -n "$plan_token" ]]; then
  plan_lines="
     HQ_URL=https://${host}
     HQ_PLAN_TOKEN=${plan_token}"
fi

cat <<EOF

Plak dit in je cloud-omgeving (claude.ai/code → de omgeving in de titelbalk van een sessie → Edit):

1. Omgevingsvariabelen:
     HQ_HOOK_URL=$url
     HQ_HOOK_TOKEN=$token${plan_lines}
2. Network access → toegestane domeinen:
     $host
3. Setup-script:
     curl -fsSL https://raw.githubusercontent.com/kalle342643/KK-Kalle/main/onderneming/deploy/claude-code/install-hook.sh | bash

Nieuwe cloud-sessies melden zich daarna live in het kantoor.
EOF
if [[ -z "$plan_token" ]]; then
  echo "Tip: zet ook HQ_PLAN_TOKEN (openssl rand -hex 24) in hq.env, herstart HQ en draai dit opnieuw. Dan kan de hoofdagent plannen aan Atlas geven."
fi
