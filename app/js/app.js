import * as db from './db.js';
import * as L from './logic.js';
import { STATUS, COUNT_FIELDS, can } from './logic.js';
import { api, sync, syncSoon, onStatus, refreshCounts, startAutoSync, fetchLeaves, AuthError, OfflineError, getStatus } from './sync.js';
import { h, svg, mount, toast, confirmDialog, fmtDate, fmtDateTime, fmtAgo, pct, download, field, statusPill, progressBar } from './ui.js';
import { DEFAULT_API_URL, APP_VERSION } from './config.js';

const main = () => document.getElementById('main');
let session = null; // { apiUrl, login, code, user: { UserEmail, Username, FullName, Role } }

const displayName = (u) => (u && (u.FullName || u.UserName || u.Username || u.UserEmail)) || '';

const role = () => session?.user?.Role || '';
const me = () => session?.user?.UserEmail || '';
const nowIso = () => new Date().toISOString();
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

async function userNames() {
  const users = await db.getAll('users');
  const m = new Map(users.map((u) => [String(u.UserEmail).toLowerCase(), displayName(u)]));
  return (email) => m.get(String(email || '').toLowerCase()) || email || '';
}

// ---------------------------------------------------------------------------
// Boot, header and routing
// ---------------------------------------------------------------------------
async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  watchForUpdates();
  // Ask the browser not to evict our data under storage pressure.
  navigator.storage?.persist?.().catch(() => {});

  session = await db.getMeta('session');
  renderHeader();
  onStatus(renderSyncBadge);
  await refreshCounts();
  window.addEventListener('hashchange', render);
  const runSync = startAutoSync(() => showAuthBanner());
  await render();
  if (session && navigator.onLine) {
    runSync();
  }
}

function renderHeader() {
  const header = document.getElementById('header');
  mount(header,
    h('a', { class: 'brand', href: '#/' }, h('img', { src: 'icons/icon.svg', alt: '' }), h('span', {}, 'Hop Farm')),
    h('div', { class: 'spacer' }),
    session ? h('span', { class: 'who' }, `${displayName(session.user)} · ${session.user.Role}`) : null,
    session ? h('a', { class: 'sync-badge', id: 'syncBadge', href: '#/sync', 'aria-label': 'Sync status' }) : null);
  renderSyncBadge(getStatus());
}

function renderSyncBadge(st) {
  const el = document.getElementById('syncBadge');
  if (!el) return;
  const waiting = st.pending + st.photosPending;
  let text;
  let cls;
  if (st.syncing) { text = 'Syncing…'; cls = 'busy'; }
  else if (st.failed) { text = `${st.failed} need attention`; cls = 'bad'; }
  else if (waiting) { text = `${waiting} waiting to upload`; cls = 'warn'; }
  else { text = 'All synced'; cls = 'good'; }
  el.className = `sync-badge ${cls}`;
  el.replaceChildren(h('span', { class: `dot ${st.online ? 'on' : 'off'}` }), st.online ? '' : 'Offline · ', text);
  const banner = document.getElementById('offlineBanner');
  if (banner) banner.hidden = st.online;
}

/**
 * An open tab keeps running the version it started with. Check the published
 * version when the app starts, comes back into view or comes online, and offer
 * a one-tap reload when it has changed.
 */
function watchForUpdates() {
  const check = async () => {
    if (!navigator.onLine) return;
    try {
      const res = await fetch(`js/config.js?check=${Date.now()}`, { cache: 'no-store' });
      const m = /APP_VERSION\s*=\s*'([^']+)'/.exec(await res.text());
      if (m && m[1] !== APP_VERSION) showUpdateBanner(m[1]);
    } catch (e) { /* offline or host unreachable: try again later */ }
  };
  check();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('online', check);
  setInterval(check, 30 * 60 * 1000);
}

function showUpdateBanner(version) {
  if (document.getElementById('updateBanner')) return;
  const reload = async () => {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update();
    } catch (e) { /* reload anyway */ }
    location.reload();
  };
  document.getElementById('header').after(h('div', { id: 'updateBanner', class: 'update-banner' },
    h('span', {}, `A new version of the app is available (${version}).`),
    h('button', { class: 'btn primary small', type: 'button', onclick: reload }, 'Update now')));
}

function showAuthBanner() {
  toast('Your sign-in was not accepted. Open Sync and sign in again — nothing on this tablet is lost.', 'bad');
}

const routes = [
  [/^#\/login$/, viewLogin, false],
  [/^#?\/?$/, viewHome],
  [/^#\/new$/, () => viewSampleForm(null)],
  [/^#\/edit\/([\w-]+)$/, (id) => viewSampleForm(id)],
  [/^#\/samples\/(\w+)$/, viewSampleList],
  [/^#\/sample\/([\w-]+)$/, viewSample],
  [/^#\/leaf\/([\w-]+)\/([\w-]+)$/, viewLeaf],
  [/^#\/complete\/([\w-]+)$/, viewComplete],
  [/^#\/reports$/, viewReports],
  [/^#\/help$/, viewHelp],
  [/^#\/users$/, viewUsers],
  [/^#\/user\/([^/]+)$/, (id) => viewUserForm(decodeURIComponent(id))],
  [/^#\/sync$/, viewSync],
];

// Renders run one after another, so a slow screen can never overwrite a newer one.
let renderChain = Promise.resolve();
let renderQueued = false;
function render() {
  if (renderQueued) return renderChain; // one pending render already covers this request
  renderQueued = true;
  const run = () => { renderQueued = false; return renderNow(); };
  renderChain = renderChain.then(run, run);
  return renderChain;
}

async function renderNow() {
  const hash = location.hash || '#/';
  if (!session && hash !== '#/login') { location.hash = '#/login'; return; }
  for (const [re, fn, needsAuth = true] of routes) {
    const m = re.exec(hash);
    if (m) {
      if (needsAuth && !session) return;
      try {
        await fn(...m.slice(1));
      } catch (e) {
        console.error(e);
        mount(main(), h('div', { class: 'card' }, h('h2', {}, 'Something went wrong'), h('p', {}, e.message),
          h('a', { class: 'btn primary', href: '#/' }, 'Home')));
      }
      window.scrollTo(0, 0);
      return;
    }
  }
  go('#/');
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------
async function viewLogin() {
  // Never redraw over a sign-in form that is already showing: it would wipe what was typed.
  if (main().querySelector('form #login')) return;
  const saved = (await db.getMeta('lastLogin')) || {};
  const apiUrl = h('input', { id: 'apiUrl', type: 'text', inputmode: 'url', spellcheck: false, value: saved.apiUrl || DEFAULT_API_URL, placeholder: 'https://script.google.com/macros/s/…/exec', autocomplete: 'off' });
  const login = h('input', {
    id: 'login', type: 'text', value: saved.login || saved.email || '', autocomplete: 'username',
    autocapitalize: 'none', autocorrect: 'off', spellcheck: false, required: true,
  });
  const code = h('input', { id: 'code', type: 'password', inputmode: 'numeric', autocomplete: 'current-password', required: true });
  const msg = h('p', { class: 'error', role: 'alert' });
  const btn = h('button', { class: 'btn primary big', type: 'submit' }, 'Sign in');

  async function submit(e) {
    e.preventDefault();
    msg.textContent = '';
    const creds = { apiUrl: apiUrl.value.trim(), login: login.value.trim().toLowerCase(), code: code.value.trim() };
    if (!creds.apiUrl) { msg.textContent = 'Enter the server address (ask your administrator).'; return; }
    if (!creds.login || !creds.code) { msg.textContent = 'Enter your username and access code.'; return; }
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const { user } = await api('login', {}, creds);
      // A different person signing in on this tablet must not inherit someone else's queue.
      const prev = await db.getMeta('lastLogin');
      const pending = await db.count('outbox');
      const prevEmail = prev?.userEmail || prev?.email;
      if (prevEmail && prevEmail.toLowerCase() !== user.UserEmail.toLowerCase() && pending > 0) {
        throw new Error(`This tablet still has ${pending} change(s) from ${prev.name || prevEmail} waiting to upload. Ask them to sign in and sync first.`);
      }
      session = { ...creds, user };
      await db.setMeta('session', session);
      await db.setMeta('lastLogin', { apiUrl: creds.apiUrl, login: creds.login, userEmail: user.UserEmail, name: displayName(user) });
      renderHeader();
      btn.textContent = 'Downloading blocks and samples…';
      await sync();
      go('#/');
    } catch (err) {
      msg.textContent = err instanceof OfflineError ? 'You need an internet connection to sign in the first time.' : err.message;
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  }

  mount(main(),
    h('form', { class: 'card narrow', onsubmit: submit, novalidate: true },
      h('h1', {}, 'Sign in'),
      h('p', { class: 'muted' }, 'Sign in once while connected. After that the app works without internet.'),
      field('Username', login, { hint: 'Your email address also works.' }),
      field('Access code', code, { hint: 'Your administrator gives you this code.' }),
      h('details', { open: !apiUrl.value },
        h('summary', {}, 'Server address'),
        field('Server address', apiUrl, { hint: 'The Google Apps Script web app address ending in /exec.' })),
      msg,
      btn));
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
async function viewHome() {
  const samples = await db.getAll('samples');
  const count = (st) => samples.filter((s) => s.Status === st).length;
  const mine = samples.filter((s) => s.CollectorEmail?.toLowerCase() === me().toLowerCase() && s.CollectionDate >= daysAgo(14)).length;
  const tile = (href, title, sub, badge, cls = '') => h('a', { class: `tile ${cls}`, href },
    h('span', { class: 'tile-title' }, title), h('span', { class: 'tile-sub' }, sub),
    badge !== null && badge !== undefined ? h('span', { class: 'tile-badge' }, String(badge)) : null);

  mount(main(),
    h('div', { class: 'tiles' },
      tile('#/new', 'New Mite Sample', 'Record a sample bag in the field', null, 'primary'),
      tile('#/samples/mine', 'My Recent Samples', 'Collected by you in the last 14 days', mine),
      can(role(), 'analyse') && tile('#/samples/queue', 'Analyse Samples', 'Waiting for leaf analysis', count(STATUS.AWAITING)),
      can(role(), 'analyse') && tile('#/samples/progress', 'Samples In Progress', 'Resume a paused analysis', count(STATUS.IN_PROGRESS)),
      tile('#/samples/completed', 'Completed Samples', 'Search historical results', count(STATUS.COMPLETE)),
      tile('#/reports', 'Reports and Exports', 'Trends and CSV files for Excel'),
      tile('#/help', 'Help and Reference', 'Identification guide and how-to'),
      can(role(), 'admin') && tile('#/users', 'Manage Users', 'Add collectors, analysts and administrators'),
      can(role(), 'admin') && tile('#/samples/all', 'All Samples (admin)', 'Including cancelled samples', samples.length)));
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return L.todayLocal(d);
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------
async function photoView(ref) {
  if (!ref) return null;
  if (String(ref).startsWith('local:')) {
    const p = await db.get('photos', ref.slice(6));
    return p ? h('img', { class: 'thumb', src: p.dataUrl, alt: 'Photo (waiting to upload)' }) : h('span', { class: 'muted' }, 'Photo waiting to upload');
  }
  return h('a', { class: 'btn secondary small', href: ref, target: '_blank', rel: 'noopener' }, 'Open photo');
}

/** A photo picker. state.value is the stored ref; state.newPhoto is set when a new photo is taken. */
function photoInput(label, state, kind) {
  const preview = h('div', { class: 'photo-preview' });
  const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'visually-hidden', id: `photo-${Math.random().toString(36).slice(2)}` });
  const removeBtn = h('button', { type: 'button', class: 'btn secondary small', onclick: () => { state.value = ''; state.newPhoto = null; refresh(); } }, 'Remove');
  async function refresh() {
    preview.replaceChildren();
    if (state.newPhoto) preview.append(h('img', { class: 'thumb', src: state.newPhoto.dataUrl, alt: label }));
    else if (state.value) preview.append(await photoView(state.value));
    removeBtn.hidden = !(state.newPhoto || state.value);
  }
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await L.compressImage(file);
      const id = L.uuid();
      state.newPhoto = { id, dataUrl, kind };
      state.value = `local:${id}`;
      refresh();
    } catch (e) {
      toast('Could not read that photo.', 'bad');
    }
    input.value = '';
  });
  refresh();
  return h('div', { class: 'photo-input' },
    h('label', { class: 'btn secondary', for: input.id }, label), input, preview, removeBtn);
}

// ---------------------------------------------------------------------------
// New / edit sample (field collection, §5)
// ---------------------------------------------------------------------------
async function viewSampleForm(id) {
  const existing = id ? await db.get('samples', id) : null;
  if (id && !existing) return notFound();
  if (existing && !can(role(), 'editSample', existing, me())) {
    toast('This sample can no longer be edited.', 'bad');
    return go(`#/sample/${id}`);
  }
  const blocks = (await db.getAll('blocks'))
    .filter((b) => L.toBoolean(b.Active) || b.BlockVarietyID === existing?.BlockVarietyID)
    .sort((a, b) => L.blockLabel(a).localeCompare(L.blockLabel(b), undefined, { numeric: true }));
  const samples = await db.getAll('samples');
  const blockLocked = existing && !can(role(), 'changeBlock', existing, me());

  if (!blocks.length) {
    return mount(main(), h('div', { class: 'card' }, h('h2', {}, 'No blocks on this tablet yet'),
      h('p', {}, 'Connect to the internet and sync so the block list can download.'),
      h('a', { class: 'btn primary', href: '#/sync' }, 'Go to Sync')));
  }

  const bag = h('input', { id: 'SampleNumber', type: 'number', inputmode: 'numeric', min: '1', step: '1', value: existing?.SampleNumber ?? '', class: 'big-input', autofocus: !existing });
  const blockSel = h('select', { id: 'BlockVarietyID', class: 'big-input', disabled: blockLocked },
    h('option', { value: '' }, '— choose block and variety —'),
    blocks.map((b) => h('option', { value: b.BlockVarietyID, selected: b.BlockVarietyID === existing?.BlockVarietyID },
      `${L.blockLabel(b)}${L.toBoolean(b.Active) ? '' : ' (inactive)'}`)));
  const date = h('input', { id: 'CollectionDate', type: 'date', value: existing?.CollectionDate || L.todayLocal(), max: L.todayLocal() });
  const comments = h('textarea', { id: 'SampleComments', rows: 3, placeholder: 'Anything unusual about this sample (optional)' }, existing?.SampleComments || '');
  const photo1 = { value: existing?.SamplePhoto1 || '' };
  const photo2 = { value: existing?.SamplePhoto2 || '' };
  const targetBox = h('div', { class: 'target-box', 'aria-live': 'polite' });
  const dupBox = h('div', { class: 'warning', hidden: true });
  const form = h('form', { class: 'card', novalidate: true });

  function currentBlock() {
    return blocks.find((b) => b.BlockVarietyID === blockSel.value);
  }

  function updateTarget() {
    const b = existing && blockSel.value === existing.BlockVarietyID ? null : currentBlock();
    const area = b ? Number(b.AreaHa) : existing?.AreaHaAtCollection;
    const target = b ? L.requiredLeaves(b.AreaHa) : existing?.TargetLeafCount;
    targetBox.replaceChildren(blockSel.value
      ? h('div', {}, h('div', { class: 'target-number', id: 'targetLeaves' }, String(target ?? '—')),
        h('div', { class: 'target-label' }, 'leaves to collect'),
        h('div', { class: 'muted' }, `${L.blockLabel(b || existing)} · ${area} ha`))
      : h('div', { class: 'muted' }, 'Choose the block to see how many leaves to collect.'));
  }

  function updateDup() {
    const dups = L.duplicateBags({ SampleID: existing?.SampleID, SampleNumber: bag.value, CollectionDate: date.value }, samples);
    dupBox.hidden = !(bag.value && dups.length);
    dupBox.textContent = dups.length
      ? `⚠ Bag ${bag.value} has already been used this season (${dups.map((d) => `${d.Block} - ${d.Variety}, ${fmtDate(d.CollectionDate)}`).join('; ')}). Check the label.`
      : '';
  }

  blockSel.addEventListener('change', updateTarget);
  bag.addEventListener('input', updateDup);
  date.addEventListener('change', updateDup);
  updateTarget();
  updateDup();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = currentBlock();
    const blockChanged = !existing || blockSel.value !== existing.BlockVarietyID;
    const draft = {
      SampleNumber: bag.value.trim(),
      CollectionDate: date.value,
      BlockVarietyID: blockSel.value,
      AreaHaAtCollection: blockChanged ? b?.AreaHa : existing.AreaHaAtCollection,
    };
    const errors = L.validateSample(draft);
    form.querySelectorAll('[data-error-for]').forEach((el) => { el.textContent = errors[el.dataset.errorFor] || ''; });
    form.querySelectorAll('.field').forEach((f) => f.classList.toggle('has-error', !!f.querySelector('.error')?.textContent));
    if (Object.keys(errors).length) { toast('Please fix the highlighted fields.', 'bad'); return; }

    const values = {
      SampleNumber: Number(draft.SampleNumber),
      CollectionDate: draft.CollectionDate,
      SampleComments: comments.value.trim(),
      SamplePhoto1: photo1.value,
      SamplePhoto2: photo2.value,
      ...(blockChanged ? L.blockSnapshot(b) : {}),
    };
    const photos = [photo1.newPhoto, photo2.newPhoto].filter(Boolean)
      .map((p) => ({ ...p, label: `Bag ${values.SampleNumber}` }));

    if (existing) {
      const patch = {};
      for (const [k, v] of Object.entries(values)) if (String(existing[k] ?? '') !== String(v ?? '')) patch[k] = v;
      if (!Object.keys(patch).length) return go(`#/sample/${existing.SampleID}`);
      const record = { ...existing, ...patch, Season: L.seasonOf(values.CollectionDate) };
      await db.saveChanges([{ table: 'Samples', record, patch }], photos);
      syncSoon();
      toast('Changes saved.');
      return go(`#/sample/${existing.SampleID}`);
    }

    const record = {
      SampleID: L.uuid(),
      ...values,
      Season: L.seasonOf(values.CollectionDate),
      CollectorEmail: me(),
      Status: STATUS.AWAITING,
      CreatedAt: nowIso(),
    };
    const { SampleID, Season, ...patch } = record;
    await db.saveChanges([{ table: 'Samples', record, patch, isNew: true }], photos);
    syncSoon();
    savedSampleScreen(record);
  });

  mount(main(),
    h('div', { class: 'page-head' },
      h('h1', {}, existing ? `Edit bag ${existing.SampleNumber}` : 'New Mite Sample'),
      existing ? h('a', { class: 'btn secondary', href: `#/sample/${existing.SampleID}` }, 'Cancel') : h('a', { class: 'btn secondary', href: '#/' }, 'Cancel')),
    form);
  mount(form,
    h('div', { class: 'grid-2' },
      h('div', {},
        field('Bag number', bag, { hint: 'The number written on the sample bag.' }),
        dupBox,
        field('Block and variety', blockSel, { hint: blockLocked ? 'Locked because analysis has started.' : '' }),
        field('Collection date', date),
        h('div', { class: 'muted small' }, `Collector: ${existing ? (await userNames())(existing.CollectorEmail) : displayName(session.user)}`)),
      targetBox),
    field('Comments (optional)', comments),
    h('div', { class: 'row wrap' }, photoInput('Add photo 1', photo1, 'sample'), photoInput('Add photo 2', photo2, 'sample')),
    h('div', { class: 'row end sticky-actions' },
      h('button', { class: 'btn primary big', type: 'submit' }, existing ? 'Save changes' : 'Save sample')));
}

function savedSampleScreen(s) {
  mount(main(),
    h('div', { class: 'card center' },
      h('div', { class: 'big-tick' }, '✓'),
      h('h1', {}, `Bag ${s.SampleNumber} saved`),
      h('p', { class: 'target-line' }, `${s.Block} - ${s.Variety} · collect `, h('strong', {}, `${s.TargetLeafCount} leaves`)),
      h('p', { class: 'muted' }, navigator.onLine ? 'It will upload in a moment.' : 'Saved on this tablet. It will upload automatically when you are back online.'),
      h('div', { class: 'row center wrap' },
        h('button', { class: 'btn primary big', type: 'button', onclick: () => render() }, 'Record another sample'),
        h('a', { class: 'btn secondary big', href: '#/' }, 'Done'))));
}

// ---------------------------------------------------------------------------
// Sample lists (§6.2, §9.3, §9.6, §11)
// ---------------------------------------------------------------------------
const LIST_TABS = {
  queue: { title: 'Analyse Samples', filter: (s) => [STATUS.AWAITING, STATUS.IN_PROGRESS].includes(s.Status), asc: true },
  progress: { title: 'Samples In Progress', filter: (s) => s.Status === STATUS.IN_PROGRESS, asc: true },
  mine: { title: 'My Recent Samples', filter: (s) => s.CollectorEmail?.toLowerCase() === me().toLowerCase() && s.CollectionDate >= daysAgo(14) },
  completed: { title: 'Completed Samples', filter: (s) => s.Status === STATUS.COMPLETE },
  all: { title: 'All Samples', filter: () => true },
};

const listFilters = {};

async function viewSampleList(tab) {
  const cfg = LIST_TABS[tab];
  if (!cfg) return go('#/');
  const nameOf = await userNames();
  const all = (await db.getAll('samples')).filter(cfg.filter);
  const f = listFilters[tab] || (listFilters[tab] = { q: '', season: '', block: '', status: '' });
  const seasons = [...new Set(all.map((s) => s.Season || L.seasonOf(s.CollectionDate)))].filter(Boolean).sort().reverse();
  const blocks = [...new Set(all.map((s) => `${s.Block} - ${s.Variety}`))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const statuses = [...new Set(all.map((s) => s.Status))];
  const listEl = h('div', { class: 'list' });
  const countEl = h('div', { class: 'muted' });
  let limit = 100;

  async function refresh() {
    const q = f.q.trim().toLowerCase();
    const rows = all.filter((s) => (!f.season || (s.Season || L.seasonOf(s.CollectionDate)) === f.season) &&
      (!f.block || `${s.Block} - ${s.Variety}` === f.block) && (!f.status || s.Status === f.status) &&
      (!q || [s.SampleNumber, s.Block, s.Variety, `${s.Block} - ${s.Variety}`, nameOf(s.CollectorEmail), s.CollectionDate, fmtDate(s.CollectionDate), s.Status]
        .some((v) => String(v ?? '').toLowerCase().includes(q))))
      .sort((a, b) => (cfg.asc ? 1 : -1) * (String(a.CollectionDate).localeCompare(String(b.CollectionDate)) || Number(a.SampleNumber) - Number(b.SampleNumber)));
    countEl.textContent = `${rows.length} sample${rows.length === 1 ? '' : 's'}`;
    const shown = rows.slice(0, limit);
    const counts = await Promise.all(shown.map((s) => db.countBy('leaves', 'SampleID', s.SampleID)));
    mount(listEl,
      ...shown.map((s, i) => h('a', { class: 'sample-card', href: `#/sample/${s.SampleID}` },
        h('div', { class: 'bag' }, h('span', { class: 'muted small' }, 'Bag'), h('strong', {}, String(s.SampleNumber))),
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, `${s.Block} - ${s.Variety}`),
          h('div', { class: 'muted small' }, `${fmtDate(s.CollectionDate)} · ${nameOf(s.CollectorEmail)}`)),
        h('div', { class: 'right' }, statusPill(s.Status),
          h('div', { class: 'small' }, `${counts[i]} / ${s.TargetLeafCount} leaves`)))),
      rows.length > limit ? h('button', { class: 'btn secondary', type: 'button', onclick: () => { limit += 100; refresh(); } }, 'Show more') : null,
      rows.length ? null : h('p', { class: 'muted center' }, 'No samples match.'));
  }

  const sel = (key, label, options) => h('select', { 'aria-label': label, onchange: (e) => { f[key] = e.target.value; refresh(); } },
    h('option', { value: '' }, label), options.map((o) => h('option', { value: o, selected: f[key] === o }, o)));

  mount(main(),
    h('div', { class: 'page-head' }, h('h1', {}, cfg.title),
      tab === 'mine' ? h('a', { class: 'btn primary', href: '#/new' }, '+ New sample') : null),
    h('div', { class: 'filters' },
      h('input', { type: 'search', placeholder: 'Search bag number, block, variety, collector, date…', value: f.q, oninput: (e) => { f.q = e.target.value; refresh(); } }),
      sel('season', 'All seasons', seasons),
      sel('block', 'All blocks', blocks),
      statuses.length > 1 ? sel('status', 'All statuses', statuses) : null),
    countEl,
    listEl);
  await refresh();
}

// ---------------------------------------------------------------------------
// Sample detail (§7.1, §9.4)
// ---------------------------------------------------------------------------
async function setSampleStatus(sample, patch, message, then = null) {
  const record = { ...sample, ...patch };
  await db.saveChanges([{ table: 'Samples', record, patch }]);
  syncSoon();
  if (message) toast(message);
  if (then) go(then); else await render();
}

async function viewSample(id) {
  const s = await db.get('samples', id);
  if (!s) return notFound();
  const nameOf = await userNames();
  let leaves = await db.getAll('leaves', 'SampleID', id);
  // Older samples are not cached on the device; fetch their leaves on demand.
  if (navigator.onLine && Number(s.ActualLeafCount) > leaves.length && s.Status === STATUS.COMPLETE) {
    try { await fetchLeaves(id); leaves = await db.getAll('leaves', 'SampleID', id); } catch (e) { /* show what we have */ }
  }
  leaves.sort((a, b) => Number(a.LeafNumber) - Number(b.LeafNumber));
  const p = L.progress(s, leaves);
  const sum = L.sampleSummary(s, leaves);
  const next = L.nextLeafNumber(leaves);
  const r = role();
  const pendingIds = new Set((await db.getAll('outbox')).map((o) => o.id));

  const actions = h('div', { class: 'actions' },
    can(r, 'startAnalysis', s) && h('button', {
      class: 'btn primary big', type: 'button', onclick: async () => {
        await setSampleStatus(s, { Status: STATUS.IN_PROGRESS, AnalysisStartedAt: nowIso(), AnalysisStartedBy: me() }, '', `#/leaf/${id}/new`);
      },
    }, '▶ Start analysis'),
    can(r, 'resumeAnalysis', s) && h('a', { class: 'btn primary big', href: `#/leaf/${id}/new` }, `▶ Resume at leaf ${next}`),
    can(r, 'completeAnalysis', s) && p.analysed > 0 && h('a', { class: `btn ${p.reached ? 'success' : 'secondary'} big`, href: `#/complete/${id}` }, '✓ Complete analysis'),
    can(r, 'editSample', s, me()) && h('a', { class: 'btn secondary', href: `#/edit/${id}` }, 'Edit sample'),
    can(r, 'cancelSample', s, me()) && h('button', {
      class: 'btn danger-outline', type: 'button', onclick: async () => {
        if (await confirmDialog('Cancel this sample?', 'It will be removed from the analysis queue but kept for records. An administrator can restore it.', { ok: 'Cancel sample', cancel: 'Keep', danger: true })) {
          setSampleStatus(s, { Status: STATUS.CANCELLED }, 'Sample cancelled.');
        }
      },
    }, 'Cancel sample'),
    can(r, 'reopen', s) && h('button', {
      class: 'btn secondary', type: 'button', onclick: async () => {
        if (await confirmDialog('Reopen analysis?', 'The sample goes back to "Analysis In Progress" so leaves can be added or corrected. Changes to completed samples are recorded in the audit log.', { ok: 'Reopen' })) {
          setSampleStatus(s, { Status: STATUS.IN_PROGRESS }, 'Analysis reopened.');
        }
      },
    }, 'Reopen analysis'),
    can(r, 'restore', s) && h('button', {
      class: 'btn secondary', type: 'button',
      onclick: () => setSampleStatus(s, { Status: leaves.length ? STATUS.IN_PROGRESS : STATUS.AWAITING }, 'Sample restored.'),
    }, 'Restore sample'));

  const info = (label, value) => (value === '' || value === null || value === undefined ? null : h('div', { class: 'kv' }, h('span', {}, label), h('strong', {}, String(value))));
  const editable = can(r, 'editLeaves', s);

  mount(main(),
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, `Bag ${s.SampleNumber} · ${s.Block} - ${s.Variety}`),
        h('div', { class: 'row' }, statusPill(s.Status), pendingIds.has(id) ? h('span', { class: 'pill warn' }, 'Not yet uploaded') : null))),
    actions,
    h('div', { class: 'grid-2' },
      h('section', { class: 'card' },
        h('h2', {}, 'Progress'),
        h('div', { class: 'progress-numbers' },
          h('div', {}, h('strong', { id: 'leavesAnalysed' }, String(p.analysed)), h('span', {}, 'analysed')),
          h('div', {}, h('strong', {}, String(p.target)), h('span', {}, 'target')),
          h('div', {}, h('strong', {}, String(p.remaining)), h('span', {}, 'remaining')),
          h('div', {}, h('strong', {}, pct(p.pct)), h('span', {}, 'complete'))),
        progressBar(p),
        s.Status === STATUS.COMPLETE && p.analysed < p.target
          ? h('p', { class: 'warning' }, `Completed below target (${p.analysed} of ${p.target})${s.EarlyCompletionReason ? ` — ${s.EarlyCompletionReason}` : ''}.`) : null,
        p.analysed > p.target ? h('p', { class: 'muted' }, `${p.analysed - p.target} more than the target — all are included in the results.`) : null),
      h('section', { class: 'card' },
        h('h2', {}, 'Sample details'),
        info('Collection date', fmtDate(s.CollectionDate)),
        info('Season', s.Season),
        info('Collector', nameOf(s.CollectorEmail)),
        info('Block area at collection', `${s.AreaHaAtCollection} ha`),
        info('Target leaves', s.TargetLeafCount),
        info('Analysis started', s.AnalysisStartedAt && `${fmtDateTime(s.AnalysisStartedAt)} · ${nameOf(s.AnalysisStartedBy)}`),
        info('Completed', s.AnalysisCompletedAt && `${fmtDateTime(s.AnalysisCompletedAt)} · ${nameOf(s.CompletedBy)}`),
        info('Comments', s.SampleComments),
        info('Analysis comments', s.AnalysisComments),
        h('div', { class: 'row wrap' }, await photoView(s.SamplePhoto1), await photoView(s.SamplePhoto2)))),
    p.analysed ? h('section', { class: 'card' },
      h('h2', {}, 'Results'),
      h('div', { class: 'stats' },
        stat('Two-spotted mites', sum.TotalTwoSM, `${sum.AvgTwoSMPerLeaf} per leaf`),
        stat('Predatory mites (PP)', sum.TotalPP, `${sum.AvgPPPerLeaf} per leaf`),
        stat('TwoSM eggs', sum.TotalTwoSMEggs),
        stat('Predator eggs', sum.TotalPredatorEggs),
        stat('Other beneficials', sum.TotalOtherBeneficial),
        stat('Predator : pest', sum.PredatorToPestRatio ?? '—'),
        stat('Leaves with TwoSM', pct(sum.PctLeavesWithTwoSM)))) : null,
    h('section', { class: 'card' },
      h('h2', {}, `Leaves (${leaves.length})`),
      leaves.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'leaf-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Leaf'), COUNT_FIELDS.map((c) => h('th', {}, c.short)), h('th', {}, 'Notes'))),
        h('tbody', {}, leaves.map((l) => h('tr', {
          class: editable ? 'clickable' : '',
          onclick: editable ? () => go(`#/leaf/${id}/${l.LeafAnalysisID}`) : null,
        },
        h('td', {}, String(l.LeafNumber), pendingIds.has(l.LeafAnalysisID) ? h('span', { class: 'dot-pending', title: 'Not yet uploaded' }) : null),
        COUNT_FIELDS.map((c) => h('td', { class: Number(l[c.key]) > 0 ? 'nonzero' : '' }, String(l[c.key]))),
        h('td', { class: 'small' }, [l.OtherBeneficialDescription, l.LeafComment, l.LeafPhoto ? '📷' : ''].filter(Boolean).join(' · '))))))) : h('p', { class: 'muted' }, 'No leaves recorded yet.')));
}

function stat(label, value, sub) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, String(value)), h('div', { class: 'stat-label' }, label), sub ? h('div', { class: 'muted small' }, sub) : null);
}

function notFound() {
  mount(main(), h('div', { class: 'card' }, h('h2', {}, 'Not found'), h('p', {}, 'This record is not on this tablet. Try syncing.'),
    h('a', { class: 'btn primary', href: '#/' }, 'Home')));
}

// ---------------------------------------------------------------------------
// Leaf entry — the "Save and Next Leaf" screen (§6.4–6.7, §9.5)
// ---------------------------------------------------------------------------
async function viewLeaf(sampleId, leafId) {
  const s = await db.get('samples', sampleId);
  if (!s) return notFound();
  if (!can(role(), 'editLeaves', s)) {
    toast(s.Status === STATUS.COMPLETE ? 'This analysis is complete. Ask an administrator to reopen it.' : 'You cannot record leaves for this sample.', 'bad');
    return go(`#/sample/${sampleId}`);
  }
  const isNew = leafId === 'new';
  const leaves = await db.getAll('leaves', 'SampleID', sampleId);
  const existing = isNew ? null : leaves.find((l) => l.LeafAnalysisID === leafId);
  if (!isNew && !existing) return notFound();
  const leafNumber = isNew ? L.nextLeafNumber(leaves) : Number(existing.LeafNumber);
  const p = L.progress(s, leaves);

  const inputs = {};
  const errors = {};
  const counters = COUNT_FIELDS.map((c, i) => {
    const input = h('input', {
      id: c.key, type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', class: 'count-input',
      value: existing ? String(existing[c.key]) : '', 'aria-label': c.label,
    });
    inputs[c.key] = input;
    const bump = (d) => {
      const cur = L.parseCount(input.value);
      input.value = String(Math.max(0, (cur.value ?? (d > 0 ? 0 : 1)) + d));
      input.dispatchEvent(new Event('input'));
    };
    input.addEventListener('input', () => { clearError(c.key); updateOther(); });
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const nextInput = inputs[COUNT_FIELDS[i + 1]?.key];
        if (nextInput) nextInput.focus(); else save('next');
      }
    });
    errors[c.key] = h('div', { class: 'error', 'data-error-for': c.key });
    return h('div', { class: 'counter' },
      h('label', { for: c.key }, h('strong', {}, c.short), h('span', { class: 'muted small' }, c.latin ? ` ${c.latin}` : ` ${c.label}`)),
      h('div', { class: 'counter-row' },
        h('button', { type: 'button', class: 'btn step', tabindex: -1, 'aria-label': `${c.short} minus one`, onclick: () => bump(-1) }, '−'),
        input,
        h('button', { type: 'button', class: 'btn step', tabindex: -1, 'aria-label': `${c.short} plus one`, onclick: () => bump(1) }, '+')),
      errors[c.key]);
  });

  const otherType = h('select', { id: 'OtherBeneficialDescription' },
    h('option', { value: '' }, '— type of beneficial —'),
    L.BENEFICIAL_TYPES.map((t) => h('option', { value: t, selected: existing?.OtherBeneficialDescription === t }, t)));
  const otherText = h('input', { type: 'text', placeholder: 'Describe', value: existing && !L.BENEFICIAL_TYPES.includes(existing.OtherBeneficialDescription) ? existing.OtherBeneficialDescription || '' : '' });
  if (existing && existing.OtherBeneficialDescription && !L.BENEFICIAL_TYPES.includes(existing.OtherBeneficialDescription)) otherType.value = 'Other';
  const otherBox = h('div', { class: 'row wrap other-box' }, otherType, otherText);
  const comment = h('textarea', { id: 'LeafComment', rows: 2, placeholder: 'Comment (optional)' }, existing?.LeafComment || '');
  const photo = { value: existing?.LeafPhoto || '' };
  const highWarn = h('div', { class: 'warning', hidden: true });

  function updateOther() {
    otherBox.hidden = !(Number(inputs.OtherBeneficialCount.value) > 0);
    otherText.hidden = otherType.value !== 'Other';
    const high = L.highCounts(readLeaf());
    highWarn.hidden = !high.length;
    highWarn.textContent = high.length ? `⚠ Unusually high: ${high.map((f) => `${f.short} ${inputs[f.key].value}`).join(', ')}. Please double-check.` : '';
  }
  otherType.addEventListener('change', updateOther);

  function clearError(key) {
    errors[key].textContent = '';
    inputs[key].classList.remove('invalid');
  }

  function readLeaf() {
    const out = {};
    for (const c of COUNT_FIELDS) out[c.key] = inputs[c.key].value.trim();
    return out;
  }

  function fillBlanks() {
    for (const c of COUNT_FIELDS) if (inputs[c.key].value.trim() === '') { inputs[c.key].value = '0'; clearError(c.key); }
    updateOther();
  }

  async function save(mode) {
    const freshLeaves = await db.getAll('leaves', 'SampleID', sampleId);
    const counts = readLeaf();
    const draft = { ...counts, LeafAnalysisID: existing?.LeafAnalysisID, LeafNumber: isNew ? L.nextLeafNumber(freshLeaves) : leafNumber };
    const errs = L.validateLeaf(draft, freshLeaves);
    let firstBad = null;
    for (const c of COUNT_FIELDS) {
      errors[c.key].textContent = errs[c.key] || '';
      inputs[c.key].classList.toggle('invalid', !!errs[c.key]);
      if (errs[c.key] && !firstBad) firstBad = inputs[c.key];
    }
    if (errs.LeafNumber) { toast(errs.LeafNumber, 'bad'); return; }
    if (firstBad) { firstBad.focus(); toast('Every count needs a number — enter 0 if none were seen.', 'bad'); return; }
    const high = L.highCounts(counts);
    if (high.length && !(await confirmDialog('Unusually high count', `${high.map((f) => `${f.short}: ${counts[f.key]}`).join(', ')}. Is this correct?`, { ok: 'Yes, save it', cancel: 'Go back' }))) return;

    const values = {
      ...Object.fromEntries(COUNT_FIELDS.map((c) => [c.key, Number(counts[c.key])])),
      OtherBeneficialDescription: Number(counts.OtherBeneficialCount) > 0 ? (otherType.value === 'Other' ? (otherText.value.trim() || 'Other') : otherType.value) : '',
      LeafComment: comment.value.trim(),
      LeafPhoto: photo.value,
    };
    const photos = photo.newPhoto ? [{ ...photo.newPhoto, label: `Bag ${s.SampleNumber} leaf ${draft.LeafNumber}` }] : [];
    const changes = [];
    if (s.Status === STATUS.AWAITING) {
      const patch = { Status: STATUS.IN_PROGRESS, AnalysisStartedAt: nowIso(), AnalysisStartedBy: me() };
      changes.push({ table: 'Samples', record: { ...s, ...patch }, patch });
    }
    if (isNew) {
      const record = {
        LeafAnalysisID: L.uuid(), SampleID: sampleId, LeafNumber: draft.LeafNumber, AnalystEmail: me(),
        AnalysisDateTime: nowIso(), ...values, CreatedAt: nowIso(),
      };
      const { LeafAnalysisID, ...patch } = record;
      changes.push({ table: 'LeafAnalysis', record, patch, isNew: true });
    } else {
      const patch = {};
      for (const [k, v] of Object.entries(values)) if (String(existing[k] ?? '') !== String(v ?? '')) patch[k] = v;
      if (Object.keys(patch).length) changes.push({ table: 'LeafAnalysis', record: { ...existing, ...patch }, patch });
    }
    if (changes.length) await db.saveChanges(changes, photos);
    syncSoon();
    toast(`Leaf ${draft.LeafNumber} saved.`);
    if (mode === 'next') {
      if (location.hash === `#/leaf/${sampleId}/new`) render(); else go(`#/leaf/${sampleId}/new`);
    } else {
      go(`#/sample/${sampleId}`);
    }
  }

  async function removeLeaf() {
    if (!(await confirmDialog(`Delete leaf ${leafNumber}?`, 'The leaf record is removed from the results. The remaining leaves keep their numbers.', { ok: 'Delete leaf', danger: true }))) return;
    await db.saveChanges([{ table: 'LeafAnalysis', record: existing, patch: { Deleted: true }, remove: true }]);
    syncSoon();
    toast(`Leaf ${leafNumber} deleted.`);
    go(`#/sample/${sampleId}`);
  }

  const doneAfterThis = p.analysed + (isNew ? 1 : 0);
  mount(main(),
    h('div', { class: 'leaf-head' },
      h('div', {},
        h('div', { class: 'leaf-sample' }, `Bag ${s.SampleNumber} · ${s.Block} - ${s.Variety}`),
        h('div', { class: 'muted' }, `${p.analysed} of ${p.target} leaves done${p.reached ? ' — target reached ✓' : ''}`)),
      h('div', { class: 'leaf-number', id: 'leafNumber' }, h('span', {}, 'Leaf'), String(leafNumber))),
    progressBar(p),
    h('form', { class: 'card leaf-form', onsubmit: (e) => { e.preventDefault(); save('next'); }, novalidate: true },
      h('div', { class: 'counters' }, counters),
      h('div', { class: 'row wrap' },
        h('button', { type: 'button', class: 'btn secondary', onclick: fillBlanks }, 'Blanks → 0'),
        h('span', { class: 'muted small' }, '0 means you looked and found none.')),
      otherBox,
      highWarn,
      h('details', { open: !!(existing?.LeafComment || existing?.LeafPhoto) },
        h('summary', {}, 'Comment or photo'),
        comment,
        photoInput('Add photo', photo, 'leaf')),
      h('div', { class: 'row end sticky-actions wrap' },
        isNew
          ? h('a', { class: 'btn secondary', href: `#/sample/${sampleId}` }, 'Stop without saving')
          : h('a', { class: 'btn secondary', href: `#/sample/${sampleId}` }, 'Cancel'),
        !isNew && h('button', { type: 'button', class: 'btn danger-outline', onclick: removeLeaf }, 'Delete leaf'),
        h('button', { type: 'button', class: 'btn secondary big', onclick: () => save('stop') }, isNew ? 'Save & stop' : 'Save changes'),
        isNew && h('button', { type: 'submit', class: 'btn primary big', id: 'saveNext' },
          doneAfterThis >= p.target && p.target ? 'Save & next leaf (target reached)' : 'Save & next leaf  →'))));
  updateOther();
  inputs.TetranychusCount.focus();
}

// ---------------------------------------------------------------------------
// Completion (§7.2–7.5)
// ---------------------------------------------------------------------------
async function viewComplete(id) {
  const s = await db.get('samples', id);
  if (!s) return notFound();
  if (!can(role(), 'completeAnalysis', s)) return go(`#/sample/${id}`);
  const leaves = await db.getAll('leaves', 'SampleID', id);
  const p = L.progress(s, leaves);
  const below = p.analysed < p.target;
  const reason = h('select', { id: 'EarlyCompletionReason' }, h('option', { value: '' }, '— choose a reason (optional) —'),
    L.EARLY_REASONS.map((r) => h('option', { value: r }, r)));
  const reasonText = h('input', { type: 'text', placeholder: 'Explain (optional)' });
  const comments = h('textarea', { id: 'AnalysisComments', rows: 3, placeholder: 'Overall comments on this analysis (optional)' }, s.AnalysisComments || '');

  async function complete(e) {
    e.preventDefault();
    if (!p.analysed) { toast('Record at least one leaf first.', 'bad'); return; }
    const why = [reason.value === 'Other' ? '' : reason.value, reasonText.value.trim()].filter(Boolean).join(' — ') || (reason.value === 'Other' ? 'Other' : '');
    const patch = {
      Status: STATUS.COMPLETE, AnalysisCompletedAt: nowIso(), CompletedBy: me(), ActualLeafCount: p.analysed,
      AnalysisComments: comments.value.trim(), EarlyCompletionReason: below ? why : '',
    };
    await db.saveChanges([{ table: 'Samples', record: { ...s, ...patch }, patch }]);
    syncSoon();
    toast(`Bag ${s.SampleNumber} analysis complete.`);
    go(`#/sample/${id}`);
  }

  mount(main(),
    h('div', { class: 'page-head' }, h('h1', {}, `Complete analysis — bag ${s.SampleNumber}`)),
    h('form', { class: 'card', onsubmit: complete },
      h('p', { class: 'target-line' }, h('strong', {}, `${p.analysed} of ${p.target}`), ' target leaves analysed.'),
      progressBar(p),
      below ? h('div', { class: 'warning' },
        h('strong', {}, `⚠ Target not reached — ${p.remaining} leaves short.`),
        h('p', {}, 'You can still complete the sample. Please say why fewer leaves were analysed.')) : null,
      below ? field('Reason', reason) : null,
      below ? reasonText : null,
      p.analysed > p.target ? h('p', { class: 'muted' }, `${p.analysed - p.target} extra leaves will be included in the results.`) : null,
      field('Analysis comments', comments),
      h('div', { class: 'row end' },
        h('a', { class: 'btn secondary', href: `#/sample/${id}` }, 'Back'),
        h('button', { class: 'btn success big', type: 'submit' }, '✓ Confirm — complete analysis'))));
}

// ---------------------------------------------------------------------------
// Reports and exports (§12)
// ---------------------------------------------------------------------------
async function viewReports() {
  const samples = await db.getAll('samples');
  const leaves = await db.getAll('leaves');
  const bySample = L.groupBy(leaves, 'SampleID');
  const nameOf = await userNames();
  const seasons = [...new Set(samples.map((s) => s.Season || L.seasonOf(s.CollectionDate)))].filter(Boolean).sort().reverse();
  const blocks = (await db.getAll('blocks')).sort((a, b) => L.blockLabel(a).localeCompare(L.blockLabel(b), undefined, { numeric: true }));
  const used = blocks.filter((b) => samples.some((s) => s.BlockVarietyID === b.BlockVarietyID));

  const seasonSel = h('select', { id: 'exportSeason' }, h('option', { value: '' }, 'All seasons'), seasons.map((x) => h('option', { value: x }, x)));
  const blockSel = h('select', { id: 'exportBlock' }, h('option', { value: '' }, 'All blocks'), blocks.map((b) => h('option', { value: b.BlockVarietyID }, L.blockLabel(b))));
  const exportMsg = h('p', { class: 'muted small' });

  async function doExport(type) {
    const filter = { season: seasonSel.value, blockVarietyId: blockSel.value };
    exportMsg.textContent = 'Preparing…';
    try {
      if (!navigator.onLine) throw new OfflineError('offline');
      const res = await api('export', { type, ...filter });
      download(res.filename, res.csv);
      exportMsg.textContent = `Downloaded ${res.rows} rows (complete history from the spreadsheet).`;
    } catch (e) {
      if (e instanceof AuthError) { exportMsg.textContent = e.message; return; }
      // Offline: build the same file from what is stored on this tablet.
      const pick = samples.filter((s) => (!filter.season || (s.Season || L.seasonOf(s.CollectionDate)) === filter.season) &&
        (!filter.blockVarietyId || s.BlockVarietyID === filter.blockVarietyId));
      const ids = new Set(pick.map((s) => s.SampleID));
      const csv = type === 'summary'
        ? L.toCSV(L.SUMMARY_HEADERS, L.summaryRows(pick, bySample))
        : L.toCSV(L.LEAF_EXPORT_HEADERS, L.leafExportRows(pick, leaves.filter((l) => ids.has(l.SampleID)), nameOf));
      const name = `hopfarm_${type === 'summary' ? 'sample_summary' : 'leaf_results'}_tablet_${L.todayLocal()}.csv`;
      download(name, csv);
      exportMsg.textContent = `${e instanceof OfflineError ? 'Offline' : `Server error (${e.message})`} — exported the data stored on this tablet instead (last ~13 months).`;
    }
  }

  // Trend chart
  const trendBlock = h('select', { id: 'trendBlock' }, used.map((b) => h('option', { value: b.BlockVarietyID }, L.blockLabel(b))));
  const trendMeasure = h('select', { id: 'trendMeasure' }, L.TREND_MEASURES.map((m) => h('option', { value: m.key }, m.label)));
  const trendSeason = h('select', { id: 'trendSeason' }, h('option', { value: '' }, 'All seasons'), seasons.map((x) => h('option', { value: x, selected: x === seasons[0] }, x)));
  const chartBox = h('div', { class: 'chart' });
  const drawTrend = () => {
    const measure = L.TREND_MEASURES.find((m) => m.key === trendMeasure.value);
    const pts = L.trendPoints(samples, bySample, trendBlock.value, trendMeasure.value, trendSeason.value);
    chartBox.replaceChildren(lineChart(pts, measure));
  };
  [trendBlock, trendMeasure, trendSeason].forEach((el) => el.addEventListener('change', drawTrend));

  // Block comparison for a season
  const cmpSeason = h('select', {}, seasons.map((x) => h('option', { value: x }, x)));
  const cmpBox = h('div', { class: 'table-wrap' });
  const drawCmp = () => {
    const rows = used.map((b) => {
      const ss = samples.filter((s) => s.BlockVarietyID === b.BlockVarietyID && s.Status !== STATUS.CANCELLED &&
        (s.Season || L.seasonOf(s.CollectionDate)) === cmpSeason.value);
      const ls = ss.flatMap((s) => bySample.get(s.SampleID) || []);
      const tot = L.sampleSummary({}, ls);
      return { b, n: ss.filter((s) => (bySample.get(s.SampleID) || []).length).length, leaves: ls.length, tot };
    }).filter((r) => r.leaves);
    cmpBox.replaceChildren(rows.length ? h('table', {},
      h('thead', {}, h('tr', {}, ['Block', 'Samples', 'Leaves', 'TwoSM / leaf', 'PP / leaf', 'TwoSM eggs / leaf', 'Leaves with TwoSM', 'Pred : pest'].map((x) => h('th', {}, x)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, L.blockLabel(r.b)), h('td', {}, r.n), h('td', {}, r.leaves),
        h('td', {}, r.tot.AvgTwoSMPerLeaf), h('td', {}, r.tot.AvgPPPerLeaf), h('td', {}, r.tot.AvgTwoSMEggsPerLeaf),
        h('td', {}, pct(r.tot.PctLeavesWithTwoSM)), h('td', {}, r.tot.PredatorToPestRatio ?? '—'))))) : h('p', { class: 'muted' }, 'No analysed leaves for this season on this tablet.'));
  };
  cmpSeason.addEventListener('change', drawCmp);

  mount(main(),
    h('div', { class: 'page-head' }, h('h1', {}, 'Reports and Exports')),
    can(role(), 'export') ? h('section', { class: 'card' },
      h('h2', {}, 'Download for Excel'),
      h('p', { class: 'muted' }, 'CSV files open directly in Excel. The leaf file has one row per leaf with the sample details on every row; the summary has one row per sample with totals and averages. Both include a WeekStarting column for weekly PivotTables.'),
      h('div', { class: 'row wrap' }, seasonSel, blockSel),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary', type: 'button', id: 'exportLeaves', onclick: () => doExport('leaves') }, '⬇ Leaf results CSV (one row per leaf)'),
        h('button', { class: 'btn primary', type: 'button', id: 'exportSummary', onclick: () => doExport('summary') }, '⬇ Sample summary CSV')),
      exportMsg) : null,
    h('section', { class: 'card' },
      h('h2', {}, 'Trend by block'),
      used.length ? h('div', {}, h('div', { class: 'row wrap' }, trendBlock, trendMeasure, trendSeason), chartBox)
        : h('p', { class: 'muted' }, 'No samples yet.')),
    seasons.length ? h('section', { class: 'card' }, h('h2', {}, 'Compare blocks'), h('div', { class: 'row' }, cmpSeason), cmpBox) : null);
  if (used.length) drawTrend();
  if (seasons.length) drawCmp();
}

/** Minimal accessible SVG line chart: one point per sample, x = collection date. */
function lineChart(points, measure) {
  if (!points.length) return h('p', { class: 'muted' }, 'No analysed samples for this block and season yet.');
  const W = 720; const H = 280; const pad = { l: 48, r: 16, t: 16, b: 40 };
  const t = (p) => new Date(`${p.date}T00:00:00Z`).getTime();
  const x0 = t(points[0]); const x1 = t(points[points.length - 1]);
  const yMax = Math.max(...points.map((p) => p.value), measure.key.startsWith('Pct') ? 1 : 0.0001);
  const niceMax = measure.key.startsWith('Pct') ? 1 : niceCeil(yMax);
  const sx = (p) => pad.l + (x1 === x0 ? (W - pad.l - pad.r) / 2 : ((t(p) - x0) / (x1 - x0)) * (W - pad.l - pad.r));
  const sy = (v) => H - pad.b - (v / niceMax) * (H - pad.t - pad.b);
  const fmtV = (v) => (measure.key.startsWith('Pct') ? pct(v) : String(Math.round(v * 100) / 100));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * niceMax);
  const xLabels = points.length <= 8 ? points : points.filter((_, i) => i % Math.ceil(points.length / 8) === 0);
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${measure.label} over time` },
    ticks.map((v) => svg('g', {},
      svg('line', { x1: pad.l, x2: W - pad.r, y1: sy(v), y2: sy(v), class: 'grid' }),
      svg('text', { x: pad.l - 6, y: sy(v) + 4, 'text-anchor': 'end', class: 'axis' }, fmtV(v)))),
    xLabels.map((p) => svg('text', { x: sx(p), y: H - pad.b + 18, 'text-anchor': 'middle', class: 'axis' }, fmtDate(p.date).slice(0, 5))),
    svg('polyline', { points: points.map((p) => `${sx(p)},${sy(p.value)}`).join(' '), class: 'line' }),
    points.map((p) => svg('circle', { cx: sx(p), cy: sy(p.value), r: 5, class: 'pt' },
      svg('title', {}, `Bag ${p.sample.SampleNumber}, ${fmtDate(p.date)}: ${fmtV(p.value)}`))));
}

function niceCeil(v) {
  const e = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * e).find((n) => n >= v);
}

// ---------------------------------------------------------------------------
// Help (§9.7)
// ---------------------------------------------------------------------------
async function viewHelp() {
  const items = (await db.getAll('help')).sort((a, b) => Number(a.SortOrder) - Number(b.SortOrder));
  const groups = L.groupBy(items, 'Category');
  mount(main(),
    h('div', { class: 'page-head' }, h('h1', {}, 'Help and Reference')),
    h('section', { class: 'card' },
      h('h2', {}, 'Mite control in hops — identification poster'),
      h('p', { class: 'muted small' }, 'Tap the poster to open it full size and zoom in.'),
      h('a', { href: 'help/mite-control-poster.webp', target: '_blank', rel: 'noopener' },
        h('img', { class: 'help-poster', src: 'help/mite-control-poster.webp', alt: 'Mite control in hops poster: the plant damage, the pest two-spotted spider mite (badies), the predatory mite Phytoseiulus persimilis (goodies), and other beneficials — ladybird, predatory thrips and lacewing.' }))),
    items.length ? [...groups].map(([cat, rows]) => h('section', { class: 'card' },
      h('h2', {}, cat),
      rows.map((r) => h('details', { class: 'help-item' },
        h('summary', {}, r.Title),
        h('p', {}, r.Description),
        L.helpImageUrl(r.Image) ? h('img', { class: 'help-img', src: L.helpImageUrl(r.Image), alt: r.Title, loading: 'lazy' }) : null))))
      : h('p', { class: 'muted' }, 'Help content downloads on the next sync.'));
}

// ---------------------------------------------------------------------------
// User management (administrators). Needs a connection: changes go straight
// to the Users tab so the new person can sign in immediately.
// ---------------------------------------------------------------------------
function needsAdminOnline(title) {
  if (!can(role(), 'admin')) { go('#/'); return true; }
  if (!navigator.onLine) {
    mount(main(), h('div', { class: 'page-head' }, h('h1', {}, title)),
      h('div', { class: 'card' }, h('p', {}, 'Managing users needs an internet connection.'), h('a', { class: 'btn secondary', href: '#/' }, 'Home')));
    return true;
  }
  return false;
}

async function viewUsers() {
  if (needsAdminOnline('Manage Users')) return;
  mount(main(), h('p', { class: 'muted center' }, 'Loading users…'));
  const { users } = await api('listUsers');
  await db.replaceAll('users', users.map(({ AccessCode, ...pub }) => pub));
  const order = { Administrator: 0, Analyst: 1, Collector: 2 };
  users.sort((a, b) => (b.Active - a.Active) || (order[a.Role] - order[b.Role]) || displayName(a).localeCompare(displayName(b)));
  mount(main(),
    h('div', { class: 'page-head' }, h('h1', {}, 'Manage Users'),
      h('a', { class: 'btn primary', href: '#/user/new' }, '+ Add user')),
    h('p', { class: 'muted' }, 'People sign in with their username and access code. Tap a person to change their details, role or code, or to remove their access.'),
    h('div', { class: 'list' }, users.map((u) => h('a', { class: `sample-card${u.Active ? '' : ' inactive'}`, href: `#/user/${encodeURIComponent(u.UserEmail)}` },
      h('div', { class: 'grow' },
        h('div', { class: 'title' }, displayName(u)),
        h('div', { class: 'muted small' }, `${u.Username || '(no username)'} · ${u.UserEmail}`)),
      h('div', { class: 'right' },
        h('span', { class: `pill ${u.Active ? 'role' : 'cancelled'}` }, u.Active ? u.Role : `${u.Role} — no access`))))));
}

async function viewUserForm(id) {
  const isNew = id === 'new';
  if (needsAdminOnline(isNew ? 'Add user' : 'Edit user')) return;
  let u = { UserEmail: '', Username: '', FullName: '', Role: 'Collector', Active: true, AccessCode: '' };
  if (!isNew) {
    const { users } = await api('listUsers');
    u = users.find((x) => x.UserEmail.toLowerCase() === id.toLowerCase());
    if (!u) return notFound();
  }
  const isSelf = !isNew && u.UserEmail.toLowerCase() === me().toLowerCase();
  // Other administrators are view-only.
  const readOnly = !isNew && !isSelf && u.Role === 'Administrator';
  const fullName = h('input', { id: 'FullName', type: 'text', value: u.FullName || '', autocomplete: 'off', disabled: readOnly });
  const username = h('input', { id: 'Username', type: 'text', value: u.Username || '', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: false, disabled: readOnly });
  const email = h('input', { id: 'UserEmail', type: 'email', value: u.UserEmail, disabled: !isNew, autocomplete: 'off' });
  const roleSel = h('select', { id: 'Role', disabled: isSelf || readOnly }, L.ROLES.map((r) => h('option', { value: r, selected: u.Role === r }, r)));
  const active = h('input', { id: 'Active', type: 'checkbox', checked: !!u.Active, disabled: isSelf || readOnly, class: 'checkbox' });
  const code = h('input', { id: 'AccessCode', type: 'text', inputmode: 'numeric', value: u.AccessCode || '', placeholder: isNew ? 'Leave blank to generate one' : '', autocomplete: 'off', readonly: readOnly });
  const msg = h('p', { class: 'error', role: 'alert' });
  const saveBtn = h('button', { class: 'btn primary big', type: 'submit' }, isNew ? 'Add user' : 'Save changes');
  const roleHelp = {
    Collector: 'Records samples in the field. Cannot enter leaf counts or export.',
    Analyst: 'Records samples, analyses leaves, completes samples and exports data.',
    Administrator: 'Everything, including managing users and correcting completed samples.',
  };
  const roleHint = h('div', { class: 'hint' }, roleHelp[u.Role]);
  roleSel.addEventListener('change', () => { roleHint.textContent = roleHelp[roleSel.value]; });

  // Suggest a username from the name or email while adding someone.
  let usernameTouched = !isNew;
  username.addEventListener('input', () => { usernameTouched = true; });
  const suggest = () => {
    if (usernameTouched) return;
    const base = (fullName.value.trim().split(/\s+/)[0] || email.value.split('@')[0] || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '');
    username.value = base;
  };
  fullName.addEventListener('input', suggest);
  email.addEventListener('input', suggest);

  async function submit(e) {
    e.preventDefault();
    msg.textContent = '';
    saveBtn.disabled = true;
    try {
      const { user } = await api('saveUser', {
        isNew,
        user: {
          UserEmail: email.value.trim(), Username: username.value.trim(), FullName: fullName.value.trim(),
          Role: roleSel.value, Active: active.checked, AccessCode: code.value.trim(),
        },
      });
      const { AccessCode, ...pub } = user;
      await db.put('users', pub);
      mount(main(), h('div', { class: 'card center' },
        h('div', { class: 'big-tick' }, '✓'),
        h('h1', {}, isNew ? `${displayName(user)} added` : 'Changes saved'),
        user.Active ? h('div', { class: 'credentials' },
          h('p', {}, 'Give them these details to sign in:'),
          h('div', { class: 'kv' }, h('span', {}, 'App address'), h('strong', { class: 'break' }, location.origin + location.pathname)),
          h('div', { class: 'kv' }, h('span', {}, 'Username'), h('strong', { id: 'newUsername' }, user.Username)),
          h('div', { class: 'kv' }, h('span', {}, 'Access code'), h('strong', { id: 'newCode' }, user.AccessCode)))
          : h('p', {}, `${displayName(user)} can no longer sign in.`),
        h('div', { class: 'row center wrap' },
          h('a', { class: 'btn secondary big', href: '#/users' }, 'Back to users'),
          h('a', { class: 'btn primary big', href: '#/user/new', onclick: (ev) => { if (location.hash === '#/user/new') { ev.preventDefault(); render(); } } }, 'Add another'))));
    } catch (err) {
      msg.textContent = err instanceof OfflineError ? 'No connection. Try again when online.' : err.message;
      saveBtn.disabled = false;
    }
  }

  mount(main(),
    h('div', { class: 'page-head' }, h('h1', {}, isNew ? 'Add user' : `${readOnly ? '' : 'Edit '}${displayName(u)}`),
      h('a', { class: 'btn secondary', href: '#/users' }, readOnly ? 'Back' : 'Cancel')),
    readOnly ? h('p', { class: 'warning', id: 'readOnlyNote' }, 'Administrators can view other administrators but not change them. The spreadsheet owner can change them in the Users tab.') : null,
    h('form', { class: 'card', onsubmit: submit, novalidate: true },
      h('div', { class: 'grid-2' },
        h('div', {},
          field('Full name', fullName),
          field('Username', username, { hint: 'What they type to sign in. Letters, numbers, dots or dashes; no spaces.' }),
          field('Email', email, { hint: isNew ? 'Their email address. It cannot be changed later.' : 'Cannot be changed — their samples are linked to it.' })),
        h('div', {},
          field('Role', roleSel),
          roleHint,
          h('label', { class: 'check-row', for: 'Active' }, active, h('span', {}, 'Can sign in')),
          isSelf ? h('p', { class: 'muted small' }, 'You cannot change your own role or remove your own access.') : null,
          field('Access code', code, { hint: readOnly ? '' : isNew ? '4–12 digits. Leave blank and one will be made for you.' : 'Change this to give them a new code (the old one stops working).' }),
          readOnly ? null : h('button', { class: 'btn secondary small', type: 'button', onclick: () => { code.value = String(Math.floor(100000 + Math.random() * 900000)); } }, 'Generate new code'))),
      msg,
      readOnly ? null : h('div', { class: 'row end' }, saveBtn)));
}

// ---------------------------------------------------------------------------
// Sync, account and troubleshooting
// ---------------------------------------------------------------------------
async function viewSync() {
  const outbox = await db.getAll('outbox');
  const photos = await db.getAll('photos');
  const st = getStatus();
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const msg = h('p', { class: 'muted', 'aria-live': 'polite' });
  const syncBtn = h('button', {
    class: 'btn primary big', type: 'button', id: 'syncNow', onclick: async () => {
      syncBtn.disabled = true;
      msg.textContent = 'Syncing…';
      try {
        const ok = await sync();
        msg.textContent = ok ? 'Sync complete.' : (getStatus().lastError || 'Could not reach the server. Changes stay safely on this tablet.');
      } catch (e) {
        msg.textContent = e instanceof AuthError ? `${e.message} Sign out and sign in again (your waiting changes are kept if you sign back in as the same person).` : e.message;
      }
      await refreshCounts();
      setTimeout(render, 800);
    },
  }, 'Sync now');

  mount(main(),
    h('div', { class: 'page-head' }, h('h1', {}, 'Sync')),
    h('section', { class: 'card' },
      h('div', { class: 'kv' }, h('span', {}, 'Connection'), h('strong', {}, navigator.onLine ? 'Online' : 'Offline')),
      h('div', { class: 'kv' }, h('span', {}, 'Last successful sync'), h('strong', {}, fmtAgo(st.lastSync))),
      h('div', { class: 'kv' }, h('span', {}, 'Changes waiting to upload'), h('strong', { id: 'pendingCount' }, String(outbox.length))),
      h('div', { class: 'kv' }, h('span', {}, 'Photos waiting to upload'), h('strong', {}, String(photos.length))),
      h('div', { class: 'kv' }, h('span', {}, 'Storage protected from clean-up'), h('strong', {}, persisted ? 'Yes' : 'Not confirmed')),
      st.lastError ? h('p', { class: 'warning' }, `Last error: ${st.lastError}`) : null,
      syncBtn, msg),
    outbox.some((o) => o.error) ? h('section', { class: 'card' },
      h('h2', {}, 'Changes the server would not accept'),
      h('p', { class: 'muted' }, 'These stay on this tablet and are retried at every sync. Fix the cause (for example ask an administrator to reopen a sample), or discard the change.'),
      outbox.filter((o) => o.error).map((o) => h('div', { class: 'error-row' },
        h('div', {}, h('strong', {}, `${o.table === 'Samples' ? 'Sample' : 'Leaf'} ${o.patch?.SampleNumber ?? o.patch?.LeafNumber ?? ''}`), h('div', { class: 'small' }, o.error)),
        h('button', {
          class: 'btn danger-outline small', type: 'button', onclick: async () => {
            if (await confirmDialog('Discard this change?', 'It will not be uploaded. This cannot be undone.', { ok: 'Discard', danger: true })) {
              await db.del('outbox', o.seq);
              await refreshCounts();
              render();
            }
          },
        }, 'Discard')))) : null,
    h('section', { class: 'card' },
      h('h2', {}, 'Account'),
      h('div', { class: 'kv' }, h('span', {}, 'Signed in as'), h('strong', {}, `${displayName(session.user)}${session.user.Username ? ` (${session.user.Username})` : ''}`)),
      h('div', { class: 'kv' }, h('span', {}, 'Email'), h('strong', {}, session.user.UserEmail)),
      h('div', { class: 'kv' }, h('span', {}, 'Role'), h('strong', {}, session.user.Role)),
      h('div', { class: 'kv' }, h('span', {}, 'Server'), h('span', { class: 'small break' }, session.apiUrl)),
      h('div', { class: 'kv' }, h('span', {}, 'App version'), h('span', {}, APP_VERSION)),
      h('button', {
        class: 'btn danger-outline', type: 'button', onclick: async () => {
          const pending = outbox.length + photos.length;
          const ok = await confirmDialog('Sign out?', pending
            ? `${pending} change(s) have NOT been uploaded yet. If you sign out they stay on this tablet only until you sign in again as the same person. Sync first if you can.`
            : 'Data on this tablet will be cleared. It downloads again when you sign in.', { ok: 'Sign out', danger: !!pending });
          if (!ok) return;
          if (pending) {
            await db.setMeta('session', null);
          } else {
            await db.wipe();
            await db.setMeta('lastLogin', { apiUrl: session.apiUrl, login: session.login || session.email, userEmail: session.user.UserEmail, name: displayName(session.user) });
          }
          session = null;
          renderHeader();
          go('#/login');
        },
      }, 'Sign out')));
}

boot();
