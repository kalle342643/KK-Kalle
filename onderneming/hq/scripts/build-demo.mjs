// Bouwt het kantoor als één losse HTML-pagina: code, opmaak en alle 3D-modellen zitten erin. De modellen gaan
// ongecomprimeerd mee, zodat de pagina geen WebAssembly nodig heeft om ze uit te pakken.
//   node scripts/build-demo.mjs          → dist/demo/kantoor-demo.html: het demo-kantoor (verzonnen bedrijf)
//   node scripts/build-demo.mjs kantoor  → dist/kantoor/kantoor.html: je echte kantoor als artifact op claude.ai,
//                                          live op je Claude-account (via de connector Claude Code Remote)
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { build } from "esbuild";
import { MeshoptDecoder } from "meshoptimizer";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const account = process.argv[2] === "kantoor";
const out = account ? "dist/kantoor" : "dist/demo";
const file = account ? "kantoor.html" : "kantoor-demo.html";
mkdirSync(out, { recursive: true });

const bundle = await build({
  entryPoints: ["web/office/main.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2020",
  write: false,
  legalComments: "none",
  logLevel: "warning",
});
// "</script" in de code zou het script-blok te vroeg afsluiten.
const js = bundle.outputFiles[0].text.replaceAll("</script", "<\\/script");

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const assets = {};
let raw = 0;
for (const dir of ["characters", "furniture"]) {
  for (const file of readdirSync(join("web/assets", dir)).filter((f) => f.endsWith(".glb"))) {
    const doc = await io.read(join("web/assets", dir, file));
    for (const ext of doc.getRoot().listExtensionsUsed()) {
      if (ext.extensionName === "EXT_meshopt_compression") ext.dispose();
    }
    const bytes = await io.writeBinary(doc);
    raw += bytes.byteLength;
    assets[`${dir}/${file}`] = Buffer.from(bytes).toString("base64");
  }
}

const css = readFileSync("web/office/office.css", "utf8");
const html = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${account ? "KK Kantoor" : "KK Holding Kantoor"}</title>
<style>
${css}
</style>
<div id="app" data-mode="${account ? "account" : "demo"}" data-assets="assets/">
  <div class="boot"><div class="boot-logo">🏢</div><p>Kantoor laden…</p><p class="boot-alt">${account ? "Live: wat je Claude-account doet" : "Demo met een verzonnen bedrijf"}</p></div>
</div>
<script>window.HQ_ASSET_DATA = ${JSON.stringify(assets)};</script>
<script type="module">
${js}
</script>
`;
writeFileSync(join(out, file), html);
const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(`${account ? "kantoor" : "demo"} gebouwd: ${out}/${file} (${mb(Buffer.byteLength(html))} MB, modellen ${mb(raw)} MB)`);
