#!/usr/bin/env bash
# Eenmalige inrichting van een verse Ubuntu 24.04-VPS (bv. Hetzner CX33) voor de AI-onderneming.
# Draai als root:   curl -fsSL <raw-url>/onderneming/deploy/setup-vps.sh | bash
#            of:    bash setup-vps.sh
# Het script is idempotent: opnieuw draaien kan geen kwaad.
#
# Wat het doet:
#   1. systeemupdates, firewall (alleen SSH + Tailscale), automatische beveiligingsupdates
#   2. gebruiker 'ai' die alles draait (niet als root)
#   3. Node.js 24, PostgreSQL (database voor HQ), Tailscale, Claude Code CLI, Paperclip
#   4. HQ bouwen uit deze repository en als service klaarzetten
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
apt-get install -y ca-certificates curl git gnupg ufw unattended-upgrades postgresql jq
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
AS_AI

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
chmod +x ../deploy/backup.sh ../deploy/update.sh
AS_AI

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
NEXT
