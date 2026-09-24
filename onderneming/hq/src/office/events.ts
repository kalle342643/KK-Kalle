import type { Db } from "../db/index.js";
import type { Logger } from "../domain/context.js";
import type { OfficeEvent, OfficeEventType } from "./types.js";

export type { OfficeEvent, OfficeEventType } from "./types.js";

/**
 * Gebeurtenissen die het kantoor laat zien. Elke gebeurtenis is iets wat echt gebeurde:
 * een agent die aan een taak begint, iets tegen een collega zegt, iets opzoekt of jou iets vraagt.
 */
export interface OfficeEventInput {
  type: OfficeEventType;
  agentId?: string | null;
  targetAgentId?: string | null;
  text?: string | null;
  data?: Record<string, unknown>;
  /** Unieke sleutel van de bron (bv. een Paperclip-activiteit); dezelfde sleutel wordt maar één keer opgeslagen. */
  sourceKey?: string;
  at?: Date;
}

interface EventRow {
  id: number | string;
  at: string | Date;
  type: OfficeEventType;
  agent_id: string | null;
  target_agent_id: string | null;
  text: string | null;
  data: Record<string, unknown> | null;
}

const toEvent = (r: EventRow): OfficeEvent => ({
  id: Number(r.id),
  at: new Date(r.at).toISOString(),
  type: r.type,
  agentId: r.agent_id,
  targetAgentId: r.target_agent_id,
  text: r.text,
  data: r.data ?? {},
});

/** Korte, leesbare tekst: geen Markdown, geen regeleinden, maximaal `max` tekens. */
export function shortText(s: string | null | undefined, max = 140): string | null {
  if (!s) return null;
  const plain = s
    .replace(/```[\s\S]*?```/g, " ")
    // Markdown-opmaak weg, maar "PR #7" en NAMEN_MET_LIGSTREEPJES heel laten.
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/[*`]+/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return null;
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/**
 * Slaat kantoorgebeurtenissen op en geeft ze door aan wie meekijkt (het kantoor in de browser).
 * Fouten hier mogen nooit een echte actie laten mislukken: ze worden alleen gelogd.
 */
export class OfficeEvents {
  private readonly listeners = new Set<(e: OfficeEvent) => void>();

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
  ) {}

  async emit(input: OfficeEventInput): Promise<OfficeEvent | null> {
    try {
      const rows = await this.db.query<EventRow>(
        `insert into office_events (at, type, agent_id, target_agent_id, text, data, source_key)
         values (coalesce($1, now()), $2, $3, $4, $5, $6, $7)
         on conflict (source_key) do nothing
         returning id, at, type, agent_id, target_agent_id, text, data`,
        [
          input.at?.toISOString() ?? null,
          input.type,
          input.agentId ?? null,
          input.targetAgentId ?? null,
          shortText(input.text, 280),
          JSON.stringify(input.data ?? {}),
          input.sourceKey ?? null,
        ],
      );
      if (!rows[0]) return null;
      const event = toEvent(rows[0]);
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch (err) {
          this.log.warn("kantoor-luisteraar faalde", { error: String(err) });
        }
      }
      return event;
    } catch (err) {
      this.log.warn("kantoorgebeurtenis opslaan mislukt", { type: input.type, error: String(err) });
      return null;
    }
  }

  subscribe(listener: (e: OfficeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get viewers(): number {
    return this.listeners.size;
  }

  /** Gebeurtenissen na een bepaald id (om een verbroken verbinding bij te werken). */
  async after(id: number, limit = 200): Promise<OfficeEvent[]> {
    const rows = await this.db.query<EventRow>(
      "select * from office_events where id > $1 order by id limit $2",
      [id, limit],
    );
    return rows.map(toEvent);
  }

  /** De laatste gebeurtenissen, oudste eerst. */
  async recent(limit = 40): Promise<OfficeEvent[]> {
    const rows = await this.db.query<EventRow>("select * from office_events order by id desc limit $1", [limit]);
    return rows.map(toEvent).reverse();
  }

  async lastId(): Promise<number> {
    const rows = await this.db.query<{ id: number | string | null }>("select max(id) as id from office_events");
    return Number(rows[0]?.id ?? 0);
  }

  /** Oude gebeurtenissen opruimen. */
  async prune(keepDays = 30): Promise<number> {
    const rows = await this.db.query(
      "delete from office_events where at < now() - make_interval(days => $1) returning id",
      [keepDays],
    );
    return rows.length;
  }
}
