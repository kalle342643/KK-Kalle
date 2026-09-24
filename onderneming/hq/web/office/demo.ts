/**
 * Een verzonnen bedrijf voor /demo en de losse demo-pagina. Zelfde vorm als HQ (momentopname plus
 * gebeurtenissen), maar alles gebeurt in de browser: agents krijgen taken, praten met elkaar,
 * zoeken iets op en vragen jou om goedkeuring. Knoppen werken ook (goedkeuren, pauzeren, noodstop,
 * een naam geven), alleen gebeurt er niets buiten deze pagina. Niets hiervan is echt.
 */
import type {
  BacklogItem,
  CodeProject,
  CodeSession,
  KnowledgeGraph,
  OfficeAgent,
  OfficeApproval,
  OfficeBranch,
  OfficeEvent,
  OfficePerson,
  OfficeProject,
  OfficeSnapshot,
  ProjectDetail,
} from "../../src/office/types.js";
import type { CodeProjectInput, DataSource, RepoChoice } from "./data.js";
import { BOT_ID, OWNER_ID } from "./layout.js";

const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const eur = (n: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n).replace(/ /g, " ");

/** Voorspelbaar toeval voor de beginstand (dan ziet de demo er elke keer hetzelfde uit). */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
const pick = <T>(list: readonly T[], rnd: () => number = Math.random): T => list[Math.floor(rnd() * list.length)]!;

interface Seed {
  name: string;
  template: string;
  lead?: boolean;
}

const TITLES: Record<string, string> = {
  "tak-lead": "Tak-lead",
  verkenner: "Verkenner",
  pitcher: "Pitcher",
  criticus: "Criticus",
  bouwer: "Bouwer",
  publicist: "Publicist",
  schrijver: "Schrijver",
};
const ROLES: Record<string, string> = {
  "tak-lead": "pm",
  verkenner: "researcher",
  pitcher: "general",
  criticus: "researcher",
  bouwer: "engineer",
  publicist: "cmo",
  schrijver: "general",
};

const BRANCHES: Array<{ slug: string; name: string; template: string; budget: number; agents: Seed[] }> = [
  {
    slug: "games",
    name: "Games-studio",
    template: "games",
    budget: 40,
    agents: [
      { name: "Vega", template: "tak-lead", lead: true },
      { name: "Rigel", template: "verkenner" },
      { name: "Deneb", template: "verkenner" },
      { name: "Sirius", template: "pitcher" },
      { name: "Castor", template: "criticus" },
      { name: "Pollux", template: "bouwer" },
      { name: "Capella", template: "publicist" },
    ],
  },
  {
    slug: "content",
    name: "Content en affiliate",
    template: "content",
    budget: 30,
    agents: [
      { name: "Eik", template: "tak-lead", lead: true },
      { name: "Beuk", template: "verkenner" },
      { name: "Linde", template: "pitcher" },
      { name: "Wilg", template: "criticus" },
      { name: "Berk", template: "schrijver" },
    ],
  },
  {
    slug: "saas",
    name: "Software en SaaS",
    template: "saas",
    budget: 40,
    agents: [
      { name: "Maas", template: "tak-lead", lead: true },
      { name: "Waal", template: "verkenner" },
      { name: "Rijn", template: "verkenner" },
      { name: "IJssel", template: "pitcher" },
      { name: "Schelde", template: "criticus" },
      { name: "Amstel", template: "bouwer" },
    ],
  },
];

/** Een tak die je in de demo kunt goedkeuren: dan komt er een afdeling bij. */
const NEW_BRANCH = {
  slug: "ecommerce",
  name: "E-commerce",
  template: "generiek",
  budget: 30,
  agents: [
    { name: "Kompas", template: "tak-lead", lead: true },
    { name: "Radar", template: "verkenner" },
    { name: "Vonk", template: "pitcher" },
    { name: "Smid", template: "bouwer" },
  ] as Seed[],
};

const TASKS: Record<string, string[]> = {
  ceo: ["Weekplan voor de holding schrijven", "Portfolio bekijken: waar moet het budget heen?", "Onderzoek: is e-commerce een goede nieuwe tak?", "Taken verdelen over de tak-leads"],
  analyst: ["Dagelijkse analyse van gisteren", "Kosten zonder resultaat opsporen", "Lessen schrijven voor afgeronde experimenten", "Metingen van EXP-1 controleren"],
  "tak-lead": ["Weekstart: lopende experimenten nalopen", "Taken voor deze week verdelen", "Ideeënraad voorbereiden", "Meting van dit experiment controleren"],
  "verkenner:games": ["Trending games op CrazyGames bekijken", "Reddit r/WebGames doorzoeken op wensen", "Top 20 puzzelgames vergelijken", "Wat spelen mensen deze week op Poki?"],
  "verkenner:content": ["Zoekvolume voor 'beste budget microfoon' checken", "Affiliate-programma's vergelijken", "Concurrerende vergelijkingssites bekijken"],
  "verkenner:saas": ["Klachten over boekhoudtools verzamelen", "Prijzen van concurrenten van ComplyScan", "Zzp-forums doorzoeken op irritaties"],
  pitcher: ["Top 5 ideeën uitwerken voor de ideeënraad", "Pitch schrijven met een meetbaar doel", "Voorspelling vooraf opschrijven"],
  criticus: ["Ideeën afschieten: waarom werkt dit níet?", "Risico's en kosten op een rij", "Is het doel wel meetbaar?"],
  "bouwer:games": ["EXP-1 Fluxgrid: level 12-20 bouwen", "Bug in de kleurmenging oplossen", "Build klaarzetten voor jou (jij publiceert)", "Laadtijd onder 2 seconden krijgen"],
  "bouwer:saas": ["EXP-4 landingspagina: aanmeldformulier", "Gratis versie van ComplyScan bouwen", "Factuur-OCR: tweede poging"],
  publicist: ["Trailer-gif en beschrijving voor Fluxgrid", "Store-tekst herschrijven", "Thumbnails testen (3 varianten)"],
  schrijver: ["Artikel: beste budget-microfoons 2026", "Vergelijkingstabel bijwerken", "Gids: e-bike verzekeren"],
};

// ---------------------------------------------------------------- werkplaats (verzonnen)

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const item = (title: string, text: string, section: string, owner: boolean): BacklogItem => ({ title, text, section, owner });

function demoCodeProjects(): CodeProject[] {
  const base = {
    empty: false,
    error: null,
    polledAt: ago(1),
    activeSessions: 0,
    description: null,
  };
  const cookieBacklog = [
    item("Inschrijven bij de KvK", "Zet de bedrijfsgegevens in de omgeving: zonder zakt de site voor zijn eigen handelsinfo-controle.", "Voor de eerste betaling — dit ligt bij Kalle", true),
    item("Domein kopen", "cookiewacht.nl is vrij; daarna de redirect-URL in de database toestaan.", "Voor de eerste betaling — dit ligt bij Kalle", true),
    item("Hosting naar een betaald plan", "Het gratis plan is niet voor commercieel gebruik.", "Voor de eerste betaling — dit ligt bij Kalle", true),
    item("Cookiemuren apart melden", "De scan ziet nu alleen de muur.", "Product", false),
    item("Een pagina die niet bereikbaar was, één keer opnieuw proberen", "", "Product", false),
    item("Melding bij een regressie", "De sterkste reden voor een abonnement.", "Herhaalscans", false),
  ];
  return [
    {
      ...base,
      key: "cookiewacht",
      name: "Cookiewacht",
      repo: "demo-holding/cookiewacht",
      repoUrl: null,
      url: "https://cookiewacht.example",
      healthUrl: "https://cookiewacht.example/api/gezondheid",
      branch: "saas",
      description: "Controleert webshops op cookies vóór toestemming, handelsinformatie en de AI-melding (demo).",
      defaultBranch: "main",
      health: { state: "up", status: 200, ms: 240, checkedAt: ago(2), since: ago(3000), uptime24h: 0.99, note: null },
      deploy: { state: "success", url: "https://cookiewacht.example", at: ago(25), environment: "Production", sha: "a1b2c3d" },
      ci: { state: "passed", url: null, at: ago(24) },
      lastCommit: { sha: "a1b2c3d", title: "Scan: toon de foutcode van de browser", at: ago(26), url: null, session: null, branch: "claude/foutcode-tonen" },
      openPrs: [{ number: 12, title: "Laat zien waarom een pagina niet openging", url: "https://github.com", draft: true, branch: "claude/foutcode-tonen", ci: "running", updatedAt: ago(6) }],
      backlog: { path: "BACKLOG.md", updatedAt: ago(60), items: cookieBacklog, ownerCount: 3, totalCount: cookieBacklog.length },
    },
    {
      ...base,
      key: "fluxgrid",
      name: "Fluxgrid",
      repo: "demo-holding/fluxgrid",
      repoUrl: null,
      url: "https://fluxgrid.example",
      healthUrl: null,
      branch: "games",
      description: "Routing-puzzel met kleurmenging voor CrazyGames (demo).",
      defaultBranch: "main",
      health: { state: "up", status: 200, ms: 180, checkedAt: ago(3), since: ago(9000), uptime24h: 1, note: null },
      deploy: { state: "success", url: "https://fluxgrid.example", at: ago(140), environment: "Production", sha: "f00d123" },
      ci: { state: "passed", url: null, at: ago(139) },
      lastCommit: { sha: "f00d123", title: "Levels 8 t/m 12: meer kleuren", at: ago(12), url: null, session: null, branch: "claude/levels-moeilijker" },
      openPrs: [],
      backlog: {
        path: "BACKLOG.md",
        updatedAt: ago(200),
        items: [
          item("Uploaden naar CrazyGames", "Doe je zelf met je eigen account; het pakket staat klaar in /release.", "Dit ligt bij Kalle", true),
          item("Geluid bij een gemengde kleur", "", "Spel", false),
          item("Dagelijkse puzzel", "", "Later", false),
        ],
        ownerCount: 1,
        totalCount: 3,
      },
    },
    {
      ...base,
      key: "hq",
      name: "HQ-kantoor",
      repo: "demo-holding/hq",
      repoUrl: null,
      url: null,
      healthUrl: null,
      branch: null,
      description: "Dit kantoor zelf.",
      defaultBranch: "main",
      health: { state: "unknown", status: null, ms: null, checkedAt: null, since: null, uptime24h: null, note: null },
      deploy: null,
      ci: { state: "passed", url: null, at: ago(90) },
      lastCommit: { sha: "c0ffee1", title: "Werkplaats: Claude Code in het kantoor", at: ago(95), url: null, session: null, branch: "main" },
      openPrs: [],
      backlog: null,
    },
  ];
}

function demoSessions(): CodeSession[] {
  const s = (id: string, projectKey: string, title: string, lastAction: string, state: CodeSession["state"], commits: number, minutes: number, branch: string, pr: CodeSession["pr"] = null): CodeSession => ({
    id,
    actorId: `cc:${id}`,
    projectKey,
    source: "cloud",
    url: "https://claude.ai/code",
    branch,
    title,
    lastAction,
    startedAt: ago(minutes + 40),
    lastActivityAt: ago(minutes),
    state,
    commits,
    pr,
  });
  return [
    s("demo-1", "cookiewacht", "Laat zien waarom een pagina niet openging", "🧪 npm test", "working", 3, 2, "claude/foutcode-tonen", { number: 12, url: "https://github.com", state: "open", ci: "running" }),
    s("demo-2", "fluxgrid", "Maak level 8 tot 12 moeilijker", "✍️ levels.ts", "working", 5, 4, "claude/levels-moeilijker"),
    s("demo-3", "hq", "Werkplaats in het kantoor", "✅ Klaar, wacht op jou", "idle", 7, 70, "claude/werkplaats"),
  ];
}

const CODE_STEPS: Record<string, string[]> = {
  cookiewacht: ["🔎 playwright timeout vercel functions", "🌐 docs.vercel.com/functions/limits", "🧪 npm test", "✍️ scan.ts", "✍️ rapport.ts", "🔎 ERR_CONNECTION_RESET chromium datacenter"],
  fluxgrid: ["✍️ levels.ts", "🧪 npm test", "🌐 developer.crazygames.com/sdk", "✍️ kleuren.ts"],
  hq: ["✍️ ui.ts", "🧪 npm test", "🕸️ query CodeWatcher"],
};
const CODE_COMMITS: Record<string, string[]> = {
  cookiewacht: ["Scan: probeer een onbereikbare pagina één keer opnieuw", "Rapport: foutcode tussen haakjes", "Colofon leest de bedrijfsgegevens uit de omgeving"],
  fluxgrid: ["Level 9: extra kleur", "Mengen: geel + blauw = groen", "Tutorial korter"],
  hq: ["Werkplaats: bord per project", "Hooks: geheimen wegpoetsen"],
};
const NEW_TASKS: Array<[string, string]> = [
  ["cookiewacht", "Meld een cookiemuur apart in het rapport"],
  ["fluxgrid", "Voeg een dagelijkse puzzel toe"],
  ["cookiewacht", "Zet de KvK-gegevens in de colofon"],
];

const REPOS: RepoChoice[] = [
  { repo: "demo-holding/cookiewacht", private: true, homepage: "https://cookiewacht.example", description: "Cookie- en compliance-scanner", pushedAt: ago(5) },
  { repo: "demo-holding/fluxgrid", private: true, homepage: "https://fluxgrid.example", description: "Puzzelgame", pushedAt: ago(12) },
  { repo: "demo-holding/hq", private: false, homepage: null, description: "HQ en het kantoor", pushedAt: ago(95) },
];

/** Wat agents in de demo op het web en in de kennisgraaf doen (zoals HQ het uit hun run-logboek haalt). */
const WEB_STEPS: Record<string, string[]> = {
  verkenner: ["🔎 zoekt: browser puzzle games trending 2026", "🌐 leest: crazygames.com/t/puzzle", "📈 trends: cookie consent scanner", "🌐 leest: poki.com/en/puzzle", "🔎 zoekt: webshop compliance tool prijzen"],
  criticus: ["🔎 zoekt: color mixing puzzle game", "🌐 leest: crazygames.com/game/color-flow", "🕸️ kennisgraaf: pad Fluxgrid mobiel", "🌐 leest: g2.com/categories/cookie-consent"],
  pitcher: ["🕸️ kennisgraaf: uitleg retentie", "🔎 zoekt: idle game retention benchmarks"],
  bouwer: ["🕸️ kennisgraaf: query LevelLoader", "✍️ bewerkt: levels.ts", "🌐 leest: developer.crazygames.com/sdk", "✍️ bewerkt: scanner.ts"],
  schrijver: ["🔎 zoekt: AI Act artikel 50 chatbot melding", "🌐 leest: eur-lex.europa.eu/eli/reg/2024/1689"],
  publicist: ["🌐 leest: docs.crazygames.com/requirements", "🔎 zoekt: crazygames upload thumbnail size"],
  lead: ["🕸️ kennisgraaf: hubs", "🔎 zoekt: crazygames revenue share 2026"],
};

const QUESTIONS = [
  "Wat weten we over puzzelgames op CrazyGames?",
  "Welke affiliate-programma's werkten eerder?",
  "Hoeveel plays haalde de vorige game in week 1?",
  "Waarom is EXP-5 gestopt?",
  "Wat kost een landingspagina-test ongeveer?",
  "Welke thumbnails deden het goed?",
  "Wat zeiden spelers over moeilijke levels?",
  "Hoe snel moet een game laden?",
  "Welke zoekwoorden brachten kliks?",
];

const LESSONS = [
  "Puzzelgames met korte levels (<60 s) houden spelers twee keer zo lang vast",
  "Affiliate-links in de vergelijkingstabel werken beter dan onderaan het artikel",
  "Eerst een landingspagina: 23 aanmeldingen in 5 dagen voor € 12",
  "Woordspellen doen het slecht op CrazyGames (te weinig Nederlandstaligen)",
  "Thumbnails met een gezicht krijgen meer kliks dan alleen gameplay",
  "Een build onder 5 MB laadt snel genoeg op mobiel",
];

const TALK: Record<string, string[]> = {
  lead: ["Kun je dit vandaag afronden?", "Goed werk, zet het in HQ als meting", "Eerst in de kennisbank kijken of we dit al eens probeerden", "Hou het budget in de gaten: nog € 8 over"],
  member: ["Klaar met de eerste versie, wil je kijken?", "Ik zie 3 klachten over te moeilijke levels", "Dit idee is te duur om te bouwen, voorstel: kleiner beginnen", "Meting staat in HQ", "Ik loop vast op de laadtijd, tips?"],
};

const NOTIFY = [
  "Fluxgrid v3 staat klaar om te testen. Publiceren doe jij: build staat in builds/fluxgrid-v3",
  "EXP-3 zit op 180 kliks, doel is 400. Ik denk dat we het halen.",
  "Er is een nieuwe kans: digitale planners verkopen goed op Etsy. Wil je dat ik het uitzoek?",
];

type ProjectSeed = Omit<OfficeProject, "id" | "code" | "branchName" | "startedAt" | "endedAt" | "createdAt" | "iteration" | "leadAgentId"> & {
  startedDaysAgo: number | null;
  endedDaysAgo?: number;
  lead: string;
};

const PROJECTS: ProjectSeed[] = [
  { title: "Fluxgrid: routing-puzzel met kleurmenging", branch: "games", status: "running", metric: "plays", target: 5000, value: 3120, trusted: true, spentEur: 14.2, budgetEur: 25, revenueEur: 18.4, daysLeft: 9, reason: null, hypothesis: "Een puzzelgame met korte levels en kleurmenging haalt 5000 plays in 3 weken op CrazyGames.", prediction: "3500 plays", startedDaysAgo: 12, lead: "Vega" },
  { title: "Merge-idle met vissen", branch: "games", status: "keep", metric: "plays", target: 5000, value: 8400, trusted: true, spentEur: 21.5, budgetEur: 25, revenueEur: 64.1, daysLeft: null, reason: "Doel ruim gehaald (8400/5000) en de omzet dekt de kosten drie keer.", hypothesis: "Idle-games met merge-mechaniek houden spelers lang vast.", prediction: "4000 plays", startedDaysAgo: 34, endedDaysAgo: 13, lead: "Vega" },
  { title: "Woordzoeker met AI-hints", branch: "games", status: "killed", metric: "plays", target: 3000, value: 410, trusted: true, spentEur: 18, budgetEur: 20, revenueEur: 1.2, daysLeft: null, reason: "Na 3 weken 410 plays: te weinig. Woordspellen passen niet bij het publiek.", hypothesis: "Woordzoekers met hints trekken casual spelers.", prediction: "2500 plays", startedDaysAgo: 40, endedDaysAgo: 19, lead: "Vega" },
  { title: "Beste budget-microfoons 2026", branch: "content", status: "running", metric: "clicks", target: 400, value: 180, trusted: false, spentEur: 6.4, budgetEur: 15, revenueEur: 9.8, daysLeft: 11, reason: null, hypothesis: "Een eerlijke vergelijking met tabel levert 400 affiliate-kliks per maand.", prediction: "250 kliks", startedDaysAgo: 10, lead: "Eik" },
  { title: "ComplyScan landingspagina", branch: "saas", status: "running", metric: "signups", target: 50, value: 23, trusted: true, spentEur: 12, budgetEur: 20, revenueEur: 0, daysLeft: 6, reason: null, hypothesis: "Zzp'ers willen een tool die facturen controleert op fouten; 50 aanmeldingen bewijst vraag.", prediction: "30 aanmeldingen", startedDaysAgo: 8, lead: "Maas" },
  { title: "Factuur-OCR voor zzp", branch: "saas", status: "iterate", metric: "signups", target: 30, value: 14, trusted: true, spentEur: 15, budgetEur: 15, revenueEur: 0, daysLeft: null, reason: "Halverwege het doel: nog één poging met een scherpere belofte.", hypothesis: "Foto van een bon → boeking scheelt zzp'ers tijd.", prediction: "25 aanmeldingen", startedDaysAgo: 28, endedDaysAgo: 7, lead: "Maas" },
  { title: "Vergelijking e-bike-verzekeringen", branch: "content", status: "proposed", metric: "clicks", target: 300, value: null, trusted: false, spentEur: 0, budgetEur: 15, revenueEur: 0, daysLeft: null, reason: null, hypothesis: "E-bike-bezitters zoeken actief naar verzekeringen; vergelijkers betalen per lead.", prediction: "200 kliks", startedDaysAgo: null, lead: "Eik" },
  { title: "Snake-roguelite", branch: "games", status: "proposed", metric: "plays", target: 4000, value: null, trusted: false, spentEur: 0, budgetEur: 20, revenueEur: 0, daysLeft: null, reason: null, hypothesis: "Snake met upgrades per ronde (roguelite) is nieuw genoeg om op te vallen.", prediction: "3000 plays", startedDaysAgo: null, lead: "Vega" },
];

export class DemoSource implements DataSource {
  readonly mode = "demo" as const;
  private readonly agents: OfficeAgent[] = [];
  private readonly people: OfficePerson[] = [
    { id: OWNER_ID, name: "Kalle", nickname: null, avatar: null },
    { id: BOT_ID, name: "HQ-bot", nickname: null, avatar: null },
  ];
  private branches: Array<{ slug: string; name: string; template: string | null; status: string; budget: number; lead: string | null }> = [];
  private projects: OfficeProject[] = [];
  private approvals: Array<OfficeApproval & { projectId?: number; hireAgentId?: string; branch?: boolean }> = [];
  private readonly events: OfficeEvent[] = [];
  private readonly metrics = new Map<number, Array<{ value: number; at: string; source: string; trusted: boolean }>>();
  private readonly lessons: Array<{ id: number; lesson: string; tags: string[]; at: string; projectId: number | null }> = [];
  private days: Array<{ date: string; revenueEur: number; costEur: number }> = [];
  private readonly runs = new Map<string, { until: number; task: string }>();
  private halted = false;
  private haltReason: string | null = null;
  private nextId = 1;
  private nextApproval = 1;
  private listeners = new Set<(e: OfficeEvent) => void>();
  private timer: number | null = null;
  private clock = 0;
  private hires = 0;
  private graphCache: KnowledgeGraph | null = null;
  private codeProjects: CodeProject[] = demoCodeProjects();
  private codeSessions: CodeSession[] = demoSessions();
  private taskIndex = 0;

  constructor() {
    const rnd = seeded(42);
    const now = Date.now();
    const add = (seed: Seed & { branch: string; hqRole?: string; status?: OfficeAgent["status"] }) => {
      const template = seed.template;
      const model = template === "verkenner" || seed.hqRole === "analyst" ? "claude-haiku-4-5" : seed.hqRole === "ceo" ? "claude-opus-5" : "claude-sonnet-5";
      const budget = seed.hqRole === "ceo" ? 60 : seed.lead ? 15 : 8;
      const agent: OfficeAgent = {
        id: `demo-${seed.name.toLowerCase()}`,
        name: seed.name,
        role: seed.hqRole === "ceo" ? "ceo" : (ROLES[template] ?? "general"),
        title: seed.hqRole === "ceo" ? "CEO" : seed.hqRole === "analyst" ? "Analist" : (TITLES[template] ?? template),
        status: seed.status ?? "idle",
        branch: seed.branch,
        hqRole: seed.hqRole ?? (seed.lead ? "lead" : null),
        template: seed.hqRole ? null : template,
        reportsTo: null,
        model,
        costTodayEur: round2(rnd() * (seed.hqRole === "ceo" ? 2.4 : 0.9)),
        spentMonthEur: round2(budget * (0.15 + rnd() * 0.6)),
        budgetMonthEur: budget,
        lastActiveAt: new Date(now - rnd() * 3 * 3600_000).toISOString(),
        pauseReason: null,
        currentTask: null,
        nickname: null,
        avatar: null,
      };
      this.agents.push(agent);
      return agent;
    };
    const ceo = add({ name: "Atlas", template: "ceo", branch: "holding", hqRole: "ceo" });
    add({ name: "Argus", template: "analist", branch: "holding", hqRole: "analyst" });
    this.branches.push({ slug: "holding", name: "Holding", template: null, status: "active", budget: 0, lead: ceo.id });
    for (const b of BRANCHES) {
      const lead = b.agents.find((a) => a.lead)!;
      this.branches.push({ slug: b.slug, name: b.name, template: b.template, status: "active", budget: b.budget, lead: `demo-${lead.name.toLowerCase()}` });
      for (const a of b.agents) add({ ...a, branch: b.slug });
    }
    for (const a of this.agents) {
      if (a.hqRole !== "ceo") a.reportsTo = a.hqRole === "lead" || a.hqRole === "analyst" ? ceo.id : (this.branches.find((b) => b.slug === a.branch)?.lead ?? ceo.id);
    }
    // Een sollicitant op de bank bij de receptie.
    const altair = add({ name: "Altair", template: "verkenner", branch: "games", status: "pending_approval" });
    altair.reportsTo = "demo-vega";
    altair.costTodayEur = 0;
    altair.spentMonthEur = 0;
    altair.lastActiveAt = null;

    PROJECTS.forEach((p, k) => {
      const id = k + 1;
      const lead = `demo-${p.lead.toLowerCase()}`;
      const branchName = this.branches.find((b) => b.slug === p.branch)!.name;
      const startedAt = p.startedDaysAgo === null ? null : new Date(now - p.startedDaysAgo * DAY).toISOString();
      this.projects.push({
        ...p,
        id,
        code: `EXP-${id}`,
        branchName,
        leadAgentId: lead,
        iteration: p.status === "iterate" ? 1 : 0,
        startedAt,
        endedAt: p.endedDaysAgo === undefined ? null : new Date(now - p.endedDaysAgo * DAY).toISOString(),
        createdAt: new Date(now - ((p.startedDaysAgo ?? 1) + 2) * DAY).toISOString(),
      });
      // Metingen door de tijd (voor de grafiek in het projectpaneel).
      if (p.value !== null && p.startedDaysAgo !== null) {
        const n = Math.min(12, Math.max(3, p.startedDaysAgo - (p.endedDaysAgo ?? 0)));
        const series: Array<{ value: number; at: string; source: string; trusted: boolean }> = [];
        for (let m = 0; m < n; m++) {
          const f = (m + 1) / n;
          const ago = p.startedDaysAgo - (p.startedDaysAgo - (p.endedDaysAgo ?? 0)) * f;
          series.push({ value: Math.round(p.value * f ** 1.3 * (0.92 + rnd() * 0.08)), at: new Date(now - ago * DAY).toISOString(), source: p.branch === "games" ? "crazygames" : p.branch === "content" ? "agent" : "stripe", trusted: p.trusted });
        }
        series[series.length - 1]!.value = p.value;
        this.metrics.set(id, series);
      }
    });
    LESSONS.slice(0, 4).forEach((lesson, k) => {
      this.lessons.push({ id: k + 1, lesson, tags: ["demo"], at: new Date(now - (20 - k * 4) * DAY).toISOString(), projectId: [2, 4, 5, 3][k] ?? null });
    });

    // Omzet en kosten van de afgelopen 30 dagen (groeiend, met wat ruis).
    for (let k = 29; k >= 0; k--) {
      const date = new Date(now - k * DAY);
      const growth = (30 - k) / 30;
      this.days.push({
        date: localDate(date),
        revenueEur: round2(Math.max(0, 2 + growth * 14 + (rnd() - 0.4) * 6 + (k === 13 ? 18 : 0))),
        costEur: round2(2.5 + rnd() * 3.5 + growth * 1.5),
      });
    }

    this.approvals.push(
      {
        id: this.nextApproval++,
        title: "EXP-8 starten: Snake-roguelite",
        kind: "experiment_start",
        summary: "Snake met upgrades per ronde. Doel 4000 plays in 3 weken, budget € 20. Castor vond het risico acceptabel.",
        amountEur: 20,
        requestedByAgentId: "demo-vega",
        createdAt: new Date(now - 40 * 60_000).toISOString(),
        projectId: 8,
      },
      {
        id: this.nextApproval++,
        title: "Nieuwe agent: Altair (verkenner, Games-studio)",
        kind: "hire_agent",
        summary: "Vega wil een tweede verkenner voor Poki. Kost ongeveer € 4 per maand (Haiku).",
        amountEur: null,
        requestedByAgentId: "demo-vega",
        createdAt: new Date(now - 15 * 60_000).toISOString(),
        hireAgentId: altair.id,
      },
    );

    // Wat er vandaag al gebeurde (voor het logboek).
    const history: Array<Omit<OfficeEvent, "id" | "at"> & { ago: number }> = [
      { ago: 180, type: "message.sent", agentId: BOT_ID, targetAgentId: null, text: "📊 Dagrapport: gisteren € 14,20 omzet, € 5,10 AI-kosten. 2 verzoeken wachten op jou.", data: {} },
      { ago: 150, type: "run.started", agentId: "demo-atlas", targetAgentId: null, text: "Weekplan voor de holding schrijven", data: {} },
      { ago: 140, type: "talk", agentId: "demo-atlas", targetAgentId: "demo-vega", text: "Nieuwe taak voor jou: Fluxgrid deze week naar 4000 plays", data: { kind: "delegate" } },
      { ago: 120, type: "knowledge.query", agentId: "demo-rigel", targetAgentId: null, text: "Wat weten we over puzzelgames op CrazyGames?", data: {} },
      { ago: 95, type: "metric", agentId: "demo-vega", targetAgentId: null, text: "EXP-1 plays: 3120", data: { experimentId: 1, name: "plays", value: 3120 } },
      { ago: 70, type: "revenue", agentId: null, targetAgentId: null, text: "CrazyGames advertenties", data: { amountEur: 6.4, branch: "games", experimentId: 1, source: "csv" } },
      { ago: 40, type: "approval.requested", agentId: "demo-vega", targetAgentId: null, text: "EXP-8 starten: Snake-roguelite", data: { approvalId: 1, kind: "experiment_start", amountEur: 20 } },
      { ago: 15, type: "agent.hired", agentId: altair.id, targetAgentId: null, text: "Altair solliciteert", data: { name: "Altair", role: "researcher" } },
      { ago: 14, type: "approval.requested", agentId: "demo-vega", targetAgentId: null, text: "Nieuwe agent: Altair (verkenner, Games-studio)", data: { approvalId: 2, kind: "hire_agent" } },
    ];
    for (const h of history) {
      const { ago, ...e } = h;
      this.events.push({ ...e, id: this.nextId++, at: new Date(now - ago * 60_000).toISOString() });
    }

    // Een paar agents zijn al aan het werk als je binnenkomt.
    for (const name of ["atlas", "pollux", "berk", "amstel", "rigel"]) {
      const a = this.agent(`demo-${name}`);
      if (a) this.startRun(a, false);
    }
  }

  // ---------------------------------------------------------------- DataSource

  async snapshot(): Promise<OfficeSnapshot> {
    const today = this.days[this.days.length - 1]!;
    const month = this.days.slice(-new Date().getDate());
    const running = this.projects.filter((p) => p.status === "running");
    const branches: OfficeBranch[] = this.branches.map((b) => ({
      slug: b.slug,
      name: b.name,
      template: b.template,
      status: b.status,
      monthlyBudgetEur: b.budget,
      leadAgentId: b.lead,
      experiments: running
        .filter((p) => p.branch === b.slug)
        .map((p) => ({ id: p.id, code: p.code, title: p.title, metric: p.metric, target: p.target, value: p.value, trusted: p.trusted, spentEur: p.spentEur, budgetEur: p.budgetEur, daysLeft: p.daysLeft, leadAgentId: p.leadAgentId })),
    }));
    const graph = this.graphData();
    return clone({
      generatedAt: new Date().toISOString(),
      companyName: "KK Holding (demo)",
      halted: this.halted,
      haltReason: this.haltReason,
      timezone: "Europe/Amsterdam",
      kpis: {
        revenueTodayEur: today.revenueEur,
        costTodayEur: today.costEur,
        revenueMonthEur: round2(month.reduce((s, d) => s + d.revenueEur, 0)),
        costMonthEur: round2(month.reduce((s, d) => s + d.costEur, 0)),
        allowanceMonthEur: 150,
        runningExperiments: running.length,
        pendingApprovals: this.approvals.length,
      },
      branches,
      agents: this.agents,
      people: this.people,
      projects: [...this.projects].sort((a, b) => b.id - a.id),
      stats: {
        days: this.days,
        branches: this.branches.map((b) => {
          const share = b.slug === "games" ? 0.62 : b.slug === "content" ? 0.3 : b.slug === "saas" ? 0.08 : 0;
          const costShare = b.slug === "holding" ? 0.25 : b.slug === "games" ? 0.35 : b.slug === "content" ? 0.18 : b.slug === "saas" ? 0.22 : 0;
          return {
            slug: b.slug,
            name: b.name,
            revenue30Eur: round2(this.days.reduce((s, d) => s + d.revenueEur, 0) * share),
            cost30Eur: round2(this.days.reduce((s, d) => s + d.costEur, 0) * costShare),
            budgetEur: b.budget,
          };
        }),
        totals: {
          revenue30Eur: round2(this.days.reduce((s, d) => s + d.revenueEur, 0)),
          cost30Eur: round2(this.days.reduce((s, d) => s + d.costEur, 0)),
          tokensToday: 1_284_000 + this.events.filter((e) => e.type === "run.finished").length * 41_000,
          runsToday: 57 + this.events.filter((e) => e.type === "run.finished").length,
        },
      },
      approvals: this.approvals.map(({ projectId: _p, hireAgentId: _h, branch: _b, ...a }) => a),
      knowledge: { source: "graphify", nodes: graph.totalNodes, edges: graph.totalEdges, builtAt: graph.builtAt },
      events: this.events.slice(-40),
      lastEventId: this.nextId - 1,
      paperclipError: null,
      code: {
        projects: this.codeProjects.map((p) => ({ ...p, activeSessions: this.codeSessions.filter((s) => s.projectKey === p.key && s.state !== "done").length })),
        sessions: this.codeSessions.filter((s) => s.state !== "done"),
        github: true,
        hooks: true,
      },
    } satisfies OfficeSnapshot);
  }

  subscribe(onEvent: (e: OfficeEvent) => void, onStatus: (connected: boolean) => void): () => void {
    this.listeners.add(onEvent);
    onStatus(true);
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), 1000);
    return () => {
      this.listeners.delete(onEvent);
      if (!this.listeners.size && this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  async giveTask(agentId: string, task: { title: string; description?: string }): Promise<void> {
    const a = this.agent(agentId);
    if (!a) throw new Error("Onbekende agent.");
    if (this.halted) throw new Error("De noodstop staat aan. Hervat eerst, dan kun je weer taken geven.");
    this.emit({ type: "talk", agentId: OWNER_ID, targetAgentId: agentId, text: `Nieuwe taak voor jou: ${task.title}`, data: { kind: "delegate", by: "owner" } });
    // Even later begint de agent eraan (zoals Paperclip hem wakker maakt).
    window.setTimeout(() => {
      if (this.runs.has(agentId) || this.halted) return;
      this.runs.set(agentId, { until: this.clock + 25, task: task.title });
      a.status = "running";
      a.currentTask = task.title;
      this.emit({ type: "run.started", agentId, text: task.title, data: { wakeReason: "issue_assigned" } });
    }, 6000);
  }

  async saveCodeProject(input: CodeProjectInput): Promise<void> {
    const key = input.key ?? (input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project");
    const existing = this.codeProjects.find((p) => p.key === key);
    const next: CodeProject = {
      ...(existing ?? {
        key,
        empty: false,
        error: null,
        polledAt: new Date().toISOString(),
        activeSessions: 0,
        defaultBranch: "main",
        health: { state: "unknown", status: null, ms: null, checkedAt: null, since: null, uptime24h: null, note: null },
        deploy: null,
        ci: null,
        lastCommit: null,
        openPrs: [],
        backlog: null,
        repoUrl: null,
        description: null,
      }),
      name: input.name,
      repo: input.repo ?? null,
      url: input.url ?? null,
      healthUrl: input.healthUrl ?? null,
      branch: input.branch ?? null,
    };
    if (existing) this.codeProjects = this.codeProjects.map((p) => (p.key === key ? next : p));
    else this.codeProjects.push(next);
    this.emit({ type: "code.backlog", agentId: null, text: `${next.name} staat in de werkplaats`, data: { project: key, projectName: next.name, added: [] } });
  }
  async removeCodeProject(key: string): Promise<void> {
    this.codeProjects = this.codeProjects.filter((p) => p.key !== key);
    this.codeSessions = this.codeSessions.filter((s) => s.projectKey !== key);
  }
  async refreshCodeProject(key: string): Promise<CodeProject | null> {
    const p = this.codeProjects.find((x) => x.key === key);
    if (p) p.polledAt = new Date().toISOString();
    return p ?? null;
  }
  async codeRepos(): Promise<{ repos: RepoChoice[]; error: string | null }> {
    return { repos: REPOS, error: null };
  }

  /** Iets in de werkplaats: een stap van Claude, een commit, tests, een uitrol, af en toe een storing. */
  private codeStep(): void {
    const cookie = this.codeProjects.find((p) => p.key === "cookiewacht");
    // Eens in de zes minuten ligt de demo-site even plat, om te laten zien wat er dan gebeurt.
    if (cookie && this.clock % 360 === 200) {
      cookie.health = { ...cookie.health, state: "down", status: 503, since: new Date().toISOString(), note: "de gezondheidscheck zegt nee (503): vaak ligt de database eruit" };
      this.emit({ type: "code.health", agentId: null, text: "🔴 Cookiewacht ligt eruit: de gezondheidscheck zegt nee (503). Adres: https://cookiewacht.example/api/gezondheid", data: { project: "cookiewacht", projectName: "Cookiewacht", state: "down", status: 503 } });
      return;
    }
    if (cookie && cookie.health.state === "down" && this.clock % 360 === 230) {
      cookie.health = { ...cookie.health, state: "up", status: 200, since: new Date().toISOString(), note: null };
      this.emit({ type: "code.health", agentId: null, text: "🟢 Cookiewacht is weer bereikbaar (lag 1 min plat).", data: { project: "cookiewacht", projectName: "Cookiewacht", state: "up", minutes: 1 } });
      return;
    }
    // Eens in de drie minuten rondt een sessie af (PR samengevoegd) en komt er een nieuwe opdracht.
    const working = this.codeSessions.filter((s) => s.state === "working");
    if (this.clock % 180 === 90 && working.length) {
      const s = working[0]!;
      s.state = "done";
      const project = this.codeProjects.find((p) => p.key === s.projectKey);
      const pr = s.pr ?? { number: 13 + (this.clock % 50), url: "https://github.com", state: "open" as const, ci: "passed" as const };
      this.emit({ type: "code.pr", agentId: s.actorId, text: `Samengevoegd: PR #${pr.number} ${s.title ?? ""}`, data: { project: s.projectKey, projectName: project?.name, action: "merged", number: pr.number } });
      if (project) {
        project.openPrs = project.openPrs.filter((x) => x.branch !== s.branch);
        project.deploy = { state: "success", url: project.url, at: new Date().toISOString(), environment: "Production", sha: "d3m0" };
      }
      return;
    }
    if (this.clock % 180 === 110) {
      const [projectKey, title] = NEW_TASKS[this.taskIndex++ % NEW_TASKS.length]!;
      const id = `demo-${this.clock}`;
      const project = this.codeProjects.find((p) => p.key === projectKey);
      this.codeSessions.push({
        id,
        actorId: `cc:${id}`,
        projectKey,
        source: "cloud",
        url: "https://claude.ai/code",
        branch: `claude/${title.toLowerCase().split(" ").slice(0, 3).join("-")}`,
        title,
        lastAction: `📋 ${title}`,
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        state: "working",
        commits: 0,
        pr: null,
      });
      this.emit({ type: "code.session", agentId: `cc:${id}`, text: `Nieuwe opdracht voor Claude Code (${project?.name ?? projectKey}): ${title}`, data: { project: projectKey, projectName: project?.name, action: "task" } });
      return;
    }
    const s = pick(working);
    if (!s) return;
    const project = this.codeProjects.find((p) => p.key === s.projectKey);
    const roll = Math.random();
    if (roll < 0.6) {
      const step = pick(CODE_STEPS[s.projectKey ?? ""] ?? CODE_STEPS.hq!);
      s.lastAction = step;
      s.lastActivityAt = new Date().toISOString();
      this.emit({ type: "code.session", agentId: s.actorId, text: step, data: { project: s.projectKey, projectName: project?.name, action: "tool" } });
    } else if (roll < 0.85) {
      const title = pick(CODE_COMMITS[s.projectKey ?? ""] ?? CODE_COMMITS.hq!);
      s.commits += 1;
      s.lastAction = `✍️ ${title}`;
      s.lastActivityAt = new Date().toISOString();
      if (project) project.lastCommit = { sha: Math.random().toString(16).slice(2, 9), title, at: new Date().toISOString(), url: null, session: s.url, branch: s.branch ?? "main" };
      this.emit({ type: "code.commit", agentId: s.actorId, text: title, data: { project: s.projectKey, projectName: project?.name, branch: s.branch } });
    } else if (project) {
      const pr = project.openPrs.find((x) => x.branch === s.branch);
      if (pr) {
        pr.ci = pr.ci === "running" ? (Math.random() < 0.8 ? "passed" : "failed") : "running";
        if (s.pr) s.pr.ci = pr.ci;
        if (pr.ci !== "running") {
          this.emit({ type: "code.ci", agentId: s.actorId, text: pr.ci === "failed" ? `Tests rood op PR #${pr.number}: ${pr.title}` : `Tests weer groen op PR #${pr.number}`, data: { project: project.key, projectName: project.name, state: pr.ci } });
        }
      } else {
        const number = 20 + (this.clock % 70);
        project.openPrs.push({ number, title: s.title ?? "Werk van Claude", url: "https://github.com", draft: true, branch: s.branch ?? "claude/x", ci: "running", updatedAt: new Date().toISOString() });
        s.pr = { number, url: "https://github.com", state: "open", ci: "running" };
        this.emit({ type: "code.pr", agentId: s.actorId, text: `PR #${number}: ${s.title ?? ""}`, data: { project: project.key, projectName: project.name, action: "opened", number } });
      }
    }
  }

  async decide(approvalId: number, decision: "approve" | "reject"): Promise<void> {
    const a = this.approvals.find((x) => x.id === approvalId);
    if (!a) throw new Error("Dit verzoek is al beslist.");
    this.approvals = this.approvals.filter((x) => x !== a);
    const approved = decision === "approve";
    this.emit({ type: "approval.decided", agentId: a.requestedByAgentId, text: a.title, data: { approvalId, kind: a.kind, status: approved ? "approved" : "rejected" } });
    if (a.projectId) {
      const p = this.projects.find((x) => x.id === a.projectId);
      if (p && approved) {
        p.status = "running";
        p.startedAt = new Date().toISOString();
        p.daysLeft = 21;
        p.value = 0;
        this.emit({ type: "experiment.started", agentId: p.leadAgentId, text: `${p.code} ${p.title}`, data: { experimentId: p.id, branch: p.branch, budgetEur: p.budgetEur } });
      } else if (p) {
        p.status = "rejected";
        p.reason = "Afgewezen door jou.";
      }
    }
    if (a.hireAgentId) {
      const agent = this.agent(a.hireAgentId);
      if (agent && approved) {
        agent.status = "idle";
        this.emit({ type: "agent.status", agentId: agent.id, text: `${agent.name} is aangenomen`, data: { from: "pending_approval", to: "idle" } });
      } else if (agent) {
        agent.status = "terminated";
        this.emit({ type: "agent.status", agentId: agent.id, text: `${agent.name} is niet aangenomen`, data: { from: "pending_approval", to: "terminated" } });
      }
    }
    if (a.branch && approved && !this.branches.some((b) => b.slug === NEW_BRANCH.slug)) {
      const lead = `demo-${NEW_BRANCH.agents[0]!.name.toLowerCase()}`;
      this.branches.push({ slug: NEW_BRANCH.slug, name: NEW_BRANCH.name, template: NEW_BRANCH.template, status: "active", budget: NEW_BRANCH.budget, lead });
      for (const s of NEW_BRANCH.agents) {
        const agent: OfficeAgent = {
          id: `demo-${s.name.toLowerCase()}`,
          name: s.name,
          role: ROLES[s.template] ?? "general",
          title: TITLES[s.template] ?? s.template,
          status: "idle",
          branch: NEW_BRANCH.slug,
          hqRole: s.lead ? "lead" : null,
          template: s.template,
          reportsTo: s.lead ? "demo-atlas" : lead,
          model: s.template === "verkenner" ? "claude-haiku-4-5" : "claude-sonnet-5",
          costTodayEur: 0,
          spentMonthEur: 0,
          budgetMonthEur: s.lead ? 15 : 8,
          lastActiveAt: null,
          pauseReason: null,
          currentTask: null,
          nickname: null,
          avatar: null,
        };
        this.agents.push(agent);
        this.emit({ type: "agent.hired", agentId: agent.id, text: `${agent.name} begint bij ${NEW_BRANCH.name}`, data: { name: agent.name, role: agent.role } });
      }
    }
  }

  async halt(reason: string): Promise<void> {
    if (this.halted) return;
    this.halted = true;
    this.haltReason = reason;
    for (const a of this.agents) {
      if (a.status === "terminated" || a.status === "pending_approval") continue;
      if (this.runs.has(a.id)) this.finishRun(a, "cancelled");
      a.status = "paused";
      a.pauseReason = "noodstop";
    }
    this.emit({ type: "halt", agentId: null, text: reason, data: {} });
  }

  async resume(): Promise<void> {
    if (!this.halted) return;
    this.halted = false;
    this.haltReason = null;
    for (const a of this.agents) {
      if (a.pauseReason === "noodstop") {
        a.status = "idle";
        a.pauseReason = null;
      }
    }
    this.emit({ type: "resume", agentId: null, text: null, data: {} });
  }

  async setAgentPaused(agentId: string, paused: boolean): Promise<void> {
    const a = this.agent(agentId);
    if (!a) throw new Error("Onbekende agent.");
    const from = a.status;
    if (paused) {
      if (this.runs.has(a.id)) this.finishRun(a, "cancelled");
      a.status = "paused";
      a.pauseReason = "door jou";
    } else {
      a.status = "idle";
      a.pauseReason = null;
    }
    this.emit({ type: "agent.status", agentId, text: `${a.name} is ${paused ? "gepauzeerd" : "weer aan het werk"} (door jou)`, data: { from, to: a.status, by: "owner" } });
  }

  async setProfile(agentId: string, profile: { nickname?: string | null; avatar?: number | null }): Promise<void> {
    const target = this.agent(agentId) ?? this.people.find((p) => p.id === agentId);
    if (!target) throw new Error("Onbekende agent.");
    const nicknameChanged = profile.nickname !== undefined && (profile.nickname || null) !== target.nickname;
    if (profile.nickname !== undefined) target.nickname = profile.nickname?.trim().slice(0, 30) || null;
    if (profile.avatar !== undefined) target.avatar = profile.avatar;
    this.emit({
      type: "agent.profile",
      agentId,
      text: nicknameChanged ? (target.nickname ? `Heet nu ${target.nickname}` : "Bijnaam weggehaald") : "Nieuw uiterlijk",
      data: { nickname: target.nickname, avatar: target.avatar, changed: nicknameChanged ? "nickname" : "avatar" },
    });
  }

  async project(id: number): Promise<ProjectDetail> {
    const project = this.projects.find((p) => p.id === id);
    if (!project) throw new Error(`Project EXP-${id} bestaat niet.`);
    const re = new RegExp(`${project.code}([^0-9]|$)`);
    return clone({
      project,
      metrics: (this.metrics.get(id) ?? []).map((m) => ({ name: project.metric, ...m })),
      ledger: project.revenueEur ? [{ kind: "revenue", amountEur: project.revenueEur, source: "csv", description: "Omzet (demo)", at: new Date().toISOString() }] : [],
      lessons: this.lessons.filter((l) => l.projectId === id).map(({ projectId: _p, ...l }) => l),
      events: this.events.filter((e) => e.data.experimentId === id || re.test(e.text ?? "")).slice(-30).reverse(),
    });
  }

  async graph(): Promise<KnowledgeGraph> {
    return clone(this.graphData());
  }

  // ---------------------------------------------------------------- simulatie

  private agent(id: string | null | undefined): OfficeAgent | undefined {
    return id ? this.agents.find((a) => a.id === id) : undefined;
  }

  private emit(e: Omit<OfficeEvent, "id" | "at" | "targetAgentId"> & { targetAgentId?: string | null }): void {
    const event: OfficeEvent = { targetAgentId: null, ...e, id: this.nextId++, at: new Date().toISOString() };
    this.events.push(event);
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
    for (const fn of this.listeners) fn(event);
  }

  private active(): OfficeAgent[] {
    return this.agents.filter((a) => a.status !== "paused" && a.status !== "terminated" && a.status !== "pending_approval");
  }

  private taskFor(a: OfficeAgent): string {
    const key = a.hqRole === "ceo" ? "ceo" : a.hqRole === "analyst" ? "analyst" : TASKS[`${a.template}:${a.branch}`] ? `${a.template}:${a.branch}` : (a.template ?? "pitcher");
    const list = TASKS[key] ?? TASKS[`${a.template}:games`] ?? TASKS.pitcher!;
    return pick(list);
  }

  private startRun(a: OfficeAgent, announce = true): void {
    const task = this.taskFor(a);
    this.runs.set(a.id, { until: this.clock + 14 + Math.random() * 30, task });
    a.status = "running";
    a.currentTask = task;
    a.lastActiveAt = new Date().toISOString();
    if (announce) this.emit({ type: "run.started", agentId: a.id, text: task, data: {} });
    else this.events.push({ id: this.nextId++, at: new Date().toISOString(), type: "run.started", agentId: a.id, targetAgentId: null, text: task, data: {} });
  }

  private finishRun(a: OfficeAgent, status: "succeeded" | "failed" | "cancelled"): void {
    const run = this.runs.get(a.id);
    this.runs.delete(a.id);
    a.status = "idle";
    a.currentTask = null;
    const tokensIn = 8000 + Math.round(Math.random() * 40_000);
    const tokensOut = 600 + Math.round(Math.random() * 4000);
    const costEur = round2((a.model?.includes("haiku") ? 0.004 : a.model?.includes("opus") ? 0.05 : 0.02) * (tokensIn / 10_000));
    a.costTodayEur = round2(a.costTodayEur + costEur);
    a.spentMonthEur = round2(a.spentMonthEur + costEur);
    const today = this.days[this.days.length - 1]!;
    today.costEur = round2(today.costEur + costEur);
    this.emit({ type: "run.finished", agentId: a.id, text: run?.task ?? null, data: { status, tokensIn, tokensOut, costUsd: round2(costEur * 1.08), model: a.model } });
  }

  private webStep(): void {
    const a = this.agent(pick([...this.runs.keys()]));
    if (!a) return;
    const steps = WEB_STEPS[a.template === "tak-lead" ? "lead" : (a.template ?? "")] ?? WEB_STEPS.verkenner!;
    const text = pick(steps);
    const kind = text.startsWith("🔎") ? "search" : text.startsWith("📈") ? "trends" : text.startsWith("🕸️") ? "graph" : text.startsWith("✍️") ? "code" : "fetch";
    this.emit({ type: "agent.tool", agentId: a.id, text, data: { kind, detail: text.split(": ").slice(1).join(": ") } });
  }

  private tick(): void {
    this.clock += 1;
    for (const [id, run] of [...this.runs]) {
      const a = this.agent(id);
      if (!a) {
        this.runs.delete(id);
        continue;
      }
      if (this.clock >= run.until) this.finishRun(a, Math.random() < 0.06 ? "failed" : "succeeded");
    }
    if (this.halted) return;
    // Wie aan het werk is, gaat soms het web op.
    if (this.runs.size && Math.random() < 0.22) this.webStep();
    // De werkplaats: Claude Code aan het werk, en af en toe iets met een project.
    if (Math.random() < 0.18 || this.clock % 180 === 90 || this.clock % 180 === 110 || this.clock % 360 === 200 || this.clock % 360 === 230) this.codeStep();
    // Elke 2 à 3 seconden gebeurt er iets.
    if (this.clock % 2 !== 0 && Math.random() < 0.5) return;
    const roll = Math.random();
    const free = this.active().filter((a) => !this.runs.has(a.id));
    if (roll < 0.3) {
      if (this.runs.size < 7 && free.length) this.startRun(pick(free));
    } else if (roll < 0.48) {
      this.talk();
    } else if (roll < 0.6) {
      const a = pick(this.active());
      if (a) this.emit({ type: "knowledge.query", agentId: a.id, text: pick(QUESTIONS), data: {} });
    } else if (roll < 0.65) {
      const a = pick(this.active());
      if (a) this.emit({ type: "knowledge.write", agentId: a.id, text: pick(LESSONS), data: { kind: "lesson" } });
    } else if (roll < 0.74) {
      this.metric();
    } else if (roll < 0.8) {
      this.revenue();
    } else if (roll < 0.83) {
      const a = pick(this.active().filter((x) => x.hqRole === "lead" || x.hqRole === "ceo"));
      if (a) this.emit({ type: "notify", agentId: a.id, text: pick(NOTIFY), data: {} });
    } else if (roll < 0.86) {
      this.request();
    } else if (roll < 0.9) {
      const summary = `📊 Tussenstand: vandaag ${eur(this.days[this.days.length - 1]!.revenueEur)} omzet, ${this.runs.size} agents aan het werk, ${this.approvals.length} ${this.approvals.length === 1 ? "verzoek wacht" : "verzoeken wachten"} op jou.`;
      this.emit({ type: "message.sent", agentId: BOT_ID, text: summary, data: { silent: true } });
    } else if (roll < 0.92) {
      this.verdict();
    }
  }

  private talk(): void {
    const active = this.active();
    const from = pick(active);
    if (!from) return;
    const colleagues = active.filter((a) => a.id !== from.id && (a.branch === from.branch || a.hqRole === "ceo" || from.hqRole === "ceo"));
    const to = pick(colleagues);
    if (!to) return;
    const lead = from.hqRole === "lead" || from.hqRole === "ceo";
    if (lead && Math.random() < 0.5) {
      this.emit({ type: "talk", agentId: from.id, targetAgentId: to.id, text: `Nieuwe taak voor jou: ${this.taskFor(to)}`, data: { kind: "delegate" } });
    } else {
      this.emit({ type: "talk", agentId: from.id, targetAgentId: to.id, text: pick(lead ? TALK.lead! : TALK.member!), data: { kind: "comment" } });
    }
  }

  private metric(): void {
    const running = this.projects.filter((p) => p.status === "running");
    const p = pick(running);
    if (!p) return;
    const step = p.metric === "plays" ? 40 + Math.round(Math.random() * 160) : p.metric === "clicks" ? 3 + Math.round(Math.random() * 12) : 1 + Math.round(Math.random() * 2);
    p.value = (p.value ?? 0) + step;
    p.spentEur = round2(Math.min(p.budgetEur, p.spentEur + 0.3));
    const list = this.metrics.get(p.id) ?? [];
    list.push({ value: p.value, at: new Date().toISOString(), source: p.branch === "games" ? "crazygames" : "agent", trusted: p.trusted });
    this.metrics.set(p.id, list.slice(-30));
    this.emit({ type: "metric", agentId: p.leadAgentId, text: `${p.code} ${p.metric}: ${p.value}`, data: { experimentId: p.id, name: p.metric, value: p.value, trusted: p.trusted } });
  }

  private revenue(): void {
    const earning = this.projects.filter((p) => (p.status === "running" || p.status === "keep") && p.branch !== "saas");
    const p = pick(earning);
    if (!p) return;
    const amount = round2(0.6 + Math.random() * (p.status === "keep" ? 9 : 4));
    p.revenueEur = round2(p.revenueEur + amount);
    const today = this.days[this.days.length - 1]!;
    today.revenueEur = round2(today.revenueEur + amount);
    const text = p.branch === "games" ? `CrazyGames advertenties · ${p.code}` : `Affiliate-commissie · ${p.code}`;
    this.emit({ type: "revenue", agentId: null, text, data: { amountEur: amount, branch: p.branch, experimentId: p.id, source: "csv" } });
  }

  private request(): void {
    if (this.approvals.length >= 3) return;
    const options: Array<() => void> = [
      () => {
        const p = this.projects.find((x) => x.status === "proposed" && !this.approvals.some((a) => a.projectId === x.id));
        if (!p) return;
        this.addApproval({ title: `${p.code} starten: ${p.title}`, kind: "experiment_start", summary: p.hypothesis, amountEur: p.budgetEur, requestedByAgentId: p.leadAgentId, projectId: p.id });
      },
      () => {
        const p = pick(this.projects.filter((x) => x.status === "running"));
        if (!p || this.approvals.some((a) => a.kind === "budget_increase")) return;
        this.addApproval({ title: `Budget ${p.code} verhogen met € 10`, kind: "budget_increase", summary: `${p.title} loopt goed (${p.value}/${p.target} ${p.metric}); met € 10 extra halen we het doel eerder.`, amountEur: 10, requestedByAgentId: p.leadAgentId });
      },
      () => {
        if (this.branches.some((b) => b.slug === NEW_BRANCH.slug) || this.approvals.some((a) => a.branch)) return;
        this.addApproval({ title: "Nieuwe tak: E-commerce (digitale planners)", kind: "branch_create", summary: "Digitale planners verkopen goed op Etsy; start met € 30 per maand en 4 agents. Keur je goed, dan komt er een afdeling bij.", amountEur: 30, requestedByAgentId: "demo-atlas", branch: true });
      },
      () => {
        if (this.hires >= 2 || this.agents.some((a) => a.status === "pending_approval")) return;
        this.hires += 1;
        const name = pick(["Lyra", "Orion", "Mira", "Nova"].filter((n) => !this.agent(`demo-${n.toLowerCase()}`)));
        if (!name) return;
        const branch = pick(["games", "content", "saas"]);
        const agent: OfficeAgent = {
          id: `demo-${name.toLowerCase()}`,
          name,
          role: "researcher",
          title: "Verkenner",
          status: "pending_approval",
          branch,
          hqRole: null,
          template: "verkenner",
          reportsTo: this.branches.find((b) => b.slug === branch)?.lead ?? null,
          model: "claude-haiku-4-5",
          costTodayEur: 0,
          spentMonthEur: 0,
          budgetMonthEur: 6,
          lastActiveAt: null,
          pauseReason: null,
          currentTask: null,
          nickname: null,
          avatar: null,
        };
        this.agents.push(agent);
        this.emit({ type: "agent.hired", agentId: agent.id, text: `${name} solliciteert`, data: { name, role: agent.role } });
        const branchName = this.branches.find((b) => b.slug === branch)?.name ?? branch;
        this.addApproval({ title: `Nieuwe agent: ${name} (verkenner, ${branchName})`, kind: "hire_agent", summary: "Extra verkenner voor meer ideeën. Kost ongeveer € 4 per maand.", amountEur: null, requestedByAgentId: agent.reportsTo, hireAgentId: agent.id });
      },
    ];
    pick(options)();
  }

  private addApproval(a: Omit<OfficeApproval, "id" | "createdAt"> & { projectId?: number; hireAgentId?: string; branch?: boolean }): void {
    const approval = { ...a, id: this.nextApproval++, createdAt: new Date().toISOString() };
    this.approvals.push(approval);
    this.emit({ type: "approval.requested", agentId: a.requestedByAgentId, text: a.title, data: { approvalId: approval.id, kind: a.kind, amountEur: a.amountEur } });
  }

  private verdict(): void {
    const p = this.projects.find((x) => x.status === "running" && x.value !== null && x.value >= x.target);
    if (!p) return;
    p.status = "keep";
    p.endedAt = new Date().toISOString();
    p.daysLeft = null;
    p.reason = `Doel gehaald: ${p.value}/${p.target} ${p.metric}.`;
    this.emit({ type: "experiment.verdict", agentId: p.leadAgentId, text: `🏆 KEEP ${p.code} ${p.title}`, data: { experimentId: p.id, verdict: "keep", branch: p.branch, reason: p.reason } });
    this.lessons.push({ id: this.lessons.length + 1, lesson: `${p.title}: doel gehaald met ${eur(p.spentEur)} budget`, tags: ["keep"], at: new Date().toISOString(), projectId: p.id });
  }

  // ---------------------------------------------------------------- kennisgraaf

  private graphData(): KnowledgeGraph {
    if (this.graphCache) return this.graphCache;
    const rnd = seeded(7);
    const nodes: KnowledgeGraph["nodes"] = [];
    const edges: KnowledgeGraph["edges"] = [];
    const node = (id: string, label: string, kind: string, group: string | null) => nodes.push({ id, label, kind, group, degree: 0 });
    const edge = (source: string, target: string, relation: string) => edges.push({ source, target, relation });
    const topics: Record<string, string[]> = {
      games: ["puzzel", "idle", "merge", "roguelite", "levels", "laadtijd", "thumbnails", "CrazyGames", "Poki", "retentie", "advertenties", "kleurmenging", "moeilijkheid", "mobiel"],
      content: ["affiliate", "vergelijking", "zoekwoorden", "microfoons", "e-bikes", "verzekering", "tabel", "Bol.com", "kliks", "SEO"],
      saas: ["landingspagina", "zzp", "facturen", "OCR", "aanmeldingen", "prijzen", "Stripe", "gratis versie", "B2B", "boekhouding"],
      holding: ["budget", "portfolio", "weekplan", "kosten", "lessen", "ideeënraad", "experimenten", "goedkeuring"],
    };
    for (const [group, list] of Object.entries(topics)) {
      node(`branch:${group}`, group === "holding" ? "Holding" : (this.branches.find((b) => b.slug === group)?.name ?? group), "branch", group);
      for (const t of list) {
        node(`tag:${group}:${t}`, t, "tag", group);
        edge(`branch:${group}`, `tag:${group}:${t}`, "gaat over");
      }
    }
    for (const p of this.projects) {
      node(`exp:${p.id}`, `${p.code} ${p.title}`, "experiment", p.branch);
      edge(`branch:${p.branch}`, `exp:${p.id}`, "experiment");
      const tags = topics[p.branch] ?? [];
      for (let k = 0; k < 3; k++) edge(`exp:${p.id}`, `tag:${p.branch}:${pick(tags, rnd)}`, "tag");
    }
    LESSONS.forEach((l, k) => {
      const group = k === 1 ? "content" : k === 2 ? "saas" : "games";
      node(`lesson:${k}`, l, "les", group);
      edge(`lesson:${k}`, `tag:${group}:${pick(topics[group]!, rnd)}`, "tag");
      edge(`lesson:${k}`, `exp:${[2, 4, 5, 3, 1, 1][k]}`, "geleerd bij");
    });
    for (const a of this.agents.filter((x) => x.status !== "pending_approval")) {
      const group = a.branch;
      node(`agent:${a.id}`, a.name, "agent", group);
      edge(`agent:${a.id}`, `branch:${group}`, "werkt bij");
    }
    // Notities van agents (wat ze onderweg opschreven).
    const notes = [
      "Spelers haken af bij level 7",
      "Top 10 CrazyGames puzzels: gemiddeld 40 s per level",
      "Bol.com betaalt 5-8% op audio",
      "Zzp'ers noemen 'btw-fouten' het vaakst",
      "Poki wil exclusiviteit voor promotie",
      "Etsy-planners: prijzen € 3-9",
      "Reddit: mensen willen geen login in webgames",
      "Landingspagina A/B: korte kop wint",
      "Kosten per run Haiku ≈ € 0,004",
      "Thumbnail met pijl: 12% meer kliks",
    ];
    notes.forEach((n, k) => {
      const group = ["games", "games", "content", "saas", "games", "holding", "games", "saas", "holding", "games"][k]!;
      node(`note:${k}`, n, "notitie", group);
      edge(`note:${k}`, `tag:${group}:${pick(topics[group]!, rnd)}`, "tag");
      edge(`note:${k}`, `tag:${group}:${pick(topics[group]!, rnd)}`, "tag");
    });
    // Wat verbanden tussen onderwerpen van verschillende takken (Graphify vindt die ook).
    for (let k = 0; k < 24; k++) {
      const a = pick(nodes.filter((n) => n.kind === "tag"), rnd);
      const b = pick(nodes.filter((n) => n.kind === "tag" && n.group !== a.group), rnd);
      edge(a.id, b.id, "lijkt op");
    }
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    for (const n of nodes) n.degree = degree.get(n.id) ?? 0;
    this.graphCache = { source: "graphify", builtAt: new Date(Date.now() - 5 * 3600_000).toISOString(), nodes, edges, totalNodes: nodes.length, totalEdges: edges.length };
    return this.graphCache;
  }
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
