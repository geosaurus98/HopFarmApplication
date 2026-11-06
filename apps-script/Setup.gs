/**
 * Hop Farm Application — Google Sheets backend
 * Nelson Lakes Hops · Mite Monitoring
 *
 * This file: workbook structure, shared helpers, and the spreadsheet
 * "Hop Farm" menu (exports and data-quality report).
 * Api.gs:    the web API used by the tablet app.
 *
 * Setup is described step by step in docs/setup-guide.md.
 * The script is safe to re-run: it never deletes or reorders existing data.
 */

// ---------------------------------------------------------------------------
// Schema. Keep in sync with templates/*.csv (checked by tests/test_schema.py).
// Columns are found by header name, so their order in the sheet can change.
// ---------------------------------------------------------------------------
const SCHEMA = {
  Users: ['UserEmail', 'UserName', 'Role', 'Active', 'AccessCode', 'CreatedAt', 'UpdatedAt'],
  BlockVarieties: ['BlockVarietyID', 'Block', 'Variety', 'AreaHa', 'Active', 'Notes', 'UpdatedAt'],
  Samples: [
    'SampleID', 'SampleNumber', 'CollectionDate', 'Season', 'CollectorEmail',
    'BlockVarietyID', 'Block', 'Variety', 'AreaHaAtCollection', 'TargetLeafCount',
    'SampleComments', 'SamplePhoto1', 'SamplePhoto2', 'Status',
    'AnalysisStartedAt', 'AnalysisStartedBy', 'AnalysisCompletedAt', 'CompletedBy',
    'ActualLeafCount', 'AnalysisComments', 'EarlyCompletionReason',
    'CreatedAt', 'UpdatedAt', 'LastModifiedBy'
  ],
  LeafAnalysis: [
    'LeafAnalysisID', 'SampleID', 'LeafNumber', 'AnalystEmail', 'AnalysisDateTime',
    'TetranychusCount', 'PhytoseiulusCount', 'TwoSpotEggCount', 'PredatorEggCount',
    'OtherBeneficialCount', 'OtherBeneficialDescription', 'LeafComment', 'LeafPhoto',
    'Deleted', 'CreatedAt', 'UpdatedAt', 'LastModifiedBy'
  ],
  AuditLog: ['AuditID', 'TableName', 'RowID', 'ChangedBy', 'ChangedAt', 'Summary'],
  HelpReference: ['HelpID', 'Category', 'Title', 'Description', 'Image', 'SortOrder']
};

const KEYS = {
  Users: 'UserEmail', BlockVarieties: 'BlockVarietyID', Samples: 'SampleID',
  LeafAnalysis: 'LeafAnalysisID', AuditLog: 'AuditID', HelpReference: 'HelpID'
};

const DATE_COLUMNS = ['CollectionDate'];
const DATETIME_COLUMNS = ['CreatedAt', 'UpdatedAt', 'AnalysisStartedAt', 'AnalysisCompletedAt',
  'AnalysisDateTime', 'ChangedAt'];
const BOOL_COLUMNS = ['Active', 'Deleted'];

const REPORT_TABS = {
  leafExport: 'Export_LeafResults',
  sampleSummary: 'Export_SampleSummary',
  dataQuality: 'Report_DataQuality'
};

const STATUS = {
  DRAFT: 'Draft',
  AWAITING: 'Awaiting Analysis',
  IN_PROGRESS: 'Analysis In Progress',
  COMPLETE: 'Analysis Complete',
  CANCELLED: 'Cancelled'
};
const STATUS_LIST = [STATUS.DRAFT, STATUS.AWAITING, STATUS.IN_PROGRESS, STATUS.COMPLETE, STATUS.CANCELLED];
const ROLES = ['Collector', 'Analyst', 'Administrator'];

const COUNT_FIELDS = ['TetranychusCount', 'PhytoseiulusCount', 'TwoSpotEggCount',
  'PredatorEggCount', 'OtherBeneficialCount'];

const HIGH_COUNT_THRESHOLD = 100;   // per-leaf count that is flagged for review
const STALE_ANALYSIS_DAYS = 7;      // "In Progress" longer than this is flagged

// ---------------------------------------------------------------------------
// Calculations — identical to app/js/logic.js and tools/leaf_target.py
// ---------------------------------------------------------------------------

/** Required Leaves = MAX(50, FLOOR((AreaHa × 10) / 5) × 5) */
function requiredLeaves(areaHa) {
  const area = Number(areaHa);
  if (areaHa === '' || areaHa === null || !isFinite(area) || area <= 0) return null;
  return Math.max(50, Math.floor((area * 10) / 5) * 5);
}

/** Custom sheet function: =REQUIRED_LEAVES(D2) */
function REQUIRED_LEAVES(areaHa) {
  if (Array.isArray(areaHa)) return areaHa.map(r => r.map(requiredLeaves));
  return requiredLeaves(areaHa);
}

/** NZ season, 1 July – 30 June: '2026-11-05' -> '2026/27'. Accepts 'YYYY-MM-DD'. */
function seasonOf(isoDate) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(isoDate));
  if (!m) return '';
  const y = Number(m[1]);
  const start = Number(m[2]) >= 7 ? y : y - 1;
  return start + '/' + String(start + 1).slice(-2);
}

/** Monday of the week containing the date, 'YYYY-MM-DD' (for weekly trend pivots). */
function weekStarting(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate));
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Hop Farm')
    .addItem('Build leaf results export (one row per leaf)', 'buildLeafExport')
    .addItem('Build sample summary (one row per sample)', 'buildSampleSummary')
    .addItem('Run data quality report', 'buildDataQualityReport')
    .addSeparator()
    .addItem('Repair / extend workbook structure', 'setupHopFarmWorkbook')
    .addToUi();
}

// ---------------------------------------------------------------------------
// Workbook setup
// ---------------------------------------------------------------------------
function setupHopFarmWorkbook() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SCHEMA).forEach(name => ensureSheet_(ss, name, SCHEMA[name]));
  applyFormatsAndValidation_(ss);

  const seededUsers = defaultUsers_();
  const addedAdmin = seedIfEmpty_(ss.getSheetByName('Users'), seededUsers);
  seedIfEmpty_(ss.getSheetByName('BlockVarieties'), exampleBlockVarieties_());
  seedIfEmpty_(ss.getSheetByName('HelpReference'), helpContent_());

  const sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && sheet1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sheet1);

  ss.toast(addedAdmin && seededUsers.length
    ? 'Workbook ready. Your app access code is ' + seededUsers[0].AccessCode + ' (see the Users tab).'
    : 'Hop Farm workbook is ready.', 'Hop Farm', 15);
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const lastCol = sh.getLastColumn();
  const existing = lastCol > 0
    ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String).filter(h => h !== '')
    : [];
  if (existing.length === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const missing = headers.filter(h => existing.indexOf(h) === -1);
    if (missing.length) sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#e8f0e3');
  return sh;
}

function colIndex_(sh, header) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const i = headers.indexOf(header);
  if (i === -1) throw new Error('Column ' + header + ' not found on ' + sh.getName());
  return i + 1;
}

function columnRange_(sh, header) {
  return sh.getRange(2, colIndex_(sh, header), sh.getMaxRows() - 1, 1);
}

/** Protects data when someone edits the sheet by hand. The API validates too. */
function applyFormatsAndValidation_(ss) {
  const nonNegInt = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=OR(ISBLANK(INDIRECT("RC",FALSE)),AND(ISNUMBER(INDIRECT("RC",FALSE)),INDIRECT("RC",FALSE)>=0,INDIRECT("RC",FALSE)=INT(INDIRECT("RC",FALSE))))')
    .setAllowInvalid(false)
    .setHelpText('Counts must be whole numbers of 0 or more.')
    .build();
  const positive = SpreadsheetApp.newDataValidation()
    .requireNumberGreaterThan(0).setAllowInvalid(false)
    .setHelpText('Area must be greater than zero hectares.').build();
  const statusList = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_LIST, true).setAllowInvalid(false).build();
  const roleList = SpreadsheetApp.newDataValidation()
    .requireValueInList(ROLES, true).setAllowInvalid(false).build();

  const leaf = ss.getSheetByName('LeafAnalysis');
  COUNT_FIELDS.concat(['LeafNumber']).forEach(h =>
    columnRange_(leaf, h).setNumberFormat('0').setDataValidation(nonNegInt));
  ['AnalysisDateTime', 'CreatedAt', 'UpdatedAt'].forEach(h =>
    columnRange_(leaf, h).setNumberFormat('yyyy-mm-dd hh:mm:ss'));

  const bv = ss.getSheetByName('BlockVarieties');
  columnRange_(bv, 'AreaHa').setNumberFormat('0.00').setDataValidation(positive);
  columnRange_(bv, 'UpdatedAt').setNumberFormat('yyyy-mm-dd hh:mm:ss');

  const samples = ss.getSheetByName('Samples');
  columnRange_(samples, 'Status').setDataValidation(statusList);
  columnRange_(samples, 'CollectionDate').setNumberFormat('yyyy-mm-dd');
  columnRange_(samples, 'AreaHaAtCollection').setNumberFormat('0.00');
  ['TargetLeafCount', 'ActualLeafCount', 'SampleNumber'].forEach(h =>
    columnRange_(samples, h).setNumberFormat('0'));
  ['AnalysisStartedAt', 'AnalysisCompletedAt', 'CreatedAt', 'UpdatedAt'].forEach(h =>
    columnRange_(samples, h).setNumberFormat('yyyy-mm-dd hh:mm:ss'));

  const users = ss.getSheetByName('Users');
  columnRange_(users, 'Role').setDataValidation(roleList);
  columnRange_(users, 'AccessCode').setNumberFormat('@');
}

/** Returns true if rows were written. */
function seedIfEmpty_(sh, rows) {
  if (sh.getLastRow() > 1 || rows.length === 0) return false;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const values = rows.map(obj => headers.map(h => (h in obj ? obj[h] : '')));
  sh.getRange(2, 1, values.length, headers.length).setValues(values);
  return true;
}

function newAccessCode_() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function defaultUsers_() {
  const me = Session.getActiveUser().getEmail();
  const now = new Date();
  return me ? [{
    UserEmail: me, UserName: me.split('@')[0], Role: 'Administrator', Active: true,
    AccessCode: newAccessCode_(), CreatedAt: now, UpdatedAt: now
  }] : [];
}

/** EXAMPLE rows only — replace with the farm's real blocks and areas. */
function exampleBlockVarieties_() {
  const now = new Date();
  return [
    ['A1', 'Cascade', 7.84], ['C2', 'Riwaka', 5.00], ['L2', 'SBH-02', 4.20],
    ['H1', 'Example', 3.38], ['K2', 'Example', 11.77]
  ].map(r => ({
    BlockVarietyID: r[0] + '-' + String(r[1]).toUpperCase().replace(/[^A-Z0-9]+/g, ''),
    Block: r[0], Variety: r[1], AreaHa: r[2], Active: true,
    Notes: 'EXAMPLE ROW – replace with the real block, variety and area', UpdatedAt: now
  }));
}

/** Starter help text. Check against the farm's own posters; add photo links in Image. */
function helpContent_() {
  const rows = [
    ['Identification', 'Two-spotted spider mite (Tetranychus urticae) — "TwoSM"',
     'Pest mite. Adults about 0.5 mm, oval, pale yellow-green to straw coloured with two dark spots on the body (the spots are food showing through). Usually on the underside of the leaf, often with fine webbing and pale stippling damage on the upper surface. Overwintering females can be orange-red — do not confuse with P. persimilis. Count every live mobile stage (adults and nymphs) as TwoSM.'],
    ['Identification', 'Two-spotted mite eggs',
     'Tiny (about 0.13 mm), perfectly round, clear to pearly white when laid, turning creamy as they develop. Often among webbing on the leaf underside. Record as "TwoSM eggs", not in the live count.'],
    ['Identification', 'Phytoseiulus persimilis (PP) — predatory mite',
     'Beneficial predator. Slightly larger than TwoSM, bright orange-red, pear/teardrop shaped, no dark spots, long front legs and moves quickly. Count adults and nymphs as PP.'],
    ['Identification', 'Predator eggs',
     'Oval rather than round and roughly twice the size of TwoSM eggs; pinkish-orange to pale when fresh. Record as "Predator eggs".'],
    ['Identification', 'Ladybirds (including the mite-eating Stethorus)',
     'Stethorus is a very small (about 1.5 mm) shiny black ladybird whose adults and larvae eat spider mites. Larger ladybirds and their larvae may also be present. Count under "Other beneficials" and choose the type.'],
    ['Identification', 'Lacewings',
     'Green or brown lacewing larvae are long with large curved jaws; eggs sit on fine stalks. Count under "Other beneficials" and choose the type.'],
    ['Identification', 'Other beneficial organisms',
     'Predatory thrips, predatory midge larvae (orange maggots in mite colonies), predatory bugs, spiders. Count under "Other beneficials" and choose or type the type. If unsure, add a leaf comment and photo.'],
    ['How to', 'Collecting a sample in the field',
     '1) Before leaving Wi-Fi, open the app and check it says "All changes synced". 2) Tap New Mite Sample. 3) Enter the number written on the bag. 4) Choose the block and variety — the app shows how many leaves to collect. 5) Add comments or photos if something is unusual. 6) Tap Save sample. It is stored on the tablet even with no signal.'],
    ['How to', 'Analysing a sample in the office',
     '1) Open Analyse Samples and choose the sample. 2) Check the bag number matches. 3) Tap Start analysis. 4) Enter the five counts and tap Save & next leaf — the next leaf opens automatically. 5) To pause, tap Save & stop (or Stop without saving on an empty leaf). Nothing is lost. 6) When all leaves are done, tap Complete analysis.'],
    ['How to', 'Zero means "looked and found none"',
     'Enter 0 when you have checked the leaf and found none of that organism. Blank counts cannot be saved, so a blank can never be mistaken for zero. The "Blanks → 0" button fills every empty count with 0 in one tap.'],
    ['How to', 'Syncing and offline use',
     'The badge at the top shows how many changes are waiting to upload. They upload automatically when the tablet has internet; tap the badge and then Sync now to force it. Do not sign out or clear the browser data while changes are waiting.'],
    ['How to', 'Getting the data into Excel',
     'Open Reports and tap "Leaf results CSV" (one row per leaf) or "Sample summary CSV" (one row per sample, with totals and averages). Open the file in Excel and use a PivotTable — for example rows = WeekStarting, columns = Block, values = average of AvgTwoSMPerLeaf — to see trends.']
  ];
  return rows.map((r, i) => ({
    HelpID: 'H' + String(i + 1).padStart(2, '0'), Category: r[0], Title: r[1],
    Description: r[2], Image: '', SortOrder: i + 1
  }));
}

// ---------------------------------------------------------------------------
// Reading and serialising tables
// ---------------------------------------------------------------------------
function tz_() {
  return SpreadsheetApp.getActive().getSpreadsheetTimeZone() || Session.getScriptTimeZone();
}

/** Raw rows (Date objects etc.) as objects keyed by header. */
function readTable_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const headers = values.shift();
  return values
    .filter(r => r.some(v => v !== '' && v !== null))
    .map(r => headers.reduce((o, h, i) => { if (h !== '') o[h] = r[i]; return o; }, {}));
}

function toBool_(v) {
  return v === true || String(v).trim().toUpperCase() === 'TRUE' || String(v) === '1';
}

/** Sheet value -> JSON value. Dates become 'YYYY-MM-DD' or ISO strings. */
function serializeValue_(col, v) {
  if (BOOL_COLUMNS.indexOf(col) !== -1) return toBool_(v);
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return DATE_COLUMNS.indexOf(col) !== -1
      ? Utilities.formatDate(v, tz_(), 'yyyy-MM-dd')
      : v.toISOString();
  }
  return v === null || v === undefined ? '' : v;
}

function serializeRow_(row) {
  const out = {};
  Object.keys(row).forEach(k => { out[k] = serializeValue_(k, row[k]); });
  return out;
}

/** JSON value -> sheet value. */
function deserializeValue_(col, v) {
  if (v === null || v === undefined || v === '') return '';
  if (BOOL_COLUMNS.indexOf(col) !== -1) return toBool_(v);
  if (DATE_COLUMNS.indexOf(col) !== -1) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
    if (!m) throw new Error(col + ' must be a date');
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0); // midday: no TZ edge
  }
  if (DATETIME_COLUMNS.indexOf(col) !== -1) {
    const d = new Date(v);
    if (isNaN(d.getTime())) throw new Error(col + ' must be a date and time');
    return d;
  }
  return v;
}

/** Farm-local 'yyyy-MM-dd HH:mm:ss' — Excel reads this as a date and time. */
function localDateTime_(v) {
  const d = v instanceof Date ? v : (v ? new Date(v) : null);
  return d && !isNaN(d.getTime()) ? Utilities.formatDate(d, tz_(), 'yyyy-MM-dd HH:mm:ss') : '';
}

function isoDate_(v) {
  return v instanceof Date ? Utilities.formatDate(v, tz_(), 'yyyy-MM-dd') : String(v || '').slice(0, 10);
}

// ---------------------------------------------------------------------------
// Export rows (used by the menu and by the API's export action)
// ---------------------------------------------------------------------------
const LEAF_EXPORT_HEADERS = [
  'SampleID', 'SampleNumber', 'Season', 'CollectionDate', 'WeekStarting', 'Collector', 'Block',
  'Variety', 'AreaHa', 'TargetLeafCount', 'LeafNumber', 'Analyst', 'AnalysisDateTime',
  'TetranychusCount', 'PhytoseiulusCount', 'TwoSpotEggCount', 'PredatorEggCount',
  'OtherBeneficialCount', 'OtherBeneficialDescription', 'LeafComment', 'SampleComments',
  'AnalysisComments', 'SampleStatus', 'SamplePhoto1', 'SamplePhoto2', 'LeafPhoto'
];

const SUMMARY_HEADERS = [
  'SampleID', 'SampleNumber', 'Season', 'CollectionDate', 'WeekStarting', 'Block', 'Variety',
  'Status', 'TargetLeafCount', 'LeavesAnalysed', 'BelowTarget',
  'TotalTwoSM', 'AvgTwoSMPerLeaf', 'TotalPP', 'AvgPPPerLeaf',
  'TotalTwoSMEggs', 'TotalPredatorEggs', 'TotalOtherBeneficial',
  'PredatorToPestRatio', 'LeavesWithTwoSM', 'PctLeavesWithTwoSM', 'EarlyCompletionReason'
];

function userNames_() {
  return readTable_('Users').reduce((m, u) => { m[String(u.UserEmail).toLowerCase()] = u.UserName; return m; }, {});
}

function nameOf_(names, email) {
  return names[String(email).toLowerCase()] || email || '';
}

function matchesFilter_(s, filter) {
  filter = filter || {};
  if (filter.season && s.Season !== filter.season) return false;
  if (filter.blockVarietyId && s.BlockVarietyID !== filter.blockVarietyId) return false;
  return true;
}

function liveLeaves_() {
  return readTable_('LeafAnalysis').filter(l => !toBool_(l.Deleted));
}

function leafExportRows_(filter) {
  const names = userNames_();
  const samples = readTable_('Samples')
    .filter(s => s.Status !== STATUS.CANCELLED && matchesFilter_(s, filter))
    .reduce((m, s) => { m[s.SampleID] = s; return m; }, {});
  return liveLeaves_()
    .filter(l => samples[l.SampleID])
    .sort((a, b) => {
      const sa = samples[a.SampleID], sb = samples[b.SampleID];
      return isoDate_(sa.CollectionDate).localeCompare(isoDate_(sb.CollectionDate)) ||
        (Number(sa.SampleNumber) - Number(sb.SampleNumber)) ||
        String(a.SampleID).localeCompare(String(b.SampleID)) ||
        (Number(a.LeafNumber) - Number(b.LeafNumber));
    })
    .map(l => {
      const s = samples[l.SampleID];
      const d = isoDate_(s.CollectionDate);
      return [
        s.SampleID, s.SampleNumber, s.Season, d, weekStarting(d), nameOf_(names, s.CollectorEmail),
        s.Block, s.Variety, s.AreaHaAtCollection, s.TargetLeafCount, l.LeafNumber,
        nameOf_(names, l.AnalystEmail), localDateTime_(l.AnalysisDateTime),
        l.TetranychusCount, l.PhytoseiulusCount, l.TwoSpotEggCount, l.PredatorEggCount,
        l.OtherBeneficialCount, l.OtherBeneficialDescription, l.LeafComment, s.SampleComments,
        s.AnalysisComments, s.Status, s.SamplePhoto1, s.SamplePhoto2, l.LeafPhoto
      ];
    });
}

function sampleSummaryRows_(filter) {
  const leavesBySample = groupBy_(liveLeaves_(), 'SampleID');
  return readTable_('Samples')
    .filter(s => s.Status !== STATUS.CANCELLED && matchesFilter_(s, filter))
    .sort((a, b) => isoDate_(a.CollectionDate).localeCompare(isoDate_(b.CollectionDate)) ||
      (Number(a.SampleNumber) - Number(b.SampleNumber)))
    .map(s => {
      const leaves = leavesBySample[s.SampleID] || [];
      const n = leaves.length;
      const sum = k => leaves.reduce((t, l) => t + (Number(l[k]) || 0), 0);
      const tsm = sum('TetranychusCount'), pp = sum('PhytoseiulusCount');
      const infested = leaves.filter(l => Number(l.TetranychusCount) > 0).length;
      const d = isoDate_(s.CollectionDate);
      return [
        s.SampleID, s.SampleNumber, s.Season, d, weekStarting(d), s.Block, s.Variety, s.Status,
        s.TargetLeafCount, n, n < Number(s.TargetLeafCount) ? 'YES' : 'NO',
        tsm, n ? round_(tsm / n) : '', pp, n ? round_(pp / n) : '',
        sum('TwoSpotEggCount'), sum('PredatorEggCount'), sum('OtherBeneficialCount'),
        tsm ? round_(pp / tsm) : '', infested, n ? round_(infested / n) : '', s.EarlyCompletionReason
      ];
    });
}

function toCsv_(headers, rows) {
  const esc = v => {
    const s = v === null || v === undefined ? '' : (v instanceof Date ? v.toISOString() : String(v));
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers].concat(rows).map(r => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Menu reports
// ---------------------------------------------------------------------------
function writeReport_(tabName, headers, rows) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(tabName);
  if (!sh) sh = ss.insertSheet(tabName);
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sh.setFrozenRows(1);
  sh.getRange(1, headers.length + 2).setValue('Generated ' + new Date().toISOString());
  return sh;
}

function buildLeafExport() {
  const rows = leafExportRows_();
  writeReport_(REPORT_TABS.leafExport, LEAF_EXPORT_HEADERS, rows).activate();
  SpreadsheetApp.getActive().toast(rows.length + ' leaf rows. File > Download to save as Excel or CSV.', 'Hop Farm', 8);
}

function buildSampleSummary() {
  writeReport_(REPORT_TABS.sampleSummary, SUMMARY_HEADERS, sampleSummaryRows_()).activate();
}

function buildDataQualityReport() {
  writeReport_(REPORT_TABS.dataQuality, ['Severity', 'Table', 'RowID', 'Record', 'Issue'],
    dataQualityIssues_()).activate();
}

function dataQualityIssues_() {
  const samples = readTable_('Samples');
  const leaves = liveLeaves_();
  const blocks = readTable_('BlockVarieties');
  const leavesBySample = groupBy_(leaves, 'SampleID');
  const sampleIds = new Set(samples.map(s => s.SampleID));
  const issues = [];
  const add = (sev, table, id, label, issue) => issues.push([sev, table, id, label, issue]);
  const now = new Date();

  blocks.forEach(b => {
    if (!(Number(b.AreaHa) > 0)) add('ERROR', 'BlockVarieties', b.BlockVarietyID, b.Block + ' - ' + b.Variety, 'Area missing or not greater than zero');
  });

  const seen = {};
  samples.forEach(s => {
    const label = 'Bag ' + s.SampleNumber + ' · ' + s.Block + ' - ' + s.Variety;
    const n = (leavesBySample[s.SampleID] || []).length;
    ['SampleNumber', 'CollectionDate', 'CollectorEmail', 'BlockVarietyID', 'TargetLeafCount', 'Status']
      .forEach(f => { if (s[f] === '' || s[f] === null) add('ERROR', 'Samples', s.SampleID, label, f + ' is blank'); });
    if (s.TargetLeafCount !== '' && Number(s.TargetLeafCount) !== requiredLeaves(s.AreaHaAtCollection)) {
      add('WARN', 'Samples', s.SampleID, label, 'TargetLeafCount does not match AreaHaAtCollection');
    }
    if (s.Status === STATUS.COMPLETE && n === 0) add('ERROR', 'Samples', s.SampleID, label, 'Marked complete with no leaf records');
    if (s.Status === STATUS.COMPLETE && s.ActualLeafCount !== '' && Number(s.ActualLeafCount) !== n) {
      add('WARN', 'Samples', s.SampleID, label, 'ActualLeafCount (' + s.ActualLeafCount + ') differs from leaf records (' + n + ') — leaves edited after completion?');
    }
    if (s.Status === STATUS.COMPLETE && n < Number(s.TargetLeafCount)) {
      add('INFO', 'Samples', s.SampleID, label, 'Completed below target (' + n + ' of ' + s.TargetLeafCount + ')' + (s.EarlyCompletionReason ? ' — ' + s.EarlyCompletionReason : ' — no reason given'));
    }
    if (s.Status === STATUS.IN_PROGRESS && s.AnalysisStartedAt &&
        (now - new Date(s.AnalysisStartedAt)) / 86400000 > STALE_ANALYSIS_DAYS) {
      add('WARN', 'Samples', s.SampleID, label, 'Analysis in progress for more than ' + STALE_ANALYSIS_DAYS + ' days');
    }
    if (s.Status === STATUS.AWAITING && n > 0) add('WARN', 'Samples', s.SampleID, label, 'Has leaf records but status is still Awaiting Analysis');
    if (s.Status !== STATUS.CANCELLED) {
      const key = s.Season + '|' + s.SampleNumber;
      if (seen[key]) add('WARN', 'Samples', s.SampleID, label, 'Bag number also used by sample ' + seen[key] + ' in season ' + s.Season);
      else seen[key] = s.SampleID;
    }
  });

  const leafKeys = {};
  leaves.forEach(l => {
    const label = 'Sample ' + l.SampleID + ' · Leaf ' + l.LeafNumber;
    if (!sampleIds.has(l.SampleID)) add('ERROR', 'LeafAnalysis', l.LeafAnalysisID, label, 'Leaf belongs to a sample that does not exist');
    const key = l.SampleID + '|' + l.LeafNumber;
    if (leafKeys[key]) add('ERROR', 'LeafAnalysis', l.LeafAnalysisID, label, 'Duplicate leaf number within sample (also ' + leafKeys[key] + ')');
    else leafKeys[key] = l.LeafAnalysisID;
    COUNT_FIELDS.forEach(c => {
      const v = l[c];
      if (v === '' || v === null) add('ERROR', 'LeafAnalysis', l.LeafAnalysisID, label, c + ' is blank');
      else if (Number(v) < 0 || Number(v) !== Math.floor(Number(v))) add('ERROR', 'LeafAnalysis', l.LeafAnalysisID, label, c + ' is not a non-negative whole number');
      else if (Number(v) > HIGH_COUNT_THRESHOLD) add('INFO', 'LeafAnalysis', l.LeafAnalysisID, label, c + ' is unusually high (' + v + ')');
    });
  });

  const order = { ERROR: 0, WARN: 1, INFO: 2 };
  issues.sort((a, b) => order[a[0]] - order[b[0]]);
  return issues;
}

function groupBy_(rows, key) {
  return rows.reduce((m, r) => { (m[r[key]] = m[r[key]] || []).push(r); return m; }, {});
}

function round_(x) { return Math.round(x * 1000) / 1000; }
