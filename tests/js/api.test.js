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
  assert.equal(users[0].Role, 'Administrator');
  assert.match(users[0].AccessCode, /^\d{6}$/);
  assert.equal(g.table('BlockVarieties').length, 5);
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
  assert.deepEqual(byName.user, { UserEmail: 'lab@farm.nz', Username: 'lee', FullName: 'Lee Analyst', Role: 'Analyst', Active: true });
  const ok = g.post({ action: 'login', login: 'LAB@farm.nz ', code: '333333' });
  assert.equal(ok.ok, true);
  assert.equal(ok.user.Role, 'Analyst');
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

test('roles: collectors cannot record leaves, edit others\' samples or complete analyses', () => {
  const g = createSeededGas();
  push(g, LAB, [newSample('sample-lab1', { CollectorEmail: 'lab@farm.nz' })]);
  let r = push(g, COL, [newSample('sample-0001', { CollectorEmail: 'someone@else.nz' })]);
  assert.match(r.results[0].error, /own name/);
  r = push(g, COL, [{ table: 'Samples', id: 'sample-lab1', patch: { SampleComments: 'x' } }]);
  assert.match(r.results[0].error, /own samples/);
  push(g, COL, [newSample('sample-0002')]);
  r = push(g, COL, [newLeaf('leaf-00001', 'sample-0002', 1)]);
  assert.match(r.results[0].error, /Only analysts/);
  r = push(g, COL, [{ table: 'Samples', id: 'sample-0002', patch: { Status: 'Analysis Complete' } }]);
  assert.match(r.results[0].error, /not allowed/);
  r = push(g, COL, [{ table: 'Samples', id: 'sample-0002', patch: { Status: 'Cancelled' } }]);
  assert.equal(r.results[0].ok, true);
  assert.equal(g.post({ action: 'export', ...COL, type: 'leaves' }).ok, false);
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

  // Analysts cannot change a completed sample or its leaves; admins can, and it is audited.
  let r = push(g, LAB, [{ table: 'LeafAnalysis', id: 'leaf-00001', patch: { TetranychusCount: 9 } }]);
  assert.match(r.results[0].error, /being analysed/);
  r = push(g, LAB, [{ table: 'Samples', id: 'sample-0001', patch: { AnalysisComments: 'x' } }]);
  assert.match(r.results[0].error, /administrator/);
  r = push(g, ADMIN, [{ table: 'LeafAnalysis', id: 'leaf-00001', patch: { TetranychusCount: 9 } }]);
  assert.equal(r.results[0].ok, true);
  const audit = g.table('AuditLog');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].ChangedBy, 'admin@farm.nz');
  assert.match(audit[0].Summary, /TetranychusCount: 1 → 9/);

  const exp = g.post({ action: 'export', ...LAB, type: 'leaves' });
  const lines = exp.csv.trim().split('\r\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[0], g.gs.LEAF_EXPORT_HEADERS.join(','));
  assert.match(lines[1], /^sample-0001,1042,2026\/27,2026-11-03,2026-11-02,Cole Collector,A1,Cascade,7.84,75,1,Lee Analyst,/);
  // AnalysisDateTime 2026-11-04T01:00Z is 14:00 NZDT, written so Excel reads it as a date-time.
  assert.match(lines[1], /,Lee Analyst,2026-11-04 14:00:00,/);
  assert.match(exp.filename, /^hopfarm_leaf_results_all-seasons_\d{4}-\d{2}-\d{2}\.csv$/);

  const sum = g.post({ action: 'export', ...LAB, type: 'summary', season: '2026/27' });
  const [hdr, row] = sum.csv.trim().split('\r\n').map((l) => l.split(','));
  const rec = Object.fromEntries(hdr.map((h, i) => [h, row[i]]));
  assert.equal(rec.LeavesAnalysed, '3');
  assert.equal(rec.BelowTarget, 'YES');
  assert.equal(rec.TotalTwoSM, '14'); // 9 + 2 + 3
  assert.equal(rec.EarlyCompletionReason, 'Damaged leaves');
  assert.equal(g.post({ action: 'export', ...LAB, type: 'summary', season: '1999/00' }).rows, 0);
});

test('deleted leaves disappear from exports and are sent to devices as deletions', () => {
  const g = createSeededGas();
  push(g, LAB, [newSample('sample-0001', { CollectorEmail: 'lab@farm.nz' }), newLeaf('leaf-00001', 'sample-0001', 1), newLeaf('leaf-00002', 'sample-0001', 2)]);
  const before = g.post({ action: 'pull', ...LAB });
  push(g, LAB, [{ table: 'LeafAnalysis', id: 'leaf-00002', patch: { Deleted: true } }]);
  const after = g.post({ action: 'pull', ...LAB, since: before.serverTime });
  assert.ok(after.leaves.some((l) => l.LeafAnalysisID === 'leaf-00002' && l.Deleted === true));
  assert.equal(g.post({ action: 'export', ...LAB, type: 'leaves' }).rows, 1);
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
  assert.ok(issues.some((i) => /Duplicate leaf number/.test(i)), issues.join('\n'));
});

test('data quality report and spreadsheet menu exports', () => {
  const g = createSeededGas();
  push(g, LAB, [
    newSample('sample-0001', { CollectorEmail: 'lab@farm.nz' }),
    newLeaf('leaf-00001', 'sample-0001', 1, counts(250, 0, 0, 0, 0)),
    { table: 'Samples', id: 'sample-0001', patch: { Status: 'Analysis Complete' } },
    newSample('sample-0002', { CollectorEmail: 'lab@farm.nz', BlockVarietyID: 'H1-EXAMPLE' }),
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

test('admins add and edit users; rules are enforced and changes audited', () => {
  const g = createSeededGas();
  const save = (who, user, isNew = false) => g.post({ action: 'saveUser', ...who, isNew, user });
  const add = save(ADMIN, { UserEmail: ' Sam@Farm.nz ', Username: 'Sam', FullName: 'Sam Wilson', Role: 'Collector' }, true);
  assert.equal(add.ok, true, add.error);
  assert.equal(add.user.UserEmail, 'sam@farm.nz');
  assert.equal(add.user.Username, 'sam');
  assert.match(add.user.AccessCode, /^[1-9]\d{5}$/); // generated
  const signIn = g.post({ action: 'login', login: 'sam', code: add.user.AccessCode });
  assert.equal(signIn.user.FullName, 'Sam Wilson');
  assert.equal(signIn.user.Role, 'Collector');

  // Validation
  assert.match(save(ADMIN, { UserEmail: 'sam@farm.nz', Username: 'sam2', FullName: 'X', Role: 'Collector' }, true).error, /already exists/);
  assert.match(save(ADMIN, { UserEmail: 'new@farm.nz', Username: 'lee', FullName: 'X', Role: 'Collector' }, true).error, /already taken/);
  assert.match(save(ADMIN, { UserEmail: 'new@farm.nz', Username: 'has space', FullName: 'X', Role: 'Collector' }, true).error, /Username/);
  assert.match(save(ADMIN, { UserEmail: 'not-an-email', Username: 'abc', FullName: 'X', Role: 'Collector' }, true).error, /valid email/);
  assert.match(save(ADMIN, { UserEmail: 'new@farm.nz', Username: 'abc', FullName: '', Role: 'Collector' }, true).error, /full name/);
  assert.match(save(ADMIN, { UserEmail: 'new@farm.nz', Username: 'abc', FullName: 'X', Role: 'Boss' }, true).error, /role/);
  assert.match(save(ADMIN, { UserEmail: 'new@farm.nz', Username: 'abc', FullName: 'X', Role: 'Collector', AccessCode: '0123' }, true).error, /Access code/);
  assert.match(save(ADMIN, { UserEmail: 'ghost@farm.nz', Username: 'ghost', FullName: 'X', Role: 'Collector' }).error, /not found/);

  // Promote to analyst, change code, then deactivate: the old code stops working.
  const edit = save(ADMIN, { UserEmail: 'sam@farm.nz', Username: 'sam', FullName: 'Sam Wilson', Role: 'Analyst', Active: true, AccessCode: '765432' });
  assert.equal(edit.user.Role, 'Analyst');
  assert.equal(g.post({ action: 'login', login: 'sam', code: add.user.AccessCode }).ok, false);
  assert.equal(g.post({ action: 'login', login: 'sam', code: '765432' }).user.Role, 'Analyst');
  save(ADMIN, { UserEmail: 'sam@farm.nz', Username: 'sam', FullName: 'Sam Wilson', Role: 'Analyst', Active: false });
  assert.match(g.post({ action: 'login', login: 'sam', code: '765432' }).error, /not active/);

  // Admins cannot lock themselves out; non-admins cannot manage users.
  assert.match(save(ADMIN, { UserEmail: 'admin@farm.nz', Username: 'ana', FullName: 'Ana Admin', Role: 'Analyst', Active: true }).error, /your own administrator/);
  assert.match(save(ADMIN, { UserEmail: 'admin@farm.nz', Username: 'ana', FullName: 'Ana Admin', Role: 'Administrator', Active: false }).error, /your own administrator/);
  assert.match(save(LAB, { UserEmail: 'x@farm.nz', Username: 'x', FullName: 'X', Role: 'Administrator' }, true).error, /Administrators only/);
  assert.equal(g.post({ action: 'listUsers', ...LAB }).ok, false);

  // Other administrators are view-only; an admin can still change their own details and code.
  const bob = save(ADMIN, { UserEmail: 'bob@farm.nz', Username: 'bob', FullName: 'Bob Boss', Role: 'Administrator' }, true);
  assert.equal(bob.ok, true);
  const BOB = { login: 'bob', code: bob.user.AccessCode };
  for (const change of [{ AccessCode: '999999' }, { Role: 'Analyst' }, { Active: false }, { FullName: 'Renamed' }]) {
    const r = save(BOB, { UserEmail: 'admin@farm.nz', Username: 'ana', FullName: 'Ana Admin', Role: 'Administrator', Active: true, ...change });
    assert.match(r.error, /viewed but not changed/, JSON.stringify(change));
  }
  assert.equal(g.post({ action: 'login', login: 'ana', code: '111111' }).ok, true, 'Ana unchanged');
  assert.equal(g.post({ action: 'listUsers', ...BOB }).users.find((u) => u.Username === 'ana').AccessCode, '111111', 'codes are visible');
  const own = save(BOB, { UserEmail: 'bob@farm.nz', Username: 'bobby', FullName: 'Bob B', Role: 'Administrator', Active: true, AccessCode: '424242' });
  assert.equal(own.ok, true, own.error);
  assert.equal(g.post({ action: 'login', login: 'bobby', code: '424242' }).user.FullName, 'Bob B');

  const list = g.post({ action: 'listUsers', ...ADMIN });
  assert.ok(list.users.find((u) => u.UserEmail === 'sam@farm.nz').AccessCode === '765432');
  const audit = g.table('AuditLog').filter((a) => a.TableName === 'Users').map((a) => a.Summary);
  assert.deepEqual(audit, ['Added as Collector', 'Role: Collector → Analyst; AccessCode changed', 'Active: true → false',
    'Added as Administrator', 'Username: bob → bobby; FullName: Bob Boss → Bob B; AccessCode changed']);
  assert.ok(audit.every((x) => !/765432/.test(x)), 'codes never written to the audit log');
});
