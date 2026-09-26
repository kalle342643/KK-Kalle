---
name: experiment-protocol
description: De vaste levenscyclus van een experiment (hypothese, budget, meten, KEEP/ITERATE/KILL) en het pitch-format. Lees dit voor je een experiment voorstelt of uitvoert.
tagline: Idee → klein experiment → meten → leren
---

# Experiment-protocol

Elk nieuw idee begint als een klein experiment. Geen enkel idee krijgt meer dan het startbudget zonder
gemeten resultaat.

## 1. Voorstel (pitch-format)
Elk voorstel bevat precies deze vijf onderdelen:
1. **Probleem** — welk probleem of welke vraag in de markt, in één of twee zinnen.
2. **Doelgroep** — wie precies (bv. "spelers van puzzelgames op CrazyGames, mobiel", "MKB-webshops in NL").
3. **Bewijs** — links naar echte bronnen (fora, zoekdata, concurrenten, reviews). Geen redeneringen.
4. **Kosten** — maximaal €20 aan AI-gebruik (standaard), plus eventuele uitgaven apart aangevraagd.
5. **Test en meetpunt** — de kleinste echte test van de riskantste aanname, en één getal met een drempel binnen
   maximaal 14 dagen, bv. `plays ≥ 500` of `signups ≥ 10`.

Voeg altijd een **voorspelling** toe ("ik verwacht 700 plays"). De analist vergelijkt die later met de uitkomst.

### De kleinste echte test per soort
Echte mensen die iets doen, zeggen meer dan de beste redenering. Bouw alleen wat de test nodig heeft.
| Soort | Kleinste echte test | Meetpunt (voorbeeld) |
|---|---|---|
| Game | Eén speelbaar level of één kernlus, op CrazyGames (via Kalle) | plays, gemiddelde speeltijd |
| Website of tool | Een landingspagina met één belofte en een wachtlijst ("binnenkort") | aanmeldingen |
| Blog of content | 3 sterke artikelen op vragen zonder goed antwoord | vertoningen en klikken (Search Console) |
| Webshop of digitaal product | Een productpagina met voorbestelling of "laat me weten" | aanmeldingen, klikken op kopen |

Content heeft tijd nodig: in 14 dagen meet je de eerste vertoningen, geen omzet. Wat klaar is, bepaal je vooraf met
de skill `productkwaliteit`.

## 2. Na goedkeuring
- HQ maakt een Paperclip-project met een **harde budgetstop**. Is het budget op, dan stopt Paperclip het werk.
- De tak-lead krijgt een taak met hypothese, meetpunt en deadline.
- Werk in kleine stappen en leg beslissingen vast in de taak.

## 3. Meten
- Meld tussenstanden via `POST /experiments/{id}/metrics`. Die tellen als **signaal**.
- **Bewijs** komt alleen uit betrouwbare bronnen: imports (Stripe, CrazyGames-export) of de eigenaar.
- Geef bij elke meting de bron in `note` (bv. "CrazyGames developer dashboard, 23 sep 14:00").

## 4. Beslissing (HQ doet dit automatisch, dagelijks)
- **KEEP** — een betrouwbare meting haalt het doel (mag eerder dan de deadline). De tak-lead maakt dan een
  opschaalplan en vraagt extra budget aan.
- **ITERATE** — deadline voorbij of budget op, maar er is een signaal (≥ 50% van het doel betrouwbaar gemeten,
  of een agent-meting boven het doel). Stel één vervolgexperiment voor met `parentId` en één duidelijke aanpassing.
  Maximaal 2 iteraties.
- **KILL** — geen signaal. Het project stopt. Geen herkansing met hetzelfde idee in een andere jas.

## 5. Leren
Na elke beslissing schrijft de analist 3–5 lessen. Vraag vóór elk nieuw voorstel de kennisbank
(`hq kennis "<je idee in een paar woorden>"`) en noem in je pitch waarom dit idee niet in een eerdere valkuil trapt.
HQ controleert dat ook zelf: bij elk voorstel zoekt HQ vergelijkbare experimenten en lessen op, zet ze bij het
voorstel voor Kalle en geeft ze aan jou terug (`knowledge` in het antwoord). Staat er een eerdere KILL op
hetzelfde idee? Leg dan uit wat er nu anders is.
