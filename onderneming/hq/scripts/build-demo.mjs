// Bouwt het demo-kantoor als één losse HTML-pagina (dist/demo/kantoor-demo.html): code, opmaak en alle
// 3D-modellen zitten erin. Handig om te delen of offline te bekijken; het bedrijf erin is verzonnen.
// De modellen gaan ongecomprimeerd mee, zodat de pagina geen WebAssembly nodig heeft om ze uit te pakken.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { build } from "esbuild";
import { MeshoptDecoder } from "meshoptimizer";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = "dist/demo";
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
<title>KK Holding Kantoor</title>
<style>
${css}
</style>
<div id="app" data-mode="demo" data-assets="assets/">
  <div class="boot"><div class="boot-logo">🏢</div><p>Kantoor laden…</p><p class="boot-alt">Demo met een verzonnen bedrijf</p></div>
</div>
<script>window.HQ_ASSET_DATA = ${JSON.stringify(assets)};</script>
<script type="module">
${js}
</script>
`;
writeFileSync(join(out, "kantoor-demo.html"), html);
const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(`demo gebouwd: ${out}/kantoor-demo.html (${mb(Buffer.byteLength(html))} MB, modellen ${mb(raw)} MB)`);
