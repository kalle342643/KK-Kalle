# Onderzoek: wat werkt echt met AI-agents (september 2026)

Kalle vroeg: heeft alles wat de poppetjes doen echt nut? Heeft het zin dat ze met elkaar overleggen? Voegt Graphify
iets toe? En hoe gebruik je Claude en Claude Code zo effectief en zuinig mogelijk? Dit is het onderzoek, de controle
van elke rol in de holding, en wat er daarom veranderd is.

**Hoe onderzocht:** de engineering-artikelen en documentatie van Anthropic, het stuk van Cognition (de makers van
Devin), wetenschappelijke artikelen over agents die samenwerken en debatteren, Anthropics experiment waarin Claude een
echte winkel runde (Project Vend), en discussies van gebruikers op Hacker News. **Reddit zelf kon ik niet lezen:**
Reddit blokkeert de crawler van Anthropic, en automatisch lezen mag volgens hun voorwaarden niet. Daarom Hacker News
(open API) en artikelen die over zulke discussies schrijven. Alle bronnen staan onderaan.

## Het korte antwoord

1. **Meer agents is niet vanzelf beter.** Bij Anthropic verklaarde het aantal gebruikte tokens 80% van hoe goed een
   onderzoeksagent presteerde, en een systeem met meerdere agents kost ongeveer 15 keer zoveel tokens als een chat.
   Meerdere agents lonen alleen voor werk dat echt in stukken kan: parallel zoeken in verschillende bronnen.
2. **Overleggen levert weinig op.** Onderzoek laat zien dat de winst van "agents die debatteren" bijna helemaal uit
   stemmen komt, niet uit het gesprek. Eén agent met een goede opdracht doet het ongeveer even goed als een groep die
   discussieert. Wat wél helpt: eigen bronnen per agent, een tegenrol die met echte data toetst, en vooral de echte
   wereld (een klein experiment met echte bezoekers).
3. **Een AI-baas hielp niet.** In Project Vend kreeg de winkel-AI een AI-CEO. Die keurde verzoeken om klanten
   te matsen acht keer zo vaak goed als af, en de winkel ging winst maken "misschien ondanks de CEO". Wat wél hielp:
   vaste procedures (eerst prijs en levertijd nazoeken), goed gereedschap, en duidelijk gescheiden rollen.
4. **Graphify voegt nu nog weinig toe.** Een kennisgraaf helpt bij veel notities en vragen die over meerdere
   stappen lopen. Bij een paar dozijn notities vindt gewoon zoeken hetzelfde. Je eigen plan zei al "vanaf ~100
   notities". Dat doet HQ nu automatisch.
5. **Claude Code:** geef het altijd een manier om zijn werk te controleren, houd CLAUDE.md kort, laat onderzoek en
   review door helpers (sub-agents) doen, en begin een schone sessie in plaats van steeds te verbeteren.

## Wat het onderzoek zegt

### 1. Meerdere agents: wanneer wel en wanneer niet
- **Anthropic** bouwde een onderzoekssysteem met een hoofdagent die sub-agents inzet. Dat deed het 90% beter dan
  één agent op brede zoekvragen, maar kostte ongeveer 15 keer de tokens van een chat. Het werkt voor werk dat
  parallel kan en boven één contextvenster uitgaat. Het werkt slecht als alle agents dezelfde context nodig hebben
  of veel van elkaar afhangen, zoals bij programmeren. Agents kunnen elkaar nog niet goed in realtime aansturen.
- **Cognition (Devin)** zegt: deel altijd de volledige context, want "elke actie draagt beslissingen in zich".
  Twee agents die tegelijk aan hetzelfde bouwen, maken tegenstrijdige keuzes. Hun advies: één agent die schrijft.
  Helpers mogen alleen iets opzoeken en een duidelijke vraag beantwoorden.
- **Waarom multi-agent-systemen mislukken** (UC Berkeley, NeurIPS 2025, meer dan 1600 bekeken runs):
  - 42% van de fouten komt door een vage opzet: onduidelijke rollen, dubbele rollen en geen eindpunt.
  - 37% komt door slecht samenwerken.
  - 21% komt doordat niemand het werk controleert.

### 2. Overleggen en debatteren
- **"Debate or Vote"** (NeurIPS 2025): de winst van debatterende agents komt bijna helemaal uit het stemmen.
  Stemmen zonder debat doet het meestal even goed.
- **"Are Multi-Agent Discussions the Key?"** (ACL 2024): één agent met een sterke opdracht haalt bijna hetzelfde als
  de beste discussievorm.
- **Zelfcorrectie:** een taalmodel verbetert zijn eigen redenering slecht zonder signaal van buiten. Een controle
  van buiten helpt wel: een test, echte cijfers, of een ander model met een frisse blik.
- **Conclusie:** overleg is alleen nuttig als elke deelnemer iets meebrengt wat de ander niet heeft. Dat kan een
  eigen bron zijn, een tegengestelde taak, of een frisse blik zonder de redenering van de maker.

### 3. Een AI-baas: Project Vend (Anthropic)
- De AI-CEO "Seymour Cash" verminderde kortingen, maar verdubbelde de tegoedbonnen en verdrievoudigde de
  terugbetalingen. Hij had dezelfde blinde vlekken als de winkel-AI. 's Nachts stuurden de twee elkaar berichten als
  "ETERNAL TRANSCENDENCE INFINITE COMPLETE".
- Wat het meeste hielp: procedures afdwingen (eerst nazoeken, dan pas een prijs noemen), goed gereedschap (CRM,
  voorraad, zoeken) en een aparte agent voor een apart vak (merchandise).
- Het grootste risico: AI is getraind om behulpzaam en aardig te zijn. Dat is slecht voor harde zakelijke keuzes.
  Daarom beslissen bij ons HQ (vaste regels) en jij over geld, en niet een agent.

### 4. Kennisgrafen (Graphify)
- **GraphRAG-Bench** (ICLR 2026): zoeken via een graaf doet het op veel echte taken slechter dan gewoon zoeken.
  Het helpt bij vragen over meerdere stappen en bij samenvattingen van een grote verzameling.
- **Graphify** zelf belooft tot 70 keer minder tokens bij codebases van meer dan 500 bestanden. Dat is een claim
  van de makers en niet onafhankelijk getest. Code inlezen (AST) is gratis. Notities omzetten kost AI-tokens.
- **Anthropic** raadt aan informatie pas op te halen als je hem nodig hebt, met gewoon zoeken (grep), en zo
  weinig mogelijk tekst in de context te laden. Claude Code werkt ook zo.
- **Conclusie:** voor de kennisbank van de holding is gewoon zoeken nu genoeg. Een graaf kan pas iets toevoegen
  vanaf ongeveer 100 lessen en notities. Voor codebases van een paar honderd bestanden is hij ook nog niet nodig:
  Claude Code vindt daar met gewoon zoeken prima zijn weg.

### 5. Claude en Claude Code het best gebruiken
Uit de handleiding van Claude Code (Anthropic) en ervaringen op Hacker News:

- **Geef Claude een controle die het zelf kan draaien:** tests, een build, of een screenshot die je naast het
  ontwerp legt. Dit is tip nummer één. Zonder controle ben jij de controle, en wacht elke fout tot jij hem ziet.
- **Eerst verkennen en plannen, dan bouwen.** Gebruik plan mode (Shift+Tab) voor grote of onduidelijke klussen.
  Kun je de wijziging in één zin beschrijven, dan kan het meteen.
- **Wees precies:** noem het bestand, het scenario en wat "klaar" is. Bij een bug: wat gebeurt er, waar zit het
  waarschijnlijk, en schrijf eerst een test die faalt.
- **Houd CLAUDE.md kort.** Hij wordt in elke sessie helemaal geladen. De handleiding zegt letterlijk: "een te lange
  CLAUDE.md zorgt dat Claude je echte instructies negeert." Stel bij elke regel de vraag: gaat het mis zonder deze
  regel? Zo niet, weg ermee. Kennis die je alleen soms nodig hebt, hoort in een skill of een los document.
- **Hooks voor wat altijd moet gebeuren**, skills voor kennis die je af en toe nodig hebt.
- **Helpers (sub-agents)** voor onderzoek, zodat je hoofdsessie schoon blijft. En een reviewer met een frisse blik
  vóór je iets oplevert, want de maker keurt zijn eigen werk te makkelijk goed.
- **Twee keer verbeterd en nog steeds fout?** Typ `/clear` en begin opnieuw met een betere opdracht. Een schone
  sessie wint bijna altijd van een lange sessie vol mislukte pogingen.
- **Eén taak per sessie.** Parallelle sessies alleen voor werk dat elkaar niet raakt (bv. twee verschillende
  projecten tegelijk), niet twee sessies in dezelfde bestanden.
- **Van Hacker News:**
  - Noem precies welke bestanden Claude moet lezen, en laat hem niet eindeloos zoeken.
  - Pas geen bestanden met de hand aan midden in een sessie; dat breekt de cache.
  - Houd een aparte kopie van je repo per parallelle klus.
  - Een helper die het web doorzoekt, houdt de hoofdagent schoon.

## De controle: elke rol, nut en oordeel

| Wat | Nut | Kosten | Oordeel |
|---|---|---|---|
| **Het kantoor zelf** (poppetjes, "Overleg!", hologram) | Overzicht voor jou | 0 tokens: het tekent alleen wat al gebeurt | Blijft |
| **Overleg in de vergaderzaal** | Laat zien dat 3+ collega's tegelijk werken | 0 tokens: puur beeld | Blijft; het echte overleg loopt via taken |
| **Taken en reacties tussen agents** | Overdracht van werk, met vaste velden | Tokens bij lezen en schrijven | Blijft: vaste formats werken beter dan vrij praten (MAST) |
| **CEO Atlas: weekplan** (Opus) | Weekoverzicht en prioriteiten voor jou | €0,50–2 per week | Blijft, maar **alleen bij nieuws**; zonder nieuws één regel |
| **CEO Atlas: kansen, maandelijks** | Nieuwe tak alleen met bewijs | Eén run per maand | Blijft |
| **Analist Argus: elke dag** | Dubbel: HQ controleert de cijfers zelf, lessen komen al per experiment | ±30 runs per maand | **Uitgezet** |
| **Analist Argus: lessen na elk experiment** | De leerlus: voorspelling naast uitkomst | Eén run per experiment | Blijft (belangrijkste taak) |
| **Verkenners** (elk een eigen bron, Haiku) | Parallel zoeken in verschillende bronnen | Laag | Blijft: precies wat het onderzoek steunt |
| **Pitcher** (maakte de top 5) | Geen eigen bron, geen tegenrol: alleen een extra overdracht | Een run plus een extra stap | **Weg uit de sjablonen**: de lead maakt de top 5 |
| **Criticus** ("schiet ≥3 van 5 af") | Tegenrol met live data over concurrenten | Eén run per week | Blijft: toetst met data van buiten, en remt de te aardige AI (Project Vend) |
| **Ideeënraad elke week** | Nieuwe experimenten | €6–10 per tak | Blijft, maar **slaat over** als er al 2 lopen of wachten |
| **Tak-lead: weekstart** | Stilstand opsporen, taken verdelen | Eén run per week | Blijft |
| **Bouwer, publicist, schrijver** | Eigen vak en eigen werk, net als de merch-agent in Project Vend | Het echte werk | Blijft; één maker per taak |
| **Vooronderzoek bij voorstellen** (HQ) | Voorkomt dat we iets herhalen wat al mislukte | 0 tokens (database) | Blijft |
| **`hq kennis` vóór het web op** | Goedkoper dan opnieuw zoeken | Klein | Blijft; **zonder graaf-uitvoer tot 100 notities** |
| **Graphify-extractie 's nachts** | Betere graaf bij veel notities | AI-tokens | **Wacht tot 100 lessen en notities** |
| **Claude Code-sessies** (jouw chats) | Het echte bouwwerk | Je abonnement | Blijft; helpers zijn nu zichtbaar, plus onderzoeker en reviewer |
| **Gratis AI-router** | Goedkoop veel lezen (verkenners) | Gratis lagen | Alleen voor verkenners; niet voor criticus of bouwer |

## Wat er daarom veranderd is
- **Geen aparte pitcher meer** in de tak-sjablonen. De tak-lead maakt de top 5 zelf. De regel uit je eigen plan
  gold al: meer agents helpen alleen met een eigen bron of een tegenrol. (Later is ook het sjabloon `pitcher`
  zelf weggehaald.)
- **De dagelijkse analyse-run is uitgezet.** `bootstrap` pauzeert hem als hij al bestond. HQ controleert de cijfers
  zelf, zonder AI, en Argus krijgt pas een taak als er lessen te schrijven zijn.
- **CEO en ideeënraad draaien alleen als het zin heeft.** De CEO schrijft geen weekplan zonder nieuws. De raad slaat
  over als er al 2 experimenten lopen of wachten, want meer voorstellen dan jij kunt kiezen is weggegooid geld.
- **Graphify wacht op een flinke kennisbank:** pas vanaf `HQ_GRAPHIFY_MIN_NOTES` (standaard 100) lessen en notities.
  Daaronder geen AI-extractie en geen graaf-uitvoer bij `hq kennis`. Het hologram blijft, dat kost niets.
- **De nut-meter** (hieronder) houdt dit vanaf nu elke week bij.
- **Helpers van Claude Code zijn zichtbaar.** Zet een sessie een sub-agent in, dan verschijnt die als poppetje naast
  de sessie in de werkplaats, zie je wat hij zoekt of leest, en brengt hij zijn verslag terug.
- **Twee helpers voor je eigen Claude Code-sessies:** een `onderzoeker`, die zoekt op het web en niets verandert,
  en een `reviewer`, die klaar werk met een frisse blik nakijkt. De installer van de hook zet ze klaar.

## De nut-meter: de controle blijft
Per agent zet HQ de kosten van de laatste 30 dagen naast wat hij aantoonbaar opleverde: lessen, notities,
voorstellen, metingen, verzoeken aan jou, taken voor collega's en afgeronde opdrachten van een ander (een bouwer of
schrijver levert in de taak zelf). Het oordeel:
- **levert**: er is iets terug te vinden, met de kosten per resultaat erbij;
- **voor de sier?**: meer dan €1 uitgegeven en niets terug te vinden. Op maandag gaat hij automatisch op pauze;
- **nog weinig gebruikt**: te weinig uitgegeven om iets te zeggen.

Je ziet het in het kantoor, in de controlekamer (📊, "Nut per agent") en bij elk poppetje. Het tellen gebeurt in de
database en kost zelf geen AI.

**De regel in het kantoor: wie een naam heeft, doet echt iets.** Een agent die niets oplevert, gaat op pauze en
verliest zijn naamkaartje (alleen 💤); hij kost dan niets meer. Figuranten zonder naam maken het kantoor levendig,
maar bestaan alleen in de browser: ze doen niets en kosten niets. Nieuwe agents en agents die jij weer aanzette,
krijgen eerst twee weken.

## Wat dit betekent voor je eigen Claude Code-projecten
1. **Houd CLAUDE.md kort (±150 regels).** Een CLAUDE.md van 1.000 regels kost zo'n 15.000 tokens in élke sessie
   en bij élke helper, en je belangrijkste regels worden er slechter door gevolgd. Houd in CLAUDE.md alleen wat in
   elke sessie nodig is: wat het product is, de stack, de commando's, de regels die nooit mogen breken en wanneer
   iets "klaar" is. Uitleg en achtergrond gaan naar `docs/`, met één regel per onderwerp ("werk je aan X, lees
   eerst docs/x.md"), of naar skills die alleen laden als het nodig is.
2. **Geef elke opdracht een controle mee:** "draai `npm test` en ga door tot het groen is", of bij een game "maak
   met Playwright een screenshot van level 5 en vergelijk hem met het ontwerp".
3. **Laat de helpers het werk verdelen:** de onderzoeker voor klanten, concurrenten en regels, de reviewer vóór
   elke commit. In het kantoor zie je ze naast de sessie werken.
4. **Werk in een GitHub-repository.** Alleen wat op GitHub staat (of via de hook binnenkomt), ziet de werkplaats.

**Opdracht om een lange CLAUDE.md in te korten** (kopiëren en plakken in de sessie van dat project):

> Onze CLAUDE.md is te lang. Maak hem kort volgens de best practices van Claude Code: houd alleen wat in elke
> sessie nodig is (wat het product is, stack, commando's, harde regels, definitie van klaar), ±150 regels. Verplaats
> de uitleg en achtergrond naar losse bestanden in docs/ en zet in CLAUDE.md per onderwerp één regel met wanneer je
> welk bestand leest. Verander geen inhoud, alleen de plek. Laat daarna een reviewer-helper controleren dat er geen
> regel verloren ging.

## Deel 2: de ideale opzet (september 2026)

Daarna vroeg Kalle: wat is de ideale opzet van modellen en agents, als ze ook zelf moeten bedenken wat ze maken (een
website, een game, een blog)? Zijn alle agents zuinig ingericht, en weet de agent die agents aanneemt dit ook? En:
kunnen we Kimi gebruiken, dat met heel veel agents tegelijk werkt, en gratis of open modellen? Is Jev van TypeSafe iets
voor ons? En wat kunnen we halen uit *everything-claude-code*?

### Het korte antwoord
1. **De werkwijze om het model heen telt meer dan het model zelf.** Anthropic liet een model alleen een app bouwen:
   20 minuten, $9, en de kern werkte niet. Met plannen, bouwen en keuren als aparte stappen: 6 uur, $200, en de app
   werkte. Onze bouwer werkt nu zo: afspraken vooraf, één feature tegelijk, elke feature getest zoals een speler, en
   een keuring door iemand anders.
2. **Ideeën bedenken kan AI, kiezen kan het slecht.** AI-ideeën lijken origineler dan die van experts, maar vallen
   bij uitvoering vaker tegen, en ze lijken op elkaar. Daarom: vijf verschillende richtingen, twee aan twee
   vergelijken, en het idee kiezen dat het goedkoopst écht te testen is.
3. **Elke rol op de denkstand die bij het werk past.** Zonder instelling kiest Claude Code zelf, meestal hoog. Nu
   heeft elke rol een vaste stand, en HQ laadt geen sjabloon zonder.
4. **Eerst hergebruiken, dan pas aannemen.** De Agent Factory kent de regels uit het onderzoek, en HQ controleert ze
   bij elke aanname: een volle tak of een collega die stilstaat, betekent geen nieuwe agent.
5. **Kimi: nu niet.** Sterk en goedkoop, maar nergens meer op een nette manier gratis, en Kimi Work is een app voor
   je eigen computer. **Elk model een eigen agent: nee.** Wel elke rol op het goedkoopste model dat het werk aankan.
6. **Jev: nu niet** (aanmelden staat dicht, en we hebben geen massawerk om te sorteren). **TypeScript voor de
   bouwers: ja.** **everything-claude-code: niet installeren**, wel drie ideeën overnemen.

### 1. Lange bouwklussen: de werkwijze om het model heen
- **Anthropic, *Effective harnesses for long-running agents*.** Een eerste sessie zet de basis klaar: een lijst met
  alle features (allemaal nog "niet klaar"), een startscript en een voortgangsbestand. Daarna doet elke sessie één
  feature, test die end-to-end in een browser "zoals een mens", en commit. De featurelijst staat in JSON, omdat het
  model JSON minder snel ongewild aanpast dan Markdown. Tests weghalen of aanpassen noemen ze "onaanvaardbaar".
- **Anthropic, *Harness design for long-running application development*.** Planner, bouwer en keurder. Vooraf
  spreken bouwer en keurder af wat "klaar" is. De keurder klikt met Playwright door de app en beoordeelt ontwerp,
  originaliteit, vakmanschap en werking. Een aparte, strenge keurder is makkelijker te maken dan een bouwer die zijn
  eigen werk kritisch bekijkt. Een keurder loont vooral bij werk aan de rand van wat het model kan. En: "elk onderdeel
  is een aanname over wat het model niet zelf kan"; kijk bij een nieuw model opnieuw wat nog nodig is.
- **Bij ons:** de lead is de planner (spec en 3–10 criteria vooraf), de bouwer werkt met `features.json`, `init.sh`
  en `voortgang.md`, één feature per keer, getest met Playwright. De criticus keurt vóór publicatie, hooguit twee
  rondes. Er kwam geen nieuwe agent bij: de criticus had de tegenrol al.

### 2. Zelf bedenken wat je gaat maken
- **Si, Yang en Hashimoto (2024)** lieten meer dan 100 onderzoekers blind ideeën van mensen en van een AI beoordelen.
  De AI-ideeën scoorden origineler en iets minder haalbaar. Maar de AI herhaalt zichzelf (weinig variatie), en AI's die
  ideeën beoordelen zijn onbetrouwbaar.
- **Si, Hashimoto en Yang (2025), *The Ideation-Execution Gap*,** lieten de ideeën ook echt uitvoeren. Daarna daalden
  de scores van de AI-ideeën veel meer dan die van de menselijke, en de voorsprong verdween. Nieuw op papier is niet
  hetzelfde als werken.
- **Google, AI co-scientist:** ideeën strijden twee aan twee in toernooien (Elo) in plaats van losse cijfers te
  krijgen, en er komt steeds nieuwe kennis bij.
- **Hu, Lu en Clune, ADAS:** een meta-agent die agents ontwerpt, werkt alleen omdat elke nieuwe agent op een
  meetbare taak wordt getest, met een archief van wat werkte.
- **Bij ons:**
  - De raad levert vijf verschillende richtingen: één bouwt voort op een KEEP, één komt uit een nieuwe hoek. Elk idee
    noemt zijn riskantste aanname en de kleinste echte test.
  - De lead vergelijkt de ideeën twee aan twee, en de criticus kijkt ook of het haalbaar is.
  - Een nieuwe agent is zelf een experiment: 14 dagen proeftijd, met de nut-meter als meetbare taak.

### 3. Welk model voor welke rol
Zonder `effort` kiest Claude Code zijn eigen standaard, en die staat meestal hoog. Prima voor een bouwklus, zonde voor
het lezen van een pagina. Anthropic: laag voor eenvoudige taken en helpers, hoog is vaak de beste balans. Reken per
afgeronde taak, niet per verzoek: een goedkoop model dat vaker mislukt, is duurder.

| Rol | Model | Denkstand | Waarom |
|---|---|---|---|
| CEO Atlas | Opus 5 | hoog | weinig runs en veel afwegen; ook Anthropics onderzoekssysteem zet het sterkste model aan het hoofd |
| tak-lead | Sonnet 5 | hoog | plannen, criteria, kiezen |
| bouwer | Sonnet 5 | hoog | lange bouwklus; de werkwijze doet meer dan een duurder model |
| criticus | Sonnet 5 | middel | het zoekwerk en de data doen het werk, niet het peinzen |
| publicist, schrijver | Sonnet 5 | middel | vakwerk met een duidelijke lijst |
| analist Argus | Sonnet 5 (was Haiku) | middel | draait weinig, maar alle agents lezen zijn lessen: kwaliteit loont |
| verkenner | Haiku 4.5 | (geen) | veel lezen, goedkoop; Haiku kent geen effort |

HQ controleert dit: een sjabloon met een Claude-model zonder `effort` laadt niet, en Haiku met `effort` ook niet.

### 4. Kimi (Moonshot AI)
- **Kimi K2.6** (april 2026) heeft open gewichten en een aangepaste MIT-licentie. Het model heeft ongeveer een
  biljoen parameters en 256K context. Het is sterk in lang programmeerwerk en in *Agent Swarm*: tot 300 sub-agents en
  4000 stappen tegelijk.
- **Kimi Work** (juni 2026, eerst intern getest) is een agent op je eigen computer. Hij werkt met je mappen en in je
  ingelogde browser, aangedreven door K2.6 met zo'n zwerm.
- **Kimi K3** (juli 2026) heeft 2,8 biljoen parameters, open gewichten en 1M context.
- **Prijs** (OpenRouter, 25 september 2026), per miljoen tokens:
  - K2.6: $0,95/$4, ongeveer wat Haiku kost;
  - K2.7-Code: $0,66/$3,30;
  - K3: $3/$15, duurder dan Sonnet 5.
  Moonshot heeft een adres dat Anthropic nabootst, dus Claude Code kan op Kimi draaien.
- **Gratis?** Niet meer op een nette manier. De gratis K2.6 op OpenRouter is weg. Groq en Cloudflare vragen voor K2.6
  een betaald plan. NVIDIA's gratis toegang is alleen om te proberen, niet voor echt werk.
- **Oordeel:**
  - **Kimi Work** is een app voor één persoon op zijn eigen computer, die in jouw ingelogde browser werkt. Precies dat
    mogen onze agents niet. Voor jezelf kun je het proberen, in de holding niet.
  - **Een zwerm van honderden agents** helpt bij heel breed webonderzoek; daar scoort Kimi's zwerm het best. Maar
    meerdere agents kosten volgens Anthropic ±15× de tokens van een chat, en onze raad wil juist weinig, goede
    waarnemingen uit eigen bronnen.
  - **K2.6 als goedkope, betaalde bouwer** is een optie voor later, als de bouwkosten gaan knellen. Nadelen: geen
    WebSearch van Claude, en je code en prompts gaan naar Moonshot.

### 5. Gratis en open modellen: de stand in september 2026
| Aanbieder | Gratis | Voor echt werk | Traint op je gegevens | Bij ons |
|---|---|---|---|---|
| Groq | ja, per model 30 per minuut en 1000 per dag | ja | nee | ✔ gpt-oss-120b, Qwen 3.8 (Llama is er sinds augustus af) |
| SambaNova | ja, zonder betaalkaart | ja | nee | ✔ |
| Google AI Studio (Gemini) | ja | ja, voor zakelijk gebruik; een app vóór EU-gebruikers moet betaald | in de EU/EER niet | ✔ (alleen voor onze eigen agents) |
| Hugging Face | $0,10 per maand | hangt af van de partner | hangt af van de partner | ✔ (klein) |
| Mistral | ja (Experiment-plan) | bedoeld om te proberen | ja, tenzij je het uitzet | ✔ achteraan |
| OpenRouter | 20 per minuut, 50 per dag | ja | hangt af van het model | ✔ achteraan, alleen grote modellen (Inkling, Nemotron 3 Ultra, Qwen 3.8) |
| Cerebras | nee, sinds augustus alleen proeftegoed met betaalkaart | — | — | ✖ eruit gehaald |
| NVIDIA NIM | ja, maar alleen om te proberen | nee | — | ✖ |
| Cohere | proefsleutel | nee | — | ✖ |
| Cloudflare Workers AI | 10.000 "neurons" per dag | ja | nee | nog niet (vraagt ook een account-id; Kimi is daar betaald) |
| GitHub Models | gestopt in juli 2026 | — | — | ✖ |

HQ kiest bij OpenRouter nu alleen grote modellen die met tools overweg kunnen, bij naam. Het gratis aanbod wisselt vaak
(in september helemaal), en er zitten ook piepkleine modellen en filters tussen waar een agent niets aan heeft.

**Open modellen op je eigen server:** te traag voor agents. Een agent stuurt bij elke stap tienduizenden tokens mee, en
een processor zonder videokaart doet daar minuten over. Hooguit voor nachtwerk zonder haast (Graphify), als de
kennisbank groot is.

### 6. Elk model een eigen agent?
- Meer agents kosten meer tokens. De meeste fouten ontstaan door vage rollen en slechte afstemming (zie deel 1: 42% en
  37% van de fouten).
- Een ander model helpt wel bij een **onafhankelijk oordeel**. Verschillende modellen hebben andere blinde vlekken; een
  kopie van hetzelfde model heeft dezelfde (Project Vend: de AI-baas had de blinde vlekken van de winkel-AI).
  *everything-claude-code* doet dit ook: één externe tegenstem van een ander model, alleen bij beslissingen waar veel
  van afhangt en alleen met toestemming.
- **Bij ons:** elke rol draait op het goedkoopste model dat het werk aankan (Opus, Sonnet, Haiku, en gratis AI voor
  verkenners). Een criticus op een ander model zou de plek zijn waar zo'n verschil loont. Op gratis AI mist hij alleen
  Claude's WebSearch, en die heeft hij nodig voor concurrenten met live data. Daarom nu niet; misschien later als proef.

### 7. Jev van TypeSafe AI (opgeslagen op verzoek)
- **Wat:** een "System One"-model van TypeSafe AI (San Francisco, opgericht in 2024 door Diogo Almeida, Erik Gafni
  en Sasha Sheng). Almeida werkte ±4 jaar bij OpenAI aan RLHF, InstructGPT, ChatGPT en GPT-4. Early access sinds
  15 september 2026, met $40 miljoen startkapitaal onder leiding van DCVC.
- **Hoe:** Jev schrijft geen tekst. Je geeft de toestand en vooraf bepaalde vragen, en Jev geeft getypte antwoorden
  met kansen en een betrouwbaarheid terug. Er zijn drie soorten vragen: *Choice* (kies uit opties), *Score*
  (plaats op een schaal) en *Noul* (ja/nee als kans). Getraind op synthetische data met "reinforcement learning from
  calibrated decisions": antwoorden met 90% kans moeten ook ±90% van de keren kloppen.
- **Prijs en snelheid:** $0,042 per miljoen invoertokens, uitvoer gratis, 70–500 ms per antwoord. Volgens TypeSafe tot
  ±190× sneller en ±440× goedkoper dan grote taalmodellen bij classificatie. Dat zijn hun eigen metingen, niet
  onafhankelijk getest. Er is een TypeScript-SDK (`@typesafe-ai/sdk`), en Jev zit ook in de Vercel AI Gateway.
- **Let op:** "hallucineert niet" klopt alleen in de zin dat het niets buiten de opties kan verzinnen. Een verkeerde
  keuze binnen de opties kan wel. Jev is zwak in rekenen, tellen, datums en alles wat tekst of code moet maken.
  Nieuwe aanmeldingen stonden half september dicht.
- **Waar het bij ons ooit zou passen:**
  - duizenden reviews, reacties of mails sorteren als een product gebruikers heeft;
  - snelle controles vóór een actie ("staat hier een persoonsgegeven in?");
  - als extra signaal bij het vooronderzoek ("lijkt dit voorstel op een eerdere KILL?").
- **Waarom nu niet:**
  - Aanmelden kan niet.
  - Onze beslissingen zijn er weinig, en over geld beslissen we bewust met vaste regels, niet met een AI (Project Vend).
  - Er is geen massawerk.
  - Een controle via Jev stuurt onze tekst naar nog een bedrijf.

### 8. TypeScript voor AI-code
- **Mündler e.a. (PLDI 2025):** ±94% van de compileerfouten in TypeScript die taalmodellen schrijven, zijn typefouten.
  Met de types als leidraad halveerde het aantal compileerfouten.
- **GitHub Octoverse 2025:** TypeScript werd in augustus 2025 de meest gebruikte taal op GitHub. GitHub schrijft dat
  mede toe aan AI: getypte talen maken programmeren met agents betrouwbaarder.
- **Bij ons:** HQ is al TypeScript. Bouwers schrijven nu TypeScript met `strict`, en `tsc --noEmit` is hun gratis
  controle van een paar seconden (skill `productkwaliteit`).

### 9. everything-claude-code (ECC)
Kalles eigen GitHub bevat alleen website-1, KK-Kalle en Fluxgrid. Bekeken is daarom het openbare origineel,
[affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code) (nu *ECC*, MIT-licentie): 68
agents, 292 skills, 94 commando's, plus hooks, regels en geheugen, voor Claude Code en andere tools.
- **Niet in z'n geheel installeren.** Van elke skill en agent staat de beschrijving in elke sessie en bij elke
  helper, dus honderden skills kosten altijd tokens. ECC zegt zelf: "context window is precious", "don't
  overcomplicate", en kies één profiel in plaats van alles te stapelen. Installeer alleen via de officiële bronnen:
  ze waarschuwen zelf voor nagemaakte kopieën met malware.
- **Overgenomen in de holding** (uit de skill `loop-design-check`, die precies over onze opzet gaat: plannen, bouwen,
  keuren):
  - De keurder is niet de bouwer, en waar het kan beslist een script: een Playwright-test die slaagt of faalt, geen
    "ziet er goed uit".
  - **Hooguit twee keer afkeuren**, daarna beslist de lead met Kalle: kleiner maken of stoppen. Zonder zo'n rem
    blijven bouwer en keurder tokens verbranden.
  - **Een meetlat nodigt uit tot vals spelen** (Goodhart). Daarom: geen werk maken om de nut-meter te halen, tests
    nooit aanpassen om groen te worden, en de laatste knop (publiceren, geld) blijft bij Kalle.
  - Een korte technische SEO-lijst (zoekvraag per pagina, titels, Core Web Vitals) in `productkwaliteit`.
- **Bevestigd, dus niet overgenomen:**
  - *gan-style-harness* is dezelfde planner-bouwer-keurder-opzet van Anthropic, maar voor klussen van $50–200. Wij
    doen een lichte versie: één keuring, hooguit twee rondes.
  - *council* en *council-multi-model* zijn een raad van stemmen en een tweede model als tegenstem; bij ons doet de
    criticus dat met data.
  - *continuous-learning* leert van sessies; bij ons doen de lessen van Argus dat, met de voorspelling naast de
    uitkomst.
- **Voor je eigen Claude Code-sessies:** kijk met `/context` wat je context vult, en zet connectors en plugins uit
  die je bij programmeren niet gebruikt. Wil je iets uit ECC, kopieer dan één losse skill (bijvoorbeeld
  `loop-design-check` of `verification-loop`) naar `~/.claude/skills`, niet het hele pakket.

### 10. De plugin `claude-code-setup` (van Anthropic)
- **Wat:** één skill (*claude-automation-recommender*) uit Anthropics officiële plugin-lijst. Die bekijkt een project
  en raadt per soort 1–2 automatiseringen aan: MCP-servers, skills, hooks, helpers en plugins. Hij verandert zelf niets.
  Klein, dus goedkoop om aan te laten staan.
- **Wat hij voor KK-Kalle vond:**
  - een TypeScript-project (Hono, zod, three.js) met Vitest en GitHub Actions, zonder `CLAUDE.md` en zonder `.claude/`;
  - belangrijkste aanbeveling, en gedaan: een korte `CLAUDE.md` met Kalles regels, de commando's en wanneer iets klaar
    is.
- **Optioneel voor je eigen codeersessies:**
  - context7, zodat Claude de actuele documentatie van libraries leest;
  - Playwright als MCP, om zelf door een site of game te klikken.
- **Bewust niet gedaan:**
  - een hook die na elke bewerking de types controleert (±20 s per keer; CI doet het al);
  - extra helpers (de onderzoeker en reviewer bestaan al).
- **Voor je eigen projecten:** installeer hem en vraag één keer per project "recommend automations for this project".

### Wat er daarom veranderd is (deel 2)
- **Sjablonen:**
  - Elke rol heeft een vaste denkstand (tabel hierboven). Argus draait op Sonnet.
  - De criticus kreeg de keuring erbij: budget €5, 40 beurten.
  - Elk sjabloon zegt hoeveel er per tak mogen (`maxPerBranch`).
- **Bouwer:** `features.json`, `init.sh` en `voortgang.md`. Eén feature per keer, elke feature getest met Playwright
  zoals een gebruiker. TypeScript met `strict`. Tests nooit weghalen of aanpassen.
- **Lead:** spreekt vooraf af wat klaar is. Subtaken hebben vier onderdelen (doel, vorm, bronnen, grenzen) en horen
  bij het project van het experiment. Eerst keuring, dan publicatie, en hooguit twee rondes.
- **Criticus:** kijkt ook of een idee haalbaar is, keurt producten, en heeft een vaste zoekbegroting per pitch.
- **Verkenner:** hooguit 8 zoekopdrachten en 10 pagina's, en stoppen bij 5 goede waarnemingen.
- **Publicist en schrijver:** volgen de platformregels. De schrijver doet één artikel tegelijk en zet bovenaan wie
  het nakijkt of dat het een AI-label krijgt.
- **Nieuwe skill `productkwaliteit`:** het contract, de keuring en de regels per soort product (CrazyGames, Google,
  AI Act, SEO).
- **Ideeënraad en experiment-protocol:** vijf richtingen, twee aan twee vergelijken, en de kleinste echte test per
  soort product.
- **Agent Factory:**
  - eerst hergebruiken;
  - alleen een nieuwe agent met een eigen bron, een tegenrol of een eigen vak voor werk dat al wacht;
  - een maximum per tak;
  - elke aanname is een experiment;
  - geen werk maken voor de nut-meter.
- **HQ:**
  - Een sjabloon zonder passende effort laadt niet.
  - `POST /hire` weigert (409) als de tak de rol al vol heeft of als een collega met dezelfde rol stilstaat.
  - Bovenaan elk aannameverzoek staan de bezetting en de kosten van de tak, ook als de aanname buiten HQ om binnenkwam.
- **Gratis AI:**
  - Cerebras is eruit.
  - De lijsten van Groq en OpenRouter zijn bijgewerkt.
  - Piepkleine modellen en filters komen er niet meer in.

## Bronnen
- Anthropic, [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- Anthropic, [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Anthropic, [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- Anthropic, [Claude Code hooks (SubagentStart/SubagentStop)](https://code.claude.com/docs/en/hooks)
- Anthropic, [Project Vend: Phase two](https://www.anthropic.com/research/project-vend-2)
- Cognition, [Don't Build Multi-Agents](https://cognition.com/blog/dont-build-multi-agents)
- Cemri e.a., [Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657) (NeurIPS 2025)
- Choi, Zhu en Li, [Debate or Vote](https://arxiv.org/abs/2508.17536) (NeurIPS 2025)
- Wang e.a., [Rethinking the Bounds of LLM Reasoning: Are Multi-Agent Discussions the Key?](https://arxiv.org/abs/2402.18272) (ACL 2024)
- Huang e.a., [Large Language Models Cannot Self-Correct Reasoning Yet](https://arxiv.org/abs/2310.01798)
- Xiang e.a., [When to use Graphs in RAG (GraphRAG-Bench)](https://arxiv.org/abs/2506.05690) (ICLR 2026)
- [Graphify](https://github.com/Graphify-Labs/graphify) (README en benchmarks van de makers)
- Hacker News: [Don't Build Multi-Agents](https://news.ycombinator.com/item?id=45096962), [Claude Code: Best practices for agentic coding](https://news.ycombinator.com/item?id=43735550)

### Bronnen deel 2
- Anthropic, [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- Anthropic, [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- Si, Yang en Hashimoto, [Can LLMs Generate Novel Research Ideas?](https://arxiv.org/abs/2409.04109) (2024)
- Si, Hashimoto en Yang, [The Ideation-Execution Gap](https://arxiv.org/abs/2506.20803) (2025)
- Google Research, [Accelerating scientific breakthroughs with an AI co-scientist](https://research.google/blog/accelerating-scientific-breakthroughs-with-an-ai-co-scientist/)
- Hu, Lu en Clune, [Automated Design of Agentic Systems (ADAS)](https://arxiv.org/abs/2408.08435)
- CrazyGames: [kwaliteit](https://docs.crazygames.com/requirements/quality/), [techniek](https://docs.crazygames.com/requirements/technical/), [gameplay](https://docs.crazygames.com/requirements/gameplay/)
- Google Search Central: [spam policies](https://developers.google.com/search/docs/essentials/spam-policies), [AI-gegenereerde content](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content)
- EU AI Act, [artikel 50](https://artificialintelligenceact.eu/article/50/)
- Mündler e.a., [Type-Constrained Code Generation with Language Models](https://arxiv.org/abs/2504.09246) (PLDI 2025)
- GitHub, [Octoverse: AI leads TypeScript to #1](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/)
- Kimi: [K2.6 (MarkTechPost)](https://www.marktechpost.com/2026/04/20/moonshot-ai-releases-kimi-k2-6-with-long-horizon-coding-agent-swarm-scaling-to-300-sub-agents-and-4000-coordinated-steps/), [Kimi Work (MarkTechPost)](https://www.marktechpost.com/2026/06/12/moonshot-ai-launches-kimi-work-a-local-desktop-agent-reportedly-running-on-kimi-k2-6-with-a-300-sub-agent-agent-swarm/), [Kimi in Claude Code](https://platform.kimi.ai/docs/guide/claude-code-kimi), prijzen via de [modellijst van OpenRouter](https://openrouter.ai/api/v1/models) (25 september 2026)
- Gratis lagen: [overzicht van 17 aanbieders (september 2026)](https://klymentiev.com/blog/free-llm-api), [Gemini API-voorwaarden](https://ai.google.dev/gemini-api/terms), [NVIDIA API Trial Terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf), [Cerebras-rate-limits](https://inference-docs.cerebras.ai/support/rate-limits), [Cloudflare Workers AI-prijzen](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- Jev: [TypeSafe-documentatie](https://docs.typesafe.ai/introduction), [The Register](https://www.theregister.com/ai-and-ml/2026/09/16/typesafe-ai-debuts-model-for-machines-that-plays-doom/5296711), [The Decoder](https://the-decoder.com/former-openai-researcher-builds-an-ai-model-that-judges-options-instead-of-writing-text/), [TechCrunch](https://techcrunch.com/2026/09/18/a-new-kind-of-ai-model-from-a-chatgpt-inventor-is-thrilling-developers/), [Flavio Copes](https://flaviocopes.com/jev/)
- [everything-claude-code / ECC](https://github.com/affaan-m/everything-claude-code): de skills `loop-design-check`, `gan-style-harness`, `context-budget`, `council-multi-model`, `seo` en *the-shortform-guide*
- Anthropic, [claude-code-setup (plugin)](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/claude-code-setup)
