/**
 * Hop Farm Application — web API for the tablet app.
 *
 * Deploy: Deploy > New deployment > Web app
 *   Execute as: Me            Who has access: Anyone
 * Copy the /exec URL into the app's sign-in screen ("Server address").
 *
 * Every request is a POST with a text/plain JSON body (avoids a CORS preflight):
 *   { action, login, code, ...params }
 * where login is the person's Username or email address, and is authenticated
 * against the Users tab (Active user + AccessCode).
 *
 * Actions: login · pull · push · uploadPhoto · leaves · export · dataQuality
 *          listUsers · saveUser (administrators only)
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
    const user = authenticate_(body.login || body.email, body.code);
    switch (body.action) {
      case 'login': return json_({ ok: true, user: publicUser_(user), version: API_VERSION });
      case 'pull': return json_(Object.assign({ ok: true }, pull_(user, body.since)));
      case 'push': return json_(Object.assign({ ok: true }, push_(user, body.ops || [])));
      case 'uploadPhoto': return json_(Object.assign({ ok: true }, uploadPhoto_(user, body)));
      case 'leaves': return json_({ ok: true, leaves: leavesForSample_(body.sampleId) });
      case 'export': return json_(Object.assign({ ok: true }, export_(user, body)));
      case 'dataQuality': return json_({ ok: true, issues: requireAdmin_(user) && dataQualityIssues_() });
      case 'listUsers': return json_({ ok: true, users: requireAdmin_(user) && readTable_('Users').map(adminUser_) });
      case 'saveUser': return json_(Object.assign({ ok: true }, saveUser_(user, body.user || {}, !!body.isNew)));
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

/** Sign in with Username or email address (case-insensitive) plus access code. */
function authenticate_(login, code) {
  login = String(login || '').trim().toLowerCase();
  code = String(code || '').trim();
  if (!login || !code) throw authError_('Enter your username and access code.');
  const users = readTable_('Users').filter(u => String(u.UserEmail || '').trim() !== '');
  let matches = users.filter(u => String(u.UserEmail).trim().toLowerCase() === login);
  if (!matches.length) matches = users.filter(u => String(u.Username || '').trim().toLowerCase() === login);
  if (matches.length > 1) throw authError_('Two people share the username "' + login + '". Ask an administrator to fix the Users tab.');
  const user = matches[0];
  if (!user || String(user.AccessCode).trim() !== code) throw authError_('Username or access code not recognised.');
  if (!toBool_(user.Active)) throw authError_('This account is not active. Ask an administrator.');
  if (ROLES.indexOf(user.Role) === -1) throw authError_('This account has no valid role. Ask an administrator.');
  user.UserEmail = String(user.UserEmail).trim();
  return user;
}

function publicUser_(u) {
  return { UserEmail: u.UserEmail, Username: String(u.Username || '').trim(), FullName: displayName_(u), Role: u.Role, Active: toBool_(u.Active) };
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

/** Analysts may correct a completed sample for this many days after completion (client, Nov 2026). */
const ANALYST_EDIT_DAYS = 31;

function recentlyCompleted_(s) {
  const t = s && s.AnalysisCompletedAt instanceof Date ? s.AnalysisCompletedAt.getTime() : NaN;
  return s && s.Status === STATUS.COMPLETE && !isNaN(t) && (Date.now() - t) <= ANALYST_EDIT_DAYS * 86400000;
}

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
  const labCanCorrect = isLab_(user) && recentlyCompleted_(before);
  if (before.Status === STATUS.CANCELLED || (before.Status === STATUS.COMPLETE && !labCanCorrect)) {
    throw new Error(before.Status === STATUS.COMPLETE
      ? 'This sample was completed more than ' + ANALYST_EDIT_DAYS + ' days ago. Only an administrator can change it now.'
      : 'Only an administrator can change a cancelled sample.');
  }
  const analysisStarted = before.Status === STATUS.IN_PROGRESS || before.Status === STATUS.COMPLETE;
  if (SNAPSHOT_FIELDS.some(f => f in patch) && analysisStarted) {
    throw new Error('The block cannot be changed after analysis has started.');
  }
  if ('Status' in patch && patch.Status !== before.Status) {
    const t = before.Status + ' -> ' + patch.Status;
    const allowed = {};
    allowed[STATUS.AWAITING + ' -> ' + STATUS.IN_PROGRESS] = isLab_(user);
    allowed[STATUS.IN_PROGRESS + ' -> ' + STATUS.COMPLETE] = isLab_(user);
    allowed[STATUS.COMPLETE + ' -> ' + STATUS.IN_PROGRESS] = labCanCorrect; // reopen
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
  if ([STATUS.AWAITING, STATUS.IN_PROGRESS].indexOf(sample.Status) !== -1) return;
  if (recentlyCompleted_(sample)) {
    if (!before) throw new Error('This sample is complete. Reopen the analysis to add leaves.');
    return; // correcting or deleting a leaf of a recently completed sample
  }
  if (sample.Status === STATUS.COMPLETE) {
    throw new Error('This sample was completed more than ' + ANALYST_EDIT_DAYS + ' days ago. Only an administrator can change its leaves now.');
  }
  throw new Error('Leaves can only be added or changed while the sample is being analysed (' + sample.Status + ').');
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

// ---------------------------------------------------------------------------
// User management (administrators only)
// ---------------------------------------------------------------------------
const USERNAME_RE = /^[a-z0-9._-]{2,40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCESS_CODE_RE = /^[1-9]\d{3,11}$/; // no leading zero: Sheets would drop it

/** Admin view of a user: includes the access code so it can be passed on. */
function adminUser_(u) {
  return Object.assign(publicUser_(u), {
    AccessCode: String(u.AccessCode || '').trim(),
    CreatedAt: serializeValue_('CreatedAt', u.CreatedAt),
    UpdatedAt: serializeValue_('UpdatedAt', u.UpdatedAt)
  });
}

/**
 * Add (isNew) or update a user. Email identifies the person and cannot be
 * changed afterwards, because samples and leaves are linked by it.
 * A blank access code on a new user generates one.
 * Other administrators are view-only (an admin may edit their own name,
 * username and code, but not their own role or access).
 */
function saveUser_(admin, input, isNew) {
  requireAdmin_(admin);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const table = openTable_('Users');
    const email = String(input.UserEmail || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new Error('Enter a valid email address.');
    const same = r => String(r.UserEmail || '').trim().toLowerCase() === email;
    const existing = table.rows.filter(same)[0];
    if (isNew && existing) throw new Error('A user with this email already exists.');
    if (!isNew && !existing) throw new Error('User not found.');
    const isSelf = email === String(admin.UserEmail).trim().toLowerCase();
    if (existing && existing.Role === 'Administrator' && !isSelf) {
      throw new Error('Other administrators can be viewed but not changed. The spreadsheet owner can change them in the Users tab.');
    }

    const username = String(input.Username || '').trim().toLowerCase();
    if (!USERNAME_RE.test(username)) throw new Error('Username: 2–40 characters, letters, numbers, dots, dashes or underscores only, no spaces.');
    const clash = table.rows.filter(r => !same(r) && String(r.UserEmail || '').trim() !== '' &&
      (String(r.Username || '').trim().toLowerCase() === username || String(r.UserEmail).trim().toLowerCase() === username))[0];
    if (clash) throw new Error('The username "' + username + '" is already taken.');

    const fullName = String(input.FullName || '').trim();
    if (!fullName) throw new Error('Enter the person\'s full name.');
    if (ROLES.indexOf(input.Role) === -1) throw new Error('Choose a role.');
    const active = input.Active === undefined ? true : toBool_(input.Active);

    let code = String(input.AccessCode || '').trim();
    if (!code && isNew) code = newAccessCode_();
    if (code && !ACCESS_CODE_RE.test(code)) throw new Error('Access code: 4–12 digits, not starting with 0.');

    if (isSelf && (!active || input.Role !== 'Administrator')) {
      throw new Error('You cannot remove your own administrator access. Ask another administrator.');
    }

    const now = new Date();
    const rec = existing || { UserEmail: email, CreatedAt: now };
    const before = existing ? Object.assign({}, existing) : null;
    rec.Username = username;
    rec.FullName = fullName;
    rec.Role = input.Role;
    rec.Active = active;
    if (code) rec.AccessCode = code;
    rec.UpdatedAt = now;
    if (existing) table.touch(rec); else table.insert(rec);
    table.flush();

    const changes = before
      ? ['Username', 'FullName', 'Role', 'Active']
          .filter(f => String(before[f]) !== String(rec[f]))
          .map(f => f + ': ' + before[f] + ' → ' + rec[f])
          .concat(String(before.AccessCode) !== String(rec.AccessCode) ? ['AccessCode changed'] : [])
      : ['Added as ' + rec.Role];
    appendRows_('AuditLog', [{
      AuditID: Utilities.getUuid(), TableName: 'Users', RowID: email, ChangedBy: admin.UserEmail,
      ChangedAt: now, Summary: changes.join('; ') || '(no change)'
    }]);
    return { user: adminUser_(rec) };
  } finally {
    lock.releaseLock();
  }
}
