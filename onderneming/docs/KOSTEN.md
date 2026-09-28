# Kosten

Doel: **€20–50 per maand** in de beginfase, en pas meer als de omzet het betaalt. De grootste kostenpost is
AI-gebruik, niet de server. Daarom worden agents alleen op schema of bij een taak wakker, en denken ze niet 24/7.

## Vaste kosten
| Wat | Per maand |
|---|---|
| Server: Oracle Cloud Always Free (ARM, 4 cores, 24 GB) | **€0** (zie SETUP.md stap 1 voor de voorwaarden) |
| of: een computer thuis | €0, plus stroom ±€2–5 |
| of: Hetzner CX33 (4 vCPU, 8 GB) | ~€7 (prijs na de verhoging van april 2026, volgens je onderzoek) |
| Tailscale, Telegram, Supabase (gratis laag) | €0 |
| Het 3D-kantoor | €0 en 0 tokens: het draait in je browser en doet zelf geen AI-aanvragen (een "uit"-knop zou dus niets besparen) |
| De werkplaats (GitHub meelezen, gezondheidscheck) | €0: GitHub-token is gratis, meelezen kost geen tokens |
| Webtools voor agents (Crawl4AI, last30days, Graphify) | €0: open source, draaien op je eigen server; alleen het lezen van de resultaten kost tokens |
| Gratis AI-router (OmniRoute) | €0: open source; de aanbieders zelf binnen hun gratis laag |
| Domeinnaam (alleen als een experiment er een nodig heeft, via een uitgaveverzoek) | ~€1 |

## AI-gebruik (variabel)
Prijzen van de Claude API per miljoen tokens (invoer / uitvoer), stand juni 2026:

| Model | Prijs | Gebruikt voor |
|---|---|---|
| Claude Opus 5 | $5 / $25 | CEO Atlas (strategie) |
| Claude Sonnet 5 | $2 / $10 | tak-leads, bouwer (denkstand hoog); criticus, publicist, schrijver, analist Argus (middel) |
| Claude Haiku 4.5 | $1 / $5 | verkenners |

Tokens die uit de cache komen kosten ongeveer 10% van de invoerprijs. Claude Code hergebruikt veel context, dus
een groot deel van de invoer is goedkoop.

**Grove schatting per maand** (met een koers van $1 = €0,90):

| Wat | Hoe vaak | Schatting |
|---|---|---|
| Strategieronde CEO (Opus) | wekelijks (alleen bij nieuws) | €2–6 |
| Een plan van jou uitwerken (Atlas, Opus) | per plan dat je stuurt | €1–3 per plan |
| Analist (Sonnet, denkstand middel) | na elk afgerond experiment | €1–3 |
| Ideeënraad per tak (verkenners, criticus, lead) | alleen als jij erom vraagt | €4–8 per keer |
| Weekstart per tak (Sonnet) | wekelijks | €1–2 per tak |
| Bouwen tijdens een experiment (Sonnet) | 2–3 stevige sessies per week à ~€2,70 | €20–35 zolang er gebouwd wordt |
| Kennisgraaf (Graphify met Haiku, optioneel) | 's nachts, over de kennisbank-map | centen per nacht zolang de map klein is; eigen sleutel met eigen limiet |

Let op: Paperclip maakt een agent ook wakker als hij een taak krijgt of als jij over zijn verzoek beslist. Elke ✅/❌
kost dus een korte run van de aanvrager (in de test: een paar cent).

Met één tak en één experiment in aanbouw kom je op **€35–55 per maand AI**; zonder bouwwerk rond **€15–25**. Dit
zijn schattingen. Hoe het echt uitvalt zie je per agent in het dashboard en in het dagrapport, en het stopt
hoe dan ook bij de plafonds hieronder.

## De plafonds (van buiten naar binnen)
1. **Anthropic Console:** maandlimiet op de API-sleutel. Harde stop, buiten het systeem.
2. **Paperclip, bedrijf:** maandplafond = `HQ_GLOBAL_MONTHLY_CAP_EUR` (standaard €40) + `HQ_REVENUE_SHARE_FOR_AI`
   (standaard 30%) van de omzet van de laatste 30 dagen. HQ zet het bij elke `bootstrap` (ook in `update.sh`) en als
   jij het portfolio-voorstel goedkeurt.
3. **Paperclip, per agent:** maandbudget uit het sjabloon (CEO €15, bouwer €15, lead €10, analist €5, criticus €5
   (ook de keuring), verkenner €3).
4. **Paperclip, per experiment:** levenslang budget (standaard €20, max. €50 per verzoek) met harde stop.
5. **HQ:** noodstop zodra de AI-kosten van vandaag boven `HQ_DAILY_SPEND_ALARM_EUR` (standaard €15) komen.

## Opschalen: al het geld terug erin
Het AI-budget groeit alleen mee met echt geld: per tak het startbudget + een deel van de omzet van de laatste
30 dagen (standaard **30%**), met een bonus voor takken met een ROI ≥ 2× en een recente KEEP. Van 1 naar 5 naar 20+ agents gaan
is in Paperclip een configuratiekwestie; economisch gebeurt het pas als de takken het betalen.

Kalle stopt al het geld dat hij verdient terug in de holding, ook geld uit andere projecten, tot er veel agents voor
hem werken (bericht 26). Zo stel je dat in:

- **Omzet van de holding:** zet `HQ_REVENUE_SHARE_FOR_AI` hoger dan `0.3`, maar houd de belasting erbuiten. HQ telt de
  omzet zoals die binnenkomt, bij Stripe dus inclusief btw en vóór transactiekosten.
  - Reken je btw (21%)? Dan is ruim 17% van die omzet van de Belastingdienst. Ga dan niet hoger dan `0.8`.
  - Reken je geen btw (kleineondernemersregeling)? Dan kan `0.95`.
  - Wat aan het eind van het jaar als winst overblijft, is voor de inkomstenbelasting. Twijfel je, vraag het een
    boekhouder.
- **Geld uit andere projecten** (websites en zo): tel het bedrag dat je er per maand bij stopt op bij
  `HQ_GLOBAL_MONTHLY_CAP_EUR`. Boek het niet als omzet, want dan lijkt een tak beter dan hij is en gaat het geld naar
  de verkeerde tak.
- **Verhoog ook de maandlimiet op je Anthropic-sleutel** (plafond 1). Anders stopt die eerder.
- Na het aanpassen van `hq.env`: `systemctl --user restart hq` en `hq bootstrap`. Dan staat het nieuwe plafond ook in
  Paperclip.

Wat niet verandert: jij keurt elke uitgave, aanname en elk experiment goed, en de noodstop blijft. Heeft een agent
meer nodig dan zijn eigen budget, dan vraagt hij dat aan. De nut-meter pauzeert wie niets oplevert. Zo gaat meer geld
naar agents die iets opleveren, en niet vanzelf naar meer agents.

**Waar het geld heen gaat, als het er is:**

| Wanneer | Wat je doet |
|---|---|
| Nu (nog geen omzet) | Gratis server en €20–50 per maand aan AI. Niets op AWS |
| De eerste omzet | `HQ_REVENUE_SHARE_FOR_AI` omhoog (zie hierboven) |
| Je hebt een KvK-inschrijving en een website | **AWS Activate Founders** aanvragen: $1.000 tegoed, later tot $5.000. Dat mag ook naar Claude via Amazon Bedrock, dus je agents draaien daar een tijd op. Zet eerst AWS Budgets aan. Zie [onderzoek §13](ONDERZOEK-AGENTS.md#13-aws-agents-amazon) |
| De server zit vol (agents wachten op elkaar) | Eerst een grotere server (Hetzner, ±€7–15 per maand), en pas dan meer agents |
| Een product met klantgegevens gaat live | Eén pentest door AWS, in de gratis proefperiode van 2 maanden |
| Je verkoopt agents aan klanten | AgentCore van AWS om ze per klant te draaien. Je eigen team blijft op je server |

## Wat al zuinig is (na de controle van september 2026)
Zie [ONDERZOEK-AGENTS.md](ONDERZOEK-AGENTS.md). Geen aparte pitcher meer (de lead maakt de top 5), geen
dagelijkse analyse-run (HQ controleert de cijfers zelf), geen weekplan van de CEO zonder nieuws, geen ideeënraad als
er al 2 experimenten lopen of wachten, en geen Graphify-extractie onder 100 lessen en notities. De **nut-meter**
(📊 in het kantoor, en elke maandag in het dagrapport) laat per agent zien wat hij kostte en aantoonbaar opleverde,
en pauzeert elke maandag wie in 30 dagen meer dan €1 kostte zonder resultaat (zie
[ARCHITECTUUR.md](ARCHITECTUUR.md#de-nut-meter)). In het kantoor zit zo'n agent er nog, zonder naam. De figuranten
in het kantoor kosten niets: ze bestaan alleen in je browser. Sinds deel 2 van het onderzoek heeft elke rol een vaste
denkstand (zonder kiest Claude Code zelf, meestal hoog), neemt HQ geen agent aan voor een rol die in de tak al vol
zit of stilstaat, en krijgt een product hooguit twee keuringsrondes.

## Goedkoper maken
- De nut-meter pauzeert al wie niets oplevert. Wil je strenger zijn: pauzeer zelf wie "voor de sier?" staat,
  zonder op maandag te wachten.
- Minder agents per tak (één verkenner in plaats van twee).
- De ideeënraad draait al alleen als je erom vraagt (sinds 26 september: jij plant zelf).
- Een lager model voor een rol (`model:` in het sjabloon); `update.sh` zet het door.
- Claude-abonnement in plaats van API-sleutel via de AI-verbinding in Paperclip. Dan valt het gebruik binnen je
  abonnementslimiet, maar het beleid daarvoor veranderde in 2026 een paar keer: reken er niet op.
- **Gratis AI** (SETUP.md, *Optioneel*): de kennisgraaf (`GRAPHIFY_BACKEND=gratis`) en eenvoudige rollen zoals
  verkenners (`HQ_GRATIS_AI_ROLES=verkenner`) via OmniRoute, over de gratis lagen van zes aanbieders (±15
  modellen). Kost €0 zolang je binnen hun limieten blijft; OmniRoute schakelt door naar de volgende als er één vol
  zit. Minder slim dan Claude, dus niet voor de CEO, de lead of de bouwer. Nooit via abonnementen, webchat-cookies
  of extra accounts: dat kan OmniRoute wel, maar het is tegen de voorwaarden van de aanbieders.
- **Kennisbank eerst:** agents vragen `hq kennis` voordat ze het web op gaan, en HQ zet bij elk voorstel wat al
  bekend is. Dat scheelt dubbel onderzoek (en dus tokens).
