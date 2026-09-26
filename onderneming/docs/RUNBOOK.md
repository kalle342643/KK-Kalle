# Runbook: dagelijks gebruik en noodgevallen

## Je dag (±15 minuten)
- **Het kantoor** (`http://<servernaam>:8080/`): wie werkt waaraan (klik op een poppetje), papiertjes op jouw
  bureau = verzoeken, het projectenbord in de vergaderzaal, alle cijfers in de controlekamer van de HQ-bot.
  Links onder staat het logboek met alles wat er gebeurde.
- **08:00 dagrapport** in Telegram: omzet en kosten van gisteren, per tak, lopende experimenten, besluiten, en wat
  op je wacht.
- **Knoppen:** elk verzoek komt als bericht met ✅/❌. Twijfel je, laat het staan: niets gebeurt zonder jou.
  `/goedkeuringen` stuurt alles wat nog openstaat opnieuw.
- **De werkplaats** (🛠️ bovenin): per project of de site online is, of de tests groen zijn en wat er live staat.
  Bovenaan elk projectpaneel staat *Jouw beurt*: wat alleen jij kunt doen (KvK, domein, accounts, betalen). Dat is
  meestal wat tussen een project en de eerste omzet staat, dus begin daar.
- **Taak geven:** klik op een agent → *Taak geven*; of in de werkplaats een opdracht voor Claude Code.
- **Maandag:** het portfolio-voorstel (budget per tak) en het weekplan van CEO Atlas.
- **Woensdag:** de ideeënraad per tak; daar komen 1 à 2 experimentvoorstellen uit (niet als er al 2 lopen of wachten).
- **Maandag 7:00, de nut-meter:** agents die 30 dagen geld kostten zonder resultaat gaan op pauze; je krijgt een
  bericht. In het kantoor zitten ze er nog, zonder naam (alleen 💤). Toch nodig? Klik erop → ▶️ Hervatten, het
  liefst met een taak erbij; dan heeft hij weer twee weken. Liever zelf beslissen: `HQ_AUTO_PAUSE=uit` in hq.env.

## Cijfers invoeren
Agents kunnen omzet niet zelf boeken, dus die moet uit een betrouwbare bron komen:

| Bron | Hoe |
|---|---|
| Stripe | automatisch elk uur (als `STRIPE_API_KEY` is ingesteld) |
| CrazyGames, affiliate-dashboards | exporteer een CSV en importeer die in het kantoor (🔒 kluis → *CSV importeren*), of `hq import-csv` |
| Losse bedragen | in het kantoor: 🔒 kluis of een project → *💶 Omzet boeken*; of in Telegram `/omzet 12,50 games CrazyGames september` |
| Meetpunten (plays, aanmeldingen) | in het kantoor: project → *📏 Meting invoeren*; of `/meting EXP-3 plays 740`, bv. afgelezen uit het CrazyGames-dashboard |

Een meting of bedrag van jou telt als betrouwbaar; alleen daarmee kan een experiment slagen (een meting van een agent is
een signaal). Weet je het eerder dan de deadline? Project → *⚖️ Nu beslissen* (KEEP, ITERATE of KILL): de lead krijgt
de vervolgstap en de analist schrijft de lessen, net als bij een automatische beslissing.

CSV-kolommen: `date, amount_eur, branch, source` en optioneel `experiment_id, external_id, description`, of in het
Nederlands `datum, bedrag, tak, bron, experiment, id, omschrijving`. Komma of puntkomma als scheidingsteken; `12,50` en
`12.50` mogen allebei. Twee keer hetzelfde bestand importeren telt niets dubbel.

## Noodstop
**`/stop [reden]`** in Telegram (of de rode knop in je kantoor, of 🛑 Noodstop bovenin, of `hq halt`):
1. het bedrijf in Paperclip gaat op *paused* (geen nieuwe runs),
2. alle actieve agents worden gepauzeerd,
3. lopende runs worden afgebroken,
4. HQ weigert agent-acties met `423`.

**`/hervat`** zet alles terug. Alleen agents die door de noodstop gepauzeerd werden gaan weer aan; een agent die al
eerder door een budgetstop op pauze stond, blijft staan.

HQ zet zichzelf automatisch op noodstop als de AI-kosten van vandaag boven `HQ_DAILY_SPEND_ALARM_EUR` komen. Je krijgt
dan 🚨 in Telegram. Kijk in het dashboard (agents, kosten vandaag) en in de Paperclip-UI (runs) wat er gebeurde,
voordat je `/hervat` stuurt.

## Als er iets misgaat
| Symptoom | Doen |
|---|---|
| Bot reageert niet | `journalctl --user -u hq -n 100`; `systemctl --user restart hq`. Geen chat-id ingesteld? Dan antwoordt de bot alleen met je chat-id. |
| "Paperclip onbereikbaar" in `/status` | `paperclipai service status`, `paperclipai service logs -f`, `paperclipai doctor`. Agents staan dan ook stil. |
| Een agent doet rare dingen | pauzeer hem in de Paperclip-UI, of gebruik `/stop` als je niet weet welke het is. Lees zijn laatste run-log in Paperclip. |
| 🛑 "heeft zijn budget op" | Paperclip heeft hem al gepauzeerd. ✅ = budget +50% en hervatten, ⏸ = zo laten. |
| ⚠️ "Uitvoeren mislukte" | HQ probeert het elke twee minuten opnieuw. Blijft het mislukken, dan staat de fout in het dashboard en de logs. |
| ⚠️ "Taak '…' mislukt al 3 keer" | `journalctl --user -u hq` voor de fout; vaak is Paperclip of de database even weg. |
| Server kwijt | nieuwe VPS, `setup-vps.sh`, back-up terugzetten (zie hieronder), `hq bootstrap`. |
| Het kantoor blijft op "laden" of is leeg | ververs de pagina; staat WebGL uit in je browser, gebruik dan `/overzicht`. "Niet ingelogd": open `/?token=<HQ_ADMIN_TOKEN>` opnieuw. Geen poppetjes: `hq bootstrap`. |
| Grijze stip naast de bedrijfsnaam | de live verbinding met HQ is weg; het kantoor verbindt zelf opnieuw en haalt op wat het miste. Blijft hij grijs: `systemctl --user restart hq`. |
| Hologram in de kennisbank is leeg | er zijn nog geen lessen of notities. Nu opbouwen: `node --env-file=$HOME/.config/hq/hq.env dist/main.js kennis` (het `hq`-commando is voor agents). |
| 🔴 "… ligt eruit" | open het project in de werkplaats: de laatste controle zegt waarom (503 = vaak de database, bv. een gepauzeerd gratis Supabase-project; geen antwoord = de site zelf). Kijk in het dashboard van je host (Vercel, Supabase). Als het weer werkt krijg je vanzelf 🟢. |
| Werkplaats toont "geen toegang" of "token ongeldig" | het GitHub-token mist die repository of een recht (zie SETUP.md stap 11), of het is verlopen. Nieuw token in `hq.env`, `systemctl --user restart hq`. |
| Claude Code-sessie staat niet in de werkplaats | HQ ziet een sessie pas aan zijn eerste commit (of direct met de hook). Nog niets gepusht = nog niets te zien. |
| Agent zoekt niet op het web | `hq-web https://example.com` als gebruiker ai. "niet geïnstalleerd"? Draai `setup-vps.sh` opnieuw (kan geen kwaad). Een agent op gratis AI heeft geen WebSearch, alleen `hq-web` en `hq-trends`. |
| Gratis AI werkt niet | `systemctl --user status gratis-ai`; `dist/main.js gratis-ai test`. In het dashboard van OmniRoute (SETUP.md, *Gratis AI*) zie je per aanbieder of de sleutel werkt en wat er van de gratis laag over is. Nieuwe sleutel? In `gratis-ai.env` zetten en `dist/main.js gratis-ai --schrijf`. "Inloggen lukte niet": `OMNIROUTE_PASSWORD` in `gratis-ai.env` klopt niet meer met het dashboard. Tijdelijk terug naar Claude: `HQ_GRATIS_AI_ROLES=` leeg en `bootstrap`. |

## Back-ups
- HQ-database: elke nacht om 03:30 naar `~/backups/hq-JJJJ-MM-DD.sql.gz` (14 dagen bewaard).
  Kopieer er af en toe een naar je laptop: `scp ai@<servernaam>:backups/hq-*.sql.gz .`
- Paperclip maakt zelf elk uur back-ups van zijn eigen database.
- Terugzetten: `systemctl --user stop hq`, dan `gunzip -c hq-….sql.gz | psql "$DATABASE_URL"`, dan weer starten.
- Gebruik je Supabase, dan maakt Supabase de back-ups.

## Bijwerken
```bash
sudo -iu ai
~/KK-Kalle/onderneming/deploy/update.sh   # code, tests, database, bootstrap, herstart
paperclipai update                        # Paperclip
```

## Prompts en regels aanpassen
Alles wat agents "weten" staat in `onderneming/company/`:
- `agents/*.md`: CEO en analist
- `templates/agents/*.md`: rollen in een tak (verkenner, criticus, bouwer, publicist, schrijver, tak-lead; de pitcher is weg: de lead maakt de top 5).
  Elke rol heeft een `model`, een `effort` (verplicht bij Claude-modellen, niet bij Haiku) en een `maxPerBranch`
- `skills/*.md`: spelregels die agents delen (HQ-API, onderzoek op het web, kennisgraaf, experiment-protocol,
  productkwaliteit, geld en regels, ...)
- `templates/branches/*.yaml`: welke agents en routines een nieuwe tak krijgt

Pas aan, commit, en draai `update.sh`. Alleen wat echt veranderde wordt in Paperclip bijgewerkt. Een budget dat jij
in Paperclip verhoogde blijft staan.
