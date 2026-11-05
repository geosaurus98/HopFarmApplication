// Smoke test for apps-script/Setup.gs using a minimal in-memory SpreadsheetApp mock.
// Run: node tests/gs_smoke.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

function makeSheet(name, ss) {
  const data = []; // 2D array, 1-indexed access via helpers
  const sh = {
    name, data,
    getName: () => name,
    getLastRow: () => { for (let r = data.length; r > 0; r--) if ((data[r-1]||[]).some(v => v !== '' && v != null)) return r; return 0; },
    getLastColumn: () => data.reduce((m, r) => { let c = r.length; while (c > 0 && (r[c-1] === '' || r[c-1] == null)) c--; return Math.max(m, c); }, 0),
    getMaxRows: () => 1000,
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({length: nr}, (_, i) => Array.from({length: nc}, (_, j) => ((data[r-1+i]||[])[c-1+j] ?? ''))),
      setValues: (vals) => { vals.forEach((row, i) => row.forEach((v, j) => { (data[r-1+i] = data[r-1+i] || [])[c-1+j] = v; })); return rangeStub; },
      setValue: (v) => { (data[r-1] = data[r-1] || [])[c-1] = v; return rangeStub; },
      setFontWeight: () => rangeStub, setBackground: () => rangeStub, setNumberFormat() { return this; }, setDataValidation() { return this; },
    }),
    setFrozenRows: () => {}, clearContents: () => { data.length = 0; }, activate: () => {},
  };
  const rangeStub = { setFontWeight: () => rangeStub, setBackground: () => rangeStub };
  return sh;
}
const sheets = {};
const ss = {
  getSheetByName: n => sheets[n] || null,
  insertSheet: n => (sheets[n] = makeSheet(n, ss)),
  getSheets: () => Object.values(sheets),
  deleteSheet: s => delete sheets[s.name],
  toast: () => {},
};
sheets.Sheet1 = makeSheet('Sheet1', ss);
const builder = new Proxy({}, { get: (t, k) => k === 'build' ? () => ({}) : () => builder });
const globals = {
  SpreadsheetApp: { getActive: () => ss, newDataValidation: () => builder, getUi: () => ({}) },
  Session: { getActiveUser: () => ({ getEmail: () => 'boss@farm.nz' }) },
};
const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Setup.gs'), 'utf8');
const api = new Function(...Object.keys(globals), src +
  '; return {setupHopFarmWorkbook, buildLeafExport, buildSampleSummary, buildDataQualityReport, SCHEMA, REPORT_TABS};')(...Object.values(globals));

api.setupHopFarmWorkbook();
api.setupHopFarmWorkbook(); // idempotent
assert(!sheets.Sheet1, 'default Sheet1 removed');
for (const [t, h] of Object.entries(api.SCHEMA)) assert.deepStrictEqual(sheets[t].data[0], h, t);
assert.strictEqual(sheets.Users.getLastRow(), 2);
assert.strictEqual(sheets.BlockVarieties.getLastRow(), 6);
assert.strictEqual(sheets.HelpReference.data[1][0], 'H01');

const put = (t, obj) => { const h = sheets[t].data[0]; sheets[t].data.push(h.map(k => obj[k] ?? '')); };
put('Samples', { SampleID: 's1', SampleNumber: 1042, Season: '2026/27', CollectionDate: new Date('2026-11-02'), CollectorEmail: 'boss@farm.nz', BlockVarietyID: 'A1-CASCADE', Block: 'A1', Variety: 'Cascade', AreaHaAtCollection: 7.84, TargetLeafCount: 75, Status: 'Analysis Complete', ActualLeafCount: 2 });
put('Samples', { SampleID: 's2', SampleNumber: 1042, Season: '2026/27', CollectionDate: new Date('2026-11-03'), CollectorEmail: 'boss@farm.nz', BlockVarietyID: 'H1-EXAMPLE', Block: 'H1', Variety: 'Example', AreaHaAtCollection: 3.38, TargetLeafCount: 60, Status: 'Analysis Complete' });
put('LeafAnalysis', { LeafAnalysisID: 'l1', SampleID: 's1', LeafNumber: 1, TetranychusCount: 3, PhytoseiulusCount: 1, TwoSpotEggCount: 0, PredatorEggCount: 0, OtherBeneficialCount: 0 });
put('LeafAnalysis', { LeafAnalysisID: 'l2', SampleID: 's1', LeafNumber: 1, TetranychusCount: 250, PhytoseiulusCount: 0, TwoSpotEggCount: 0, PredatorEggCount: 0, OtherBeneficialCount: '' });
put('LeafAnalysis', { LeafAnalysisID: 'l3', SampleID: 'ghost', LeafNumber: 1, TetranychusCount: 0, PhytoseiulusCount: 0, TwoSpotEggCount: 0, PredatorEggCount: 0, OtherBeneficialCount: 0 });

api.buildLeafExport();
const exp = sheets[api.REPORT_TABS.leafExport].data;
assert.strictEqual(exp.length, 3, 'two leaf rows + header (orphan excluded)');
assert.strictEqual(exp[1][4], 'boss', 'collector name resolved');

api.buildSampleSummary();
const sum = sheets[api.REPORT_TABS.sampleSummary].data;
assert.strictEqual(sum[1][8], 2); assert.strictEqual(sum[1][10], 253);

api.buildDataQualityReport();
const issues = sheets[api.REPORT_TABS.dataQuality].data.slice(1).map(r => r[4]);
const expect = ['Duplicate leaf number', 'does not exist', 'OtherBeneficialCount is blank', 'no leaf records',
  'does not match AreaHaAtCollection', 'Bag number also used', 'unusually high', 'Completed below target'];
for (const e of expect) assert(issues.some(i => i.includes(e)), 'missing issue: ' + e + '\n' + issues.join('\n'));
console.log('Apps Script smoke test passed (' + issues.length + ' data-quality issues detected as expected).');
