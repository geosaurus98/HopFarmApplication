import * as db from './db.js';
import * as L from './logic.js';
import { STATUS, COUNT_FIELDS, can } from './logic.js';
import { api, sync, syncSoon, onStatus, refreshCounts, startAutoSync, fetchLeaves, AuthError, OfflineError, getStatus } from './sync.js';
import { h, svg, mount, toast, confirmDialog, choiceDialog, contentDialog, fmtDate, fmtDateTime, fmtAgo, pct, download, field, statusPill, progressBar, clearErrorsOnEdit } from './ui.js';
import { DEFAULT_API_URL, APP_VERSION, IS_LIVE_APP, LIVE_API_URL } from './config.js';
import { initPlant, plantRoutes } from './plant.js';
import { MITE_HELP, PLANT_HELP, sheetHelp, helpSection } from './help.js';

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
  initPlant({
    main, go, render: () => render(), session: () => session, userNames, photoInput, photoView, notFound, weekBars, displayName,
  });
  // Ask the browser not to evict our data under storage pressure.
  navigator.storage?.persist?.().catch(() => {});

  session = await db.getMeta('session');
  if (session) db.setActor(session.user.UserEmail);
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

/**
 * Make it obvious when this is not the workers' live app, and warn loudly if a
 * test app has been pointed at the live server (or the live app at a test server).
 */
function renderEnvBanner() {
  document.getElementById('envBanner')?.remove();
  const serverEnv = session?.environment || '';
  const onLiveServer = session?.apiUrl === LIVE_API_URL || serverEnv === 'LIVE';
  let text = '';
  let cls = 'env-banner';
  if (!IS_LIVE_APP && session && onLiveServer) {
    text = '⚠ TEST VERSION of the app, but connected to the LIVE server — changes here affect the real data. Sign out and use the test server.';
    cls += ' danger';
  } else if (IS_LIVE_APP && serverEnv === 'TEST') {
    text = '⚠ This is the workers\' app connected to the TEST server — records saved here go to the test sheets.';
    cls += ' danger';
  } else if (!IS_LIVE_APP) {
    text = `TEST VERSION ${APP_VERSION} — for trying out changes${serverEnv === 'TEST' ? ' · test data' : ''}. Workers use the live app.`;
  }
  if (!text) return;
  document.getElementById('header').before(h('div', { id: 'envBanner', class: cls, role: 'status' }, text));
}

function renderHeader() {
  renderEnvBanner();
  const header = document.getElementById('header');
  mount(header,
    h('a', { class: 'brand', href: '#/' }, h('img', { src: 'icons/icon.svg', alt: '' }), h('span', {}, 'Nelson Lakes Hops')),
    h('div', { class: 'spacer' }),
    session ? h('span', { class: 'who' }, `${displayName(session.user)} · ${L.normalizeRole(session.user.Role)}`) : null,
    session ? h('a', { class: 'switch-person', href: '#/switch', id: 'switchPerson' }, 'Change person') : null,
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
  [/^#\/login\/code$/, viewCodeLogin, false],
  [/^#\/login\/new$/, viewNewWorker, false],
  [/^#?\/?$/, viewHome],
  [/^#\/new$/, () => viewSampleForm(null)],
  [/^#\/edit\/([\w-]+)$/, (id) => viewSampleForm(id)],
  [/^#\/samples\/(\w+)$/, viewSampleList],
  [/^#\/sample\/([\w-]+)$/, viewSample],
  [/^#\/leaf\/([\w-]+)\/([\w-]+)$/, viewLeaf],
  [/^#\/complete\/([\w-]+)$/, viewComplete],
  [/^#\/reports$/, viewReports],
  [/^#\/help$/, viewHelp],
  [/^#\/help\/(mites|plant)$/, viewHelpSection],
  [/^#\/mites$/, viewMites],
  [/^#\/users$/, viewUsers],
  [/^#\/user\/([^/]+)$/, (id) => viewUserForm(decodeURIComponent(id))],
  [/^#\/sync$/, viewSync],
  [/^#\/switch$/, changePerson],
  ...plantRoutes,
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
  if (!session && !hash.startsWith('#/login')) { location.hash = '#/login'; return; }
  for (const [re, fn, needsAuth = true] of routes) {
    const m = re.exec(hash);
    if (m) {
      if (needsAuth && !session) return;
      try {
        await fn(...m.slice(1));
      } catch (e) {
        // Signed out while this screen was still loading: the sign-in screen takes over.
        if (needsAuth && !session) return;
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
//  - A tablet an admin/owner has set up: workers tap their name (no code), or add
//    themselves with "I'm new here".
//  - Admins, owners (and anyone given a code): username + access code.
// ---------------------------------------------------------------------------
async function signInAs(newSession) {
  session = newSession;
  db.setActor(session.user.UserEmail);
  await db.setMeta('session', session);
  renderHeader();
}

/** The first screen: on a set-up tablet, "Who's using the app?"; otherwise the code sign-in. */
async function viewLogin() {
  const device = await db.getMeta('device');
  if (!device) return viewCodeLogin();
  if (main().querySelector('#whoList')) return;
  let workers = (await db.getAll('users')).filter((u) => L.normalizeRole(u.Role) === 'User' && u.Active !== false);
  const msg = h('p', { class: 'error', role: 'alert' });
  if (navigator.onLine) {
    try {
      const res = await api('workers', {}, { apiUrl: device.apiUrl });
      workers = res.workers;
      for (const w of workers) await db.put('users', w);
    } catch (e) {
      if (e instanceof AuthError) msg.textContent = e.message;
    }
  }
  workers.sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const pick = async (w) => {
    await signInAs({ apiUrl: device.apiUrl, worker: w.UserEmail, user: w, environment: device.environment || '' });
    if (navigator.onLine) await sync().catch(() => {});
    go('#/');
  };
  mount(main(),
    h('div', { class: 'card narrow wide' },
      h('h1', {}, 'Who’s using the app?'),
      h('p', { class: 'muted' }, 'Tap your name. No password needed on this tablet.'),
      msg,
      workers.length
        ? h('div', { class: 'who-list', id: 'whoList' }, workers.map((w) => h('button', { type: 'button', class: 'who-btn', onclick: () => pick(w) }, displayName(w))))
        : h('p', { id: 'whoList', class: 'muted' }, 'No names yet. Tap "I’m new here" to add yourself.'),
      h('div', { class: 'row wrap center' },
        h('a', { class: 'btn primary big', href: '#/login/new' }, '+ I’m new here')),
      h('p', { class: 'center small' },
        h('a', { href: '#/login/code' }, 'Admin or owner? Sign in with your access code'),
        h('br'), h('span', { class: 'muted' }, `This tablet: ${device.name}`))));
}

async function viewNewWorker() {
  const device = await db.getMeta('device');
  if (!device) return go('#/login');
  const name = h('input', { id: 'fullName', type: 'text', autocomplete: 'name', autocapitalize: 'words' });
  const email = h('input', { id: 'newEmail', type: 'email', autocomplete: 'email', placeholder: 'optional' });
  const msg = h('p', { class: 'error', role: 'alert' });
  const btn = h('button', { class: 'btn primary big', type: 'submit' }, 'Add me');
  async function submit(e) {
    e.preventDefault();
    msg.textContent = '';
    if (name.value.trim().split(/\s+/).length < 2) { msg.textContent = 'Enter your first and last name.'; return; }
    btn.disabled = true;
    try {
      const { user } = await api('registerWorker', { fullName: name.value.trim(), email: email.value.trim() }, { apiUrl: device.apiUrl });
      await db.put('users', user);
      await signInAs({ apiUrl: device.apiUrl, worker: user.UserEmail, user, environment: device.environment || '' });
      await sync().catch(() => {});
      toast(`Welcome, ${displayName(user)}.`);
      go('#/');
    } catch (err) {
      msg.textContent = err instanceof OfflineError ? 'Adding a new name needs an internet connection. Try again in Wi-Fi.' : err.message;
      btn.disabled = false;
    }
  }
  mount(main(),
    h('form', { class: 'card narrow', onsubmit: submit, novalidate: true },
      h('h1', {}, 'I’m new here'),
      h('p', { class: 'muted' }, 'Add your name once. Next time just tap it on the list.'),
      field('Your first and last name', name),
      field('Email (optional)', email, { hint: 'Only if you want the owner to be able to contact you.' }),
      msg,
      h('div', { class: 'row end' }, h('a', { class: 'btn secondary', href: '#/login' }, 'Back'), btn)));
  name.focus();
}

async function viewCodeLogin() {
  // Never redraw over a sign-in form that is already showing: it would wipe what was typed.
  if (main().querySelector('form #login')) return;
  const device = await db.getMeta('device');
  const saved = (await db.getMeta('lastLogin')) || {};
  const apiUrl = h('input', { id: 'apiUrl', type: 'text', inputmode: 'url', spellcheck: false, value: device?.apiUrl || saved.apiUrl || DEFAULT_API_URL, placeholder: 'https://script.google.com/macros/s/…/exec', autocomplete: 'off', disabled: !!device });
  const login = h('input', {
    id: 'login', type: 'text', value: saved.login || saved.email || '', autocomplete: 'username',
    autocapitalize: 'none', autocorrect: 'off', spellcheck: false, required: true,
  });
  const code = h('input', { id: 'code', type: 'password', inputmode: 'numeric', autocomplete: 'current-password', required: true });
  const shared = h('input', { id: 'sharedTablet', type: 'checkbox', class: 'checkbox', checked: true });
  const tabletName = h('input', { id: 'tabletName', type: 'text', value: 'Field tablet', autocomplete: 'off' });
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
      const { user, environment } = await api('login', {}, creds);
      if (!device) {
        // Without a set-up tablet, a different person must not inherit someone else's queue.
        const prev = await db.getMeta('lastLogin');
        const pending = await db.count('outbox');
        const prevEmail = prev?.userEmail || prev?.email;
        if (prevEmail && prevEmail.toLowerCase() !== user.UserEmail.toLowerCase() && pending > 0) {
          throw new Error(`This tablet still has ${pending} change(s) from ${prev.name || prevEmail} waiting to upload. Ask them to sign in and sync first.`);
        }
      }
      if (!device && shared.checked && L.isAdminRole(user.Role)) {
        const res = await api('registerDevice', { deviceName: tabletName.value.trim() || 'Tablet' }, creds);
        await db.setMeta('device', { ...res.device, apiUrl: creds.apiUrl, environment: environment || '' });
      }
      await signInAs({ ...creds, user, environment: environment || '' });
      await db.setMeta('lastLogin', { apiUrl: creds.apiUrl, login: creds.login, userEmail: user.UserEmail, name: displayName(user) });
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
      h('h1', {}, device ? 'Sign in with your code' : 'Sign in'),
      h('p', { class: 'muted' }, device ? 'For admins and owners.' : 'Sign in once while connected. After that the app works without internet.'),
      field('Username', login, { hint: 'Your email address also works.' }),
      field('Access code', code, { hint: 'The owner gives you this code.' }),
      device ? null : h('div', { class: 'field' },
        h('label', { class: 'check-row', for: 'sharedTablet' }, shared, h('span', {}, 'Set up this tablet so workers can just tap their name')),
        h('div', { class: 'hint' }, 'Admins and owners only. Workers then don’t need a code on this tablet.'),
        field('Tablet name', tabletName, { hint: 'So you can tell your tablets apart, e.g. "Field tablet 1".' })),
      h('details', { open: !apiUrl.value },
        h('summary', {}, 'Server address'),
        field('Server address', apiUrl, { hint: 'The Google Apps Script web app address ending in /exec.' })),
      msg,
      h('div', { class: 'row end' }, device ? h('a', { class: 'btn secondary', href: '#/login' }, 'Back') : null, btn)));
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
const tile = (href, title, sub, badge, cls = '', id = null) => h('a', { class: `tile ${cls}`, href, id },
  h('span', { class: 'tile-title' }, title), sub ? h('span', { class: 'tile-sub' }, sub) : null,
  badge !== null && badge !== undefined ? h('span', { class: 'tile-badge' }, String(badge)) : null);

/** Bold, coloured badge on the home screen's Mite Monitoring button when work is waiting. */
const alertBadge = (text) => h('span', { class: 'alert-badge', id: 'mitesAlert' }, text);

/** Home: one big button per section the person can use, then Help (and Manage Users for owners). */
async function viewHome() {
  const mites = L.hasSection(session.user, 'Mites');
  const plants = L.hasSection(session.user, 'Plant Health');
  // Only one section: go straight to it.
  if (mites !== plants) return mites ? viewMites() : ctxPlantHome();
  const w = L.mitesWaiting(await db.getAll('samples'));
  const toDo = w.awaiting + w.inProgress;
  const mitesTile = tile('#/mites', 'Mite Monitoring', 'Samples in the field, leaf analysis', null, 'section-tile mites', 'goMites');
  if (toDo) mitesTile.append(alertBadge(`${toDo} to analyse`));
  mount(main(),
    h('div', { class: 'tiles two' },
      mitesTile,
      tile('#/plant-health', 'Plant Health', 'Weekly bay checks', null, 'section-tile plants', 'goPlants')),
    h('div', { class: 'tiles two' },
      tile('#/help', 'Help and Reference', 'Identification photos and how-to'),
      can(role(), 'owner') ? tile('#/users', 'Manage Users', 'People, codes and tablets') : null));
}

/** Mite Monitoring: New sample + Analyse; In progress + Completed; admin extras below. */
async function viewMites() {
  const samples = await db.getAll('samples');
  const count = (st) => samples.filter((s) => s.Status === st).length;
  const allCompleted = can(role(), 'viewAllCompleted');
  const myCompleted = samples.filter((s) => s.Status === STATUS.COMPLETE && (allCompleted || L.analysedBy(s, me()))).length;
  // Make waiting work stand out: amber when samples need analysing, blue when analyses are under way.
  const w = L.mitesWaiting(samples);
  const analyseSub = w.awaiting
    ? `${w.awaiting} waiting${w.oldestDays !== null ? ` · oldest collected ${w.oldestDays === 0 ? 'today' : `${L.daysLabel(w.oldestDays)} ago`}` : ''}`
    : 'Nothing waiting';
  const progressSub = w.inProgress ? `${w.inProgress} started, not finished` : 'Resume a paused analysis';
  mount(main(),
    h('div', { class: 'page-head' }, h('h1', {}, 'Mite Monitoring'), h('a', { class: 'btn secondary small', href: '#/help/mites' }, 'Help')),
    h('div', { class: 'tiles two' },
      tile('#/new', 'New Mite Sample', 'Record a sample bag in the field', null, 'primary'),
      tile('#/samples/queue', 'Analyse Samples', analyseSub, count(STATUS.AWAITING), w.awaiting ? 'attention' : '', 'analyseTile')),
    h('div', { class: 'tiles two' },
      tile('#/samples/progress', 'Samples In Progress', progressSub, count(STATUS.IN_PROGRESS), w.inProgress ? 'busy' : '', 'progressTile'),
      tile('#/samples/completed', allCompleted ? 'Completed Samples' : 'My Completed Samples',
        allCompleted ? 'Search historical results' : 'Analyses you completed', myCompleted)),
    can(role(), 'reports') ? h('div', { class: 'tiles two' },
      tile('#/reports', 'Mite Reports', 'Trends and CSV files for Excel'),
      tile('#/samples/all', 'All Samples', 'Including cancelled samples', samples.length)) : null);
}

function ctxPlantHome() { go('#/plant-health'); }

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
  clearErrorsOnEdit(form);

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
      h('button', { class: 'btn primary big', type: 'submit', id: 'saveSample' }, existing ? 'Save changes' : 'Continue  →')));
}

function savedSampleScreen(s) {
  mount(main(),
    h('div', { class: 'card center' },
      h('div', { class: 'big-tick' }, '✓'),
      h('h1', {}, `Bag ${s.SampleNumber} saved`),
      h('ol', { class: 'collect-steps' },
        h('li', {}, 'Collect ', h('strong', { id: 'collectLeaves' }, `${s.TargetLeafCount} leaves`), ` from ${s.Block} - ${s.Variety}.`),
        h('li', {}, 'Seal the bag.'),
        h('li', {}, 'Make sure the bag is clearly labelled with ', h('strong', {}, `bag ${s.SampleNumber}`), '.')),
      h('p', { class: 'muted' }, navigator.onLine ? 'It will upload in a moment.' : 'Saved on this tablet. It will upload automatically when you are back in Wi-Fi.'),
      h('div', { class: 'row center wrap' },
        h('button', { class: 'btn primary big', type: 'button', onclick: () => render() }, 'Record another sample'),
        h('a', { class: 'btn secondary big', href: '#/mites' }, 'Done'))));
}

// ---------------------------------------------------------------------------
// Sample lists (§6.2, §9.3, §9.6, §11)
// ---------------------------------------------------------------------------
const LIST_TABS = {
  queue: { title: 'Analyse Samples', filter: (s) => [STATUS.AWAITING, STATUS.IN_PROGRESS].includes(s.Status), asc: true },
  progress: { title: 'Samples In Progress', filter: (s) => s.Status === STATUS.IN_PROGRESS, asc: true },
  mine: { title: 'My Recent Samples', filter: (s) => s.CollectorEmail?.toLowerCase() === me().toLowerCase() && s.CollectionDate >= daysAgo(14) },
  completed: {
    title: 'Completed Samples',
    filter: (s) => s.Status === STATUS.COMPLETE && (can(role(), 'viewAllCompleted') || L.analysedBy(s, me())),
  },
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
    can(r, 'startAnalysis', s, me()) && h('button', {
      class: 'btn primary big', type: 'button', onclick: async () => {
        await setSampleStatus(s, { Status: STATUS.IN_PROGRESS, AnalysisStartedAt: nowIso(), AnalysisStartedBy: me() }, '', `#/leaf/${id}/new`);
      },
    }, '▶ Start analysis'),
    can(r, 'resumeAnalysis', s, me()) && h('a', { class: 'btn primary big', href: `#/leaf/${id}/new` }, `▶ Resume at leaf ${next}`),
    can(r, 'completeAnalysis', s, me()) && p.analysed > 0 && h('a', { class: `btn ${p.reached ? 'success' : 'secondary'} big`, href: `#/complete/${id}` }, '✓ Complete analysis'),
    can(r, 'editSample', s, me()) && h('a', { class: 'btn secondary', href: `#/edit/${id}` }, 'Edit sample'),
    can(r, 'cancelSample', s, me()) && h('button', {
      class: 'btn danger-outline', type: 'button', onclick: async () => {
        if (await confirmDialog('Cancel this sample?', 'It will be removed from the analysis queue but kept for records. An administrator can restore it.', { ok: 'Cancel sample', cancel: 'Keep', danger: true })) {
          setSampleStatus(s, { Status: STATUS.CANCELLED }, 'Sample cancelled.');
        }
      },
    }, 'Cancel sample'),
    can(r, 'reopen', s, me()) && h('button', {
      class: 'btn secondary', type: 'button', onclick: async () => {
        if (await confirmDialog('Reopen analysis?', 'The sample goes back to "Analysis In Progress" so more leaves can be added. Complete it again when you are done.', { ok: 'Reopen' })) {
          setSampleStatus(s, { Status: STATUS.IN_PROGRESS }, 'Analysis reopened.');
        }
      },
    }, 'Reopen analysis'),
    can(r, 'restore', s, me()) && h('button', {
      class: 'btn secondary', type: 'button',
      onclick: () => setSampleStatus(s, { Status: leaves.length ? STATUS.IN_PROGRESS : STATUS.AWAITING }, 'Sample restored.'),
    }, 'Restore sample'));

  const info = (label, value) => (value === '' || value === null || value === undefined ? null : h('div', { class: 'kv' }, h('span', {}, label), h('strong', {}, String(value))));
  const editable = can(r, 'editLeaves', s, me());

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
        s.Status === STATUS.COMPLETE && role() === 'Analyst'
          ? h('p', { class: 'muted small', id: 'editWindow' }, L.recentlyCompleted(s)
            ? `You can correct this sample until ${fmtDate(L.analystEditUntil(s).toISOString().slice(0, 10))}. Tap a leaf to fix it, or reopen the analysis to add leaves. Changes are logged.`
            : `Completed more than ${L.ANALYST_EDIT_DAYS} days ago — only an administrator can change it now.`) : null,
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
      h('h2', {}, 'Results — average per leaf'),
      sampleBars(sum),
      h('div', { class: 'stats' },
        stat('PP : 2SM ratio', sum.PredatorToPestRatio ?? '—', 'predators per pest mite'),
        stat('Leaves with 2SM', pct(sum.PctLeavesWithTwoSM), `${sum.LeavesWithTwoSM} of ${sum.LeavesAnalysed}`))) : null,
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
  if (!can(role(), 'editLeaves', s, me())) {
    toast(s.Status === STATUS.COMPLETE
      ? 'Only the person who analysed this sample (within 31 days) or an admin can change it.'
      : 'You cannot record leaves for this sample.', 'bad');
    return go(`#/sample/${sampleId}`);
  }
  const isNew = leafId === 'new';
  if (isNew && !can(role(), 'addLeaves', s, me())) {
    toast('This analysis is complete. Tap "Reopen analysis" to add more leaves.', 'bad');
    return go(`#/sample/${sampleId}`);
  }
  const leaves = await db.getAll('leaves', 'SampleID', sampleId);
  const existing = isNew ? null : leaves.find((l) => l.LeafAnalysisID === leafId);
  if (!isNew && !existing) return notFound();
  const leafNumber = isNew ? L.nextLeafNumber(leaves) : Number(existing.LeafNumber);
  const p = L.progress(s, leaves);
  const start = L.leafFormValues(existing); // every count starts at 0

  const inputs = {};
  const errors = {};
  const order = L.LEAF_INPUT_FIELDS.map((f) => f.key);
  const counter = (c, small = false) => {
    const input = h('input', {
      id: c.key, type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', class: `count-input${small ? ' small' : ''}`,
      value: String(start[c.key]), 'aria-label': c.label,
    });
    inputs[c.key] = input;
    const bump = (d) => {
      const cur = L.parseCount(input.value);
      input.value = String(Math.max(0, (cur.value ?? 0) + d));
      input.dispatchEvent(new Event('input'));
    };
    input.addEventListener('input', () => { clearError(c.key); update(); });
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const next = inputs[order[order.indexOf(c.key) + 1]];
        if (next) next.focus(); else save('next');
      }
    });
    errors[c.key] = h('div', { class: 'error', 'data-error-for': c.key });
    return h('div', { class: `counter${small ? ' small' : ''}` },
      h('label', { for: c.key }, h('strong', {}, c.short), c.latin ? h('span', { class: 'muted small' }, ` ${c.latin}`) : null),
      h('div', { class: 'counter-row' },
        h('button', { type: 'button', class: 'btn step', tabindex: -1, 'aria-label': `${c.short} minus one`, onclick: () => bump(-1) }, '−'),
        input,
        h('button', { type: 'button', class: 'btn step', tabindex: -1, 'aria-label': `${c.short} plus one`, onclick: () => bump(1) }, '+')),
      errors[c.key]);
  };

  const otherText = h('input', {
    id: 'OtherBeneficialDescription', type: 'text', placeholder: 'What was it?',
    value: existing && !L.BENEFICIAL_COUNTS.some((b) => b.label === existing.OtherBeneficialDescription) ? existing.OtherBeneficialDescription || '' : '',
  });
  const otherBox = h('div', { class: 'other-box' }, field('Other beneficial — what was it?', otherText));
  const benefTotal = h('span', { class: 'muted' });
  const comment = h('textarea', { id: 'LeafComment', rows: 2, placeholder: 'Anything unusual about this leaf (optional)' }, existing?.LeafComment || '');
  const photo = { value: existing?.LeafPhoto || '' };
  const highWarn = h('div', { class: 'warning', hidden: true });

  function update() {
    const v = readLeaf();
    otherBox.hidden = !(Number(v.BeneficialOtherCount) > 0);
    benefTotal.textContent = `Total: ${L.beneficialTotal(v)}`;
    const high = L.highCounts(v);
    highWarn.hidden = !high.length;
    highWarn.textContent = high.length ? `⚠ Unusually high: ${high.map((f) => `${f.short} ${inputs[f.key].value}`).join(', ')}. Please double-check.` : '';
  }

  function clearError(key) {
    errors[key].textContent = '';
    inputs[key].classList.remove('invalid');
  }

  function readLeaf() {
    const out = {};
    for (const f of L.LEAF_INPUT_FIELDS) out[f.key] = inputs[f.key].value.trim();
    return out;
  }

  /** Has anything been entered on this (new) leaf? */
  const touched = () => Object.values(readLeaf()).some((v) => v !== '0' && v !== '') || comment.value.trim() || photo.newPhoto;

  async function save(mode) {
    const freshLeaves = await db.getAll('leaves', 'SampleID', sampleId);
    const counts = readLeaf();
    const draft = { ...counts, LeafAnalysisID: existing?.LeafAnalysisID, LeafNumber: isNew ? L.nextLeafNumber(freshLeaves) : leafNumber };
    const errs = L.validateLeaf(draft, freshLeaves);
    let firstBad = null;
    for (const f of L.LEAF_INPUT_FIELDS) {
      errors[f.key].textContent = errs[f.key] || '';
      inputs[f.key].classList.toggle('invalid', !!errs[f.key]);
      if (errs[f.key] && !firstBad) firstBad = inputs[f.key];
    }
    if (errs.LeafNumber) { toast(errs.LeafNumber, 'bad'); return false; }
    if (firstBad) { firstBad.focus(); toast('Counts must be whole numbers of 0 or more.', 'bad'); return false; }
    const high = L.highCounts(counts);
    if (high.length && !(await confirmDialog('Unusually high count', `${high.map((f) => `${f.short}: ${counts[f.key]}`).join(', ')}. Is this correct?`, { ok: 'Yes, save it', cancel: 'Go back' }))) return false;

    const values = {
      ...Object.fromEntries(L.LEAF_INPUT_FIELDS.map((f) => [f.key, Number(counts[f.key])])),
      OtherBeneficialCount: L.beneficialTotal(counts),
      OtherBeneficialDescription: Number(counts.BeneficialOtherCount) > 0 ? (otherText.value.trim() || 'Other') : '',
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
    return true;
  }

  /** "Sample finished": leave the leaf screen. Asks first if this leaf has anything entered. */
  async function finish() {
    if (touched()) {
      const choice = await choiceDialog(`Save leaf ${leafNumber} first?`, 'You have entered counts on this leaf.', [
        { label: 'Go back', value: 'back' },
        { label: 'Don’t save it', value: 'discard', kind: 'danger-outline' },
        { label: `Save leaf ${leafNumber}`, value: 'save', kind: 'primary' },
      ]);
      if (choice === 'save') { await save('stop'); return; }
      if (choice !== 'discard') return;
    }
    go(`#/sample/${sampleId}`);
  }

  async function removeLeaf() {
    if (!(await confirmDialog(`Delete leaf ${leafNumber}?`, 'The leaf record is removed from the results. The remaining leaves keep their numbers.', { ok: 'Delete leaf', danger: true }))) return;
    const changes = [{ table: 'LeafAnalysis', record: existing, patch: { Deleted: true }, remove: true }];
    if (s.Status === STATUS.COMPLETE) {
      // Keep the recorded leaf count of a completed sample correct.
      const patch = { ActualLeafCount: L.liveLeaves(leaves).length - 1 };
      changes.unshift({ table: 'Samples', record: { ...s, ...patch }, patch });
    }
    await db.saveChanges(changes);
    syncSoon();
    toast(`Leaf ${leafNumber} deleted.`);
    go(`#/sample/${sampleId}`);
  }

  const showHelp = () => contentDialog('Help — what to count', helpSection(MITE_HELP.filter((i) => i.category === 'Identification')));

  const [twoSm, twoSmEggs, dead, eaten, pp, ppEggs] = L.MAIN_COUNTS.map((c) => counter(c));
  mount(main(),
    h('div', { class: 'leaf-head' },
      h('div', {},
        h('div', { class: 'leaf-sample' }, `Bag ${s.SampleNumber} · ${s.Block} - ${s.Variety}`),
        h('div', { class: 'muted' }, `${p.analysed} of ${p.target} leaves done${p.reached ? ' — target reached ✓' : ''}`)),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn secondary small', id: 'leafHelp', onclick: showHelp }, '? Help'),
        h('div', { class: 'leaf-number', id: 'leafNumber' }, h('span', {}, 'Leaf'), String(leafNumber)))),
    progressBar(p),
    h('form', { class: 'card leaf-form', onsubmit: (e) => { e.preventDefault(); save('next'); }, novalidate: true },
      h('div', { class: 'count-grid' }, twoSm, twoSmEggs, dead, eaten, pp, ppEggs),
      h('h3', { class: 'beneficial-head' }, 'Beneficials ', benefTotal),
      h('div', { class: 'count-grid beneficials' }, L.BENEFICIAL_COUNTS.map((c) => counter(c, true))),
      otherBox,
      highWarn,
      field('Comment (optional)', comment),
      photoInput('Add photo', photo, 'leaf'),
      h('div', { class: 'row end sticky-actions wrap' },
        isNew
          ? [h('button', { type: 'button', class: 'btn secondary big', id: 'sampleFinished', onclick: finish }, 'Sample finished'),
            h('button', { type: 'submit', class: 'btn primary big', id: 'nextLeaf' }, 'Next leaf  →')]
          : [h('a', { class: 'btn secondary', href: `#/sample/${sampleId}` }, 'Cancel'),
            h('button', { type: 'button', class: 'btn danger-outline', onclick: removeLeaf }, 'Delete leaf'),
            h('button', { type: 'button', class: 'btn primary big', onclick: () => save('stop') }, 'Save changes')])));
  update();
  inputs.TetranychusCount.focus();
}

// ---------------------------------------------------------------------------
// Completion (§7.2–7.5)
// ---------------------------------------------------------------------------
async function viewComplete(id) {
  const s = await db.get('samples', id);
  if (!s) return notFound();
  if (!can(role(), 'completeAnalysis', s, me())) return go(`#/sample/${id}`);
  const leaves = await db.getAll('leaves', 'SampleID', id);
  const p = L.progress(s, leaves);
  const below = p.analysed < p.target;
  const reason = h('select', { id: 'EarlyCompletionReason' }, h('option', { value: '' }, '— choose a reason —'),
    L.EARLY_REASONS.map((r) => h('option', { value: r }, r)));
  const reasonText = h('input', { id: 'reasonText', type: 'text', placeholder: 'e.g. leaves too damaged to count' });
  const comments = h('textarea', { id: 'AnalysisComments', rows: 3, placeholder: 'Overall comments on this analysis (optional)' }, s.AnalysisComments || '');

  const form = h('form', { class: 'card', onsubmit: complete, novalidate: true });
  clearErrorsOnEdit(form);

  async function complete(e) {
    e.preventDefault();
    if (!p.analysed) { toast('Record at least one leaf first.', 'bad'); return; }
    // Finishing below the target needs a reason; the explanation and comments stay optional.
    if (below && !reason.value) {
      const err = form.querySelector('[data-error-for="EarlyCompletionReason"]');
      err.textContent = 'Choose why fewer leaves were analysed.';
      err.closest('.field').classList.add('has-error');
      reason.focus();
      return;
    }
    const why = [reason.value, reasonText.value.trim()].filter(Boolean).join(' — ');
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
    form);
  mount(form,
      h('p', { class: 'target-line' }, h('strong', {}, `${p.analysed} of ${p.target}`), ' target leaves analysed.'),
      progressBar(p),
      below ? h('div', { class: 'warning' },
        h('strong', {}, `⚠ Target not reached — ${p.remaining} leaves short.`),
        h('p', {}, 'You can still complete the sample, but please choose why fewer leaves were analysed.')) : null,
      below ? field('Reason (required)', reason) : null,
      below ? field('Explain (optional)', reasonText, { id: 'reasonText' }) : null,
      p.analysed > p.target ? h('p', { class: 'muted' }, `${p.analysed - p.target} extra leaves will be included in the results.`) : null,
      field('Analysis comments (optional)', comments),
      h('div', { class: 'row end' },
        h('a', { class: 'btn secondary', href: `#/sample/${id}` }, 'Back'),
        h('button', { class: 'btn success big', type: 'submit' }, '✓ Confirm — complete analysis')));
}

// ---------------------------------------------------------------------------
// Reports and exports (§12)
// ---------------------------------------------------------------------------
async function viewReports() {
  if (!can(role(), 'reports')) { toast('Reports are for admins and owners.', 'bad'); return go('#/mites'); }
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

  // Week by week: one small bar chart per count, each bar one sample (Jason: "a simple bar
  // graph for each sample so comparison could be made from week to week on the number of each").
  const trendBlock = h('select', { id: 'trendBlock' }, used.map((b) => h('option', { value: b.BlockVarietyID }, L.blockLabel(b))));
  const trendSeason = h('select', { id: 'trendSeason' }, h('option', { value: '' }, 'All seasons'), seasons.map((x) => h('option', { value: x, selected: x === seasons[0] }, x)));
  const chartBox = h('div', {});
  const drawTrend = () => {
    const series = L.TREND_MEASURES.map((m) => ({ m, pts: L.trendPoints(samples, bySample, trendBlock.value, m.key, trendSeason.value) }));
    if (!series[0].pts.length) {
      mount(chartBox, h('p', { class: 'muted' }, 'No analysed samples for this block and season on this tablet yet.'));
      return;
    }
    mount(chartBox,
      h('div', { class: 'small-multiples' }, series.map(({ m, pts }) => h('figure', { class: 'chart-card' },
        h('figcaption', {}, m.label, h('span', { class: 'muted small' }, ' · average per leaf')),
        weekBars(pts, m)))),
      trendTable(series, (id) => L.liveLeaves(bySample.get(id) || []).length));
  };
  [trendBlock, trendSeason].forEach((el) => el.addEventListener('change', drawTrend));

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
      h('thead', {}, h('tr', {}, ['Block', 'Samples', 'Leaves', 'PP / leaf', '2SM / leaf', 'PP eggs / leaf', '2SM eggs / leaf', 'Beneficials / leaf', 'Leaves with 2SM', 'PP : 2SM'].map((x) => h('th', {}, x)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, L.blockLabel(r.b)), h('td', {}, r.n), h('td', {}, r.leaves),
        h('td', {}, r.tot.AvgPPPerLeaf), h('td', {}, r.tot.AvgTwoSMPerLeaf), h('td', {}, r.tot.AvgPredatorEggsPerLeaf),
        h('td', {}, r.tot.AvgTwoSMEggsPerLeaf), h('td', {}, r.tot.AvgOtherBeneficialPerLeaf),
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
      h('h2', {}, 'Week by week'),
      h('p', { class: 'muted small' }, 'Each bar is one sample from the chosen block. Tap a bar to see its value. Each chart has its own scale.'),
      used.length ? h('div', {}, h('div', { class: 'row wrap' }, trendBlock, trendSeason), chartBox)
        : h('p', { class: 'muted' }, 'No samples yet.')),
    seasons.length ? h('section', { class: 'card' }, h('h2', {}, 'Compare blocks'), h('div', { class: 'row' }, cmpSeason), cmpBox) : null);
  if (used.length) drawTrend();
  if (seasons.length) drawCmp();
}

const fmtNum = (v) => String(Math.round(v * 100) / 100);

/** SVG path for a column with 4px rounded top corners, square at the baseline. */
function columnPath(x, y, w, base) {
  const r = Math.min(4, w / 2, base - y);
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}

/**
 * Column chart for one measure: one bar per sample, in date order.
 * Tap or hover a bar to read its value in the line under the chart (works on touch);
 * the latest bar is labelled directly.
 */
function weekBars(points, measure) {
  const W = 360; const H = 190; const pad = { l: 34, r: 8, t: 18, b: 30 };
  const top = Math.max(...points.map((p) => p.value));
  const max = top > 0 ? niceCeil(top) : 1; // all zeros: show a 0–1 scale, not 0/0/0
  const n = points.length;
  const band = (W - pad.l - pad.r) / n;
  const bw = Math.max(3, Math.min(32, band - 2));
  const base = H - pad.b;
  const sy = (v) => base - (v / max) * (H - pad.t - pad.b);
  const describe = (p) => (p.label
    ? `${fmtDate(p.date)} · ${p.label}: ${fmtNum(p.value)} ${measure.short}`
    : `${fmtDate(p.date)} · bag ${p.sample.SampleNumber}: ${fmtNum(p.value)} ${measure.short} per leaf`);
  const readout = h('div', { class: 'chart-readout', 'aria-live': 'polite' }, `Latest: ${describe(points[n - 1])}`);
  const every = Math.ceil(n / 7);
  const bars = [];
  const select = (i) => {
    bars.forEach((b, j) => b.classList.toggle('active', j === i));
    readout.textContent = describe(points[i]);
  };
  const svgEl = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${measure.label}, average per leaf, by sample date` },
    [0, 0.5, 1].map((f) => svg('g', {},
      svg('line', { x1: pad.l, x2: W - pad.r, y1: sy(f * max), y2: sy(f * max), class: f ? 'grid' : 'baseline' }),
      svg('text', { x: pad.l - 5, y: sy(f * max) + 4, 'text-anchor': 'end', class: 'axis' }, fmtNum(f * max)))),
    points.map((p, i) => {
      const x = pad.l + i * band + (band - bw) / 2;
      const bar = svg('path', { d: columnPath(x, sy(p.value), bw, base), class: `bar${i === n - 1 ? ' latest' : ''}` });
      bars.push(bar);
      return svg('g', { class: 'bar-group', tabindex: 0, onclick: null },
        bar,
        svg('rect', { x: pad.l + i * band, y: pad.t, width: band, height: base - pad.t, class: 'hit' }),
        (i % every === 0 || i === n - 1) ? svg('text', { x: x + bw / 2, y: base + 16, 'text-anchor': 'middle', class: 'axis' }, fmtDate(p.date).slice(0, 5)) : null,
        i === n - 1 ? svg('text', { x: x + bw / 2, y: sy(p.value) - 5, 'text-anchor': 'middle', class: 'value-label' }, fmtNum(p.value)) : null);
    }));
  svgEl.querySelectorAll('.bar-group').forEach((g, i) => {
    g.addEventListener('pointerenter', () => select(i));
    g.addEventListener('click', () => select(i));
    g.addEventListener('focus', () => select(i));
  });
  return h('div', { class: 'chart' }, svgEl, readout);
}

/** The same numbers as a table (accessibility, and for reading exact values). */
function trendTable(series, leafCount) {
  const rows = series[0].pts;
  return h('details', { class: 'chart-table' },
    h('summary', {}, 'Show the numbers'),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Bag'), h('th', {}, 'Leaves'), series.map(({ m }) => h('th', {}, `${m.short} / leaf`)))),
      h('tbody', {}, rows.map((p, i) => h('tr', {},
        h('td', {}, fmtDate(p.date)), h('td', {}, String(p.sample.SampleNumber)),
        h('td', {}, String(leafCount(p.sample.SampleID))),
        series.map(({ pts }) => h('td', {}, fmtNum(pts[i].value)))))))));
}

/** One sample: horizontal bars of the average per leaf for each count, on a shared scale. */
function sampleBars(sum) {
  const rows = L.TREND_MEASURES.map((m) => ({ m, v: sum[m.key] ?? 0 }));
  const max = Math.max(...rows.map((r) => r.v), 0.0001);
  return h('div', { class: 'hbars', role: 'img', 'aria-label': `Average per leaf: ${rows.map((r) => `${r.m.short} ${fmtNum(r.v)}`).join(', ')}` },
    rows.map(({ m, v }) => h('div', { class: 'hbar-row' },
      h('span', { class: 'hbar-label' }, m.short),
      h('span', { class: 'hbar-track' }, h('span', { class: 'hbar', style: { width: `${(v / max) * 100}%` } })),
      h('span', { class: 'hbar-value' }, fmtNum(v)))));
}

function niceCeil(v) {
  const e = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * e).find((n) => n >= v);
}

// ---------------------------------------------------------------------------
// Help (§9.7)
// ---------------------------------------------------------------------------
async function viewHelp() {
  const mites = L.hasSection(session.user, 'Mites');
  const plants = L.hasSection(session.user, 'Plant Health');
  if (mites !== plants) return go(mites ? '#/help/mites' : '#/help/plant');
  mount(main(),
    h('div', { class: 'page-head' }, h('h1', {}, 'Help and Reference')),
    h('div', { class: 'tiles two' },
      tile('#/help/mites', 'Mite Monitoring', 'Mites, eggs and beneficials; collecting and analysing', null, 'section-tile mites'),
      tile('#/help/plant', 'Plant Health', 'Nutrient deficiencies and pests; weekly checks', null, 'section-tile plants')));
}

async function viewHelpSection(which) {
  const extra = await db.getAll('help');
  const isMites = which === 'mites';
  const items = isMites ? MITE_HELP.concat(sheetHelp(extra, 'Mites')) : PLANT_HELP.concat(sheetHelp(extra, 'Plant Health'));
  mount(main(),
    h('div', { class: 'page-head' },
      h('h1', {}, isMites ? 'Help — Mite Monitoring' : 'Help — Plant Health'),
      h('a', { class: 'btn secondary small', href: isMites ? '#/mites' : '#/plant-health' }, isMites ? 'Mite Monitoring' : 'Plant Health')),
    isMites ? h('section', { class: 'card' },
      h('h2', {}, 'Mite control in hops — poster'),
      h('a', { href: 'help/mite-control-poster.webp', target: '_blank', rel: 'noopener' },
        h('img', { class: 'help-poster', src: 'help/mite-control-poster.webp', alt: 'Mite control in hops poster: the plant damage, the pest two-spotted spider mite (badies), the predatory mite Phytoseiulus persimilis (goodies), and other beneficials — ladybird, predatory thrips and lacewing.' }))) : null,
    helpSection(items));
  // Opened from a link to one item (e.g. #/help/mites?item=mite-pp): open and show it.
}

// ---------------------------------------------------------------------------
// User management (administrators). Needs a connection: changes go straight
// to the Users tab so the new person can sign in immediately.
// ---------------------------------------------------------------------------
function needsAdminOnline(title) {
  if (!can(role(), 'owner')) { go('#/'); return true; }
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
  const [{ users }, { devices }] = await Promise.all([api('listUsers'), api('listDevices')]);
  await db.replaceAll('users', users.map(({ AccessCode, ...pub }) => pub));
  const order = { Owner: 0, Admin: 1, User: 2 };
  users.sort((a, b) => (b.Active - a.Active) || (order[a.Role] - order[b.Role]) || displayName(a).localeCompare(displayName(b)));
  const deviceRows = h('div', { class: 'list' });
  const drawDevices = () => mount(deviceRows, devices.length ? devices.map((d) => h('div', { class: `sample-card${d.Active ? '' : ' inactive'}` },
    h('div', { class: 'grow' }, h('div', { class: 'title' }, d.DeviceName),
      h('div', { class: 'muted small' }, `Set up ${fmtDate(String(d.AddedAt).slice(0, 10))} by ${d.AddedBy}`)),
    h('button', {
      class: `btn small ${d.Active ? 'danger-outline' : 'secondary'}`, type: 'button', onclick: async () => {
        if (d.Active && !(await confirmDialog(`Remove ${d.DeviceName}?`, 'Workers can no longer pick their name on it until an admin or owner sets it up again. Anything not yet uploaded from it will need that too.', { ok: 'Remove', danger: true }))) return;
        try {
          await api('setDeviceActive', { deviceId: d.DeviceID, active: !d.Active });
          d.Active = !d.Active;
          drawDevices();
        } catch (e) { toast(e.message, 'bad'); }
      },
    }, d.Active ? 'Remove' : 'Allow again'))) : h('p', { class: 'muted' }, 'No tablets set up yet. Sign in with your code on a tablet and tick "Set up this tablet".'));
  drawDevices();
  const levelText = (u) => (u.Role === 'User' ? 'User' : u.Role);
  mount(main(),
    h('div', { class: 'page-head' }, h('h1', {}, 'Manage Users'),
      h('a', { class: 'btn primary', href: '#/user/new' }, '+ Add person')),
    h('p', { class: 'muted' }, 'Users tap their name on a set-up tablet (no code). Admins and owners sign in with their access code. Tap a person to change their details, level, code or access.'),
    h('div', { class: 'list' }, users.map((u) => h('a', { class: `sample-card${u.Active ? '' : ' inactive'}`, href: `#/user/${encodeURIComponent(u.UserEmail)}` },
      h('div', { class: 'grow' },
        h('div', { class: 'title' }, displayName(u)),
        h('div', { class: 'muted small' }, `${u.Username || '(no username)'} · ${u.UserEmail}`),
        h('div', { class: 'small' }, L.isAdminRole(u.Role) ? 'Everything' : L.userSections(u).map((x) => (x === 'Mites' ? 'Mite Monitoring' : x)).join(' + '))),
      h('div', { class: 'right' },
        h('span', { class: `pill ${u.Active ? 'role' : 'cancelled'}` }, u.Active ? levelText(u) : `${levelText(u)} — no access`))))),
    h('h2', { class: 'section-heading' }, 'Tablets'),
    deviceRows);
}

async function viewUserForm(id) {
  const isNew = id === 'new';
  if (needsAdminOnline(isNew ? 'Add user' : 'Edit user')) return;
  let u = { UserEmail: '', Username: '', FullName: '', Role: 'User', Active: true, AccessCode: '' };
  if (!isNew) {
    const { users } = await api('listUsers');
    u = users.find((x) => x.UserEmail.toLowerCase() === id.toLowerCase());
    if (!u) return notFound();
  }
  const isSelf = !isNew && u.UserEmail.toLowerCase() === me().toLowerCase();
  // Other owners are view-only.
  const readOnly = !isNew && !isSelf && L.isOwnerRole(u.Role);
  const fullName = h('input', { id: 'FullName', type: 'text', value: u.FullName || '', autocomplete: 'off', disabled: readOnly });
  const username = h('input', { id: 'Username', type: 'text', value: u.Username || '', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: false, disabled: readOnly });
  const email = h('input', { id: 'UserEmail', type: 'email', value: u.UserEmail, disabled: !isNew, autocomplete: 'off' });
  const roleSel = h('select', { id: 'Role', disabled: isSelf || readOnly }, L.ROLES.map((r) => h('option', { value: r, selected: L.normalizeRole(u.Role) === r }, r)));
  const active = h('input', { id: 'Active', type: 'checkbox', checked: !!u.Active, disabled: isSelf || readOnly, class: 'checkbox' });
  const userSecs = L.userSections({ ...u, Role: 'x' }); // as stored; admins see everything anyway
  const secBoxes = L.SECTIONS.map((sec) => h('input', {
    type: 'checkbox', class: 'checkbox', id: `section-${sec.replace(/\s+/g, '')}`, value: sec, checked: userSecs.includes(sec), disabled: readOnly,
  }));
  const secLabel = { Mites: 'Mite Monitoring', 'Plant Health': 'Plant Health' };
  const code = h('input', { id: 'AccessCode', type: 'text', inputmode: 'numeric', value: u.AccessCode || '', autocomplete: 'off', readonly: readOnly });
  const msg = h('p', { class: 'error', role: 'alert' });
  const saveBtn = h('button', { class: 'btn primary big', type: 'submit' }, isNew ? 'Add person' : 'Save changes');
  const roleHelp = {
    User: 'Collects and analyses samples, does plant checks. Reopens their own analyses for 31 days. Taps their name on a set-up tablet — no code needed.',
    Admin: 'Everything a User does, plus all completed and all samples, reports and exports, and correcting any sample. Signs in with a code.',
    Owner: 'Everything an Admin does, plus people, access codes and tablets. Signs in with a code.',
  };
  const codeHint = h('div', { class: 'hint' });
  const codeHelp = () => {
    codeHint.textContent = readOnly ? '' : roleSel.value === 'User'
      ? 'Not needed: Users tap their name on a set-up tablet. Give one only if they must sign in somewhere else.'
      : (isNew || !u.AccessCode) ? '4–12 digits. Leave blank and one will be made for them.' : 'Change this to give them a new code (the old one stops working).';
  };
  const roleHint = h('div', { class: 'hint' }, roleHelp[L.normalizeRole(u.Role)]);
  roleSel.addEventListener('change', () => { roleHint.textContent = roleHelp[roleSel.value]; codeHelp(); });
  codeHelp();

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
          Sections: secBoxes.filter((b) => b.checked).map((b) => b.value),
        },
      });
      const { AccessCode, ...pub } = user;
      await db.put('users', pub);
      mount(main(), h('div', { class: 'card center' },
        h('div', { class: 'big-tick' }, '✓'),
        h('h1', {}, isNew ? `${displayName(user)} added` : 'Changes saved'),
        !user.Active ? h('p', {}, `${displayName(user)} can no longer sign in.`)
          : user.AccessCode ? h('div', { class: 'credentials' },
            h('p', {}, 'Give them these details to sign in:'),
            h('div', { class: 'kv' }, h('span', {}, 'App address'), h('strong', { class: 'break' }, location.origin + location.pathname)),
            h('div', { class: 'kv' }, h('span', {}, 'Username'), h('strong', { id: 'newUsername' }, user.Username)),
            h('div', { class: 'kv' }, h('span', {}, 'Access code'), h('strong', { id: 'newCode' }, user.AccessCode)))
            : h('p', { id: 'noCodeNote' }, `${displayName(user)} can now tap their name on any set-up tablet.`),
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
    readOnly ? h('p', { class: 'warning', id: 'readOnlyNote' }, 'Owners can view other owners but not change them. Change them in the Users tab of the Users & Setup sheet.') : null,
    h('form', { class: 'card', onsubmit: submit, novalidate: true },
      h('div', { class: 'grid-2' },
        h('div', {},
          field('Full name', fullName),
          field('Username', username, { hint: 'What they type to sign in. Letters, numbers, dots or dashes; no spaces.' }),
          field('Email', email, { hint: isNew ? 'Their email address. It cannot be changed later.' : 'Cannot be changed — their records are linked to it.' })),
        h('div', {},
          h('div', { class: 'field' }, h('label', {}, 'Can use'),
            secBoxes.map((b) => h('label', { class: 'check-row', for: b.id }, b, h('span', {}, secLabel[b.value]))),
            h('div', { class: 'hint' }, 'Admins and owners can always use everything.')),
          field('Level', roleSel),
          roleHint,
          h('label', { class: 'check-row', for: 'Active' }, active, h('span', {}, 'Can sign in')),
          isSelf ? h('p', { class: 'muted small' }, 'You cannot change your own level or remove your own access.') : null,
          field('Access code', code),
          codeHint,
          readOnly ? null : h('button', { class: 'btn secondary small', type: 'button', onclick: () => { code.value = String(Math.floor(100000 + Math.random() * 900000)); } }, 'Generate new code'))),
      msg,
      readOnly ? null : h('div', { class: 'row end' }, saveBtn)));
}

// ---------------------------------------------------------------------------
// Sync, account and troubleshooting
// ---------------------------------------------------------------------------
let lastSyncResult = null;

async function viewSync() {
  const current = session;
  const device = await db.getMeta('device');
  const outbox = await db.getAll('outbox');
  const photos = await db.getAll('photos');
  const st = getStatus();
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  // The result of the last "Sync now" stays visible after the screen refreshes (for a minute).
  const msg = h('p', { class: 'muted', 'aria-live': 'polite', id: 'syncMsg' },
    lastSyncResult && Date.now() - lastSyncResult.at < 60000 ? lastSyncResult.text : '');
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
      lastSyncResult = { text: msg.textContent, at: Date.now() };
      await refreshCounts();
      // Refresh the Sync screen only if the user is still on it; never redraw another screen.
      setTimeout(() => { if (location.hash === '#/sync') render(); }, 800);
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
      h('div', { class: 'kv' }, h('span', {}, 'Signed in as'), h('strong', {}, `${displayName(current.user)}${current.user.Username ? ` (${current.user.Username})` : ''}`)),
      h('div', { class: 'kv' }, h('span', {}, 'Email'), h('strong', {}, current.user.UserEmail)),
      h('div', { class: 'kv' }, h('span', {}, 'Level'), h('strong', {}, L.normalizeRole(current.user.Role))),
      device ? h('div', { class: 'kv' }, h('span', {}, 'This tablet'), h('strong', {}, device.name)) : null,
      h('div', { class: 'kv' }, h('span', {}, 'Server'), h('span', { class: 'small break' }, current.apiUrl)),
      h('div', { class: 'kv' }, h('span', {}, 'App version'), h('span', {}, APP_VERSION)),
      h('div', { class: 'row wrap' },
        h('a', { class: 'btn secondary', href: '#/switch' }, device ? 'Change person' : 'Sign out'),
        device && L.isAdminRole(current.user.Role) ? h('button', {
          class: 'btn danger-outline', type: 'button', onclick: async () => {
            const pending = outbox.length + photos.length;
            const ok = await confirmDialog('Forget this tablet?', pending
              ? `${pending} change(s) have NOT been uploaded yet and would be lost. Sync first.`
              : 'Everything on this tablet is cleared, and workers can no longer pick their name here until an admin or owner sets it up again.',
            { ok: 'Forget tablet', danger: true });
            if (!ok || pending) return;
            await db.wipe();
            session = null;
            renderHeader();
            go('#/login');
          },
        }, 'Forget this tablet') : null)));
}

/**
 * Change person. On a set-up tablet: back to the name list; everything stays on the
 * tablet (unsent changes upload under the person who made them).
 * Without a set-up tablet: sign out, clearing the tablet if nothing is waiting.
 */
async function changePerson() {
  const device = await db.getMeta('device');
  const current = session;
  if (!current) return go('#/login');
  if (device) {
    await db.setMeta('session', null);
    session = null;
    db.setActor('');
    renderHeader();
    return go('#/login');
  }
  const pending = (await db.count('outbox')) + (await db.count('photos'));
  const ok = await confirmDialog('Sign out?', pending
    ? `${pending} change(s) have NOT been uploaded yet. If you sign out they stay on this tablet only until you sign in again as the same person. Sync first if you can.`
    : 'Data on this tablet will be cleared. It downloads again when you sign in.', { ok: 'Sign out', danger: !!pending });
  if (!ok) return go('#/sync');
  if (pending) {
    await db.setMeta('session', null);
  } else {
    await db.wipe();
    await db.setMeta('lastLogin', { apiUrl: current.apiUrl, login: current.login || current.email, userEmail: current.user.UserEmail, name: displayName(current.user) });
  }
  session = null;
  db.setActor('');
  renderHeader();
  go('#/login');
}

boot();
