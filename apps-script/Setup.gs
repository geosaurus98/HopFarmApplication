/**
 * Hop Farm Application — Google Sheets backend for AppSheet
 * Nelson Lakes Hops · Mite Monitoring module
 *
 * HOW TO USE
 *   1. Create a new, empty Google Sheet named "Hop Farm Data".
 *   2. Extensions > Apps Script, paste this file in (replace Code.gs), save.
 *   3. Run `setupHopFarmWorkbook` once and grant the permissions it asks for.
 *   4. Reload the spreadsheet: a "Hop Farm" menu appears with the reporting tools.
 *   5. Replace the example BlockVarieties rows with the real blocks and areas,
 *      then connect the sheet to AppSheet (see docs/appsheet-build-guide.md).
 *
 * The script is safe to re-run: it never deletes or reorders existing data.
 * Missing tabs are created and missing columns are appended to the right.
 *
 * IMPORTANT: AppSheet reads row 1 as column headers. Do not rename headers
 * after the app has been built without also regenerating the AppSheet columns.
 */

// ---------------------------------------------------------------------------
// Schema. Keep in sync with templates/*.csv (checked by tests/test_schema.py).
// ---------------------------------------------------------------------------
const SCHEMA = {
  Users: ['UserEmail', 'UserName', 'Role', 'Active', 'CreatedAt', 'UpdatedAt'],
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
    'CreatedAt', 'UpdatedAt', 'LastModifiedBy'
  ],
  AuditLog: ['AuditID', 'TableName', 'RowID', 'ChangedBy', 'ChangedAt', 'Summary'],
  HelpReference: ['HelpID', 'Category', 'Title', 'Description', 'Image', 'SortOrder'],
  HomeMenu: ['MenuID', 'Title', 'Subtitle', 'TargetView', 'IsForm', 'Roles', 'SortOrder', 'Icon']
};

// Report tabs written by this script. They are NOT added to the AppSheet app.
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

const HIGH_COUNT_THRESHOLD = 100;   // per-leaf count that is flagged for review
const STALE_ANALYSIS_DAYS = 7;      // "In Progress" longer than this is flagged

// ---------------------------------------------------------------------------
// Leaf target — identical to the AppSheet expression and tools/leaf_target.py
//   Required Leaves = MAX(50, FLOOR((AreaHa × 10) / 5) × 5)
// ---------------------------------------------------------------------------
function requiredLeaves(areaHa) {
  const area = Number(areaHa);
  if (!isFinite(area) || area <= 0) return null;
  return Math.max(50, Math.floor((area * 10) / 5) * 5);
}

/** Custom sheet function: =REQUIRED_LEAVES(D2) */
function REQUIRED_LEAVES(areaHa) {
  if (Array.isArray(areaHa)) return areaHa.map(r => r.map(requiredLeaves));
  return requiredLeaves(areaHa);
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Hop Farm')
    .addItem('Build leaf results export (one row per leaf)', 'buildLeafExport')
    .addItem('Build sample summary', 'buildSampleSummary')
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
  seedIfEmpty_(ss.getSheetByName('Users'), defaultUsers_());
  seedIfEmpty_(ss.getSheetByName('BlockVarieties'), exampleBlockVarieties_());
  seedIfEmpty_(ss.getSheetByName('HelpReference'), helpContent_());
  seedIfEmpty_(ss.getSheetByName('HomeMenu'), homeMenu_());

  // Remove the default empty "Sheet1" if it is still there and unused.
  const sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && sheet1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sheet1);

  SpreadsheetApp.getActive().toast('Hop Farm workbook is ready.', 'Hop Farm', 5);
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
    if (missing.length) {
      sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
    }
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

/**
 * Formats and validation protect the data if someone edits the sheet directly.
 * AppSheet enforces its own rules in the app; these are a second line of defence.
 */
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
    .requireValueInList(Object.keys(STATUS).map(k => STATUS[k]), true).setAllowInvalid(false).build();
  const roleList = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Collector', 'Analyst', 'Administrator'], true).setAllowInvalid(false).build();

  const leaf = ss.getSheetByName('LeafAnalysis');
  ['TetranychusCount', 'PhytoseiulusCount', 'TwoSpotEggCount', 'PredatorEggCount',
   'OtherBeneficialCount', 'LeafNumber'].forEach(h => {
    columnRange_(leaf, h).setNumberFormat('0').setDataValidation(nonNegInt);
  });
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
}

function seedIfEmpty_(sh, rows) {
  if (sh.getLastRow() > 1 || rows.length === 0) return;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const values = rows.map(obj => headers.map(h => (h in obj ? obj[h] : '')));
  sh.getRange(2, 1, values.length, headers.length).setValues(values);
}

function defaultUsers_() {
  const me = Session.getActiveUser().getEmail();
  const now = new Date();
  return me ? [{
    UserEmail: me, UserName: me.split('@')[0], Role: 'Administrator',
    Active: 'TRUE', CreatedAt: now, UpdatedAt: now
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
    Block: r[0], Variety: r[1], AreaHa: r[2], Active: 'TRUE',
    Notes: 'EXAMPLE ROW – replace with the real block, variety and area', UpdatedAt: now
  }));
}

function homeMenu_() {
  const all = 'Collector,Analyst,Administrator';
  const lab = 'Analyst,Administrator';
  return [
    { MenuID: 'M01', Title: 'New Mite Sample', Subtitle: 'Record a sample bag in the field', TargetView: 'Samples_Form', IsForm: 'TRUE', Roles: all, SortOrder: 1, Icon: 'add' },
    { MenuID: 'M02', Title: 'My Recent Samples', Subtitle: 'Samples you collected in the last 14 days', TargetView: 'My Samples', IsForm: 'FALSE', Roles: all, SortOrder: 2, Icon: 'list' },
    { MenuID: 'M03', Title: 'Analyse Samples', Subtitle: 'Samples waiting for leaf analysis', TargetView: 'Analyse Samples', IsForm: 'FALSE', Roles: lab, SortOrder: 3, Icon: 'microscope' },
    { MenuID: 'M04', Title: 'Samples In Progress', Subtitle: 'Resume a paused analysis', TargetView: 'In Progress', IsForm: 'FALSE', Roles: lab, SortOrder: 4, Icon: 'pause' },
    { MenuID: 'M05', Title: 'Completed Samples', Subtitle: 'Search historical results', TargetView: 'Completed Samples', IsForm: 'FALSE', Roles: all, SortOrder: 5, Icon: 'check' },
    { MenuID: 'M06', Title: 'Help and Reference', Subtitle: 'Mite identification and how-to guides', TargetView: 'Help', IsForm: 'FALSE', Roles: all, SortOrder: 6, Icon: 'help' },
    { MenuID: 'M07', Title: 'Reports and Exports', Subtitle: 'Summaries and CSV export', TargetView: 'Reports', IsForm: 'FALSE', Roles: lab, SortOrder: 7, Icon: 'chart' },
    { MenuID: 'M08', Title: 'Administration', Subtitle: 'Blocks, users and data quality', TargetView: 'Admin', IsForm: 'FALSE', Roles: 'Administrator', SortOrder: 8, Icon: 'settings' }
  ];
}

/**
 * Starter help text. The farm should check these descriptions against its own
 * identification posters and attach photos in the Image column.
 */
function helpContent_() {
  const rows = [
    ['Identification', 'Two-spotted spider mite (Tetranychus urticae) — "TwoSM"',
     'Pest mite. Adults about 0.5 mm, oval, pale yellow-green to straw coloured with two dark spots on the body (the spots are food showing through). Usually on the underside of the leaf, often with fine webbing and pale stippling damage on the upper surface. Overwintering females can be orange-red — do not confuse with P. persimilis. Count every live mobile stage (adults and nymphs) in the TwoSM field.'],
    ['Identification', 'Two-spotted mite eggs',
     'Tiny (about 0.13 mm), perfectly round, clear to pearly white when laid, turning creamy as they develop. Often found among webbing on the leaf underside. Record in "Two-Spotted Mite Eggs", not in the live count.'],
    ['Identification', 'Phytoseiulus persimilis (PP) — predatory mite',
     'Beneficial predator. Slightly larger than TwoSM, bright orange-red, pear/teardrop shaped, no dark spots, long front legs and moves quickly. Count adults and nymphs in the PP field.'],
    ['Identification', 'Predator eggs',
     'Oval rather than round and roughly twice the size of TwoSM eggs; pinkish-orange to pale when fresh. Record in "Predator Eggs".'],
    ['Identification', 'Ladybirds (including the mite-eating Stethorus)',
     'Stethorus is a very small (about 1.5 mm) shiny black ladybird whose adults and larvae feed on spider mites. Larger ladybirds and ladybird larvae may also be present. Count in "Other Beneficial Organisms" and write the type in the description field.'],
    ['Identification', 'Lacewings',
     'Green or brown lacewing larvae are elongated with large curved jaws; eggs sit on fine stalks. Count in "Other Beneficial Organisms" and describe.'],
    ['Identification', 'Other beneficial organisms',
     'Predatory thrips, predatory midge larvae (orange maggots in mite colonies), predatory bugs, spiders. Count in "Other Beneficial Organisms" and describe. If unsure, add a leaf comment and photo.'],
    ['How to', 'Collecting a sample in the field',
     '1) Before leaving Wi-Fi, open the app and wait for the sync to finish. 2) Tap New Mite Sample. 3) Enter the number written on the bag. 4) Choose the block and variety — the app shows how many leaves to collect. 5) Add comments or photos if something is unusual. 6) Save. The sample is stored on the tablet even with no signal.'],
    ['How to', 'Analysing a sample in the office',
     '1) Open Analyse Samples and choose the sample. 2) Check the bag number matches. 3) Tap Start Analysis. 4) Enter the counts for the leaf and tap Save — the next leaf opens automatically. 5) To pause, tap Cancel on the empty next-leaf form; nothing is lost. 6) When all leaves are done, tap Complete Analysis and add any comments.'],
    ['How to', 'Zero means "looked and found none"',
     'Enter 0 when you have checked the leaf and found none of that organism. Never leave a count blank to mean zero — the app will not save a leaf with blank counts.'],
    ['How to', 'Syncing and offline use',
     'The number on the sync icon shows changes waiting to upload. They upload automatically when the tablet has internet. To force it, tap the sync icon. Do not uninstall the app or clear its data while changes are waiting.']
  ];
  return rows.map((r, i) => ({
    HelpID: 'H' + String(i + 1).padStart(2, '0'), Category: r[0], Title: r[1],
    Description: r[2], Image: '', SortOrder: i + 1
  }));
}

// ---------------------------------------------------------------------------
// Reporting helpers
// ---------------------------------------------------------------------------
function readTable_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const headers = values.shift();
  return values
    .filter(r => r.some(v => v !== '' && v !== null))
    .map(r => headers.reduce((o, h, i) => { o[h] = r[i]; return o; }, {}));
}

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

function userNames_() {
  return readTable_('Users').reduce((m, u) => { m[String(u.UserEmail).toLowerCase()] = u.UserName; return m; }, {});
}

function nameOf_(names, email) {
  return names[String(email).toLowerCase()] || email || '';
}

// ---------------------------------------------------------------------------
// Export: one row per analysed leaf (spec §12.1)
// File > Download > Microsoft Excel / CSV on the generated tab.
// ---------------------------------------------------------------------------
const LEAF_EXPORT_HEADERS = [
  'SampleID', 'SampleNumber', 'Season', 'CollectionDate', 'Collector', 'Block', 'Variety',
  'AreaHa', 'TargetLeafCount', 'LeafNumber', 'Analyst', 'AnalysisDateTime',
  'TetranychusCount', 'PhytoseiulusCount', 'TwoSpotEggCount', 'PredatorEggCount',
  'OtherBeneficialCount', 'OtherBeneficialDescription', 'LeafComment', 'SampleComments',
  'AnalysisComments', 'SampleStatus', 'SamplePhoto1', 'SamplePhoto2', 'LeafPhoto'
];

function buildLeafExport() {
  const names = userNames_();
  const samples = readTable_('Samples').reduce((m, s) => { m[s.SampleID] = s; return m; }, {});
  const rows = readTable_('LeafAnalysis')
    .filter(l => samples[l.SampleID])
    .sort((a, b) => {
      const sa = samples[a.SampleID], sb = samples[b.SampleID];
      return (new Date(sa.CollectionDate) - new Date(sb.CollectionDate)) ||
        String(sa.SampleNumber).localeCompare(String(sb.SampleNumber), undefined, { numeric: true }) ||
        String(a.SampleID).localeCompare(String(b.SampleID)) ||
        (Number(a.LeafNumber) - Number(b.LeafNumber));
    })
    .map(l => {
      const s = samples[l.SampleID];
      return [
        s.SampleID, s.SampleNumber, s.Season, s.CollectionDate, nameOf_(names, s.CollectorEmail),
        s.Block, s.Variety, s.AreaHaAtCollection, s.TargetLeafCount, l.LeafNumber,
        nameOf_(names, l.AnalystEmail), l.AnalysisDateTime,
        l.TetranychusCount, l.PhytoseiulusCount, l.TwoSpotEggCount, l.PredatorEggCount,
        l.OtherBeneficialCount, l.OtherBeneficialDescription, l.LeafComment, s.SampleComments,
        s.AnalysisComments, s.Status, s.SamplePhoto1, s.SamplePhoto2, l.LeafPhoto
      ];
    });
  writeReport_(REPORT_TABS.leafExport, LEAF_EXPORT_HEADERS, rows).activate();
  SpreadsheetApp.getActive().toast(rows.length + ' leaf rows exported.', 'Hop Farm', 5);
}

// ---------------------------------------------------------------------------
// Sample summary (spec §12.2)
// ---------------------------------------------------------------------------
function buildSampleSummary() {
  const leavesBySample = groupBy_(readTable_('LeafAnalysis'), 'SampleID');
  const headers = [
    'SampleID', 'SampleNumber', 'Season', 'CollectionDate', 'Block', 'Variety', 'Status',
    'TargetLeafCount', 'LeavesAnalysed', 'BelowTarget',
    'TotalTwoSM', 'AvgTwoSMPerLeaf', 'TotalPP', 'AvgPPPerLeaf',
    'TotalTwoSMEggs', 'TotalPredatorEggs', 'TotalOtherBeneficial',
    'PredatorToPestRatio', 'LeavesWithTwoSM', 'PctLeavesWithTwoSM'
  ];
  const rows = readTable_('Samples')
    .filter(s => s.Status !== STATUS.CANCELLED)
    .map(s => {
      const leaves = leavesBySample[s.SampleID] || [];
      const n = leaves.length;
      const sum = k => leaves.reduce((t, l) => t + (Number(l[k]) || 0), 0);
      const tsm = sum('TetranychusCount'), pp = sum('PhytoseiulusCount');
      const infested = leaves.filter(l => Number(l.TetranychusCount) > 0).length;
      return [
        s.SampleID, s.SampleNumber, s.Season, s.CollectionDate, s.Block, s.Variety, s.Status,
        s.TargetLeafCount, n, n < Number(s.TargetLeafCount) ? 'YES' : 'NO',
        tsm, n ? round_(tsm / n) : '', pp, n ? round_(pp / n) : '',
        sum('TwoSpotEggCount'), sum('PredatorEggCount'), sum('OtherBeneficialCount'),
        tsm ? round_(pp / tsm) : '', infested, n ? round_(infested / n) : ''
      ];
    });
  writeReport_(REPORT_TABS.sampleSummary, headers, rows).activate();
}

// ---------------------------------------------------------------------------
// Data quality report (spec §14)
// ---------------------------------------------------------------------------
function buildDataQualityReport() {
  const samples = readTable_('Samples');
  const leaves = readTable_('LeafAnalysis');
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
  const counts = ['TetranychusCount', 'PhytoseiulusCount', 'TwoSpotEggCount', 'PredatorEggCount', 'OtherBeneficialCount'];
  leaves.forEach(l => {
    const label = 'Sample ' + l.SampleID + ' · Leaf ' + l.LeafNumber;
    if (!sampleIds.has(l.SampleID)) add('ERROR', 'LeafAnalysis', l.LeafAnalysisID, label, 'Leaf belongs to a sample that does not exist');
    const key = l.SampleID + '|' + l.LeafNumber;
    if (leafKeys[key]) add('ERROR', 'LeafAnalysis', l.LeafAnalysisID, label, 'Duplicate leaf number within sample');
    leafKeys[key] = true;
    counts.forEach(c => {
      const v = l[c];
      if (v === '' || v === null) add('ERROR', 'LeafAnalysis', l.LeafAnalysisID, label, c + ' is blank');
      else if (Number(v) < 0 || Number(v) !== Math.floor(Number(v))) add('ERROR', 'LeafAnalysis', l.LeafAnalysisID, label, c + ' is not a non-negative whole number');
      else if (Number(v) > HIGH_COUNT_THRESHOLD) add('INFO', 'LeafAnalysis', l.LeafAnalysisID, label, c + ' is unusually high (' + v + ')');
    });
  });

  const order = { ERROR: 0, WARN: 1, INFO: 2 };
  issues.sort((a, b) => order[a[0]] - order[b[0]]);
  writeReport_(REPORT_TABS.dataQuality, ['Severity', 'Table', 'RowID', 'Record', 'Issue'], issues).activate();
  SpreadsheetApp.getActive().toast(issues.length + ' issue(s) found.', 'Hop Farm', 5);
}

function groupBy_(rows, key) {
  return rows.reduce((m, r) => { (m[r[key]] = m[r[key]] || []).push(r); return m; }, {});
}

function round_(x) { return Math.round(x * 1000) / 1000; }
