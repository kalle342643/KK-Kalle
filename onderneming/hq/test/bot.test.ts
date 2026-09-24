import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HqBot, runPolling, type BotTransport } from "../src/bot/bot.js";
import { getApproval } from "../src/domain/approvals.js";
import { getExperiment, proposalSchema, proposeExperiment, snapshot } from "../src/domain/experiments.js";
import { haltState } from "../src/domain/killswitch.js";
import { totals } from "../src/domain/ledger.js";
import { getSetting } from "../src/domain/settings.js";
import type { OutgoingMessage } from "../src/notify/notifier.js";
import { TelegramApi, type TgMessage, type TgUpdate } from "../src/notify/telegram.js";
import { WhatsAppNotifier } from "../src/notify/whatsapp.js";
import { createTestEnv, validProposal, type TestEnv } from "./helpers/context.js";

const OWNER = 4242;

class RecordingTransport implements BotTransport {
  sent: Array<{ chatId: string | number; message: OutgoingMessage }> = [];
  edits: Array<{ messageId: number; message: OutgoingMessage }> = [];
  answers: string[] = [];
  async sendMessage(chatId: string | number, message: OutgoingMessage): Promise<TgMessage> {
    this.sent.push({ chatId, message });
    return { message_id: this.sent.length, chat: { id: Number(chatId), type: "private" } };
  }
  async editMessage(_chatId: string | number, messageId: number, message: OutgoingMessage) {
    this.edits.push({ messageId, message });
  }
  async answerCallback(_id: string, text: string) {
    this.answers.push(text);
  }
  lastText(): string {
    return this.sent.at(-1)?.message.text ?? "";
  }
}

let env: TestEnv;
let transport: RecordingTransport;
let bot: HqBot;
let updateId = 0;

const say = (text: string, chatId = OWNER): TgUpdate => ({
  update_id: ++updateId,
  message: { message_id: updateId, chat: { id: chatId, type: "private" }, text },
});

beforeEach(async () => {
  env = await createTestEnv();
  transport = new RecordingTransport();
  bot = new HqBot(env.ctx, transport, String(OWNER));
});
afterEach(async () => {
  await env.close();
});

describe("Telegram-bot", () => {
  it("negeert onbekende chats volledig", async () => {
    await bot.handle(say("/stop", 999));
    expect(transport.sent).toEqual([]);
    expect((await haltState(env.ctx)).halted).toBe(false);
  });

  it("vertelt in installatiemodus alleen je chat-id", async () => {
    const setupBot = new HqBot(env.ctx, transport, undefined);
    await setupBot.handle(say("/start", 1234));
    expect(transport.lastText()).toContain("TELEGRAM_OWNER_CHAT_ID=1234");
  });

  it("/stop en /hervat bedienen de kill switch", async () => {
    await bot.handle(say("/stop agent doet raar"));
    expect(transport.lastText()).toContain("Noodstop actief");
    expect(await haltState(env.ctx)).toMatchObject({ halted: true, reason: "agent doet raar" });
    await bot.handle(say("/status"));
    expect(transport.lastText()).toContain("NOODSTOP");
    await bot.handle(say("/hervat"));
    expect(transport.lastText()).toContain("Alles draait weer");
    expect((await haltState(env.ctx)).halted).toBe(false);
  });

  it("een knopdruk keurt goed en werkt het bericht bij", async () => {
    const { experiment, approval } = await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), `agent:${env.scout.id}`);
    await bot.handle({
      update_id: ++updateId,
      callback_query: {
        id: "cb1",
        from: { id: OWNER },
        data: `ap:${approval.id}:y`,
        message: { message_id: 77, chat: { id: OWNER, type: "private" }, text: "oud" },
      },
    });
    expect(transport.answers).toEqual(["✅ Goedgekeurd"]);
    expect(transport.edits[0]?.messageId).toBe(77);
    expect(transport.edits[0]?.message.text).toContain("✅ Goedgekeurd");
    expect(transport.edits[0]?.message.buttons).toBeUndefined();
    expect((await getExperiment(env.db, experiment.id))!.status).toBe("running");

    // Nog een keer drukken: nette melding, geen dubbele actie.
    await bot.handle({
      update_id: ++updateId,
      callback_query: { id: "cb2", from: { id: OWNER }, data: `ap:${approval.id}:n`, message: { message_id: 77, chat: { id: OWNER, type: "private" } } },
    });
    expect(transport.answers[1]).toContain("al goedgekeurd");
    expect((await getApproval(env.db, approval.id))!.status).toBe("approved");
  });

  it("knoppen van een vreemde chat doen niets", async () => {
    const { approval } = await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), `agent:${env.scout.id}`);
    await bot.handle({
      update_id: ++updateId,
      callback_query: { id: "cb", from: { id: 1 }, data: `ap:${approval.id}:y`, message: { message_id: 1, chat: { id: 1, type: "private" } } },
    });
    expect(transport.answers).toEqual(["Geen toegang."]);
    expect((await getApproval(env.db, approval.id))!.status).toBe("pending");
  });

  it("/goedkeuringen stuurt elk open verzoek met knoppen", async () => {
    await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), `agent:${env.scout.id}`);
    await bot.handle(say("/goedkeuringen"));
    expect(transport.sent.at(-1)!.message.buttons?.[0]?.length).toBe(2);
  });

  it("/omzet en /meting leggen betrouwbare cijfers vast", async () => {
    await bot.handle(say("/omzet 12,50 games CrazyGames september"));
    expect(transport.lastText()).toContain("geboekt op Games");
    expect((await totals(env.db, { branchId: env.games.id })).revenue).toBe(12.5);

    const { experiment, approval } = await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), `agent:${env.scout.id}`);
    await bot.handle({
      update_id: ++updateId,
      callback_query: { id: "c", from: { id: OWNER }, data: `ap:${approval.id}:y`, message: { message_id: 5, chat: { id: OWNER, type: "private" } } },
    });
    await bot.handle(say(`/meting EXP-${experiment.id} plays 740`));
    const s = await snapshot(env.ctx, (await getExperiment(env.db, experiment.id))!);
    expect(s.trustedValue).toBe(740);

    await bot.handle(say("/omzet veel"));
    expect(transport.lastText()).toContain("Gebruik: /omzet");
    await bot.handle(say("/omzet 5 bestaat-niet"));
    expect(transport.lastText()).toContain("Onbekende tak");
  });

  it("/agents, /budget, /experimenten en /rapport antwoorden", async () => {
    for (const cmd of ["/agents", "/budget", "/experimenten", "/rapport", "/help"]) {
      await bot.handle(say(cmd));
    }
    const texts = transport.sent.map((s) => s.message.text);
    expect(texts[0]).toContain("Vega");
    expect(texts[1]).toContain("Budget per tak");
    expect(texts[2]).toContain("Geen lopende");
    expect(texts[3]).toContain("Dagrapport");
    expect(texts[4]).toContain("/stop");
  });

  it("polling onthoudt waar hij was", async () => {
    const updates = [say("/status"), say("/help")];
    let calls = 0;
    const controller = new AbortController();
    const api = {
      async getUpdates(offset: number) {
        calls += 1;
        if (calls > 1) {
          controller.abort();
          return [];
        }
        expect(offset).toBe(0);
        return updates;
      },
    };
    await runPolling(env.ctx, api, bot, controller.signal);
    expect(await getSetting(env.db, "telegram_offset")).toBe(updates[1]!.update_id + 1);
    expect(transport.sent.length).toBe(2);
  });
});

describe("kanalen", () => {
  it("TelegramApi stuurt knoppen als inline keyboard en kort lange teksten in", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const api = new TelegramApi("TOKEN", async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 9, chat: { id: 1, type: "private" } } }));
    });
    await api.sendMessage(1, { text: "x".repeat(5000), buttons: [[{ label: "Ja", data: "ap:1:y" }]] });
    expect(calls[0]!.url).toBe("https://api.telegram.org/botTOKEN/sendMessage");
    expect(String(calls[0]!.body.text).length).toBeLessThanOrEqual(4000);
    expect(calls[0]!.body.reply_markup).toEqual({ inline_keyboard: [[{ text: "Ja", callback_data: "ap:1:y" }]] });
  });

  it("WhatsApp gebruikt een sjabloon en verwijst voor knoppen naar Telegram", async () => {
    let sent: Record<string, unknown> = {};
    const wa = new WhatsAppNotifier(
      { token: "t", phoneNumberId: "123", to: "31600000000", template: "hq_update", templateLang: "nl", apiVersion: "v23.0" },
      async (url, init) => {
        expect(url).toBe("https://graph.facebook.com/v23.0/123/messages");
        sent = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }));
      },
    );
    const res = await wa.send({ text: "Experiment X heeft €42 opgeleverd\nregel 2", buttons: [[{ label: "Ja", data: "ap:1:y" }]] });
    expect(res[0]).toEqual({ channel: "whatsapp", messageId: "wamid.1" });
    const param = ((sent.template as { components: Array<{ parameters: Array<{ text: string }> }> }).components[0]!.parameters[0]!).text;
    expect(param).toContain("€42 opgeleverd · regel 2");
    expect(param).toContain("Beslis in Telegram");
  });
});
