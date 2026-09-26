# KK-Kalle

Kalle (18) bouwt hier een AI-holding. Paperclip draait de agents. HQ (`onderneming/hq`) regelt geld, experimenten,
goedkeuringen, de noodstop en het 3D-kantoor. Antwoord Kalle in het Nederlands: kort, eerst het antwoord.

## Vaste regels van Kalle
- Publiceer nooit iets op CrazyGames en maak geen accounts aan. Dat doet hij zelf.
- Vraag nooit om wachtwoorden of betaalgegevens. Alleen API-sleutels die hij zelf als secret instelt.
- Twijfel over scope, of een keuze die later moeilijk terug te draaien is? Stel een korte vraag in plaats van te gokken.
- Houd bij wat werkte en wat niet in `onderneming/docs/lessen.md`: dat wordt later het geheugen van zijn agents.
- **Alles wat Kalle in de chat stuurt, komt in `onderneming/docs/STAPPENPLAN.md`**, in de tabel *Alles wat je
  stuurde*, met wat je ermee deed en de volgende stap. Niets overslaan, ook niet wat hij tussendoor of als foto stuurt.

## Deze repository is openbaar
- Geen geheimen, geen namen van privé-repositories en geen details van zijn eigen projecten (klanten, KvK, plannen) in
  code, docs, tests of de demo.
- Zijn eigen (privé) projecten mag je lezen, maar push daar nooit naartoe.

## Werken aan HQ
```bash
cd onderneming/hq
npm ci
npm run typecheck && npm test && npm run build     # alle drie groen
shellcheck -x ../deploy/*.sh ../deploy/claude-code/*.sh
npm run demo                                       # demo-kantoor: dist/demo/kantoor-demo.html
```
- Node ≥ 22.12; de server en CI draaien Node 24.
- Tests draaien op PGlite en een nep-Paperclip (`test/helpers`). Een echte Paperclip is niet nodig.
- Agents, skills en sjablonen staan als Markdown/YAML in `onderneming/company/`. `dist/main.js bootstrap` zet ze in
  Paperclip.
- Elke rol met een Claude-model heeft een `effort` (Haiku niet). Hoe de agents zijn ingericht en waarom, staat in
  `ONDERZOEK-AGENTS.md`.

## Waar staat wat (`onderneming/docs/`)
- `STAPPENPLAN.md`: alles wat Kalle vroeg, wat af is en wat nog moet.
- `SETUP.md` (installatie), `ARCHITECTUUR.md`, `RUNBOOK.md`, `KOSTEN.md`, `ONDERZOEK-AGENTS.md`, `lessen.md`.

## Klaar is
- Typecheck, tests en build zijn groen.
- De docs en `STAPPENPLAN.md` zijn bijgewerkt.
- Heb je iets geleerd, dan staat er een les in `lessen.md`.
