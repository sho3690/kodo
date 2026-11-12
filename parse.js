// Turns Apple Health's export.xml into small per-day numbers, reading the text in pieces as it streams by.
// Only the opening tags of Record / Workout / WorkoutStatistics / ActivitySummary are looked at.

const P = 'HKQuantityTypeIdentifier';
const TYPES = {
  [P + 'StepCount']: 'steps', [P + 'DistanceWalkingRunning']: 'dist', [P + 'FlightsClimbed']: 'flights',
  [P + 'HeartRate']: 'hr', [P + 'RestingHeartRate']: 'rhr', [P + 'WalkingHeartRateAverage']: 'whr',
  [P + 'HeartRateVariabilitySDNN']: 'hrv', [P + 'VO2Max']: 'vo2', [P + 'OxygenSaturation']: 'spo2',
  [P + 'RespiratoryRate']: 'resp', [P + 'AppleSleepingWristTemperature']: 'temp', [P + 'BodyMass']: 'weight',
  HKCategoryTypeIdentifierSleepAnalysis: 'sleep',
};
const HOURLY = { steps: 1, dist: 1, flights: 1 };
const MEAN = { rhr: 1, whr: 1, hrv: 1, vo2: 1, spo2: 1, resp: 1, temp: 1 };

// Rest of a tag after its name, up to the closing ">". A ">" inside a quoted value doesn't end the tag.
const TAG = /(?:[^>"]|"[^"]*")*>/y;

function attr(s, name) {
  const k = ' ' + name + '="';
  const i = s.indexOf(k);
  if (i < 0) return null;
  const st = i + k.length;
  return s.slice(st, s.indexOf('"', st));
}
// "2025-11-03 23:10:00 +0900" → ms of the wall-clock time (the offset is ignored on purpose: days follow the clock you lived by)
function wall(s) {
  return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16), +s.slice(17, 19));
}
const dayOf = ms => new Date(ms).toISOString().slice(0, 10);
const round = (v, d = 0) => { const f = 10 ** d; return Math.round(v * f) / f; };
const kcal = (v, unit) => (unit === 'kJ' ? v / 4.184 : v);
const km = (v, unit) => (unit === 'mi' ? v * 1.609344 : unit === 'm' ? v / 1000 : v);

export function createAggregator() {
  let carry = '';
  let records = 0;
  const days = new Map();                 // day → working numbers
  const hourly = { steps: new Map(), dist: new Map(), flights: new Map() };   // "YYYY-MM-DD HH" → { source: sum }
  const nights = new Map();               // day you woke up → { source: { deep, core, rem, unspec, awake, inBed, start, end } }
  const watch = new Map();                // source name → is it an Apple Watch?
  const rings = new Map();
  const workouts = [];
  let lastWorkout = null;

  const D = day => { let d = days.get(day); if (!d) days.set(day, d = {}); return d; };

  function record(a) {
    const k = TYPES[attr(a, 'type')];
    if (!k) return;
    const start = attr(a, 'startDate');
    if (!start || start.length < 19) return;
    records++;
    const day = start.slice(0, 10);

    if (k === 'sleep') {
      const end = attr(a, 'endDate'), val = attr(a, 'value') || '', src = attr(a, 'sourceName') || '';
      if (!end) return;
      const s = wall(start), e = wall(end), min = (e - s) / 60000;
      if (!(min > 0) || min > 24 * 60) return;
      const night = dayOf(s + 6 * 3600000);          // 18:00 and later counts toward the next morning
      let n = nights.get(night); if (!n) nights.set(night, n = {});
      const o = n[src] ||= { deep: 0, core: 0, rem: 0, unspec: 0, awake: 0, inBed: 0, start: null, end: null };
      const stage = val.endsWith('InBed') ? 'inBed' : val.endsWith('Awake') ? 'awake' : val.endsWith('Deep') ? 'deep'
        : val.endsWith('REM') ? 'rem' : val.endsWith('Core') ? 'core' : 'unspec';
      o[stage] += min;
      if (stage !== 'inBed' && stage !== 'awake') {
        const base = wall(night + ' 00:00:00');
        const sm = (s - base) / 60000, em = (e - base) / 60000;   // minutes from midnight of the wake-up day (negative = the evening before)
        if (o.start == null || sm < o.start) o.start = sm;
        if (o.end == null || em > o.end) o.end = em;
      }
      return;
    }

    let v = parseFloat(attr(a, 'value'));
    if (!Number.isFinite(v)) return;
    const unit = attr(a, 'unit');

    if (HOURLY[k]) {
      if (k === 'dist') v = km(v, unit);
      const key = start.slice(0, 13), src = attr(a, 'sourceName') || '';
      let h = hourly[k].get(key); if (!h) hourly[k].set(key, h = {});
      h[src] = (h[src] || 0) + v;
      return;
    }
    const d = D(day);
    if (k === 'hr') {
      const src = attr(a, 'sourceName') || '';
      if (!watch.has(src)) watch.set(src, /watch/i.test(src) || /Watch/.test(attr(a, 'device') || ''));
      if (d.hrN) { if (v < d.hrMin) d.hrMin = v; if (v > d.hrMax) d.hrMax = v; d.hrSum += v; d.hrN++; }
      else { d.hrMin = d.hrMax = d.hrSum = v; d.hrN = 1; }
      return;
    }
    if (k === 'weight') { d.weight = unit === 'lb' ? v * 0.45359237 : unit === 'g' ? v / 1000 : v; return; }
    if (k === 'spo2' && v <= 1) v *= 100;
    if (k === 'temp' && unit === 'degF') v = (v - 32) / 1.8;
    if (MEAN[k]) { d[k + 'S'] = (d[k + 'S'] || 0) + v; d[k + 'N'] = (d[k + 'N'] || 0) + 1; }
  }

  function workout(a) {
    const start = attr(a, 'startDate');
    if (!start || start.length < 19) { lastWorkout = null; return; }
    const unit = attr(a, 'durationUnit');
    let min = parseFloat(attr(a, 'duration'));
    if (!Number.isFinite(min)) min = (wall(attr(a, 'endDate') || start) - wall(start)) / 60000;
    else if (unit === 's') min /= 60; else if (unit === 'hr') min *= 60;
    const w = { d: start.slice(0, 10), t: start.slice(11, 16), type: (attr(a, 'workoutActivityType') || '').replace('HKWorkoutActivityType', '') || 'Other', min: round(min) };
    const e = parseFloat(attr(a, 'totalEnergyBurned')), dist = parseFloat(attr(a, 'totalDistance'));
    if (e > 0) w.kcal = round(kcal(e, attr(a, 'totalEnergyBurnedUnit')));
    if (dist > 0) w.km = round(km(dist, attr(a, 'totalDistanceUnit')), 2);
    workouts.push(lastWorkout = w);
  }

  function workoutStat(a) {
    const w = lastWorkout;
    if (!w) return;
    const type = attr(a, 'type') || '', unit = attr(a, 'unit');
    if (type.endsWith('ActiveEnergyBurned') && w.kcal == null) { const s = parseFloat(attr(a, 'sum')); if (s > 0) w.kcal = round(kcal(s, unit)); }
    else if (type.includes('Distance') && w.km == null) { const s = parseFloat(attr(a, 'sum')); if (s > 0) w.km = round(km(s, unit), 2); }
    else if (type.endsWith('HeartRate') && w.hr == null) { const s = parseFloat(attr(a, 'average')); if (s > 0) w.hr = round(s); }
  }

  function ring(a) {
    const day = attr(a, 'dateComponents');
    if (!day || day.length !== 10) return;
    const n = k => parseFloat(attr(a, k)) || 0;
    const unit = attr(a, 'activeEnergyBurnedUnit');
    const r = { move: kcal(n('activeEnergyBurned'), unit), moveGoal: kcal(n('activeEnergyBurnedGoal'), unit),
      ex: n('appleExerciseTime'), exGoal: n('appleExerciseTimeGoal'), stand: n('appleStandHours'), standGoal: n('appleStandHoursGoal') };
    if (r.move || r.ex || r.stand) rings.set(day, r);
  }

  function feed(chunk) {
    const text = carry ? carry + chunk : chunk;
    carry = '';
    let pos = 0, lastLt = -1;
    for (;;) {
      const i = text.indexOf('<', pos);
      if (i < 0) break;
      lastLt = i;
      const c = text.charCodeAt(i + 1);
      let kind = 0, len = 0;
      if (c === 82) { if (text.startsWith('Record ', i + 1)) { kind = 1; len = 7; } }
      else if (c === 87) {
        if (text.startsWith('Workout ', i + 1)) { kind = 2; len = 8; }
        else if (text.startsWith('WorkoutStatistics ', i + 1)) { kind = 3; len = 18; }
      } else if (c === 65) { if (text.startsWith('ActivitySummary ', i + 1)) { kind = 4; len = 16; } }
      if (!kind) { pos = i + 1; continue; }
      TAG.lastIndex = i + len;              // start on the space before the first attribute
      const m = TAG.exec(text);
      if (!m) { carry = text.slice(i); return; }     // tag continues in the next piece
      if (kind === 1) record(m[0]); else if (kind === 2) workout(m[0]); else if (kind === 3) workoutStat(m[0]); else ring(m[0]);
      pos = TAG.lastIndex;
    }
    // A tag (or just its name) may be cut off at the very end of this piece
    if (lastLt >= 0 && text.indexOf('>', lastLt) < 0 && text.length - lastLt < 1e6) carry = text.slice(lastLt);
  }

  function finish() {
    for (const k of Object.keys(hourly)) {
      for (const [key, srcs] of hourly[k]) {
        // The iPhone and the Watch both count the same steps. Per hour, keep the larger count instead of adding them.
        let best = 0;
        for (const s in srcs) if (srcs[s] > best) best = srcs[s];
        const d = D(key.slice(0, 10));
        d[k] = (d[k] || 0) + best;
      }
    }
    for (const [day, r] of rings) Object.assign(D(day), r);
    for (const [night, srcs] of nights) {
      let pick = null, score = -1;
      for (const name in srcs) {
        const o = srcs[name], asleep = o.deep + o.core + o.rem + o.unspec;
        // Prefer the Watch, then a source that records sleep stages, then whoever saw the most sleep
        const sc = (asleep > 0 ? 1 : 0) * ((watch.get(name) ? 1e7 : 0) + (o.deep + o.rem > 0 ? 1e5 : 0) + asleep) + o.inBed / 1e4;
        if (sc > score) { score = sc; pick = o; }
      }
      if (!pick) continue;
      const asleep = pick.deep + pick.core + pick.rem + pick.unspec;
      const total = asleep > 0 ? asleep : pick.inBed;
      if (total < 20) continue;
      const s = { total: round(total) };
      if (pick.deep + pick.rem > 0) { s.deep = round(pick.deep); s.core = round(pick.core + pick.unspec); s.rem = round(pick.rem); s.awake = round(pick.awake); }
      if (pick.start != null) { s.start = round(pick.start); s.end = round(pick.end); }
      D(night).sleep = s;
    }

    const out = {};
    const keys = [...days.keys()].filter(k => /^\d{4}-\d\d-\d\d$/.test(k)).sort();
    for (const day of keys) {
      const d = days.get(day), o = {};
      if (d.steps) o.steps = round(d.steps);
      if (d.dist) o.dist = round(d.dist, 2);
      if (d.flights) o.flights = round(d.flights);
      if (d.move != null) { o.move = round(d.move); o.moveGoal = round(d.moveGoal); o.ex = round(d.ex); o.exGoal = round(d.exGoal); o.stand = round(d.stand); o.standGoal = round(d.standGoal); }
      if (d.hrN) { o.hrMin = round(d.hrMin); o.hrMax = round(d.hrMax); o.hrAvg = round(d.hrSum / d.hrN); }
      for (const k in MEAN) if (d[k + 'N']) o[k] = round(d[k + 'S'] / d[k + 'N'], k === 'rhr' || k === 'whr' || k === 'hrv' ? 0 : k === 'temp' ? 2 : 1);
      if (d.weight) o.weight = round(d.weight, 1);
      if (d.sleep) o.sleep = d.sleep;
      if (Object.keys(o).length) out[day] = o;
    }
    const used = Object.keys(out);
    workouts.sort((a, b) => (a.d + a.t < b.d + b.t ? -1 : 1));
    return { v: 1, days: out, workouts, meta: { from: used[0] || null, to: used[used.length - 1] || null, records, imported: new Date().toISOString() } };
  }

  return { feed, finish, get records() { return records; } };
}
