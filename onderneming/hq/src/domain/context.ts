import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import type { Notifier } from "../notify/notifier.js";
import type { OfficeEvents } from "../office/events.js";
import type { PaperclipApi } from "../paperclip/client.js";

export interface Logger {
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

/** Alles wat de domeinlogica nodig heeft. Eén instantie per proces. */
export interface AppContext {
  db: Db;
  config: Config;
  paperclip: PaperclipApi;
  notifier: Notifier;
  /** Het Paperclip-bedrijf (de holding) waar alle agents onder vallen. */
  companyId: string;
  /** Wat er in het kantoor gebeurt (voor de live weergave). */
  events: OfficeEvents;
  now(): Date;
  log: Logger;
}

export const consoleLogger: Logger = {
  info: (msg, extra) => console.log(JSON.stringify({ level: "info", msg, ...extra, at: new Date().toISOString() })),
  warn: (msg, extra) => console.warn(JSON.stringify({ level: "warn", msg, ...extra, at: new Date().toISOString() })),
  error: (msg, extra) => console.error(JSON.stringify({ level: "error", msg, ...extra, at: new Date().toISOString() })),
};

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/** Actor-namen zoals ze in de audit-log staan. */
export type Actor = "owner" | "system" | `agent:${string}` | `job:${string}`;

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
