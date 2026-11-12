// KODO: shows what your Apple Watch recorded, from a Health export read on this device.
import { loadData, saveData, clearData } from './store.js';
import { makeSample } from './sample.js';
import { mountCharts, disposeCharts } from './charts.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 86400000;
const toMs = day => Date.parse(day + 'T12:00:00Z');
const addDays = (day, n) => new Date(toMs(day) + n * DAY).toISOString().slice(0, 10);
const fmtD = (day, o) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...o }).format(toMs(day));
const nf = (v, d = 0) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const dur = min => { const m = Math.round(min); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
const clock = min => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const mean = a => { let s = 0, n = 0; for (const v of a) if (v != null) { s += v; n++; } return n ? s / n : null; };
const rnd = (v, d = 0) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const typeName = t => t.replace(/([a-z])([A-Z])/g, '$1 $2');

const VIEWS = ['summary', 'activity', 'heart', 'sleep', 'body', 'data'];
const RANGES = [['30', '30D'], ['90', '90D'], ['365', '1Y'], ['all', 'All']];
const state = { data: null, view: 'summary', range: '90', importing: false, error: null, confirmDelete: false };

// ───────── data helpers ─────────
const val = (day, f) => { const d = state.data.days[day]; if (!d) return null; const v = f(d); return v == null || Number.isNaN(v) ? null : v; };
function span(to, n) { const a = []; for (let i = n - 1; i >= 0; i--) a.push(addDays(to, -i)); return a; }

function context() {
  const { from, to } = state.data.meta;
  let start = state.range === 'all' ? from : addDays(to, -(+state.range - 1));
  if (start < from) start = from;
  const list = [];
  for (let d = start; d <= to; d = addDays(d, 1)) list.push(d);
  const mode = state.range === '365' ? 'week' : state.range !== 'all' || list.length <= 120 ? 'day' : list.length <= 800 ? 'week' : 'month';
  let buckets;
  if (mode === 'day') {
    buckets = list.map(d => ({ cat: fmtD(d, { month: 'numeric', day: 'numeric' }), tip: fmtD(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }), days: [d] }));
  } else if (mode === 'week') {
    buckets = [];
    for (let e = list.length; e > 0; e -= 7) {
      const ds = list.slice(Math.max(0, e - 7), e);
      buckets.unshift({ cat: fmtD(ds[0], { month: 'numeric', day: 'numeric' }), tip: `${fmtD(ds[0], { month: 'short', day: 'numeric' })} – ${fmtD(ds[ds.length - 1], { month: 'short', day: 'numeric', year: 'numeric' })}`, days: ds });
    }
  } else {
    const by = new Map();
    for (const d of list) { const k = d.slice(0, 7); if (!by.has(k)) by.set(k, []); by.get(k).push(d); }
    buckets = [...by.values()].map(ds => ({ cat: fmtD(ds[0], { month: 'short', year: '2-digit' }), tip: fmtD(ds[0], { month: 'long', year: 'numeric' }), days: ds }));
  }
  return { list, buckets, mode, start, to };
}

// ───────── chart cards ─────────
let specs = [];
// o: { id, title, kind, series: [{ name, c, get }], digits, fmt, axisFmt, mark, total, stats(daily) → [[label, html]], legend }
function chartCard(ctx, o) {
  const daily = o.series.map(s => ctx.list.map(d => val(d, s.get)));
  if (!daily[0].some(v => v != null)) return '';
  const series = o.series.map(s => ({ name: s.name, c: s.c, data: ctx.buckets.map(b => rnd(mean(b.days.map(d => val(d, s.get))), o.digits ?? 0)) }));
  specs.push({ id: 'ch-' + o.id, kind: o.kind, cats: ctx.buckets.map(b => b.cat), tips: ctx.buckets.map(b => b.tip), series, fmt: o.fmt, axisFmt: o.axisFmt, mark: o.mark, total: o.total, steps: o.steps });
  const stats = (o.stats?.(daily) || []).filter(Boolean);
  const note = ctx.mode === 'week' ? 'Weekly averages' : ctx.mode === 'month' ? 'Monthly averages' : 'Daily';
  return `<section class="card">
    <div class="card-head"><h2>${esc(o.title)}</h2><p class="card-note">${note}</p></div>
    ${stats.length ? `<dl class="stats">${stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="num">${v}</dd></div>`).join('')}</dl>` : ''}
    <div class="chart" id="ch-${o.id}" role="img" aria-label="${esc(o.title)} chart"></div>
    ${o.legend ? `<div class="legend">${o.series.map(s => `<span><i class="sw-${s.c || 'c1'}"></i>${esc(s.name)}</span>`).join('')}</div>` : ''}
  </section>`;
}
const u = (v, unit) => `${v}<small> ${unit}</small>`;
const lo = a => { const x = a.filter(v => v != null); return x.length ? Math.min(...x) : null; };
const hi = a => { const x = a.filter(v => v != null); return x.length ? Math.max(...x) : null; };
const lastOf = a => { for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; };

function rangeHead(title) {
  return `<div class="view-head"><h1>${title}</h1>
    <div class="range" role="group" aria-label="Period">${RANGES.map(([k, l]) => `<button type="button" data-range="${k}" aria-pressed="${state.range === k}">${l}</button>`).join('')}</div></div>`;
}
const body = (cards, what) => (cards.join('').trim() ? `<div class="stack two">${cards.join('')}</div>` : `<p class="empty">No ${what} data in this period. Try a longer period.</p>`);

// ───────── views ─────────
function ringsSvg(d) {
  const R = [[70, 'r1', d.move, d.moveGoal], [54, 'r2', d.ex, d.exGoal], [38, 'r3', d.stand, d.standGoal]];
  const pct = (v, g) => (g > 0 ? Math.round((v / g) * 100) : 0);
  const label = `Move ${pct(d.move, d.moveGoal)}%, Exercise ${pct(d.ex, d.exGoal)}%, Stand ${pct(d.stand, d.standGoal)}%`;
  return `<svg class="rings" viewBox="0 0 160 160" role="img" aria-label="${label}"><g transform="rotate(-90 80 80)">${R.map(([r, cls, v, g]) => {
    const c = 2 * Math.PI * r, p = g > 0 ? Math.min(1, v / g) : 0;
    return `<circle class="track" cx="80" cy="80" r="${r}"/>${p > 0.005 ? `<circle class="${cls}" cx="80" cy="80" r="${r}" stroke-dasharray="${(p * c).toFixed(1)} ${c.toFixed(1)}"/>` : ''}`;
  }).join('')}</g></svg>`;
}

function spark(values) {
  const pts = values.map((v, i) => [i, v]).filter(p => p[1] != null);
  if (pts.length < 2) return '<svg class="spark" aria-hidden="true"></svg>';
  const a = Math.min(...pts.map(p => p[1])), b = Math.max(...pts.map(p => p[1])), w = values.length - 1;
  const y = v => (b === a ? 14 : 25 - ((v - a) / (b - a)) * 22);
  return `<svg class="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.map(p => `${((p[0] / w) * 100).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')}"/></svg>`;
}

function workoutRows(list) {
  return `<ul class="rows">${list.map(w => `<li><span class="row-main">${esc(typeName(w.type))}<span class="row-sub">${fmtD(w.d, { weekday: 'short', month: 'short', day: 'numeric' })} · ${esc(w.t)}</span></span>
    <span class="row-nums num">${[`${nf(w.min)} min`, w.kcal ? `${nf(w.kcal)} kcal` : '', w.km ? `${nf(w.km, 1)} km` : '', w.hr ? `${w.hr} bpm` : ''].filter(Boolean).join(' · ')}</span></li>`).join('')}</ul>`;
}

function viewSummary() {
  const { days, meta, workouts } = state.data;
  const to = meta.to;
  let ringDay = null;
  for (let i = 0; i < 7 && !ringDay; i++) { const d = addDays(to, -i); if (days[d]?.move != null) ringDay = d; }
  const last7 = span(to, 7), prev28 = span(addDays(to, -7), 28), last14 = span(to, 14);
  const closed = last7.filter(d => { const x = days[d]; return x && x.moveGoal > 0 && x.move >= x.moveGoal && x.ex >= x.exGoal && x.stand >= x.standGoal; }).length;
  const lede = ringDay ? `You closed all three rings on ${closed} of the last 7 days.` : 'Your last 7 days, compared with the 4 weeks before.';

  const tile = (href, label, f, show, diff) => {
    const now = mean(last7.map(d => val(d, f))), before = mean(prev28.map(d => val(d, f)));
    if (now == null) return '';
    let delta = 'No earlier data to compare';
    if (before != null) { const t = diff(now, before); delta = t ? `${t} vs prior 4 weeks` : 'Same as prior 4 weeks'; }
    return `<a class="card tile" href="#/${href}"><span class="tile-label">${label}</span><span class="tile-value num">${show(now)}</span><span class="tile-delta">${delta}</span>${spark(last14.map(d => val(d, f)))}</a>`;
  };
  const arrow = (d, text) => (d === 0 ? '' : `${d > 0 ? '↑' : '↓'} ${text}`);
  const tiles = [
    tile('activity', 'Steps', d => d.steps, v => nf(v), (a, b) => { const p = Math.round(((a - b) / b) * 100); return arrow(p, `${Math.abs(p)}%`); }),
    tile('heart', 'Resting heart rate', d => d.rhr, v => u(nf(v), 'bpm'), (a, b) => { const p = Math.round(a - b); return arrow(p, `${Math.abs(p)} bpm`); }),
    tile('heart', 'HRV', d => d.hrv, v => u(nf(v), 'ms'), (a, b) => { const p = Math.round(a - b); return arrow(p, `${Math.abs(p)} ms`); }),
    tile('sleep', 'Sleep', d => d.sleep?.total, v => dur(v), (a, b) => { const p = Math.round(a - b); return arrow(p, `${Math.abs(p)} min`); }),
  ].join('');

  const d = ringDay && days[ringDay];
  const hero = d ? `<section class="card hero" aria-label="Activity rings">
      ${ringsSvg(d)}
      <div class="ring-rows">
        <div class="ring-row lead"><i class="dot r1"></i><span class="ring-label">Move</span><span class="ring-value num">${nf(d.move)}<small> / ${nf(d.moveGoal)} kcal</small></span></div>
        <div class="ring-row"><i class="dot r2"></i><span class="ring-label">Exercise</span><span class="ring-value num">${nf(d.ex)}<small> / ${nf(d.exGoal)} min</small></span></div>
        <div class="ring-row"><i class="dot r3"></i><span class="ring-label">Stand</span><span class="ring-value num">${nf(d.stand)}<small> / ${nf(d.standGoal)} hr</small></span></div>
      </div>
    </section>` : '';
  const recent = workouts.slice(-5).reverse();
  return `<h1>${fmtD(ringDay || to, { weekday: 'long', month: 'long', day: 'numeric' })}</h1>
    <p class="sub">Latest day in your data</p>
    ${hero}
    <h2 class="section-title">Last 7 days</h2>
    <p class="lede">${lede}</p>
    <div class="tiles">${tiles}</div>
    ${recent.length ? `<h2 class="section-title">Recent workouts</h2><section class="card stack">${workoutRows(recent)}</section>` : ''}`;
}

function viewActivity() {
  const ctx = context();
  const goalStats = (v, g) => daily => {
    const n = ctx.list.filter(d => val(d, x => x[v]) != null).length;
    const met = ctx.list.filter(d => { const x = state.data.days[d]; return x && x[g] > 0 && x[v] >= x[g]; }).length;
    return [['Daily average', nf(mean(daily[0]))], n ? ['Goal met', `${met}<small> of ${n} days</small>`] : null];
  };
  const goal = g => lastOf(ctx.list.map(d => val(d, x => x[g] || null)));
  const cards = [
    chartCard(ctx, { id: 'steps', title: 'Steps', kind: 'bar', series: [{ name: 'Steps', get: d => d.steps }], fmt: v => nf(v),
      stats: a => [['Daily average', nf(mean(a[0]))], ['Best day', nf(hi(a[0]))]] }),
    chartCard(ctx, { id: 'move', title: 'Move', kind: 'bar', series: [{ name: 'Active energy', c: 'c2', get: d => d.move }], fmt: v => `${nf(v)} kcal`,
      mark: { value: goal('moveGoal'), name: 'Goal' }, stats: goalStats('move', 'moveGoal') }),
    chartCard(ctx, { id: 'ex', title: 'Exercise', kind: 'bar', series: [{ name: 'Exercise', get: d => d.ex }], fmt: v => `${nf(v)} min`,
      mark: { value: goal('exGoal'), name: 'Goal' }, stats: goalStats('ex', 'exGoal') }),
    chartCard(ctx, { id: 'stand', title: 'Stand', kind: 'bar', series: [{ name: 'Stand hours', c: 'c3', get: d => d.stand }], digits: 1, fmt: v => `${nf(v, v % 1 ? 1 : 0)} hr`,
      mark: { value: goal('standGoal'), name: 'Goal' }, stats: goalStats('stand', 'standGoal') }),
    chartCard(ctx, { id: 'dist', title: 'Walking + running distance', kind: 'bar', series: [{ name: 'Distance', get: d => d.dist }], digits: 1, fmt: v => `${nf(v, 1)} km`,
      stats: a => [['Daily average', u(nf(mean(a[0]), 1), 'km')], ['Total', u(nf(a[0].reduce((s, v) => s + (v || 0), 0)), 'km')]] }),
  ];
  const ws = state.data.workouts.filter(w => w.d >= ctx.start && w.d <= ctx.to);
  let wHtml = '';
  if (ws.length) {
    const by = new Map();
    for (const w of ws) { const o = by.get(w.type) || { n: 0, min: 0, kcal: 0 }; o.n++; o.min += w.min; o.kcal += w.kcal || 0; by.set(w.type, o); }
    const top = [...by].sort((a, b) => b[1].min - a[1].min).slice(0, 6);
    wHtml = `<h2 class="section-title">Workouts</h2>
      <div class="stack two">
        <section class="card"><h2>By type</h2><table><thead><tr><th scope="col">Type</th><th scope="col">Sessions</th><th scope="col">Time</th><th scope="col">Energy</th></tr></thead>
          <tbody>${top.map(([t, o]) => `<tr><th scope="row">${esc(typeName(t))}</th><td class="num">${o.n}</td><td class="num">${dur(o.min)}</td><td class="num">${o.kcal ? nf(o.kcal) + ' kcal' : '—'}</td></tr>`).join('')}</tbody></table></section>
        <section class="card"><h2>Most recent</h2>${workoutRows(ws.slice(-6).reverse())}</section>
      </div>`;
  }
  return rangeHead('Activity') + body(cards, 'activity') + wHtml;
}

function viewHeart() {
  const ctx = context();
  const bpm = v => `${nf(v)} bpm`;
  const cards = [
    chartCard(ctx, { id: 'rhr', title: 'Resting heart rate', kind: 'line', series: [{ name: 'Resting', get: d => d.rhr }], fmt: bpm,
      stats: a => [['Average', u(nf(mean(a[0])), 'bpm')], ['Range', `${lo(a[0])}–${hi(a[0])}`]] }),
    chartCard(ctx, { id: 'hrv', title: 'Heart rate variability', kind: 'line', series: [{ name: 'HRV', get: d => d.hrv }], fmt: v => `${nf(v)} ms`,
      stats: a => [['Average', u(nf(mean(a[0])), 'ms')], ['Range', `${lo(a[0])}–${hi(a[0])}`]] }),
    chartCard(ctx, { id: 'hr', title: 'Heart rate range', kind: 'band', series: [{ name: 'Lowest', c: 'c3', get: d => d.hrMin }, { name: 'Highest', c: 'c3', get: d => d.hrMax }, { name: 'Average', get: d => d.hrAvg }], fmt: bpm,
      stats: a => [['Average', u(nf(mean(a[2])), 'bpm')], ['Lowest', lo(a[0])], ['Highest', hi(a[1])]] }),
    chartCard(ctx, { id: 'whr', title: 'Walking heart rate', kind: 'line', series: [{ name: 'Walking average', get: d => d.whr }], fmt: bpm,
      stats: a => [['Average', u(nf(mean(a[0])), 'bpm')]] }),
    chartCard(ctx, { id: 'vo2', title: 'Cardio fitness (VO₂ max)', kind: 'line', series: [{ name: 'VO₂ max', get: d => d.vo2 }], digits: 1, fmt: v => nf(v, 1),
      stats: a => [['Latest', nf(lastOf(a[0]), 1)], ['Average', nf(mean(a[0]), 1)]] }),
  ];
  return rangeHead('Heart') + body(cards, 'heart');
}

function viewSleep() {
  const ctx = context();
  const staged = ctx.list.some(d => val(d, x => x.sleep?.deep) != null);
  const h = v => dur(v * 60);
  const sleepCard = staged
    ? chartCard(ctx, { id: 'sleep', title: 'Time asleep', kind: 'stack', legend: true, digits: 2, fmt: h, axisFmt: v => `${v}h`, total: 'Asleep',
      series: [{ name: 'Deep', c: 'c2', get: d => (d.sleep ? (d.sleep.deep ?? 0) / 60 : null) }, { name: 'Core', c: 'c1', get: d => (d.sleep ? (d.sleep.core ?? d.sleep.total) / 60 : null) }, { name: 'REM', c: 'c3', get: d => (d.sleep ? (d.sleep.rem ?? 0) / 60 : null) }],
      stats: () => { const t = ctx.list.map(d => val(d, x => x.sleep?.total)); return [['Nightly average', dur(mean(t))], ['Deep', dur(mean(ctx.list.map(d => val(d, x => x.sleep?.deep))) || 0)], ['REM', dur(mean(ctx.list.map(d => val(d, x => x.sleep?.rem))) || 0)]]; } })
    : chartCard(ctx, { id: 'sleep', title: 'Time asleep', kind: 'bar', digits: 2, fmt: h, axisFmt: v => `${v}h`, series: [{ name: 'Asleep', get: d => (d.sleep ? d.sleep.total / 60 : null) }],
      stats: a => [['Nightly average', dur(mean(a[0]) * 60)], ['Longest', dur(hi(a[0]) * 60)]] });
  const cards = [
    sleepCard,
    chartCard(ctx, { id: 'awake', title: 'Awake during the night', kind: 'bar', series: [{ name: 'Awake', c: 'c4', get: d => d.sleep?.awake }], fmt: v => `${nf(v)} min`,
      stats: a => [['Nightly average', u(nf(mean(a[0])), 'min')]] }),
    chartCard(ctx, { id: 'bed', title: 'Fell asleep', kind: 'line', series: [{ name: 'Fell asleep', get: d => d.sleep?.start }], fmt: clock, axisFmt: clock, steps: [15, 30, 60, 120, 180, 360],
      stats: a => [['Average', clock(mean(a[0]))], ['Earliest', clock(lo(a[0]))], ['Latest', clock(hi(a[0]))]] }),
    chartCard(ctx, { id: 'wake', title: 'Woke up', kind: 'line', series: [{ name: 'Woke up', c: 'c2', get: d => d.sleep?.end }], fmt: clock, axisFmt: clock, steps: [15, 30, 60, 120, 180, 360],
      stats: a => [['Average', clock(mean(a[0]))], ['Earliest', clock(lo(a[0]))], ['Latest', clock(hi(a[0]))]] }),
  ];
  return rangeHead('Sleep') + body(cards, 'sleep');
}

function viewBody() {
  const ctx = context();
  const cards = [
    chartCard(ctx, { id: 'spo2', title: 'Blood oxygen', kind: 'line', series: [{ name: 'Blood oxygen', get: d => d.spo2 }], digits: 1, fmt: v => `${nf(v, 1)}%`, axisFmt: v => `${v}%`,
      stats: a => [['Average', `${nf(mean(a[0]), 1)}<small> %</small>`], ['Lowest day', `${nf(lo(a[0]), 1)}%`]] }),
    chartCard(ctx, { id: 'resp', title: 'Respiratory rate', kind: 'line', series: [{ name: 'Breaths', get: d => d.resp }], digits: 1, fmt: v => `${nf(v, 1)} /min`,
      stats: a => [['Average', u(nf(mean(a[0]), 1), '/min')], ['Range', `${nf(lo(a[0]), 1)}–${nf(hi(a[0]), 1)}`]] }),
    chartCard(ctx, { id: 'temp', title: 'Wrist temperature while asleep', kind: 'line', series: [{ name: 'Wrist temperature', c: 'c2', get: d => d.temp }], digits: 2, fmt: v => `${nf(v, 2)} °C`,
      stats: a => [['Average', u(nf(mean(a[0]), 2), '°C')], ['Range', `${nf(lo(a[0]), 2)}–${nf(hi(a[0]), 2)}`]] }),
    chartCard(ctx, { id: 'weight', title: 'Weight', kind: 'line', series: [{ name: 'Weight', get: d => d.weight }], digits: 1, fmt: v => `${nf(v, 1)} kg`,
      stats: a => { const x = a[0].filter(v => v != null); const ch = x[x.length - 1] - x[0]; return [['Latest', u(nf(x[x.length - 1], 1), 'kg')], x.length > 1 ? ['Change', `${ch > 0 ? '+' : ch < 0 ? '−' : ''}${nf(Math.abs(ch), 1)} kg`] : null]; } }),
  ];
  return rangeHead('Body') + body(cards, 'body');
}

const HOWTO = `<ol class="steps">
  <li><span>On your iPhone, open <b>Health</b> (ヘルスケア) and tap your profile picture at the top right.</span></li>
  <li><span>Tap <b>Export All Health Data</b> (すべてのヘルスケアデータを書き出す). This can take a few minutes.</span></li>
  <li><span>Choose <b>Save to Files</b> (“ファイル”に保存).</span></li>
  <li><span>Come back to this page and choose that <b>export.zip</b>.</span></li>
</ol>`;
const ERRORS = {
  'no-export': 'This ZIP doesn’t contain a Health export. Choose the export.zip made by the Health app.',
  empty: 'No Apple Health records were found in this file. Choose the export.zip made by the Health app.',
  'not-zip': 'This file couldn’t be opened. Export again from the Health app and choose the new export.zip.',
  'zip-method': 'This file couldn’t be opened. Export again from the Health app and choose the new export.zip.',
  save: 'The import worked, but this browser refused to store it. Turn off Private Browsing and import again.',
};
const errorHtml = () => (state.error ? `<p class="alert" role="alert">${ERRORS[state.error] || 'The import stopped before finishing. Close other tabs to free up memory, then try again.'}</p>` : '');

function viewIntro() {
  return `<div class="intro">
    <h1>Your Apple Watch data, in one place.</h1>
    <p class="lede">KODO reads the export from the Health app and charts your activity, heart, sleep and body trends.</p>
    ${errorHtml()}
    ${HOWTO}
    <div class="btn-row"><button type="button" class="btn btn-primary" data-act="pick">Choose export file</button><button type="button" class="btn btn-secondary" data-act="sample">Try with sample data</button></div>
    <p class="fine">The file is read in this browser, on this device. Nothing is uploaded, and there is no account.</p>
  </div>`;
}

function viewImporting() {
  return `<div class="intro"><h1>Reading your export</h1>
    <p class="lede">Keep this page open. A few years of data can take a few minutes.</p>
    <progress id="prog" max="1" value="0" aria-label="Import progress"></progress>
    <p class="progress-text num" id="prog-text" aria-live="polite">Starting…</p></div>`;
}

function viewData() {
  const { meta, days, workouts } = state.data;
  const n = Object.keys(days).length;
  return `<h1>Your data</h1>
    ${errorHtml()}
    <section class="card stack"><h2>On this device</h2><dl class="facts">
      <dt>Source</dt><dd>${meta.sample ? 'Sample data (made up)' : 'Apple Health export'}</dd>
      <dt>Period</dt><dd>${fmtD(meta.from, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmtD(meta.to, { month: 'short', day: 'numeric', year: 'numeric' })}</dd>
      <dt>Days</dt><dd class="num">${nf(n)}</dd>
      <dt>Workouts</dt><dd class="num">${nf(workouts.length)}</dd>
      ${meta.sample ? '' : `<dt>Records read</dt><dd class="num">${nf(meta.records)}</dd><dt>Imported</dt><dd>${new Date(meta.imported).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</dd>`}
    </dl></section>
    <h2 class="section-title">${meta.sample ? 'Import your own data' : 'Update with a new export'}</h2>
    <p class="sub">Each export contains your full history, so a new import replaces what is stored here.</p>
    ${HOWTO}
    <div class="btn-row"><button type="button" class="btn btn-primary" data-act="pick">Choose export file</button></div>
    <h2 class="section-title">Remove</h2>
    <p class="sub">Deletes the numbers stored in this browser. Your Health app is not affected.</p>
    <div class="btn-row">${state.confirmDelete
      ? '<button type="button" class="btn btn-danger" data-act="delete-yes">Yes, delete from this device</button><button type="button" class="btn btn-secondary" data-act="delete-no">Keep data</button>'
      : '<button type="button" class="btn btn-danger" data-act="delete">Delete data from this device</button>'}</div>`;
}

// ───────── render ─────────
function render({ animate = true } = {}) {
  const has = !!state.data && !state.importing;
  $('#tabs').hidden = !has; $('#data-link').hidden = !has; $('#foot').hidden = false;
  for (const a of document.querySelectorAll('#tabs a')) a.dataset.view === state.view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  specs = [];
  let html;
  if (state.importing) html = viewImporting();
  else if (!state.data) html = viewIntro();
  else {
    const banner = state.data.meta.sample && state.view !== 'data' ? '<p class="notice"><span>Sample data. These numbers are made up.</span><a href="#/data">Import your own</a></p>' : '';
    html = banner + ({ summary: viewSummary, activity: viewActivity, heart: viewHeart, sleep: viewSleep, body: viewBody, data: viewData }[state.view])();
  }
  disposeCharts();
  $('#main').innerHTML = html;
  for (const s of specs) s.el = document.getElementById(s.id);
  mountCharts(specs, { first: animate });
}

function route() {
  const v = location.hash.replace(/^#\/?/, '');
  state.view = VIEWS.includes(v) ? v : 'summary';
  state.confirmDelete = false;
  if (state.view !== 'data') state.error = null;
  render();
  window.scrollTo(0, 0);
}

// ───────── import ─────────
function importInWorker(file, onProgress) {
  return new Promise((resolve, reject) => {
    let w;
    const fallback = () => { w?.terminate(); import('./importer.js').then(m => m.runImport(file, onProgress)).then(resolve, reject); };
    try { w = new Worker('./worker.js', { type: 'module' }); } catch { return fallback(); }
    let started = false;
    w.onmessage = e => {
      started = true;
      if (e.data.type === 'progress') onProgress(e.data);
      else if (e.data.type === 'done') { w.terminate(); resolve(e.data.data); }
      else { w.terminate(); reject(new Error(e.data.code)); }
    };
    w.onerror = e => { e.preventDefault?.(); if (started) { w.terminate(); reject(new Error('worker')); } else fallback(); };
    w.postMessage({ file });
  });
}

async function startImport(file) {
  state.importing = true; state.error = null;
  render();
  try {
    const data = await importInWorker(file, p => {
      const bar = $('#prog'), text = $('#prog-text');
      if (bar) bar.value = p.ratio;
      if (text) text.textContent = `${Math.round(p.ratio * 100)}% · ${nf(p.records)} records`;
    });
    state.data = data;
    try { await saveData(data); } catch { state.error = 'save'; }
    state.importing = false;
    if (state.error) { state.view = 'data'; render(); }
    else if (location.hash === '#/summary') route(); else location.hash = '#/summary';
  } catch (err) {
    state.importing = false; state.error = String(err?.message || 'unknown');
    render();
  }
}

document.addEventListener('click', async e => {
  const r = e.target.closest('[data-range]');
  if (r) { state.range = r.dataset.range; try { localStorage.setItem('kodo-range', state.range); } catch { /* fine without */ } render({ animate: false }); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'pick') $('#file').click();
  else if (act === 'sample') { state.data = makeSample(); try { await saveData(state.data); } catch { /* shown for this visit only */ } location.hash === '#/summary' ? route() : (location.hash = '#/summary'); }
  else if (act === 'delete') { state.confirmDelete = true; render(); }
  else if (act === 'delete-no') { state.confirmDelete = false; render(); }
  else if (act === 'delete-yes') { try { await clearData(); } catch { /* nothing stored */ } state.data = null; state.confirmDelete = false; location.hash === '#/summary' ? route() : (location.hash = '#/summary'); }
});
$('#file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) startImport(f); });
addEventListener('hashchange', route);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render({ animate: false }));

try { const r = localStorage.getItem('kodo-range'); if (RANGES.some(x => x[0] === r)) state.range = r; } catch { /* default */ }
state.data = await loadData();
if (state.data && (state.data.v !== 1 || !state.data.meta?.to)) state.data = null;
route();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
