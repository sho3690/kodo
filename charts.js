// Charts, drawn with ECharts in the evilcharts manner: 0.8px lines, a fill that fades downward,
// dashed horizontal grid only, dot ticks, and a hand-built tooltip with monospaced numbers.
// ECharts (1.1 MB) is loaded the first time a chart is needed.

let loading = null;
function loadECharts() {
  if (globalThis.echarts) return Promise.resolve(globalThis.echarts);
  return (loading ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = './vendor/echarts.min.js';
    s.onload = () => res(globalThis.echarts);
    s.onerror = () => { loading = null; s.remove(); rej(new Error('echarts')); };
    document.head.append(s);
  }));
}

const live = new Set();
let ro = null;
export function disposeCharts() { for (const c of live) c.dispose(); live.clear(); }

function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue(n).trim();
  return { bg: v('--color-surface'), muted: v('--color-text-muted'), border: v('--color-border'), c1: v('--c1'), c2: v('--c2'), c3: v('--c3'), c4: v('--c4') };
}
function withAlpha(color, a) {
  const m = color.match(/^#([0-9a-f]{6})$/i);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Picks an axis range and tick step so there are at most 4 even steps. steps: allowed step sizes (e.g. minutes for clock axes).
function niceBounds(vals, fromZero, steps) {
  if (!vals.length) return [undefined, undefined, undefined];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (fromZero) lo = Math.min(0, lo);
  const span = hi - lo || Math.abs(hi) * 0.2 || 1;
  if (!fromZero) lo -= span * 0.1;
  hi += span * 0.05;
  const fix = v => +v.toPrecision(12);
  const base = 10 ** Math.floor(Math.log10(span));
  const cands = steps || [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10].map(m => fix(m * base));
  for (const step of cands) {
    const a = Math.floor(fix(lo / step)), b = Math.ceil(fix(hi / step));
    if (b - a <= 4) return [fix(a * step), fix(b * step), step];
  }
  const step = cands[cands.length - 1];
  return [fix(Math.floor(lo / step) * step), fix(Math.ceil(hi / step) * step), undefined];
}

// spec: { el, kind: 'bar' | 'line' | 'stack' | 'band', cats, tips, series: [{ name, data, c }], fmt, axisFmt, mark: { value, name }, total, steps }
//   band: series = [low, high, average]
function option(echarts, s, t, animate) {
  const n = s.cats.length, few = n <= 14;
  const col = x => t[x.c || 'c1'];
  const mark = s.mark && s.mark.value != null
    ? { markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: t.muted, width: 0.8, type: [3, 3] }, data: [{ yAxis: s.mark.value }] } } : {};
  const anim = { animationDuration: animate ? 1000 : 0, animationEasing: 'cubicOut' };
  const barAnim = { animationDuration: animate ? 500 : 0, animationEasing: 'cubicOut', animationDelay: i => (animate ? i * (few ? 50 : Math.min(8, 400 / n)) : 0) };
  const line = (x, extra = {}) => {
    const filled = x.data.filter(v => v != null).length;
    const dots = few || filled <= 40;
    return { type: 'line', name: x.name, data: x.data, connectNulls: true, lineStyle: { width: 0.8, color: col(x) }, itemStyle: { color: col(x) },
      symbol: 'circle', symbolSize: dots ? 4 : 3, showSymbol: dots, showAllSymbol: dots,
      emphasis: { focus: 'none' }, ...anim, ...extra };
  };
  let series, vals;
  if (s.kind === 'bar') {
    const x = s.series[0];
    series = [{ type: 'bar', name: x.name, data: x.data, barMaxWidth: 14, itemStyle: { color: col(x), borderRadius: [2, 2, 0, 0] }, ...mark, ...barAnim }];
    vals = x.data;
  } else if (s.kind === 'stack') {
    series = s.series.map((x, i) => ({ type: 'bar', stack: 'a', name: x.name, data: x.data, barMaxWidth: 14,
      itemStyle: { color: col(x), borderRadius: i === s.series.length - 1 ? [2, 2, 0, 0] : 0 }, ...(i ? {} : mark), ...barAnim }));
    vals = s.cats.map((_, i) => s.series.reduce((a, x) => a + (x.data[i] || 0), 0));
  } else if (s.kind === 'band') {
    const [lo, hi, avg] = s.series;
    series = [
      { type: 'line', stack: 'band', data: lo.data, connectNulls: true, lineStyle: { opacity: 0 }, symbol: 'none', silent: true, ...anim },
      { type: 'line', stack: 'band', data: hi.data.map((v, i) => (v == null || lo.data[i] == null ? null : v - lo.data[i])), connectNulls: true,
        lineStyle: { opacity: 0 }, symbol: 'none', silent: true, areaStyle: { color: withAlpha(col(avg), 0.14) }, ...anim },
      line(avg, mark),
    ];
    vals = [...lo.data, ...hi.data];
  } else {
    series = s.series.map((x, i) => line(x, i ? {} : {
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: withAlpha(col(x), 0.14) }, { offset: 1, color: withAlpha(col(x), 0) }]) }, ...mark }));
    vals = s.series.flatMap(x => x.data);
  }
  const fromZero = s.kind === 'bar' || s.kind === 'stack';
  const ext = vals.filter(v => v != null);
  if (s.mark?.value != null) ext.push(s.mark.value);
  const [yMin, yMax, yStep] = niceBounds(ext, fromZero, s.steps);
  return {
    animation: !!animate,
    grid: { left: 4, right: 16, top: 12, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category', data: s.cats, boundaryGap: fromZero,
      axisLine: { show: false },
      axisTick: { show: true, alignWithLabel: true, length: 0.5, interval: few ? 0 : 'auto', lineStyle: { color: t.border, width: 3, cap: 'round' } },
      splitLine: { show: false },
      axisLabel: { color: t.muted, fontSize: 10, margin: 8, hideOverlap: true },
    },
    yAxis: {
      type: 'value', splitNumber: 4, min: yMin, max: yMax, interval: yStep,
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { show: true, lineStyle: { color: t.border, type: [3, 3], width: 1 } },
      axisLabel: { color: t.muted, fontSize: 10, margin: 8, formatter: s.axisFmt || (v => v.toLocaleString('en-US')) },
    },
    tooltip: {
      trigger: 'axis', confine: true, backgroundColor: 'transparent', borderWidth: 0, padding: 0, extraCssText: 'box-shadow:none;',
      axisPointer: { type: fromZero ? 'shadow' : 'line', lineStyle: { color: t.border, width: 0.8, type: [3, 3] }, shadowStyle: { color: withAlpha(t.muted, 0.08) } },
      formatter(params) {
        const p = (Array.isArray(params) ? params : [params])[0];
        if (!p) return '';
        const i = p.dataIndex;
        const order = s.kind === 'band' ? [s.series[2], s.series[1], s.series[0]] : s.kind === 'stack' ? [...s.series].reverse() : s.series;
        const rows = order.map(x => `<div class="tt-row"><i class="tt-sw sw-${x.c || 'c1'}"></i><span>${esc(x.name)}</span><b>${x.data[i] == null ? '—' : esc(s.fmt(x.data[i]))}</b></div>`);
        if (s.total) rows.unshift(`<div class="tt-row"><i class="tt-sw sw-none"></i><span>${esc(s.total)}</span><b>${esc(s.fmt(vals[i]))}</b></div>`);
        if (s.mark?.value != null) rows.push(`<div class="tt-row"><i class="tt-sw sw-mark"></i><span>${esc(s.mark.name)}</span><b>${esc(s.fmt(s.mark.value))}</b></div>`);
        return `<div class="tt"><div class="tt-head">${esc(s.tips?.[i] ?? p.name)}</div>${rows.join('')}</div>`;
      },
    },
    series,
  };
}

// first=true plays the entrance animation; refreshes and theme changes are instant.
export async function mountCharts(specs, { first = false } = {}) {
  disposeCharts();
  if (!specs.length) return;
  let echarts;
  try { echarts = await loadECharts(); } catch {
    for (const s of specs) s.el.replaceChildren(Object.assign(document.createElement('p'), { className: 'chart-empty', textContent: 'Charts could not be loaded. Check your connection and reload.' }));
    return;
  }
  disposeCharts();
  const t = tokens();
  for (const s of specs) {
    if (!s.el.isConnected) continue;
    const c = echarts.init(s.el, null, { renderer: 'canvas' });
    c.setOption(option(echarts, s, t, first));
    live.add(c);
  }
  if (!ro && 'ResizeObserver' in globalThis) {
    let raf = 0;
    ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { for (const c of live) c.resize(); }); });
    ro.observe(document.documentElement);
  }
}
