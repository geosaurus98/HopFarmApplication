/**
 * Hop Farm Application — web API for the tablet app.
 *
 * Deploy: Deploy > New deployment > Web app
 *   Execute as: Me            Who has access: Anyone
 * Copy the /exec URL into the app's sign-in screen ("Server address").
 *
 * Every request is a POST with a text/plain JSON body (avoids a CORS preflight):
 *   { action, email, code, ...params }
 * and is authenticated against the Users tab (Active user + AccessCode).
 *
 * Actions: login · pull · push · uploadPhoto · leaves · export · dataQuality
 */

const API_VERSION = 1;
const PULL_OVERLAP_MS = 5 * 60 * 1000;     // re-send records changed near the last pull
const INITIAL_LEAF_HISTORY_DAYS = 400;     // leaves cached on a device on first sync
const PHOTO_FOLDER_NAME = 'Hop Farm Photos';

function doGet() {
  return json_({ ok: true, app: 'Hop Farm API', version: API_VERSION });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Bad request' });
  }
  try {
    const user = authenticate_(body.email, body.code);
    switch (body.action) {
      case 'login': return json_({ ok: true, user: publicUser_(user), version: API_VERSION });
      case 'pull': return json_(Object.assign({ ok: true }, pull_(user, body.since)));
      case 'push': return json_(Object.assign({ ok: true }, push_(user, body.ops || [])));
      case 'uploadPhoto': return json_(Object.assign({ ok: true }, uploadPhoto_(user, body)));
      case 'leaves': return json_({ ok: true, leaves: leavesForSample_(body.sampleId) });
      case 'export': return json_(Object.assign({ ok: true }, export_(user, body)));
      case 'dataQuality': return json_({ ok: true, issues: requireAdmin_(user) && dataQualityIssues_() });
      default: throw new Error('Unknown action');
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err), auth: !!(err && err.auth) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------
function authError_(msg) {
  const e = new Error(msg);
  e.auth = true;
  return e;
}

function authenticate_(email, code) {
  email = String(email || '').trim().toLowerCase();
  code = String(code || '').trim();
  if (!email || !code) throw authError_('Enter your email and access code.');
  const user = readTable_('Users').filter(u => String(u.UserEmail).trim().toLowerCase() === email)[0];
  if (!user || String(user.AccessCode).trim() !== code) throw authError_('Email or access code not recognised.');
  if (!toBool_(user.Active)) throw authError_('This account is not active. Ask an administrator.');
  if (ROLES.indexOf(user.Role) === -1) throw authError_('This account has no valid role. Ask an administrator.');
  user.UserEmail = String(user.UserEmail).trim();
  return user;
}

function publicUser_(u) {
  return { UserEmail: u.UserEmail, UserName: u.UserName, Role: u.Role, Active: toBool_(u.Active) };
}

const isAdmin_ = u => u.Role === 'Administrator';
const isLab_ = u => u.Role === 'Analyst' || u.Role === 'Administrator';

function requireAdmin_(user) {
  if (!isAdmin_(user)) throw new Error('Administrators only.');
  return true;
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------
function pull_(user, since) {
  const now = new Date();
  const sinceTime = since ? new Date(since).getTime() - PULL_OVERLAP_MS : null;
  const changed = r => sinceTime === null || !(r.UpdatedAt instanceof Date) || r.UpdatedAt.getTime() > sinceTime;

  const samplesRaw = readTable_('Samples');
  const samples = samplesRaw.filter(changed).map(serializeRow_);

  let leavesRaw = readTable_('LeafAnalysis').filter(changed);
  if (sinceTime === null) {
    const cutoff = now.getTime() - INITIAL_LEAF_HISTORY_DAYS * 86400000;
    const recent = new Set(samplesRaw
      .filter(s => !(s.CollectionDate instanceof Date) || s.CollectionDate.getTime() >= cutoff)
      .map(s => s.SampleID));
    leavesRaw = leavesRaw.filter(l => recent.has(l.SampleID));
  }

  return {
    serverTime: now.toISOString(),
    user: publicUser_(user),
    users: readTable_('Users').map(publicUser_),
    blocks: readTable_('BlockVarieties').map(serializeRow_),
    help: readTable_('HelpReference').map(serializeRow_),
    samples: samples,
    leaves: leavesRaw.map(serializeRow_)
  };
}

function leavesForSample_(sampleId) {
  return readTable_('LeafAnalysis').filter(l => l.SampleID === sampleId).map(serializeRow_);
}

// ---------------------------------------------------------------------------
// Push: ops are applied in order. Each op is
//   { seq, table: 'Samples'|'LeafAnalysis', id, isNew, patch: {field: value} }
// Only the fields in the patch are changed, so two people editing different
// fields of the same record never overwrite each other.
// ---------------------------------------------------------------------------
const WRITABLE = {
  Samples: ['SampleNumber', 'CollectionDate', 'CollectorEmail', 'BlockVarietyID', 'Block', 'Variety',
    'AreaHaAtCollection', 'TargetLeafCount', 'SampleComments', 'SamplePhoto1', 'SamplePhoto2', 'Status',
    'AnalysisStartedAt', 'AnalysisStartedBy', 'AnalysisCompletedAt', 'CompletedBy', 'ActualLeafCount',
    'AnalysisComments', 'EarlyCompletionReason', 'CreatedAt'],
  LeafAnalysis: ['SampleID', 'LeafNumber', 'AnalystEmail', 'AnalysisDateTime'].concat(COUNT_FIELDS,
    ['OtherBeneficialDescription', 'LeafComment', 'LeafPhoto', 'Deleted', 'CreatedAt'])
};

const SNAPSHOT_FIELDS = ['BlockVarietyID', 'Block', 'Variety', 'AreaHaAtCollection', 'TargetLeafCount'];

function push_(user, ops) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const now = new Date();
    const tables = { Samples: openTable_('Samples'), LeafAnalysis: openTable_('LeafAnalysis') };
    const blocks = readTable_('BlockVarieties').reduce((m, b) => { m[b.BlockVarietyID] = b; return m; }, {});
    const results = [];
    const audits = [];
    ops.forEach(op => {
      try {
        applyOp_(user, op, tables, blocks, now, audits);
        results.push({ seq: op.seq, ok: true });
      } catch (err) {
        results.push({ seq: op.seq, ok: false, error: String(err && err.message || err) });
      }
    });
    tables.Samples.flush();
    tables.LeafAnalysis.flush();
    if (audits.length) appendRows_('AuditLog', audits);
    return { results: results, serverTime: now.toISOString() };
  } finally {
    lock.releaseLock();
  }
}

/** In-memory view of a sheet that writes back only changed or new rows. */
function openTable_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  const lastCol = sh.getLastColumn();
  const lastRow = sh.getLastRow();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const data = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  const key = KEYS[name];
  const rows = [];
  const byId = {};
  data.forEach((r, i) => {
    const o = {};
    headers.forEach((h, j) => { if (h !== '') o[h] = r[j]; });
    o.__row = i + 2;
    rows.push(o);
    if (o[key] !== '') byId[o[key]] = o;
  });
  const dirty = new Set();
  const added = [];
  return {
    rows: rows,
    get: id => byId[id],
    insert: rec => { added.push(rec); rows.push(rec); byId[rec[key]] = rec; },
    touch: rec => { if (rec.__row) dirty.add(rec); },
    flush: () => {
      const toRow = rec => headers.map(h => (h === '' || rec[h] === undefined ? '' : rec[h]));
      dirty.forEach(rec => sh.getRange(rec.__row, 1, 1, headers.length).setValues([toRow(rec)]));
      if (added.length) {
        const start = sh.getLastRow() + 1;
        sh.getRange(start, 1, added.length, headers.length).setValues(added.map(toRow));
        added.forEach((rec, i) => { rec.__row = start + i; });
      }
      dirty.clear();
      added.length = 0;
    }
  };
}

function appendRows_(name, objs) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.getRange(sh.getLastRow() + 1, 1, objs.length, headers.length)
    .setValues(objs.map(o => headers.map(h => (h in o ? o[h] : ''))));
}

function applyOp_(user, op, tables, blocks, now, audits) {
  const table = tables[op.table];
  if (!table) throw new Error('Unknown table ' + op.table);
  const key = KEYS[op.table];
  const id = String(op.id || '');
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new Error('Invalid record id');

  const patch = {};
  Object.keys(op.patch || {}).forEach(f => {
    if (WRITABLE[op.table].indexOf(f) === -1) return; // ignore read-only / unknown fields
    patch[f] = deserializeValue_(f, op.patch[f]);
  });

  const existing = table.get(id);
  const before = existing ? Object.assign({}, existing) : null;

  if (op.table === 'Samples') authorizeSample_(user, before, patch);
  else authorizeLeaf_(user, before, patch, tables.Samples);

  const rec = existing || {};
  if (!existing) {
    rec[key] = id;
    rec.CreatedAt = patch.CreatedAt || now;
  }
  Object.keys(patch).forEach(f => { if (f !== 'CreatedAt' || !existing) rec[f] = patch[f]; });

  if (op.table === 'Samples') finaliseSample_(rec, before, patch, blocks, user);
  else validateLeaf_(rec, tables.Samples);

  rec.UpdatedAt = now;
  rec.LastModifiedBy = user.UserEmail;
  if (existing) table.touch(rec); else table.insert(rec);

  const auditTarget = op.table === 'Samples' ? before : (before && tables.Samples.get(rec.SampleID));
  if (before && auditTarget && auditTarget.Status === STATUS.COMPLETE) {
    audits.push({
      AuditID: Utilities.getUuid(), TableName: op.table, RowID: id, ChangedBy: user.UserEmail,
      ChangedAt: now, Summary: diffSummary_(before, rec, Object.keys(patch))
    });
  }
}

function diffSummary_(before, after, fields) {
  const fmt = v => (v instanceof Date ? v.toISOString() : String(v === undefined ? '' : v));
  return fields
    .filter(f => fmt(before[f]) !== fmt(after[f]))
    .map(f => f + ': ' + fmt(before[f]) + ' → ' + fmt(after[f]))
    .join('; ') || '(no change)';
}

function authorizeSample_(user, before, patch) {
  if (isAdmin_(user)) return;
  const own = before ? String(before.CollectorEmail).toLowerCase() === user.UserEmail.toLowerCase() : true;
  if (!before) {
    if (patch.CollectorEmail && String(patch.CollectorEmail).toLowerCase() !== user.UserEmail.toLowerCase()) {
      throw new Error('You can only record samples under your own name.');
    }
    if (patch.Status && [STATUS.DRAFT, STATUS.AWAITING].indexOf(patch.Status) === -1) {
      throw new Error('New samples must be Awaiting Analysis.');
    }
    return;
  }
  if (before.Status === STATUS.COMPLETE || before.Status === STATUS.CANCELLED) {
    throw new Error('Only an administrator can change a ' + before.Status.toLowerCase() + ' sample.');
  }
  const analysisStarted = before.Status === STATUS.IN_PROGRESS;
  if (SNAPSHOT_FIELDS.some(f => f in patch) && analysisStarted) {
    throw new Error('The block cannot be changed after analysis has started.');
  }
  if ('Status' in patch && patch.Status !== before.Status) {
    const t = before.Status + ' -> ' + patch.Status;
    const allowed = {};
    allowed[STATUS.AWAITING + ' -> ' + STATUS.IN_PROGRESS] = isLab_(user);
    allowed[STATUS.IN_PROGRESS + ' -> ' + STATUS.COMPLETE] = isLab_(user);
    allowed[STATUS.DRAFT + ' -> ' + STATUS.AWAITING] = own;
    allowed[STATUS.AWAITING + ' -> ' + STATUS.CANCELLED] = own;
    allowed[STATUS.DRAFT + ' -> ' + STATUS.CANCELLED] = own;
    if (!allowed[t]) throw new Error('You are not allowed to change status ' + t + '.');
  }
  const collectorFields = ['SampleNumber', 'CollectionDate', 'SampleComments', 'SamplePhoto1', 'SamplePhoto2']
    .concat(SNAPSHOT_FIELDS, ['Status']);
  if (!isLab_(user)) {
    if (!own) throw new Error('You can only edit your own samples.');
    const bad = Object.keys(patch).filter(f => collectorFields.indexOf(f) === -1);
    if (bad.length) throw new Error('Not allowed to change ' + bad.join(', '));
  }
}

function authorizeLeaf_(user, before, patch, samples) {
  const sampleId = before ? before.SampleID : patch.SampleID;
  const sample = samples.get(sampleId);
  if (!sample) throw new Error('This leaf belongs to a sample that does not exist on the server.');
  if (isAdmin_(user)) return;
  if (!isLab_(user)) throw new Error('Only analysts can record leaf results.');
  if (before && 'SampleID' in patch && patch.SampleID !== before.SampleID) throw new Error('A leaf cannot be moved to another sample.');
  if ([STATUS.AWAITING, STATUS.IN_PROGRESS].indexOf(sample.Status) === -1) {
    throw new Error('Leaves can only be added or changed while the sample is being analysed (' + sample.Status + ').');
  }
}

function finaliseSample_(rec, before, patch, blocks, user) {
  if (!rec.SampleNumber || !(Number(rec.SampleNumber) > 0) || Number(rec.SampleNumber) !== Math.floor(Number(rec.SampleNumber))) {
    throw new Error('Bag number must be a whole number above zero.');
  }
  rec.SampleNumber = Number(rec.SampleNumber);
  if (!(rec.CollectionDate instanceof Date)) throw new Error('Collection date is required.');
  if (!rec.CollectorEmail) rec.CollectorEmail = user.UserEmail;
  rec.Season = seasonOf(isoDate_(rec.CollectionDate));
  if (!rec.Status) rec.Status = STATUS.AWAITING;
  if (STATUS_LIST.indexOf(rec.Status) === -1) throw new Error('Unknown status ' + rec.Status);

  // Block snapshot: only (re)taken when the block is chosen or changed, so later edits
  // to the block's area never alter historical samples.
  if (!before || ('BlockVarietyID' in patch && patch.BlockVarietyID !== before.BlockVarietyID)) {
    const b = blocks[rec.BlockVarietyID];
    if (!b) throw new Error('Unknown block and variety.');
    if (!before && !toBool_(b.Active)) throw new Error('That block and variety is no longer active.');
    rec.Block = b.Block;
    rec.Variety = b.Variety;
    rec.AreaHaAtCollection = Number(b.AreaHa);
    rec.TargetLeafCount = requiredLeaves(b.AreaHa);
    if (!rec.TargetLeafCount) throw new Error('The block area must be greater than zero.');
  }
  if (rec.Status === STATUS.IN_PROGRESS && !rec.AnalysisStartedAt) {
    rec.AnalysisStartedAt = new Date();
    rec.AnalysisStartedBy = user.UserEmail;
  }
  if (rec.Status === STATUS.COMPLETE && !rec.AnalysisCompletedAt) {
    rec.AnalysisCompletedAt = new Date();
    rec.CompletedBy = user.UserEmail;
  }
}

function validateLeaf_(rec, samples) {
  if (!samples.get(rec.SampleID)) throw new Error('Unknown sample.');
  const n = Number(rec.LeafNumber);
  if (!(n >= 1) || n !== Math.floor(n)) throw new Error('Leaf number must be a whole number from 1.');
  rec.LeafNumber = n;
  if (toBool_(rec.Deleted)) { rec.Deleted = true; return; }
  rec.Deleted = false;
  COUNT_FIELDS.forEach(f => {
    const v = rec[f];
    if (v === '' || v === null || v === undefined) throw new Error('Leaf ' + n + ': ' + f + ' is blank.');
    const x = Number(v);
    if (!(x >= 0) || x !== Math.floor(x)) throw new Error('Leaf ' + n + ': ' + f + ' must be a whole number of 0 or more.');
    rec[f] = x;
  });
  // A duplicate leaf number (two devices entering the same leaf offline) is kept, not
  // rejected, so no observation is lost; the data quality report lists it.
}

// ---------------------------------------------------------------------------
// Photos: stored in Drive, folder "Hop Farm Photos/<Samples|Leaves>".
// Idempotent: re-uploading the same photo id returns the existing file.
// ---------------------------------------------------------------------------
function uploadPhoto_(user, body) {
  const id = String(body.photoId || '');
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new Error('Invalid photo id');
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(body.dataUrl || ''));
  if (!m) throw new Error('Photo must be a JPEG, PNG or WebP image.');
  const sub = body.kind === 'leaf' ? 'Leaves' : 'Samples';
  const folder = photoFolder_(sub);
  const name = id + (m[1] === 'image/png' ? '.png' : m[1] === 'image/webp' ? '.webp' : '.jpg');
  const existing = folder.getFilesByName(name);
  if (existing.hasNext()) return { url: existing.next().getUrl() };
  const file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name));
  file.setDescription('Uploaded by ' + user.UserEmail + (body.label ? ' — ' + body.label : ''));
  return { url: file.getUrl() };
}

function photoFolder_(sub) {
  const props = PropertiesService.getScriptProperties();
  const propKey = 'PHOTO_FOLDER_' + sub;
  const cached = props.getProperty(propKey);
  if (cached) {
    try { return DriveApp.getFolderById(cached); } catch (e) { /* recreated below */ }
  }
  const rootIt = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  const root = rootIt.hasNext() ? rootIt.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
  const subIt = root.getFoldersByName(sub);
  const folder = subIt.hasNext() ? subIt.next() : root.createFolder(sub);
  props.setProperty(propKey, folder.getId());
  return folder;
}

// ---------------------------------------------------------------------------
// Export: CSV text for Excel
// ---------------------------------------------------------------------------
function export_(user, body) {
  if (!isLab_(user)) throw new Error('Only analysts and administrators can export.');
  const filter = { season: body.season || '', blockVarietyId: body.blockVarietyId || '' };
  const suffix = (filter.season ? '_' + filter.season.replace('/', '-') : '_all-seasons') +
    '_' + Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  if (body.type === 'summary') {
    const rows = sampleSummaryRows_(filter);
    return { csv: toCsv_(SUMMARY_HEADERS, rows), rows: rows.length, filename: 'hopfarm_sample_summary' + suffix + '.csv' };
  }
  const rows = leafExportRows_(filter);
  return { csv: toCsv_(LEAF_EXPORT_HEADERS, rows), rows: rows.length, filename: 'hopfarm_leaf_results' + suffix + '.csv' };
}
