---
name: ideeenraad
description: Hoe de wekelijkse ideeënraad van een tak werkt (verkenners, pitcher, criticus) en hoe het beste idee een experiment wordt.
tagline: Verkennen, pitchen, afschieten, kiezen
---

# De ideeënraad

Eén keer per week, als batch. Het doel is niet "veel ideeën" maar **1 of 2 ideeën die een experiment van
€20 waard zijn**. AI is slecht in het vinden van echte gaten in de markt: het stelt vaak ideeën voor die al
honderd keer bestaan. De raad is zo ingericht dat dat eruit gefilterd wordt.

## Volgorde (de tak-lead regelt dit met Paperclip-taken)
1. **Lessen lezen.** Iedereen begint met `GET /lessons?branch=<tak>`: wat is al getest of afgeschoten?
2. **Verkenners (2–3)**, elk met een eigen bron. Ze leveren per stuk 5 observaties met links:
   wat mensen willen, waar ze over klagen, wat nieuw of groeiend is. Geen ideeën, alleen waarnemingen.
3. **Pitcher** maakt van de observaties een **top 5** in het vaste pitch-format (zie `experiment-protocol`).
4. **Criticus** zoekt per pitch **minstens 3 bestaande concurrenten met live data** (links) en schrijft
   waarom het zou mislukken. Hij **schiet minstens 3 van de 5 af**. Een criticus die alles goedkeurt, is kapot.
5. **Tak-lead** dient de 1–2 overgebleven pitches in als experiment (`POST /experiments`), met de
   voorspelling van de raad erbij. Kalle kiest via de goedkeuringsknoppen.

## Regels
- Bewijs = links naar echte bronnen. "Ik denk dat mensen dit willen" telt niet.
- Maximaal 2 voorstellen per week per tak. Meer ideeën = minder aandacht per idee.
- Schrijf alles kort in de Paperclip-taken, zodat de analist later kan terugzien wat de raad dacht.
