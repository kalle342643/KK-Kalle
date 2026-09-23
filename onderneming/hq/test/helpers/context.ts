import { testConfig, type Config } from "../../src/config.js";
import type { Db } from "../../src/db/index.js";
import { createBranch, type Branch } from "../../src/domain/branches.js";
import { silentLogger, type AppContext } from "../../src/domain/context.js";
import { RecordingNotifier } from "../../src/notify/notifier.js";
import { createTestDb } from "./db.js";
import { FakePaperclip } from "./fakePaperclip.js";

export interface TestEnv {
  ctx: AppContext;
  db: Db;
  paperclip: FakePaperclip;
  notifier: RecordingNotifier;
  clock: { now: Date };
  lead: { id: string; token: string };
  scout: { id: string; token: string };
  analyst: { id: string };
  games: Branch;
  close(): Promise<void>;
}

/** Een complete HQ-omgeving met in-memory database, nep-Paperclip en een tak 'games'. */
export async function createTestEnv(overrides: Partial<Config> = {}): Promise<TestEnv> {
  const db = await createTestDb();
  const paperclip = new FakePaperclip();
  const company = paperclip.seedCompany("Test Holding");
  const notifier = new RecordingNotifier();
  const clock = { now: new Date("2026-09-23T10:00:00Z") };
  const config = testConfig(overrides);
  const ctx: AppContext = {
    db,
    config,
    paperclip,
    notifier,
    companyId: company.id,
    now: () => clock.now,
    log: silentLogger,
  };
  const leadAgent = paperclip.seedAgent(company.id, { name: "Vega", role: "pm", title: "Lead games" });
  const scoutAgent = paperclip.seedAgent(company.id, { name: "Rigel", role: "researcher", title: "Verkenner" });
  const analystAgent = paperclip.seedAgent(company.id, { name: "Argus", role: "cfo", title: "Analist" });
  await db.query("insert into settings (key, value) values ('agent_roles', $1)", [
    JSON.stringify({ analyst: analystAgent.id }),
  ]);
  const games = await createBranch(db, {
    slug: "games",
    name: "Games",
    template: "games",
    monthlyBudgetEur: 40,
    leadAgentId: leadAgent.id,
  });
  return {
    ctx,
    db,
    paperclip,
    notifier,
    clock,
    lead: { id: leadAgent.id, token: paperclip.issueToken(leadAgent.id) },
    scout: { id: scoutAgent.id, token: paperclip.issueToken(scoutAgent.id) },
    analyst: { id: analystAgent.id },
    games,
    close: () => db.close(),
  };
}

export const validProposal = {
  branch: "games",
  title: "Fluxgrid prototype op CrazyGames",
  hypothesis: "Een routing-puzzel met kleurmenging haalt genoeg plays om door te gaan.",
  metric: { name: "plays", target: 500 },
  budgetEur: 20,
  durationDays: 14,
  prediction: "700 plays in 14 dagen",
  evidence: ["https://www.crazygames.com/t/traffic"],
};
