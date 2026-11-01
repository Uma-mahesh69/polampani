// Small, dependency-free SVG charts: single-series bars with hover tooltips and a table view.
// Thin marks, 4px rounded data-ends anchored to the baseline, 2px gaps, recessive grid.
import { esc } from './core.js';

function roundedTop(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
function roundedRight(x, y, w, h, r = 4) {
  if (w <= 0) return '';
  const rr = Math.min(r, h / 2, w);
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
}
const niceMax = (v) => {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
};

// Horizontal bars: [{label, value, tip}]
export function hbars(data, { width = 560, row = 30, labelW = 170 } = {}) {
  const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
  const plotW = width - labelW - 44;
  const height = data.length * row + 8;
  const bars = data.map((d, i) => {
    const y = i * row + 6;
    const w = Math.max(2, (d.value / max) * plotW);
    return `<g class="bar-g" data-tip="${esc(d.tip || `${d.label}: ${d.value}`)}">
      <text class="axis-label" x="${labelW - 10}" y="${y + row / 2 - 1}" text-anchor="end" dominant-baseline="middle" fill="currentColor" font-size="13">${esc(d.label)}</text>
      <path class="bar" d="${roundedRight(labelW, y + 4, w, row - 12)}"/>
      <text class="bar-label" x="${labelW + w + 6}" y="${y + row / 2 - 1}" dominant-baseline="middle">${esc(d.display ?? d.value)}</text>
      <rect class="bar-hit" x="0" y="${y}" width="${width}" height="${row - 2}"/>
    </g>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img">${bars}</svg>`;
}

// Vertical bars over time: [{label, value, tip}]
export function vbars(data, { width = 560, height = 200, showEvery = 2 } = {}) {
  const pad = { l: 28, r: 6, t: 10, b: 26 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
  const step = plotW / data.length;
  const bw = Math.max(4, step - 2 - Math.min(10, step * 0.3));
  const ticks = [0, max / 2, max];
  const grid = ticks.map((v) => {
    const y = pad.t + plotH - (v / max) * plotH;
    return `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y}" y2="${y}"/><text x="${pad.l - 6}" y="${y}" text-anchor="end" dominant-baseline="middle">${Math.round(v)}</text>`;
  }).join('');
  const bars = data.map((d, i) => {
    const h = (d.value / max) * plotH;
    const x = pad.l + i * step + (step - bw) / 2;
    const y = pad.t + plotH - h;
    return `<g class="bar-g" data-tip="${esc(d.tip || `${d.label}: ${d.value}`)}">
      <path class="bar" d="${roundedTop(x, y, bw, h)}"/>
      <rect class="bar-hit" x="${pad.l + i * step}" y="${pad.t}" width="${step}" height="${plotH}"/>
      ${i % showEvery === data.length % showEvery ? '' : `<text x="${x + bw / 2}" y="${height - 6}" text-anchor="middle">${esc(d.label)}</text>`}
    </g>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img"><g class="grid axis">${grid}</g><g class="axis">${bars}</g></svg>`;
}

// Wire up hover/focus tooltips for every chart inside root.
export function bindTooltips(root) {
  root.querySelectorAll('.chart').forEach((chart) => {
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    chart.appendChild(tip);
    const svg = chart.querySelector('svg');
    const groups = chart.querySelectorAll('.bar-g');
    groups.forEach((g) => {
      g.setAttribute('tabindex', '0');
      const show = () => {
        const bar = g.querySelector('.bar').getBoundingClientRect();
        const box = chart.getBoundingClientRect();
        tip.textContent = g.dataset.tip;
        tip.style.left = `${bar.left - box.left + bar.width / 2}px`;
        tip.style.top = `${bar.top - box.top}px`;
        tip.classList.add('show');
        svg.classList.add('dim');
        groups.forEach((o) => o.classList.toggle('dim', o !== g));
      };
      const hide = () => { tip.classList.remove('show'); groups.forEach((o) => o.classList.remove('dim')); };
      g.addEventListener('mouseenter', show);
      g.addEventListener('focus', show);
      g.addEventListener('mouseleave', hide);
      g.addEventListener('blur', hide);
    });
  });
}

export function table(headers, rows) {
  return `<table class="chart-table"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
