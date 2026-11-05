// IndexedDB storage. Everything the app shows is read from here, so it works offline.
// Every local change is written together with an "outbox" entry in one transaction,
// so a change can never be saved without also being queued for upload.

const DB_NAME = 'hopfarm';
const DB_VERSION = 1;
let dbPromise;

export const STORES = {
  Samples: 'samples',
  LeafAnalysis: 'leaves',
};

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('samples', { keyPath: 'SampleID' });
        d.createObjectStore('leaves', { keyPath: 'LeafAnalysisID' }).createIndex('SampleID', 'SampleID');
        d.createObjectStore('blocks', { keyPath: 'BlockVarietyID' });
        d.createObjectStore('users', { keyPath: 'UserEmail' });
        d.createObjectStore('help', { keyPath: 'HelpID' });
        d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
        d.createObjectStore('photos', { keyPath: 'id' });
        d.createObjectStore('meta');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('Close other Hop Farm tabs and reload.'));
    });
  }
  return dbPromise;
}

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (t) => new Promise((res, rej) => {
  t.oncomplete = () => res();
  t.onerror = () => rej(t.error);
  t.onabort = () => rej(t.error || new Error('Transaction aborted'));
});

export async function getAll(store, indexName, key) {
  const d = await openDB();
  const s = d.transaction(store).objectStore(store);
  return req(indexName ? s.index(indexName).getAll(key) : s.getAll());
}

export async function get(store, key) {
  const d = await openDB();
  return req(d.transaction(store).objectStore(store).get(key));
}

export async function put(store, value, key) {
  const d = await openDB();
  const t = d.transaction(store, 'readwrite');
  t.objectStore(store).put(value, key);
  return done(t);
}

export async function del(store, key) {
  const d = await openDB();
  const t = d.transaction(store, 'readwrite');
  t.objectStore(store).delete(key);
  return done(t);
}

export async function countBy(store, indexName, key) {
  const d = await openDB();
  return req(d.transaction(store).objectStore(store).index(indexName).count(key));
}

export async function count(store) {
  const d = await openDB();
  return req(d.transaction(store).objectStore(store).count());
}

/** Replace the contents of a reference store (blocks, users, help). */
export async function replaceAll(store, rows) {
  const d = await openDB();
  const t = d.transaction(store, 'readwrite');
  const s = t.objectStore(store);
  s.clear();
  rows.forEach((r) => s.put(r));
  return done(t);
}

export const getMeta = (key) => get('meta', key);
export const setMeta = (key, value) => put('meta', value, key);

/**
 * Save records locally and queue them for upload, atomically.
 * changes: [{ table: 'Samples'|'LeafAnalysis', record, patch, isNew, remove }]
 * (remove: drop the local copy, e.g. a deleted leaf; the patch still goes to the server)
 * photos:  [{ id, dataUrl, kind, label }] new photos to upload later
 */
export async function saveChanges(changes, photos = []) {
  const d = await openDB();
  const t = d.transaction(['samples', 'leaves', 'outbox', 'photos'], 'readwrite');
  for (const c of changes) {
    const key = c.table === 'Samples' ? 'SampleID' : 'LeafAnalysisID';
    if (c.remove) t.objectStore(STORES[c.table]).delete(c.record[key]);
    else t.objectStore(STORES[c.table]).put(c.record);
    t.objectStore('outbox').add({
      table: c.table, id: c.record[key], isNew: !!c.isNew, patch: c.patch, queuedAt: new Date().toISOString(),
    });
  }
  photos.forEach((p) => t.objectStore('photos').put({ ...p, queuedAt: new Date().toISOString() }));
  return done(t);
}

/** Remove everything (sign-out). */
export async function wipe() {
  const d = await openDB();
  const names = Array.from(d.objectStoreNames);
  const t = d.transaction(names, 'readwrite');
  names.forEach((n) => t.objectStore(n).clear());
  return done(t);
}
