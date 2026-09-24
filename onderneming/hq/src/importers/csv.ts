import { z } from "zod";
import { requireBranch } from "../domain/branches.js";
import type { Actor, AppContext } from "../domain/context.js";
import { audit } from "../domain/audit.js";
import { requireExperiment } from "../domain/experiments.js";
import { recordRevenue, REVENUE_SOURCES } from "../domain/ledger.js";

/** Minimale CSV-parser (komma of puntkomma, aanhalingstekens, lege regels overslaan). */
export function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const sep = (lines[0]!.match(/;/g)?.length ?? 0) > (lines[0]!.match(/,/g)?.length ?? 0) ? ";" : ",";
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === sep) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = split(lines[0]!).map((h) => h.toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = split(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

const rowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}/, "datum als JJJJ-MM-DD"),
  amount_eur: z.string().transform((s, ctx) => {
    const n = Number(s.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      ctx.addIssue({ code: "custom", message: `ongeldig bedrag '${s}'` });
      return z.NEVER;
    }
    return n;
  }),
  branch: z.string().min(1),
  source: z.string().min(1),
  experiment_id: z.string().optional(),
  external_id: z.string().optional(),
  description: z.string().optional(),
});

export interface CsvImportResult {
  imported: number;
  errors: string[];
}

/**
 * Importeert omzet uit een CSV (bv. een export van CrazyGames of een affiliate-dashboard).
 * Kolommen: date, amount_eur, branch, source, experiment_id (optioneel), external_id (optioneel), description.
 * Zonder external_id wordt een sleutel gemaakt van datum+bron+tak+bedrag, zodat dubbel importeren niets dubbel telt.
 */
export async function importRevenueCsv(ctx: AppContext, text: string, actor: Actor): Promise<CsvImportResult> {
  const result: CsvImportResult = { imported: 0, errors: [] };
  const rows = parseCsv(text);
  for (const [i, raw] of rows.entries()) {
    const line = i + 2;
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      result.errors.push(`regel ${line}: ${parsed.error.issues.map((x) => x.message).join(", ")}`);
      continue;
    }
    const r = parsed.data;
    const source = r.source.toLowerCase();
    if (!REVENUE_SOURCES.has(source)) {
      result.errors.push(`regel ${line}: bron '${r.source}' onbekend (toegestaan: ${[...REVENUE_SOURCES].join(", ")})`);
      continue;
    }
    try {
      const branch = await requireBranch(ctx.db, r.branch);
      const experimentId = r.experiment_id ? Number(r.experiment_id.replace(/^EXP-/i, "")) : null;
      if (experimentId) await requireExperiment(ctx.db, experimentId);
      await recordRevenue(ctx, {
        amountEur: r.amount_eur,
        source,
        externalId: r.external_id || `${r.date.slice(0, 10)}:${branch.slug}:${experimentId ?? "-"}:${r.amount_eur}`,
        occurredAt: new Date(`${r.date.slice(0, 10)}T12:00:00Z`),
        branchId: branch.id,
        experimentId,
        description: r.description || `Import ${source}`,
      });
      result.imported += 1;
    } catch (err) {
      result.errors.push(`regel ${line}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await audit(ctx.db, actor, "revenue.import_csv", { imported: result.imported, errors: result.errors.length });
  return result;
}
