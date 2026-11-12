import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAggregator } from '../parse.js';
import { runImport } from '../importer.js';
import { makeSample } from '../sample.js';

const Q = 'HKQuantityTypeIdentifier';
const WATCH = 'device="&lt;&lt;HKDevice: 0x1&gt;, name:Apple Watch, manufacturer:Apple Inc., model:Watch, hardware:Watch6,1&gt;"';
const rec = (type, start, end, value, unit, src = 'My Watch', extra = '') =>
  ` <Record type="${type}" sourceName="${src}" sourceVersion="10.1" ${extra} unit="${unit}" creationDate="${end} +0900" startDate="${start} +0900" endDate="${end} +0900" value="${value}"/>\n`;
const sleep = (stage, start, end, src = 'My Watch') =>
  ` <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="${src}" startDate="${start} +0900" endDate="${end} +0900" value="HKCategoryValueSleepAnalysis${stage}"/>\n`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
<!ELEMENT Record ((MetadataEntry|HeartRateVariabilityMetadataList)*)>
<!ATTLIST Record type CDATA #REQUIRED>
]>
<HealthData locale="ja_JP">
 <ExportDate value="2025-11-04 08:00:00 +0900"/>
${rec(Q + 'HeartRate', '2025-11-03 08:00:00', '2025-11-03 08:00:00', 62, 'count/min', 'My Watch', WATCH)}
${rec(Q + 'HeartRate', '2025-11-03 12:00:00', '2025-11-03 12:00:00', 140, 'count/min', 'My Watch', WATCH)}
${rec(Q + 'HeartRate', '2025-11-03 23:00:00', '2025-11-03 23:00:00', 50, 'count/min', 'My Watch', WATCH)}
${rec(Q + 'StepCount', '2025-11-03 09:05:00', '2025-11-03 09:15:00', 500, 'count', 'iPhone')}
${rec(Q + 'StepCount', '2025-11-03 09:06:00', '2025-11-03 09:16:00', 620, 'count')}
${rec(Q + 'StepCount', '2025-11-03 10:06:00', '2025-11-03 10:16:00', 300, 'count', 'iPhone')}
${rec(Q + 'DistanceWalkingRunning', '2025-11-03 09:06:00', '2025-11-03 09:16:00', 1, 'mi')}
${rec(Q + 'RestingHeartRate', '2025-11-03 00:00:00', '2025-11-03 23:59:00', 55, 'count/min')}
 <Record type="${Q}HeartRateVariabilitySDNN" sourceName="My Watch" unit="ms" startDate="2025-11-03 03:00:00 +0900" endDate="2025-11-03 03:01:00 +0900" value="48.6">
  <HeartRateVariabilityMetadataList><InstantaneousBeatsPerMinute bpm="60" time="3:00:00.00"/></HeartRateVariabilityMetadataList>
  <MetadataEntry key="a > b" value="x"/>
 </Record>
${rec(Q + 'HeartRateVariabilitySDNN', '2025-11-03 04:00:00', '2025-11-03 04:01:00', 51.4, 'ms')}
${rec(Q + 'OxygenSaturation', '2025-11-03 04:00:00', '2025-11-03 04:01:00', 0.97, '%')}
${rec(Q + 'BodyMass', '2025-11-03 07:00:00', '2025-11-03 07:00:00', 150, 'lb', 'Scale')}
${rec(Q + 'DietaryWater', '2025-11-03 07:00:00', '2025-11-03 07:00:00', 1, 'L')}
${sleep('InBed', '2025-11-02 23:00:00', '2025-11-03 07:00:00', 'iPhone')}
${sleep('AsleepCore', '2025-11-02 23:30:00', '2025-11-03 02:30:00')}
${sleep('AsleepDeep', '2025-11-03 02:30:00', '2025-11-03 03:30:00')}
${sleep('Awake', '2025-11-03 03:30:00', '2025-11-03 03:40:00')}
${sleep('AsleepREM', '2025-11-03 03:40:00', '2025-11-03 05:10:00')}
${sleep('AsleepCore', '2025-11-03 05:10:00', '2025-11-03 06:40:00')}
${sleep('AsleepUnspecified', '2025-11-02 23:00:00', '2025-11-03 08:00:00', 'Other App')}
 <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30.5" durationUnit="min" sourceName="My Watch" startDate="2025-11-03 18:30:00 +0900" endDate="2025-11-03 19:00:30 +0900">
  <WorkoutEvent type="HKWorkoutEventTypePause" date="2025-11-03 18:40:00 +0900"/>
  <WorkoutStatistics type="${Q}ActiveEnergyBurned" startDate="2025-11-03 18:30:00 +0900" endDate="2025-11-03 19:00:30 +0900" sum="310.4" unit="Cal"/>
  <WorkoutStatistics type="${Q}DistanceWalkingRunning" startDate="2025-11-03 18:30:00 +0900" endDate="2025-11-03 19:00:30 +0900" sum="5.02" unit="km"/>
  <WorkoutStatistics type="${Q}HeartRate" startDate="2025-11-03 18:30:00 +0900" endDate="2025-11-03 19:00:30 +0900" average="151.6" minimum="110" maximum="170" unit="count/min"/>
 </Workout>
 <ActivitySummary dateComponents="2025-11-02" activeEnergyBurned="0" activeEnergyBurnedGoal="0" activeEnergyBurnedUnit="Cal" appleExerciseTime="0" appleExerciseTimeGoal="30" appleStandHours="0" appleStandHoursGoal="12"/>
 <ActivitySummary dateComponents="2025-11-03" activeEnergyBurned="512.3" activeEnergyBurnedGoal="500" activeEnergyBurnedUnit="Cal" appleMoveTime="0" appleExerciseTime="41" appleExerciseTimeGoal="30" appleStandHours="11" appleStandHoursGoal="12"/>
</HealthData>
`;

function check(data) {
  const d = data.days['2025-11-03'];
  assert.equal(d.steps, 920, 'iPhone and Watch steps in the same hour are not added together');
  assert.equal(d.dist, 1.61);
  assert.deepEqual([d.hrMin, d.hrMax, d.hrAvg], [50, 140, 84]);
  assert.equal(d.rhr, 55);
  assert.equal(d.hrv, 50);
  assert.equal(d.spo2, 97);
  assert.equal(d.weight, 68);
  assert.deepEqual([d.move, d.moveGoal, d.ex, d.stand], [512, 500, 41, 11]);
  assert.deepEqual(d.sleep, { total: 420, deep: 60, core: 270, rem: 90, awake: 10, start: -30, end: 400 }, 'the Watch is chosen over other sleep sources');
  assert.equal(data.days['2025-11-02'], undefined, 'empty ring days are skipped');
  assert.deepEqual(data.workouts, [{ d: '2025-11-03', t: '18:30', type: 'Running', min: 31, kcal: 310, km: 5.02, hr: 152 }]);
  assert.deepEqual([data.meta.from, data.meta.to], ['2025-11-03', '2025-11-03']);
}

test('gives the same result however the text is cut into pieces', () => {
  for (const size of [1, 7, 64, 1000, XML.length]) {
    const a = createAggregator();
    for (let i = 0; i < XML.length; i += size) a.feed(XML.slice(i, i + size));
    check(a.finish());
  }
});

test('reads export.zip with a localized file name, and a bare export.xml', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kodo-'));
  mkdirSync(join(dir, 'apple_health_export'));
  writeFileSync(join(dir, 'apple_health_export', '書き出したデータ.xml'), XML);
  writeFileSync(join(dir, 'apple_health_export', 'export_cda.xml'), '<ClinicalDocument>' + 'x'.repeat(XML.length * 3) + '</ClinicalDocument>');
  execFileSync('zip', ['-q', '-r', 'export.zip', 'apple_health_export'], { cwd: dir });
  let last = 0;
  check(await runImport(new Blob([readFileSync(join(dir, 'export.zip'))]), p => { last = p.ratio; }));
  assert.equal(last, 1);
  check(await runImport(new Blob([XML])));
});

test('refuses files that are not a Health export', async () => {
  await assert.rejects(runImport(new Blob(['hello, this is not health data'])), /empty/);
  const dir = mkdtempSync(join(tmpdir(), 'kodo-'));
  writeFileSync(join(dir, 'a.txt'), 'x');
  execFileSync('zip', ['-q', 'a.zip', 'a.txt'], { cwd: dir });
  await assert.rejects(runImport(new Blob([readFileSync(join(dir, 'a.zip'))])), /no-export/);
});

test('sample data has the same shape as an import', () => {
  const s = makeSample(new Date(2026, 10, 13));
  assert.equal(Object.keys(s.days).length, 420);
  assert.equal(s.meta.to, '2026-11-12');
  assert.ok(s.workouts.length > 100);
});
