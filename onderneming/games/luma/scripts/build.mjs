// Bouwt LUMA tot één zelfstandig HTML-bestand: dist/luma.html (alles inline, werkt offline en als artifact).
// Gebruik: node scripts/build.mjs [--watch] [--dev]
import { build, context } from "esbuild";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");
const dev = process.argv.includes("--dev") || watch;

const options = {
  entryPoints: [join(root, "src/main.ts")],
  bundle: true,
  format: "iife",
  target: ["es2022"],
  minify: !dev,
  sourcemap: dev ? "inline" : false,
  write: false,
  legalComments: "none",
  define: { "process.env.NODE_ENV": dev ? '"development"' : '"production"' },
  loader: { ".css": "text", ".glsl": "text" },
  logLevel: "warning",
};

async function emit(result) {
  const js = result.outputFiles?.[0]?.text ?? "";
  const template = await readFile(join(root, "src/index.html"), "utf8");
  // Voorkom dat "</script" in de bundel de HTML afbreekt.
  const safe = js.replace(/<\/script/gi, "<\\/script");
  const html = template.replace("<!--LUMA_SCRIPT-->", () => `<script>${safe}</script>`);
  await mkdir(join(root, "dist"), { recursive: true });
  const out = join(root, "dist/luma.html");
  await writeFile(out, html);
  const { size } = await stat(out);
  console.log(`dist/luma.html  ${(size / 1024).toFixed(0)} KB`);

  // Versie voor een artifact op claude.ai: dat zet zelf doctype, head en body eromheen.
  const artifact = html
    .replace(/<!doctype html>\s*/i, "")
    .replace(/<html[^>]*>\s*/i, "")
    .replace(/<\/?head>\s*/gi, "")
    .replace(/<\/?body>\s*/gi, "")
    .replace(/<\/html>\s*/i, "")
    .replace(/<meta charset="utf-8">\s*/i, "")
    .replace(/<meta name="viewport"[^>]*>\s*/i, "");
  await writeFile(join(root, "dist/luma-artifact.html"), artifact);
}

if (watch) {
  const ctx = await context({
    ...options,
    plugins: [{ name: "emit", setup: (b) => b.onEnd((r) => (r.errors.length ? null : emit(r))) }],
  });
  await ctx.watch();
  console.log("watching…");
} else {
  await emit(await build(options));
}
