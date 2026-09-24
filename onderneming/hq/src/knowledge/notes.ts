import { z } from "zod";
import type { Db } from "../db/index.js";
import { audit } from "../domain/audit.js";
import { requireBranch } from "../domain/branches.js";
import type { Actor, AppContext } from "../domain/context.js";
import { requireExperiment } from "../domain/experiments.js";

/** Een notitie in het gedeelde geheugen: iets wat een agent heeft uitgezocht en wat anderen kunnen gebruiken. */
export interface Note {
  id: number;
  agentId: string | null;
  author: string;
  title: string;
  body: string;
  tags: string[];
  branchId: number | null;
  experimentId: number | null;
  createdAt: Date;
}

export const noteSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(10).max(8000),
  tags: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,30}$/)).max(8).optional(),
  branch: z.string().optional(),
  experimentId: z.number().int().positive().optional(),
});

export type NoteInput = z.infer<typeof noteSchema>;

interface NoteRow {
  id: number;
  agent_id: string | null;
  author: string;
  title: string;
  body: string;
  tags: string[] | null;
  branch_id: number | null;
  experiment_id: number | null;
  created_at: string | Date;
}

const toNote = (r: NoteRow): Note => ({
  id: r.id,
  agentId: r.agent_id,
  author: r.author,
  title: r.title,
  body: r.body,
  tags: r.tags ?? [],
  branchId: r.branch_id,
  experimentId: r.experiment_id,
  createdAt: new Date(r.created_at),
});

export async function addNote(ctx: AppContext, input: NoteInput, actor: Actor, authorName: string): Promise<Note> {
  let branchId: number | null = null;
  if (input.experimentId) branchId = (await requireExperiment(ctx.db, input.experimentId)).branchId;
  if (input.branch) branchId = (await requireBranch(ctx.db, input.branch)).id;
  const agentId = actor.startsWith("agent:") ? actor.slice(6) : null;
  const rows = await ctx.db.query<NoteRow>(
    `insert into notes (agent_id, author, title, body, tags, branch_id, experiment_id)
     values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [agentId, authorName, input.title, input.body, input.tags ?? [], branchId, input.experimentId ?? null],
  );
  const note = toNote(rows[0]!);
  await audit(ctx.db, actor, "note.add", { noteId: note.id });
  await ctx.events.emit({
    type: "knowledge.write",
    agentId,
    text: note.title,
    data: { kind: "note", noteId: note.id, tags: note.tags },
  });
  return note;
}

export async function listNotes(db: Db, limit = 500): Promise<Note[]> {
  const rows = await db.query<NoteRow>("select * from notes order by id desc limit $1", [limit]);
  return rows.map(toNote);
}

/** Zoekt in notities (full-text op titel en tekst). Nieuwste eerst. */
export async function searchNotes(db: Db, q: { text?: string; tag?: string; limit?: number } = {}): Promise<Note[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.text?.trim()) {
    params.push(q.text.trim());
    where.push(`to_tsvector('simple', title || ' ' || body) @@ plainto_tsquery('simple', $${params.length})`);
  }
  if (q.tag) {
    params.push(q.tag);
    where.push(`$${params.length} = any(tags)`);
  }
  params.push(Math.min(q.limit ?? 10, 50));
  const rows = await db.query<NoteRow>(
    `select * from notes ${where.length ? `where ${where.join(" and ")}` : ""} order by id desc limit $${params.length}`,
    params,
  );
  return rows.map(toNote);
}
