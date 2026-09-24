import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/api/app.js";
import { proposalSchema, proposeExperiment } from "../src/domain/experiments.js";
import { addLesson } from "../src/domain/lessons.js";
import { knowledgeAdvice, similarExperiments } from "../src/knowledge/precheck.js";
import { createTestEnv, validProposal, type TestEnv } from "./helpers/context.js";

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => {
  await env.close();
});

const idle = {
  ...validProposal,
  title: "Idle-clicker met dagelijkse beloning",
  hypothesis: "Een idle-clicker met dagelijkse beloning houdt mobiele spelers op CrazyGames lang vast.",
};

/** Een eerder experiment dat is afgeschoten, met een les erbij. */
async function killedIdleGame(): Promise<number> {
  const { experiment } = await proposeExperiment(env.ctx, proposalSchema.parse(idle), `agent:${env.lead.id}`);
  await env.db.query("update experiments set status = 'killed', decision_reason = 'geen signaal na 14 dagen' where id = $1", [experiment.id]);
  await addLesson(env.ctx, { lesson: "Idle-games halen op mobiel minder dan 2 minuten speeltijd", experimentId: experiment.id, tags: ["retentie"] }, `agent:${env.analyst.id}`);
  return experiment.id;
}

describe("vooronderzoek bij een experimentvoorstel", () => {
  it("zet een eerder afgeschoten idee en zijn les bij het voorstel, en waarschuwt de agent", async () => {
    const old = await killedIdleGame();
    const app = createApp(env.ctx);
    const res = await app.request("/api/agent/experiments", {
      method: "POST",
      headers: { authorization: `Bearer ${env.scout.token}`, "content-type": "application/json" },
      body: JSON.stringify({ ...idle, title: "Idle-clicker 2 met beloning per dag" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { knowledge: { similar: Array<{ code: string; status: string }>; lessons: Array<{ experiment: string }> }; advice: string };
    expect(body.knowledge.similar[0]).toMatchObject({ code: `EXP-${old}`, status: "killed" });
    expect(body.knowledge.lessons[0]).toMatchObject({ experiment: `EXP-${old}` });
    expect(body.advice).toContain(`EXP-${old}`);
    expect(body.advice).toContain("anders");

    const rows = await env.db.query<{ summary: string }>("select summary from approvals order by id desc limit 1");
    expect(rows[0]!.summary).toContain(`Lijkt op EXP-${old}`);
    expect(rows[0]!.summary).toContain("afgeschoten: geen signaal na 14 dagen");
    expect(rows[0]!.summary).toContain("Les: Idle-games halen op mobiel");
  });

  it("de HQ-bot loopt naar de kennisruimte om het op te zoeken", async () => {
    await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), `agent:${env.lead.id}`);
    const query = (await env.ctx.events.recent(20)).find((e) => e.type === "knowledge.query");
    expect(query).toMatchObject({ agentId: "hq-bot" });
    expect(query?.text).toContain("Fluxgrid");
  });

  it("nieuw terrein: dat staat er ook bij", async () => {
    const { knowledge } = await proposeExperiment(env.ctx, proposalSchema.parse(validProposal), `agent:${env.lead.id}`);
    expect(knowledge).toEqual({ similar: [], lessons: [], notes: [], graph: false });
    const rows = await env.db.query<{ summary: string }>("select summary from approvals order by id desc limit 1");
    expect(rows[0]!.summary).toContain("niets vergelijkbaars gevonden");
    expect(knowledgeAdvice(knowledge)).toContain("Niets vergelijkbaars");
  });

  it("één gedeeld woord maakt twee ideeën nog niet vergelijkbaar", async () => {
    await killedIdleGame();
    const other = { id: 999, title: "Woordpuzzel voor taalleerders", hypothesis: "Taalleerders spelen elke dag een korte woordpuzzel op CrazyGames." };
    expect(await similarExperiments(env.ctx, other)).toEqual([]);
  });

  it("een lopend experiment dat erop lijkt: afstemmen in plaats van dubbel werk", async () => {
    const { experiment } = await proposeExperiment(env.ctx, proposalSchema.parse(idle), `agent:${env.lead.id}`);
    const { knowledge } = await proposeExperiment(env.ctx, proposalSchema.parse({ ...idle, title: "Idle-clicker met dagelijkse beloning v2" }), `agent:${env.lead.id}`);
    expect(knowledge?.similar[0]).toMatchObject({ code: `EXP-${experiment.id}`, status: "proposed" });
    expect(knowledgeAdvice(knowledge)).toContain("loopt nog");
  });
});
