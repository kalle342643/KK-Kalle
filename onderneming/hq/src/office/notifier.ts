import type { Notifier, OutgoingMessage, SentMessage } from "../notify/notifier.js";
import type { OfficeEvents } from "./events.js";
import { BOT_ID } from "./profiles.js";

/**
 * Stuurt berichten door naar de echte kanalen (Telegram, WhatsApp) en laat in het kantoor zien
 * dat de HQ-bot jou iets stuurde.
 */
export class OfficeNotifier implements Notifier {
  constructor(
    private readonly inner: Notifier,
    private readonly events: OfficeEvents,
  ) {}

  async send(message: OutgoingMessage): Promise<SentMessage[]> {
    const sent = await this.inner.send(message);
    await this.events.emit({
      type: "message.sent",
      agentId: BOT_ID,
      text: message.text,
      data: { buttons: Boolean(message.buttons?.length), silent: Boolean(message.silent), channels: sent.map((s) => s.channel) },
    });
    return sent;
  }

  edit(channel: string, messageId: string, message: OutgoingMessage): Promise<void> {
    return this.inner.edit ? this.inner.edit(channel, messageId, message) : Promise.resolve();
  }
}
