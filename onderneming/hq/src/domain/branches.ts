import { num, type Db } from "../db/index.js";

export type BranchStatus = "active" | "paused" | "killed";

export interface Branch {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  template: string | null;
  status: BranchStatus;
  monthlyBudgetEur: number;
  leadAgentId: string | null;
}

interface BranchRow {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  template: string | null;
  status: BranchStatus;
  monthly_budget_eur: string | number;
  lead_agent_id: string | null;
}

function toBranch(r: BranchRow): Branch {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    template: r.template,
    status: r.status,
    monthlyBudgetEur: num(r.monthly_budget_eur),
    leadAgentId: r.lead_agent_id,
  };
}

export const HOLDING_SLUG = "holding";

export async function listBranches(db: Db, opts: { includeKilled?: boolean } = {}): Promise<Branch[]> {
  const rows = await db.query<BranchRow>(
    `select * from branches ${opts.includeKilled ? "" : "where status <> 'killed'"} order by id`,
  );
  return rows.map(toBranch);
}

export async function getBranch(db: Db, id: number): Promise<Branch | undefined> {
  const rows = await db.query<BranchRow>("select * from branches where id = $1", [id]);
  return rows[0] ? toBranch(rows[0]) : undefined;
}

export async function getBranchBySlug(db: Db, slug: string): Promise<Branch | undefined> {
  const rows = await db.query<BranchRow>("select * from branches where slug = $1", [slug]);
  return rows[0] ? toBranch(rows[0]) : undefined;
}

export async function requireBranch(db: Db, slug: string): Promise<Branch> {
  const b = await getBranchBySlug(db, slug);
  if (!b) throw new DomainError(`Onbekende tak '${slug}'.`, 404);
  return b;
}

export async function holdingBranch(db: Db): Promise<Branch> {
  return requireBranch(db, HOLDING_SLUG);
}

export async function createBranch(
  db: Db,
  input: { slug: string; name: string; description?: string | null; template?: string | null; monthlyBudgetEur?: number; leadAgentId?: string | null },
): Promise<Branch> {
  const rows = await db.query<BranchRow>(
    `insert into branches (slug, name, description, template, monthly_budget_eur, lead_agent_id)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [
      input.slug,
      input.name,
      input.description ?? null,
      input.template ?? null,
      input.monthlyBudgetEur ?? 0,
      input.leadAgentId ?? null,
    ],
  );
  return toBranch(rows[0]!);
}

export async function updateBranch(
  db: Db,
  id: number,
  patch: Partial<Pick<Branch, "status" | "monthlyBudgetEur" | "leadAgentId" | "name" | "description">>,
): Promise<Branch> {
  const current = await getBranch(db, id);
  if (!current) throw new DomainError(`Tak ${id} bestaat niet.`, 404);
  const next = { ...current, ...patch };
  const rows = await db.query<BranchRow>(
    `update branches set status = $2, monthly_budget_eur = $3, lead_agent_id = $4, name = $5, description = $6,
       updated_at = now() where id = $1 returning *`,
    [id, next.status, next.monthlyBudgetEur, next.leadAgentId, next.name, next.description],
  );
  return toBranch(rows[0]!);
}

/** Fout die netjes naar een HTTP-status en een Nederlandse melding vertaalt. */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
