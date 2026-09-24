import type { Notifier, OutgoingMessage, SentMessage } from "./notifier.js";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  to: string;
  /** Goedgekeurd Meta-sjabloon met één variabele ({{1}}) voor de tekst. Nodig buiten het 24-uursvenster. */
  template: string | undefined;
  templateLang: string;
  apiVersion: string;
}

/**
 * Optionele eenrichtings-meldingen via de WhatsApp Cloud API (Meta).
 * Beslissen (knoppen) gaat via Telegram of het dashboard: interactieve WhatsApp-knoppen werken alleen
 * binnen 24 uur na jouw laatste bericht, dus daar bouwen we niet op.
 * Let op: Meta rekent per sjabloonbericht en vereist een geverifieerd Business-account.
 */
export class WhatsAppNotifier implements Notifier {
  constructor(
    private readonly cfg: WhatsAppConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async send(message: OutgoingMessage): Promise<SentMessage[]> {
    // Knoppen bestaan hier niet; verwijs naar het beslis-kanaal.
    const text = message.buttons?.length ? `${message.text}\n\n👉 Beslis in Telegram of het HQ-dashboard.` : message.text;
    const body = this.cfg.template
      ? {
          messaging_product: "whatsapp",
          to: this.cfg.to,
          type: "template",
          template: {
            name: this.cfg.template,
            language: { code: this.cfg.templateLang },
            // Sjabloonvariabelen mogen geen regeleinden bevatten en zijn beperkt in lengte.
            components: [{ type: "body", parameters: [{ type: "text", text: text.replace(/\s*\n+\s*/g, " · ").slice(0, 1000) }] }],
          },
        }
      : { messaging_product: "whatsapp", to: this.cfg.to, type: "text", text: { body: text.slice(0, 4000), preview_url: false } };
    const res = await this.fetchImpl(
      `https://graph.facebook.com/${this.cfg.apiVersion}/${this.cfg.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${this.cfg.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      },
    );
    const json = (await res.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message?: string } };
    if (!res.ok) throw new Error(`WhatsApp: ${json.error?.message ?? res.statusText}`);
    return [{ channel: "whatsapp", messageId: json.messages?.[0]?.id ?? null }];
  }
}
