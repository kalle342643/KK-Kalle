// Speeltest in een echte browser: bouwt niets, opent dist/luma.html met de autopiloot,
// speelt een run, maakt screenshots en faalt bij fouten in de console of een te lage framerate.
// Gebruik: node scripts/speeltest.mjs [seconden] [uitvoermap]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const seconds = Number(process.argv[2] ?? 20);
const out = process.argv[3] ?? join(root, "dist/shots");
await mkdir(out, { recursive: true });

const url = `${pathToFileURL(join(root, "dist/luma.html")).href}?autoplay&debug&seed=speeltest`;
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const errors = [];
const sizes = [
  { name: "telefoon", viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 },
  { name: "desktop", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
];
const report = [];
for (const size of sizes) {
  const page = await browser.newPage({ viewport: size.viewport, deviceScaleFactor: size.deviceScaleFactor });
  page.on("console", (m) => m.type() === "error" && errors.push(`${size.name}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${size.name}: ${e.message}`));
  await page.goto(url);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, `speeltest-${size.name}-titel.png`) });
  await page.evaluate(() => globalThis.__luma.start("endless"));
  const shots = 4;
  for (let i = 1; i <= shots; i++) {
    await page.waitForTimeout((seconds * 1000) / shots);
    await page.screenshot({ path: join(out, `speeltest-${size.name}-${i}.png`) });
  }
  const stats = await page.evaluate(() => {
    const w = globalThis.__luma.world;
    return { phase: globalThis.__luma.phase, score: w.score, captures: w.stats.captures, zone: w.zone };
  });
  const fps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => (++n < 60 ? requestAnimationFrame(tick) : resolve((n * 1000) / (performance.now() - t0)));
        requestAnimationFrame(tick);
      }),
  );
  report.push({ size: size.name, ...stats, fps: Math.round(fps) });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 2));
if (errors.length) {
  console.error("Fouten in de console:\n" + errors.join("\n"));
  process.exit(1);
}
