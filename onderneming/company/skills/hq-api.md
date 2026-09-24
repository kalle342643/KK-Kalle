---
name: hq-api
description: Hoe je met HQ praat (kennisbank, experimenten, metingen, geldverzoeken, lessen, aannames). Gebruik dit voor alles wat met kennis, geld of experimenten te maken heeft.
tagline: De HQ-API van de holding
---

# HQ-API

HQ is het financiële en juridische geweten van de holding. Alles wat geld kost, geld oplevert of gemeten
moet worden, loopt via HQ. HQ controleert harde regels en legt verzoeken voor aan de eigenaar (Kalle).

- **Adres:** `$HQ_URL` (staat in je omgeving).
- **Inloggen:** je eigen Paperclip-token: `Authorization: Bearer $PAPERCLIP_API_KEY`.
- **Antwoorden:** JSON. Fouten hebben een `error`-veld in het Nederlands; lees het en pas je aan.

```bash
hq() { curl -sS -X "$1" "$HQ_URL/api/agent$2" -H "Authorization: Bearer $PAPERCLIP_API_KEY" -H 'content-type: application/json' ${3:+-d "$3"}; }
hq GET /overview
```

## Eerst: de kennisbank
Wil je iets weten? Vraag het **eerst** aan de kennisbank, voordat je het opnieuw uitzoekt. Daar staat alles wat
collega's al leerden: lessen, notities, experimenten en de verbanden ertussen (een Graphify-kennisgraaf).
```bash
hq GET "/knowledge?q=retentie+van+puzzelgames+op+mobiel"
```
Je krijgt `lessons`, `notes` en `graph` (knopen en verbanden rond je vraag). Zoek je iets uit wat anderen ook
kunnen gebruiken? Schrijf het op als notitie (kort, feitelijk, met bron):
```bash
hq POST /notes '{"title": "Concurrent X op CrazyGames", "body": "40 levels, daily challenge, 1,2M plays. Bron: https://...", "tags": ["concurrentie", "puzzel"], "branch": "games"}'
```
Maximaal 20 notities per dag; liever één goede notitie dan vijf halve.

## Lezen
| Wat | Aanroep |
|---|---|
| Kennisbank doorzoeken (lessen, notities, kennisgraaf) | `GET /knowledge?q=...` |
| Notities zoeken | `GET /notes?q=...&tag=...` |
| Overzicht: takken, vrij budget, lopende experimenten, recente lessen, regels | `GET /overview` |
| Geld per tak (30 dagen), ROI, voorstel budgetverdeling | `GET /portfolio` |
| Experimenten (filter `status=running`, `branch=games`) | `GET /experiments?status=running` |
| Eén experiment met metingen en uitgaven | `GET /experiments/12` |
| Lessen zoeken (eerst doen vóór je iets nieuws voorstelt!) | `GET /lessons?q=crazygames&branch=games` |
| Sjablonen voor agents en takken | `GET /templates` |

## Doen
**Experiment voorstellen** (vraagt goedkeuring aan Kalle):
```bash
hq POST /experiments '{
  "branch": "games",
  "title": "Fluxgrid: routing-puzzel met kleurmenging",
  "hypothesis": "Een puzzel waarin stromen mengen onderscheidt zich op CrazyGames en haalt genoeg plays.",
  "metric": {"name": "plays", "target": 500},
  "budgetEur": 20,
  "durationDays": 14,
  "prediction": "700 plays in 14 dagen, 3 min gemiddelde speeltijd",
  "evidence": ["https://www.crazygames.com/t/traffic", "https://www.reddit.com/r/WebGames/..."],
  "plan": "Dag 1-3 prototype, dag 4 publicatiepakket, dag 5-14 meten."
}'
```
- `evidence`: minstens één link naar een echte bron. Een redenering is geen bewijs.
- `metric.name`: kleine letters, bv. `plays`, `signups`, `clicks`, `revenue_eur` (omzet uit het grootboek).
- Vervolg op een ITERATE-uitkomst? Voeg `"parentId": <id>` toe.

**Meting doorgeven** (telt als signaal, niet als bewijs; betrouwbare cijfers komen uit imports):
```bash
hq POST /experiments/12/metrics '{"name": "plays", "value": 340, "note": "CrazyGames-dashboard, 23 sep"}'
```

**Extra budget na een KEEP:** `hq POST /experiments/12/budget-request '{"amountEur": 30, "reason": "..."}'`

**Echt geld uitgeven** (domein, advertenties, tools). Kalle betaalt zelf na goedkeuring:
```bash
hq POST /spend-requests '{"amountEur": 12, "what": "Domein fluxgrid.nl", "vendor": "TransIP", "reason": "...", "experimentId": 12}'
```

**Les vastleggen:** `hq POST /lessons '{"lesson": "...", "evidence": "...", "experimentId": 12, "tags": ["crazygames"]}'`

**Nieuwe tak voorstellen** (CEO): `hq POST /branches '{"slug": "content", "name": "Content", "template": "content", "pitch": "...", "evidence": ["https://..."]}'`

**Agent aannemen** (alleen met recht om agents te maken): `hq POST /hire '{"template": "verkenner", "branch": "games", "reason": "..."}'`

**Kort bericht aan Kalle** (max 3 per dag, alleen als het echt niet in je rapport kan):
`hq POST /notify '{"text": "..."}'`

## Foutcodes
- `400` ongeldige invoer (zie `issues`) · `401` token ongeldig · `404` bestaat niet
- `409` al beslist of bestaat al · `423` **noodstop actief: stop direct met werken**
- `429` te veel verzoeken vandaag: bundel je werk en probeer morgen opnieuw

## Nooit
- Omzet boeken of cijfers verzinnen. Er is bewust geen endpoint voor omzet.
- Om de regels heen werken (budget opsplitsen, iemand anders laten vragen). HQ logt alles.
