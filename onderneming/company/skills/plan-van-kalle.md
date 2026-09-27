---
name: plan-van-kalle
description: Wat je doet als Kalle je een plan geeft - eerlijk nakijken, de goedkoopste echte test kiezen, een afdeling kiezen of voorstellen, en het werk verdelen. Kalle plant, jij werkt uit.
tagline: Kalle plant, jij werkt uit
---

# Een plan van Kalle uitwerken

Kalle bedenkt zelf wat de holding gaat doen. AI-ideeën lijken origineel, maar vallen bij uitvoering vaker tegen en
lijken op elkaar. Daarom is zijn plan het vertrekpunt. Jij maakt het scherp en uitvoerbaar. Bedenk er geen ander
plan omheen, en ook geen extra ideeën "voor de zekerheid".

Een plan komt als taak met de titel *Plan van Kalle: …*. Kalle stuurt het uit zijn kantoor, of de hoofdagent op zijn
Claude-account heeft het al voor je uitgewerkt. Lees in dat geval eerst wat de hoofdagent schreef en doe dat werk
niet opnieuw.

## 1. Eerst kijken wat we al weten
- `hq kennis "<onderwerp>"` en `hq GET "/lessons?limit=20"`: deden we iets vergelijkbaars, en wat leerden we?
- `hq GET /overview`: welke takken zijn er, en hoeveel budget is vrij?
- Ontbreekt het doel, het budget of wat "gelukt" betekent? Stel **één** korte vraag in een reactie op de taak en
  wacht. Gok niet.

## 2. Eerlijke kritiek, kort
Zet in de taak, in hooguit 8 regels:
- De **riskantste aanname**: wat moet waar zijn, wil dit werken?
- De **goedkoopste echte test** die die aanname binnen 14 dagen kan weerleggen (skill `experiment-protocol`).
- Wat **zwak** is of al vaak gedaan wordt, met 1 tot 3 bestaande concurrenten en links (skill `onderzoek`).
- Wat niet mag (platformregels, AVG, AI Act; skill `geld-en-regels`). Mag het niet, zeg dat meteen en stop.

## 3. De afdeling
- Past het bij een **bestaande tak**? Dan gaat het daarheen. Een nieuwe tak alleen als het echt iets anders is.
- Is het echt nieuw? Stel een **nieuwe tak** voor met `POST /branches` en het sjabloon dat het best past
  (`GET /templates`). Schrijf in de onderbouwing dat het Kalles plan is en wat de eerste test wordt. Kalle keurt de
  tak goed; pas dan bestaan de agents.
- Meer mensen nodig? Volg `agent-factory`: eerst wie er al is, dan pas aannemen.

## 4. Verdelen
Staat de afdeling er (of koos je een bestaande tak), dan:
1. dien je de eerste test in als experiment (`POST /experiments`), met de voorspelling erbij;
2. maak je voor de tak-lead één taak met het doel, de acceptatiecriteria en de deadline.

De lead verdeelt het werk verder (skill `productkwaliteit`). Jij doet het uitvoerende werk niet zelf.

## 5. Terug naar Kalle
Sluit af met één reactie op de taak, in hooguit 10 regels:
- je kritiek in twee zinnen;
- de test: wat, hoeveel euro, hoe lang, en welk getal beslist;
- de afdeling en wie wat doet;
- wat je van Kalle nodig hebt (goedkeuringen, accounts, geld).

## Nooit
- Zelf geld uitgeven, accounts aanmaken of iets publiceren. Dat doet Kalle.
- Uit jezelf de ideeënraad starten. Vraagt Kalle erom ("bedenk richtingen voor X"), volg dan de skill `ideeenraad`:
  vijf verschillende richtingen, twee aan twee vergeleken, en de goedkoopste echte test wint.
