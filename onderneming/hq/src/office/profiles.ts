import { z } from "zod";
import type { Db } from "../db/index.js";
import { audit } from "../domain/audit.js";
import { DomainError } from "../domain/branches.js";
import type { AppContext } from "../domain/context.js";
import type { OfficePerson } from "./types.js";

/** Jij en de HQ-bot hebben vaste ids; ze staan niet in Paperclip. */
export const OWNER_ID = "owner";
export const BOT_ID = "hq-bot";
export const AVATAR_COUNT = 12;

export interface AgentProfile {
  agentId: string;
  nickname: string | null;
  avatar: number | null;
}

export const profileSchema = z.object({
  nickname: z.string().trim().max(30).nullable().optional(),
  avatar: z.number().int().min(0).max(AVATAR_COUNT - 1).nullable().optional(),
});

export async function listProfiles(db: Db): Promise<Map<string, AgentProfile>> {
  const rows = await db.query<{ agent_id: string; nickname: string | null; avatar: number | null }>(
    "select agent_id, nickname, avatar from agent_profiles",
  );
  return new Map(rows.map((r) => [r.agent_id, { agentId: r.agent_id, nickname: r.nickname, avatar: r.avatar }]));
}

/** Bijnaam en/of uiterlijk van een agent (of van jou of de bot). Leeg maken kan met null. */
export async function setProfile(
  ctx: AppContext,
  agentId: string,
  input: z.infer<typeof profileSchema>,
): Promise<AgentProfile> {
  if (agentId !== OWNER_ID && agentId !== BOT_ID) {
    const agent = await ctx.paperclip.getAgent(agentId).catch(() => null);
    if (!agent || agent.companyId !== ctx.companyId) throw new DomainError("Onbekende agent.", 404);
  }
  const current = (await listProfiles(ctx.db)).get(agentId);
  const nickname = input.nickname === undefined ? (current?.nickname ?? null) : input.nickname || null;
  const avatar = input.avatar === undefined ? (current?.avatar ?? null) : input.avatar;
  await ctx.db.query(
    `insert into agent_profiles (agent_id, nickname, avatar, updated_at) values ($1, $2, $3, now())
     on conflict (agent_id) do update set nickname = excluded.nickname, avatar = excluded.avatar, updated_at = now()`,
    [agentId, nickname, avatar],
  );
  await audit(ctx.db, "owner", "agent.profile", { agentId, nickname, avatar });
  const nicknameChanged = nickname !== (current?.nickname ?? null);
  await ctx.events.emit({
    type: "agent.profile",
    agentId,
    text: nicknameChanged ? (nickname ? `Heet nu ${nickname}` : "Bijnaam weggehaald") : "Nieuw uiterlijk",
    data: { nickname, avatar, changed: nicknameChanged ? "nickname" : "avatar" },
  });
  return { agentId, nickname, avatar };
}

/** Naam zoals jij hem kent: "Fluxie (Vega)" als je een bijnaam gaf, anders gewoon "Vega". */
export function labelFor(name: string, profile: AgentProfile | undefined): string {
  return profile?.nickname && profile.nickname !== name ? `${profile.nickname} (${name})` : name;
}

export async function people(db: Db, ownerName = "Jij"): Promise<OfficePerson[]> {
  const profiles = await listProfiles(db);
  return [
    { id: OWNER_ID, name: ownerName, nickname: profiles.get(OWNER_ID)?.nickname ?? null, avatar: profiles.get(OWNER_ID)?.avatar ?? null },
    { id: BOT_ID, name: "HQ-bot", nickname: profiles.get(BOT_ID)?.nickname ?? null, avatar: profiles.get(BOT_ID)?.avatar ?? null },
  ];
}
