// Made-up numbers, so the app can be tried before importing anything. Same shape as a real import.
function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function makeSample(today = new Date()) {
  const r = rng(20261113);
  const g = () => (r() + r() + r() - 1.5) / 1.5;          // roughly bell-shaped, -1..1
  const N = 420;
  const end = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - 86400000;
  const days = {}, workouts = [];
  const kinds = [['Running', 34, 9.5, 5.6, 152], ['TraditionalStrengthTraining', 45, 5.5, 0, 118], ['Walking', 40, 4.2, 3.4, 104], ['Cycling', 52, 7.5, 16, 138], ['Yoga', 30, 2.6, 0, 92]];
  for (let i = 0; i < N; i++) {
    const ms = end - (N - 1 - i) * 86400000;
    const day = new Date(ms).toISOString().slice(0, 10);
    const dow = new Date(ms).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const fit = i / N;                                      // slowly getting fitter over the period
    const wave = Math.sin(i / 23);
    const active = 1 + 0.18 * g() + (weekend ? 0.12 : 0) + 0.06 * wave;
    const o = {};
    o.steps = Math.round(7600 * active + 900 * g());
    o.dist = Math.round(o.steps * 0.00072 * 100) / 100;
    o.flights = Math.max(0, Math.round(9 + 6 * g()));
    o.move = Math.round(470 * active + 40 * g()); o.moveGoal = i > 200 ? 520 : 480;
    o.ex = Math.max(2, Math.round(34 * active + 14 * g())); o.exGoal = 30;
    o.stand = Math.max(5, Math.min(16, Math.round(11.5 + 2.4 * g()))); o.standGoal = 12;
    const rhr = 60 - 4 * fit + 1.6 * g() - 0.8 * wave;
    o.rhr = Math.round(rhr);
    o.hrMin = Math.round(rhr - 7 + 2 * g()); o.hrMax = Math.round(128 + 30 * Math.abs(g()) + (o.ex > 40 ? 18 : 0)); o.hrAvg = Math.round(rhr + 13 + 3 * g());
    o.whr = Math.round(101 - 3 * fit + 3 * g());
    o.hrv = Math.round(44 + 9 * fit + 7 * g() + 3 * wave);
    o.spo2 = Math.round((97.1 + 0.9 * g()) * 10) / 10;
    o.resp = Math.round((14.6 + 0.7 * g()) * 10) / 10;
    o.temp = Math.round((35.72 + 0.22 * g()) * 100) / 100;
    if (i % 6 === 0) o.vo2 = Math.round((40.8 + 2.6 * fit + 0.5 * g()) * 10) / 10;
    if (i % 3 === 0) o.weight = Math.round((68.4 - 1.9 * fit + 0.35 * g()) * 10) / 10;
    const total = Math.round(418 + 46 * g() + (weekend ? 28 : 0));
    const deep = Math.round(total * (0.15 + 0.03 * g())), rem = Math.round(total * (0.22 + 0.04 * g()));
    const awake = Math.max(4, Math.round(22 + 12 * g()));
    const start = Math.round(-25 + 38 * g() + (weekend ? 30 : 0));
    o.sleep = { total, deep, rem, core: total - deep - rem, awake, start, end: start + total + awake };
    days[day] = o;
    const p = weekend ? 0.7 : 0.52;
    if (r() < p) {
      const k = kinds[Math.floor(r() * kinds.length)];
      const min = Math.max(12, Math.round(k[1] * (1 + 0.25 * g())));
      const w = { d: day, t: `${String(weekend ? 9 + Math.floor(r() * 6) : 18 + Math.floor(r() * 3)).padStart(2, '0')}:${String(Math.floor(r() * 6) * 10).padStart(2, '0')}`, type: k[0], min, kcal: Math.round(min * k[2]), hr: Math.round(k[4] + 6 * g()) };
      if (k[3]) w.km = Math.round((k[3] * min / k[1]) * 100) / 100;
      workouts.push(w);
    }
  }
  const keys = Object.keys(days);
  return { v: 1, days, workouts, meta: { from: keys[0], to: keys[keys.length - 1], records: 0, imported: new Date().toISOString(), sample: true } };
}
