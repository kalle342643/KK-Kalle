# Runbook: dagelijks gebruik en noodgevallen

## Je dag (±15 minuten)
- **08:00 dagrapport** in Telegram: omzet en kosten van gisteren, per tak, lopende experimenten, besluiten, en wat
  op je wacht.
- **Knoppen:** elk verzoek komt als bericht met ✅/❌. Twijfel je, laat het staan: niets gebeurt zonder jou.
  `/goedkeuringen` stuurt alles wat nog openstaat opnieuw.
- **Maandag:** het portfolio-voorstel (budget per tak) en het weekplan van CEO Atlas.
- **Woensdag:** de ideeënraad per tak; daar komen 1 à 2 experimentvoorstellen uit.

## Cijfers invoeren
Agents kunnen omzet niet zelf boeken, dus die moet uit een betrouwbare bron komen:

| Bron | Hoe |
|---|---|
| Stripe | automatisch elk uur (als `STRIPE_API_KEY` is ingesteld) |
| CrazyGames, affiliate-dashboards | exporteer een CSV en upload die in het dashboard (*Grootboek → Omzet importeren*) of `hq import-csv` |
| Losse bedragen | `/omzet 12,50 games CrazyGames september` |
| Meetpunten (plays, aanmeldingen) | `/meting EXP-3 plays 740`, bv. afgelezen uit het CrazyGames-dashboard |

CSV-kolommen: `date, amount_eur, branch, source` en optioneel `experiment_id, external_id, description`.
Komma of puntkomma als scheidingsteken; `12,50` en `12.50` mogen allebei. Twee keer hetzelfde bestand
importeren telt niets dubbel.

## Noodstop
**`/stop [reden]`** in Telegram (of de rode knop in het dashboard, of `hq halt`):
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
- `templates/agents/*.md`: rollen in een tak (verkenner, pitcher, criticus, bouwer, ...)
- `skills/*.md`: spelregels die agents delen (HQ-API, experiment-protocol, geld en regels, ...)
- `templates/branches/*.yaml`: welke agents en routines een nieuwe tak krijgt

Pas aan, commit, en draai `update.sh`. Alleen wat echt veranderde wordt in Paperclip bijgewerkt. Een budget dat jij
in Paperclip verhoogde blijft staan.
