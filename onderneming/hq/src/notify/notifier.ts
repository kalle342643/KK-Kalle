/** Een knop onder een bericht (Telegram inline keyboard). `data` gaat terug naar de bot. */
export interface Button {
  label: string;
  data: string;
}

export interface OutgoingMessage {
  text: string;
  /** Rijen met knoppen. */
  buttons?: Button[][];
  /** Stille melding (geen geluid) voor minder belangrijke updates. */
  silent?: boolean;
}

export interface SentMessage {
  channel: string;
  messageId: string | null;
}

/** Kanaal naar de eigenaar: Telegram, WhatsApp, of in tests een recorder. */
export interface Notifier {
  send(message: OutgoingMessage): Promise<SentMessage[]>;
  /** Werkt een eerder bericht bij (bv. "goedgekeurd" na een knopdruk). Optioneel per kanaal. */
  edit?(channel: string, messageId: string, message: OutgoingMessage): Promise<void>;
}

/** Stuurt naar alle kanalen; een falend kanaal blokkeert de rest niet. */
export class MultiNotifier implements Notifier {
  constructor(
    private readonly channels: Array<{ name: string; notifier: Notifier }>,
    private readonly onError: (channel: string, err: unknown) => void = () => {},
  ) {}

  async send(message: OutgoingMessage): Promise<SentMessage[]> {
    const results: SentMessage[] = [];
    for (const { name, notifier } of this.channels) {
      try {
        results.push(...(await notifier.send(message)));
      } catch (err) {
        this.onError(name, err);
      }
    }
    return results;
  }

  async edit(channel: string, messageId: string, message: OutgoingMessage): Promise<void> {
    const target = this.channels.find((c) => c.name === channel);
    if (target?.notifier.edit) await target.notifier.edit(channel, messageId, message);
  }
}

/** Schrijft naar stdout; handig lokaal en als er (nog) geen Telegram is ingesteld. */
export class ConsoleNotifier implements Notifier {
  async send(message: OutgoingMessage): Promise<SentMessage[]> {
    const buttons = message.buttons?.flat().map((b) => `[${b.label}]`).join(" ") ?? "";
    console.log(`\n📣 ${message.text}${buttons ? `\n${buttons}` : ""}\n`);
    return [{ channel: "console", messageId: null }];
  }
}

/** Voor tests: onthoudt alles wat verstuurd is. */
export class RecordingNotifier implements Notifier {
  sent: OutgoingMessage[] = [];
  edits: Array<{ messageId: string; message: OutgoingMessage }> = [];
  private counter = 0;

  async send(message: OutgoingMessage): Promise<SentMessage[]> {
    this.sent.push(message);
    this.counter += 1;
    return [{ channel: "telegram", messageId: String(this.counter) }];
  }

  async edit(_channel: string, messageId: string, message: OutgoingMessage): Promise<void> {
    this.edits.push({ messageId, message });
  }

  last(): OutgoingMessage | undefined {
    return this.sent.at(-1);
  }

  texts(): string[] {
    return this.sent.map((m) => m.text);
  }
}
