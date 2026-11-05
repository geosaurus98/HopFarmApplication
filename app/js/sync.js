// Talking to the Apps Script API, and keeping the device and the sheet in step.
import * as db from './db.js';

const listeners = new Set();
let state = { syncing: false, pending: 0, photosPending: 0, failed: 0, lastSync: null, lastError: '', online: navigator.onLine };
let inFlight = null;
let autoTimer = null;

export function onStatus(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

function emit(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

export const getStatus = () => state;

export class AuthError extends Error {}
export class OfflineError extends Error {}

/** POST to the API. text/plain avoids a CORS preflight, which Apps Script cannot answer. */
export async function api(action, params = {}, creds) {
  const session = creds || (await db.getMeta('session'));
  const url = session?.apiUrl;
  if (!url) throw new AuthError('No server address set.');
  if (!navigator.onLine) throw new OfflineError('No internet connection.');
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, email: session.email, code: session.code, ...params }),
      redirect: 'follow',
    });
  } catch (e) {
    throw new OfflineError('Could not reach the server. Check the internet connection.');
  }
  let body;
  try {
    body = await res.json();
  } catch (e) {
    throw new Error(`Unexpected reply from the server (HTTP ${res.status}). Check the server address.`);
  }
  if (!body.ok) throw body.auth ? new AuthError(body.error) : new Error(body.error || 'Server error');
  return body;
}

export async function refreshCounts() {
  const [outbox, photos, lastSync] = await Promise.all([db.getAll('outbox'), db.count('photos'), db.getMeta('lastSync')]);
  emit({
    pending: outbox.length,
    failed: outbox.filter((o) => o.error).length,
    photosPending: photos,
    lastSync: lastSync || null,
    online: navigator.onLine,
  });
}

/** Upload, then download. Safe to call any time; concurrent calls share one run. */
export function sync() {
  if (!inFlight) {
    inFlight = runSync().finally(() => { inFlight = null; });
  }
  return inFlight;
}

async function runSync() {
  emit({ syncing: true, online: navigator.onLine });
  try {
    await uploadPhotos();
    await pushOutbox();
    await pull();
    const now = new Date().toISOString();
    await db.setMeta('lastSync', now);
    emit({ lastError: '' });
    return true;
  } catch (e) {
    emit({ lastError: e instanceof OfflineError ? '' : e.message });
    if (e instanceof AuthError) throw e;
    return false;
  } finally {
    await refreshCounts();
    emit({ syncing: false });
  }
}

async function uploadPhotos() {
  const photos = await db.getAll('photos');
  for (const p of photos) {
    const { url } = await api('uploadPhoto', { photoId: p.id, dataUrl: p.dataUrl, kind: p.kind, label: p.label || '' });
    await replacePhotoRef(`local:${p.id}`, url);
    await db.del('photos', p.id);
  }
}

/** Swap a local photo placeholder for its Drive URL in records and queued changes. */
async function replacePhotoRef(ref, url) {
  const fix = (obj) => {
    let changed = false;
    for (const k of Object.keys(obj || {})) if (obj[k] === ref) { obj[k] = url; changed = true; }
    return changed;
  };
  for (const op of await db.getAll('outbox')) if (fix(op.patch)) await db.put('outbox', op);
  for (const s of await db.getAll('samples')) if (fix(s)) await db.put('samples', s);
  for (const l of await db.getAll('leaves')) if (fix(l)) await db.put('leaves', l);
}

const PUSH_BATCH = 150;

async function pushOutbox() {
  const ops = await db.getAll('outbox');
  // Ops that still reference an un-uploaded photo wait for the next run.
  const ready = ops.filter((o) => !Object.values(o.patch || {}).some((v) => String(v).startsWith('local:')));
  for (let i = 0; i < ready.length; i += PUSH_BATCH) {
    const batch = ready.slice(i, i + PUSH_BATCH);
    const { results } = await api('push', {
      ops: batch.map((o) => ({ seq: o.seq, table: o.table, id: o.id, isNew: o.isNew, patch: o.patch })),
    });
    const bySeq = new Map(results.map((r) => [r.seq, r]));
    for (const o of batch) {
      const r = bySeq.get(o.seq);
      if (r?.ok) await db.del('outbox', o.seq);
      else if (r) await db.put('outbox', { ...o, error: r.error, failedAt: new Date().toISOString() });
    }
  }
}

async function pull() {
  const since = await db.getMeta('lastPull');
  const data = await api('pull', since ? { since } : {});
  const pendingIds = new Set((await db.getAll('outbox')).map((o) => o.id));

  await db.replaceAll('users', data.users);
  await db.replaceAll('blocks', data.blocks);
  await db.replaceAll('help', data.help);
  for (const s of data.samples) if (!pendingIds.has(s.SampleID)) await db.put('samples', s);
  for (const l of data.leaves) {
    if (pendingIds.has(l.LeafAnalysisID)) continue;
    if (l.Deleted) await db.del('leaves', l.LeafAnalysisID);
    else await db.put('leaves', l);
  }
  const session = await db.getMeta('session');
  if (session && data.user) await db.setMeta('session', { ...session, user: data.user });
  await db.setMeta('lastPull', data.serverTime);
}

/** Fetch every leaf of one sample (used for samples older than the device cache). */
export async function fetchLeaves(sampleId) {
  const { leaves } = await api('leaves', { sampleId });
  const pendingIds = new Set((await db.getAll('outbox')).map((o) => o.id));
  for (const l of leaves) if (!pendingIds.has(l.LeafAnalysisID) && !l.Deleted) await db.put('leaves', l);
  return leaves.length;
}

/** Sync shortly after a change, when coming back online, and every 2 minutes while changes wait. */
export function startAutoSync(onAuthError) {
  const run = () => sync().catch((e) => { if (e instanceof AuthError) onAuthError?.(e); });
  window.addEventListener('online', () => { emit({ online: true }); run(); });
  window.addEventListener('offline', () => emit({ online: false }));
  clearInterval(autoTimer);
  autoTimer = setInterval(() => {
    if (navigator.onLine && (state.pending || state.photosPending)) run();
  }, 120000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) run();
  });
  return run;
}

let soonTimer = null;
export function syncSoon() {
  refreshCounts();
  clearTimeout(soonTimer);
  soonTimer = setTimeout(() => { if (navigator.onLine) sync().catch(() => {}); }, 2000);
}
