import type { Button, Notifier, OutgoingMessage, SentMessage } from "./notifier.js";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
}

export interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  data?: string;
  message?: TgMessage;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

/** Telegram limiteert berichten op 4096 tekens. */
export const TELEGRAM_MAX = 4000;

export function clip(text: string, max = TELEGRAM_MAX): string {
  return text.length <= max ? text : `${text.slice(0, max - 20)}\n… (ingekort)`;
}

function keyboard(buttons?: Button[][]) {
  if (!buttons?.length) return undefined;
  return { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.label, callback_data: b.data.slice(0, 64) }))) };
}

/** Dunne wrapper om de Telegram Bot API (alleen wat HQ nodig heeft). */
export class TelegramApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl = "https://api.telegram.org",
  ) {}

  async call<T>(method: string, body: Record<string, unknown>, timeoutMs = 20_000): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
    if (!res.ok || !json.ok) throw new Error(`Telegram ${method}: ${json.description ?? res.statusText}`);
    return json.result as T;
  }

  getUpdates(offset: number, timeoutSec = 50): Promise<TgUpdate[]> {
    return this.call<TgUpdate[]>(
      "getUpdates",
      { offset, timeout: timeoutSec, allowed_updates: ["message", "callback_query"] },
      (timeoutSec + 10) * 1000,
    );
  }

  sendMessage(chatId: string | number, message: OutgoingMessage): Promise<TgMessage> {
    return this.call<TgMessage>("sendMessage", {
      chat_id: chatId,
      text: clip(message.text),
      reply_markup: keyboard(message.buttons),
      disable_notification: message.silent ?? false,
      link_preview_options: { is_disabled: true },
    });
  }

  async editMessage(chatId: string | number, messageId: number, message: OutgoingMessage): Promise<void> {
    await this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: clip(message.text),
      reply_markup: keyboard(message.buttons) ?? { inline_keyboard: [] },
      link_preview_options: { is_disabled: true },
    });
  }

  async answerCallback(callbackId: string, text: string): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: callbackId, text: clip(text, 190) });
  }

  async setCommands(commands: Array<{ command: string; description: string }>): Promise<void> {
    await this.call("setMyCommands", { commands });
  }
}

/** Stuurt HQ-meldingen naar de chat van de eigenaar. */
export class TelegramNotifier implements Notifier {
  constructor(
    private readonly api: TelegramApi,
    private readonly ownerChatId: string,
  ) {}

  async send(message: OutgoingMessage): Promise<SentMessage[]> {
    const sent = await this.api.sendMessage(this.ownerChatId, message);
    return [{ channel: "telegram", messageId: String(sent.message_id) }];
  }

  async edit(_channel: string, messageId: string, message: OutgoingMessage): Promise<void> {
    await this.api.editMessage(this.ownerChatId, Number(messageId), message);
  }
}
