// Tests for apps-script/Setup.gs + Api.gs, run in Node against an in-memory spreadsheet.
process.env.TZ = 'Pacific/Auckland';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas, createSeededGas } = require('../support/gas-mock');

const ADMIN = { email: 'admin@farm.nz', code: '111111' };
const COL = { email: 'col@farm.nz', code: '222222' };
const LAB = { email: 'lab@farm.nz', code: '333333' };

const newSample = (id, extra = {}) => ({
  table: 'Samples', id, isNew: true,
  patch: { SampleNumber: 1042, CollectionDate: '2026-11-03', CollectorEmail: 'col@farm.nz', BlockVarietyID: 'A1-CASCADE', Status: 'Awaiting Analysis', CreatedAt: '2026-11-03T01:00:00.000Z', ...extra },
});
const counts = (a = 0, b = 0, c = 0, d = 0, e = 0) => ({ TetranychusCount: a, PhytoseiulusCount: b, TwoSpotEggCount: c, PredatorEggCount: d, OtherBeneficialCount: e });
const newLeaf = (id, sampleId, n, c = counts()) => ({
  table: 'LeafAnalysis', id, isNew: true,
  patch: { SampleID: sampleId, LeafNumber: n, AnalystEmail: 'lab@farm.nz', AnalysisDateTime: '2026-11-04T01:00:00.000Z', ...c },
});
const push = (g, who, ops) => g.post({ action: 'push', ...who, ops: ops.map((o, i) => ({ seq: i + 1, ...o })) });

test('setup creates every tab with headers, is idempotent, seeds an admin with an access code', () => {
  const g = createGas();
  g.gs.setupHopFarmWorkbook();
  assert.match(g.ss.lastToast, /access code is \d{6}/);
  g.gs.setupHopFarmWorkbook();
  assert.equal(g.sheets.Sheet1, undefined);
  for (const [t, headers] of Object.entries(g.gs.SCHEMA)) assert.deepEqual(g.sheets[t].data[0], headers, t);
  const users = g.table('Users');
  assert.equal(users.length, 1);
  assert.equal(users[0].Role, 'Owner');
  assert.match(users[0].AccessCode, /^\d{6}$/);
  assert.equal(g.table('BlockVarieties').length, 39);
  assert.ok(g.table('HelpReference').length >= 10);
});

test('setup adds missing columns to an existing sheet without moving data', () => {
  const g = createGas();
  const sh = g.ss.insertSheet('Users');
  sh.getRange(1, 1, 2, 3).setValues([['UserEmail', 'UserName', 'Role'], ['x@y.nz', 'X', 'Analyst']]);
  g.gs.setupHopFarmWorkbook();
  assert.deepEqual(g.sheets.Users.data[0].slice(0, 5), ['UserEmail', 'UserName', 'Role', 'Username', 'FullName']);
  assert.equal(g.sheets.Users.data[1][0], 'x@y.nz');
  assert.equal(g.table('Users').length, 1); // not re-seeded because it had data
});

test('duplicate usernames cannot sign in and are reported', () => {
  const g = createSeededGas();
  g.addRow('Users', { UserEmail: 'lee2@farm.nz', Username: 'LEE', FullName: 'Another Lee', Role: 'Analyst', Active: true, AccessCode: '555555' });
  const r = g.post({ action: 'login', login: 'lee', code: '333333' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Two people share the username/);
  assert.equal(g.post({ action: 'login', login: 'lab@farm.nz', code: '333333' }).ok, true); // email still works
  g.gs.buildDataQualityReport();
  assert.ok(g.table('Report_DataQuality').some((x) => /Username "lee" is also used/.test(x.Issue)));
});

test('upgrading an old Users tab fills Username and FullName without overwriting', () => {
  const g = createGas();
  const sh = g.ss.insertSheet('Users');
  sh.getRange(1, 1, 4, 6).setValues([
    ['UserEmail', 'UserName', 'Role', 'Active', 'AccessCode', 'CreatedAt'],
    ['geo.saurus@farm.nz', 'George Saurus', 'Administrator', true, '123456', ''],
    ['Geo.Saurus@other.nz', 'Second Geo', 'Analyst', true, '654321', ''],
    ['sam@farm.nz', '', 'Collector', true, '111222', ''],
  ]);
  g.gs.setupHopFarmWorkbook();
  const users = g.table('Users');
  assert.deepEqual(users.map((u) => [u.Username, u.FullName]), [['geo.saurus', 'George Saurus'], ['geo.saurus2', 'Second Geo'], ['sam', '']]);
  const r = g.post({ action: 'login', login: 'geo.saurus', code: '123456' });
  assert.equal(r.user.FullName, 'George Saurus');
  assert.equal(g.post({ action: 'login', login: 'sam', code: '111222' }).user.FullName, 'sam@farm.nz'); // falls back to email
  // Re-running does not change anything already set.
  g.sheets.Users.data[1][g.sheets.Users.data[0].indexOf('FullName')] = 'George S.';
  g.gs.setupHopFarmWorkbook();
  assert.equal(g.table('Users')[0].FullName, 'George S.');
});

test('calculations: leaf target, season, week', () => {
  const g = createGas();
  assert.deepEqual([3.38, 7.84, 11.77, 0, '', -2].map(g.gs.requiredLeaves), [50, 75, 115, null, null, null]);
  assert.equal(g.gs.seasonOf('2026-11-05'), '2026/27');
  assert.equal(g.gs.seasonOf('2027-03-01'), '2026/27');
  assert.equal(g.gs.seasonOf('2027-07-01'), '2027/28');
  assert.equal(g.gs.weekStarting('2026-11-05'), '2026-11-02'); // Thursday -> Monday
  assert.equal(g.gs.weekStarting('2026-11-02'), '2026-11-02');
  assert.equal(g.gs.weekStarting('2026-11-08'), '2026-11-02'); // Sunday
});

test('login by username or email, checks code and active flag; never returns access codes', () => {
  const g = createSeededGas();
  const byName = g.post({ action: 'login', login: ' Lee ', code: '333333' });
  assert.equal(byName.ok, true);
  assert.deepEqual(byName.user, { UserEmail: 'lab@farm.nz', Username: 'lee', FullName: 'Lee Analyst', Role: 'User', Sections: ['Mites', 'Plant Health'], Active: true });
  const ok = g.post({ action: 'login', login: 'LAB@farm.nz ', code: '333333' });
  assert.equal(ok.ok, true);
  assert.equal(ok.user.Role, 'User');
  // Older app versions send `email`.
  assert.equal(g.post({ action: 'login', email: 'lab@farm.nz', code: '333333' }).ok, true);
  assert.match(g.post({ action: 'login', login: 'lee', code: '111111' }).error, /Username or access code not recognised/);
  assert.equal(g.post({ action: 'login', login: 'lab@farm.nz', code: '000000' }).auth, true);
  assert.equal(g.post({ action: 'login', login: 'nobody', code: '333333' }).ok, false);
  const inactive = g.post({ action: 'login', login: 'old', code: '444444' });
  assert.equal(inactive.ok, false);
  assert.match(inactive.error, /not active/);
  const pull = g.post({ action: 'pull', ...LAB });
  assert.ok(pull.users.every((u) => !('AccessCode' in u)));
  assert.ok(pull.users.some((u) => u.FullName === 'Cole Collector'));
  assert.equal(g.post({ action: 'nope', ...LAB }).error, 'Unknown action');
  assert.equal(g.post('not json').ok, false);
});

test('collector creates a sample: server snapshots block, target and season', () => {
  const g = createSeededGas();
  const res = push(g, COL, [newSample('sample-0001', { TargetLeafCount: 999, Season: 'hack' })]);
  assert.deepEqual(res.results, [{ seq: 1, ok: true }]);
  const [s] = g.table('Samples');
  assert.equal(s.Block, 'A1');
  assert.equal(s.Variety, 'Cascade');
  assert.equal(s.AreaHaAtCollection, 7.84);
  assert.equal(s.TargetLeafCount, 75);
  assert.equal(s.Season, '2026/27');
  assert.equal(s.Status, 'Awaiting Analysis');
  assert.equal(s.LastModifiedBy, 'col@farm.nz');
  assert.ok(s.CollectionDate instanceof Date);
  assert.ok(s.UpdatedAt instanceof Date);

  const pulled = g.post({ action: 'pull', ...COL });
  assert.equal(pulled.samples[0].CollectionDate, '2026-11-03');
  assert.equal(pulled.samples[0].TargetLeafCount, 75);
});

test('historical snapshot is kept when the block area changes later', () => {
  const g = createSeededGas();
  push(g, COL, [newSample('sample-0001')]);
  const bv = g.sheets.BlockVarieties;
  const areaCol = bv.data[0].indexOf('AreaHa');
  bv.data[1][areaCol] = 20; // A1 grows to 20 ha
  push(g, COL, [{ table: 'Samples', id: 'sample-0001', patch: { SampleComments: 'edited' } }]);
  const [s] = g.table('Samples');
  assert.equal(s.AreaHaAtCollection, 7.84);
  assert.equal(s.TargetLeafCount, 75);
  push(g, COL, [newSample('sample-0002', { SampleNumber: 1043 })]);
  assert.equal(g.table('Samples')[1].TargetLeafCount, 200);
});

test('validation rejects bad samples and leaves without losing the rest of the batch', () => {
  const g = createSeededGas();
  const res = push(g, LAB, [
    newSample('sample-bad1', { SampleNumber: '', CollectorEmail: 'lab@farm.nz' }),
    newSample('sample-bad2', { BlockVarietyID: 'ZZ-NOPE', CollectorEmail: 'lab@farm.nz' }),
    newSample('sample-0001', { CollectorEmail: 'lab@farm.nz' }),
    newLeaf('leaf-bad01', 'sample-0001', 1, { ...counts(), TetranychusCount: -1 }),
    newLeaf('leaf-bad02', 'sample-0001', 1, { ...counts(), PhytoseiulusCount: '' }),
    newLeaf('leaf-bad03', 'sample-0001', 1, { ...counts(), TwoSpotEggCount: 1.5 }),
    newLeaf('leaf-bad04', 'no-such-sample', 1),
    newLeaf('leaf-00001', 'sample-0001', 1, counts(0, 0, 0, 0, 0)),
    { table: 'Nope', id: 'xxxxxxxx', patch: {} },
    { table: 'Samples', id: 'bad id!', patch: {} },
  ]);
  assert.deepEqual(res.results.map((r) => r.ok), [false, false, true, false, false, false, false, true, false, false]);
  assert.match(res.results[0].error, /Bag number/);
  assert.match(res.results[1].error, /Unknown block/);
  assert.match(res.results[3].error, /0 or more/);
  assert.match(res.results[4].error, /blank/);
  assert.equal(g.table('LeafAnalysis').length, 1);
  assert.equal(g.table('LeafAnalysis')[0].TetranychusCount, 0); // zero is a valid count
});

test('inactive blocks cannot be used for new samples', () => {
  const g = createSeededGas();
  const bv = g.sheets.BlockVarieties;
  bv.data[1][bv.data[0].indexOf('Active')] = false;
  const res = push(g, COL, [newSample('sample-0001')]);
  assert.match(res.results[0].error, /no longer active/);
});

test('levels: Users collect and analyse; reports, exports and people are for admins and owners', () => {
  const g = createSeededGas();
  const BEA = { login: 'bea', code: '555000' }; // Admin
  push(g, LAB, [newSample('sample-lab1', { CollectorEmail: 'lab@farm.nz' })]);
  let r = push(g, COL, [newSample('sample-0001', { CollectorEmail: 'someone@else.nz' })]);
  assert.match(r.results[0].error, /own name/);
  // Any User can analyse any sample.
  push(g, COL, [newSample('sample-0002')]);
  r = push(g, LAB, [newLeaf('leaf-00001', 'sample-0002', 1), { table: 'Samples', id: 'sample-0002', patch: { Status: 'Analysis In Progress', AnalysisStartedBy: 'lab@farm.nz' } }]);
  assert.ok(r.results.every((x) => x.ok), JSON.stringify(r.results));
  // Only the collector (or an admin) cancels a sample.
  r = push(g, LAB, [{ table: 'Samples', id: 'sample-lab1', patch: { Status: 'Cancelled' } }]);
  assert.equal(r.results[0].ok, true);
  push(g, COL, [newSample('sample-0003', { SampleNumber: 9 })]);
  r = push(g, LAB, [{ table: 'Samples', id: 'sample-0003', patch: { Status: 'Cancelled' } }]);
  assert.match(r.results[0].error, /not allowed/);
  // Reports/exports: admins and owners only.
  assert.match(g.post({ action: 'export', ...COL, type: 'leaves' }).error, /Admins and owners only/);
  assert.equal(g.post({ action: 'export', ...BEA, type: 'leaves' }).ok, true);
  assert.equal(g.post({ action: 'export', ...ADMIN, type: 'summary' }).ok, true);
  // People: owners only.
  assert.match(g.post({ action: 'listUsers', ...BEA }).error, /Owners only/);
  assert.equal(g.post({ action: 'listUsers', ...ADMIN }).ok, true);
});

test('old role names are upgraded: Collector/Analyst → User, Administrator → Owner', () => {
  const g = createGas();
  const sh = g.ss.insertSheet('Users');
  sh.getRange(1, 1, 4, 5).setValues([
    ['UserEmail', 'Username', 'Role', 'Active', 'AccessCode'],
    ['a@x.nz', 'a', 'Collector', true, '1111'], ['b@x.nz', 'b', 'Analyst', true, '2222'], ['c@x.nz', 'c', 'Administrator', true, '3333']]);
  assert.equal(g.post({ action: 'login', login: 'c', code: '3333' }).user.Role, 'Owner', 'works even before repair');
  g.gs.setupHopFarmWorkbook();
  assert.deepEqual(g.table('Users').map((u) => u.Role), ['User', 'User', 'Owner']);
});

test('full analysis workflow, completion below target, export one row per leaf', () => {
  const g = createSeededGas();
  push(g, COL, [newSample('sample-0001')]);
  const ops = [{ table: 'Samples', id: 'sample-0001', patch: { Status: 'Analysis In Progress', AnalysisStartedAt: '2026-11-04T00:00:00Z', AnalysisStartedBy: 'lab@farm.nz' } }];
  for (let n = 1; n <= 3; n++) ops.push(newLeaf(`leaf-0000${n}`, 'sample-0001', n, counts(n, 1, 2, 0, n === 3 ? 1 : 0)));
  ops.push({ table: 'Samples', id: 'sample-0001', patch: { Status: 'Analysis Complete', AnalysisCompletedAt: '2026-11-04T02:00:00Z', CompletedBy: 'lab@farm.nz', ActualLeafCount: 3, EarlyCompletionReason: 'Damaged leaves' } });
  const res = push(g, LAB, ops);
  assert.ok(res.results.every((r) => r.ok), JSON.stringify(res.results));
  const [s] = g.table('Samples');
  assert.equal(s.Status, 'Analysis Complete');
  assert.equal(s.ActualLeafCount, 3);

  // Within 31 days of completion an analyst can correct leaves and sample details (audited),
  // but must reopen the analysis to add leaves.
  let r = push(g, LAB, [{ table: 'LeafAnalysis', id: 'leaf-00002', patch: { PhytoseiulusCount: 2 } }]);
  assert.equal(r.results[0].ok, true, r.results[0].error);
  r = push(g, LAB, [{ table: 'Samples', id: 'sample-0001', patch: { AnalysisComments: 'Recounted leaf 2' } }]);
  assert.equal(r.results[0].ok, true, r.results[0].error);
  r = push(g, LAB, [newLeaf('leaf-00009', 'sample-0001', 9)]);
  assert.match(r.results[0].error, /Reopen the analysis to add leaves/);
  r = push(g, LAB, [{ table: 'Samples', id: 'sample-0001', patch: { BlockVarietyID: 'K2-RIWAKA' } }]);
  assert.match(r.results[0].error, /block cannot be changed/);
  r = push(g, COL, [{ table: 'Samples', id: 'sample-0001', patch: { SampleComments: 'x' } }]);
  assert.equal(r.results[0].ok, false, 'collectors cannot correct completed samples');
  let audit = g.table('AuditLog');
  assert.equal(audit.length, 2);
  assert.equal(audit[0].ChangedBy, 'lab@farm.nz');
  assert.match(audit[0].Summary, /PhytoseiulusCount: 1 → 2/);

  // After 31 days only an administrator can change it.
  const doneCol = g.sheets.Samples.data[0].indexOf('AnalysisCompletedAt');
  g.sheets.Samples.data[1][doneCol] = new Date(Date.now() - 32 * 86400000);
  r = push(g, LAB, [{ table: 'LeafAnalysis', id: 'leaf-00001', patch: { TetranychusCount: 9 } }]);
  assert.match(r.results[0].error, /analysed this sample \(within 31 days\) or an admin/);
  r = push(g, LAB, [{ table: 'Samples', id: 'sample-0001', patch: { Status: 'Analysis In Progress' } }]);
  assert.match(r.results[0].error, /more than 31 days ago/);
  r = push(g, ADMIN, [{ table: 'LeafAnalysis', id: 'leaf-00001', patch: { TetranychusCount: 9 } }]);
  assert.equal(r.results[0].ok, true);
  audit = g.table('AuditLog');
  assert.equal(audit.length, 3);
  assert.equal(audit[2].ChangedBy, 'admin@farm.nz');
  assert.match(audit[2].Summary, /TetranychusCount: 1 → 9/);

  // Reopening within the window works for analysts.
  g.sheets.Samples.data[1][doneCol] = new Date();
  r = push(g, LAB, [{ table: 'Samples', id: 'sample-0001', patch: { Status: 'Analysis In Progress' } }]);
  assert.equal(r.results[0].ok, true, r.results[0].error);
  r = push(g, LAB, [{ table: 'Samples', id: 'sample-0001', patch: { Status: 'Analysis Complete', ActualLeafCount: 3 } }]);
  assert.equal(r.results[0].ok, true, r.results[0].error);

  const exp = g.post({ action: 'export', ...ADMIN, type: 'leaves' });
  const lines = exp.csv.trim().split('\r\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[0], g.gs.LEAF_EXPORT_HEADERS.join(','));
  assert.match(lines[1], /^sample-0001,1042,2026\/27,2026-11-03,2026-11-02,Cole Collector,A1,Cascade,7.84,75,1,Lee Analyst,/);
  // AnalysisDateTime 2026-11-04T01:00Z is 14:00 NZDT, written so Excel reads it as a date-time.
  assert.match(lines[1], /,Lee Analyst,2026-11-04 14:00:00,/);
  assert.match(exp.filename, /^hopfarm_leaf_results_all-seasons_\d{4}-\d{2}-\d{2}\.csv$/);

  const sum = g.post({ action: 'export', ...ADMIN, type: 'summary', season: '2026/27' });
  const [hdr, row] = sum.csv.trim().split('\r\n').map((l) => l.split(','));
  const rec = Object.fromEntries(hdr.map((h, i) => [h, row[i]]));
  assert.equal(rec.LeavesAnalysed, '3');
  assert.equal(rec.BelowTarget, 'YES');
  assert.equal(rec.TotalTwoSM, '14'); // 9 + 2 + 3
  assert.equal(rec.EarlyCompletionReason, 'Damaged leaves');
  assert.equal(g.post({ action: 'export', ...ADMIN, type: 'summary', season: '1999/00' }).rows, 0);
});

test('deleted leaves disappear from exports and are sent to devices as deletions', () => {
  const g = createSeededGas();
  push(g, LAB, [newSample('sample-0001', { CollectorEmail: 'lab@farm.nz' }), newLeaf('leaf-00001', 'sample-0001', 1), newLeaf('leaf-00002', 'sample-0001', 2)]);
  const before = g.post({ action: 'pull', ...LAB });
  push(g, LAB, [{ table: 'LeafAnalysis', id: 'leaf-00002', patch: { Deleted: true } }]);
  const after = g.post({ action: 'pull', ...LAB, since: before.serverTime });
  assert.ok(after.leaves.some((l) => l.LeafAnalysisID === 'leaf-00002' && l.Deleted === true));
  assert.equal(g.post({ action: 'export', ...ADMIN, type: 'leaves' }).rows, 1);
});

test('patches only touch the fields sent, so concurrent edits do not overwrite each other', () => {
  const g = createSeededGas();
  push(g, LAB, [newSample('sample-0001', { CollectorEmail: 'lab@farm.nz', SampleComments: 'original' })]);
  push(g, LAB, [{ table: 'Samples', id: 'sample-0001', patch: { SamplePhoto1: 'https://drive.example/p.jpg' } }]);
  push(g, ADMIN, [{ table: 'Samples', id: 'sample-0001', patch: { SampleComments: 'admin note' } }]);
  const [s] = g.table('Samples');
  assert.equal(s.SamplePhoto1, 'https://drive.example/p.jpg');
  assert.equal(s.SampleComments, 'admin note');
  assert.equal(g.table('Samples').length, 1);
});

test('pull: incremental by UpdatedAt, initial pull limits old leaves', () => {
  const g = createSeededGas();
  push(g, LAB, [newSample('sample-new1', { CollectorEmail: 'lab@farm.nz' }), newLeaf('leaf-new01', 'sample-new1', 1),
    newSample('sample-old1', { CollectorEmail: 'lab@farm.nz', CollectionDate: '2023-11-03', SampleNumber: 7 }), newLeaf('leaf-old01', 'sample-old1', 1)]);
  const first = g.post({ action: 'pull', ...LAB });
  assert.equal(first.samples.length, 2);
  assert.deepEqual(first.leaves.map((l) => l.LeafAnalysisID), ['leaf-new01']);
  assert.equal(g.post({ action: 'leaves', ...LAB, sampleId: 'sample-old1' }).leaves.length, 1);
  // Make everything look old, then change one record.
  const uCol = g.sheets.Samples.data[0].indexOf('UpdatedAt');
  g.sheets.Samples.data.slice(1).forEach((r) => { r[uCol] = new Date(Date.now() - 86400000); });
  const lCol = g.sheets.LeafAnalysis.data[0].indexOf('UpdatedAt');
  g.sheets.LeafAnalysis.data.slice(1).forEach((r) => { r[lCol] = new Date(Date.now() - 86400000); });
  push(g, LAB, [{ table: 'Samples', id: 'sample-new1', patch: { SampleComments: 'changed' } }]);
  const next = g.post({ action: 'pull', ...LAB, since: first.serverTime });
  assert.deepEqual(next.samples.map((s) => s.SampleID), ['sample-new1']);
  assert.equal(next.leaves.length, 0);
});

test('photo upload is idempotent and only accepts images', () => {
  const g = createSeededGas();
  const dataUrl = `data:image/jpeg;base64,${Buffer.from('fakejpeg').toString('base64')}`;
  const a = g.post({ action: 'uploadPhoto', ...COL, photoId: 'photo-0001', dataUrl, kind: 'sample' });
  const b = g.post({ action: 'uploadPhoto', ...COL, photoId: 'photo-0001', dataUrl, kind: 'sample' });
  assert.equal(a.url, 'https://drive.example/photo-0001.jpg');
  assert.equal(b.url, a.url);
  assert.equal(g.files.length, 1);
  assert.equal(g.post({ action: 'uploadPhoto', ...COL, photoId: 'photo-0002', dataUrl: 'data:text/html;base64,AAAA' }).ok, false);
});

test('duplicate leaf numbers from two offline devices are kept and reported', () => {
  const g = createSeededGas();
  push(g, LAB, [newSample('sample-0001', { CollectorEmail: 'lab@farm.nz' }), newLeaf('leaf-dev-a1', 'sample-0001', 1), newLeaf('leaf-dev-b1', 'sample-0001', 1)]);
  assert.equal(g.table('LeafAnalysis').length, 2);
  g.gs.buildDataQualityReport();
  const issues = g.table('Report_DataQuality').map((r) => r.Issue);
  assert.ok(issues.some((i) => /recorded twice/.test(i)), issues.join('\n'));
});

test('data quality report and spreadsheet menu exports', () => {
  const g = createSeededGas();
  push(g, LAB, [
    newSample('sample-0001', { CollectorEmail: 'lab@farm.nz' }),
    newLeaf('leaf-00001', 'sample-0001', 1, counts(250, 0, 0, 0, 0)),
    { table: 'Samples', id: 'sample-0001', patch: { Status: 'Analysis Complete' } },
    newSample('sample-0002', { CollectorEmail: 'lab@farm.nz', BlockVarietyID: 'H1-SOUTHERNCROSS' }),
    { table: 'Samples', id: 'sample-0002', patch: { Status: 'Analysis In Progress' } },
    { table: 'Samples', id: 'sample-0002', patch: { Status: 'Analysis Complete' } },
  ]);
  g.addRow('LeafAnalysis', { LeafAnalysisID: 'orphan-leaf', SampleID: 'ghost', LeafNumber: 1, ...counts() });
  g.gs.buildDataQualityReport();
  const issues = g.table('Report_DataQuality').map((r) => r.Issue).join('\n');
  for (const e of ['does not exist', 'no leaf records', 'Bag number also used', 'unusually high', 'Completed below target']) {
    assert.match(issues, new RegExp(e));
  }
  g.gs.buildLeafExport();
  assert.equal(g.table('Export_LeafResults').length, 1);
  g.gs.buildSampleSummary();
  assert.equal(g.table('Export_SampleSummary').length, 2);
});

test('owners add and edit people; codes optional for Users, required for Admins/Owners; audited', () => {
  const g = createSeededGas();
  const save = (who, user, isNew = false) => g.post({ action: 'saveUser', ...who, isNew, user });
  const add = save(ADMIN, { UserEmail: ' Sam@Farm.nz ', Username: 'Sam', FullName: 'Sam Wilson', Role: 'User' }, true);
  assert.equal(add.ok, true, add.error);
  assert.equal(add.user.UserEmail, 'sam@farm.nz');
  assert.equal(add.user.Username, 'sam');
  assert.equal(add.user.AccessCode, '', 'Users pick their name: no code needed');
  assert.equal(g.post({ action: 'login', login: 'sam', code: '000000' }).ok, false);

  // Validation
  assert.match(save(ADMIN, { UserEmail: 'sam@farm.nz', Username: 'sam2', FullName: 'X', Role: 'User' }, true).error, /already exists/);
  assert.match(save(ADMIN, { UserEmail: 'new@farm.nz', Username: 'lee', FullName: 'X', Role: 'User' }, true).error, /already taken/);
  assert.match(save(ADMIN, { UserEmail: 'new@farm.nz', Username: 'has space', FullName: 'X', Role: 'User' }, true).error, /Username/);
  assert.match(save(ADMIN, { UserEmail: 'not-an-email', Username: 'abc', FullName: 'X', Role: 'User' }, true).error, /valid email/);
  assert.match(save(ADMIN, { UserEmail: 'new@farm.nz', Username: 'abc', FullName: '', Role: 'User' }, true).error, /full name/);
  assert.match(save(ADMIN, { UserEmail: 'new@farm.nz', Username: 'abc', FullName: 'X', Role: 'Boss' }, true).error, /level/);
  assert.match(save(ADMIN, { UserEmail: 'new@farm.nz', Username: 'abc', FullName: 'X', Role: 'User', AccessCode: '0123' }, true).error, /Access code/);
  assert.match(save(ADMIN, { UserEmail: 'ghost@farm.nz', Username: 'ghost', FullName: 'X', Role: 'User' }).error, /not found/);

  // Promote to Admin: a code is created; then change code; then deactivate.
  const promoted = save(ADMIN, { UserEmail: 'sam@farm.nz', Username: 'sam', FullName: 'Sam Wilson', Role: 'Admin', Active: true });
  assert.equal(promoted.user.Role, 'Admin');
  assert.match(promoted.user.AccessCode, /^[1-9]\d{5}$/);
  save(ADMIN, { UserEmail: 'sam@farm.nz', Username: 'sam', FullName: 'Sam Wilson', Role: 'Admin', Active: true, AccessCode: '765432' });
  assert.equal(g.post({ action: 'login', login: 'sam', code: promoted.user.AccessCode }).ok, false);
  assert.equal(g.post({ action: 'login', login: 'sam', code: '765432' }).user.Role, 'Admin');
  save(ADMIN, { UserEmail: 'sam@farm.nz', Username: 'sam', FullName: 'Sam Wilson', Role: 'Admin', Active: false });
  assert.match(g.post({ action: 'login', login: 'sam', code: '765432' }).error, /not active/);

  // Owners cannot lock themselves out; admins and users cannot manage people.
  assert.match(save(ADMIN, { UserEmail: 'admin@farm.nz', Username: 'ana', FullName: 'Ana Admin', Role: 'Admin', Active: true }).error, /your own owner/);
  assert.match(save(ADMIN, { UserEmail: 'admin@farm.nz', Username: 'ana', FullName: 'Ana Admin', Role: 'Owner', Active: false }).error, /your own owner/);
  assert.match(save(LAB, { UserEmail: 'x@farm.nz', Username: 'x', FullName: 'X', Role: 'Owner' }, true).error, /Owners only/);
  assert.match(save({ login: 'bea', code: '555000' }, { UserEmail: 'x@farm.nz', Username: 'x', FullName: 'X', Role: 'User' }, true).error, /Owners only/);

  // Other owners are view-only; an owner can still change their own details and code.
  const bob = save(ADMIN, { UserEmail: 'bob@farm.nz', Username: 'bob', FullName: 'Bob Boss', Role: 'Owner' }, true);
  assert.equal(bob.ok, true);
  const BOB = { login: 'bob', code: bob.user.AccessCode };
  for (const change of [{ AccessCode: '999999' }, { Role: 'Admin' }, { Active: false }, { FullName: 'Renamed' }]) {
    const r = save(BOB, { UserEmail: 'admin@farm.nz', Username: 'ana', FullName: 'Ana Admin', Role: 'Owner', Active: true, ...change });
    assert.match(r.error, /viewed but not changed/, JSON.stringify(change));
  }
  assert.equal(g.post({ action: 'login', login: 'ana', code: '111111' }).ok, true, 'Ana unchanged');
  assert.equal(g.post({ action: 'listUsers', ...BOB }).users.find((u) => u.Username === 'ana').AccessCode, '111111', 'codes are visible');
  const own = save(BOB, { UserEmail: 'bob@farm.nz', Username: 'bobby', FullName: 'Bob B', Role: 'Owner', Active: true, AccessCode: '424242' });
  assert.equal(own.ok, true, own.error);
  assert.equal(g.post({ action: 'login', login: 'bobby', code: '424242' }).user.FullName, 'Bob B');
  // Owners can change Admins.
  assert.equal(save({ login: 'bobby', code: '424242' }, { UserEmail: 'boss@farm.nz', Username: 'bea', FullName: 'Bea Boss', Role: 'User', Active: true }).ok, true);

  const audit = g.table('AuditLog').filter((a) => a.TableName === 'Users').map((a) => a.Summary);
  assert.equal(audit[0], 'Added as User');
  assert.equal(audit[1], 'Role: User → Admin; AccessCode changed');
  assert.ok(audit.every((x) => !/765432|424242/.test(x)), 'codes never written to the audit log');
});

test('split: Users, blocks and help move to a separate Users & Setup sheet', () => {
  const g = createSeededGas();
  push(g, LAB, [newSample('sample-0001', { CollectorEmail: 'lab@farm.nz' })]);
  // Extra column from an older layout must survive the move.
  const users = g.sheets.Users;
  users.data[0].push('UserName');
  users.data.slice(1).forEach((r) => r.push('legacy'));

  const setup = g.newBook('SETUP_SHEET_ID_000000000000000');
  assert.throws(() => g.gs.connectSetupSheet_('not a url'), /does not look like a Google Sheets address/);
  assert.throws(() => g.gs.connectSetupSheet_(`https://docs.google.com/spreadsheets/d/${g.ss.getId()}/edit`), /That is this sheet/);
  assert.throws(() => g.gs.connectSetupSheet_('https://docs.google.com/spreadsheets/d/UNKNOWN_SHEET_00000000000/edit'), /Could not open/);

  const msg = g.gs.connectSetupSheet_('https://docs.google.com/spreadsheets/d/SETUP_SHEET_ID_000000000000000/edit#gid=0');
  assert.match(msg, /Users: 5 rows copied and checked/);
  assert.match(msg, /BlockVarieties: 39 rows copied and checked/);
  assert.equal(g.props.SETUP_SHEET_ID, 'SETUP_SHEET_ID_000000000000000');

  // Old tabs renamed and hidden in the mite sheet; samples stay put.
  assert.equal(g.ss.getSheetByName('Users'), null);
  const old = g.ss.getSheetByName('OLD Users (moved – delete)');
  assert.ok(old && old.isSheetHidden());
  assert.ok(g.ss.getSheetByName('Samples'));
  assert.equal(setup.getSheetByName('Samples'), null);
  assert.equal(g.table('Users', setup).length, 5);
  assert.equal(g.table('Users', setup)[0].UserName, 'legacy');

  // Everything now reads and writes the new sheet.
  assert.equal(g.post({ action: 'login', login: 'lee', code: '333333' }).ok, true);
  assert.equal(g.post({ action: 'pull', ...LAB }).blocks.length, 39);
  const added = g.post({ action: 'saveUser', ...ADMIN, isNew: true, user: { UserEmail: 'sam@farm.nz', Username: 'sam', FullName: 'Sam', Role: 'Collector' } });
  assert.equal(added.ok, true, added.error);
  assert.equal(g.table('Users', setup).length, 6);
  assert.equal(g.table('AuditLog', setup).length, 1, 'user changes logged in the Users & Setup sheet');
  assert.equal(g.table('AuditLog', g.ss).length, 0);
  assert.equal(push(g, LAB, [newSample('sample-0002', { CollectorEmail: 'lab@farm.nz', SampleNumber: 7 })]).results[0].ok, true);
  assert.equal(g.table('Samples', g.ss).length, 2);

  // Repair does not recreate Users etc. in the mite sheet; exports still resolve names.
  g.gs.setupHopFarmWorkbook();
  assert.equal(g.ss.getSheetByName('Users'), null);
  assert.equal(g.ss.getSheetByName('BlockVarieties'), null);
  g.gs.buildSampleSummary();
  assert.equal(g.table('Export_SampleSummary', g.ss).length, 2);

  // Connecting again is harmless; a different sheet is refused.
  assert.match(g.gs.connectSetupSheet_('SETUP_SHEET_ID_000000000000000'), /already connected/);
  g.newBook('ANOTHER_SHEET_ID_0000000000000');
  assert.throws(() => g.gs.connectSetupSheet_('ANOTHER_SHEET_ID_0000000000000'), /different Users & Setup sheet is already connected/);
});

test('split: refuses a target sheet that already has data, changing nothing', () => {
  const g = createSeededGas();
  const setup = g.newBook('SETUP_SHEET_ID_000000000000000');
  setup.insertSheet('Users').getRange(1, 1, 2, 2).setValues([['UserEmail', 'Username'], ['x@y.nz', 'x']]);
  assert.throws(() => g.gs.connectSetupSheet_('SETUP_SHEET_ID_000000000000000'), /already has data in "Users"/);
  assert.equal(g.props.SETUP_SHEET_ID, undefined);
  assert.ok(g.ss.getSheetByName('Users'), 'original tabs untouched');
  assert.equal(g.post({ action: 'login', login: 'lee', code: '333333' }).ok, true);
});

test('works whichever order Apps Script loads Setup.gs and Api.gs', () => {
  for (const fileOrder of [['Setup.gs', 'Api.gs'], ['Api.gs', 'Setup.gs']]) {
    const g = createSeededGas({ fileOrder });
    assert.equal(g.post({ action: 'login', login: 'lee', code: '333333' }).ok, true, fileOrder.join(' then '));
    const r = push(g, LAB, [newSample('sample-0001', { CollectorEmail: 'lab@farm.nz' }), newLeaf('leaf-00001', 'sample-0001', 1, counts(1, 2, 3, 4, 5))]);
    assert.ok(r.results.every((x) => x.ok), JSON.stringify(r.results));
    const [leaf] = g.table('LeafAnalysis');
    assert.deepEqual([leaf.TetranychusCount, leaf.PhytoseiulusCount, leaf.TwoSpotEggCount, leaf.PredatorEggCount, leaf.OtherBeneficialCount], [1, 2, 3, 4, 5]);
  }
});

test('every count field is writable by the API', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'apps-script', 'Api.gs'), 'utf8');
  const block = /LeafAnalysis: \[([\s\S]*?)\]\s*\n\};/.exec(src)[1];
  for (const f of ['PhytoseiulusCount', 'TetranychusCount', 'PredatorEggCount', 'TwoSpotEggCount', 'OtherBeneficialCount']) {
    assert.ok(block.includes(`'${f}'`), f);
  }
});

// ---------------------------------------------------------------------------
// Plant Health
// ---------------------------------------------------------------------------
const plantCheck = (id, extra = {}) => ({
  table: 'PlantChecks', id, isNew: true,
  patch: {
    InspectionDate: '2026-11-10', InspectionTime: '09:15', InspectorEmail: 'col@farm.nz',
    BlockVarietyID: 'C2-RIWAKA', Row: 14, Bay: 3, GrowthStage: 'Training Stage (Bines being wrapped)',
    BineHealth: 'Normal', OverallBineHealth: 'Normal', WeedPressure: 'Low', BinesTrained: 30, AvgBineHeightCm: 85, MaxBineHeightCm: 120,
    InternodeUnder1mCm: 12.5, LeafColour: 5, LeafSize: 'Medium', LeafDamage: 'Curling, Chewing', ...extra,
  },
});

test('plant checks: saved with block snapshot, season and server-assigned record numbers', () => {
  const g = createSeededGas({ split: true });
  const r = push(g, COL, [plantCheck('check-0001'), plantCheck('check-0002', { Bay: 4 }),
    plantCheck('check-0003', { InspectionDate: '2027-08-01', GrowthStage: 'Spring Emergence / Rhizome Sprouting' })]);
  assert.ok(r.results.every((x) => x.ok), JSON.stringify(r.results));
  const rows = g.table('PlantChecks', g.plant);
  assert.equal(g.ss.getSheetByName('PlantChecks'), null, 'plant data lives in the Plant Health sheet');
  assert.deepEqual(rows.map((c) => [c.Season, c.RecordNumber]), [['2026/27', 1], ['2026/27', 2], ['2027/28', 1]]);
  assert.equal(rows[0].Block, 'C2');
  assert.equal(rows[0].Variety, 'Riwaka');
  assert.equal(rows[0].LeafDamage, 'Chewing, Curling', 'stored in the form order');
  assert.equal(rows[0].InternodeUnder1mCm, 12.5);

  const pulled = g.post({ action: 'pull', ...COL });
  assert.equal(pulled.plantChecks.length, 3);
  assert.equal(pulled.plantChecks[0].InspectionDate, '2026-11-10');
  assert.equal(pulled.plantChecks[0].InspectionTime, '09:15');

  const exp = g.post({ action: 'export', ...ADMIN, type: 'plant', season: '2026/27' });
  assert.equal(exp.ok, true, exp.error);
  const lines = exp.csv.trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], g.gs.PLANT_EXPORT_HEADERS.join(','));
  assert.match(lines[1], /^1,2026\/27,2026-11-10,2026-11-09,09:15,Cole Collector,C2,Riwaka,14,3,Normal,/);
});

test('plant checks: validation follows the form', () => {
  const g = createSeededGas();
  const bad = (extra) => push(g, COL, [plantCheck('check-bad01', extra)]).results[0].error;
  assert.match(bad({ GrowthStage: '' }), /growth stage/);
  assert.match(bad({ GrowthStage: 'Flowering' }), /not a choice/);
  assert.match(bad({ Row: '' }), /Row # must be/);
  assert.match(bad({ Bay: 0 }), /Bay # must be/);
  assert.match(bad({ BinesTrained: 43 }), /bines on string must be a whole number from 0 to 42/);
  assert.match(bad({ BinesTrained: 2.5 }), /bines on string/);
  assert.match(bad({ AvgBineHeightCm: -1 }), /Average bine height/);
  assert.match(bad({ MaxBineHeightCm: 50 }), /Maximum bine height cannot be less than the average/);
  assert.match(bad({ LeafColour: 8 }), /Leaf colour/);
  assert.match(bad({ CoirStatus: 'Rotten' }), /not a choice for CoirStatus/);
  assert.match(bad({ LeafDamage: 'Hail' }), /not a leaf damage choice/);
  assert.match(bad({ InspectionTime: '9am' }), /14:30/);
  assert.match(bad({ BlockVarietyID: 'ZZ-NOPE' }), /block and variety/);
  // Optional fields may be blank; zero is a real value.
  const ok = push(g, COL, [plantCheck('check-0001', { BinesTrained: 0, AvgBineHeightCm: '', MaxBineHeightCm: '', LeafColour: '', LeafDamage: '' })]);
  assert.equal(ok.results[0].ok, true, ok.results[0].error);
  assert.equal(g.table('PlantChecks')[0].BinesTrained, 0);
});

test('plant checks: own checks editable for 31 days, others only by an admin', () => {
  const g = createSeededGas();
  push(g, COL, [plantCheck('check-0001')]);
  let r = push(g, LAB, [{ table: 'PlantChecks', id: 'check-0001', patch: { Comments: 'x' } }]);
  assert.match(r.results[0].error, /only change your own/);
  r = push(g, COL, [{ table: 'PlantChecks', id: 'check-0001', patch: { Comments: 'Wind damage on row 14' } }]);
  assert.equal(r.results[0].ok, true);
  r = push(g, LAB, [plantCheck('check-0002', { InspectorEmail: 'col@farm.nz' })]);
  assert.match(r.results[0].error, /under your own name/);
  const col = g.sheets.PlantChecks.data[0].indexOf('CreatedAt');
  g.sheets.PlantChecks.data[1][col] = new Date(Date.now() - 40 * 86400000);
  r = push(g, COL, [{ table: 'PlantChecks', id: 'check-0001', patch: { Comments: 'late' } }]);
  assert.match(r.results[0].error, /more than 31 days old/);
  r = push(g, ADMIN, [{ table: 'PlantChecks', id: 'check-0001', patch: { Deleted: true } }]);
  assert.equal(r.results[0].ok, true);
  assert.equal(g.post({ action: 'export', ...ADMIN, type: 'plant' }).rows, 0, 'deleted checks are left out');
});

test('sections: people only reach the parts of the app they are given', () => {
  const g = createSeededGas();
  const save = (user) => g.post({ action: 'saveUser', ...ADMIN, isNew: true, user });
  const p = save({ UserEmail: 'pat@farm.nz', Username: 'pat', FullName: 'Pat Plants', Role: 'Collector', Sections: ['Plant Health'], AccessCode: '515151' });
  assert.equal(p.ok, true, p.error);
  assert.deepEqual(p.user.Sections, ['Plant Health']);
  const PAT = { login: 'pat', code: '515151' };
  assert.deepEqual(g.post({ action: 'login', ...PAT }).user.Sections, ['Plant Health']);
  assert.match(push(g, PAT, [newSample('sample-0001', { CollectorEmail: 'pat@farm.nz' })]).results[0].error, /does not have access to Mite Monitoring/);
  assert.equal(push(g, PAT, [plantCheck('check-0001', { InspectorEmail: 'pat@farm.nz' })]).results[0].ok, true);
  push(g, LAB, [newSample('sample-0002', { CollectorEmail: 'lab@farm.nz' })]);
  const pulled = g.post({ action: 'pull', ...PAT });
  assert.equal(pulled.samples.length, 0, 'no mite data sent to a plant-only user');
  assert.equal(pulled.plantChecks.length, 1);
  assert.equal(g.post({ action: 'export', ...PAT, type: 'leaves' }).ok, false);

  const m = save({ UserEmail: 'max@farm.nz', Username: 'max', FullName: 'Max Mites', Role: 'Analyst', Sections: ['Mites'], AccessCode: '626262' });
  const MAX = { login: 'max', code: '626262' };
  assert.equal(m.ok, true);
  assert.match(push(g, MAX, [plantCheck('check-0002', { InspectorEmail: 'max@farm.nz' })]).results[0].error, /does not have access to Plant Health/);
  assert.equal(g.post({ action: 'pull', ...MAX }).plantChecks.length, 0);
  assert.match(save({ UserEmail: 'nil@farm.nz', Username: 'nil', FullName: 'No One', Role: 'Collector', Sections: [] }).error, /at least one section/);
  // Existing users with a blank Sections cell keep everything.
  assert.deepEqual(g.post({ action: 'login', login: 'cole', code: '222222' }).user.Sections, ['Mites', 'Plant Health']);
});

test('plant pick-lists and export columns match between server and app', async () => {
  const L = await import('../../app/js/logic.js');
  const g = createGas();
  assert.deepEqual(JSON.parse(JSON.stringify(g.gs.PLANT_OPTIONS)), JSON.parse(JSON.stringify(L.PLANT_OPTIONS)));
  assert.deepEqual(g.gs.PLANT_EXPORT_HEADERS, L.PLANT_EXPORT_HEADERS);
});

test('Plant Health sheet: connecting moves existing checks and refuses the Users & Setup sheet', () => {
  const g = createSeededGas();
  push(g, COL, [plantCheck('check-0001')]);
  g.newBook('SETUP_SHEET_ID_000000000000000');
  g.gs.connectSetupSheet_('SETUP_SHEET_ID_000000000000000');
  assert.throws(() => g.gs.connectPlantSheet_('SETUP_SHEET_ID_000000000000000'), /already connected as the Users & Setup sheet/);
  const plant = g.newBook('PLANT_SHEET_ID_000000000000000');
  const msg = g.gs.connectPlantSheet_('https://docs.google.com/spreadsheets/d/PLANT_SHEET_ID_000000000000000/edit');
  assert.match(msg, /PlantChecks: 1 row copied and checked/);
  assert.equal(g.table('PlantChecks', plant).length, 1);
  assert.ok(g.ss.getSheetByName('OLD PlantChecks (moved – delete)').isSheetHidden());
  assert.equal(push(g, COL, [plantCheck('check-0002', { Bay: 5 })]).results[0].ok, true);
  assert.deepEqual(g.table('PlantChecks', plant).map((c) => c.RecordNumber), [1, 2]);
  g.gs.buildPlantExport();
  assert.equal(g.table('Export_PlantChecks', plant).length, 2);
});

test('live and test copies: environment, and a test copy links only to test sheets', () => {
  const g = createSeededGas({ split: true });
  assert.equal(g.post({ action: 'login', ...LAB }).environment, 'LIVE');
  assert.equal(g.post({ action: 'pull', ...LAB }).environment, 'LIVE');
  assert.match(g.gs.connectionsSummary_(), /This script is the LIVE server/);

  // A fresh copy of Hop Farm Data still points at the LIVE Users & Setup / Plant Health sheets.
  const liveSetup = g.props.SETUP_SHEET_ID;
  const livePlant = g.props.PLANT_SHEET_ID;
  const url = (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`;
  assert.throws(() => g.gs.setUpTestCopy_(url(liveSetup), url(livePlant)), /LIVE sheet/);
  const empty = g.newBook('EMPTY_SHEET_ID_00000000000000');
  const testSetup = g.newBook('TEST_SETUP_ID_000000000000000');
  testSetup.name = 'TEST Users & Setup';
  testSetup.insertSheet('Users').getRange(1, 1, 3, 5).setValues([
    ['UserEmail', 'Username', 'Role', 'Active', 'AccessCode'], ['lab@farm.nz', 'lee', 'Analyst', true, '999999'], ['admin@farm.nz', 'ana', 'Administrator', true, '888888']]);
  testSetup.insertSheet('BlockVarieties').getRange(1, 1, 2, 5).setValues([['BlockVarietyID', 'Block', 'Variety', 'AreaHa', 'Active'], ['T1-TEST', 'T1', 'Test', 5, true]]);
  const testPlant = g.newBook('TEST_PLANT_ID_000000000000000');
  testPlant.name = 'TEST Plant Health';
  testPlant.insertSheet('PlantChecks').getRange(1, 1, 1, 1).setValues([['CheckID']]);
  assert.throws(() => g.gs.setUpTestCopy_(url(empty.id), url(testPlant.id)), /no "Users" tab/);
  assert.throws(() => g.gs.setUpTestCopy_(url(testPlant.id), url(testPlant.id)), /two different sheets/);
  assert.equal(g.props.SETUP_SHEET_ID, liveSetup, 'nothing changed after refusals');

  const msg = g.gs.setUpTestCopy_(url(testSetup.id), url(testPlant.id));
  assert.match(msg, /TEST copy, linked to:\n• Users & Setup: TEST Users & Setup\n• Plant Health: TEST Plant Health/);
  assert.equal(g.post({ action: 'login', login: 'lee', code: '999999' }).environment, 'TEST', 'test users and codes');
  assert.equal(g.post({ action: 'login', ...LAB }).ok, false, 'live codes no longer apply');
  assert.deepEqual(g.post({ action: 'pull', login: 'lee', code: '999999' }).blocks.map((b) => b.BlockVarietyID), ['T1-TEST']);
  assert.match(g.gs.connectionsSummary_(), /This script is the TEST server/);
});

// ---------------------------------------------------------------------------
// Shared tablets: an admin/owner sets the tablet up once; workers pick their name.
// ---------------------------------------------------------------------------
test('tablet sign-in: set up once, workers pick their name or add themselves, no codes', () => {
  const g = createSeededGas({ split: true });
  assert.equal(g.setup.getSheetByName('Devices') !== null, true);
  // Only admins/owners can set up a tablet.
  assert.match(g.post({ action: 'registerDevice', ...LAB, deviceName: 'x' }).error, /Admins and owners only/);
  const reg = g.post({ action: 'registerDevice', ...ADMIN, deviceName: 'Field tablet 1' });
  assert.equal(reg.ok, true, reg.error);
  const device = { id: reg.device.id, token: reg.device.token };
  assert.equal(g.table('Devices', g.setup)[0].DeviceName, 'Field tablet 1');
  assert.notEqual(g.table('Devices', g.setup)[0].TokenHash, device.token, 'only a hash of the key is stored');

  // The name list: Users only (admins/owners use their code).
  const names = g.post({ action: 'workers', device }).workers.map((w) => w.FullName);
  assert.deepEqual(names, ['Cole Collector', 'Lee Analyst']);
  assert.equal(g.post({ action: 'workers', device: { ...device, token: 'wrong' } }).auth, true);

  // Pick a name: no code needed.
  const asLee = { device, worker: 'lab@farm.nz' };
  assert.equal(g.post({ action: 'login', ...asLee }).user.FullName, 'Lee Analyst');
  assert.match(g.post({ action: 'login', device, worker: 'admin@farm.nz' }).error, /sign in with their access code/);
  assert.match(g.post({ action: 'pull', device }).error, /Choose your name/);

  // "I'm new here"
  assert.match(g.post({ action: 'registerWorker', device, fullName: 'Lee Analyst' }).error, /already on the list/);
  assert.match(g.post({ action: 'registerWorker', ...LAB, fullName: 'Someone' }).error, /set up by an admin/);
  const sam = g.post({ action: 'registerWorker', device, fullName: '  Sam   Wilson ' });
  assert.equal(sam.ok, true, sam.error);
  assert.deepEqual([sam.user.FullName, sam.user.Role, sam.user.UserEmail], ['Sam Wilson', 'Trainee', 'sam.wilson@workers.hopfarm']);
  const sam2 = g.post({ action: 'registerWorker', device, fullName: 'Sam Wilson-Jones', email: 'SJ@farm.nz' });
  assert.equal(sam2.user.UserEmail, 'sj@farm.nz');
  assert.ok(g.post({ action: 'workers', device }).workers.some((w) => w.FullName === 'Sam Wilson'));

  // Work done by several people on the tablet uploads in one go, each change checked
  // against the person who made it.
  const asSam = { device, worker: sam.user.UserEmail };
  const r = push(g, asSam, [
    { ...newSample('sample-sam1', { CollectorEmail: sam.user.UserEmail }), actor: sam.user.UserEmail },
    { ...newSample('sample-lee1', { CollectorEmail: 'lab@farm.nz', SampleNumber: 77 }), actor: 'lab@farm.nz' },
    { ...newSample('sample-ana1', { CollectorEmail: 'admin@farm.nz', SampleNumber: 78 }), actor: 'admin@farm.nz' },
    { ...newSample('sample-bad1', { CollectorEmail: 'lab@farm.nz', SampleNumber: 79 }), actor: sam.user.UserEmail },
  ]);
  assert.deepEqual(r.results.map((x) => x.ok), [true, true, false, false]);
  assert.match(r.results[2].error, /Sign in as Ana Admin/);
  assert.match(r.results[3].error, /own name/);
  assert.equal(g.table('Samples').find((x) => x.SampleID === 'sample-lee1').LastModifiedBy, 'lab@farm.nz');
  // The owner's own change uploads once they sign in with their code on the tablet.
  const r2 = push(g, { ...ADMIN, device }, [{ ...newSample('sample-ana1', { CollectorEmail: 'admin@farm.nz', SampleNumber: 78 }), actor: 'admin@farm.nz' }]);
  assert.equal(r2.results[0].ok, true, r2.results[0].error);
  // A worker's change from a tablet can't be uploaded without the tablet's key.
  assert.match(push(g, ADMIN, [{ ...newSample('sample-x', { CollectorEmail: 'lab@farm.nz', SampleNumber: 80 }), actor: 'lab@farm.nz' }]).results[0].error, /on a set-up tablet/);
  // Workers get no reports; exports need an admin.
  assert.match(g.post({ action: 'export', ...asLee, type: 'leaves' }).error, /Admins and owners only/);

  // Owners see and remove tablets; a removed tablet stops working.
  const devices = g.post({ action: 'listDevices', ...ADMIN }).devices;
  assert.equal(devices.length, 1);
  assert.equal('TokenHash' in devices[0], false);
  assert.match(g.post({ action: 'listDevices', login: 'bea', code: '555000' }).error, /Owners only/);
  assert.equal(g.post({ action: 'setDeviceActive', ...ADMIN, deviceId: device.id, active: false }).ok, true);
  assert.match(g.post({ action: 'login', ...asLee }).error, /removed/);
});

test('tablet sign-in on an existing setup: the Devices tab is created when the first tablet is set up', () => {
  const g = createSeededGas();
  delete g.sheets.Devices;
  assert.equal(g.ss.getSheetByName('Devices'), null);
  const reg = g.post({ action: 'registerDevice', ...ADMIN, deviceName: 'Office laptop' });
  assert.equal(reg.ok, true, reg.error);
  assert.equal(g.table('Devices').length, 1);
  assert.equal(g.post({ action: 'login', device: reg.device, worker: 'col@farm.nz' }).user.FullName, 'Cole Collector');
});

test('Users reopen only samples they analysed, within 31 days; admins any time', () => {
  const g = createSeededGas();
  const BEA = { login: 'bea', code: '555000' };
  push(g, COL, [newSample('sample-0001')]);
  push(g, LAB, [newLeaf('leaf-00001', 'sample-0001', 1),
    { table: 'Samples', id: 'sample-0001', patch: { Status: 'Analysis In Progress', AnalysisStartedBy: 'lab@farm.nz', AnalysisStartedAt: new Date().toISOString() } },
    { table: 'Samples', id: 'sample-0001', patch: { Status: 'Analysis Complete', CompletedBy: 'lab@farm.nz', AnalysisCompletedAt: new Date().toISOString(), ActualLeafCount: 1, EarlyCompletionReason: 'Damaged leaves' } }]);
  let r = push(g, COL, [{ table: 'Samples', id: 'sample-0001', patch: { Status: 'Analysis In Progress' } }]);
  assert.match(r.results[0].error, /Only the person who analysed this sample/);
  r = push(g, COL, [{ table: 'LeafAnalysis', id: 'leaf-00001', patch: { TetranychusCount: 5 } }]);
  assert.match(r.results[0].error, /Only the person who analysed this sample/);
  r = push(g, LAB, [{ table: 'Samples', id: 'sample-0001', patch: { Status: 'Analysis In Progress' } }]);
  assert.equal(r.results[0].ok, true, r.results[0].error);
  r = push(g, LAB, [{ table: 'Samples', id: 'sample-0001', patch: { Status: 'Analysis Complete', EarlyCompletionReason: 'Damaged leaves' } }]);
  assert.equal(r.results[0].ok, true, r.results[0].error);
  r = push(g, BEA, [{ table: 'Samples', id: 'sample-0001', patch: { Status: 'Analysis In Progress' } }]);
  assert.equal(r.results[0].ok, true, 'admins can reopen any sample');
});

test('weekly backup: saves an Excel copy of each sheet, keeps the last 12, reports status', () => {
  const g = createSeededGas({ split: true });
  g.ss.name = 'Hop Farm Data'; g.setup.name = 'Users & Setup'; g.plant.name = 'Plant Health';
  let st = g.gs.backupStatus_();
  assert.equal(st.enabled, false);
  assert.equal(st.overdue, true, 'never backed up');

  assert.match(g.gs.enableWeeklyBackup_(), /every Sunday/);
  g.gs.enableWeeklyBackup_(); // twice: still one schedule
  assert.equal(g.triggers.length, 1);
  assert.equal(g.triggers[0].handler, 'runWeeklyBackup');

  const msg = g.gs.runBackup_();
  assert.match(msg, /Hop Farm Data – backup \d{4}-\d{2}-\d{2}\.xlsx/);
  assert.equal(g.fetched.length, 3);
  assert.ok(g.fetched.every((u) => /export\?format=xlsx$/.test(u)));
  const folder = g.driveRoot.children.find((f) => f.name === 'Hop Farm Backups');
  assert.equal(folder.files.length, 3);
  st = g.gs.backupStatus_();
  assert.equal(st.enabled, true);
  assert.equal(st.overdue, false);
  assert.equal(st.last.ok, true);

  // 13 more weeks: each sheet keeps only its newest 12
  for (let w = 1; w <= 13; w++) { g.clock.offset = w * 7 * 86400000; g.gs.runWeeklyBackup(); }
  const live = folder.files.filter((f) => !f.trashed);
  assert.equal(live.length, 36);
  for (const name of ['Hop Farm Data', 'Users & Setup', 'Plant Health']) {
    const mine = folder.files.filter((f) => f.name.startsWith(name + ' –'));
    assert.equal(mine.filter((f) => !f.trashed).length, 12, name);
    assert.ok(mine.filter((f) => f.trashed).every((f) => f.created <= mine.filter((x) => !x.trashed)[0].created), 'oldest are binned');
  }

  // a backup older than 8 days counts as overdue; turning it off is reported
  g.props.LAST_BACKUP = JSON.stringify({ at: new Date(Date.now() - 9 * 86400000).toISOString(), ok: true });
  assert.equal(g.gs.backupStatus_().overdue, true);
  assert.match(g.gs.disableWeeklyBackup_(), /off/);
  assert.equal(g.triggers.length, 0);
});

test('backup failure is recorded and shown as needing attention', () => {
  const g = createSeededGas({ split: true });
  delete g.books[g.plant.getId()]; // export fails for this one
  assert.throws(() => g.gs.runBackup_(), /Could not export/);
  const st = g.gs.backupStatus_();
  assert.equal(st.last.ok, false);
  assert.equal(st.overdue, true);
});

test('attention: admins get the issue list with sample links and backup status; users cannot', () => {
  const g = createSeededGas();
  push(g, COL, [newSample('sample-0001', { CollectionDate: '2026-01-02' })]);
  const r = g.post({ action: 'attention', login: 'bea', code: '555000' });
  assert.equal(r.ok, true, r.error);
  const waiting = r.issues.find((i) => /Waiting for analysis for \d+ days/.test(i.issue));
  assert.ok(waiting, JSON.stringify(r.issues));
  assert.equal(waiting.sampleId, 'sample-0001');
  assert.equal(r.backup.enabled, false);
  assert.equal(g.post({ action: 'attention', ...COL }).ok, false);
});

test('moving Google account: the new Hop Farm Data copy links to the new copies and starts fresh folders', () => {
  const g = createSeededGas({ split: true });
  g.ss.name = 'Hop Farm Data';
  g.props.PHOTO_FOLDER_Samples = 'old-folder'; g.props.BACKUP_FOLDER_ID = 'old-backups'; g.props.LAST_BACKUP = '{"ok":true}';
  // "Make a copy" of Users & Setup and Plant Health in the new account.
  const copy = (src, id, name) => {
    const b = g.newBook(id); b.name = name; delete b.sheets.Sheet1;
    for (const [n, sh] of Object.entries(src.sheets)) { const t = b.insertSheet(n); t.data.push(...sh.data.map((r) => r.slice())); }
    return b;
  };
  const newSetup = copy(g.setup, 'NEW_SETUP_ID_00000000000000000', 'Hop Farm - Users & Setup');
  const newPlant = copy(g.plant, 'NEW_PLANT_ID_00000000000000000', 'Hop Farm - Plant Health');
  const testSetup = copy(g.setup, 'TEST_SETUP_ID_0000000000000000', 'TEST Users & Setup');
  const url = (b) => `https://docs.google.com/spreadsheets/d/${b.getId()}/edit`;

  assert.throws(() => g.gs.linkCopiedSheets_(url(g.setup), url(newPlant)), /already linked/);
  assert.throws(() => g.gs.linkCopiedSheets_(url(testSetup), url(newPlant)), /TEST sheet/);
  assert.throws(() => g.gs.linkCopiedSheets_(url(newSetup), url(newSetup)), /two different sheets/);
  assert.equal(g.props.SETUP_SHEET_ID, g.setup.getId(), 'nothing changed after a refusal');

  const msg = g.gs.linkCopiedSheets_(url(newSetup), url(newPlant));
  assert.match(msg, /LIVE server/);
  assert.equal(g.props.SETUP_SHEET_ID, newSetup.getId());
  assert.equal(g.props.PLANT_SHEET_ID, newPlant.getId());
  assert.equal(g.props.PHOTO_FOLDER_Samples, undefined);
  assert.equal(g.props.BACKUP_FOLDER_ID, undefined);
  assert.equal(g.props.LAST_BACKUP, undefined);
  // People and codes come from the new copy.
  newSetup.sheets.Users.data[1][newSetup.sheets.Users.data[0].indexOf('AccessCode')] = '999999';
  assert.equal(g.post({ action: 'login', login: 'ana', code: '999999' }).ok, true);

  // A TEST sheet can't be linked as live.
  g.ss.name = 'TEST Hop Farm Data';
  assert.throws(() => g.gs.linkCopiedSheets_(url(newSetup), ''), /Set up as TEST copy/);
});

test('roles typed by hand in any capitalisation still work', () => {
  const g = createSeededGas();
  const users = g.sheets.Users.data;
  const iRole = users[0].indexOf('Role');
  const ana = users.findIndex((r) => r.includes('ana'));
  for (const typed of ['owner', ' OWNER ', 'administrator']) {
    users[ana][iRole] = typed;
    const r = g.post({ action: 'login', login: 'ana', code: '111111' });
    assert.equal(r.ok, true, `${typed}: ${r.error}`);
    assert.equal(r.user.Role, 'Owner');
  }
  users[ana][iRole] = 'Boss';
  assert.match(g.post({ action: 'login', login: 'ana', code: '111111' }).error, /no valid role/);
});

test('Trainees: Mite Monitoring only, pick their name on a tablet; new self-added people start as Trainees', () => {
  const g = createSeededGas({ split: true });
  const reg = g.post({ action: 'registerDevice', ...ADMIN, deviceName: 'Field tablet' });
  const device = { id: reg.device.id, token: reg.device.token };
  const sam = g.post({ action: 'registerWorker', device, fullName: 'Sam New' }).user;
  assert.equal(sam.Role, 'Trainee');
  assert.deepEqual(sam.Sections, ['Mites']);
  assert.ok(g.post({ action: 'workers', device }).workers.some((w) => w.FullName === 'Sam New'), 'on the name list');
  const asSam = { device, worker: sam.UserEmail };
  assert.equal(g.post({ action: 'login', ...asSam }).user.Role, 'Trainee');

  // Mites: allowed. Plant Health: refused, even if Sections in the sheet say otherwise.
  const users = g.setup.sheets.Users.data;
  users[users.findIndex((r) => r.includes(sam.UserEmail))][users[0].indexOf('Sections')] = 'Mites, Plant Health';
  let r = push(g, asSam, [newSample('sample-tr01', { CollectorEmail: sam.UserEmail })]);
  assert.equal(r.results[0].ok, true, r.results[0].error);
  r = push(g, asSam, [plantCheck('check-tr01', { InspectorEmail: sam.UserEmail })]);
  assert.equal(r.results[0].ok, false);
  assert.match(r.results[0].error, /Plant Health/);

  // The owner moves Sam up to User with both sections; adds a Trainee without a code.
  const save = (user, isNew = false) => g.post({ action: 'saveUser', ...ADMIN, isNew, user });
  let s = save({ UserEmail: sam.UserEmail, Username: sam.Username, FullName: 'Sam New', Role: 'User', Active: true, Sections: ['Mites', 'Plant Health'] });
  assert.equal(s.ok, true, s.error);
  assert.deepEqual(s.user.Sections, ['Mites', 'Plant Health']);
  s = save({ UserEmail: 'tia@farm.nz', Username: 'tia', FullName: 'Tia Trainee', Role: 'trainee', Sections: ['Plant Health'] }, true);
  assert.equal(s.ok, true, s.error);
  assert.equal(s.user.Role, 'Trainee');
  assert.equal(s.user.AccessCode, '', 'no code needed');
  assert.deepEqual(s.user.Sections, ['Mites'], 'Trainees get Mite Monitoring only');
});
