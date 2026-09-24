---
name: ideeenraad
description: Hoe de wekelijkse ideeënraad van een tak werkt (verkenners, top 5 door de lead, criticus) en hoe het beste idee een experiment wordt.
tagline: Verkennen, pitchen, afschieten, kiezen
---

# De ideeënraad

Eén keer per week, als batch. Het doel is niet "veel ideeën" maar **1 of 2 ideeën die een experiment van
€20 waard zijn**. AI is slecht in het vinden van echte gaten in de markt: het stelt vaak ideeën voor die al
honderd keer bestaan. De raad is zo ingericht dat dat eruit gefilterd wordt.

## Eerst: is er ruimte?
Lopen er in de tak al 2 experimenten, of wachten er 2 voorstellen op Kalle? Dan sla je de raad deze week
over. Meer voorstellen dan Kalle kan kiezen is weggegooid geld, en minder aandacht per idee.

## Volgorde (de tak-lead regelt dit met Paperclip-taken)
1. **Kennisbank eerst.** Iedereen begint met `hq kennis "<onderwerp van deze week>"` en
   `hq GET "/lessons?branch=<tak>"`: wat is al getest, afgeschoten of door een collega uitgezocht?
2. **Verkenners (2–3)**, elk met een eigen bron, volgens de skill `onderzoek` (WebSearch, `hq-web`,
   `hq-trends`). Ze leveren per stuk 5 observaties met links: wat mensen willen, waar ze over klagen, wat nieuw
   of groeiend is. Geen ideeën, alleen waarnemingen. De sterkste waarneming gaat als notitie de kennisbank in.
3. **De tak-lead** maakt van de observaties zelf een **top 5** in het vaste pitch-format (zie
   `experiment-protocol`). Daar is geen aparte agent voor nodig: een extra agent helpt alleen als hij een
   eigen bron of een tegengestelde rol heeft (docs/ONDERZOEK-AGENTS.md). De verkenners hebben een eigen
   bron, de criticus een tegengestelde rol; de top 5 maken is geen van beide.
4. **Criticus** zoekt per pitch **minstens 3 bestaande concurrenten met live data** (links, gelezen met
   `hq-web` of `WebFetch`) en kijkt met `hq kennis` of we iets vergelijkbaars al eens afschoten. Hij schrijft
   waarom het zou mislukken en **schiet minstens 3 van de 5 af**. Een criticus die alles goedkeurt, is kapot.
5. **Tak-lead** dient de 1–2 overgebleven pitches in als experiment (`POST /experiments`), met de
   voorspelling van de raad erbij. Kalle kiest via de goedkeuringsknoppen.

## Regels
- Bewijs = links naar echte bronnen. "Ik denk dat mensen dit willen" telt niet.
- Maximaal 2 voorstellen per week per tak. Meer ideeën = minder aandacht per idee.
- Schrijf alles kort in de Paperclip-taken, zodat de analist later kan terugzien wat de raad dacht.
