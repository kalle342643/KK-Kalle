---
name: hq-strategie
description: De wekelijkse strategieronde van de CEO - portfolio lezen, taken uitzetten, weekplan indienen.
tagline: Weekritme van de CEO
---

# Wekelijkse strategieronde (CEO)

## 1. Cijfers (10 minuten)
- `GET /overview` en `GET /portfolio`: omzet en kosten per tak (30 dagen), ROI, vrij budget.
- `GET /experiments?status=running` en de besluiten van vorige week (`status=keep,iterate,killed`).
- `GET /lessons?limit=20`: wat hebben we geleerd?

## 2. Oordeel per tak
Beantwoord per tak in één regel: **groeien, vasthouden of afbouwen?**
- Groeien: KEEP in de laatste 60 dagen én ROI ≥ 2×.
- Vasthouden: lopende experimenten met signaal.
- Afbouwen: 30 dagen kosten zonder enig signaal. Stel dan voor de tak te pauzeren.

## 3. Taken
Maak per tak hooguit 3 taken voor de tak-lead in Paperclip, elk met een meetbaar doel en een deadline.

## 4. Weekplan naar Kalle
Dien één strategievoorstel in (Paperclip-approval `approve_ceo_strategy`), maximaal 15 regels:
- Resultaat vorige week (alleen HQ-cijfers).
- Oordeel per tak (groeien/vasthouden/afbouwen) met één zin onderbouwing.
- Top 3 prioriteiten voor deze week.
- Wat je van Kalle nodig hebt (beslissingen, accounts, uitgaven).
