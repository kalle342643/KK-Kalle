import { describe, expect, it } from "vitest";
import { buySkin, defaultSave, parseSave, recordRun, selectSkin } from "../src/save";

describe("opslag", () => {
  it("valt terug op standaard bij kapotte of vreemde data", () => {
    expect(parseSave(null).best).toBe(0);
    expect(parseSave("{kapot").best).toBe(0);
    expect(parseSave(JSON.stringify({ version: 9, best: 99 })).best).toBe(0);
    const odd = parseSave(JSON.stringify({ version: 1, best: -5, shards: "veel", unlocked: ["prism", 3, "nep"], skin: "nep" }));
    expect(odd.best).toBe(0);
    expect(odd.shards).toBe(0);
    expect(odd.unlocked).toEqual(["spark", "prism"]);
    expect(odd.skin).toBe("spark");
  });

  it("bewaart een geldige opslag ongewijzigd", () => {
    const s = { ...defaultSave(), best: 31, shards: 77, unlocked: ["spark", "prism"], skin: "prism" };
    expect(parseSave(JSON.stringify(s))).toEqual(s);
  });

  it("kopen kost scherven, alleen als je genoeg hebt", () => {
    const poor = { ...defaultSave(), shards: 10 };
    expect(buySkin(poor, "dandelion")).toBeNull();
    const rich = { ...defaultSave(), shards: 50 };
    const after = buySkin(rich, "dandelion");
    expect(after).toMatchObject({ shards: 10, skin: "dandelion" });
    expect(after?.unlocked).toContain("dandelion");
    expect(after && buySkin(after, "dandelion")).toBeNull();
    expect(selectSkin(rich, "prism")).toBeNull();
  });

  it("een run telt mee voor record, scherven en dagrecord", () => {
    const s = defaultSave();
    const a = recordRun(s, { score: 12, shards: 5, mode: "endless", day: "2026-11-27" });
    expect(a).toMatchObject({ newBest: true, save: { best: 12, shards: 5, runs: 1 } });
    const b = recordRun(a.save, { score: 8, shards: 2, mode: "endless", day: "2026-11-27" });
    expect(b).toMatchObject({ newBest: false, save: { best: 12, shards: 7, runs: 2 } });
    const d = recordRun(b.save, { score: 4, shards: 0, mode: "daily", day: "2026-11-27" });
    expect(d.save.bestDaily).toEqual({ date: "2026-11-27", score: 4 });
    expect(d.save.best).toBe(12);
    const e = recordRun(d.save, { score: 3, shards: 0, mode: "daily", day: "2026-11-28" });
    expect(e.save.bestDaily).toEqual({ date: "2026-11-28", score: 3 });
  });
});
