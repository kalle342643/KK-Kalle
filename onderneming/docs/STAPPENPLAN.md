# Stappenplan

Alles wat Kalle in de chat stuurde, staat hier: wat ermee gebeurde en wat de volgende stap is. Stuurt hij iets
nieuws, dan komt het erbij (regel in `CLAUDE.md`). Niets overslaan, ook niet wat hij tussendoor stuurt.

Deze repository is openbaar. Details van zijn eigen projecten (klanten, KvK, plannen) staan daarom niet hier, maar in
de backlog van dat project. Het kantoor toont die punten onder *Jouw beurt* zodra HQ het project volgt.

Bijgewerkt: 26 september 2026 (21 berichten).

## 1. Nu doen (jij), in deze volgorde
Dit vraagt jouw accounts of geld; dat doet geen agent voor je.

1. [ ] **PR [#3](https://github.com/kalle342643/KK-Kalle/pull/3) mergen** (of zeg dat ik het doe).
2. [ ] **Server** kiezen en `setup-vps.sh` draaien: Oracle Always Free, je eigen pc of Hetzner
   ([SETUP.md](SETUP.md), stap 1–2).
3. [ ] **Tailscale** koppelen: `tailscale up` (stap 3).
4. [ ] **Paperclip** inrichten, met een Anthropic-sleutel met een maandlimiet in de Console (stap 4).
5. [ ] **Board-sleutel** voor HQ (stap 5) en **Telegram-bot** (stap 6).
6. [ ] **`hq.env`** invullen, controleren, bootstrap en starten (stap 7–8).
7. [ ] **Eerste tak**: `dist/main.js branch games games "Games-studio"` (stap 9), en de testlijst van stap 10.
8. [ ] **GitHub-token** met alleen leesrechten, via het vooraf ingevulde formulier (stap 11). Daarna volgt HQ je
   projecten vanzelf.
9. [ ] *(Optioneel)* **Gratis AI**: een Groq-sleutel is genoeg om te beginnen (SETUP, *Gratis AI*).
10. [ ] *(Optioneel)* **Claude Code live in het kantoor**:
    - in de cloud: `sudo bash …/deploy/claude-code/cloud-hook.sh`, dan plakken wat het toont;
    - op je computer: `install-hook.sh`.
11. [ ] *(Optioneel)* **`claude-code-setup`** in je eigen Claude Code: `/plugin install claude-code-setup@claude-plugins-official`.
    Vraag in elk project één keer "recommend automations for this project" (zie §4).

## 2. Je bouwplan van 23 september, per fase
Uit je onderzoek en bouwplan. Je gaat pas door als het exit-criterium gehaald is, niet op een datum.

| Fase | Wat | Exit-criterium | Stand nu |
|---|---|---|---|
| 1. Game-pijplijn | Fluxgrid in een repo die Claude Code met claude-code-action afwerkt; tweede game uit dezelfde template | 2 games live op CrazyGames, eerste omzet of speeldata | **Nog niet begonnen**: de Fluxgrid-repo is nog leeg. Zie de eerste stappen hieronder |
| 2. Controlesysteem + dashboard | Server met Paperclip, kostenplafond en Telegram; database; agents met naam en rol | Een game-cyclus draait zonder je pc; jij klikt alleen "publiceren" | **Gebouwd** (HQ, Telegram, noodstop, kantoor). Wacht op de server (§1) |
| 3. Ideeënraad + experiment-motor | Gedeeld geheugen met Graphify, verkenners, criticus, analist; 1 game per week | 6 experimenten met echte kosten en omzet, minstens 1 KEEP, voorspelling naast resultaat | **Gebouwd**. Draait zodra de games-tak staat |
| 4. Tweede tak (scanner-SaaS) | Scanner-MVP, eigen ideeënraad, landingspagina en gratis scans | ≥ 10 aanmeldingen of een betalende klant | **Sjabloon `saas` klaar**. Het product zelf is je eigen project in de werkplaats |
| 5. HQ + portfolio-agent | HQ met ROI per tak, kantoor, CEO die wekelijks budget verdeelt, Agent Factory | 4 weken voorstellen die je grotendeels goedkeurt | **Gebouwd**. Telt vanaf de eerste weken met echte cijfers |

**Eerste stappen uit je plan (Fluxgrid):**
- [ ] De Fluxgrid-repo krijgt een `CLAUDE.md` met stack, regels en wanneer iets klaar is. De repo bestaat al, maar is
  nog leeg.
- [ ] Fluxgrid opdelen in 10–15 issues die elk in één sessie af kunnen.
- [ ] claude-code-action installeren. Jij zet de Anthropic-sleutel, met een limiet van €20, als secret.
- [ ] De eerste 3 issues laten oppakken, en de PR's vanaf je telefoon bekijken.
- [ ] CrazyGames-developeraccount (jij) en de uploadvereisten. De vereisten staan al in de skill `productkwaliteit`.
- [ ] KvK-inschrijving uitzoeken voor zodra er omzet komt (jij).

**Hoe je begint:** open een Claude Code-sessie op de Fluxgrid-repo en plak de Fluxgrid-prompt uit je plan ("Je bent de
lead developer van mijn game-studio …"). Of geef de opdracht in het kantoor: 🛠️ *Werkplaats* → project → *Opdracht
voor Claude Code*.

**Het eindbeeld uit je plan**, en hoe het nu werkt:
- 08:00 dagrapport in Telegram;
- knoppen om te publiceren en om de ideeën van de raad te kiezen;
- op maandag het portfolio-voorstel;
- per agent wat hij doet en kost (in het kantoor);
- `/stop` en `/status`.

Dat is allemaal gebouwd. Het draait zodra de server staat.

## 3. Alles wat je stuurde
| # | Datum | Wat je stuurde | Wat ermee gebeurde | Stand / volgende stap |
|---|---|---|---|---|
| 1 | 23 sep | Onderzoek en bouwplan: Paperclip als basis, 5 fasen, tools, kosten, regels, eerste stappen | Basis van alles: HQ is rond Paperclip gebouwd | Per fase: §2. Per tool: §5 |
| 2 | 23 sep | "Jij bouwt het programma, niet het agentwerk", en je doel (zie de uitsplitsing hieronder) | Geen agentwerk meer, alleen het systeem | Per doel: zie hieronder |
| 3 | 23–24 sep | "Try again", "Ja doe maar", "top" | Akkoord om door te gaan | — |
| 4 | 24 sep | "Is alles nu klaar? Wat is het product?" | Uitgelegd; [README](../README.md) beschrijft het product | — |
| 5 | 24 sep | Een 3D-kantoor met poppetjes die rondlopen en overleggen, Graphify als kamer, agents die info gaan halen; een gratis alternatief voor Hetzner | Kantoor gebouwd, met een kennisbank-hologram waar agents naartoe lopen. Gratis servers: Oracle Always Free of je eigen pc | ✔ Gratis server: §1 |
| 6 | 24 sep | Op werknemers klikken, een naam geven, zien waar ze mee bezig zijn; een overzicht van alle projecten; cijfers bij de agent die je berichten stuurt | Profiel met naam en werk, projectenbord, controlekamer met cijfers, de HQ-bot | ✔ |
| 7 | 24 sep | Open-source kantoren (Claw3D, Axial Studio, The Delegation, AI Town, Generative Agents) en 5 foto's (OpenClaw-kantoor, Axial, creative studio van Valeri, The Delegation, "3D AI Ecosystem") | Eigen three.js-kantoor met Kenney-poppetjes (CC0). Overgenomen: kamers per soort werk, kanbanbord, GitHub-projecten koppelen, taak geven, verzoekenlijst, een afdeling per tak, model per agent | Niet overgenomen: "auto-approve" per team (geld en publicaties blijven bij jou) |
| 8 | 24 sep | Een knop om het kantoor uit te zetten als dat tokens kost; Graphify en skills echt gebruiken; "omni" met veel gratis AI | Het kantoor kost 0 tokens, dus geen knop nodig. Agents gebruiken `hq kennis` en `hq-graaf`, en HQ doet vooronderzoek. Gratis AI via OmniRoute, binnen de voorwaarden | ✔ Graphify pas vanaf 100 notities |
| 9 | 24 sep | Agents moeten het web gebruiken; alles via dit systeem doen; Claude Code-werk (bv. je scanners) moet je in het kantoor zien | Web-skills en tools voor elke agent. De werkplaats toont Claude Code-sessies en hun helpers live | ✔ Hook: §1 punt 10 |
| 10 | 24 sep | Opfrissing van je eigen project, met fasen voor jou en voor Claude | Privé: dat staat in de backlog van dat project | Het kantoor toont jouw punten onder *Jouw beurt* |
| 11 | 24 sep | Controle: heeft alles wat de poppetjes doen nut? Overleg, Graphify, onderzoek op Reddit, Claude Code zo goed mogelijk gebruiken | [Onderzoek deel 1](ONDERZOEK-AGENTS.md). Pitcher weg, dagelijkse analyse uit, nut-meter, onderzoeker- en reviewer-helpers | ✔ |
| 12 | 24 sep | "Wat jij moet doen"-lijst, "doe dit voor mij", "gebruik omni gewoon", "agents met naam doen iets, zonder naam niks" | PR #2 gemerged. OmniRoute ingericht. De nut-meter pauzeert wie niets doet; figuranten zonder naam kosten niets | ✔ |
| 13 | 24 sep | "Maak alles beter en perfecter, functie boven hoe cool" | Eerlijk kantoor zonder nep-overleg, acties in de panelen, live klik-test, demo opnieuw | ✔ |
| 14 | 24 sep | Setup-lijst (server, token, projecten volgen, hook in de cloud, gratis AI) en "doe zoveel hiervan" | Projecten volgen gaat vanzelf; `cloud-hook.sh` doet de hook in één keer | De rest vraagt jouw accounts: §1 |
| 15 | 24 sep | Onderzoek naar de ideale opzet: agents die zelf iets bedenken (website, game, blog); zijn ze zuinig ingericht; weet de agent-fabriek dit? | [Onderzoek deel 2](ONDERZOEK-AGENTS.md#deel-2-de-ideale-opzet-september-2026). Denkstand per rol, bouwen met keuring, een betere ideeënraad, de Agent Factory controleert de bezetting | ✔ In PR #3 |
| 16 | 24 sep | "Typesafe JS, dat AI-model, is dat handig?" | Uitgezocht: Jev van TypeSafe AI, plus TypeScript voor AI-code | Bouwers schrijven TypeScript met `strict` |
| 17 | 25 sep | Wat Jev is, met "sla dit ook op" | Opgeslagen in het onderzoek (deel 2, §7) en in [lessen](lessen.md) | Later: §4 |
| 18 | 25 sep | Kimi Work en zwermen; alle gratis modellen; elk model een eigen agent; open-source modellen | Uitgezocht. Cerebras eruit (niet meer gratis), lijsten van Groq en OpenRouter bijgewerkt | Kimi en de rest: §4 |
| 19 | 25 sep | De "everything Claude"-skill | Niet bij jouw repositories gevonden; het openbare origineel bekeken. Niet installeren; 3 ideeën overgenomen | Bedoelde je een andere? Stuur de link |
| 20 | 26 sep | `/plugin install claude-code-setup@claude-plugins-official`, en "alles in het stappenplan" | Dit stappenplan. De plugin-analyse op deze repo gedaan: `CLAUDE.md` erbij, met de regel dat alles hier komt | Jouw projecten: §1 punt 11 en §4 |
| 21 | 26 sep | Screenshot: "Anthropic's gratis gids van 37 minuten over agents" (*Ship your first Managed Agent*, Isabella He) | Uitgezocht: Claude Managed Agents, Anthropics eigen platform dat agents in hún cloud draait (met schema's, een keurder met rubric, een budget per sessie, geheugen en een kluis). Paperclip kan het al gebruiken. De talk en de code zijn gratis: je hoeft niet te reageren | Kijk de [talk](https://claude.com/code-with-claude/session/ldn-ext-ship-your-first-managed-agent) als je wilt. Overstappen: nu niet (§4) |

**Je doelen uit bericht 2:**
- **CEO-agent:** ✔ Atlas, met een weekplan en elke maand een kansenverkenning.
- **Agent Factory:** ✔ nieuwe agents en takken uit sjablonen, met een controle van de bezetting.
- **Takken:**
  - ✔ games, content en affiliate, SaaS/software;
  - kleding/e-commerce, digitale producten en B2B-automatisering starten als tak `generiek`, via de CEO of met
    `branch`.
- **Experimenteren**, budget naar wat werkt, leren: ✔ experiment-motor, portfolio en lessen.
- **24/7 in de cloud:** zodra de server staat (§1).
- **Updates op je telefoon:** ✔ via Telegram. WhatsApp kan ook, alleen voor meldingen (betaald, via Meta).
- **Controle:** ✔ goedkeuringen, plafonds en de noodstop.
- **Claude Code maximaal gebruiken:** ✔ werkplaats, helpers en hooks.
- **Kosten €20–50 per maand:** ✔ zie [KOSTEN.md](KOSTEN.md).
- **Van 1 naar 100+ agents:** technisch is dat configuratie. Economisch gebeurt het pas als de takken het betalen.

## 4. Later: wanneer het wél zin krijgt
| Wat | Nu? | Wanneer wel |
|---|---|---|
| **Kimi K2.6 / K3 / Kimi Work** | Nee. Nergens meer gratis, en Kimi Work draait in jouw ingelogde browser (dat mogen agents niet) | Als de bouwkosten gaan knellen: K2.6 kost ongeveer wat Haiku kost en werkt met Claude Code (betaald, data naar Moonshot). Paperclip heeft er ook een eigen adapter voor (`kimi-local`), per agent in te stellen |
| **Claude Managed Agents** (Anthropic draait de agent in zijn cloud) | Nee. HQ en de agents draaien al op Paperclip; het is nog beta; je betaalt API-tarieven plus $0,08 per uur looptijd | Als de bouwer te zwaar wordt voor je gratis server, of voor je eigen producten (bv. geplande scans). Paperclip kan een agent al zo laten draaien (een "managed agent profile", nu alleen voor Sonnet 5). De keuring met een rubric en de hooguit twee rondes zitten er ook in |
| **Elk model een eigen agent** | Nee. Meer agents kosten meer en praten langs elkaar heen | Een ander model als tegenstem bij grote beslissingen; eventueel de criticus als proef op een ander model |
| **Gratis modellen** | Ja, ingericht (zes aanbieders) | Draai `gratis-ai --schrijf` af en toe opnieuw: het aanbod wisselt vaak |
| **Open modellen op je eigen server** | Nee. Te traag voor agents zonder videokaart | Voor nachtwerk (Graphify) als de kennisbank groot is |
| **Jev (TypeSafe AI)** | Nee. Aanmelden staat dicht en er is geen massawerk | Als een tak duizenden reviews, reacties of mails moet sorteren |
| **TypeScript** | Ja, staat aan: bouwers schrijven TypeScript met `strict` | — |
| **everything-claude-code** | Niet installeren (honderden skills kosten in elke sessie tokens) | Voor je eigen projecten: kopieer hooguit één losse skill, zoals `loop-design-check` |
| **`claude-code-setup` (plugin)** | Ja, één keer per project. Klein, van Anthropic zelf, en verandert niets zelf | Voor KK-Kalle al gedaan: `CLAUDE.md` erbij (zie hieronder) |
| **context7 (MCP)** | Optioneel voor je eigen codeersessies | Als Claude oude API's van een library gebruikt (zod 4, three.js en Hono veranderen vaak) |
| **Playwright (MCP)** | Optioneel | Als je Claude Code zelf door het kantoor of een game wilt laten klikken; in de holding doen scripts dat al |
| **Een startscript voor cloud-sessies (SessionStart-hook)** | Nee | Als cloud-sessies vaak eerst `npm ci` moeten draaien voor de tests |

**Wat `claude-code-setup` voor KK-Kalle vond:**
- TypeScript (Hono, zod, three.js), Vitest, GitHub Actions. Er was nog geen `CLAUDE.md` en geen `.claude/`.
- Aanbevolen en gedaan: een korte `CLAUDE.md` met de regels, de commando's en wanneer iets klaar is.
- Bewust niet gedaan:
  - een hook die na elke bewerking de types controleert (duurt ±20 s per keer; CI doet het al);
  - extra helpers (de onderzoeker en reviewer bestaan al via `install-hook.sh`).

## 5. De tools uit je plan
| Tool | In je plan | Nu |
|---|---|---|
| Paperclip | kern: organigram, budget, heartbeats, goedkeuringen | ✔ in gebruik |
| Claude Code (CLI + Agent SDK) | het echte werk | ✔ via de `claude_local`-adapter van Paperclip |
| claude-code-action | fase 1, Fluxgrid | open (zie §2) |
| paperclip-plugin-telegram | meldingen en knoppen | vervangen door de eigen Telegram-bot van HQ (knoppen, `/status`, `/stop`) |
| Paperclip-UI + Agent Pixels | dashboard, pixel-kantoor | eigen 3D-kantoor en HQ-dashboard; Agent Pixels niet (geen duidelijke licentie) |
| Mission Control | reserve | niet nodig |
| LiteLLM | kostenplafond | plafonds via Paperclip en de noodstop van HQ; gratis AI via OmniRoute |
| /last30days | verkenners | ✔ als `hq-trends`, alleen via open API's |
| Crawl4AI + Playwright | web | ✔ als `hq-web` (Crawl4AI) |
| Obsidian-vault + Graphify | gedeeld geheugen | ✔ vault en Graphify, pas vanaf 100 notities |
| Supabase | database | optioneel (standaard een lokale Postgres) |
| Langfuse | observability (fase 4) | later: de kosten uit Paperclip en de nut-meter volstaan nu |
| axe-core | scanner-tak | bij de tweede tak |
| Phaser | games | alleen als het tijd scheelt; eerst TypeScript en canvas |
| HyperFrames | trailers en shorts | nog niet gekoppeld; de publicist maakt beelden uit het product zelf |
| Claude Ads | advertenties | pas bij betaalde advertenties (via een uitgaveverzoek) |
| OpenClaw | persoonlijke agent | bewust niet: groot aanvalsoppervlak |
| Ruflo | zwermen om te bouwen | niet nodig: overlapt met Paperclip |
| X API | verkenner voor de scanner-tak | later, betaald (±€10 per maand, met limiet); nooit scrapen met je eigen account |
| Google Trends API | zoekwoorden | later (alpha, aanmelden) |
| Camofox | als een site blokkeert | bewust niet: blokkades omzeilen mag niet |
| WhatsApp | updates | optioneel, alleen meldingen; beslissen blijft in Telegram |
| Stripe | omzet | optioneel: een sleutel met alleen leesrechten, elk uur import |

## 6. Vaste regels (van jou)
- Publiceer nooit iets op CrazyGames en maak geen accounts aan. Dat doe je zelf.
- Vraag nooit om wachtwoorden of betaalgegevens. Alleen API-sleutels die je zelf als secret instelt.
- Twijfel over scope, of een keuze die later moeilijk terug te draaien is? Een korte vraag in plaats van gokken.
- Houd bij wat werkte en wat niet in [lessen.md](lessen.md): dat is later het geheugen van je agents.
- Alles wat je in de chat stuurt, komt in dit stappenplan. Niets overslaan.
