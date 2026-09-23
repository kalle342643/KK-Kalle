import { timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { z, ZodError } from "zod";
import type { AgentFactory } from "../company/factory.js";
import { listApprovals } from "../domain/approvals.js";
import { audit, countRecent } from "../domain/audit.js";
import { DomainError, listBranches, requireBranch } from "../domain/branches.js";
import { errorMessage, type AppContext } from "../domain/context.js";
import {
  budgetGate,
  experimentCode,
  listExperiments,
  metricSchema,
  proposalSchema,
  proposeExperiment,
  recordMetric,
  requireExperiment,
  snapshot,
  type ExperimentStatus,
} from "../domain/experiments.js";
import { halt, haltState, resume } from "../domain/killswitch.js";
import { recordLedger, REVENUE_SOURCES } from "../domain/ledger.js";
import { addLesson, lessonSchema, searchLessons } from "../domain/lessons.js";
import { computePortfolio } from "../domain/portfolio.js";
import { buildDailyReport, buildStatus } from "../domain/report.js";
import {
  branchProposalSchema,
  budgetRequestSchema,
  decide,
  proposeBranch,
  requestBudgetIncrease,
  requestSpend,
  spendRequestSchema,
} from "../domain/workflows.js";
import { importRevenueCsv } from "../importers/csv.js";
import { runJob, type JobDefinition } from "../jobs/scheduler.js";
import { PaperclipError } from "../paperclip/client.js";
import type { PcAgent } from "../paperclip/types.js";
import { AgentAuthenticator } from "./agentAuth.js";
import { renderDashboard } from "./dashboard.js";

type Env = { Variables: { agent: PcAgent; agentToken: string } };

export interface AppDeps {
  factory?: AgentFactory;
  /** Geplande taken die de eigenaar ook met de hand kan starten. */
  jobs?: JobDefinition[];
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw new DomainError("Body moet geldige JSON zijn.");
  }
  return schema.parse(json);
}

function idParam(c: Context): number {
  const raw = c.req.param("id") ?? "";
  const id = Number(raw.replace(/^EXP-/i, ""));
  if (!Number.isInteger(id) || id <= 0) throw new DomainError(`Ongeldig id '${raw}'.`);
  return id;
}

export function createApp(ctx: AppContext, deps: AppDeps = {}): Hono<Env> {
  const app = new Hono<Env>();
  const auth = new AgentAuthenticator(ctx);

  app.onError((err, c) => {
    if (err instanceof DomainError) return c.json({ error: err.message }, err.status as 400);
    if (err instanceof ZodError) {
      return c.json(
        { error: "Ongeldige invoer", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
        400,
      );
    }
    if (err instanceof PaperclipError) {
      ctx.log.error("Paperclip-fout", { error: err.message });
      return c.json({ error: `Paperclip: ${err.message}` }, 502);
    }
    ctx.log.error("onverwachte fout", { error: errorMessage(err), path: c.req.path });
    return c.json({ error: "Interne fout in HQ" }, 500);
  });

  app.get("/health", async (c) => c.json({ ok: true, halted: (await haltState(ctx)).halted }));

  // ---------------------------------------------------------------- agents
  const agentApi = new Hono<Env>();
  agentApi.use("*", async (c, next) => {
    const agent = await auth.authenticate(c.req.header("authorization"));
    if (!agent) return c.json({ error: "Onbekend of verlopen agent-token. Gebruik $PAPERCLIP_API_KEY." }, 401);
    c.set("agent", agent);
    c.set("agentToken", c.req.header("authorization")!.replace(/^Bearer\s+/i, "").trim());
    await next();
  });
  const actorOf = (c: Context<Env>) => `agent:${c.get("agent").id}` as const;

  agentApi.get("/me", (c) => {
    const a = c.get("agent");
    return c.json({ id: a.id, name: a.name, role: a.role, title: a.title, metadata: a.metadata });
  });

  agentApi.get("/overview", async (c) => {
    const halted = await haltState(ctx);
    const branches = await listBranches(ctx.db);
    const running = await listExperiments(ctx.db, { status: ["running"] });
    const out = [];
    for (const b of branches) {
      const gate = await budgetGate(ctx, b);
      out.push({
        slug: b.slug,
        name: b.name,
        status: b.status,
        monthlyBudgetEur: b.monthlyBudgetEur,
        committedEur: gate.branchCommittedEur,
        freeEur: Math.max(0, b.monthlyBudgetEur - gate.branchCommittedEur),
      });
    }
    const snapshots = [];
    for (const e of running) {
      const s = await snapshot(ctx, e);
      snapshots.push({
        id: e.id,
        code: experimentCode(e.id),
        branch: s.branch.slug,
        title: e.title,
        metric: e.metricName,
        target: e.metricTarget,
        trustedValue: s.trustedValue,
        agentReportedValue: s.untrustedValue,
        spentEur: s.spentEur,
        budgetEur: e.budgetEur,
        daysLeft: s.daysLeft,
      });
    }
    return c.json({
      halted: halted.halted,
      haltReason: halted.reason,
      branches: out,
      running: snapshots,
      recentLessons: (await searchLessons(ctx.db, { limit: 5 })).map((l) => ({ id: l.id, lesson: l.lesson, tags: l.tags })),
      rules: {
        experimentBudgetEur: ctx.config.money.experimentBudgetEur,
        experimentMaxBudgetEur: ctx.config.money.experimentMaxBudgetEur,
        experimentMaxDays: ctx.config.money.experimentMaxDays,
        maxRequestsPerDay: ctx.config.money.maxRequestsPerAgentPerDay,
      },
    });
  });

  agentApi.get("/branches", async (c) => c.json(await listBranches(ctx.db)));

  agentApi.get("/portfolio", async (c) => {
    const p = await computePortfolio(ctx);
    return c.json({
      revenue30Eur: p.revenue30,
      allowanceEur: p.allowanceEur,
      holdingCost30Eur: p.holding.cost,
      branches: p.branches.map((b) => ({
        slug: b.branch.slug,
        name: b.branch.name,
        revenue30Eur: b.last30.revenue,
        cost30Eur: b.last30.cost,
        roi: b.roi,
        runningExperiments: b.runningExperiments,
        keepsLast60Days: b.keepsLast60,
        budgetEur: b.currentBudgetEur,
        suggestedBudgetEur: b.proposedBudgetEur,
        note: b.note,
      })),
    });
  });

  agentApi.get("/experiments", async (c) => {
    const status = c.req.query("status")?.split(",").filter(Boolean) as ExperimentStatus[] | undefined;
    const branchSlug = c.req.query("branch");
    const branch = branchSlug ? await requireBranch(ctx.db, branchSlug) : undefined;
    return c.json(await listExperiments(ctx.db, { status, branchId: branch?.id, limit: 50 }));
  });

  agentApi.get("/experiments/:id", async (c) => {
    const exp = await requireExperiment(ctx.db, idParam(c));
    const s = await snapshot(ctx, exp);
    const metrics = await ctx.db.query(
      "select name, value, source, trusted, note, recorded_at from metrics where experiment_id = $1 order by id desc limit 50",
      [exp.id],
    );
    return c.json({ ...s, metrics });
  });

  agentApi.post("/experiments", async (c) => {
    const input = await body(c, proposalSchema);
    const { experiment, approval } = await proposeExperiment(ctx, input, actorOf(c));
    return c.json(
      { experiment, approvalId: approval.id, message: `${experimentCode(experiment.id)} ingediend; wacht op goedkeuring van de eigenaar.` },
      201,
    );
  });

  agentApi.post("/experiments/:id/metrics", async (c) => {
    const input = await body(c, metricSchema);
    await recordMetric(ctx, idParam(c), { ...input, source: "agent", trusted: false }, actorOf(c));
    return c.json({ ok: true, note: "Opgeslagen als agent-meting (telt als signaal, niet als bewijs)." }, 201);
  });

  agentApi.post("/experiments/:id/budget-request", async (c) => {
    const input = await body(c, budgetRequestSchema);
    const approval = await requestBudgetIncrease(ctx, idParam(c), input, actorOf(c));
    return c.json({ approvalId: approval.id, status: approval.status }, 201);
  });

  agentApi.post("/spend-requests", async (c) => {
    const input = await body(c, spendRequestSchema);
    const approval = await requestSpend(ctx, input, actorOf(c));
    return c.json({ approvalId: approval.id, status: approval.status }, 201);
  });

  agentApi.post("/branches", async (c) => {
    const input = await body(c, branchProposalSchema);
    if (deps.factory) deps.factory.branchTemplate(input.template);
    const approval = await proposeBranch(ctx, input, actorOf(c));
    return c.json({ approvalId: approval.id, status: approval.status }, 201);
  });

  agentApi.get("/lessons", async (c) => {
    const branchSlug = c.req.query("branch");
    const branch = branchSlug ? await requireBranch(ctx.db, branchSlug) : undefined;
    return c.json(
      await searchLessons(ctx.db, {
        text: c.req.query("q"),
        branchId: branch?.id,
        tag: c.req.query("tag"),
        limit: Number(c.req.query("limit") ?? 20),
      }),
    );
  });

  agentApi.post("/lessons", async (c) => {
    const input = await body(c, lessonSchema);
    return c.json(await addLesson(ctx, input, actorOf(c)), 201);
  });

  agentApi.get("/templates", (c) => {
    if (!deps.factory) throw new DomainError("Agent Factory niet geladen.", 503);
    return c.json({ agents: deps.factory.listTemplates(), branches: deps.factory.listBranchTemplates() });
  });

  agentApi.post("/hire", async (c) => {
    if (!deps.factory) throw new DomainError("Agent Factory niet geladen.", 503);
    const input = await body(
      c,
      z.object({
        template: z.string().min(1),
        branch: z.string().min(1),
        name: z.string().trim().min(2).max(40).optional(),
        reason: z.string().trim().min(20).max(1000),
      }),
    );
    const res = await deps.factory.hireForAgent(ctx, input, c.get("agent"), c.get("agentToken"));
    return c.json({ ...res, message: "Aanname ingediend; de eigenaar moet hem goedkeuren." }, 201);
  });

  agentApi.post("/notify", async (c) => {
    const input = await body(c, z.object({ text: z.string().trim().min(5).max(500) }));
    const actor = actorOf(c);
    if ((await countRecent(ctx.db, actor, ["agent.notify"], 24)) >= 3) {
      throw new DomainError("Maximaal 3 berichten per dag aan de eigenaar. Zet het in je rapport.", 429);
    }
    const agent = c.get("agent");
    await ctx.notifier.send({ text: `💬 ${agent.name}: ${input.text}`, silent: true });
    await audit(ctx.db, actor, "agent.notify", { length: input.text.length });
    return c.json({ ok: true }, 201);
  });

  app.route("/api/agent", agentApi);

  // ---------------------------------------------------------------- eigenaar
  const ownerApi = new Hono<Env>();
  const ownerAuth = async (c: Context<Env>, next: () => Promise<void>) => {
    const expected = ctx.config.adminToken;
    if (!expected) {
      // Zonder token alleen bereikbaar vanaf deze machine (HQ_HOST=127.0.0.1 is dan verplicht).
      await next();
      return;
    }
    const header = c.req.header("authorization")?.replace(/^Bearer\s+/i, "").trim();
    const cookie = getCookie(c, "hq_token");
    const given = header ?? cookie ?? "";
    if (!safeEqual(given, expected)) return c.json({ error: "Niet ingelogd" }, 401);
    await next();
  };
  ownerApi.use("*", ownerAuth);

  ownerApi.get("/status", async (c) => c.text(await buildStatus(ctx)));
  ownerApi.get("/report", async (c) => c.text(await buildDailyReport(ctx)));
  ownerApi.get("/portfolio", async (c) => c.json(await computePortfolio(ctx)));
  ownerApi.post("/halt", async (c) => {
    const input = await body(c, z.object({ reason: z.string().trim().min(2).max(200).default("handmatig") }));
    return c.json(await halt(ctx, input.reason, "owner"));
  });
  ownerApi.post("/resume", async (c) => c.json(await resume(ctx, "owner")));
  ownerApi.get("/approvals", async (c) => {
    const status = (c.req.query("status") ?? "pending").split(",") as Array<"pending" | "approved" | "rejected">;
    return c.json(await listApprovals(ctx.db, { status }));
  });
  ownerApi.post("/approvals/:id/decide", async (c) => {
    const input = await body(c, z.object({ decision: z.enum(["approve", "reject"]), note: z.string().max(500).optional() }));
    return c.json(await decide(ctx, idParam(c), input.decision, input.note ?? null, "owner"));
  });
  ownerApi.post("/revenue", async (c) => {
    const input = await body(
      c,
      z.object({
        amountEur: z.number().nonnegative(),
        branch: z.string(),
        source: z.string().refine((s) => REVENUE_SOURCES.has(s), "onbekende bron"),
        experimentId: z.number().int().positive().optional(),
        externalId: z.string().optional(),
        occurredAt: z.iso.datetime().optional(),
        description: z.string().max(300).optional(),
      }),
    );
    const branch = await requireBranch(ctx.db, input.branch);
    if (input.experimentId) await requireExperiment(ctx.db, input.experimentId);
    await recordLedger(ctx.db, {
      kind: "revenue",
      amountEur: input.amountEur,
      source: input.source,
      externalId: input.externalId ?? `owner:${Date.now()}`,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : ctx.now(),
      branchId: branch.id,
      experimentId: input.experimentId ?? null,
      description: input.description ?? null,
    });
    await audit(ctx.db, "owner", "revenue.add", { amountEur: input.amountEur, branch: branch.slug });
    return c.json({ ok: true }, 201);
  });
  ownerApi.post("/revenue/csv", async (c) => c.json(await importRevenueCsv(ctx, await c.req.text(), "owner")));
  ownerApi.get("/jobs", async (c) =>
    c.json({
      available: (deps.jobs ?? []).map((j) => ({ name: j.name, cron: j.cron })),
      runs: await ctx.db.query("select * from job_runs order by name"),
    }),
  );
  ownerApi.post("/jobs/:name/run", async (c) => {
    const job = (deps.jobs ?? []).find((j) => j.name === c.req.param("name"));
    if (!job) throw new DomainError(`Onbekende taak '${c.req.param("name")}'.`, 404);
    return c.json(await runJob(ctx, job));
  });
  ownerApi.post("/metrics", async (c) => {
    const input = await body(c, metricSchema.extend({ experimentId: z.number().int().positive(), source: z.string().min(2) }));
    await recordMetric(
      ctx,
      input.experimentId,
      { name: input.name, value: input.value, note: input.note, source: input.source, trusted: true },
      "owner",
    );
    return c.json({ ok: true }, 201);
  });
  app.route("/api/owner", ownerApi);

  // ---------------------------------------------------------------- dashboard
  app.get("/", async (c) => {
    const token = c.req.query("token");
    if (token && ctx.config.adminToken && safeEqual(token, ctx.config.adminToken)) {
      setCookie(c, "hq_token", token, { httpOnly: true, sameSite: "Strict", path: "/", maxAge: 60 * 60 * 24 * 30 });
      return c.redirect("/");
    }
    if (ctx.config.adminToken) {
      const cookie = getCookie(c, "hq_token") ?? "";
      if (!safeEqual(cookie, ctx.config.adminToken)) {
        return c.html("<p>Log in via <code>/?token=…</code> (HQ_ADMIN_TOKEN).</p>", 401);
      }
    }
    return c.html(await renderDashboard(ctx));
  });

  return app;
}
