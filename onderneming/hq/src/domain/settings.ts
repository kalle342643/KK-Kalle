import type { Db } from "../db/index.js";

export async function getSetting<T>(db: Db, key: string): Promise<T | undefined> {
  const rows = await db.query<{ value: T }>("select value from settings where key = $1", [key]);
  return rows[0]?.value;
}

export async function setSetting(db: Db, key: string, value: unknown): Promise<void> {
  await db.query(
    `insert into settings (key, value, updated_at) values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

/** Voorkomt dubbele meldingen: geeft true als `key` nog niet eerder gemeld was. */
export async function markNotified(db: Db, key: string): Promise<boolean> {
  const rows = await db.query<{ key: string }>(
    "insert into notifications_sent (key) values ($1) on conflict (key) do nothing returning key",
    [key],
  );
  return rows.length > 0;
}
