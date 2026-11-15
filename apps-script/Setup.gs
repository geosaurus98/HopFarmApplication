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
  Users: ['UserEmail', 'Username', 'FullName', 'Role', 'Sections', 'Active', 'AccessCode', 'CreatedAt', 'UpdatedAt'],
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
  HelpReference: ['HelpID', 'Category', 'Title', 'Description', 'Image', 'SortOrder'],
  // Plant Health: one row per bay (7 plants between two posts) per visit.
  PlantChecks: [
    'CheckID', 'RecordNumber', 'Season', 'InspectionDate', 'InspectionTime', 'InspectorEmail',
    'BlockVarietyID', 'Block', 'Variety', 'Row', 'Bay',
    'BineHealth', 'CoirStatus', 'WeedPressure', 'GrassLength', 'TrellisIntegrity', 'IrrigationLeaks', 'OverviewPhoto',
    'GrowthStage',
    'BinesTrained', 'AvgBineHeightCm', 'MaxBineHeightCm', 'InternodeUnder1mCm', 'Internode1to2mCm', 'Internode2to3mCm',
    'AvgLateralLengthCm', 'SnappedTipsBine', 'SnappedTipsLateral', 'OverallBineHealth', 'LeafColour', 'LeafSize',
    'LeafDamage', 'LeafPhoto1', 'LeafPhoto2', 'Comments',
    'Deleted', 'CreatedAt', 'UpdatedAt', 'LastModifiedBy'
  ]
};

/** App sections a user can be given (Users.Sections; blank = all). */
const SECTIONS = ['Mites', 'Plant Health'];

/**
 * Plant check pick-lists, exactly as on the farm's paper form (Nov 2026).
 * Keep in sync with PLANT in app/js/logic.js (checked by tests).
 */
const PLANT_OPTIONS = {
  BineHealth: ['Vigorous', 'Normal', 'Stunted', 'Pale/Chlorotic'],
  CoirStatus: ['Intact', 'Broken Strings', 'Sagging Wire'],
  WeedPressure: ['Low', 'Medium', 'Action Needed'],
  GrassLength: ['Short', 'Medium', 'Long'],
  TrellisIntegrity: ['Good', 'Loose', 'Damage'],
  IrrigationLeaks: ['None', 'Minor', 'Major'],
  GrowthStage: [
    'Spring Emergence / Rhizome Sprouting',
    'Training Stage (Bines being wrapped)',
    'Vegetative Growth (Rapid vertical climbing)',
    'Lateral Development (Side arm growth)',
    'Flowering / Cone Initiation (Burr stage)',
    'Cone Development & Maturation',
    'Harvest Ready'
  ],
  OverallBineHealth: ['Vigorous', 'Stunted', 'Pale/Chlorotic'],
  LeafSize: ['Small', 'Medium', 'Large'],
  LeafDamage: ['Chewing', 'Dark Spotting', 'Light Spotting', 'Vein Staining', 'Curling']
};
const MAX_BINES_PER_BAY = 42; // 7 plants × 2 strings × 3 bines
const LEAF_COLOUR_STEPS = 7;

// ---------------------------------------------------------------------------
// Where each tab lives. Once a separate "Users & Setup" sheet is connected
// (Hop Farm → Connect Users & Setup sheet…), these tabs are read from and
// written to that sheet; everything else stays in this (Mite Monitoring)
// sheet. Until then, everything is in this sheet.
// ---------------------------------------------------------------------------
const SETUP_TABLES = ['Users', 'BlockVarieties', 'HelpReference'];
const SETUP_SHEET_PROP = 'SETUP_SHEET_ID';
const PLANT_TABLES = ['PlantChecks'];
const PLANT_SHEET_PROP = 'PLANT_SHEET_ID';

/** The separate spreadsheets that can be connected, and which tabs move to each. */
const LINKED_SHEETS = {
  setup: { prop: SETUP_SHEET_PROP, tables: SETUP_TABLES, title: 'Users & Setup', extraTabs: ['AuditLog'] },
  plant: { prop: PLANT_SHEET_PROP, tables: PLANT_TABLES, title: 'Plant Health', extraTabs: [] }
};
const linkedSsCache_ = {};

function linkedSheetId_(kind) {
  return PropertiesService.getScriptProperties().getProperty(LINKED_SHEETS[kind].prop) || '';
}
function setupSheetId_() { return linkedSheetId_('setup'); }

/** A connected spreadsheet ('setup' or 'plant'), or null if not connected. */
function linkedSs_(kind) {
  const id = linkedSheetId_(kind);
  if (!id) return null;
  const c = linkedSsCache_[kind];
  if (!c || c.getId() !== id) linkedSsCache_[kind] = SpreadsheetApp.openById(id);
  return linkedSsCache_[kind];
}
function setupSs_() { return linkedSs_('setup'); }

/** The spreadsheet that holds a given tab. */
function ssFor_(table) {
  for (const kind in LINKED_SHEETS) {
    if (LINKED_SHEETS[kind].tables.indexOf(table) !== -1) {
      const s = linkedSs_(kind);
      if (s) return s;
    }
  }
  return SpreadsheetApp.getActive();
}

const KEYS = {
  Users: 'UserEmail', BlockVarieties: 'BlockVarietyID', Samples: 'SampleID',
  LeafAnalysis: 'LeafAnalysisID', AuditLog: 'AuditID', HelpReference: 'HelpID', PlantChecks: 'CheckID'
};

const DATE_COLUMNS = ['CollectionDate', 'InspectionDate'];
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
    .addItem('Build plant checks export', 'buildPlantExport')
    .addSeparator()
    .addItem('Connect Users & Setup sheet…', 'connectSetupSheet')
    .addItem('Connect Plant Health sheet…', 'connectPlantSheet')
    .addToUi();
}

// ---------------------------------------------------------------------------
// Workbook setup
// ---------------------------------------------------------------------------
function setupHopFarmWorkbook() {
  const ss = SpreadsheetApp.getActive();
  const setup = setupSs_();
  const plant = linkedSs_('plant');
  Object.keys(SCHEMA).forEach(name => ensureSheet_(ssFor_(name), name, SCHEMA[name]));
  if (setup) ensureSheet_(setup, 'AuditLog', SCHEMA.AuditLog); // log of changes to users
  applyFormatsAndValidation_();

  const usersSh = ssFor_('Users').getSheetByName('Users');
  migrateUsers_(usersSh);
  const seededUsers = defaultUsers_();
  const addedAdmin = seedIfEmpty_(usersSh, seededUsers);
  seedIfEmpty_(ssFor_('BlockVarieties').getSheetByName('BlockVarieties'), exampleBlockVarieties_());
  seedIfEmpty_(ssFor_('HelpReference').getSheetByName('HelpReference'), helpContent_());

  [ss, setup, plant].forEach(book => {
    const sheet1 = book && book.getSheetByName('Sheet1');
    if (sheet1 && sheet1.getLastRow() === 0 && book.getSheets().length > 1) book.deleteSheet(sheet1);
  });

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
function applyFormatsAndValidation_() {
  const tab = name => ssFor_(name).getSheetByName(name);
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

  const leaf = tab('LeafAnalysis');
  COUNT_FIELDS.concat(['LeafNumber']).forEach(h =>
    columnRange_(leaf, h).setNumberFormat('0').setDataValidation(nonNegInt));
  ['AnalysisDateTime', 'CreatedAt', 'UpdatedAt'].forEach(h =>
    columnRange_(leaf, h).setNumberFormat('yyyy-mm-dd hh:mm:ss'));

  const bv = tab('BlockVarieties');
  columnRange_(bv, 'AreaHa').setNumberFormat('0.00').setDataValidation(positive);
  columnRange_(bv, 'UpdatedAt').setNumberFormat('yyyy-mm-dd hh:mm:ss');

  const samples = tab('Samples');
  columnRange_(samples, 'Status').setDataValidation(statusList);
  columnRange_(samples, 'CollectionDate').setNumberFormat('yyyy-mm-dd');
  columnRange_(samples, 'AreaHaAtCollection').setNumberFormat('0.00');
  ['TargetLeafCount', 'ActualLeafCount', 'SampleNumber'].forEach(h =>
    columnRange_(samples, h).setNumberFormat('0'));
  ['AnalysisStartedAt', 'AnalysisCompletedAt', 'CreatedAt', 'UpdatedAt'].forEach(h =>
    columnRange_(samples, h).setNumberFormat('yyyy-mm-dd hh:mm:ss'));

  const users = tab('Users');
  columnRange_(users, 'Role').setDataValidation(roleList);
  columnRange_(users, 'AccessCode').setNumberFormat('@');

  const plant = tab('PlantChecks');
  columnRange_(plant, 'InspectionTime').setNumberFormat('@'); // keep "14:30" as text
  columnRange_(plant, 'InspectionDate').setNumberFormat('yyyy-mm-dd');
  ['CreatedAt', 'UpdatedAt'].forEach(h => columnRange_(plant, h).setNumberFormat('yyyy-mm-dd hh:mm:ss'));
}

/** Returns true if rows were written. */
function seedIfEmpty_(sh, rows) {
  if (sh.getLastRow() > 1 || rows.length === 0) return false;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const values = rows.map(obj => headers.map(h => (h in obj ? obj[h] : '')));
  sh.getRange(2, 1, values.length, headers.length).setValues(values);
  return true;
}

function usernameFromEmail_(email) {
  return String(email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9._-]+/g, '');
}

/** Name shown in the app and exports. Falls back to the old UserName column, then the email. */
function displayName_(u) {
  return String(u.FullName || u.UserName || u.UserEmail || '').trim();
}

/**
 * Upgrade a Users tab from the earlier layout (single UserName column):
 * fill blank FullName from UserName, and blank Username from the email address
 * (made unique). Existing values are never overwritten; the old UserName
 * column is left in place and can be deleted by hand afterwards.
 */
function migrateUsers_(sh) {
  if (!sh || sh.getLastRow() < 2) return;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const col = h => headers.indexOf(h);
  const iEmail = col('UserEmail'), iUser = col('Username'), iFull = col('FullName'), iOld = col('UserName');
  if (iUser === -1 || iFull === -1) return;
  const range = sh.getRange(2, 1, sh.getLastRow() - 1, headers.length);
  const rows = range.getValues();
  const taken = new Set(rows.map(r => String(r[iUser]).trim().toLowerCase()).filter(Boolean));
  let changed = false;
  rows.forEach(r => {
    if (!String(r[iEmail]).trim()) return;
    if (!String(r[iFull]).trim()) {
      const old = iOld === -1 ? '' : String(r[iOld]).trim();
      if (old) { r[iFull] = old; changed = true; }
    }
    if (!String(r[iUser]).trim()) {
      const base = usernameFromEmail_(r[iEmail]) || 'user';
      let name = base;
      for (let n = 2; taken.has(name); n++) name = base + n;
      taken.add(name);
      r[iUser] = name;
      changed = true;
    }
  });
  if (changed) range.setValues(rows);
}

function newAccessCode_() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function defaultUsers_() {
  const me = Session.getActiveUser().getEmail();
  const now = new Date();
  return me ? [{
    UserEmail: me, Username: usernameFromEmail_(me), FullName: me.split('@')[0], Role: 'Administrator', Active: true,
    AccessCode: newAccessCode_(), CreatedAt: now, UpdatedAt: now
  }] : [];
}

/** Nelson Lakes Hops block list (from Jason, July 2026). Seeded only into an empty tab. */
function exampleBlockVarieties_() {
  const now = new Date();
  return [
    ['A1', 'Cascade', 7.84],
    ['B1', 'Nelson Sauvin', 19.78],
    ['C1', 'Nelson Sauvin', 10.26],
    ['C2', 'Paradisi', 1.27],
    ['C2', 'Riwaka', 8.24],
    ['D1', 'Nelson Sauvin', 9.50],
    ['D2', 'Nelson Sauvin', 15.47],
    ['E1', 'Cascade', 2.83],
    ['E1', 'Motueka', 3.48],
    ['E1', 'Nelson Sauvin', 0.79],
    ['F1', 'Motueka', 8.76],
    ['F2', 'Rakau', 14.39],
    ['F3', 'Southern Cross', 4.84],
    ['G1', 'Riwaka', 14.39],
    ['H1', 'Southern Cross', 3.38],
    ['H2', 'Nelson Sauvin', 3.77],
    ['I1', 'Riwaka', 4.06],
    ['I2', 'Nelson Sauvin', 11.19],
    ['I3', 'Nelson Sauvin', 4.52],
    ['I4', 'Motueka', 4.29],
    ['J1', 'Riwaka', 10.90],
    ['J2', 'Nelson Sauvin', 11.70],
    ['J2', 'SBH-02', 0.23],
    ['J3', 'Rakau', 3.62],
    ['K1', 'Motueka', 13.46],
    ['K2', 'Riwaka', 11.77],
    ['K3', 'Nelson Sauvin', 3.99],
    ['K4', 'Nelson Sauvin', 9.73],
    ['L1', 'Riwaka', 3.04],
    ['L2', 'Cascade', 13.86],
    ['L2', 'Comet NZ', 0.04],
    ['L2', 'SBH-02', 1.90],
    ['L2', 'SBH-04', 0.07],
    ['M4', 'Trial 1', 2.89],
    ['N1', 'Southern Cross', 7.45],
    ['N2', 'Motueka', 8.62],
    ['N2', 'SBH-02', 4.40],
    ['N3', 'Riwaka', 18.59],
    ['N4', 'Motueka', 15.42]
  ].map(r => ({
    BlockVarietyID: r[0] + '-' + String(r[1]).toUpperCase().replace(/[^A-Z0-9]+/g, ''),
    Block: r[0], Variety: r[1], AreaHa: r[2], Active: true, Notes: '', UpdatedAt: now
  }));
}

/** Starter help text. Check against the farm's own posters; add photo links in Image. */
function helpContent_() {
  const rows = [
    ['Identification', 'Two-spotted spider mite (Tetranychus urticae) — "2SM"',
     'Pest mite. Adults about 0.5 mm, oval, pale yellow-green to straw coloured with two dark spots on the body (the spots are food showing through). Usually on the underside of the leaf, often with fine webbing and pale stippling damage on the upper surface. Overwintering females can be orange-red — do not confuse with P. persimilis. Count every live mobile stage (adults and nymphs) as 2SM.'],
    ['Identification', 'Two-spotted mite eggs',
     'Tiny (about 0.13 mm), perfectly round, clear to pearly white when laid, turning creamy as they develop. Often among webbing on the leaf underside. Record as "2SM eggs", not in the live count.'],
    ['Identification', 'Phytoseiulus persimilis (PP) — predatory mite',
     'Beneficial predator. Slightly larger than TwoSM, bright orange-red, pear/teardrop shaped, no dark spots, long front legs and moves quickly. Count adults and nymphs as PP.'],
    ['Identification', 'Predator eggs',
     'Oval rather than round and roughly twice the size of TwoSM eggs; pinkish-orange to pale when fresh. Record as "PP eggs".'],
    ['Identification', 'Ladybirds (including the mite-eating Stethorus)',
     'Stethorus is a very small (about 1.5 mm) shiny black ladybird whose adults and larvae eat spider mites. Larger ladybirds and their larvae may also be present. Count under "Beneficials" and choose the type.'],
    ['Identification', 'Lacewings',
     'Green or brown lacewing larvae are long with large curved jaws; eggs sit on fine stalks. Count under "Beneficials" and choose the type.'],
    ['Identification', 'Other beneficial organisms',
     'Predatory thrips, predatory midge larvae (orange maggots in mite colonies), predatory bugs, spiders. Count under "Beneficials" and choose or type the type. If unsure, add a leaf comment and photo.'],
    ['How to', 'Collecting a sample in the field',
     '1) Before leaving Wi-Fi, open the app and check it says "All changes synced". 2) Tap New Mite Sample. 3) Enter the number written on the bag. 4) Choose the block and variety — the app shows how many leaves to collect. 5) Add comments or photos if something is unusual. 6) Tap Save sample. It is stored on the tablet even with no signal.'],
    ['How to', 'Analysing a sample in the office',
     '1) Open Analyse Samples and choose the sample. 2) Check the bag number matches. 3) Tap Start analysis. 4) Enter the five counts (PP, 2SM, PP eggs, 2SM eggs, Beneficials) and tap Save & next leaf — the next leaf opens automatically. 5) To pause, tap Save & stop (or Stop without saving on an empty leaf). Nothing is lost. 6) When all leaves are done, tap Complete analysis.'],
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
  return readSheetObjects_(ssFor_(name).getSheetByName(name));
}

function headersOf_(sh) {
  return sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
}

function readSheetObjects_(sh) {
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
  if (col === 'InspectionTime' && v instanceof Date) return Utilities.formatDate(v, tz_(), 'HH:mm');
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
  'PhytoseiulusCount', 'TetranychusCount', 'PredatorEggCount', 'TwoSpotEggCount',
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
  return readTable_('Users').reduce((m, u) => { m[String(u.UserEmail).toLowerCase()] = displayName_(u); return m; }, {});
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
        l.PhytoseiulusCount, l.TetranychusCount, l.PredatorEggCount, l.TwoSpotEggCount,
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

// ---------------------------------------------------------------------------
// Plant checks export: one row per bay visit
// ---------------------------------------------------------------------------
const PLANT_EXPORT_HEADERS = [
  'RecordNumber', 'Season', 'InspectionDate', 'WeekStarting', 'InspectionTime', 'Inspector',
  'Block', 'Variety', 'Row', 'Bay',
  'BineHealth', 'CoirStatus', 'WeedPressure', 'GrassLength', 'TrellisIntegrity', 'IrrigationLeaks',
  'GrowthStage', 'BinesTrained', 'AvgBineHeightCm', 'MaxBineHeightCm',
  'InternodeUnder1mCm', 'Internode1to2mCm', 'Internode2to3mCm', 'AvgLateralLengthCm',
  'SnappedTipsBine', 'SnappedTipsLateral', 'OverallBineHealth', 'LeafColour', 'LeafSize', 'LeafDamage',
  'Comments', 'OverviewPhoto', 'LeafPhoto1', 'LeafPhoto2', 'CheckID'
];

function plantExportRows_(filter) {
  const names = userNames_();
  return readTable_('PlantChecks')
    .filter(c => !toBool_(c.Deleted) && matchesFilter_(c, filter))
    .sort((a, b) => isoDate_(a.InspectionDate).localeCompare(isoDate_(b.InspectionDate)) ||
      String(a.Block).localeCompare(String(b.Block), undefined, { numeric: true }) ||
      (Number(a.Row) - Number(b.Row)) || (Number(a.Bay) - Number(b.Bay)))
    .map(c => {
      const d = isoDate_(c.InspectionDate);
      return PLANT_EXPORT_HEADERS.map(h => {
        if (h === 'InspectionDate') return d;
        if (h === 'WeekStarting') return weekStarting(d);
        if (h === 'Inspector') return nameOf_(names, c.InspectorEmail);
        return c[h] === undefined ? '' : c[h];
      });
    });
}

function buildPlantExport() {
  const rows = plantExportRows_();
  // Written into the Plant Health sheet when one is connected.
  writeReport_('Export_PlantChecks', PLANT_EXPORT_HEADERS, rows, ssFor_('PlantChecks')).activate();
  SpreadsheetApp.getActive().toast(rows.length + ' plant checks. File > Download to save as Excel or CSV.', 'Hop Farm', 8);
}

/** Sections this user can use. Blank = all sections. */
function userSections_(u) {
  const raw = String(u.Sections || '').split(',').map(x => x.trim()).filter(Boolean);
  const valid = raw.filter(x => SECTIONS.indexOf(x) !== -1);
  return valid.length ? valid : SECTIONS.slice();
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
function writeReport_(tabName, headers, rows, book) {
  const ss = book || SpreadsheetApp.getActive();
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

  const usernames = {};
  readTable_('Users').forEach(u => {
    const un = String(u.Username || '').trim().toLowerCase();
    const label = displayName_(u) + ' <' + u.UserEmail + '>';
    if (!un) add('WARN', 'Users', u.UserEmail, label, 'Username is blank — this person can only sign in with their email');
    else if (usernames[un]) add('ERROR', 'Users', u.UserEmail, label, 'Username "' + un + '" is also used by ' + usernames[un] + ' — neither can sign in with it');
    else usernames[un] = u.UserEmail;
  });

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

// ---------------------------------------------------------------------------
// Moving tabs into a separate, connected spreadsheet:
//   'setup' — Users, BlockVarieties, HelpReference  ("Users & Setup")
//   'plant' — PlantChecks                           ("Plant Health")
// Copies, checks the copy, and only then switches over. The original tabs are
// renamed "OLD … (moved – delete)" and hidden, never deleted by the script.
// ---------------------------------------------------------------------------
function connectSetupSheet() { connectSheetPrompt_('setup'); }
function connectPlantSheet() { connectSheetPrompt_('plant'); }

function connectSheetPrompt_(kind) {
  const cfg = LINKED_SHEETS[kind];
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Connect ' + cfg.title + ' sheet',
    'Create a new, empty Google Sheet (e.g. "Hop Farm – ' + cfg.title + '") and paste its address here.\n\n' +
    'These tabs will be moved into it and checked: ' + cfg.tables.join(', ') + '.',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  try {
    ui.alert(cfg.title + ' sheet connected', connectSheet_(kind, res.getResponseText()), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Not connected', e.message, ui.ButtonSet.OK);
  }
}

function sheetIdFromUrl_(text) {
  const s = String(text || '').trim();
  const m = /\/d\/([a-zA-Z0-9_-]{20,})/.exec(s);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  throw new Error('That does not look like a Google Sheets address. Copy it from the browser address bar of the new sheet.');
}

function connectSetupSheet_(urlOrId) { return connectSheet_('setup', urlOrId); }
function connectPlantSheet_(urlOrId) { return connectSheet_('plant', urlOrId); }

/** Returns a summary for the user. Throws (changing nothing) if anything looks wrong. */
function connectSheet_(kind, urlOrId) {
  const cfg = LINKED_SHEETS[kind];
  const main = SpreadsheetApp.getActive();
  const id = sheetIdFromUrl_(urlOrId);
  if (id === main.getId()) throw new Error('That is this sheet. Create a new, separate Google Sheet for ' + cfg.title + '.');
  for (const other in LINKED_SHEETS) {
    if (other !== kind && linkedSheetId_(other) === id) {
      throw new Error('That sheet is already connected as the ' + LINKED_SHEETS[other].title + ' sheet. Use a new, separate sheet.');
    }
  }
  const current = linkedSheetId_(kind);
  if (current === id) return 'This sheet is already connected. Nothing changed.';
  if (current) throw new Error('A different ' + cfg.title + ' sheet is already connected. Nothing changed.');
  let dest;
  try {
    dest = SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('Could not open that sheet. Check the address, and that this Google account can edit it.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // 1. Check everything before changing anything.
    const plan = cfg.tables.map(name => {
      const src = main.getSheetByName(name);
      const srcRows = readSheetObjects_(src);
      if (readSheetObjects_(dest.getSheetByName(name)).length) {
        throw new Error('The new sheet already has data in "' + name + '". Use an empty sheet. Nothing changed.');
      }
      return { name: name, src: src, srcRows: srcRows, srcHeaders: src ? headersOf_(src).filter(h => h !== '') : [] };
    });

    // 2. Copy (keeping any extra columns) and check the copy matches exactly.
    const summary = [];
    plan.forEach(p => {
      const sh = ensureSheet_(dest, p.name, SCHEMA[p.name]);
      const extra = p.srcHeaders.filter(h => headersOf_(sh).indexOf(h) === -1);
      if (extra.length) sh.getRange(1, headersOf_(sh).filter(h => h !== '').length + 1, 1, extra.length).setValues([extra]);
      const headers = headersOf_(sh);
      if (p.srcRows.length) {
        sh.getRange(2, 1, p.srcRows.length, headers.length)
          .setValues(p.srcRows.map(o => headers.map(h => (h in o ? o[h] : ''))));
      }
      const copied = readSheetObjects_(sh);
      const same = copied.length === p.srcRows.length && copied.every((o, i) =>
        p.srcHeaders.every(h => String(o[h]) === String(p.srcRows[i][h])));
      if (!same) {
        sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), headers.length).clearContent();
        throw new Error('The copy of "' + p.name + '" did not match. Nothing was switched over; this sheet is unchanged.');
      }
      summary.push('• ' + p.name + ': ' + p.srcRows.length + ' row' + (p.srcRows.length === 1 ? '' : 's') + ' copied and checked');
    });
    cfg.extraTabs.forEach(t => ensureSheet_(dest, t, SCHEMA[t]));

    // 3. Switch over, then retire the old tabs.
    PropertiesService.getScriptProperties().setProperty(cfg.prop, id);
    delete linkedSsCache_[kind];
    const retired = [];
    plan.forEach(p => {
      if (!p.src) return;
      p.src.setName('OLD ' + p.name + ' (moved – delete)');
      p.src.hideSheet();
      retired.push(p.name);
    });
    setupHopFarmWorkbook(); // formats and validation in the new sheet; seeds any empty tab

    const what = kind === 'setup' ? 'users, blocks and help' : 'plant health checks';
    return summary.join('\n') +
      '\n\nThe app now reads and saves ' + what + ' in the new sheet.' +
      (retired.length
        ? '\n\nThe old tabs here were renamed "OLD … (moved – delete)" and hidden. Check the new sheet, then delete them ' +
          '(View → Hidden sheets)' + (kind === 'setup' ? ' so the access codes are no longer in this file.' : '.')
        : '');
  } finally {
    lock.releaseLock();
  }
}
