# Lessen

Wat werkte en wat niet. Dit bestand is ook geheugen voor agents (en voor een volgende Claude Code-sessie):
lees het voordat je iets aan het systeem verandert.

## Werkwijze
- **Eerst het controlesysteem, dan het agentwerk.** Onderaan het plan stond een prompt voor een latere fase
  (Fluxgrid bouwen). Ik begon daar per ongeluk mee (marktonderzoek naar game-ideeën) in plaats van aan het
  systeem om agents aan te sturen. Les: bij een lang document eerst vaststellen welke fase nu aan de beurt is.
- **Bouwen tegen de echte API, niet tegen documentatie.** Paperclip lokaal draaien en `/api/openapi.json` ophalen
  leverde veel op. Een paar details stonden niet in de docs (zie hieronder).
- **Kleine stappen met tests** (PGlite als in-memory Postgres, een nep-Paperclip) en daarna end-to-end
  tegen een echte Paperclip. De e2e-test vond twee fouten die de unit-tests misten: het icoon en de skills-lijst.
- **CI startte pas bij de tweede push.** De push die de workflow toevoegde, gaf geen GitHub Actions-run; de
  volgende push wel. Zie je geen run, kijk dan na de volgende push opnieuw voordat je concludeert dat Actions
  uit staat.

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

## Het 3D-kantoor (24 september)
- **Eerst kijken wat er al is.** Claw3D, AI Town, Generative Agents, Axial Studio, The Delegation en Pixel Agents
  vergeleken (zie ARCHITECTUUR.md). Geen ervan past op Paperclip + HQ zonder een tweede systeem ernaast; de ideeën
  (kamers met live status, projectenbord, kluis, logboek) wel. Een eigen lichte three.js-weergave in HQ was
  minder werk dan een koppeling onderhouden.
- **Meten, niet gokken.** De Kenney-poppetjes hebben een `sit`-animatie voor op de grond (heupen op 4 cm). Op een
  stoel moet het poppetje omhoog met de zithoogte (bureaustoel 0,37 m, barkruk 0,70 m). Zithoogtes, planken en
  afmetingen zijn gemeten met raycasts op de modellen; de modellen kijken naar +z.
- **Screenshots per kamer vonden fouten die tests niet zien:** vloer en sokkel op dezelfde hoogte (flikkeren),
  naamlabels boven de panelen (CSS2DRenderer geeft labels een z-index: geef de 3D-laag een eigen stapel-laag),
  `display: flex` wint van het `hidden`-attribuut (zet `[hidden] { display: none !important }`), één afdeling
  alleen in een enorme zaal (rijen gelijk verdelen), en iedereen die tegelijk "gepauzeerd" roept bij het laden
  of bij een noodstop.
- **Een losse pagina (artifact) is streng:** geen WebAssembly en geen `fetch` van `blob:`/`data:`-adressen. De demo
  heeft daarom ongecomprimeerde modellen (base64, uitgepakt met `atob`) en laat three.js texturen via `<img>`
  laden. De meshopt-uitpakker wordt alleen geladen als het nodig is.
- three.js r186: `PCFSoftShadowMap` bestaat niet meer (wordt `PCFShadowMap`), `Clock` is vervangen door `Timer`.
- **Paperclip-projecten:** de idempotency-sleutel bevat nu ook het aanmaakmoment van het experiment. Met alleen
  `hq-exp-<id>` botste een nieuwe EXP-1 (na een lege HQ-database) met het oude project: `409`.
- Paperclip wil Node 24.11 of nieuwer; op Node 20 weigert `paperclipai run` te starten (doctor).
- Paperclip-activiteit (`GET /companies/{id}/activity`) komt nieuwste eerst. Reacties zijn `issue.comment_added`
  (tekst in `details.bodySnippet`), nieuwe taken `issue.created`, sollicitanten `agent.hire_created`, budgetstops
  `budget.hard_threshold_crossed`. Tokens en kosten van een run staan in `usageJson` van `/heartbeat-runs/{id}`.

## Agents op het web, werkplaats en gratis AI (24 september)
- **Paperclip start agents met een kaal PATH.** De service (`paperclipai service install`) zet alleen de map van
  Node en het standaard-PATH van systemd klaar; `~/.local/bin` en `~/.npm-global/bin` ontbreken. Commando's die
  agents nodig hebben (`hq`, `hq-web`, `hq-trends`, `hq-graaf`, `graphify`, `crwl`, `claude`) zet setup-vps.sh
  daarom als symlink in `/usr/local/bin`. Les: test een tool altijd zoals de agent hem aanroept, niet in je eigen shell.
- **Webtools: controleer zelf de regels.** Crawl4AI heeft `check_robots_txt`, maar achter een proxy haalde het
  robots.txt niet op en las het Reddit gewoon (terwijl Reddit alles verbiedt). `hq-web` controleert robots.txt nu
  zelf (RFC 9309: 4xx = geen regels, 5xx of geen verbinding = niets lezen) en weigert interne adressen.
- **last30days is standaard niet netjes genoeg.** Zonder sleutels scrapet het DuckDuckGo en Startpage (met een
  omweg als DuckDuckGo blokkeert) en leest het Reddit via omwegen, want Reddit blokkeert zijn eigen zoek-API. Dat
  is blokkades omzeilen. `hq-trends` gebruikt daarom alleen Hacker News (Algolia-API), GitHub en Polymarket
  (open API's), zet de eigen webzoekfunctie uit (`--web-backend none`) en filtert tips naar scrapers weg. Niet als
  Claude Code-skill installeren: de SKILL.md stuurt agents naar precies die bronnen.
- **Wat een agent doet staat in het run-logboek.** Paperclip bewaart per run een JSONL-logboek
  (`GET /heartbeat-runs/{id}/log?offset=…`, regels `{ts, stream, chunk}`). Bij de ACP-engine (standaard) staan daar
  regels `{"type":"acpx.tool_call","name":…,"input":{…}}` in, bij de CLI-engine stream-json. Stream-json kan midden in
  een regel knippen: bewaar het onafgemaakte stuk tot de volgende chunk. Zo ziet het kantoor "🔎 zoekt: …" zonder
  hooks op de server.
- **Claude Code in de cloud tekent zijn commits.** Elke commit krijgt `Claude-Session: https://claude.ai/code/session_…`.
  Daarmee koppelt HQ commits, branch en pull request aan één sessie, zonder iets in die repositories te veranderen.
  Getest tegen de echte GitHub-API met deze repository: HQ zag deze sessie, 14 commits, PR #2 en groene tests.
- **GitHub-limiet sparen met ETags.** Een verzoek met `If-None-Match` dat 304 teruggeeft, telt niet mee. Per
  project volgt HQ alleen de hoofdbranch, `claude/…`-branches en branches van open PR's.
- **Tekst in meldingen niet te grondig opschonen.** De opschoonfunctie voor Paperclip-reacties haalde alle `#` en
  `_` weg; daardoor werd "PR #7" "PR 7" en `BEDRIJF_KVK` "BEDRIJFKVK". Nu alleen echte Markdown-opmaak weg.
- **LiteLLM: `order` + `allowed_fails: 0` + `num_retries` = doorschakelen.** Met een nep-aanbieder die altijd een
  limietfout geeft (`mock_response: litellm.RateLimitError`) antwoordde de tweede, zowel in OpenAI- als in
  Anthropic-formaat (`/v1/messages`). Claude Code zelf werkt via de router (`ANTHROPIC_BASE_URL`), maar kent de
  modelnaam "gratis" niet en rekent dan op 200k context: zet `CLAUDE_CODE_MAX_CONTEXT_TOKENS` lager.
  (Later vervangen door OmniRoute, zie hieronder; de les over de context blijft gelden.)
- **Gratis ≠ vrij van regels.** OmniRoute kan abonnementen en accounts stapelen; dat schendt de voorwaarden van de
  aanbieders. Hier: één eigen sleutel per aanbieder. Cohere-proefsleutels zijn niet voor commercieel gebruik (niet
  opgenomen); Mistral (Experiment) en sommige OpenRouter-modellen kunnen je gegevens gebruiken: dat staat erbij.
- **`pkill -f` doodt je eigen shell** als het patroon ook in je eigen commando staat (exit 144, drie keer gebeurd,
  ondanks deze regel). Stop processen op PID: `ps -eo pid,args | awk '$2=="node" && $3=="x.mjs" {print $1}' | xargs -r kill`.

## Controle en helpers (24 september, avond)
Het hele onderzoek staat in [ONDERZOEK-AGENTS.md](ONDERZOEK-AGENTS.md). Wat we ervan leerden:
- **Een extra agent moet iets meebrengen:** een eigen bron, een tegengestelde rol of een frisse blik. De pitcher had
  geen van drieën en is uit de sjablonen. De dagelijkse analyse deed dubbel wat HQ al zonder AI doet. De CEO en de
  ideeënraad draaien niet meer als er niets te doen is.
- **Meet nut, gok het niet.** De nut-meter zet per agent de kosten naast wat terug te vinden is in HQ. Een voorstel
  maakt zelf ook een verzoek aan: niet dubbel tellen.
- **Reddit is niet te lezen voor Claude.** Het blokkeert de crawler van Anthropic, en scrapen mag niet. Hacker News
  heeft een open API (`hn.algolia.com/api/v1/search`, `/items/{id}` voor reacties).
- **Helpers van Claude Code (sub-agents) zijn te volgen met hooks.** `PreToolUse` van de tool `Agent` heeft de
  omschrijving en de soort (`subagent_type`), `SubagentStart` en `SubagentStop` hebben `agent_id` en `agent_type`, en
  elke tool-hook binnen een helper heeft ook `agent_id`. Getest met de echte Claude Code (2.1.281) tegen een nep-model:
  1. `SubagentStart` komt na `PreToolUse(Agent)`, zonder omschrijving; HQ koppelt ze op soort.
  2. Helpers draaien standaard op de achtergrond: de sessie meldt `Stop` terwijl de helper nog werkt. Het kantoor
     zegt dan "wacht op een helper".
  3. Als de helper klaar is, komt er een `UserPromptSubmit` met `<task-notification>…`. Dat is geen opdracht van
     jou, dus de hook stuurt het niet door.
- **Een geheim-filter heeft grenzen nodig.** `sk-[…]{10,}` zonder `\b` poetste "task-notification" en "risk-analyse"
  half weg. Nu alleen aan het begin van een woord.
- **Een helper leeft kort: laat hem niet door het hele kantoor lopen.** Vanaf de voordeur duurde de wandeling langer
  dan de helper bestond. Nu verschijnt hij naast zijn sessie.
- **Screenshots liegen over snelheid.** De headless browser (SwiftShader) haalt ±2,7 beelden per seconde, en het
  kantoor begrenst de tijd per beeld. Tekstballonnen en lopen duren in screenshots dus veel langer dan in een echte
  browser. Meet met `requestAnimationFrame` voordat je iets "te traag" noemt.
- **Een openbare repo, ook in tests.** In de testbestanden stonden de naam van een privé-repository, een branch en
  een adres van een eigen project. Nu neutrale voorbeeldnamen. Zoek vóór elke commit ook in `test/` op privénamen.

## OmniRoute als gratis router (24 september, avond)
- **Beheer via REST, niet via de CLI.** Na `POST /api/auth/login {password}` (zet een cookie) gaat alles via
  `/api/providers` (sleutels), `/api/combos` (de volgorde van doorschakelen) en `/api/keys` (veld `name`, niet
  `label`). De CLI-opdracht `setup` las de `.env` uit het npm-pakket en zette een ander wachtwoord; daarna lukte
  inloggen niet meer. Nu: `INITIAL_PASSWORD` bij de eerste start en verder alleen REST (`hq gratis-ai --schrijf`).
- **De catalogus kent soorten aanbieders:** api-key (233), oauth (25, abonnementen), web-cookie (35, chatsites met je
  inlog) en noauth (13). HQ zet alleen api-key-aanbieders van een vaste lijst in de combo en noemt bij de rest waarom
  niet. Zo kan niemand per ongeluk een abonnement of een ingelogde chatsite laten meedraaien.
- **`STORAGE_ENCRYPTION_KEY` nooit veranderen.** OmniRoute versleutelt de opgeslagen sleutels ermee; een nieuwe
  waarde maakt ze onleesbaar. setup-vps.sh maakt hem één keer en laat hem daarna staan.
- **HQ krijgt een eigen sleutel zonder compressie en zonder log.** OmniRoute kan prompts "comprimeren"; dat verandert
  wat een agent leest. En prompts hoeven niet in de router bewaard te worden.
- **Test een lokale router met `env -i`.** In deze sandbox stonden eigen `CLAUDE_*`-variabelen; Claude Code kreeg
  daardoor 401 van de router terwijl de sleutel goed was.
- **Het pakket is groot (±2 GB, een complete Next.js-build).** Op een kleine server eerst de schijf controleren.
- Getest met de echte OmniRoute 3.8.50: doorschakelen van A (429) naar B in OpenAI- en Anthropic-formaat, ook
  streaming, en `gratis-ai --schrijf`: 20 modellen in de combo, en bij een tweede run blijft de sleutel dezelfde.

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
- **Het kantoor met echte runs:** getest met de demo en met een echte HQ + Paperclip (verzoek, goedkeuren, naam
  geven, kennisbank), maar nog niet met agents die dagenlang echt werken.
- **Graphify met een echte sleutel** (`graphify extract`): alleen de aanroep en het inlezen van de graaf zijn getest.
- **Een gratis Oracle-server (ARM):** het installatiescript is niet op ARM gedraaid; Node, PostgreSQL, Tailscale en
  Paperclip hebben wel ARM-versies.
- **Webtools op de server:** `hq-web`, `hq-trends` en `hq-graaf` zijn in de sandbox getest (Crawl4AI 0.9.4 met
  Playwright-headless-shell, last30days 3.25.0, Graphify 0.9.67), maar nog niet in een echte agent-run op de server.
- **Het run-logboek in een echte ACP-run:** de lezer is getest met regels zoals de code van Paperclip ze schrijft,
  niet met een echte run. Kijk bij de eerste runs of "🔎 zoekt" en "🌐 leest" in het kantoor verschijnen.
- **Gratis AI met echte sleutels:** OmniRoute is getest met nep-aanbieders (doorschakelen, sleutels, combo), niet
  met echte sleutels van Groq, Gemini en de rest. Welke modellen de aanbieders nu hebben, bepaalt
  `dist/main.js gratis-ai --schrijf` bij het draaien.
- **Hooks vanuit Claude Code in de cloud:** het script en de installatie zijn lokaal getest (geheimen weggepoetst,
  niets naar stdout, altijd exit 0), ook met de echte Claude Code CLI en een helper. De route via Tailscale Funnel
  en de netwerkinstellingen van een cloud-omgeving zijn niet getest.
- **De nut-meter met echte cijfers:** getest met nep-kosten; of €1 in 30 dagen de goede drempel is, blijkt pas als
  de agents echt werken.
- **De helpers `onderzoeker` en `reviewer` in echt werk:** Claude Code laadt ze (getest), maar hoe vaak hij ze uit
  zichzelf inzet en of dat tokens bespaart, moet in de praktijk blijken. Vraag er eventueel zelf om.
