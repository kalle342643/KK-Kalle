import { Cron } from "croner";
import { errorMessage, type AppContext } from "../domain/context.js";
import { syncCosts } from "../domain/costs.js";
import { evaluateRunning } from "../domain/evaluator.js";
import { proposePortfolio } from "../domain/portfolio.js";
import { buildDailyReport } from "../domain/report.js";
import { markNotified } from "../domain/settings.js";
import { syncApprovals } from "../domain/workflows.js";
import { importStripe } from "../importers/stripe.js";
import { rebuildKnowledge, runVaultSync } from "../knowledge/service.js";

export interface JobDefinition {
  name: string;
  cron: string;
  run: (ctx: AppContext) => Promise<unknown>;
}

export function defaultJobs(ctx: AppContext): JobDefinition[] {
  const c = ctx.config.cron;
  const jobs: JobDefinition[] = [
    { name: "approvals-sync", cron: c.sync, run: syncApprovals },
    { name: "cost-sync", cron: c.costSync, run: (x) => syncCosts(x) },
    { name: "evaluate", cron: c.evaluate, run: evaluateRunning },
    {
      name: "daily-report",
      cron: c.dailyReport,
      run: async (x) => x.notifier.send({ text: await buildDailyReport(x) }),
    },
    { name: "weekly-portfolio", cron: c.weeklyPortfolio, run: (x) => proposePortfolio(x, "job:weekly-portfolio") },
    { name: "vault-sync", cron: c.vaultSync, run: runVaultSync },
    {
      name: "knowledge-graph",
      cron: c.knowledge,
      run: async (x) => {
        await x.events.prune(30);
        return rebuildKnowledge(x);
      },
    },
  ];
  const stripe = ctx.config.stripe;
  if (stripe) jobs.push({ name: "stripe-import", cron: c.revenueImport, run: (x) => importStripe(x, stripe) });
  return jobs;
}

/** Voert één job uit met boekhouding in job_runs en een melding bij aanhoudende fouten. */
export async function runJob(ctx: AppContext, job: JobDefinition): Promise<{ ok: boolean; error?: string }> {
  await ctx.db.query(
    `insert into job_runs (name, last_started_at) values ($1, now())
     on conflict (name) do update set last_started_at = now()`,
    [job.name],
  );
  try {
    await job.run(ctx);
    await ctx.db.query(
      "update job_runs set last_finished_at = now(), last_status = 'ok', last_error = null where name = $1",
      [job.name],
    );
    return { ok: true };
  } catch (err) {
    const error = errorMessage(err);
    ctx.log.error("job mislukt", { job: job.name, error });
    const rows = await ctx.db.query<{ last_status: string | null }>(
      "select last_status from job_runs where name = $1",
      [job.name],
    );
    const streak = rows[0]?.last_status?.startsWith("error") ? Number(rows[0].last_status.split(":")[1] ?? 1) + 1 : 1;
    await ctx.db.query(
      "update job_runs set last_finished_at = now(), last_status = $2, last_error = $3 where name = $1",
      [job.name, `error:${streak}`, error],
    );
    // Na drie mislukkingen op rij één melding per dag, zodat je weet dat er iets structureel mis is.
    if (streak >= 3 && (await markNotified(ctx.db, `job-failing:${job.name}:${ctx.now().toISOString().slice(0, 10)}`))) {
      await ctx.notifier.send({ text: `⚠️ Taak '${job.name}' mislukt al ${streak} keer op rij: ${error}` });
    }
    return { ok: false, error };
  }
}

export class Scheduler {
  private crons: Cron[] = [];

  constructor(
    private readonly ctx: AppContext,
    private readonly jobs: JobDefinition[] = defaultJobs(ctx),
  ) {}

  start(): void {
    for (const job of this.jobs) {
      // protect: sla een run over als de vorige nog loopt.
      const cron = new Cron(job.cron, { timezone: this.ctx.config.timezone, protect: true, name: job.name }, async () => {
        await runJob(this.ctx, job);
      });
      this.crons.push(cron);
      this.ctx.log.info("job gepland", { job: job.name, cron: job.cron, next: cron.nextRun()?.toISOString() });
    }
  }

  stop(): void {
    for (const c of this.crons) c.stop();
    this.crons = [];
  }
}
