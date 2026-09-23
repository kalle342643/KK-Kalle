# Lessen

Wat werkte en wat niet. Dit bestand is ook geheugen voor agents (en voor een volgende Claude Code-sessie):
lees het voordat je iets aan het systeem verandert.

## Werkwijze
- **Eerst het controlesysteem, dan het agentwerk.** Onderaan het plan stond een prompt voor een latere fase
  (Fluxgrid bouwen). Ik begon daar per ongeluk mee (marktonderzoek naar game-ideeën) in plaats van aan het
  systeem om agents aan te sturen. Les: bij een lang document eerst vaststellen welke fase nu aan de beurt is.
- **Bouwen tegen de echte API, niet tegen documentatie.** Paperclip lokaal draaien en `/api/openapi.json` ophalen
  leverde veel op. Een paar details stonden niet in de docs (zie hieronder).
- **Kleine stappen met tests** (79 tests, PGlite als in-memory Postgres, een nep-Paperclip) en daarna end-to-end
  tegen een echte Paperclip. De e2e-test vond twee fouten die de unit-tests misten: het icoon en de skills-lijst.

## Paperclip (getest met versie 2026.916.1)
- Met `requireBoardApprovalForNewAgents` weigert Paperclip directe aanmaak (`POST /agents`). Gebruik
  `POST /agent-hires`: dat geeft een agent met status `pending_approval` en een `hire_agent`-approval.
- Alleen de CEO krijgt automatisch Paperclips eigen skills. Andere agents krijgen `paperclip` en
  `para-memory-files` alleen als je ze expliciet in `desiredSkills` zet.
- `icon` moet uit een vaste lijst komen (`compass` bestaat niet, `target` wel); anders volgt een `400 Validation error`.
- De skills-lijst (`GET /skills`) bevat de inhoud niet; `GET /skills/{id}` wel. Inhoud wijzigen:
  `PATCH /skills/{id}/files` met `{path: "SKILL.md", content}`. Een PATCH op de skill zelf verandert de inhoud niet.
- Een harde budgetstop maakt een **incident** en een `budget_override_required`-approval, en pauzeert het project of de
  agent. Los je het incident op (`raise_budget_and_resume` of `keep_paused`), dan wordt de approval automatisch
  goed- of afgekeurd.
- Bedrijf op `paused`: nieuwe wake-ups worden geweigerd (`409 Company is not active`), maar **lopende runs gaan door**.
  De kill switch breekt ze daarom apart af (`POST /heartbeat-runs/{id}/cancel`).
- Een taak toewijzen aan een agent maakt hem meteen wakker (er start een run).
- `adapterConfig.env` wordt opgeslagen als `{type: "plain", value}` en bij uitlezen verborgen.
- Hetzelfde `idempotencyKey` met andere invoer geeft een fout.
- Het standaardmodel van `claude_local` is `claude-opus-5`. Zet per rol **altijd** expliciet een model, anders draait
  alles op het duurste model.
- `GET /costs/by-project?from=…&to=…` werkt per tijdvak: zo boekt HQ de kosten per dag per experiment.
- Elke agent-PATCH maakt een nieuwe configuratieversie. Bootstrap werkt daarom alleen bij als een vingerafdruk van het
  sjabloon veranderde.
- Paperclips ingebouwde Postgres wil niet als root draaien. Op de server draait alles als gebruiker `ai`.
- Claude-toegang voor agents loopt via de **AI-verbinding** van de eigenaar (API-sleutel of abonnement). Agents
  gebruiken standaard die van hun verantwoordelijke gebruiker.

## De eerste echte agent-runs (lokale test, 23 september)
In de testomgeving pakte Paperclip de Claude-toegang van de sandbox op en draaiden agents echt, zonder dat dat de
bedoeling was. Wat dat opleverde:
- **Het werkt zoals ontworpen.** Vega en Argus logden in bij HQ met `$PAPERCLIP_API_KEY` en gebruikten `$HQ_URL`.
  Vega vroeg na de KEEP opschaalbudget aan, met een onderbouwing uit de cijfers. Argus schreef een les waarin hij
  de voorspelling (700 plays) naast de uitkomst (650) legde en taggde met `voorspelling`.
- **Paperclip maakt agents wakker bij elke toewijzing én bij elk besluit over hun verzoek.** Elke ✅/❌ kost dus een korte
  run van de aanvrager. Houd daar rekening mee in de kosten.
- **Dubbele verzoeken:** Vega vroeg in twee runs twee keer opschaalbudget voor hetzelfde experiment. HQ weigert nu
  een tweede open budgetverzoek per experiment (`409`).
- **Testomgevingen kunnen echt geld of tegoed verbruiken** als er Claude-toegang in de omgeving staat. Test met het
  bedrijf op pauze, of in een omgeving zonder sleutels.
- Een deel van de runs faalde met *"terminal limit failure"*: een limiet op de sandbox-toegang bij meerdere runs
  tegelijk, geen fout in de prompts.

## Techniek
- `node-postgres` wil in een socket-URL een gebruikersnaam: `postgresql://ai@/hq?host=/var/run/postgresql`.
- Een env-bestand met cron-waarden (`0 8 * * *`) kun je niet in bash `source`n. Zet aanhalingstekens en laat Node het
  lezen (`node --env-file=…`). systemd leest hetzelfde bestand ook goed.
- Intl zet een harde spatie tussen `€` en het bedrag. Houd daar rekening mee in tests.
- Een headless Chrome-screenshot met `--window-size=390` gaf een vertekend beeld. Playwright met een echte
  mobiele viewport liet zien dat het dashboard op 390 px goed past.

## Strategie (uit het onderzoek, nog te bewijzen)
- AI is slecht in echte gaten in de markt vinden. Daarom: bewijslinks verplicht, een criticus die ≥ 3 van de 5 pitches
  afschiet, en niets boven €20 zonder gemeten resultaat.
- Veel kopieën van hetzelfde model bevestigen elkaar vooral. Voeg alleen agents toe met een eigen bron of een
  tegengestelde rol.
- Geld is data: omzet alleen uit externe bronnen, nooit uit een agent.

## Nog niet in het echt getest
- Het installatiescript op een echte VPS: wel gecontroleerd met shellcheck, en losse onderdelen getest
  (socket-URL, back-up, env-bestand).
- De Telegram-bot tegen de echte Telegram-API: de logica is getest met een nep-transport, de API-aanroepen met
  een nep-fetch.
- WhatsApp tegen Meta en Stripe tegen de echte API: alleen met nep-antwoorden getest.
- **Langere agent-runs:** alleen een paar korte runs zijn echt gedraaid (zie hierboven). Kijk bij de eerste weken
  mee in de Paperclip-UI (run-logs) hoe de ideeënraad en de bouwer het doen, en schaaf de skills bij.
