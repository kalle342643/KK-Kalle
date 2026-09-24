# Kosten

Doel: **€20–50 per maand** in de beginfase, en pas meer als de omzet het betaalt. De grootste kostenpost is
AI-gebruik, niet de server. Daarom worden agents alleen op schema of bij een taak wakker, en denken ze niet 24/7.

## Vaste kosten
| Wat | Per maand |
|---|---|
| Hetzner CX33 (4 vCPU, 8 GB) | ~€7 (prijs na de verhoging van april 2026, volgens je onderzoek) |
| Tailscale, Telegram, Supabase (gratis laag) | €0 |
| Domeinnaam (alleen als een experiment er een nodig heeft, via een uitgaveverzoek) | ~€1 |

## AI-gebruik (variabel)
Prijzen van de Claude API per miljoen tokens (invoer / uitvoer), stand juni 2026:

| Model | Prijs | Gebruikt voor |
|---|---|---|
| Claude Opus 5 | $5 / $25 | CEO Atlas (strategie) |
| Claude Sonnet 5 | $2 / $10 | tak-leads, pitcher, criticus, bouwer, publicist, schrijver |
| Claude Haiku 4.5 | $1 / $5 | analist Argus, verkenners |

Tokens die uit de cache komen kosten ongeveer 10% van de invoerprijs. Claude Code hergebruikt veel context, dus
een groot deel van de invoer is goedkoop.

**Grove schatting per maand** (met een koers van $1 = €0,90):

| Wat | Hoe vaak | Schatting |
|---|---|---|
| Strategieronde CEO (Opus) | wekelijks + maandelijkse verkenning | €5–8 |
| Analist (Haiku) | dagelijks, kort | €1–3 |
| Ideeënraad per tak (2 verkenners, pitcher, criticus, lead) | wekelijks | €6–10 per tak |
| Weekstart per tak (Sonnet) | wekelijks | €1–2 per tak |
| Bouwen tijdens een experiment (Sonnet) | 2–3 stevige sessies per week à ~€2,70 | €20–35 zolang er gebouwd wordt |

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
   verkenner/pitcher/criticus €3).
4. **Paperclip, per experiment:** levenslang budget (standaard €20, max. €50 per verzoek) met harde stop.
5. **HQ:** noodstop zodra de AI-kosten van vandaag boven `HQ_DAILY_SPEND_ALARM_EUR` (standaard €15) komen.

## Opschalen
Het AI-budget groeit alleen mee met echte omzet: per tak startbudget + **30% van de omzet van de laatste
30 dagen**, met een bonus voor takken met een ROI ≥ 2× en een recente KEEP. Van 1 naar 5 naar 20+ agents gaan
is in Paperclip een configuratiekwestie; economisch gebeurt het pas als de takken het betalen.

## Goedkoper maken
- Minder agents per tak (één verkenner in plaats van twee).
- Ideeënraad om de twee weken in plaats van wekelijks (cron in `company/templates/branches/*.yaml`).
- Een lager model voor een rol (`model:` in het sjabloon); `update.sh` zet het door.
- Claude-abonnement in plaats van API-sleutel via de AI-verbinding in Paperclip. Dan valt het gebruik binnen je
  abonnementslimiet, maar het beleid daarvoor veranderde in 2026 een paar keer: reken er niet op.
