#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./api/app.js";
import { HqBot, COMMANDS, runPolling } from "./bot/bot.js";
import { bootstrap, formatBootstrapReport, resolveCompanyId } from "./company/bootstrap.js";
import { AgentFactory } from "./company/factory.js";
import { loadCompany } from "./company/loader.js";
import { loadConfig, type Config } from "./config.js";
import { createPgDb, type Db } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { consoleLogger, errorMessage, type AppContext } from "./domain/context.js";
import { halt, resume } from "./domain/killswitch.js";
import { buildDailyReport, buildStatus } from "./domain/report.js";
import { registerWorkflowHooks } from "./domain/workflows.js";
import { importRevenueCsv } from "./importers/csv.js";
import { defaultJobs, runJob, Scheduler } from "./jobs/scheduler.js";
import { ConsoleNotifier, MultiNotifier, type Notifier } from "./notify/notifier.js";
import { TelegramApi, TelegramNotifier } from "./notify/telegram.js";
import { WhatsAppNotifier } from "./notify/whatsapp.js";
import { rebuildKnowledge } from "./knowledge/service.js";
import { OfficeEvents } from "./office/events.js";
import { OfficeNotifier } from "./office/notifier.js";
import { PaperclipWatcher } from "./office/watcher.js";
import { HttpPaperclipClient } from "./paperclip/client.js";

const USAGE = `hq <commando>

  serve                     API, kantoor, Telegram-bot en planner starten (dit draait 24/7)
  migrate                   databaseschema bijwerken
  bootstrap                 company/ (holding, skills, CEO, analist, routines) in Paperclip zetten
  branch <sjabloon> <slug> "<Naam>" [budget]
                            zelf direct een tak opzetten uit een sjabloon (games, content, saas, generiek)
  check                     controleert database, Paperclip en Telegram
  status | report           status of dagrapport in de terminal
  halt [reden] | resume     noodstop aan/uit
  import-csv <bestand>      omzet importeren (kolommen: date, amount_eur, branch, source, ...)
  kennis                    kennisbank-map bijwerken en (met GRAPHIFY_API_KEY) de Graphify-graaf opbouwen
`;

function die(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

function openDb(config: Config): Db {
  if (!config.databaseUrl) die("DATABASE_URL ontbreekt (Postgres, bv. Supabase of lokaal).");
  return createPgDb(config.databaseUrl);
}

function makeNotifier(config: Config): { notifier: Notifier; telegram?: TelegramApi } {
  const channels: Array<{ name: string; notifier: Notifier }> = [];
  let telegram: TelegramApi | undefined;
  if (config.telegram) {
    telegram = new TelegramApi(config.telegram.botToken);
    if (config.telegram.ownerChatId) {
      channels.push({ name: "telegram", notifier: new TelegramNotifier(telegram, config.telegram.ownerChatId) });
    }
  }
  if (config.whatsapp) channels.push({ name: "whatsapp", notifier: new WhatsAppNotifier(config.whatsapp) });
  const notifier = channels.length
    ? new MultiNotifier(channels, (channel, err) => consoleLogger.error("melding mislukt", { channel, error: errorMessage(err) }))
    : new ConsoleNotifier();
  return { notifier, telegram };
}

async function makeContext(config: Config): Promise<{ ctx: AppContext; telegram?: TelegramApi }> {
  const db = openDb(config);
  await migrate(db);
  const paperclip = new HttpPaperclipClient(config.paperclip.apiUrl, config.paperclip.boardToken);
  const companyId = await resolveCompanyId({ db, config });
  if (!companyId) die("Nog geen holding in Paperclip. Draai eerst: hq bootstrap");
  const { notifier, telegram } = makeNotifier(config);
  const events = new OfficeEvents(db, consoleLogger);
  const ctx: AppContext = {
    db,
    config,
    paperclip,
    // Elk bericht aan jou is in het kantoor te zien bij de HQ-bot.
    notifier: new OfficeNotifier(notifier, events),
    companyId,
    events,
    now: () => new Date(),
    log: consoleLogger,
  };
  return { ctx, telegram };
}

function factoryFor(ctx: AppContext): AgentFactory {
  const factory = new AgentFactory(loadCompany(ctx.config.companyDir), ctx.config.agentUrl);
  registerWorkflowHooks({
    createBranchFromTemplate: async (c, proposal) => {
      await factory.createBranchFromTemplate(c, proposal);
    },
  });
  return factory;
}

async function serveCommand(config: Config): Promise<void> {
  const { ctx, telegram } = await makeContext(config);
  const factory = factoryFor(ctx);
  const app = createApp(ctx, { factory, jobs: defaultJobs(ctx) });
  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host });
  ctx.log.info("HQ luistert", { url: `http://${config.host}:${config.port}`, agentUrl: config.agentUrl });

  const scheduler = new Scheduler(ctx);
  scheduler.start();
  // Het kantoor: kijk mee in Paperclip wie er werkt en wie met wie praat.
  const watcher = new PaperclipWatcher(ctx);
  watcher.start();
  // Direct één keer synchroniseren, zodat openstaande verzoeken meteen in Telegram staan.
  for (const job of defaultJobs(ctx).filter((j) => j.name === "approvals-sync" || j.name === "cost-sync")) {
    await runJob(ctx, job);
  }

  const controller = new AbortController();
  if (telegram) {
    const bot = new HqBot(ctx, telegram, config.telegram?.ownerChatId);
    telegram.setCommands(COMMANDS).catch((err) => ctx.log.warn("setMyCommands mislukt", { error: errorMessage(err) }));
    void runPolling(ctx, telegram, bot, controller.signal);
    if (!config.telegram?.ownerChatId) {
      ctx.log.warn("Telegram in installatiemodus: stuur /start naar je bot en zet TELEGRAM_OWNER_CHAT_ID");
    }
  } else {
    ctx.log.warn("Geen TELEGRAM_BOT_TOKEN: meldingen gaan naar de console");
  }
  await ctx.notifier.send({ text: "🟢 HQ is gestart. /status voor een overzicht.", silent: true }).catch(() => undefined);

  const shutdown = async (signal: string) => {
    ctx.log.info("HQ stopt", { signal });
    controller.abort();
    scheduler.stop();
    watcher.stop();
    server.close();
    await ctx.db.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

async function checkCommand(config: Config): Promise<void> {
  let ok = true;
  const line = (good: boolean, text: string) => {
    ok &&= good;
    console.log(`${good ? "✔" : "✖"} ${text}`);
  };
  try {
    if (!config.databaseUrl) throw new Error("DATABASE_URL ontbreekt");
    const db = openDb(config);
    await db.query("select 1");
    const ran = await migrate(db);
    line(true, `Database bereikbaar${ran.length ? ` (migraties: ${ran.join(", ")})` : ""}`);
    const companyId = await resolveCompanyId({ db, config });
    line(Boolean(companyId), companyId ? `Holding in Paperclip: ${companyId}` : "Nog geen holding: draai hq bootstrap");
    await db.close();
  } catch (err) {
    line(false, `Database: ${errorMessage(err)}`);
  }
  try {
    const pc = new HttpPaperclipClient(config.paperclip.apiUrl, config.paperclip.boardToken);
    const h = await pc.health();
    line(h.status === "ok", `Paperclip ${h.version ?? ""} op ${config.paperclip.apiUrl}`);
    await pc.listCompanies();
    line(true, "Paperclip-toegang als board (token klopt)");
  } catch (err) {
    line(false, `Paperclip: ${errorMessage(err)}`);
  }
  if (config.telegram) {
    try {
      const me = await new TelegramApi(config.telegram.botToken).call<{ username: string }>("getMe", {});
      line(true, `Telegram-bot @${me.username}${config.telegram.ownerChatId ? "" : " (nog geen TELEGRAM_OWNER_CHAT_ID)"}`);
    } catch (err) {
      line(false, `Telegram: ${errorMessage(err)}`);
    }
  } else {
    line(false, "TELEGRAM_BOT_TOKEN ontbreekt (meldingen gaan naar de console)");
  }
  try {
    const def = loadCompany(config.companyDir);
    line(true, `company/: ${def.agents.length} agents, ${def.skills.length} skills, ${def.branchTemplates.length} tak-sjablonen`);
  } catch (err) {
    line(false, `company/: ${errorMessage(err)}`);
  }
  process.exit(ok ? 0 : 1);
}

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  if (!command || command === "help" || command === "--help") {
    console.log(USAGE);
    return;
  }
  const config = loadConfig();
  switch (command) {
    case "serve":
      return serveCommand(config);
    case "migrate": {
      const db = openDb(config);
      const ran = await migrate(db);
      console.log(ran.length ? `Uitgevoerd: ${ran.join(", ")}` : "Schema is al up-to-date.");
      await db.close();
      return;
    }
    case "bootstrap": {
      const db = openDb(config);
      await migrate(db);
      const paperclip = new HttpPaperclipClient(config.paperclip.apiUrl, config.paperclip.boardToken);
      const report = await bootstrap({ db, config, paperclip, log: consoleLogger }, loadCompany(config.companyDir));
      console.log(formatBootstrapReport(report));
      await db.close();
      return;
    }
    case "branch": {
      const [template, slug, name, budget] = args;
      if (!template || !slug || !name) die('Gebruik: hq branch <sjabloon> <slug> "<Naam>" [budget]');
      const { ctx } = await makeContext(config);
      const factory = factoryFor(ctx);
      const branch = await factory.createBranchFromTemplate(ctx, {
        slug,
        name,
        template,
        pitch: "Door de eigenaar zelf opgezet via de CLI.",
        evidence: ["https://example.com/eigenaar"],
        monthlyBudgetEur: budget ? Number(budget) : undefined,
        approvalId: 0,
      });
      console.log(`Tak ${branch.name} (${branch.slug}) staat klaar, lead: ${branch.leadAgentId ?? "?"}`);
      await ctx.db.close();
      return;
    }
    case "check":
      return checkCommand(config);
    case "status":
    case "report": {
      const { ctx } = await makeContext(config);
      console.log(command === "status" ? await buildStatus(ctx) : await buildDailyReport(ctx));
      await ctx.db.close();
      return;
    }
    case "halt":
    case "resume": {
      const { ctx } = await makeContext(config);
      const res = command === "halt" ? await halt(ctx, args.join(" ") || "via CLI", "owner") : await resume(ctx, "owner");
      console.log(JSON.stringify(res, null, 2));
      await ctx.db.close();
      return;
    }
    case "kennis": {
      const { ctx } = await makeContext(config);
      console.log(await rebuildKnowledge(ctx));
      await ctx.db.close();
      return;
    }
    case "import-csv": {
      const [file] = args;
      if (!file) die("Gebruik: hq import-csv <bestand.csv>");
      const { ctx } = await makeContext(config);
      const res = await importRevenueCsv(ctx, readFileSync(file, "utf8"), "owner");
      console.log(`Geïmporteerd: ${res.imported}${res.errors.length ? `\nFouten:\n- ${res.errors.join("\n- ")}` : ""}`);
      await ctx.db.close();
      return;
    }
    default:
      console.log(USAGE);
      die(`Onbekend commando '${command}'.`);
  }
}

main(process.argv.slice(2)).catch((err) => die(errorMessage(err)));
