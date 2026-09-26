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
De raad is **één taak met subtaken**. Jouw raad-taak is de bovenliggende taak; maak voor elke verkenner en voor
de criticus een subtaak eronder (`parentId` = de id van de raad-taak). Zo staat de hele raad bij elkaar: de analist
leest later terug wat de raad dacht, en in het kantoor zie je wie er samen aan werkt.

1. **Kennisbank eerst.** Iedereen begint met `hq kennis "<onderwerp van deze week>"` en
   `hq GET "/lessons?branch=<tak>"`: wat is al getest, afgeschoten of door een collega uitgezocht?
2. **Verkenners (2–3)**, elk met een eigen bron, volgens de skill `onderzoek` (WebSearch, `hq-web`,
   `hq-trends`). Ze leveren per stuk 5 observaties met links: wat mensen willen, waar ze over klagen, wat nieuw
   of groeiend is. Geen ideeën, alleen waarnemingen. De sterkste waarneming gaat als notitie de kennisbank in.
3. **De tak-lead** maakt van de observaties zelf een **top 5** in het vaste pitch-format (zie
   `experiment-protocol`). Daar is geen aparte agent voor nodig: een extra agent helpt alleen als hij een
   eigen bron of een tegengestelde rol heeft (docs/ONDERZOEK-AGENTS.md). De verkenners hebben een eigen
   bron, de criticus een tegengestelde rol; de top 5 maken is geen van beide.
   - **Vijf verschillende richtingen**, niet vijf varianten van hetzelfde. Taalmodellen herhalen zichzelf graag.
   - Staat er een KEEP of een sterke les in de kennisbank, laat dan **één idee daarop voortbouwen**. Laat er ook
     **één uit een hoek komen die we nog niet probeerden**.
   - Elk idee noemt zijn **riskantste aanname** en de **kleinste echte test** die hem binnen 14 dagen kan
     weerleggen (zie `experiment-protocol`).
4. **Criticus** zoekt per pitch **minstens 3 bestaande concurrenten met live data** (links, gelezen met
   `hq-web` of `WebFetch`) en kijkt met `hq kennis` of we iets vergelijkbaars al eens afschoten. Hij schrijft
   waarom het zou mislukken en **schiet minstens 3 van de 5 af**. Een criticus die alles goedkeurt, is kapot.
5. **Tak-lead** kiest uit wat overblijft door de ideeën **twee aan twee te vergelijken** ("A of B: welke geeft met
   de kleinste test het duidelijkste signaal?"), niet met cijfers van 1 tot 10. Tweetallen vergelijken is
   betrouwbaarder dan een AI die zelf punten geeft. Dien de 1–2 winnaars in als experiment (`POST /experiments`),
   met de voorspelling van de raad erbij. Kalle kiest via de goedkeuringsknoppen.

## Regels
- Bewijs = links naar echte bronnen. "Ik denk dat mensen dit willen" telt niet.
- Nieuw op papier is geen bewijs. Ideeën van AI lijken origineler dan die van mensen, maar vallen bij uitvoering
  vaker tegen. Kies daarom het idee dat het **snelst en goedkoopst echt te testen** is.
- Maximaal 2 voorstellen per week per tak. Meer ideeën = minder aandacht per idee.
- Schrijf alles kort in de Paperclip-taken, zodat de analist later kan terugzien wat de raad dacht.
