import type { BacklogItem } from "../office/types.js";

/**
 * Leest een BACKLOG.md zoals Claude Code die bijhoudt: kopjes (## …) met opsommingen eronder.
 * Een punt telt als "voor jou" als het kopje zegt dat het bij jou ligt ("dit ligt bij Kalle",
 * "voor jou", "(u)") of als het punt zelf je naam noemt. Afgevinkte punten (- [x]) tellen niet mee.
 */

const clean = (s: string) =>
  s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function ownerTest(names: string[]): (text: string) => boolean {
  const escaped = names.map((n) => n.trim()).filter(Boolean).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const byName = escaped.length ? new RegExp(`\\b(${escaped.join("|")})\\b`, "i") : null;
  const generic = /ligt bij (jou|u)\b|voor (jou|u)\b|jouw beurt|\(u\)|door de eigenaar|eigenaar doet/i;
  return (text) => generic.test(text) || Boolean(byName?.test(text));
}

export function parseBacklog(markdown: string, ownerNames: string[] = ["Kalle"]): BacklogItem[] {
  const isOwner = ownerTest(ownerNames);
  const items: BacklogItem[] = [];
  let section = "Backlog";
  let sectionOwner = false;
  let current: { raw: string; done: boolean } | null = null;

  const flush = () => {
    if (!current) return;
    const raw = current.raw.trim();
    if (!current.done && raw) {
      let title: string;
      let rest: string;
      const bold = raw.match(/^\*\*(.+?)\*\*[.:]?\s*(.*)$/s);
      if (bold) {
        title = clean(bold[1]!).replace(/[.:]$/, "");
        rest = bold[2] ?? "";
      } else {
        const text = clean(raw);
        const stop = text.search(/[.!?](\s|$)/);
        title = stop > 0 && stop < 100 ? text.slice(0, stop) : clip(text, 90);
        rest = stop > 0 && stop < 100 ? text.slice(stop + 1) : "";
      }
      const text = clip(clean(rest).replace(/^[,.;:]\s*/, ""), 280);
      items.push({ title: clip(title, 100), text, section, owner: sectionOwner || isOwner(raw) });
    }
    current = null;
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flush();
      // De titel van het document (# Backlog) is geen sectie.
      if (heading[1]!.length === 1) continue;
      section = clip(clean(heading[2]!), 80);
      sectionOwner = isOwner(heading[2]!);
      continue;
    }
    const bullet = line.match(/^[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/);
    if (bullet) {
      flush();
      current = { raw: bullet[2] ?? "", done: (bullet[1] ?? " ").toLowerCase() === "x" };
      continue;
    }
    if (current && /^\s+\S/.test(line)) {
      current.raw += ` ${line.trim()}`;
      continue;
    }
    if (!line.trim()) continue;
    // Gewone tekst (uitleg onder een kopje) sluit het vorige punt af.
    flush();
  }
  flush();
  return items;
}
