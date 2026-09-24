---
name: kennisgraaf
description: Hoe je de kennisbank en de Graphify-kennisgraaf gebruikt - vragen stellen, verbanden zoeken, notities schrijven die de graaf beter maken, en Graphify op je eigen code. Gebruik dit voor je iets nieuws voorstelt, onderzoekt of bouwt.
tagline: Wat de holding weet, en hoe het samenhangt
---

# De kennisgraaf

Alles wat de holding leert, komt in één kennisbank: lessen (na elk experiment), notities (van jullie),
experimenten en takken. HQ maakt er elke nacht een **kennisgraaf** van met Graphify: knopen (onderwerpen,
experimenten, lessen, agents) en de verbanden ertussen. In het kantoor staat hij als hologram in de kennisruimte.

## Vragen
- `hq kennis "vraag"`: het beste begin. Lessen, notities én het stuk graaf rond je vraag in één antwoord.
- `hq-graaf uitleg "retentie"`: wat weten we over één onderwerp, en waar hangt het aan vast?
- `hq-graaf pad "Fluxgrid" "mobiel"`: hoe hangen twee dingen samen? Handig om een aanname te toetsen.
- `hq-graaf hubs`: de onderwerpen waar veel om draait. Begin daar als je een tak nog niet kent.

Noem in je taak of pitch welke kennis je gebruikte ("volgens de les over korte levels …"). Zo ziet de analist
wat de kennisbank oplevert, en ziet Kalle waarom je iets voorstelt.

HQ kijkt zelf ook: bij elk experimentvoorstel zoekt HQ vergelijkbare experimenten en lessen op en zet die bij je
voorstel. Staat daar een eerdere KILL op hetzelfde idee, leg dan uit wat er nu anders is, of trek het voorstel in.

## Schrijven: zo wordt de graaf beter
- Eén onderwerp per notitie, feitelijk, met bronlink en datum.
- **Tags worden knopen** in de graaf. Gebruik bestaande tags (zoek met `hq GET "/notes?q=..."`), kleine letters,
  enkelvoud: `retentie`, `crazygames`, `prijs`, `seo`. Alleen een nieuwe tag als er echt geen past.
- Noem experimenten als `EXP-12` en takken bij hun naam; HQ legt dan zelf het verband.
- Wordt een oude les anders? Schrijf een notitie die ernaar verwijst en zeg wat er veranderde, in plaats van er een
  tegenstrijdige les naast te zetten.

## Graphify op je eigen code (bouwers)
In je projectworkspace (git):
```bash
graphify update .                         # graaf van de code: zonder AI, zonder kosten, in seconden
graphify query "LevelLoader"              # zoek op namen van functies, klassen of bestanden
graphify explain "calculateScore()"       # waar hangt dit aan vast?
graphify path "InputHandler" "Renderer"   # hoe lopen twee delen in elkaar over?
```
Zo lees je een onbekende codebase met een fractie van de tokens. De skill `/graphify .` neemt ook documenten mee,
maar gebruikt daarvoor AI; doe dat alleen bij een grote onbekende map. Zet `graphify-out/` in `.gitignore`.
