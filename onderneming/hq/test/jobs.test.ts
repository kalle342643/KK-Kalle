import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { totals } from "../src/domain/ledger.js";
import { importStripe } from "../src/importers/stripe.js";
import { defaultJobs, runJob } from "../src/jobs/scheduler.js";
import { createTestEnv, type TestEnv } from "./helpers/context.js";

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => {
  await env.close();
});

describe("planner", () => {
  it("kent de vaste taken, met Stripe alleen als er een sleutel is", () => {
    expect(defaultJobs(env.ctx).map((j) => j.name)).toEqual([
      "approvals-sync",
      "cost-sync",
      "evaluate",
      "daily-report",
      "weekly-portfolio",
      "vault-sync",
      "knowledge-graph",
    ]);
    env.ctx.config.stripe = { apiKey: "rk_test", defaultBranch: "games" };
    expect(defaultJobs(env.ctx).map((j) => j.name)).toContain("stripe-import");
  });

  it("houdt runs bij en meldt pas na drie mislukkingen op rij (één keer per dag)", async () => {
    const job = {
      name: "kapot",
      cron: "* * * * *",
      run: async () => {
        throw new Error("boem");
      },
    };
    for (let i = 0; i < 4; i++) expect((await runJob(env.ctx, job)).ok).toBe(false);
    const [row] = await env.db.query<{ last_status: string; last_error: string }>("select * from job_runs where name = 'kapot'");
    expect(row).toMatchObject({ last_status: "error:4", last_error: "boem" });
    expect(env.notifier.texts().filter((t) => t.includes("kapot")).length).toBe(1);

    const ok = await runJob(env.ctx, { ...job, run: async () => undefined });
    expect(ok.ok).toBe(true);
  });

  it("het dagrapport gaat als bericht naar de eigenaar", async () => {
    const report = defaultJobs(env.ctx).find((j) => j.name === "daily-report")!;
    await runJob(env.ctx, report);
    expect(env.notifier.last()!.text).toContain("Dagrapport");
  });
});

describe("Stripe-import", () => {
  const charge = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    amount: 1000,
    amount_captured: 1000,
    amount_refunded: 0,
    currency: "eur",
    paid: true,
    status: "succeeded",
    created: Math.floor(new Date("2026-09-22T10:00:00Z").getTime() / 1000),
    description: "Fluxgrid supporter",
    metadata: { branch: "games" },
    ...over,
  });

  it("boekt geslaagde euro-betalingen per tak, verrekent terugbetalingen en pagineert", async () => {
    const pages = [
      { data: [charge("ch_1"), charge("ch_2", { amount_refunded: 400 })], has_more: true },
      { data: [charge("ch_3", { currency: "usd" }), charge("ch_4", { status: "failed", paid: false })], has_more: false },
    ];
    const urls: string[] = [];
    const res = await importStripe(env.ctx, { apiKey: "rk_test", defaultBranch: undefined }, async (url) => {
      urls.push(url);
      return new Response(JSON.stringify(pages[urls.length - 1]));
    });
    expect(res.imported).toBe(2);
    expect(res.skipped[0]).toContain("usd");
    expect(urls[1]).toContain("starting_after=ch_2");
    expect((await totals(env.db, { branchId: env.games.id })).revenue).toBe(16);

    // Opnieuw importeren telt niets dubbel.
    urls.length = 0;
    await importStripe(env.ctx, { apiKey: "rk_test", defaultBranch: undefined }, async (url) => {
      urls.push(url);
      return new Response(JSON.stringify(pages[urls.length - 1]));
    });
    expect((await totals(env.db, { branchId: env.games.id })).revenue).toBe(16);
  });

  it("geeft een duidelijke fout bij een ongeldige sleutel", async () => {
    await expect(
      importStripe(env.ctx, { apiKey: "fout", defaultBranch: undefined }, async () =>
        new Response(JSON.stringify({ error: { message: "Invalid API Key provided" } }), { status: 401 }),
      ),
    ).rejects.toThrow(/Invalid API Key/);
  });
});
