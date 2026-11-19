// Pure functions: no DOM, no storage. Unit-tested with `node --test tests/js`.

export const STATUS = Object.freeze({
  DRAFT: 'Draft',
  AWAITING: 'Awaiting Analysis',
  IN_PROGRESS: 'Analysis In Progress',
  COMPLETE: 'Analysis Complete',
  CANCELLED: 'Cancelled',
});

// Leaf counts, laid out on the leaf screen as the farm asked (Nov 2026):
//   2SM        | 2SM eggs
//   Dead 2SM   | Eaten 2SM eggs
//   PP         | PP eggs
// then each beneficial type separately. Every count starts at 0.
export const MAIN_COUNTS = Object.freeze([
  { key: 'TetranychusCount', short: '2SM', label: 'Two-spotted mite', latin: 'Tetranychus urticae', help: 'mite-2sm' },
  { key: 'TwoSpotEggCount', short: '2SM eggs', label: 'Two-spotted mite eggs', latin: '', help: 'mite-2sm-eggs' },
  { key: 'DeadTetranychusCount', short: 'Dead 2SM', label: 'Dead two-spotted mites', latin: '', help: 'mite-dead-2sm' },
  { key: 'EatenTwoSpotEggCount', short: 'Eaten 2SM eggs', label: 'Eaten two-spotted mite eggs', latin: '', help: 'mite-eaten-eggs' },
  { key: 'PhytoseiulusCount', short: 'PP', label: 'Predatory mite', latin: 'Phytoseiulus persimilis', help: 'mite-pp' },
  { key: 'PredatorEggCount', short: 'PP eggs', label: 'Predator eggs', latin: '', help: 'mite-pp-eggs' },
]);

/** Beneficials, each counted on its own; their sum is stored as OtherBeneficialCount. */
export const BENEFICIAL_COUNTS = Object.freeze([
  { key: 'LadybirdStethorusCount', short: 'Ladybird (Stethorus)', label: 'Ladybird (Stethorus)', help: 'mite-ladybird' },
  { key: 'LadybirdOtherCount', short: 'Ladybird (other)', label: 'Ladybird (other)', help: 'mite-ladybird' },
  { key: 'LacewingCount', short: 'Lacewing', label: 'Lacewing', help: 'mite-lacewing' },
  { key: 'PredatoryThripsCount', short: 'Predatory thrips', label: 'Predatory thrips', help: 'mite-thrips' },
  { key: 'PredatoryMidgeCount', short: 'Predatory midge', label: 'Predatory midge', help: 'mite-thrips' },
  { key: 'SpiderCount', short: 'Spider', label: 'Spider', help: 'mite-thrips' },
  { key: 'BeneficialOtherCount', short: 'Other', label: 'Other beneficial', help: 'mite-thrips' },
]);

/** Every count entered on the leaf screen. */
export const LEAF_INPUT_FIELDS = Object.freeze([...MAIN_COUNTS, ...BENEFICIAL_COUNTS]);

/** Columns shown in the leaf table: the six mite counts and the beneficials total. */
export const COUNT_FIELDS = Object.freeze([
  ...MAIN_COUNTS,
  { key: 'OtherBeneficialCount', short: 'Beneficials', label: 'Beneficials (total)', latin: '' },
]);

export const beneficialTotal = (leaf) => BENEFICIAL_COUNTS.reduce((t, f) => t + (Number(leaf[f.key]) || 0), 0);

/** Values for the leaf screen: 0 for anything not recorded (older leaves map their single beneficial count). */
export function leafFormValues(leaf) {
  const out = {};
  for (const f of LEAF_INPUT_FIELDS) out[f.key] = leaf && leaf[f.key] !== '' && leaf[f.key] != null ? Number(leaf[f.key]) : 0;
  if (leaf && Number(leaf.OtherBeneficialCount) > 0 && beneficialTotal(out) === 0) {
    const byName = { 'Ladybird (Stethorus)': 'LadybirdStethorusCount', 'Ladybird (other)': 'LadybirdOtherCount', Lacewing: 'LacewingCount',
      'Predatory thrips': 'PredatoryThripsCount', 'Predatory midge': 'PredatoryMidgeCount', Spider: 'SpiderCount' };
    out[byName[leaf.OtherBeneficialDescription] || 'BeneficialOtherCount'] = Number(leaf.OtherBeneficialCount);
  }
  return out;
}

export const BENEFICIAL_TYPES = Object.freeze([
  'Ladybird (Stethorus)', 'Ladybird (other)', 'Lacewing', 'Predatory thrips', 'Predatory midge', 'Spider', 'Other',
]);

export const EARLY_REASONS = Object.freeze([
  'Damaged leaves', 'Missing leaves', 'Contamination', 'Insufficient material', 'Other',
]);

export const HIGH_COUNT = 100;
/**
 * User  — collects and analyses samples, does plant checks; reopens their own analyses (31 days).
 * Admin — User + all completed / all samples, reports, exports, corrections.
 * Owner — Admin + people, access codes and tablets.
 */
export const ROLES = Object.freeze(['User', 'Admin', 'Owner']);
const LEGACY_ROLES = { Collector: 'User', Analyst: 'User', Administrator: 'Owner' };
export const normalizeRole = (r) => LEGACY_ROLES[r] || r || '';
export const isAdminRole = (r) => ['Admin', 'Owner'].includes(normalizeRole(r));
export const isOwnerRole = (r) => normalizeRole(r) === 'Owner';

/** Did this person analyse the sample (started or completed it)? */
export function analysedBy(sample, email) {
  const me = String(email || '').toLowerCase();
  return !!me && (String(sample.AnalysisStartedBy || '').toLowerCase() === me || String(sample.CompletedBy || '').toLowerCase() === me);
}

/** Required Leaves = MAX(50, FLOOR((AreaHa × 10) / 5) × 5). Null for invalid areas. */
export function requiredLeaves(areaHa) {
  const area = Number(areaHa);
  if (areaHa === '' || areaHa === null || areaHa === undefined || !Number.isFinite(area) || area <= 0) return null;
  return Math.max(50, Math.floor((area * 10) / 5) * 5);
}

/** NZ season, 1 July – 30 June. '2026-11-05' -> '2026/27'. */
export function seasonOf(isoDate) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(isoDate || ''));
  if (!m) return '';
  const y = Number(m[1]);
  const start = Number(m[2]) >= 7 ? y : y - 1;
  return `${start}/${String(start + 1).slice(-2)}`;
}

/** Monday of the week containing the date, 'YYYY-MM-DD'. */
export function weekStarting(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Today's date on this device, 'YYYY-MM-DD' (local time, not UTC). */
export function todayLocal(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Device-local 'YYYY-MM-DD HH:MM:SS' from an ISO timestamp — Excel reads this as a date and time. */
export function localDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${todayLocal(d)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Image link from the HelpReference sheet. Google Drive share links
 * (file must be shared "Anyone with the link") are turned into a direct image link.
 */
export function helpImageUrl(link) {
  const s = String(link || '').trim();
  if (!/^https:\/\//.test(s)) return '';
  const m = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{10,})/.exec(s);
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1200` : s;
}

export function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const toBoolean = (v) => v === true || String(v ?? '').trim().toUpperCase() === 'TRUE';

export const liveLeaves = (leaves) => leaves.filter((l) => !toBoolean(l.Deleted));

/** Highest existing leaf number + 1, so resuming never duplicates (§6.6). */
export function nextLeafNumber(leaves) {
  const nums = liveLeaves(leaves).map((l) => Number(l.LeafNumber)).filter(Number.isFinite);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

export function progress(sample, leaves) {
  const target = Number(sample.TargetLeafCount) || 0;
  const analysed = liveLeaves(leaves).length;
  return {
    target,
    analysed,
    remaining: Math.max(0, target - analysed),
    pct: target > 0 ? analysed / target : 0,
    reached: analysed >= target && target > 0,
  };
}

export function blockLabel(b) {
  return b ? `${b.Block} - ${b.Variety}` : '';
}

export function sampleLabel(s) {
  return `Bag ${s.SampleNumber} · ${s.Block} - ${s.Variety}`;
}

const isBlank = (v) => v === '' || v === null || v === undefined;

/** Parse a count input. Returns {value} or {error}. Blank -> error (must be explicit). */
export function parseCount(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return { error: 'required' };
  if (!/^\d+$/.test(s)) return { error: s.startsWith('-') ? 'negative' : 'whole' };
  return { value: Number(s) };
}

/** Validate a leaf record. `others` = other live leaves of the same sample. */
export function validateLeaf(leaf, others = []) {
  const errors = {};
  for (const f of LEAF_INPUT_FIELDS) {
    const r = parseCount(leaf[f.key]);
    if (r.error === 'required') errors[f.key] = 'Enter a count (0 if none seen).';
    else if (r.error === 'negative') errors[f.key] = 'Counts cannot be negative.';
    else if (r.error) errors[f.key] = 'Whole numbers only.';
  }
  const n = Number(leaf.LeafNumber);
  if (!Number.isInteger(n) || n < 1) errors.LeafNumber = 'Leaf number must be 1 or more.';
  else if (others.some((o) => o.LeafAnalysisID !== leaf.LeafAnalysisID && !o.Deleted && Number(o.LeafNumber) === n)) {
    errors.LeafNumber = `Leaf ${n} already exists for this sample.`;
  }
  return errors;
}

export function highCounts(leaf) {
  return LEAF_INPUT_FIELDS.filter((f) => Number(leaf[f.key]) > HIGH_COUNT);
}

export function validateSample(s, today = todayLocal()) {
  const errors = {};
  const n = Number(s.SampleNumber);
  if (isBlank(s.SampleNumber)) errors.SampleNumber = 'Enter the number written on the sample bag.';
  else if (!Number.isInteger(n) || n <= 0) errors.SampleNumber = 'Bag number must be a whole number above zero.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.CollectionDate || ''))) errors.CollectionDate = 'Choose the collection date.';
  else if (s.CollectionDate > today) errors.CollectionDate = 'Collection date cannot be in the future.';
  if (isBlank(s.BlockVarietyID)) errors.BlockVarietyID = 'Choose the block and variety.';
  else if (!(Number(s.AreaHaAtCollection) > 0)) errors.BlockVarietyID = 'This block has no area set. Ask an administrator.';
  return errors;
}

/** Other non-cancelled samples in the same season with the same bag number. */
export function duplicateBags(sample, samples) {
  const season = seasonOf(sample.CollectionDate);
  return samples.filter((o) => o.SampleID !== sample.SampleID && o.Status !== STATUS.CANCELLED &&
    String(o.SampleNumber) === String(sample.SampleNumber) && (o.Season || seasonOf(o.CollectionDate)) === season);
}

/** Fields copied from the block when it is chosen; frozen afterwards (§5.3). */
export function blockSnapshot(block) {
  return {
    BlockVarietyID: block.BlockVarietyID,
    Block: block.Block,
    Variety: block.Variety,
    AreaHaAtCollection: Number(block.AreaHa),
    TargetLeafCount: requiredLeaves(block.AreaHa),
  };
}

const round3 = (x) => Math.round(x * 1000) / 1000;

export function sampleSummary(sample, leaves) {
  const ls = liveLeaves(leaves);
  const n = ls.length;
  const sum = (k) => ls.reduce((t, l) => t + (Number(l[k]) || 0), 0);
  const tsm = sum('TetranychusCount');
  const pp = sum('PhytoseiulusCount');
  const infested = ls.filter((l) => Number(l.TetranychusCount) > 0).length;
  return {
    LeavesAnalysed: n,
    TotalTwoSM: tsm,
    AvgTwoSMPerLeaf: n ? round3(tsm / n) : null,
    TotalPP: pp,
    AvgPPPerLeaf: n ? round3(pp / n) : null,
    TotalTwoSMEggs: sum('TwoSpotEggCount'),
    AvgTwoSMEggsPerLeaf: n ? round3(sum('TwoSpotEggCount') / n) : null,
    TotalPredatorEggs: sum('PredatorEggCount'),
    AvgPredatorEggsPerLeaf: n ? round3(sum('PredatorEggCount') / n) : null,
    TotalOtherBeneficial: sum('OtherBeneficialCount'),
    AvgOtherBeneficialPerLeaf: n ? round3(sum('OtherBeneficialCount') / n) : null,
    PredatorToPestRatio: tsm ? round3(pp / tsm) : null,
    LeavesWithTwoSM: infested,
    TotalDead2SM: sum('DeadTetranychusCount'),
    TotalEaten2SMEggs: sum('EatenTwoSpotEggCount'),
    PctLeavesWithTwoSM: n ? round3(infested / n) : null,
  };
}

export const LEAF_EXPORT_HEADERS = [
  'SampleID', 'SampleNumber', 'Season', 'CollectionDate', 'WeekStarting', 'Collector', 'Block',
  'Variety', 'AreaHa', 'TargetLeafCount', 'LeafNumber', 'Analyst', 'AnalysisDateTime',
  'PhytoseiulusCount', 'TetranychusCount', 'PredatorEggCount', 'TwoSpotEggCount',
  'DeadTetranychusCount', 'EatenTwoSpotEggCount', 'OtherBeneficialCount',
  'LadybirdStethorusCount', 'LadybirdOtherCount', 'LacewingCount', 'PredatoryThripsCount', 'PredatoryMidgeCount',
  'SpiderCount', 'BeneficialOtherCount', 'OtherBeneficialDescription', 'LeafComment', 'SampleComments',
  'AnalysisComments', 'SampleStatus', 'SamplePhoto1', 'SamplePhoto2', 'LeafPhoto',
];

export const SUMMARY_HEADERS = [
  'SampleID', 'SampleNumber', 'Season', 'CollectionDate', 'WeekStarting', 'Block', 'Variety',
  'Status', 'TargetLeafCount', 'LeavesAnalysed', 'BelowTarget',
  'TotalTwoSM', 'AvgTwoSMPerLeaf', 'TotalPP', 'AvgPPPerLeaf',
  'TotalTwoSMEggs', 'TotalPredatorEggs', 'TotalOtherBeneficial',
  'PredatorToPestRatio', 'LeavesWithTwoSM', 'PctLeavesWithTwoSM', 'TotalDead2SM', 'TotalEaten2SMEggs', 'EarlyCompletionReason',
];

const photoRef = (v) => (String(v || '').startsWith('local:') ? '(not yet uploaded)' : v || '');

/** One row per live leaf, with sample context (§12.1). Same columns as the server export. */
export function leafExportRows(samples, leaves, nameOf = (e) => e) {
  const byId = new Map(samples.filter((s) => s.Status !== STATUS.CANCELLED).map((s) => [s.SampleID, s]));
  return liveLeaves(leaves)
    .filter((l) => byId.has(l.SampleID))
    .map((l) => [byId.get(l.SampleID), l])
    .sort(([sa, a], [sb, b]) => String(sa.CollectionDate).localeCompare(String(sb.CollectionDate)) ||
      Number(sa.SampleNumber) - Number(sb.SampleNumber) || String(sa.SampleID).localeCompare(String(sb.SampleID)) ||
      Number(a.LeafNumber) - Number(b.LeafNumber))
    .map(([s, l]) => [
      s.SampleID, s.SampleNumber, s.Season || seasonOf(s.CollectionDate), s.CollectionDate, weekStarting(s.CollectionDate),
      nameOf(s.CollectorEmail), s.Block, s.Variety, s.AreaHaAtCollection, s.TargetLeafCount, l.LeafNumber,
      nameOf(l.AnalystEmail), localDateTime(l.AnalysisDateTime), l.PhytoseiulusCount, l.TetranychusCount, l.PredatorEggCount,
      l.TwoSpotEggCount, l.DeadTetranychusCount ?? '', l.EatenTwoSpotEggCount ?? '', l.OtherBeneficialCount,
      ...BENEFICIAL_COUNTS.map((f) => l[f.key] ?? ''), l.OtherBeneficialDescription, l.LeafComment, s.SampleComments,
      s.AnalysisComments, s.Status, photoRef(s.SamplePhoto1), photoRef(s.SamplePhoto2), photoRef(l.LeafPhoto),
    ]);
}

export function summaryRows(samples, leavesBySample) {
  return samples
    .filter((s) => s.Status !== STATUS.CANCELLED)
    .sort((a, b) => String(a.CollectionDate).localeCompare(String(b.CollectionDate)) || Number(a.SampleNumber) - Number(b.SampleNumber))
    .map((s) => {
      const sum = sampleSummary(s, leavesBySample.get(s.SampleID) || []);
      const blank = (v) => (v === null ? '' : v);
      return [
        s.SampleID, s.SampleNumber, s.Season || seasonOf(s.CollectionDate), s.CollectionDate, weekStarting(s.CollectionDate),
        s.Block, s.Variety, s.Status, s.TargetLeafCount, sum.LeavesAnalysed,
        sum.LeavesAnalysed < Number(s.TargetLeafCount) ? 'YES' : 'NO',
        sum.TotalTwoSM, blank(sum.AvgTwoSMPerLeaf), sum.TotalPP, blank(sum.AvgPPPerLeaf),
        sum.TotalTwoSMEggs, sum.TotalPredatorEggs, sum.TotalOtherBeneficial,
        blank(sum.PredatorToPestRatio), sum.LeavesWithTwoSM, blank(sum.PctLeavesWithTwoSM),
        sum.TotalDead2SM, sum.TotalEaten2SMEggs, s.EarlyCompletionReason || '',
      ];
    });
}

export function toCSV(headers, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

export function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r[key])) m.set(r[key], []);
    m.get(r[key]).push(r);
  }
  return m;
}

/** Per-leaf averages charted week by week, one small chart each, in the farm's order. */
export const TREND_MEASURES = Object.freeze([
  { key: 'AvgPPPerLeaf', label: 'PP — predatory mites', short: 'PP' },
  { key: 'AvgTwoSMPerLeaf', label: '2SM — two-spotted mites', short: '2SM' },
  { key: 'AvgPredatorEggsPerLeaf', label: 'PP eggs', short: 'PP eggs' },
  { key: 'AvgTwoSMEggsPerLeaf', label: '2SM eggs', short: '2SM eggs' },
  { key: 'AvgOtherBeneficialPerLeaf', label: 'Beneficials', short: 'Beneficials' },
]);

/**
 * Trend points for one block/variety: one point per analysed sample, ordered by
 * collection date. Samples with no leaves (or an undefined measure) are skipped.
 */
export function trendPoints(samples, leavesBySample, blockVarietyId, measure, season = '') {
  return samples
    .filter((s) => s.BlockVarietyID === blockVarietyId && s.Status !== STATUS.CANCELLED &&
      (!season || (s.Season || seasonOf(s.CollectionDate)) === season))
    .map((s) => ({ date: s.CollectionDate, sample: s, value: sampleSummary(s, leavesBySample.get(s.SampleID) || [])[measure] }))
    .filter((p) => p.value !== null && p.value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(p.date))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Analysts may correct a completed sample for this many days after completion. */
export const ANALYST_EDIT_DAYS = 31;

/** Completed within the analyst correction window. */
export function recentlyCompleted(sample, now = Date.now()) {
  const t = new Date(sample?.AnalysisCompletedAt || NaN).getTime();
  return sample?.Status === STATUS.COMPLETE && Number.isFinite(t) && now - t <= ANALYST_EDIT_DAYS * 86400000;
}

/** Date after which analysts can no longer correct this completed sample. */
export function analystEditUntil(sample) {
  const t = new Date(sample?.AnalysisCompletedAt || NaN).getTime();
  return Number.isFinite(t) ? new Date(t + ANALYST_EDIT_DAYS * 86400000) : null;
}

/** Can this role perform this action on this sample? */
export function can(role, action, sample = {}, userEmail = '', now = Date.now()) {
  const r = normalizeRole(role);
  const user = ROLES.includes(r);
  const admin = isAdminRole(r);
  const owner = isOwnerRole(r);
  // A User may reopen/correct a completed sample they analysed, within 31 days.
  const correctable = admin || (user && analysedBy(sample, userEmail) && recentlyCompleted(sample, now));
  const own = String(sample.CollectorEmail || '').toLowerCase() === String(userEmail).toLowerCase();
  const working = [STATUS.DRAFT, STATUS.AWAITING, STATUS.IN_PROGRESS].includes(sample.Status);
  switch (action) {
    case 'createSample': return user;
    case 'editSample': return admin || (user && working) || (sample.Status === STATUS.COMPLETE && correctable);
    case 'changeBlock': return admin || [STATUS.DRAFT, STATUS.AWAITING].includes(sample.Status);
    case 'startAnalysis': return user && sample.Status === STATUS.AWAITING;
    case 'resumeAnalysis': return user && sample.Status === STATUS.IN_PROGRESS;
    case 'completeAnalysis': return user && sample.Status === STATUS.IN_PROGRESS;
    case 'editLeaves': return admin || (user && [STATUS.AWAITING, STATUS.IN_PROGRESS].includes(sample.Status)) ||
      (sample.Status === STATUS.COMPLETE && correctable);
    case 'addLeaves': return user && [STATUS.AWAITING, STATUS.IN_PROGRESS].includes(sample.Status);
    case 'cancelSample': return (admin && working) || (own && [STATUS.DRAFT, STATUS.AWAITING].includes(sample.Status));
    case 'reopen': return sample.Status === STATUS.COMPLETE && correctable;
    case 'restore': return admin && sample.Status === STATUS.CANCELLED;
    case 'analyse': return user;
    case 'viewAllCompleted': return admin;
    case 'reports': return admin;
    case 'export': return admin;
    case 'admin': return admin;
    case 'owner': return owner;
    default: return false;
  }
}

/** Resize an image to fit within maxSide (browser only). Returns a JPEG data URL. */
export async function compressImage(file, maxSide = 1600, quality = 0.75) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return canvas.toDataURL('image/jpeg', quality);
}

// ===========================================================================
// Plant Health: one check per bay (7 plants between two posts) per visit.
// Pick-lists exactly as on the farm's paper form; keep in sync with Setup.gs.
// ===========================================================================
export const SECTIONS = Object.freeze(['Mites', 'Plant Health']);

/** Sections a user can use. Blank/missing = all; administrators always have all. */
export function userSections(user) {
  if (!user) return [];
  if (isAdminRole(user.Role)) return [...SECTIONS];
  const raw = Array.isArray(user.Sections) ? user.Sections : String(user.Sections || '').split(',');
  const valid = raw.map((x) => String(x).trim()).filter((x) => SECTIONS.includes(x));
  return valid.length ? valid : [...SECTIONS];
}
export const hasSection = (user, section) => userSections(user).includes(section);

export const PLANT_OPTIONS = Object.freeze({
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
    'Harvest Ready',
  ],
  OverallBineHealth: ['Vigorous', 'Normal', 'Stunted', 'Pale/Chlorotic'],
  LeafSize: ['Small', 'Medium', 'Large'],
  LeafDamage: ['Chewing', 'Dark Spotting', 'Light Spotting', 'Vein Staining', 'Curling'],
});

/** Section 2 (block overview) questions, in form order. */
export const BLOCK_OVERVIEW = Object.freeze([
  { key: 'BineHealth', label: 'Bine health' },
  { key: 'CoirStatus', label: 'Coir status' },
  { key: 'WeedPressure', label: 'Weed pressure' },
  { key: 'GrassLength', label: 'Grass length' },
  { key: 'TrellisIntegrity', label: 'Trellis integrity' },
  { key: 'IrrigationLeaks', label: 'Irrigation leaks' },
]);

export const MAX_BINES_PER_BAY = 42; // 7 plants × 2 strings × 3 bines

/**
 * The farm's 7-step leaf colour chart (1 = light yellow-green … 7 = mid green).
 * Nov 2026: 1 made lighter and the old 5 (#3a6023) became 7; evenly spaced in between.
 */
export const LEAF_COLOURS = Object.freeze(['#d0e263', '#b9cc26', '#a1b40f', '#8a9d18', '#73861c', '#4f7520', '#3a6023']);

/** Short names of growth stages for charts and lists. */
export const STAGE_SHORT = Object.freeze(['Emergence', 'Training', 'Vegetative', 'Laterals', 'Burr / cone initiation', 'Cone development', 'Harvest ready']);
export const stageIndex = (stage) => PLANT_OPTIONS.GrowthStage.indexOf(stage);

/**
 * Which vine questions apply, from the form's notes:
 *  - internode <1 m: stop asking once the average height passes 2 m
 *  - internode 1–2 m: only once the average passes 2 m
 *  - internode 2–3 m: only once the average passes 3 m
 *  - lateral length: only from the Lateral Development stage on
 */
export function plantQuestions(check) {
  const h = Number(check.AvgBineHeightCm);
  const known = check.AvgBineHeightCm !== '' && check.AvgBineHeightCm !== null && check.AvgBineHeightCm !== undefined && Number.isFinite(h);
  return {
    InternodeUnder1mCm: !known || h <= 200,
    Internode1to2mCm: known && h > 200,
    Internode2to3mCm: known && h > 300,
    AvgLateralLengthCm: stageIndex(check.GrowthStage) >= stageIndex('Lateral Development (Side arm growth)'),
  };
}

const NUMBER_RULES = Object.freeze([
  { key: 'BinesTrained', label: 'Bines on string', min: 0, max: MAX_BINES_PER_BAY, whole: true },
  { key: 'AvgBineHeightCm', label: 'Average bine height', min: 0, max: 1000 },
  { key: 'MaxBineHeightCm', label: 'Maximum bine height', min: 0, max: 1000 },
  { key: 'InternodeUnder1mCm', label: 'Internode spacing <1 m', min: 0, max: 100 },
  { key: 'Internode1to2mCm', label: 'Internode spacing 1–2 m', min: 0, max: 100 },
  { key: 'Internode2to3mCm', label: 'Internode spacing 2–3 m', min: 0, max: 100 },
  { key: 'AvgLateralLengthCm', label: 'Average lateral length', min: 0, max: 500 },
  { key: 'SnappedTipsBine', label: 'Snapped bine tips', min: 0, max: 1000, whole: true },
  { key: 'SnappedTipsLateral', label: 'Snapped lateral tips', min: 0, max: 1000, whole: true },
]);

/** Validate a plant check. Returns {field: message}. Optional numbers may be blank. */
export function validatePlantCheck(c, today = todayLocal()) {
  const errors = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c.InspectionDate || ''))) errors.InspectionDate = 'Choose the inspection date.';
  else if (c.InspectionDate > today) errors.InspectionDate = 'The date cannot be in the future.';
  if (!c.BlockVarietyID) errors.BlockVarietyID = 'Choose the block and variety.';
  for (const f of ['Row', 'Bay']) {
    const n = Number(c[f]);
    if (c[f] === '' || c[f] === undefined || !Number.isInteger(n) || n < 1) errors[f] = `Enter the ${f.toLowerCase()} number.`;
  }
  if (!PLANT_OPTIONS.GrowthStage.includes(c.GrowthStage)) errors.GrowthStage = 'Choose the current growth stage.';
  for (const r of NUMBER_RULES) {
    const v = c[r.key];
    if (v === '' || v === null || v === undefined) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < r.min || n > r.max || (r.whole && !Number.isInteger(n))) {
      errors[r.key] = `${r.whole ? 'Whole number' : 'Number'} from ${r.min} to ${r.max}.`;
    }
  }
  const avg = Number(c.AvgBineHeightCm);
  const max = Number(c.MaxBineHeightCm);
  if (c.AvgBineHeightCm !== '' && c.MaxBineHeightCm !== '' && c.AvgBineHeightCm != null && c.MaxBineHeightCm != null &&
      !errors.AvgBineHeightCm && !errors.MaxBineHeightCm && max < avg) {
    errors.MaxBineHeightCm = 'The tallest bine cannot be shorter than the average.';
  }
  if (c.LeafColour !== '' && c.LeafColour != null && !(Number.isInteger(Number(c.LeafColour)) && c.LeafColour >= 1 && c.LeafColour <= LEAF_COLOURS.length)) {
    errors.LeafColour = 'Choose a colour from the chart.';
  }
  return errors;
}

export const PLANT_EXPORT_HEADERS = [
  'RecordNumber', 'Season', 'InspectionDate', 'WeekStarting', 'InspectionTime', 'Inspector',
  'Block', 'Variety', 'Row', 'Bay',
  'BineHealth', 'CoirStatus', 'WeedPressure', 'GrassLength', 'TrellisIntegrity', 'IrrigationLeaks',
  'GrowthStage', 'BinesOnString', 'AvgBineHeightCm', 'MaxBineHeightCm',
  'InternodeUnder1mCm', 'Internode1to2mCm', 'Internode2to3mCm', 'AvgLateralLengthCm',
  'SnappedTipsBine', 'SnappedTipsLateral', 'OverallBineHealth', 'LeafColour', 'LeafSize', 'LeafDamage',
  'Comments', 'OverviewPhoto', 'LeafPhoto1', 'LeafPhoto2', 'CheckID',
];

export function plantExportRows(checks, nameOf = (e) => e) {
  return checks
    .filter((c) => !toBoolean(c.Deleted))
    .sort((a, b) => String(a.InspectionDate).localeCompare(String(b.InspectionDate)) ||
      String(a.Block).localeCompare(String(b.Block), undefined, { numeric: true }) ||
      Number(a.Row) - Number(b.Row) || Number(a.Bay) - Number(b.Bay))
    .map((c) => PLANT_EXPORT_HEADERS.map((h) => {
      if (h === 'WeekStarting') return weekStarting(c.InspectionDate);
      if (h === 'Season') return c.Season || seasonOf(c.InspectionDate);
      if (h === 'Inspector') return nameOf(c.InspectorEmail);
      if (h === 'BinesOnString') return c.BinesTrained ?? ''; // stored in the BinesTrained column
      if (/Photo/.test(h)) return photoRef(c[h]);
      return c[h] ?? '';
    }));
}

/** Weekly series for one block: one point per check, in date order. */
export function plantSeries(checks, blockVarietyId, field, season = '') {
  return checks
    .filter((c) => !toBoolean(c.Deleted) && c.BlockVarietyID === blockVarietyId &&
      (!season || (c.Season || seasonOf(c.InspectionDate)) === season) &&
      c[field] !== '' && c[field] !== null && c[field] !== undefined && Number.isFinite(Number(c[field])))
    .map((c) => ({ date: c.InspectionDate, check: c, value: Number(c[field]) }))
    .sort((a, b) => a.date.localeCompare(b.date) || Number(a.check.Row) - Number(b.check.Row) || Number(a.check.Bay) - Number(b.check.Bay));
}

/** First date each growth stage was recorded, per block (for the stage timeline). */
export function stageTimeline(checks, season = '') {
  const out = new Map();
  for (const c of checks) {
    if (toBoolean(c.Deleted) || (season && (c.Season || seasonOf(c.InspectionDate)) !== season)) continue;
    const i = stageIndex(c.GrowthStage);
    if (i < 0) continue;
    const key = c.BlockVarietyID;
    if (!out.has(key)) out.set(key, { block: c.Block, variety: c.Variety, firstSeen: Array(PLANT_OPTIONS.GrowthStage.length).fill('') });
    const row = out.get(key);
    if (!row.firstSeen[i] || c.InspectionDate < row.firstSeen[i]) row.firstSeen[i] = c.InspectionDate;
  }
  return [...out.values()].sort((a, b) => `${a.block} ${a.variety}`.localeCompare(`${b.block} ${b.variety}`, undefined, { numeric: true }));
}

/** Can this user change this plant check? Own checks for 31 days; administrators always. */
export function canEditPlantCheck(user, check, now = Date.now()) {
  if (!user) return false;
  if (isAdminRole(user.Role)) return true;
  if (!hasSection(user, 'Plant Health')) return false;
  if (String(check.InspectorEmail || '').toLowerCase() !== String(user.UserEmail || '').toLowerCase()) return false;
  const t = new Date(check.CreatedAt || NaN).getTime();
  return !Number.isFinite(t) || now - t <= 31 * 86400000; // not yet uploaded = editable
}

/**
 * Work waiting in the mite section: samples to analyse, analyses in progress, and how
 * many days the oldest waiting sample has been waiting (from its collection date).
 */
export function mitesWaiting(samples, today = todayLocal()) {
  const awaiting = samples.filter((s) => s.Status === STATUS.AWAITING);
  const inProgress = samples.filter((s) => s.Status === STATUS.IN_PROGRESS).length;
  const dates = awaiting.map((s) => s.CollectionDate).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d))).sort();
  const oldestDays = dates.length
    ? Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`)) / 86400000))
    : null;
  return { awaiting: awaiting.length, inProgress, oldestDays };
}

/** "today", "1 day", "3 days" */
export const daysLabel = (n) => (n === 0 ? 'today' : n === 1 ? '1 day' : `${n} days`);

// ---------------------------------------------------------------------------
// Needs attention (admins and owners)
// ---------------------------------------------------------------------------
export const ATTENTION_LEVELS = [
  { key: 'ERROR', title: 'Fix these', note: 'Wrong or missing data that will spoil reports.' },
  { key: 'WARN', title: 'Check these', note: 'Probably fine, but worth a look.' },
  { key: 'INFO', title: 'For information', note: 'Nothing to fix; shown so nothing is hidden.' },
];

/**
 * Turns the server's list, the backup status and this tablet's upload queue into
 * the groups shown on the Needs attention screen. `count` (for the home badge)
 * leaves out information-only items.
 */
export function attentionSummary({ issues = [], backup = null, failedUploads = 0 } = {}) {
  const groups = ATTENTION_LEVELS.map((lvl) => ({ ...lvl, items: issues.filter((i) => i.severity === lvl.key) }))
    .filter((g) => g.items.length);
  const backupProblem = !!(backup && backup.overdue);
  const count = issues.filter((i) => i.severity !== 'INFO').length + (backupProblem ? 1 : 0) + (failedUploads ? 1 : 0);
  return { groups, count, backupProblem };
}

/** One line describing the backup state. */
export function backupText(backup, now = Date.now()) {
  if (!backup) return 'Backup status unknown.';
  const last = backup.last;
  const days = last ? Math.floor((now - new Date(last.at).getTime()) / 86400000) : null;
  const when = days === null ? '' : days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  const lastPart = !last ? 'No backup has been made yet.'
    : last.ok ? `Last backup ${when}.` : `The last backup (${when}) failed: ${last.error || 'unknown error'}.`;
  return `${lastPart} Weekly backup is ${backup.enabled ? 'on' : 'off'}.`;
}
