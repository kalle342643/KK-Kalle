/**
 * De HTML rond het kantoor. Alles wat je ziet wordt in de browser getekend door /static/office.js
 * (gebouwd uit web/office met `npm run build`).
 */
export function renderOfficePage(opts: { demo: boolean }): string {
  const title = opts.demo ? "Demo-kantoor" : "Kantoor";
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1b1f2a">
<title>${title} · HQ</title>
<link rel="stylesheet" href="/static/office.css">
</head>
<body>
<div id="app" data-mode="${opts.demo ? "demo" : "live"}">
  <div class="boot"><div class="boot-logo">🏢</div><p>Kantoor laden…</p><p class="boot-alt"><a href="/overzicht">Liever alleen de cijfers?</a></p></div>
</div>
<noscript><p style="padding:16px">Het kantoor heeft JavaScript nodig. <a href="/overzicht">Naar het overzicht</a>.</p></noscript>
<script type="module" src="/static/office.js"></script>
</body>
</html>`;
}
