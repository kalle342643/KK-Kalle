# Installatie, stap voor stap

Reken op 1 à 2 uur. Na afloop draait alles 24/7 op een server (gratis, of ~€7 per maand), ook als je laptop uit
staat. Je bedient het vanuit het **3D-kantoor** en Telegram, die alleen jij kunt openen (via Tailscale).

## 0. Wat je nodig hebt

| Wat | Waarvoor | Kosten |
|---|---|---|
| Een server met Ubuntu 24.04 (zie stap 1) | alles draait hierop | gratis (Oracle of pc thuis) of ~€7 per maand (Hetzner) |
| [Anthropic Console](https://console.anthropic.com)-account | API-sleutel voor de agents, met een **bestedingslimiet** | alleen wat agents gebruiken |
| [Tailscale](https://tailscale.com)-account (gratis) + app op je telefoon | privé-toegang tot Paperclip en het dashboard | gratis |
| Telegram | meldingen en goedkeurknoppen | gratis |
| Optioneel: [Supabase](https://supabase.com), Stripe, Meta WhatsApp Business | database buiten de server, omzet-import, WhatsApp-meldingen | gratis tot klein |

> **Zet eerst een limiet** in de Anthropic Console (Settings → Limits → monthly spend limit, bv. $40).
> Dat is je laatste vangnet als alle andere plafonds zouden falen.

## 1. Een server kiezen
Alle drie werken met hetzelfde installatiescript. Heb je nog geen SSH-sleutel: `ssh-keygen -t ed25519` op je
laptop; bij het aanmaken van de server plak je de inhoud van `~/.ssh/id_ed25519.pub`.

**A. Gratis: Oracle Cloud "Always Free".** Een ARM-server (Ampere A1) met tot 4 cores en 24 GB geheugen, gratis
zolang je binnen de Always Free-grenzen blijft. Ruim genoeg voor dit alles.
1. Maak zelf een account op [oracle.com/cloud/free](https://www.oracle.com/cloud/free/). Oracle vraagt een
   betaalkaart om te controleren dat je een echt persoon bent; dat doe je zelf, HQ vraagt nooit om betaalgegevens.
   Kies als thuisregio Amsterdam of Frankfurt (later wijzigen kan niet).
2. *Compute → Instances → Create instance*: image **Canonical Ubuntu 24.04**, shape **VM.Standard.A1.Flex**
   (bv. 2 OCPU en 12 GB), je SSH-sleutel, *Create*.
3. Inloggen: `ssh ubuntu@<ip>`, daarna `sudo -i` en verder met stap 2.

Let op: in drukke regio's is gratis ARM-capaciteit vaak even op (*Out of capacity*); probeer een ander
*availability domain* of later opnieuw. En Oracle kan gratis servers terugnemen die een week vrijwel niets doen.
Zet je account om naar *Pay As You Go* om dat te voorkomen: binnen de Always Free-grenzen betaal je dan nog steeds
niets. Kijk de actuele voorwaarden na; die veranderen weleens.

**B. Gratis: een computer thuis.** Een oude laptop of mini-pc met Ubuntu 24.04 (of een Raspberry Pi 5 met 8 GB,
eenmalig ±€90). Die moet dag en nacht aanstaan (stroom ±€2–5 per maand). Tailscale werkt precies hetzelfde: je
telefoon bereikt het kantoor overal. Valt thuis de stroom of het internet uit, dan staat alles stil (veilig, er
gebeurt dan gewoon niets).

**C. Het makkelijkst: Hetzner (~€7 per maand).** Hetzner Cloud → *Add Server*: locatie Falkenstein of Nuremberg,
image **Ubuntu 24.04**, type **CX33** (4 vCPU, 8 GB), je SSH-sleutel. Log in met `ssh root@<ip>`.

Andere gratis lagen (Render, Railway, Fly, Google e2-micro) zijn niet geschikt: de server slaapt als niemand hem
gebruikt, of heeft te weinig geheugen voor Paperclip, de database en de agent-runs samen.

## 2. Installatiescript draaien
Het script zet alles klaar: firewall (alleen SSH en Tailscale), een gebruiker `ai`, Node 24, PostgreSQL,
Tailscale, Claude Code, Paperclip en HQ.

```bash
# Op de server, als root:
export REPO_URL=https://github.com/kalle342643/KK-Kalle.git
export REPO_BRANCH=main        # zolang de PR nog niet gemerged is: claude/autonome-ai-onderneming-bkikqw
git clone --branch "$REPO_BRANCH" "$REPO_URL" /root/KK-Kalle
bash /root/KK-Kalle/onderneming/deploy/setup-vps.sh
```

**Is je repository privé?** Maak op GitHub een *fine-grained token* met alleen **Contents: Read-only** op
deze ene repository, en gebruik `export REPO_URL=https://x-access-token:<TOKEN>@github.com/kalle342643/KK-Kalle.git`.
Het token komt in `~/KK-Kalle/.git/config` van de gebruiker `ai` te staan (alleen die kan het lezen).

## 3. Tailscale koppelen
```bash
tailscale up           # opent een inloglink; log in met je Tailscale-account
tailscale status       # de server heet nu bv. 'ubuntu-4gb-fsn1-1'
```
Installeer de Tailscale-app op je telefoon en log in met hetzelfde account. Vanaf nu bereik je de server
via `http://<servernaam>:3100` (Paperclip) en `http://<servernaam>:8080` (HQ), en anders niet.

## 4. Paperclip inrichten
```bash
sudo -iu ai
paperclipai onboard
```
Kies in de wizard:
- deployment: **authenticated**, exposure **private**;
- bereikbaarheid (*bind*): **tailnet**.

De wizard laat zien hoe je het eerste (eigenaars)account aanmaakt of het board claimt. Open die link op je
telefoon of laptop via Tailscale en maak je account.

Start Paperclip daarna als service (blijft draaien na een herstart):
```bash
paperclipai service install --enable-linger
paperclipai doctor
```

**Claude-toegang voor de agents.** Voeg in de Paperclip-UI bij je profiel een AI-verbinding voor Claude toe:
- **API-sleutel** (aanbevolen): maak in de Anthropic Console een aparte sleutel voor deze server, met de
  limiet uit stap 0;
- of je **Claude-abonnement** (Paperclip heeft daar een login-flow voor). Het beleid rond abonnementen en
  automatisch gebruik is in 2026 een paar keer veranderd; houd een API-sleutel achter de hand.

## 5. Board-sleutel voor HQ
HQ praat met Paperclip namens jou (als "board"). Maak daarvoor een sleutel:
```bash
paperclipai token board create --name hq --never-expires
```
Vraagt de CLI om in te loggen? Draai dan eerst `paperclipai connect`. Bewaar de sleutel voor stap 7.

## 6. Telegram-bot maken
1. Open Telegram, zoek **@BotFather**, stuur `/newbot`, kies een naam. Je krijgt een token.
2. Dat token komt in stap 7 in `TELEGRAM_BOT_TOKEN`. Je chat-id vul je pas in stap 8 in.

## 7. HQ instellen
```bash
nano ~/.config/hq/hq.env
```
Vul minimaal in:
- `PAPERCLIP_API_URL=` het adres dat `paperclipai onboard` liet zien, met `/api` erachter, bv.
  `http://<servernaam>:3100/api` (met *bind tailnet* luistert Paperclip op het Tailscale-adres, niet op 127.0.0.1);
- `PAPERCLIP_BOARD_TOKEN=` de sleutel uit stap 5;
- `TELEGRAM_BOT_TOKEN=` het token uit stap 6;
- controleer de geldregels (`HQ_GLOBAL_MONTHLY_CAP_EUR`, `HQ_DAILY_SPEND_ALARM_EUR`, ...).

`HQ_ADMIN_TOKEN` is al willekeurig ingevuld door het script: daarmee log je in op het dashboard.
`DATABASE_URL` wijst naar de lokale database. Liever Supabase? Zie *Optioneel* onderaan.

## 8. Controleren en starten
```bash
cd ~/KK-Kalle/onderneming/hq
node --env-file=$HOME/.config/hq/hq.env dist/main.js check      # alles ✔ behalve je chat-id
# Paperclip weigert de hostnaam? Sta hem toe: paperclipai allowed-hostname <servernaam>
node --env-file=$HOME/.config/hq/hq.env dist/main.js bootstrap  # holding, CEO Atlas, analist Argus, skills, routines
systemctl --user enable --now hq hq-backup.timer
```
Stuur nu `/start` naar je bot. Hij antwoordt met je **chat-id**. Zet die in `TELEGRAM_OWNER_CHAT_ID` en herstart:
```bash
systemctl --user restart hq
journalctl --user -u hq -f        # logs bekijken (Ctrl+C om te stoppen)
```
Stuur `/status` naar je bot: je hoort *🟢 Alles draait* terug.

## 9. Eerste tak en eerste ronde
De holding heeft nu een CEO en een analist, maar nog geen takken. Twee manieren:
- **Zelf** (snel): `node --env-file=$HOME/.config/hq/hq.env dist/main.js branch games games "Games-studio"`
  maakt de games-tak met 7 agents en de routines *Weekstart* (maandag) en *Ideeënraad* (woensdag).
- **Via de CEO**: wacht op de maandelijkse kansenverkenning, of geef Atlas in Paperclip een taak
  ("Stel een eerste tak voor op basis van ..."). Zijn voorstel komt als Telegram-bericht met knoppen.

Wil je niet tot woensdag wachten? Start de routine *Ideeënraad Games-studio* met de hand in de Paperclip-UI.

## 10. Testen of alles werkt
- [ ] `/status` in Telegram geeft een overzicht
- [ ] **Het kantoor:** open `http://<servernaam>:8080/?token=<HQ_ADMIN_TOKEN>` op je telefoon of laptop (via
  Tailscale). Daarna onthoudt je browser het 30 dagen. Je ziet je agents als poppetjes; klik op een poppetje om het
  een naam te geven en te zien waar het aan werkt. Alles in lijsten staat op `/overzicht`
- [ ] Zet het beginscherm-icoon: in Safari/Chrome *Delen → Zet op beginscherm*, dan opent het kantoor als app
- [ ] `/stop test` → alle agents staan in Paperclip op gepauzeerd; `/hervat` → weer aan
- [ ] Om 08:00 komt het dagrapport binnen

## Optioneel
**Kennisbank en Graphify (aanbevolen).** Het script installeerde Graphify al (`pipx install graphifyy`). HQ schrijft
elk uur alle lessen, notities en experimenten als notities in `~/vault`. Wil je dat Graphify daar 's nachts een
echte kennisgraaf van maakt (het hologram in de kennisbank), maak dan in de Anthropic Console een **aparte**
API-sleutel met een eigen lage limiet (bv. $5 per maand) en zet die als `GRAPHIFY_API_KEY` in `hq.env`. Zonder
sleutel maakt HQ zelf een eenvoudigere graaf. Nu meteen bouwen: `node --env-file=$HOME/.config/hq/hq.env dist/main.js kennis`.
De map in Obsidian bekijken: kopieer hem naar je laptop (`scp -r ai@<servernaam>:vault .`) en open hem als vault.

**Supabase in plaats van de lokale database.** Voordeel: je geld- en experimentdata staan los van de server,
met back-ups en een tabelweergave. Maak een project, kopieer onder *Connect* de **Session pooler**-URL en zet
die als `DATABASE_URL`. HQ maakt de tabellen zelf aan bij het starten.

**Stripe.** Maak een *restricted key* met alleen leesrechten op Charges, zet `STRIPE_API_KEY` en
`STRIPE_DEFAULT_BRANCH`. Geef betalingen metadata `branch` (en eventueel `experiment_id`), dan boekt HQ de
omzet op de juiste tak. Elk uur wordt geïmporteerd.

**WhatsApp-meldingen.** Alleen eenrichting: beslissen blijft in Telegram of het dashboard. Je hebt een
geverifieerd Meta Business-account nodig, plus een telefoonnummer in de WhatsApp Cloud API en een
goedgekeurd sjabloon met één variabele (`{{1}}`). Meta rekent per sjabloonbericht. Vul de `WHATSAPP_*`-regels
in `hq.env` in.

## Bijwerken
```bash
sudo -iu ai
~/KK-Kalle/onderneming/deploy/update.sh      # git pull, tests, build, migratie, bootstrap, herstart
paperclipai update                           # Paperclip zelf bijwerken
```
