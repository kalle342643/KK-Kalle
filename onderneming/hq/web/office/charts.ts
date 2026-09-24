/**
 * Kleine SVG-grafieken voor de panelen (lijn met kruisdraad en tooltip, staafjes per rij).
 * Kleuren komen uit CSS-variabelen (--series-1, --series-2) zodat licht en donker kloppen.
 * Namen en labels gaan altijd via textContent, nooit via innerHTML.
 */

const SVG = "http://www.w3.org/2000/svg";
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

export interface Series {
  name: string;
  /** CSS-kleur of var(--series-1) */
  color: string;
  values: number[];
}

let tip: HTMLDivElement | null = null;
function tooltip(): HTMLDivElement {
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  return tip;
}

function showTip(x: number, y: number, title: string, rows: Array<{ color: string; name: string; value: string }>): void {
  const t = tooltip();
  t.replaceChildren();
  const h = document.createElement("div");
  h.className = "tt-title";
  h.textContent = title;
  t.appendChild(h);
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "tt-row";
    const key = document.createElement("span");
    key.className = "tt-key";
    key.style.background = r.color;
    const v = document.createElement("b");
    v.textContent = r.value;
    const n = document.createElement("span");
    n.textContent = r.name;
    row.append(key, v, n);
    t.appendChild(row);
  }
  t.hidden = false;
  const rect = t.getBoundingClientRect();
  t.style.left = `${Math.min(window.innerWidth - rect.width - 8, x + 14)}px`;
  t.style.top = `${Math.max(8, y - rect.height - 10)}px`;
}

export function hideTip(): void {
  if (tip) tip.hidden = true;
}

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
};

/** Lijngrafiek met één as, een kruisdraad die naar de dichtstbijzijnde dag springt en een tooltip. */
export function lineChart(
  host: HTMLElement,
  labels: string[],
  series: Series[],
  opts: { format: (n: number) => string; height?: number; target?: number | null; ariaLabel: string },
): void {
  host.replaceChildren();
  const width = Math.max(260, host.clientWidth || 320);
  const height = opts.height ?? 170;
  const pad = { l: 44, r: 58, t: 10, b: 24 };
  const all = series.flatMap((s) => s.values).concat(opts.target ? [opts.target] : []);
  const max = niceMax(Math.max(1, ...all) * 1.05);
  const n = Math.max(1, labels.length - 1);
  const X = (k: number) => pad.l + ((width - pad.l - pad.r) * k) / n;
  const Y = (v: number) => pad.t + (height - pad.t - pad.b) * (1 - v / max);
  const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, width, height, role: "img", "aria-label": opts.ariaLabel, class: "chart" });
  for (let k = 0; k <= 3; k++) {
    const v = (max * k) / 3;
    root.appendChild(svg("line", { x1: pad.l, x2: width - pad.r, y1: Y(v), y2: Y(v), class: k ? "grid" : "axis" }));
    const t = svg("text", { x: pad.l - 6, y: Y(v) + 4, "text-anchor": "end", class: "tick" });
    t.textContent = opts.format(v);
    root.appendChild(t);
  }
  for (const k of [0, Math.floor(labels.length / 2), labels.length - 1]) {
    if (labels[k] === undefined) continue;
    const t = svg("text", { x: X(k), y: height - 6, "text-anchor": k === 0 ? "start" : k === labels.length - 1 ? "end" : "middle", class: "tick" });
    t.textContent = labels[k]!;
    root.appendChild(t);
  }
  if (opts.target) {
    root.appendChild(svg("line", { x1: pad.l, x2: width - pad.r, y1: Y(opts.target), y2: Y(opts.target), class: "target" }));
    const t = svg("text", { x: width - pad.r + 6, y: Y(opts.target) + 4, class: "tick" });
    t.textContent = `doel ${opts.format(opts.target)}`;
    root.appendChild(t);
  }
  for (const s of series) {
    const d = s.values.map((v, k) => `${k ? "L" : "M"}${X(k).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    root.appendChild(svg("path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    const last = s.values.length - 1;
    if (last >= 0) {
      root.appendChild(svg("circle", { cx: X(last), cy: Y(s.values[last]!), r: 4, fill: s.color, class: "end-dot" }));
      const t = svg("text", { x: X(last) + 8, y: Y(s.values[last]!) + 4, class: "direct" });
      t.textContent = opts.format(s.values[last]!);
      root.appendChild(t);
    }
  }
  const cross = svg("line", { y1: pad.t, y2: height - pad.b, class: "crosshair", visibility: "hidden" });
  root.appendChild(cross);
  const hit = svg("rect", { x: pad.l, y: 0, width: width - pad.l - pad.r, height, fill: "transparent", tabindex: 0 });
  const at = (clientX: number) => {
    const rect = root.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * width;
    return Math.max(0, Math.min(labels.length - 1, Math.round(((x - pad.l) / (width - pad.l - pad.r)) * n)));
  };
  const show = (k: number, cx: number, cy: number) => {
    cross.setAttribute("x1", String(X(k)));
    cross.setAttribute("x2", String(X(k)));
    cross.setAttribute("visibility", "visible");
    showTip(cx, cy, labels[k] ?? "", series.map((s) => ({ color: s.color, name: s.name, value: opts.format(s.values[k] ?? 0) })));
  };
  hit.addEventListener("pointermove", (ev) => show(at(ev.clientX), ev.clientX, ev.clientY));
  hit.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    hideTip();
  });
  hit.addEventListener("focus", () => {
    const r = root.getBoundingClientRect();
    show(labels.length - 1, r.right - 60, r.top + 20);
  });
  hit.addEventListener("blur", hideTip);
  root.appendChild(hit);
  host.appendChild(root);
  if (series.length >= 2) {
    const legend = document.createElement("div");
    legend.className = "legend";
    for (const s of series) {
      const item = document.createElement("span");
      const key = document.createElement("i");
      key.className = "line-key";
      key.style.background = s.color;
      item.append(key, document.createTextNode(s.name));
      legend.appendChild(item);
    }
    host.appendChild(legend);
  }
}

/** Per rij twee dunne staafjes (bv. omzet en kosten per tak), met tooltip per staaf. */
export function pairedBars(
  host: HTMLElement,
  rows: Array<{ label: string; values: number[] }>,
  series: Array<{ name: string; color: string }>,
  format: (n: number) => string,
): void {
  host.replaceChildren();
  const max = Math.max(1, ...rows.flatMap((r) => r.values));
  const legend = document.createElement("div");
  legend.className = "legend";
  for (const s of series) {
    const item = document.createElement("span");
    const key = document.createElement("i");
    key.className = "rect-key";
    key.style.background = s.color;
    item.append(key, document.createTextNode(s.name));
    legend.appendChild(item);
  }
  host.appendChild(legend);
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "bar-row";
    const label = document.createElement("div");
    label.className = "bar-label";
    label.textContent = r.label;
    row.appendChild(label);
    const bars = document.createElement("div");
    bars.className = "bars";
    r.values.forEach((v, k) => {
      const line = document.createElement("div");
      line.className = "bar-line";
      const bar = document.createElement("div");
      bar.className = "bar";
      bar.style.width = `${Math.max(v > 0 ? 2 : 0, (v / max) * 100)}%`;
      bar.style.background = series[k]!.color;
      bar.tabIndex = 0;
      const val = document.createElement("span");
      val.className = "bar-value";
      val.textContent = format(v);
      const tipFor = (ev: { clientX: number; clientY: number }) =>
        showTip(ev.clientX, ev.clientY, r.label, [{ color: series[k]!.color, name: series[k]!.name, value: format(v) }]);
      bar.addEventListener("pointermove", tipFor);
      bar.addEventListener("pointerleave", hideTip);
      bar.addEventListener("focus", () => {
        const b = bar.getBoundingClientRect();
        tipFor({ clientX: b.right, clientY: b.top });
      });
      bar.addEventListener("blur", hideTip);
      line.append(bar, val);
      bars.appendChild(line);
    });
    row.appendChild(bars);
    host.appendChild(row);
  }
}
