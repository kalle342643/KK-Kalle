import { approvalButtons, formatApproval, getApproval, listApprovals } from "../domain/approvals.js";
import { audit } from "../domain/audit.js";
import { DomainError, requireBranch } from "../domain/branches.js";
import { errorMessage, type AppContext } from "../domain/context.js";
import { experimentCode, listExperiments, recordMetric, snapshot } from "../domain/experiments.js";
import { halt, haltState, resume } from "../domain/killswitch.js";
import { recordLedger } from "../domain/ledger.js";
import { formatEur, formatPct, usdCentsToEur } from "../domain/money.js";
import { computePortfolio, formatPortfolio } from "../domain/portfolio.js";
import { buildDailyReport, buildStatus } from "../domain/report.js";
import { getSetting, setSetting } from "../domain/settings.js";
import { addLocalDays, startOfLocalDay } from "../domain/time.js";
import { decide } from "../domain/workflows.js";
import type { OutgoingMessage } from "../notify/notifier.js";
import type { TgCallbackQuery, TgMessage, TgUpdate } from "../notify/telegram.js";

/** Wat de bot nodig heeft van Telegram (in tests vervangen door een recorder). */
export interface BotTransport {
  sendMessage(chatId: string | number, message: OutgoingMessage): Promise<TgMessage>;
  editMessage(chatId: string | number, messageId: number, message: OutgoingMessage): Promise<void>;
  answerCallback(callbackId: string, text: string): Promise<void>;
}

export const COMMANDS: Array<{ command: string; description: string }> = [
  { command: "status", description: "Hoe staat alles ervoor?" },
  { command: "rapport", description: "Het dagrapport nu" },
  { command: "goedkeuringen", description: "Alles wat op jou wacht" },
  { command: "experimenten", description: "Lopende experimenten" },
  { command: "agents", description: "Agents en hun kosten vandaag" },
  { command: "budget", description: "Budget per tak (portfolio)" },
  { command: "omzet", description: "Omzet boeken: /omzet 12,50 games CrazyGames sept" },
  { command: "meting", description: "Meting invoeren: /meting EXP-3 plays 740" },
  { command: "stop", description: "NOODSTOP: alle agents direct stil" },
  { command: "hervat", description: "Na een noodstop alles weer aan" },
  { command: "help", description: "Uitleg" },
];

const HELP = [
  "🏢 HQ-bot",
  "",
  "/status – hoe staat alles ervoor",
  "/rapport – dagrapport nu",
  "/goedkeuringen – wat op jou wacht (met knoppen)",
  "/experimenten – lopende experimenten",
  "/agents – agents en kosten vandaag",
  "/budget – budget per tak",
  "/omzet 12,50 games [omschrijving] – omzet boeken (bv. uit het CrazyGames-dashboard)",
  "/meting EXP-3 plays 740 – betrouwbare meting invoeren",
  "/stop [reden] – NOODSTOP, alle agents direct stil",
  "/hervat – alles weer aan",
].join("\n");

export class HqBot {
  constructor(
    private readonly ctx: AppContext,
    private readonly transport: BotTransport,
    /** Undefined = installatiemodus: de bot vertelt alleen je chat-id. */
    private readonly ownerChatId: string | undefined,
  ) {}

  async handle(update: TgUpdate): Promise<void> {
    try {
      if (update.callback_query) await this.onCallback(update.callback_query);
      else if (update.message?.text) await this.onMessage(update.message);
    } catch (err) {
      this.ctx.log.error("bot-update mislukt", { error: errorMessage(err) });
    }
  }

  private isOwner(chatId: number): boolean {
    return this.ownerChatId !== undefined && String(chatId) === String(this.ownerChatId);
  }

  private async reply(chatId: number, message: OutgoingMessage | string): Promise<void> {
    await this.transport.sendMessage(chatId, typeof message === "string" ? { text: message } : message);
  }

  private async onMessage(msg: TgMessage): Promise<void> {
    const chatId = msg.chat.id;
    if (!this.ownerChatId) {
      // Installatiemodus: help de eigenaar zijn chat-id te vinden, verder niets.
      await this.reply(chatId, `Je chat-id is ${chatId}.\nZet TELEGRAM_OWNER_CHAT_ID=${chatId} in de HQ-config en herstart HQ.`);
      return;
    }
    if (!this.isOwner(chatId)) {
      this.ctx.log.warn("bericht van onbekende chat genegeerd", { chatId });
      return;
    }
    const [rawCommand = "", ...args] = msg.text!.trim().split(/\s+/);
    const command = rawCommand.toLowerCase().replace(/@.*$/, "");
    try {
      await this.runCommand(chatId, command, args);
    } catch (err) {
      await this.reply(chatId, `⚠️ ${err instanceof DomainError ? err.message : errorMessage(err)}`);
    }
  }

  private async runCommand(chatId: number, command: string, args: string[]): Promise<void> {
    const ctx = this.ctx;
    switch (command) {
      case "/start":
      case "/help":
        return this.reply(chatId, HELP);
      case "/status":
        return this.reply(chatId, await buildStatus(ctx));
      case "/rapport":
        return this.reply(chatId, await buildDailyReport(ctx));
      case "/stop":
      case "/noodstop": {
        const reason = args.join(" ") || "noodstop via Telegram";
        const res = await halt(ctx, reason, "owner");
        return this.reply(
          chatId,
          [
            "⛔ Noodstop actief.",
            `${res.pausedAgents} agent(s) gepauzeerd, ${res.cancelledRuns} run(s) afgebroken.`,
            res.errors.length ? `Let op: ${res.errors.join("; ")}` : "",
            "Stuur /hervat om alles weer aan te zetten.",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
      case "/hervat":
      case "/resume": {
        if (!(await haltState(ctx)).halted) return this.reply(chatId, "Er is geen noodstop actief.");
        const res = await resume(ctx, "owner");
        return this.reply(
          chatId,
          `▶️ Alles draait weer. ${res.resumedAgents} agent(s) hervat.${res.errors.length ? `\nLet op: ${res.errors.join("; ")}` : ""}`,
        );
      }
      case "/goedkeuringen": {
        const pending = await listApprovals(ctx.db, { status: ["pending"], limit: 10 });
        if (!pending.length) return this.reply(chatId, "Niets te beslissen. 🎉");
        for (const a of pending.reverse()) {
          await this.reply(chatId, { text: await formatApproval(ctx, a), buttons: approvalButtons(a) });
        }
        return;
      }
      case "/experimenten": {
        const running = await listExperiments(ctx.db, { status: ["running"] });
        if (!running.length) return this.reply(chatId, "Geen lopende experimenten.");
        const lines = ["🧪 Lopend:"];
        for (const e of running) {
          const s = await snapshot(ctx, e);
          const value = s.trustedValue ?? s.untrustedValue ?? 0;
          lines.push(
            `${experimentCode(e.id)} ${e.title}\n  ${e.metricName} ${value}/${e.metricTarget}${s.trustedValue === null && s.untrustedValue !== null ? " (agent)" : ""} · budget ${formatPct(s.budgetUsedPct)} · nog ${s.daysLeft ?? "?"} d`,
          );
        }
        return this.reply(chatId, lines.join("\n"));
      }
      case "/agents": {
        const tz = ctx.config.timezone;
        const from = startOfLocalDay(ctx.now(), tz);
        const [agents, costs] = await Promise.all([
          ctx.paperclip.listAgents(ctx.companyId),
          ctx.paperclip.costsByAgent(ctx.companyId, { from: from.toISOString(), to: addLocalDays(from, 1, tz).toISOString() }),
        ]);
        const cost = new Map(costs.map((c) => [c.agentId, usdCentsToEur(c.costCents, ctx.config.money.usdToEur)]));
        const icon: Record<string, string> = { running: "🟢", idle: "⚪", active: "⚪", paused: "⏸", error: "🔴", pending_approval: "⏳" };
        const lines = agents
          .filter((a) => a.status !== "terminated")
          .map((a) => `${icon[a.status] ?? "•"} ${a.name}${a.title ? ` (${a.title})` : ""} · vandaag ${formatEur(cost.get(a.id) ?? 0)}`);
        return this.reply(chatId, lines.length ? lines.join("\n") : "Nog geen agents.");
      }
      case "/budget":
        return this.reply(chatId, `📊 Budget per tak\n${formatPortfolio(await computePortfolio(ctx))}`);
      case "/omzet": {
        const [amountRaw, branchSlug, ...rest] = args;
        const amount = Number((amountRaw ?? "").replace(",", "."));
        if (!Number.isFinite(amount) || amount <= 0 || !branchSlug) {
          return this.reply(chatId, "Gebruik: /omzet 12,50 games [omschrijving]");
        }
        const branch = await requireBranch(ctx.db, branchSlug);
        await recordLedger(ctx.db, {
          kind: "revenue",
          amountEur: amount,
          source: "owner",
          externalId: `telegram:${Date.now()}`,
          occurredAt: ctx.now(),
          branchId: branch.id,
          description: rest.join(" ") || "Handmatig via Telegram",
        });
        await audit(ctx.db, "owner", "revenue.add", { amountEur: amount, branch: branch.slug, via: "telegram" });
        return this.reply(chatId, `💶 ${formatEur(amount)} omzet geboekt op ${branch.name}.`);
      }
      case "/meting": {
        const [expRaw, name, valueRaw] = args;
        const id = Number((expRaw ?? "").replace(/^EXP-/i, ""));
        const value = Number((valueRaw ?? "").replace(",", "."));
        if (!Number.isInteger(id) || !name || !Number.isFinite(value)) {
          return this.reply(chatId, "Gebruik: /meting EXP-3 plays 740");
        }
        await recordMetric(ctx, id, { name, value, source: "owner", trusted: true, note: "via Telegram" }, "owner");
        return this.reply(chatId, `📏 Meting opgeslagen: ${experimentCode(id)} ${name} = ${value} (betrouwbaar).`);
      }
      default:
        return this.reply(chatId, `Onbekend commando. ${HELP}`);
    }
  }

  private async onCallback(q: TgCallbackQuery): Promise<void> {
    const chatId = q.message?.chat.id;
    if (chatId === undefined || !this.isOwner(chatId)) {
      await this.transport.answerCallback(q.id, "Geen toegang.");
      return;
    }
    const m = q.data?.match(/^ap:(\d+):([yn])$/);
    if (!m) {
      await this.transport.answerCallback(q.id, "Onbekende knop.");
      return;
    }
    const id = Number(m[1]);
    const decision = m[2] === "y" ? "approve" : "reject";
    let text: string;
    try {
      const record = await decide(this.ctx, id, decision, null, "owner");
      const label = record.kind === "budget_override" ? (decision === "approve" ? "✅ Verhoogd en hervat" : "⏸ Blijft gepauzeerd") : decision === "approve" ? "✅ Goedgekeurd" : "❌ Afgewezen";
      text = record.applyError ? `${label}, maar uitvoeren mislukte: ${record.applyError}` : label;
    } catch (err) {
      text = `⚠️ ${err instanceof DomainError ? err.message : errorMessage(err)}`;
    }
    await this.transport.answerCallback(q.id, text);
    if (q.message) {
      const record = await getApproval(this.ctx.db, id);
      const base = record ? await formatApproval(this.ctx, record) : q.message.text ?? "";
      await this.transport.editMessage(chatId, q.message.message_id, { text: `${base}\n\n${text}` });
    }
  }
}

const OFFSET_KEY = "telegram_offset";

/**
 * Long polling: HQ haalt zelf berichten op bij Telegram. Daardoor hoeft je server niet vanaf internet
 * bereikbaar te zijn (geen webhook, geen open poort).
 */
export async function runPolling(
  ctx: AppContext,
  api: { getUpdates(offset: number, timeoutSec?: number): Promise<TgUpdate[]> },
  bot: HqBot,
  signal: AbortSignal,
): Promise<void> {
  let offset = (await getSetting<number>(ctx.db, OFFSET_KEY)) ?? 0;
  let backoff = 1000;
  while (!signal.aborted) {
    try {
      const updates = await api.getUpdates(offset);
      for (const u of updates) {
        await bot.handle(u);
        offset = u.update_id + 1;
        await setSetting(ctx.db, OFFSET_KEY, offset);
      }
      backoff = 1000;
    } catch (err) {
      if (signal.aborted) break;
      ctx.log.warn("telegram polling fout", { error: errorMessage(err) });
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 60_000);
    }
  }
}
