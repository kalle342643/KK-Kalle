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
| Claude Sonnet 5 | $2 / $10 | tak-leads, criticus, bouwer, publicist, schrijver |
| Claude Haiku 4.5 | $1 / $5 | analist Argus, verkenners |

Tokens die uit de cache komen kosten ongeveer 10% van de invoerprijs. Claude Code hergebruikt veel context, dus
een groot deel van de invoer is goedkoop.

**Grove schatting per maand** (met een koers van $1 = €0,90):

| Wat | Hoe vaak | Schatting |
|---|---|---|
| Strategieronde CEO (Opus) | wekelijks (alleen bij nieuws) + maandelijkse verkenning | €3–8 |
| Analist (Haiku) | na elk afgerond experiment | €0,50–2 |
| Ideeënraad per tak (verkenners, criticus, lead) | wekelijks, overgeslagen als er al 2 lopen | €4–8 per tak |
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
2. **Paperclip, bedrijf:** maandplafond = `HQ_GLOBAL_MONTHLY_CAP_EUR` (standaard €40) + 30% van de omzet van de
   laatste 30 dagen. Wordt bijgewerkt als jij het portfolio-voorstel goedkeurt.
3. **Paperclip, per agent:** maandbudget uit het sjabloon (CEO €15, bouwer €15, lead €10, analist €5,
   verkenner/criticus €3).
4. **Paperclip, per experiment:** levenslang budget (standaard €20, max. €50 per verzoek) met harde stop.
5. **HQ:** noodstop zodra de AI-kosten van vandaag boven `HQ_DAILY_SPEND_ALARM_EUR` (standaard €15) komen.

## Opschalen
Het AI-budget groeit alleen mee met echte omzet: per tak startbudget + **30% van de omzet van de laatste
30 dagen**, met een bonus voor takken met een ROI ≥ 2× en een recente KEEP. Van 1 naar 5 naar 20+ agents gaan
is in Paperclip een configuratiekwestie; economisch gebeurt het pas als de takken het betalen.

## Wat al zuinig is (na de controle van september 2026)
Zie [ONDERZOEK-AGENTS.md](ONDERZOEK-AGENTS.md). Geen aparte pitcher meer (de lead maakt de top 5), geen
dagelijkse analyse-run (HQ controleert de cijfers zelf), geen weekplan van de CEO zonder nieuws, geen ideeënraad als
er al 2 experimenten lopen of wachten, en geen Graphify-extractie onder 100 lessen en notities. De **nut-meter**
(📊 in het kantoor, en elke maandag in het dagrapport) laat per agent zien wat hij kostte en aantoonbaar opleverde.

## Goedkoper maken
- Pauzeer wie op de nut-meter "voor de sier?" staat.
- Minder agents per tak (één verkenner in plaats van twee).
- Ideeënraad om de twee weken in plaats van wekelijks (cron in `company/templates/branches/*.yaml`).
- Een lager model voor een rol (`model:` in het sjabloon); `update.sh` zet het door.
- Claude-abonnement in plaats van API-sleutel via de AI-verbinding in Paperclip. Dan valt het gebruik binnen je
  abonnementslimiet, maar het beleid daarvoor veranderde in 2026 een paar keer: reken er niet op.
- **Gratis AI** (SETUP.md, *Optioneel*): de kennisgraaf (`GRAPHIFY_BACKEND=gratis`) en eenvoudige rollen zoals
  verkenners (`HQ_GRATIS_AI_ROLES=verkenner`) via OmniRoute, over de gratis lagen van zeven aanbieders (±20
  modellen). Kost €0 zolang je binnen hun limieten blijft; OmniRoute schakelt door naar de volgende als er één vol
  zit. Minder slim dan Claude, dus niet voor de CEO, de lead of de bouwer. Nooit via abonnementen, webchat-cookies
  of extra accounts: dat kan OmniRoute wel, maar het is tegen de voorwaarden van de aanbieders.
- **Kennisbank eerst:** agents vragen `hq kennis` voordat ze het web op gaan, en HQ zet bij elk voorstel wat al
  bekend is. Dat scheelt dubbel onderzoek (en dus tokens).
