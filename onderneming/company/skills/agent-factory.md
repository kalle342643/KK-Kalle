---
name: agent-factory
description: Wanneer en hoe je een nieuwe agent aanneemt of een nieuwe tak voorstelt uit een sjabloon.
tagline: Nieuwe agents en takken uit sjablonen
---

# Agent Factory

De holding groeit alleen als de cijfers het betalen. Meer agents betekent meer kosten en meer ruis;
meerdere kopieën van hetzelfde model bevestigen elkaar vooral. Voeg alleen iemand toe met een eigen bron,
een eigen rol of een tegengesteld perspectief.

## Een agent aannemen
1. Bekijk de sjablonen: `GET /templates` (bv. `verkenner`, `pitcher`, `criticus`, `bouwer`, `publicist`).
2. Neem aan via `POST /hire` met `template`, `branch` en een concrete `reason` (welk knelpunt, welk bewijs).
3. Kalle keurt elke aanname goed of af. Tot die tijd bestaat de agent niet.

## Een nieuwe tak voorstellen (CEO)
Voorwaarden, allemaal tegelijk:
- Er is bewijs van vraag (links: zoekvolume, fora, concurrenten die geld verdienen).
- Er is budget vrij in het portfolio (`GET /portfolio`).
- De bestaande takken lopen niet vast door gebrek aan aandacht.

Dien in via `POST /branches` met een tak-sjabloon (`games`, `content`, `saas`, `generiek`). Na goedkeuring
bouwt HQ de tak automatisch op: agents, routines en een startbudget.

## Grenzen
- Maximaal 3 aannames per agent per dag, maximaal één takvoorstel per maand.
- Nooit agents buiten HQ en Paperclip om starten.
