import { createHash } from "node:crypto";
import type { AppContext } from "../domain/context.js";
import { PaperclipError } from "../paperclip/client.js";
import type { PcAgent } from "../paperclip/types.js";

/**
 * Agents loggen bij HQ in met hun eigen Paperclip-token ($PAPERCLIP_API_KEY in een run).
 * HQ vraagt Paperclip wie erachter zit; zo hoeft HQ geen eigen wachtwoorden te beheren.
 */
export class AgentAuthenticator {
  private cache = new Map<string, { agent: PcAgent; expires: number }>();

  constructor(
    private readonly ctx: AppContext,
    private readonly ttlMs = 60_000,
  ) {}

  async authenticate(authorization: string | undefined): Promise<PcAgent | null> {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!token) return null;
    const key = createHash("sha256").update(token).digest("hex");
    const hit = this.cache.get(key);
    const now = Date.now();
    if (hit && hit.expires > now) return hit.agent;
    let agent: PcAgent;
    try {
      agent = await this.ctx.paperclip.whoAmI(token);
    } catch (err) {
      if (err instanceof PaperclipError && (err.status === 401 || err.status === 403)) return null;
      throw err;
    }
    if (agent.companyId !== this.ctx.companyId || agent.status === "terminated") return null;
    this.cache.set(key, { agent, expires: now + this.ttlMs });
    if (this.cache.size > 1000) this.cache.clear();
    return agent;
  }
}
