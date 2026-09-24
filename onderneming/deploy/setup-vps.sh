#!/usr/bin/env bash
# Eenmalige inrichting van een verse Ubuntu 24.04-server voor de AI-onderneming: een VPS (bv. Hetzner CX33),
# een gratis Oracle Cloud-server (ARM) of een eigen computer thuis. Werkt op x86-64 en ARM64.
# Draai als root:   curl -fsSL <raw-url>/onderneming/deploy/setup-vps.sh | bash
#            of:    bash setup-vps.sh
# Het script is idempotent: opnieuw draaien kan geen kwaad.
#
# Wat het doet:
#   1. systeemupdates, firewall (alleen SSH + Tailscale), automatische beveiligingsupdates
#   2. gebruiker 'ai' die alles draait (niet als root)
#   3. Node.js 24, PostgreSQL (database voor HQ), Tailscale, Claude Code CLI, Paperclip, Graphify
#   4. webgereedschap voor de agents: Crawl4AI (pagina's lezen), last30days (trends), hq-commando's
#   5. HQ (met het 3D-kantoor) bouwen uit deze repository en als service klaarzetten
# Wat je daarna zelf doet staat in onderneming/docs/SETUP.md (stap 4 en verder).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/kalle342643/KK-Kalle.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
AI_USER="${AI_USER:-ai}"
NODE_MAJOR=24

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Draai dit script als root (sudo bash setup-vps.sh)." >&2
  exit 1
fi

log "Systeem bijwerken"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl git gnupg ufw unattended-upgrades postgresql jq pipx
dpkg-reconfigure -f noninteractive unattended-upgrades

log "Firewall: alleen SSH en Tailscale"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow in on tailscale0
ufw --force enable

log "Gebruiker '$AI_USER'"
if ! id "$AI_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$AI_USER"
fi
# Services van deze gebruiker blijven draaien zonder dat iemand ingelogd is.
loginctl enable-linger "$AI_USER"

log "Node.js $NODE_MAJOR"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt $NODE_MAJOR ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
node --version

log "Tailscale"
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

log "PostgreSQL-database 'hq' (inloggen via de Unix-socket, geen wachtwoord nodig)"
sudo -u postgres psql -tc "select 1 from pg_roles where rolname = '$AI_USER'" | grep -q 1 \
  || sudo -u postgres createuser "$AI_USER"
sudo -u postgres psql -tc "select 1 from pg_database where datname = 'hq'" | grep -q 1 \
  || sudo -u postgres createdb -O "$AI_USER" hq

log "Claude Code CLI en Paperclip voor '$AI_USER'"
sudo -iu "$AI_USER" bash <<'AS_AI'
set -euo pipefail
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
grep -q 'npm-global/bin' ~/.profile || echo 'export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"' >> ~/.profile
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"
npm install -g @anthropic-ai/claude-code
if ! command -v paperclipai >/dev/null; then
  curl -fsSL https://paperclip.ing/install.sh | bash -s -- --no-prompt --no-onboard
fi
# Graphify maakt van de kennisbank een graaf (de hologram-kamer in het kantoor).
if ! command -v graphify >/dev/null; then
  pipx install graphifyy
fi
mkdir -p ~/vault
# ...en is voor elke agent beschikbaar als Claude Code-skill (/graphify), bv. om code te doorgronden.
graphify install --platform claude >/dev/null
# Crawl4AI: webpagina's lezen met een echte (headless) browser. Agents gebruiken het via `hq-web`.
if ! command -v crwl >/dev/null; then
  pipx install crawl4ai
fi
# last30days: wat speelt er de afgelopen 30 dagen (via `hq-trends`, alleen bronnen met een open API).
# Vaste versie: bij een update eerst nakijken of de bronnen nog binnen de regels blijven.
if [[ ! -d ~/tools/last30days/.git ]]; then
  git clone --quiet --depth 1 --branch v3.25.0 https://github.com/mvanhorn/last30days-skill ~/tools/last30days
fi
AS_AI

log "Browser voor Crawl4AI"
C4AI_PY="/home/$AI_USER/.local/share/pipx/venvs/crawl4ai/bin/python"
# Systeembibliotheken moeten als root; de browser zelf komt in de map van '$AI_USER'.
"$C4AI_PY" -m playwright install-deps chromium
sudo -iu "$AI_USER" "$C4AI_PY" -m playwright install --only-shell chromium

log "HQ ophalen en bouwen"
sudo -iu "$AI_USER" env REPO_URL="$REPO_URL" REPO_BRANCH="$REPO_BRANCH" bash <<'AS_AI'
set -euo pipefail
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"
if [[ ! -d ~/KK-Kalle/.git ]]; then
  git clone --branch "$REPO_BRANCH" "$REPO_URL" ~/KK-Kalle
else
  git -C ~/KK-Kalle pull --ff-only
fi
cd ~/KK-Kalle/onderneming/hq
npm ci
npm run build
mkdir -p ~/.config/hq ~/.config/systemd/user ~/backups
if [[ ! -f ~/.config/hq/hq.env ]]; then
  cp ../deploy/hq.env.example ~/.config/hq/hq.env
  chmod 600 ~/.config/hq/hq.env
  # Willekeurige geheimen alvast invullen.
  sed -i "s|^HQ_ADMIN_TOKEN=.*|HQ_ADMIN_TOKEN=$(openssl rand -hex 24)|" ~/.config/hq/hq.env
fi
cp ../deploy/hq.service ~/.config/systemd/user/hq.service
cp ../deploy/hq-backup.service ../deploy/hq-backup.timer ~/.config/systemd/user/
chmod +x ../deploy/backup.sh ../deploy/update.sh ../deploy/tools/*
AS_AI

log "Commando's voor de agents"
# Paperclip start agents met een kaal PATH (zonder ~/.local/bin en ~/.npm-global/bin). Daarom komen de
# commando's die agents nodig hebben in /usr/local/bin. De hq-commando's wijzen naar de repository,
# zodat update.sh ze vanzelf bijwerkt.
for tool in hq hq-web hq-trends hq-graaf; do
  ln -sfn "/home/$AI_USER/KK-Kalle/onderneming/deploy/tools/$tool" "/usr/local/bin/$tool"
done
for bin in "/home/$AI_USER/.npm-global/bin/claude" "/home/$AI_USER/.local/bin/graphify" "/home/$AI_USER/.local/bin/crwl"; do
  if [[ -e "$bin" ]]; then ln -sfn "$bin" "/usr/local/bin/$(basename "$bin")"; fi
done

cat <<'NEXT'

✅ Basis staat. Volgende stappen (zie onderneming/docs/SETUP.md, vanaf stap 4):

  1. Tailscale koppelen:          tailscale up          (log in met je Tailscale-account)
  2. Wissel naar de ai-gebruiker: sudo -iu ai
  3. Paperclip inrichten:         paperclipai onboard   (kies 'authenticated' + 'private', bind 'tailnet')
     Anthropic-sleutel instellen: paperclipai configure --section llm
     Als service starten:         paperclipai service install --enable-linger
  4. HQ-config invullen:          nano ~/.config/hq/hq.env
  5. Controleren en opstarten:    cd ~/KK-Kalle/onderneming/hq
                                  node --env-file=$HOME/.config/hq/hq.env dist/main.js check
                                  node --env-file=$HOME/.config/hq/hq.env dist/main.js bootstrap
                                  systemctl --user enable --now hq hq-backup.timer
  6. Het kantoor openen:          http://<servernaam>:8080/?token=<HQ_ADMIN_TOKEN>   (via Tailscale)
NEXT
