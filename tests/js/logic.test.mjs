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
  assert.equal(L.localDateTime(new Date(2026, 10, 6, 14, 49, 22).toISOString()), '2026-11-06 14:49:22');
  assert.equal(L.localDateTime(''), '');
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
  const leaf = { LeafAnalysisID: 'a', LeafNumber: 2, ...Object.fromEntries(L.LEAF_INPUT_FIELDS.map((f) => [f.key, '0'])) };
  assert.deepEqual(L.validateLeaf(leaf, []), {});
  assert.ok(L.validateLeaf({ ...leaf, PhytoseiulusCount: '' }).PhytoseiulusCount);
  assert.ok(L.validateLeaf({ ...leaf, SpiderCount: '-1' }).SpiderCount);
  // Leaf screen values: 0 by default; an older leaf's single beneficial count lands on its type.
  assert.equal(L.leafFormValues(null).DeadTetranychusCount, 0);
  const oldLeaf = L.leafFormValues({ TetranychusCount: 3, OtherBeneficialCount: 2, OtherBeneficialDescription: 'Lacewing' });
  assert.deepEqual([oldLeaf.TetranychusCount, oldLeaf.LacewingCount, oldLeaf.BeneficialOtherCount], [3, 2, 0]);
  assert.equal(L.beneficialTotal({ LacewingCount: 2, SpiderCount: 1 }), 3);
  assert.ok(L.validateLeaf(leaf, [{ LeafAnalysisID: 'b', LeafNumber: 2 }]).LeafNumber);
  assert.deepEqual(L.validateLeaf(leaf, [{ LeafAnalysisID: 'b', LeafNumber: 2, Deleted: true }]), {});
  assert.deepEqual(L.highCounts({ ...leaf, TetranychusCount: 101 }).map((f) => f.short), ['2SM']);
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

test('help image links: Drive share links become direct images', () => {
  assert.equal(L.helpImageUrl('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing'), 'https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOp&sz=w1200');
  assert.equal(L.helpImageUrl('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp'), 'https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOp&sz=w1200');
  assert.equal(L.helpImageUrl('https://example.com/mite.jpg'), 'https://example.com/mite.jpg');
  assert.equal(L.helpImageUrl('http://insecure.example/x.jpg'), '');
  assert.equal(L.helpImageUrl(''), '');
});

test('permissions by level and status', () => {
  const now = Date.parse('2026-11-06T00:00:00Z');
  const aw = { Status: 'Awaiting Analysis', CollectorEmail: 'c@x' };
  const ip = { Status: 'Analysis In Progress', CollectorEmail: 'c@x' };
  const mine = { Status: 'Analysis Complete', CollectorEmail: 'c@x', AnalysisStartedBy: 'a@x', CompletedBy: 'a@x', AnalysisCompletedAt: '2026-10-10T00:00:00Z' };
  const old = { ...mine, AnalysisCompletedAt: '2026-10-01T00:00:00Z' };
  // Users collect and analyse.
  for (const a of ['createSample', 'analyse']) assert.equal(L.can('User', a), true, a);
  assert.equal(L.can('User', 'startAnalysis', aw), true);
  assert.equal(L.can('User', 'completeAnalysis', ip), true);
  assert.equal(L.can('User', 'editLeaves', ip), true);
  // ...reopen/correct only what they analysed, within 31 days.
  assert.equal(L.can('User', 'reopen', mine, 'a@x', now), true);
  assert.equal(L.can('User', 'editLeaves', mine, 'a@x', now), true);
  assert.equal(L.can('User', 'addLeaves', mine, 'a@x', now), false, 'reopen first');
  assert.equal(L.can('User', 'reopen', mine, 'someone@x', now), false);
  assert.equal(L.can('User', 'reopen', old, 'a@x', now), false);
  assert.equal(L.can('User', 'changeBlock', ip), false);
  // ...cancel only their own uncollected-for-analysis samples.
  assert.equal(L.can('User', 'cancelSample', aw, 'c@x'), true);
  assert.equal(L.can('User', 'cancelSample', aw, 'other@x'), false);
  assert.equal(L.can('User', 'cancelSample', ip, 'c@x'), false);
  // Reports, all completed, exports: admins and owners.
  for (const a of ['reports', 'export', 'viewAllCompleted', 'admin']) {
    assert.equal(L.can('User', a), false, a);
    assert.equal(L.can('Admin', a), true, a);
    assert.equal(L.can('Owner', a), true, a);
  }
  assert.equal(L.can('Admin', 'reopen', old, 'x@x', now), true);
  assert.equal(L.can('Admin', 'restore', { Status: 'Cancelled' }), true);
  // People and tablets: owners.
  assert.equal(L.can('Admin', 'owner'), false);
  assert.equal(L.can('Owner', 'owner'), true);
  // Old role names still work.
  assert.equal(L.can('Administrator', 'owner'), true);
  assert.equal(L.can('Analyst', 'analyse'), true);
  assert.equal(L.can('Collector', 'export'), false);
  assert.equal(L.analystEditUntil({ AnalysisCompletedAt: '2026-10-10T00:00:00Z' }).toISOString().slice(0, 10), '2026-11-10');
});

test('plant check: questions follow the form notes', () => {
  const q = (h, stage = 'Training Stage (Bines being wrapped)') => L.plantQuestions({ AvgBineHeightCm: h, GrowthStage: stage });
  assert.deepEqual(q(''), { InternodeUnder1mCm: true, Internode1to2mCm: false, Internode2to3mCm: false, AvgLateralLengthCm: false });
  assert.deepEqual(q(150), { InternodeUnder1mCm: true, Internode1to2mCm: false, Internode2to3mCm: false, AvgLateralLengthCm: false });
  assert.deepEqual(q(250), { InternodeUnder1mCm: false, Internode1to2mCm: true, Internode2to3mCm: false, AvgLateralLengthCm: false });
  assert.deepEqual(q(350), { InternodeUnder1mCm: false, Internode1to2mCm: true, Internode2to3mCm: true, AvgLateralLengthCm: false });
  assert.equal(q(350, 'Lateral Development (Side arm growth)').AvgLateralLengthCm, true);
  assert.equal(q(350, 'Harvest Ready').AvgLateralLengthCm, true);
  assert.equal(q(350, 'Vegetative Growth (Rapid vertical climbing)').AvgLateralLengthCm, false);
});

test('plant check: validation', () => {
  const ok = { InspectionDate: '2026-11-10', BlockVarietyID: 'C2-RIWAKA', Row: 14, Bay: 3, GrowthStage: L.PLANT_OPTIONS.GrowthStage[1] };
  assert.deepEqual(L.validatePlantCheck(ok, '2026-11-15'), {});
  const err = (extra) => Object.keys(L.validatePlantCheck({ ...ok, ...extra }, '2026-11-15'));
  assert.deepEqual(err({ Row: '' }), ['Row']);
  assert.deepEqual(err({ GrowthStage: '' }), ['GrowthStage']);
  assert.deepEqual(err({ InspectionDate: '2026-11-16' }), ['InspectionDate']);
  assert.deepEqual(err({ BinesTrained: 43 }), ['BinesTrained']);
  assert.deepEqual(err({ BinesTrained: 0 }), [], 'zero bines is valid');
  assert.deepEqual(err({ AvgBineHeightCm: 200, MaxBineHeightCm: 150 }), ['MaxBineHeightCm']);
  assert.deepEqual(err({ LeafColour: 8 }), ['LeafColour']);
});

test('plant check: sections, edit rights, series and stage timeline', () => {
  assert.deepEqual(L.userSections({ Role: 'Collector', Sections: '' }), ['Mites', 'Plant Health']);
  assert.deepEqual(L.userSections({ Role: 'Collector', Sections: ['Plant Health'] }), ['Plant Health']);
  assert.deepEqual(L.userSections({ Role: 'Administrator', Sections: ['Mites'] }), ['Mites', 'Plant Health']);
  const now = Date.parse('2026-11-15T00:00:00Z');
  const mine = { InspectorEmail: 'a@x', CreatedAt: '2026-11-10T00:00:00Z' };
  const user = { UserEmail: 'a@x', Role: 'Collector', Sections: ['Plant Health'] };
  assert.equal(L.canEditPlantCheck(user, mine, now), true);
  assert.equal(L.canEditPlantCheck(user, { ...mine, CreatedAt: '2026-09-01T00:00:00Z' }, now), false);
  assert.equal(L.canEditPlantCheck(user, { ...mine, InspectorEmail: 'b@x' }, now), false);
  assert.equal(L.canEditPlantCheck({ ...user, Role: 'Administrator' }, { ...mine, InspectorEmail: 'b@x' }, now), true);

  const S = L.PLANT_OPTIONS.GrowthStage;
  const checks = [
    { BlockVarietyID: 'C2', Block: 'C2', Variety: 'Riwaka', InspectionDate: '2026-10-20', GrowthStage: S[1], AvgBineHeightCm: 80 },
    { BlockVarietyID: 'C2', Block: 'C2', Variety: 'Riwaka', InspectionDate: '2026-10-13', GrowthStage: S[0], AvgBineHeightCm: 20 },
    { BlockVarietyID: 'C2', Block: 'C2', Variety: 'Riwaka', InspectionDate: '2026-10-27', GrowthStage: S[1], AvgBineHeightCm: '' },
    { BlockVarietyID: 'A1', Block: 'A1', Variety: 'Cascade', InspectionDate: '2026-10-27', GrowthStage: S[2], AvgBineHeightCm: 150, Deleted: true },
  ];
  assert.deepEqual(L.plantSeries(checks, 'C2', 'AvgBineHeightCm').map((p) => [p.date, p.value]), [['2026-10-13', 20], ['2026-10-20', 80]]);
  const sameDay = [
    { BlockVarietyID: 'K2', InspectionDate: '2026-11-03', Row: 5, Bay: 9, AvgBineHeightCm: 3 },
    { BlockVarietyID: 'K2', InspectionDate: '2026-11-03', Row: 5, Bay: 2, AvgBineHeightCm: 2 },
    { BlockVarietyID: 'K2', InspectionDate: '2026-11-03', Row: 1, Bay: 7, AvgBineHeightCm: 1 },
  ];
  assert.deepEqual(L.plantSeries(sameDay, 'K2', 'AvgBineHeightCm').map((p) => p.value), [1, 2, 3], 'same day: by row, then bay');
  const tl = L.stageTimeline(checks);
  assert.equal(tl.length, 1, 'deleted check ignored');
  assert.deepEqual(tl[0].firstSeen.slice(0, 3), ['2026-10-13', '2026-10-20', '']);
  const rows = L.plantExportRows(checks, () => 'Pat');
  assert.equal(rows.length, 3);
  assert.equal(rows[0][L.PLANT_EXPORT_HEADERS.indexOf('WeekStarting')], '2026-10-12');
});

test('waiting work: counts and the oldest waiting sample', () => {
  const samples = [
    { Status: 'Awaiting Analysis', CollectionDate: '2026-11-13' },
    { Status: 'Awaiting Analysis', CollectionDate: '2026-11-16' },
    { Status: 'Analysis In Progress', CollectionDate: '2026-11-10' },
    { Status: 'Analysis Complete', CollectionDate: '2026-11-01' },
  ];
  assert.deepEqual(L.mitesWaiting(samples, '2026-11-16'), { awaiting: 2, inProgress: 1, oldestDays: 3 });
  assert.deepEqual(L.mitesWaiting([], '2026-11-16'), { awaiting: 0, inProgress: 0, oldestDays: null });
  assert.deepEqual([0, 1, 4].map(L.daysLabel), ['today', '1 day', '4 days']);
});

test('needs attention: groups by severity, badge counts problems not information', () => {
  const issues = [
    { severity: 'INFO', issue: 'below target' },
    { severity: 'ERROR', issue: 'blank' },
    { severity: 'WARN', issue: 'waiting 5 days' },
    { severity: 'WARN', issue: 'stale' },
  ];
  const s = L.attentionSummary({ issues, backup: { overdue: true }, failedUploads: 2 });
  assert.deepEqual(s.groups.map((g) => [g.key, g.items.length]), [['ERROR', 1], ['WARN', 2], ['INFO', 1]]);
  assert.equal(s.count, 5); // 3 problems + backup + failed uploads
  assert.equal(L.attentionSummary({}).count, 0);
  const now = Date.parse('2026-11-17T00:00:00Z');
  assert.equal(L.backupText({ enabled: true, last: { at: '2026-11-14T00:00:00Z', ok: true } }, now), 'Last backup 3 days ago. Weekly backup is on.');
  assert.match(L.backupText({ enabled: false, last: null }, now), /No backup has been made yet\. Weekly backup is off/);
  assert.match(L.backupText({ enabled: true, last: { at: '2026-11-17T00:00:00Z', ok: false, error: 'HTTP 403' } }, now), /today\) failed: HTTP 403/);
});
