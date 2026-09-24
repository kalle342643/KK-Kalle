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
  gold al: meer agents helpen alleen met een eigen bron of een tegenrol. Het sjabloon `pitcher` bestaat nog, voor
  als je er ooit toch een wilt aannemen.
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
voorstellen, metingen, verzoeken aan jou en taken voor collega's. Het oordeel:
- **levert**: er is iets terug te vinden, met de kosten per resultaat erbij;
- **voor de sier?**: meer dan €1 uitgegeven en niets terug te vinden. Pauzeer hem, of geef hem een duidelijke taak;
- **nog weinig gebruikt**: te weinig uitgegeven om iets te zeggen.

Je ziet het in het kantoor, in de controlekamer (📊, "Nut per agent") en bij elk poppetje. Elke maandag staat in
het dagrapport wie geld kost zonder resultaat. Het tellen gebeurt in de database en kost zelf geen AI.

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
