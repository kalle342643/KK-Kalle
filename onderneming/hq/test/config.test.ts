import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("configuratie", () => {
  it("behandelt lege waarden als niet ingesteld", () => {
    const c = loadConfig({ PAPERCLIP_COMPANY_ID: "", TELEGRAM_BOT_TOKEN: "  ", HQ_PORT: "" });
    expect(c.paperclip.companyId).toBeUndefined();
    expect(c.telegram).toBeUndefined();
    expect(c.port).toBe(8080);
  });

  it("weigert te luisteren op het netwerk zonder admin-token", () => {
    expect(() => loadConfig({ HQ_HOST: "0.0.0.0" })).toThrow(/HQ_ADMIN_TOKEN/);
    expect(loadConfig({ HQ_HOST: "0.0.0.0", HQ_ADMIN_TOKEN: "x".repeat(32) }).host).toBe("0.0.0.0");
  });

  it("Telegram zonder chat-id = installatiemodus", () => {
    expect(loadConfig({ TELEGRAM_BOT_TOKEN: "123:abc" }).telegram).toEqual({ botToken: "123:abc", ownerChatId: undefined });
  });

  it("het voorbeeldbestand is geldig zodra het admin-token is ingevuld", () => {
    const text = readFileSync(new URL("../../deploy/hq.env.example", import.meta.url), "utf8");
    const env = parseEnv(text) as Record<string, string>;
    const c = loadConfig({ ...env, HQ_ADMIN_TOKEN: "geheim-token" });
    expect(c.cron.dailyReport).toBe("0 8 * * *");
    expect(c.databaseUrl).toBe("postgresql://ai@/hq?host=/var/run/postgresql");
    expect(c.money.globalMonthlyCapEur).toBe(40);
    expect(c.paperclip.boardToken).toBeUndefined();
  });
});
