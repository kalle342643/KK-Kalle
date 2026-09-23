import { z } from "zod";
import type { Db } from "../db/index.js";
import { audit } from "./audit.js";
import { requireBranch } from "./branches.js";
import type { Actor, AppContext } from "./context.js";
import { requireExperiment } from "./experiments.js";

export interface Lesson {
  id: number;
  branchId: number | null;
  experimentId: number | null;
  lesson: string;
  evidence: string | null;
  tags: string[];
  createdBy: string;
  createdAt: Date;
}

export const lessonSchema = z.object({
  lesson: z.string().trim().min(10).max(1000),
  evidence: z.string().trim().max(2000).optional(),
  experimentId: z.number().int().positive().optional(),
  branch: z.string().optional(),
  tags: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,30}$/)).max(8).optional(),
});

export type LessonInput = z.infer<typeof lessonSchema>;

interface LessonRow {
  id: number;
  branch_id: number | null;
  experiment_id: number | null;
  lesson: string;
  evidence: string | null;
  tags: string[];
  created_by: string;
  created_at: string | Date;
}

const toLesson = (r: LessonRow): Lesson => ({
  id: r.id,
  branchId: r.branch_id,
  experimentId: r.experiment_id,
  lesson: r.lesson,
  evidence: r.evidence,
  tags: r.tags ?? [],
  createdBy: r.created_by,
  createdAt: new Date(r.created_at),
});

export async function addLesson(ctx: AppContext, input: LessonInput, actor: Actor): Promise<Lesson> {
  let branchId: number | null = null;
  if (input.experimentId) branchId = (await requireExperiment(ctx.db, input.experimentId)).branchId;
  if (input.branch) branchId = (await requireBranch(ctx.db, input.branch)).id;
  const rows = await ctx.db.query<LessonRow>(
    `insert into lessons (branch_id, experiment_id, lesson, evidence, tags, created_by)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [branchId, input.experimentId ?? null, input.lesson, input.evidence ?? null, input.tags ?? [], actor],
  );
  await audit(ctx.db, actor, "lesson.add", { lessonId: rows[0]!.id });
  return toLesson(rows[0]!);
}

/** Zoekt lessen (full-text), optioneel per tak of tag. Nieuwste eerst. */
export async function searchLessons(
  db: Db,
  q: { text?: string; branchId?: number; tag?: string; limit?: number } = {},
): Promise<Lesson[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.text?.trim()) {
    params.push(q.text.trim());
    where.push(
      `to_tsvector('simple', coalesce(lesson, '') || ' ' || coalesce(evidence, '')) @@ plainto_tsquery('simple', $${params.length})`,
    );
  }
  if (q.branchId !== undefined) {
    params.push(q.branchId);
    where.push(`branch_id = $${params.length}`);
  }
  if (q.tag) {
    params.push(q.tag);
    where.push(`$${params.length} = any(tags)`);
  }
  params.push(Math.min(q.limit ?? 20, 100));
  const rows = await db.query<LessonRow>(
    `select * from lessons ${where.length ? `where ${where.join(" and ")}` : ""} order by id desc limit $${params.length}`,
    params,
  );
  return rows.map(toLesson);
}
