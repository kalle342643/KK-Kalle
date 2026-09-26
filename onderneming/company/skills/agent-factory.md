---
name: agent-factory
description: Wanneer je een nieuwe agent aanneemt (bijna nooit - eerst hergebruiken), hoeveel er per tak mogen, hoe de aanname een experiment wordt, en hoe je een nieuwe tak voorstelt uit een sjabloon.
tagline: Eerst hergebruiken, dan pas aannemen
---

# Agent Factory

Een extra agent kost geld, ruis en afstemming. Meerdere kopieën van hetzelfde model bevestigen elkaar vooral. En
in Anthropics winkelproef (Project Vend) hielp een AI-baas niet; vaste procedures en goed gereedschap wel. Daarom
groeit de holding in deze volgorde.

## 1. Eerst hergebruiken
1. **Een taak voor wie er al is.** Kan een bestaande agent het met een duidelijke subtaak? Doe dat. Een goede
   subtaak heeft vier dingen: het doel, wat je terug wilt (en in welke vorm), welke bron of tools, en wat níet.
2. **Een procedure in plaats van een agent.** Gaat het mis omdat niemand weet hoe iets moet? Dan helpt een
   checklist, les of skill meer dan een extra agent. Schrijf een les (`POST /lessons`) of vraag Kalle om een skill.
3. **Pas dan aannemen**, en alleen als de nieuwe agent één van deze drie dingen meebrengt:
   - een **eigen bron** (een verkenner voor een bron die niemand volgt),
   - een **tegengestelde rol** (iemand die afkeurt of keurt),
   - een **eigen vak voor werk dat al wacht** (een tweede bouwer omdat er twee goedgekeurde experimenten tegelijk
     gebouwd moeten worden).

   Nooit: een baas of coördinator voor agents, een kopie "voor meer capaciteit" zonder wachtend werk, of een rol
   die alleen samenvat of doorgeeft.

## 2. Hoeveel per tak
HQ bewaakt de bezetting en weigert een aanname daarboven (`maxPerBranch` in `GET /templates`):

| Rol | Hooguit per tak | Waarom |
|---|---|---|
| tak-lead | 1 | één eindverantwoordelijke |
| verkenner | 3 | elk een eigen bron; meer bronnen overzien leidt af |
| criticus | 1 | twee critici van hetzelfde model zien dezelfde dingen |
| bouwer, schrijver | 2 | hooguit 2 experimenten tegelijk per tak |
| publicist | 1 | één etalage |

HQ weigert ook als een collega met hetzelfde sjabloon in de tak **op pauze** staat of **niets oplevert**. Zet die
eerst weer aan het werk: geef hem een taak, of vraag Kalle hem weer aan te zetten met een nieuwe bron.

## 3. De aanname is een experiment
`POST /hire` met `template`, `branch` en een `reason` met:
- **het knelpunt, met bewijs**: welke taken al hoelang wachten, welk experiment stilstaat;
- **wat de agent in 14 dagen oplevert**, bv. "5 waarnemingen per week uit bron X".

Kalle keurt goed of af en ziet daarbij de bezetting en de kosten van de tak. Na 14 dagen kijkt de nut-meter: levert
de agent niets, dan gaat hij vanzelf op pauze. Maak geen werk om de nut-meter te halen, zoals notities of taken
die niemand nodig heeft: nut is wat een experiment verder helpt, en Kalle kijkt mee.

**Kosten:** `GET /templates` toont per sjabloon het model, de denkstand (`effort`) en het maandbudget. Die liggen vast
per rol; alleen Kalle past ze aan (docs/ONDERZOEK-AGENTS.md, *Welk model voor welke rol*).

## 4. Een nieuwe tak voorstellen (CEO)
Voorwaarden, allemaal tegelijk:
- Er is bewijs van vraag (links: zoekvolume, fora, concurrenten die geld verdienen).
- Er is budget vrij in het portfolio (`GET /portfolio`).
- De bestaande takken lopen niet vast door gebrek aan aandacht.

Dien in via `POST /branches` met een tak-sjabloon (`games`, `content`, `saas`, `generiek`). Na goedkeuring
bouwt HQ de tak automatisch op: agents, routines en een startbudget.

## Grenzen
- Maximaal 3 aannames per agent per dag, maximaal één takvoorstel per maand.
- Alleen via `POST /hire`. Nooit rechtstreeks in Paperclip en nooit buiten HQ om: dan controleert niemand de bezetting.
