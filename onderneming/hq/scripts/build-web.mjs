// Bouwt het kantoor voor de browser: web/office → dist/public (office.js, office.css en de 3D-modellen).
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const out = "dist/public";
mkdirSync(out, { recursive: true });
await build({
  entryPoints: ["web/office/main.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2020",
  outfile: `${out}/office.js`,
  legalComments: "none",
  logLevel: "warning",
});
cpSync("web/office/office.css", `${out}/office.css`);
rmSync(`${out}/assets`, { recursive: true, force: true });
cpSync("web/assets", `${out}/assets`, { recursive: true });
console.log("kantoor gebouwd in dist/public");
