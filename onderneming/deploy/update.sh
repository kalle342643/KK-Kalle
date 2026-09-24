#!/usr/bin/env bash
# HQ bijwerken naar de nieuwste versie uit git en opnieuw starten. Draai als gebruiker 'ai'.
# Niets hoeft op stop: agents merken hooguit een paar seconden dat HQ weg is.
set -euo pipefail
env_file="${HQ_ENV_FILE:-$HOME/.config/hq/hq.env}"
cd "$HOME/KK-Kalle"
git pull --ff-only
cd onderneming/hq
npm ci
npm test
npm run build
chmod +x ../deploy/tools/*
node --env-file="$env_file" dist/main.js migrate
# Nieuwe of gewijzigde skills, agents en routines doorzetten naar Paperclip.
node --env-file="$env_file" dist/main.js bootstrap
systemctl --user restart hq
sleep 3
systemctl --user --no-pager status hq | head -n 5
