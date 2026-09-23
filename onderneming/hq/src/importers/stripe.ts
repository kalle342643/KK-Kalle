import { getBranchBySlug, holdingBranch } from "../domain/branches.js";
import type { AppContext } from "../domain/context.js";
import { getExperiment } from "../domain/experiments.js";
import { recordLedger } from "../domain/ledger.js";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface StripeCharge {
  id: string;
  amount: number;
  amount_captured: number;
  amount_refunded: number;
  currency: string;
  paid: boolean;
  status: string;
  created: number;
  description: string | null;
  metadata: Record<string, string>;
}

/**
 * Haalt betalingen uit Stripe (alleen lezen; gebruik een restricted key met leesrechten op Charges).
 * Toewijzing via metadata op de betaling: `branch` (tak-slug) en optioneel `experiment_id`.
 * Terugbetalingen worden verrekend doordat de laatste 7 dagen steeds opnieuw worden bijgewerkt.
 */
export async function importStripe(
  ctx: AppContext,
  cfg: { apiKey: string; defaultBranch: string | undefined },
  fetchImpl: FetchLike = fetch,
  days = 7,
): Promise<{ imported: number; skipped: string[] }> {
  const since = Math.floor(ctx.now().getTime() / 1000) - days * 86_400;
  const fallback = (cfg.defaultBranch ? await getBranchBySlug(ctx.db, cfg.defaultBranch) : undefined) ?? (await holdingBranch(ctx.db));
  const skipped: string[] = [];
  let imported = 0;
  let startingAfter: string | undefined;
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ limit: "100", "created[gte]": String(since) });
    if (startingAfter) params.set("starting_after", startingAfter);
    const res = await fetchImpl(`https://api.stripe.com/v1/charges?${params}`, {
      headers: { authorization: `Bearer ${cfg.apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json()) as { data?: StripeCharge[]; has_more?: boolean; error?: { message?: string } };
    if (!res.ok) throw new Error(`Stripe: ${json.error?.message ?? res.statusText}`);
    for (const ch of json.data ?? []) {
      if (!ch.paid || ch.status !== "succeeded") continue;
      if (ch.currency.toLowerCase() !== "eur") {
        skipped.push(`${ch.id}: valuta ${ch.currency} wordt (nog) niet omgerekend`);
        continue;
      }
      const branch = (ch.metadata.branch ? await getBranchBySlug(ctx.db, ch.metadata.branch) : undefined) ?? fallback;
      const expId = Number(ch.metadata.experiment_id ?? NaN);
      const experiment = Number.isInteger(expId) ? await getExperiment(ctx.db, expId) : undefined;
      await recordLedger(ctx.db, {
        kind: "revenue",
        amountEur: Math.max(0, ch.amount_captured - ch.amount_refunded) / 100,
        source: "stripe",
        externalId: ch.id,
        occurredAt: new Date(ch.created * 1000),
        branchId: branch.id,
        experimentId: experiment?.id ?? null,
        description: ch.description ?? "Stripe-betaling",
      });
      imported += 1;
    }
    if (!json.has_more || !json.data?.length) break;
    startingAfter = json.data.at(-1)!.id;
  }
  return { imported, skipped };
}
