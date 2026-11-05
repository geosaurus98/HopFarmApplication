import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../../app/js/logic.js';

test('requiredLeaves matches the spec examples and rules', () => {
  assert.equal(L.requiredLeaves(3.38), 50);
  assert.equal(L.requiredLeaves(7.84), 75);
  assert.equal(L.requiredLeaves(11.77), 115);
  for (let h = 1; h <= 5000; h++) {
    assert.equal(L.requiredLeaves(h / 100), Math.max(50, Math.floor(h / 50) * 5), String(h / 100));
  }
  for (const bad of [0, -1, '', null, undefined, NaN, 'abc']) assert.equal(L.requiredLeaves(bad), null);
});

test('season and week', () => {
  assert.equal(L.seasonOf('2026-06-30'), '2025/26');
  assert.equal(L.seasonOf('2026-07-01'), '2026/27');
  assert.equal(L.seasonOf('1999-12-31'), '1999/00');
  assert.equal(L.seasonOf('bad'), '');
  assert.equal(L.weekStarting('2026-11-05'), '2026-11-02');
  assert.equal(L.weekStarting('2027-01-01'), '2026-12-28');
  assert.equal(L.todayLocal(new Date(2026, 0, 9)), '2026-01-09');
});

test('nextLeafNumber uses highest existing + 1 and ignores deleted leaves', () => {
  assert.equal(L.nextLeafNumber([]), 1);
  assert.equal(L.nextLeafNumber([{ LeafNumber: 1 }, { LeafNumber: 2 }]), 3);
  assert.equal(L.nextLeafNumber([{ LeafNumber: 1 }, { LeafNumber: 5 }]), 6); // gap after a deletion
  assert.equal(L.nextLeafNumber([{ LeafNumber: 1 }, { LeafNumber: 2, Deleted: true }]), 2);
  assert.equal(L.nextLeafNumber([{ LeafNumber: '12' }]), 13);
});

test('progress: remaining never below zero, over-target allowed', () => {
  const s = { TargetLeafCount: 75 };
  const leaves = (n) => Array.from({ length: n }, (_, i) => ({ LeafNumber: i + 1 }));
  assert.deepEqual(L.progress(s, leaves(47)), { target: 75, analysed: 47, remaining: 28, pct: 47 / 75, reached: false });
  assert.equal(Math.round(L.progress(s, leaves(47)).pct * 1000) / 10, 62.7); // spec §7.1 example
  assert.equal(L.progress(s, leaves(80)).remaining, 0);
  assert.equal(L.progress(s, leaves(75)).reached, true);
});

test('counts: zero valid, blank / negative / decimal rejected', () => {
  assert.deepEqual(L.parseCount('0'), { value: 0 });
  assert.deepEqual(L.parseCount(' 250 '), { value: 250 });
  assert.equal(L.parseCount('').error, 'required');
  assert.equal(L.parseCount('-1').error, 'negative');
  assert.equal(L.parseCount('1.5').error, 'whole');
  const leaf = { LeafAnalysisID: 'a', LeafNumber: 2, TetranychusCount: '0', PhytoseiulusCount: '0', TwoSpotEggCount: '0', PredatorEggCount: '0', OtherBeneficialCount: '0' };
  assert.deepEqual(L.validateLeaf(leaf, []), {});
  assert.ok(L.validateLeaf({ ...leaf, PhytoseiulusCount: '' }).PhytoseiulusCount);
  assert.ok(L.validateLeaf(leaf, [{ LeafAnalysisID: 'b', LeafNumber: 2 }]).LeafNumber);
  assert.deepEqual(L.validateLeaf(leaf, [{ LeafAnalysisID: 'b', LeafNumber: 2, Deleted: true }]), {});
  assert.deepEqual(L.highCounts({ ...leaf, TetranychusCount: 101 }).map((f) => f.short), ['TwoSM']);
});

test('sample validation and duplicate bag warning', () => {
  const ok = { SampleNumber: '1042', CollectionDate: '2026-11-03', BlockVarietyID: 'A1', AreaHaAtCollection: 7.84 };
  assert.deepEqual(L.validateSample(ok, '2026-11-05'), {});
  assert.ok(L.validateSample({ ...ok, SampleNumber: '' }, '2026-11-05').SampleNumber);
  assert.ok(L.validateSample({ ...ok, SampleNumber: '1.5' }, '2026-11-05').SampleNumber);
  assert.ok(L.validateSample({ ...ok, CollectionDate: '2026-11-06' }, '2026-11-05').CollectionDate);
  assert.ok(L.validateSample({ ...ok, BlockVarietyID: '' }, '2026-11-05').BlockVarietyID);
  const others = [
    { SampleID: 'x', SampleNumber: 1042, CollectionDate: '2026-09-01', Status: 'Analysis Complete' },
    { SampleID: 'y', SampleNumber: 1042, CollectionDate: '2025-09-01', Status: 'Analysis Complete' }, // other season
    { SampleID: 'z', SampleNumber: 1042, CollectionDate: '2026-10-01', Status: 'Cancelled' },
  ];
  assert.deepEqual(L.duplicateBags({ SampleNumber: '1042', CollectionDate: '2026-11-03' }, others).map((s) => s.SampleID), ['x']);
  assert.deepEqual(L.duplicateBags({ SampleID: 'x', SampleNumber: '1042', CollectionDate: '2026-11-03' }, others), []);
});

test('summary, export rows and CSV escaping', () => {
  const samples = [
    { SampleID: 's1', SampleNumber: 5, CollectionDate: '2026-11-03', Block: 'A1', Variety: 'Cascade', TargetLeafCount: 50, Status: 'Analysis Complete', CollectorEmail: 'c@x', SampleComments: 'windy, "dry"', SamplePhoto1: 'local:abc' },
    { SampleID: 's2', SampleNumber: 6, CollectionDate: '2026-11-04', Block: 'A1', Variety: 'Cascade', TargetLeafCount: 50, Status: 'Cancelled' },
  ];
  const leaves = [
    { SampleID: 's1', LeafNumber: 2, TetranychusCount: 4, PhytoseiulusCount: 1, TwoSpotEggCount: 3, PredatorEggCount: 0, OtherBeneficialCount: 0, AnalystEmail: 'a@x' },
    { SampleID: 's1', LeafNumber: 1, TetranychusCount: 0, PhytoseiulusCount: 1, TwoSpotEggCount: 0, PredatorEggCount: 1, OtherBeneficialCount: 0, AnalystEmail: 'a@x' },
    { SampleID: 's1', LeafNumber: 3, TetranychusCount: 99, PhytoseiulusCount: 0, TwoSpotEggCount: 0, PredatorEggCount: 0, OtherBeneficialCount: 0, Deleted: true },
    { SampleID: 's2', LeafNumber: 1, TetranychusCount: 1, PhytoseiulusCount: 0, TwoSpotEggCount: 0, PredatorEggCount: 0, OtherBeneficialCount: 0 },
  ];
  const sum = L.sampleSummary(samples[0], leaves.filter((l) => l.SampleID === 's1'));
  assert.equal(sum.LeavesAnalysed, 2);
  assert.equal(sum.TotalTwoSM, 4);
  assert.equal(sum.AvgTwoSMPerLeaf, 2);
  assert.equal(sum.PredatorToPestRatio, 0.5);
  assert.equal(sum.PctLeavesWithTwoSM, 0.5);
  assert.equal(L.sampleSummary({}, []).PredatorToPestRatio, null);

  const names = (e) => ({ 'c@x': 'Cole', 'a@x': 'Lee' }[e] || e);
  const rows = L.leafExportRows(samples, leaves, names);
  assert.equal(rows.length, 2);
  const r0 = Object.fromEntries(L.LEAF_EXPORT_HEADERS.map((h, i) => [h, rows[0][i]]));
  assert.equal(r0.LeafNumber, 1);
  assert.equal(r0.Collector, 'Cole');
  assert.equal(r0.Season, '2026/27');
  assert.equal(r0.WeekStarting, '2026-11-02');
  assert.equal(r0.SamplePhoto1, '(not yet uploaded)');
  const csv = L.toCSV(L.LEAF_EXPORT_HEADERS, rows);
  assert.match(csv, /"windy, ""dry"""/);
  assert.equal(csv.split('\r\n').length, 4);
  assert.equal(L.summaryRows(samples, L.groupBy(leaves, 'SampleID')).length, 1);
});

test('trend points: per sample, sorted by date, filtered by block and season', () => {
  const samples = [
    { SampleID: 'b', BlockVarietyID: 'A1', CollectionDate: '2026-11-10', Status: 'Analysis Complete' },
    { SampleID: 'a', BlockVarietyID: 'A1', CollectionDate: '2026-11-03', Status: 'Analysis Complete' },
    { SampleID: 'c', BlockVarietyID: 'K2', CollectionDate: '2026-11-03', Status: 'Analysis Complete' },
    { SampleID: 'd', BlockVarietyID: 'A1', CollectionDate: '2025-11-03', Status: 'Analysis Complete' },
    { SampleID: 'e', BlockVarietyID: 'A1', CollectionDate: '2026-11-12', Status: 'Awaiting Analysis' }, // no leaves
  ];
  const leaves = L.groupBy([
    { SampleID: 'a', TetranychusCount: 2 }, { SampleID: 'a', TetranychusCount: 4 },
    { SampleID: 'b', TetranychusCount: 10 }, { SampleID: 'c', TetranychusCount: 1 }, { SampleID: 'd', TetranychusCount: 1 },
  ], 'SampleID');
  const pts = L.trendPoints(samples, leaves, 'A1', 'AvgTwoSMPerLeaf', '2026/27');
  assert.deepEqual(pts.map((p) => [p.date, p.value]), [['2026-11-03', 3], ['2026-11-10', 10]]);
  assert.equal(L.trendPoints(samples, leaves, 'A1', 'AvgTwoSMPerLeaf').length, 3);
});

test('permissions by role and status', () => {
  const aw = { Status: 'Awaiting Analysis', CollectorEmail: 'c@x' };
  const ip = { Status: 'Analysis In Progress', CollectorEmail: 'c@x' };
  const done = { Status: 'Analysis Complete', CollectorEmail: 'c@x' };
  assert.equal(L.can('Collector', 'startAnalysis', aw), false);
  assert.equal(L.can('Analyst', 'startAnalysis', aw), true);
  assert.equal(L.can('Analyst', 'completeAnalysis', ip), true);
  assert.equal(L.can('Analyst', 'editLeaves', done), false);
  assert.equal(L.can('Administrator', 'editLeaves', done), true);
  assert.equal(L.can('Collector', 'editSample', aw, 'c@x'), true);
  assert.equal(L.can('Collector', 'editSample', aw, 'other@x'), false);
  assert.equal(L.can('Collector', 'cancelSample', aw, 'c@x'), true);
  assert.equal(L.can('Collector', 'cancelSample', ip, 'c@x'), false);
  assert.equal(L.can('Analyst', 'changeBlock', ip), false);
  assert.equal(L.can('Administrator', 'reopen', done), true);
  assert.equal(L.can('Analyst', 'reopen', done), false);
  assert.equal(L.can('Collector', 'export'), false);
});
