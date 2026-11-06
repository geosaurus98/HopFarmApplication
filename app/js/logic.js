// Pure functions: no DOM, no storage. Unit-tested with `node --test tests/js`.

export const STATUS = Object.freeze({
  DRAFT: 'Draft',
  AWAITING: 'Awaiting Analysis',
  IN_PROGRESS: 'Analysis In Progress',
  COMPLETE: 'Analysis Complete',
  CANCELLED: 'Cancelled',
});

export const COUNT_FIELDS = Object.freeze([
  { key: 'TetranychusCount', short: 'TwoSM', label: 'Two-spotted mite', latin: 'Tetranychus urticae' },
  { key: 'PhytoseiulusCount', short: 'PP', label: 'Predatory mite', latin: 'Phytoseiulus persimilis' },
  { key: 'TwoSpotEggCount', short: 'TwoSM eggs', label: 'Two-spotted mite eggs', latin: '' },
  { key: 'PredatorEggCount', short: 'Pred. eggs', label: 'Predator eggs', latin: '' },
  { key: 'OtherBeneficialCount', short: 'Other ben.', label: 'Other beneficials', latin: 'ladybirds, lacewings…' },
]);

export const BENEFICIAL_TYPES = Object.freeze([
  'Ladybird (Stethorus)', 'Ladybird (other)', 'Lacewing', 'Predatory thrips', 'Predatory midge', 'Spider', 'Other',
]);

export const EARLY_REASONS = Object.freeze([
  'Damaged leaves', 'Missing leaves', 'Contamination', 'Insufficient material', 'Other',
]);

export const HIGH_COUNT = 100;
export const ROLES = Object.freeze(['Collector', 'Analyst', 'Administrator']);

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
  for (const f of COUNT_FIELDS) {
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
  return COUNT_FIELDS.filter((f) => Number(leaf[f.key]) > HIGH_COUNT);
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
    TotalOtherBeneficial: sum('OtherBeneficialCount'),
    PredatorToPestRatio: tsm ? round3(pp / tsm) : null,
    LeavesWithTwoSM: infested,
    PctLeavesWithTwoSM: n ? round3(infested / n) : null,
  };
}

export const LEAF_EXPORT_HEADERS = [
  'SampleID', 'SampleNumber', 'Season', 'CollectionDate', 'WeekStarting', 'Collector', 'Block',
  'Variety', 'AreaHa', 'TargetLeafCount', 'LeafNumber', 'Analyst', 'AnalysisDateTime',
  'TetranychusCount', 'PhytoseiulusCount', 'TwoSpotEggCount', 'PredatorEggCount',
  'OtherBeneficialCount', 'OtherBeneficialDescription', 'LeafComment', 'SampleComments',
  'AnalysisComments', 'SampleStatus', 'SamplePhoto1', 'SamplePhoto2', 'LeafPhoto',
];

export const SUMMARY_HEADERS = [
  'SampleID', 'SampleNumber', 'Season', 'CollectionDate', 'WeekStarting', 'Block', 'Variety',
  'Status', 'TargetLeafCount', 'LeavesAnalysed', 'BelowTarget',
  'TotalTwoSM', 'AvgTwoSMPerLeaf', 'TotalPP', 'AvgPPPerLeaf',
  'TotalTwoSMEggs', 'TotalPredatorEggs', 'TotalOtherBeneficial',
  'PredatorToPestRatio', 'LeavesWithTwoSM', 'PctLeavesWithTwoSM', 'EarlyCompletionReason',
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
      nameOf(l.AnalystEmail), localDateTime(l.AnalysisDateTime), l.TetranychusCount, l.PhytoseiulusCount, l.TwoSpotEggCount,
      l.PredatorEggCount, l.OtherBeneficialCount, l.OtherBeneficialDescription, l.LeafComment, s.SampleComments,
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
        blank(sum.PredatorToPestRatio), sum.LeavesWithTwoSM, blank(sum.PctLeavesWithTwoSM), s.EarlyCompletionReason || '',
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

export const TREND_MEASURES = Object.freeze([
  { key: 'AvgTwoSMPerLeaf', label: 'Two-spotted mites per leaf' },
  { key: 'AvgPPPerLeaf', label: 'Predatory mites (PP) per leaf' },
  { key: 'AvgTwoSMEggsPerLeaf', label: 'Two-spotted mite eggs per leaf' },
  { key: 'PctLeavesWithTwoSM', label: 'Share of leaves with two-spotted mites' },
  { key: 'PredatorToPestRatio', label: 'Predator : pest ratio' },
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

/** Can this role perform this action on this sample? */
export function can(role, action, sample = {}, userEmail = '') {
  const admin = role === 'Administrator';
  const lab = admin || role === 'Analyst';
  const own = String(sample.CollectorEmail || '').toLowerCase() === String(userEmail).toLowerCase();
  switch (action) {
    case 'createSample': return ROLES.includes(role);
    case 'editSample': return admin || ([STATUS.DRAFT, STATUS.AWAITING].includes(sample.Status) && (own || lab)) ||
      (lab && sample.Status === STATUS.IN_PROGRESS);
    case 'changeBlock': return admin || [STATUS.DRAFT, STATUS.AWAITING].includes(sample.Status);
    case 'startAnalysis': return lab && sample.Status === STATUS.AWAITING;
    case 'resumeAnalysis': return lab && sample.Status === STATUS.IN_PROGRESS;
    case 'completeAnalysis': return lab && sample.Status === STATUS.IN_PROGRESS;
    case 'editLeaves': return admin || (lab && [STATUS.AWAITING, STATUS.IN_PROGRESS].includes(sample.Status));
    case 'cancelSample': return (admin && [STATUS.DRAFT, STATUS.AWAITING, STATUS.IN_PROGRESS].includes(sample.Status)) ||
      (own && [STATUS.DRAFT, STATUS.AWAITING].includes(sample.Status));
    case 'reopen': return admin && sample.Status === STATUS.COMPLETE;
    case 'restore': return admin && sample.Status === STATUS.CANCELLED;
    case 'analyse': return lab;
    case 'export': return lab;
    case 'admin': return admin;
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
