import { z } from "zod";

/**
 * Alle instellingen komen uit environment-variabelen (zie deploy/hq.env.example).
 * Bedragen staan in euro's; Paperclip rekent intern in (dollar)centen.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  HQ_PORT: z.coerce.number().int().positive().default(8080),
  HQ_HOST: z.string().default("127.0.0.1"),
  HQ_PUBLIC_URL: z.string().optional(),
  /** Adres waarop agents (Claude Code op dezelfde machine) HQ bereiken; komt als $HQ_URL in hun omgeving. */
  HQ_AGENT_URL: z.string().optional(),
  /** Token voor het dashboard en de eigenaar-API. Verplicht zodra HQ_HOST niet 127.0.0.1 is. */
  HQ_ADMIN_TOKEN: z.string().optional(),
  HQ_TIMEZONE: z.string().default("Europe/Amsterdam"),
  HQ_COMPANY_DIR: z.string().optional(),

  PAPERCLIP_API_URL: z.string().default("http://127.0.0.1:3100/api"),
  PAPERCLIP_BOARD_TOKEN: z.string().optional(),
  PAPERCLIP_COMPANY_ID: z.string().optional(),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_OWNER_CHAT_ID: z.string().optional(),

  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_TO: z.string().optional(),
  WHATSAPP_TEMPLATE: z.string().optional(),
  WHATSAPP_TEMPLATE_LANG: z.string().default("nl"),
  WHATSAPP_API_VERSION: z.string().default("v23.0"),

  STRIPE_API_KEY: z.string().optional(),
  /** Tak die Stripe-omzet krijgt als een betaling geen metadata.branch heeft. */
  STRIPE_DEFAULT_BRANCH: z.string().optional(),

  /** Omrekenkoers voor Paperclip-kosten (in dollarcent) naar euro. Pas aan als de koers verschuift. */
  HQ_USD_TO_EUR: z.coerce.number().positive().default(0.9),
  /** Harde bovengrens voor al het AI-gebruik per maand, bovenop wat omzet vrijmaakt. */
  HQ_GLOBAL_MONTHLY_CAP_EUR: z.coerce.number().nonnegative().default(40),
  /** Startbudget per experiment en het maximum dat een agent zonder extra motivatie mag vragen. */
  HQ_EXPERIMENT_BUDGET_EUR: z.coerce.number().positive().default(20),
  HQ_EXPERIMENT_MAX_BUDGET_EUR: z.coerce.number().positive().default(50),
  HQ_EXPERIMENT_MAX_DAYS: z.coerce.number().int().positive().default(14),
  /** Deel van de omzet (laatste 30 dagen) dat een tak aan AI mag uitgeven. */
  HQ_REVENUE_SHARE_FOR_AI: z.coerce.number().min(0).max(1).default(0.3),
  /** Boven dit bedrag aan AI-kosten per dag gaat alles automatisch op stop. */
  HQ_DAILY_SPEND_ALARM_EUR: z.coerce.number().positive().default(15),
  /** Maximaal aantal goedkeuringsverzoeken per agent per dag (tegen spam en prompt-injectie). */
  HQ_MAX_REQUESTS_PER_AGENT_PER_DAY: z.coerce.number().int().positive().default(5),
  HQ_MAX_ITERATIONS: z.coerce.number().int().nonnegative().default(2),

  /** Map met de kennisbank (Markdown-notities voor Graphify en Obsidian). Standaard ~/vault. */
  HQ_VAULT_DIR: z.string().optional(),
  /** Het graphify-programma (pip install graphifyy). */
  GRAPHIFY_BIN: z.string().default("graphify"),
  /** Sleutel waarmee Graphify 's nachts de kennisgraaf opbouwt. Zonder sleutel gebruikt HQ zijn eigen graaf. */
  GRAPHIFY_API_KEY: z.string().optional(),
  GRAPHIFY_BACKEND: z.string().default("claude"),
  GRAPHIFY_MODEL: z.string().default("claude-haiku-4-5"),
  /** Pas vanaf zoveel lessen en notities bouwt Graphify een graaf met AI en krijgen agents graaf-uitvoer. */
  HQ_GRAPHIFY_MIN_NOTES: z.coerce.number().int().min(0).default(100),

  /** Werkplaats: token (fine-grained, alleen lezen) waarmee HQ je repositories volgt. */
  HQ_GITHUB_TOKEN: z.string().optional(),
  /** Hoe vaak HQ GitHub bekijkt (seconden) en de sites controleert. */
  HQ_GITHUB_POLL_SECONDS: z.coerce.number().int().min(30).default(120),
  /** Nieuwe repositories waar het token bij kan vanzelf volgen ("uit" = alleen wat je zelf toevoegt). */
  HQ_AUTO_FOLLOW: z.string().default("aan"),
  HQ_HEALTH_CHECK_SECONDS: z.coerce.number().int().min(60).default(300),
  /** Geheim waarmee Claude Code-hooks live meldingen sturen (alleen schrijven). Leeg = uit. */
  HQ_HOOK_TOKEN: z.string().min(16).optional(),
  /** Hoe jij heet in backlogs ("dit ligt bij Kalle"), komma-gescheiden. */
  HQ_OWNER_NAMES: z.string().default("Kalle"),

  /** Gratis AI: OmniRoute op deze server (zie `dist/main.js gratis-ai`). */
  HQ_GRATIS_AI_URL: z.string().default("http://127.0.0.1:20128"),
  /** De sleutel waarmee HQ en de agents OmniRoute gebruiken; `gratis-ai --schrijf` zet hem. Leeg = gratis AI staat uit. */
  HQ_GRATIS_AI_KEY: z.string().optional(),
  /** Welke agents op gratis AI draaien (sjabloonnamen, komma-gescheiden), bv. "verkenner". Leeg = geen. */
  HQ_GRATIS_AI_ROLES: z.string().default(""),
  /** Contextvenster waarop Claude Code moet rekenen bij gratis modellen (die zijn kleiner dan Claude). */
  HQ_GRATIS_AI_CONTEXT: z.coerce.number().int().min(8000).default(64000),
  /** Hoeveel modellen per aanbieder in de combo "gratis" (limieten gelden vaak per model). */
  HQ_GRATIS_AI_PER_PROVIDER: z.coerce.number().int().min(1).max(10).default(3),
  /** Waar de sleutels van de aanbieders en het OmniRoute-wachtwoord staan, en waar hq.env staat. */
  HQ_GRATIS_AI_ENV: z.string().optional(),
  HQ_ENV_FILE: z.string().optional(),

  /**
   * Nut-meter: agents die in 30 dagen geld kostten zonder resultaat automatisch pauzeren (wekelijks).
   * In het kantoor blijven ze zitten, zonder naam. "uit" (of false/0/nee) = alleen melden.
   */
  HQ_AUTO_PAUSE: z.string().default("aan"),
  HQ_VALUE_CRON: z.string().default("0 7 * * 1"),

  HQ_DAILY_REPORT_CRON: z.string().default("0 8 * * *"),
  HQ_WEEKLY_PORTFOLIO_CRON: z.string().default("30 7 * * 1"),
  HQ_SYNC_CRON: z.string().default("*/2 * * * *"),
  HQ_COST_SYNC_CRON: z.string().default("*/15 * * * *"),
  HQ_REVENUE_IMPORT_CRON: z.string().default("0 * * * *"),
  HQ_EVALUATE_CRON: z.string().default("0 7 * * *"),
  HQ_VAULT_SYNC_CRON: z.string().default("20 * * * *"),
  HQ_KNOWLEDGE_CRON: z.string().default("30 3 * * *"),
});

export type Env = z.infer<typeof envSchema>;

export interface Config {
  databaseUrl: string | undefined;
  port: number;
  host: string;
  publicUrl: string;
  agentUrl: string;
  adminToken: string | undefined;
  timezone: string;
  companyDir: string | undefined;
  paperclip: {
    apiUrl: string;
    boardToken: string | undefined;
    companyId: string | undefined;
  };
  /** Zonder ownerChatId draait de bot in installatiemodus (hij vertelt je alleen je chat-id). */
  telegram: { botToken: string; ownerChatId: string | undefined } | undefined;
  whatsapp:
    | {
        token: string;
        phoneNumberId: string;
        to: string;
        template: string | undefined;
        templateLang: string;
        apiVersion: string;
      }
    | undefined;
  stripe: { apiKey: string; defaultBranch: string | undefined } | undefined;
  money: {
    usdToEur: number;
    globalMonthlyCapEur: number;
    experimentBudgetEur: number;
    experimentMaxBudgetEur: number;
    experimentMaxDays: number;
    revenueShareForAi: number;
    dailySpendAlarmEur: number;
    maxRequestsPerAgentPerDay: number;
    maxIterations: number;
  };
  knowledge: {
    vaultDir: string | undefined;
    graphifyBin: string;
    graphifyApiKey: string | undefined;
    graphifyBackend: string;
    graphifyModel: string;
    /** Onder dit aantal lessen en notities voegt een graaf weinig toe: geen AI-extractie, geen graaf-uitvoer. */
    graphifyMinNotes: number;
  };
  gratisAi: {
    url: string;
    key: string | undefined;
    roles: string[];
    contextTokens: number;
    perProvider: number;
    envFile: string;
    /** Het env-bestand van HQ zelf: `gratis-ai --schrijf` zet daar de sleutel in. */
    hqEnvFile: string;
  };
  code: {
    githubToken: string | undefined;
    pollMs: number;
    healthMs: number;
    /** Nieuwe repositories van het token vanzelf volgen. */
    autoFollow: boolean;
    hookToken: string | undefined;
    ownerNames: string[];
  };
  value: {
    /** Agents zonder aantoonbaar resultaat automatisch pauzeren (de nut-meter). */
    autoPause: boolean;
  };
  cron: {
    value: string;
    dailyReport: string;
    weeklyPortfolio: string;
    sync: string;
    costSync: string;
    revenueImport: string;
    evaluate: string;
    vaultSync: string;
    knowledge: string;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Lege regels in het env-bestand (bv. `PAPERCLIP_COMPANY_ID=`) betekenen "niet ingesteld".
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const e = envSchema.parse(cleaned);
  if (e.HQ_HOST !== "127.0.0.1" && e.HQ_HOST !== "localhost" && !e.HQ_ADMIN_TOKEN) {
    throw new Error(
      "HQ_ADMIN_TOKEN is verplicht als HQ niet alleen op localhost luistert (HQ_HOST=" + e.HQ_HOST + ").",
    );
  }
  return {
    databaseUrl: e.DATABASE_URL,
    port: e.HQ_PORT,
    host: e.HQ_HOST,
    publicUrl: e.HQ_PUBLIC_URL ?? `http://${e.HQ_HOST}:${e.HQ_PORT}`,
    agentUrl: (e.HQ_AGENT_URL ?? `http://127.0.0.1:${e.HQ_PORT}`).replace(/\/+$/, ""),
    adminToken: e.HQ_ADMIN_TOKEN,
    timezone: e.HQ_TIMEZONE,
    companyDir: e.HQ_COMPANY_DIR,
    paperclip: {
      apiUrl: e.PAPERCLIP_API_URL.replace(/\/+$/, ""),
      boardToken: e.PAPERCLIP_BOARD_TOKEN,
      companyId: e.PAPERCLIP_COMPANY_ID,
    },
    telegram: e.TELEGRAM_BOT_TOKEN
      ? { botToken: e.TELEGRAM_BOT_TOKEN, ownerChatId: e.TELEGRAM_OWNER_CHAT_ID || undefined }
      : undefined,
    whatsapp:
      e.WHATSAPP_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID && e.WHATSAPP_TO
        ? {
            token: e.WHATSAPP_TOKEN,
            phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID,
            to: e.WHATSAPP_TO,
            template: e.WHATSAPP_TEMPLATE,
            templateLang: e.WHATSAPP_TEMPLATE_LANG,
            apiVersion: e.WHATSAPP_API_VERSION,
          }
        : undefined,
    stripe: e.STRIPE_API_KEY ? { apiKey: e.STRIPE_API_KEY, defaultBranch: e.STRIPE_DEFAULT_BRANCH } : undefined,
    money: {
      usdToEur: e.HQ_USD_TO_EUR,
      globalMonthlyCapEur: e.HQ_GLOBAL_MONTHLY_CAP_EUR,
      experimentBudgetEur: e.HQ_EXPERIMENT_BUDGET_EUR,
      experimentMaxBudgetEur: e.HQ_EXPERIMENT_MAX_BUDGET_EUR,
      experimentMaxDays: e.HQ_EXPERIMENT_MAX_DAYS,
      revenueShareForAi: e.HQ_REVENUE_SHARE_FOR_AI,
      dailySpendAlarmEur: e.HQ_DAILY_SPEND_ALARM_EUR,
      maxRequestsPerAgentPerDay: e.HQ_MAX_REQUESTS_PER_AGENT_PER_DAY,
      maxIterations: e.HQ_MAX_ITERATIONS,
    },
    knowledge: {
      vaultDir: e.HQ_VAULT_DIR ?? (cleaned.HOME ? `${cleaned.HOME}/vault` : undefined),
      graphifyBin: e.GRAPHIFY_BIN,
      graphifyApiKey: e.GRAPHIFY_API_KEY,
      graphifyBackend: e.GRAPHIFY_BACKEND,
      graphifyModel: e.GRAPHIFY_MODEL,
      graphifyMinNotes: e.HQ_GRAPHIFY_MIN_NOTES,
    },
    gratisAi: {
      url: e.HQ_GRATIS_AI_URL.replace(/\/+$/, ""),
      key: e.HQ_GRATIS_AI_KEY,
      roles: e.HQ_GRATIS_AI_ROLES.split(",").map((r) => r.trim()).filter(Boolean),
      contextTokens: e.HQ_GRATIS_AI_CONTEXT,
      perProvider: e.HQ_GRATIS_AI_PER_PROVIDER,
      envFile: e.HQ_GRATIS_AI_ENV ?? `${cleaned.HOME ?? "."}/.config/hq/gratis-ai.env`,
      hqEnvFile: e.HQ_ENV_FILE ?? `${cleaned.HOME ?? "."}/.config/hq/hq.env`,
    },
    code: {
      githubToken: e.HQ_GITHUB_TOKEN,
      pollMs: e.HQ_GITHUB_POLL_SECONDS * 1000,
      healthMs: e.HQ_HEALTH_CHECK_SECONDS * 1000,
      autoFollow: !/^(uit|nee|false|0|off|no)$/i.test(e.HQ_AUTO_FOLLOW.trim()),
      hookToken: e.HQ_HOOK_TOKEN,
      ownerNames: e.HQ_OWNER_NAMES.split(",").map((n) => n.trim()).filter(Boolean),
    },
    value: {
      autoPause: !/^(uit|nee|false|0|off|no)$/i.test(e.HQ_AUTO_PAUSE.trim()),
    },
    cron: {
      value: e.HQ_VALUE_CRON,
      dailyReport: e.HQ_DAILY_REPORT_CRON,
      weeklyPortfolio: e.HQ_WEEKLY_PORTFOLIO_CRON,
      sync: e.HQ_SYNC_CRON,
      costSync: e.HQ_COST_SYNC_CRON,
      revenueImport: e.HQ_REVENUE_IMPORT_CRON,
      evaluate: e.HQ_EVALUATE_CRON,
      vaultSync: e.HQ_VAULT_SYNC_CRON,
      knowledge: e.HQ_KNOWLEDGE_CRON,
    },
  };
}

/** Config met veilige standaardwaarden voor tests. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  const base = loadConfig({});
  return {
    ...base,
    ...overrides,
    money: { ...base.money, ...(overrides.money ?? {}) },
    knowledge: { ...base.knowledge, ...(overrides.knowledge ?? {}) },
    code: { ...base.code, ...(overrides.code ?? {}) },
    gratisAi: { ...base.gratisAi, ...(overrides.gratisAi ?? {}) },
    value: { ...base.value, ...(overrides.value ?? {}) },
  };
}
