import type { Config } from "../config.js";
import { audit } from "./audit.js";
import { errorMessage, type AppContext } from "./context.js";
import {
  endExperiment,
  experimentCode,
  listExperiments,
  snapshot,
  type ExperimentSnapshot,
} from "./experiments.js";
import { formatEur, formatPct } from "./money.js";
import { getSetting } from "./settings.js";

export type Verdict = "continue" | "keep" | "iterate" | "kill";

export interface Decision {
  verdict: Verdict;
  reason: string;
}

/**
 * De KEEP/ITERATE/KILL-regels. Puur (geen I/O), zodat ze makkelijk te testen en uit te leggen zijn.
 *
 * - KEEP: een betrouwbare meting haalt het doel (mag ook vóór de deadline).
 * - Loopt nog (deadline niet voorbij, budget niet op): doorgaan.
 * - Daarna ITERATE als er een echt signaal is (betrouwbaar ≥ 50% van het doel,
 *   of een agent-meting ≥ doel) én er nog iteraties over zijn; anders KILL.
 */
export function decide(s: ExperimentSnapshot, now: Date, money: Config["money"]): Decision {
  const e = s.experiment;
  if (e.status !== "running") return { verdict: "continue", reason: "loopt niet" };
  const target = e.metricTarget;
  const trusted = s.trustedValue ?? 0;
  const metric = `${e.metricName} ${trusted} van ${target}`;
  if (trusted >= target) {
    return { verdict: "keep", reason: `Doel gehaald: ${metric} (betrouwbare bron).` };
  }
  const deadlinePassed = e.deadlineAt !== null && now.getTime() >= e.deadlineAt.getTime();
  if (!deadlinePassed && !s.budgetExhausted) {
    return { verdict: "continue", reason: `Loopt nog: ${metric}, budget ${formatPct(s.budgetUsedPct)} gebruikt.` };
  }
  const why = deadlinePassed ? "deadline voorbij" : `budget op (${formatEur(s.spentEur)})`;
  const signal = trusted >= target * 0.5 || (s.untrustedValue ?? 0) >= target;
  if (signal && e.iteration < money.maxIterations) {
    const source = trusted >= target * 0.5 ? "betrouwbare meting" : "alleen agent-meting, nog niet bevestigd";
    return { verdict: "iterate", reason: `${why}; wel signaal (${metric}, ${source}). Nog een ronde met aanpassingen.` };
  }
  if (signal) {
    return { verdict: "kill", reason: `${why}; signaal (${metric}) maar maximum aantal iteraties bereikt.` };
  }
  return { verdict: "kill", reason: `${why}; te weinig resultaat (${metric}).` };
}

const VERDICT_TEXT: Record<Exclude<Verdict, "continue">, string> = {
  keep: "✅ KEEP",
  iterate: "🔁 ITERATE",
  kill: "🪦 KILL",
};

export interface EvaluationResult {
  experimentId: number;
  verdict: Verdict;
  reason: string;
}

/**
 * Beoordeelt alle lopende experimenten. Stoppen gebeurt automatisch (dat bespaart alleen geld);
 * opschalen vraagt altijd jouw akkoord via een apart verzoek van de tak-lead.
 */
export async function evaluateRunning(ctx: AppContext): Promise<EvaluationResult[]> {
  const results: EvaluationResult[] = [];
  const running = await listExperiments(ctx.db, { status: ["running"] });
  const roles = (await getSetting<Record<string, string>>(ctx.db, "agent_roles")) ?? {};
  for (const exp of running) {
    try {
      const s = await snapshot(ctx, exp);
      const d = decide(s, ctx.now(), ctx.config.money);
      results.push({ experimentId: exp.id, verdict: d.verdict, reason: d.reason });
      if (d.verdict === "continue") continue;
      await applyVerdict(ctx, s, d, roles);
    } catch (err) {
      ctx.log.error("evaluatie mislukt", { experimentId: exp.id, error: errorMessage(err) });
    }
  }
  return results;
}

async function applyVerdict(
  ctx: AppContext,
  s: ExperimentSnapshot,
  d: Decision,
  roles: Record<string, string>,
): Promise<void> {
  const e = s.experiment;
  const code = experimentCode(e.id);
  const verdict = d.verdict as Exclude<Verdict, "continue">;
  await endExperiment(ctx, e.id, verdict === "kill" ? "killed" : verdict, d.reason);
  await audit(ctx.db, "job:evaluate", `experiment.${verdict}`, { experimentId: e.id, reason: d.reason });

  if (e.paperclipProjectId) {
    try {
      await ctx.paperclip.updateProject(e.paperclipProjectId, { status: verdict === "kill" ? "cancelled" : "completed" });
      if (verdict === "kill") {
        const overview = await ctx.paperclip.budgetsOverview(ctx.companyId);
        for (const inc of overview.activeIncidents) {
          if (inc.scopeType === "project" && inc.scopeId === e.paperclipProjectId) {
            await ctx.paperclip.resolveBudgetIncident(ctx.companyId, inc.id, { action: "keep_paused" }, `HQ: ${code} gestopt`);
          }
        }
      }
    } catch (err) {
      ctx.log.warn("project bijwerken mislukt", { experimentId: e.id, error: errorMessage(err) });
    }
  }

  const lead = e.leadAgentId ?? s.branch.leadAgentId;
  const followUp: Record<typeof verdict, string> = {
    keep: `${code} is geslaagd. Maak een opschaalplan en vraag via HQ extra budget aan (POST /api/agent/experiments/${e.id}/budget-request) met onderbouwing uit de cijfers.`,
    iterate: `${code} gaf een signaal maar haalde het doel niet. Stel een vervolgexperiment voor via HQ met "parentId": ${e.id} en één duidelijke aanpassing.`,
    kill: `${code} is gestopt. Geen actie nodig behalve opruimen; de analist schrijft de lessen.`,
  };
  try {
    if (lead && verdict !== "kill") {
      await ctx.paperclip.createIssue(ctx.companyId, {
        title: `${VERDICT_TEXT[verdict]} ${code}: vervolgstap`,
        description: `${d.reason}\n\n${followUp[verdict]}`,
        assigneeAgentId: lead,
        projectId: e.paperclipProjectId,
        priority: verdict === "keep" ? "high" : "medium",
      });
    }
    if (roles.analyst) {
      await ctx.paperclip.createIssue(ctx.companyId, {
        title: `Lessen vastleggen: ${code} (${verdict.toUpperCase()})`,
        description: [
          `Uitkomst: ${d.reason}`,
          e.prediction ? `Voorspelling vooraf: ${e.prediction}` : "Er was geen voorspelling vastgelegd.",
          "",
          "Schrijf 3 tot 5 lessen via HQ (POST /api/agent/lessons) met experimentId " + e.id + ".",
          "Vergelijk expliciet de voorspelling met de uitkomst: hoe goed voorspelde de ideeënraad?",
        ].join("\n"),
        assigneeAgentId: roles.analyst,
        priority: "medium",
      });
    }
  } catch (err) {
    ctx.log.warn("vervolgtaken aanmaken mislukt", { experimentId: e.id, error: errorMessage(err) });
  }

  await ctx.notifier.send({
    text: [
      `${VERDICT_TEXT[verdict]} ${code} ${e.title}`,
      d.reason,
      `Kosten ${formatEur(s.spentEur)} · omzet ${formatEur(s.revenueEur)}`,
      verdict === "keep" ? "De tak-lead maakt een opschaalplan; dat komt als verzoek bij je langs." : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}
