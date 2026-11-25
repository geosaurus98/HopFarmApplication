// Plant Health section: one check per bay (7 plants between two posts) per visit.
// Mirrors the farm's paper form "Hop Plant Weekly Monitoring Report" (Nov 2026).
// Weather and block treatments are left out: they come from the weather station
// and other records.
import * as db from './db.js';
import * as L from './logic.js';
import { api, syncSoon, OfflineError, AuthError } from './sync.js';
import { h, mount, toast, confirmDialog, contentDialog, fmtDate, download, field, clearErrorsOnEdit } from './ui.js';
import { PLANT_HELP, sheetHelp, helpSection } from './help.js';

let ctx; // shared helpers from app.js: { main, go, render, session, userNames, photoInput, photoView, notFound, weekBars, displayName }

export function initPlant(context) { ctx = context; }

export const plantRoutes = [
  [/^#\/plant-health$/, viewPlantHome],
  [/^#\/plant\/new$/, () => viewPlantForm(null)],
  [/^#\/plant\/edit\/([\w-]+)$/, (id) => viewPlantForm(id)],
  [/^#\/plant\/([\w-]+)$/, viewPlantCheck],
  [/^#\/plants$/, viewPlantList],
  [/^#\/plant-reports$/, viewPlantReports],
];

const me = () => ctx.session().user;
const isAdmin = () => L.isAdminRole(me().Role);
const nowIso = () => new Date().toISOString();
const timeNow = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const live = (checks) => checks.filter((c) => !L.toBoolean(c.Deleted));
const recordLabel = (c) => (c.RecordNumber ? `${c.Season || L.seasonOf(c.InspectionDate)} #${c.RecordNumber}` : 'Number given on upload');
const where = (c) => `${c.Block} - ${c.Variety} · Row ${c.Row}, Bay ${c.Bay}`;

function guard() {
  if (!L.hasSection(me(), 'Plant Health')) {
    toast('Your account does not have access to Plant Health.', 'bad');
    ctx.go('#/');
    return true;
  }
  return false;
}

/** Latest earlier check of the same block (for pre-filling row/bay and "last time" hints). */
function previousFor(checks, blockId, beforeDate, excludeId) {
  return live(checks)
    .filter((c) => c.BlockVarietyID === blockId && c.CheckID !== excludeId && (!beforeDate || c.InspectionDate <= beforeDate))
    .sort((a, b) => String(b.InspectionDate).localeCompare(String(a.InspectionDate)) || String(b.CreatedAt).localeCompare(String(a.CreatedAt)))[0];
}

// ---------------------------------------------------------------------------
// Plant Health page
// ---------------------------------------------------------------------------
async function viewPlantHome() {
  if (guard()) return;
  const checks = live(await db.getAll('plantChecks'));
  const mineThisWeek = checks.filter((c) => String(c.InspectorEmail).toLowerCase() === me().UserEmail.toLowerCase() &&
    c.InspectionDate >= L.todayLocal(new Date(Date.now() - 7 * 86400000))).length;
  const tile = (href, title, sub, badge, cls = '') => h('a', { class: `tile ${cls}`, href },
    h('span', { class: 'tile-title' }, title), h('span', { class: 'tile-sub' }, sub),
    badge !== null && badge !== undefined ? h('span', { class: 'tile-badge' }, String(badge)) : null);
  mount(ctx.main(),
    h('div', { class: 'page-head' }, h('h1', {}, 'Plant Health'), h('a', { class: 'btn secondary small', href: '#/help/plant' }, 'Help')),
    h('div', { class: 'tiles two' },
      tile('#/plant/new', 'New Plant Check', 'Weekly check of a bay (7 plants)', null, 'primary'),
      tile('#/plants', isAdmin() ? 'Plant Checks' : 'My Plant Checks', 'This week', mineThisWeek)),
    isAdmin() ? h('div', { class: 'tiles two' }, tile('#/plant-reports', 'Plant Reports', 'Growth, stages and CSV for Excel')) : null);
}

// ---------------------------------------------------------------------------
// Choice controls
// ---------------------------------------------------------------------------
/** Row of large tap buttons; tap the selected one again to clear (all optional except stage). */
function chips(id, options, value, { multi = false, column = false, onChange } = {}) {
  let selected = multi ? new Set(String(value || '').split(',').map((x) => x.trim()).filter(Boolean)) : (value || '');
  const wrap = h('div', { class: `chips${column ? ' column' : ''}`, id, role: multi ? 'group' : 'radiogroup' });
  const buttons = options.map((opt) => h('button', {
    type: 'button', class: 'chip', 'data-value': opt, role: multi ? 'checkbox' : 'radio',
    onclick: () => {
      if (multi) { if (selected.has(opt)) selected.delete(opt); else selected.add(opt); }
      else selected = selected === opt ? '' : opt;
      paint();
      onChange?.(get());
    },
  }, opt));
  const isOn = (opt) => (multi ? selected.has(opt) : selected === opt);
  function paint() {
    buttons.forEach((b) => {
      const on = isOn(b.dataset.value);
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }
  const get = () => (multi ? options.filter((o) => selected.has(o)).join(', ') : selected);
  wrap.append(...buttons);
  paint();
  wrap.getValue = get;
  return wrap;
}

/** The 7-step leaf colour chart as tap targets, each showing its number. */
function colourPicker(value) {
  let selected = value === '' || value === undefined || value === null ? '' : Number(value);
  const wrap = h('div', { class: 'swatches', id: 'LeafColour', role: 'radiogroup', 'aria-label': 'Approximate leaf colour' });
  const buttons = L.LEAF_COLOURS.map((hex, i) => h('button', {
    type: 'button', class: `swatch${i < 3 ? ' light' : ''}`, style: { background: hex }, 'data-value': i + 1,
    role: 'radio', 'aria-label': `Colour ${i + 1}`,
    onclick: () => { selected = selected === i + 1 ? '' : i + 1; paint(); },
  }, String(i + 1)));
  function paint() {
    buttons.forEach((b) => {
      const on = Number(b.dataset.value) === selected;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }
  wrap.append(...buttons);
  paint();
  wrap.getValue = () => selected;
  return h('div', {}, wrap, h('div', { class: 'hint' }, '1 = light yellow-green … 7 = mid green. Tap the closest colour.'));
}

function numberInput(id, value, { unit, max, step = 'any', whole = false } = {}) {
  const input = h('input', {
    id, type: 'number', inputmode: whole ? 'numeric' : 'decimal', min: 0, max, step: whole ? 1 : step,
    value: value ?? '', class: 'num-input',
  });
  return { input, el: h('div', { class: 'num-with-unit' }, input, unit ? h('span', { class: 'unit' }, unit) : null) };
}

// ---------------------------------------------------------------------------
// New / edit plant check
// ---------------------------------------------------------------------------
async function viewPlantForm(id) {
  if (guard()) return;
  const all = await db.getAll('plantChecks');
  const existing = id ? all.find((c) => c.CheckID === id) : null;
  if (id && !existing) return ctx.notFound();
  if (existing && !L.canEditPlantCheck(me(), existing)) {
    toast('This check can no longer be changed. Ask an administrator.', 'bad');
    return ctx.go(`#/plant/${id}`);
  }
  const blocks = (await db.getAll('blocks'))
    .filter((b) => L.toBoolean(b.Active) || b.BlockVarietyID === existing?.BlockVarietyID)
    .sort((a, b) => L.blockLabel(a).localeCompare(L.blockLabel(b), undefined, { numeric: true }));
  if (!blocks.length) {
    return mount(ctx.main(), h('div', { class: 'card' }, h('h2', {}, 'No blocks on this tablet yet'),
      h('p', {}, 'Connect to the internet and sync so the block list can download.'),
      h('a', { class: 'btn primary', href: '#/sync' }, 'Go to Sync')));
  }
  const c = existing || { InspectionDate: L.todayLocal(), InspectionTime: timeNow() };

  // Section 1 — sample details
  const date = h('input', { id: 'InspectionDate', type: 'date', value: c.InspectionDate, max: L.todayLocal() });
  const time = h('input', { id: 'InspectionTime', type: 'time', value: c.InspectionTime || '' });
  const blockSel = h('select', { id: 'BlockVarietyID', class: 'big-input' },
    h('option', { value: '' }, '— choose block and variety —'),
    blocks.map((b) => h('option', { value: b.BlockVarietyID, selected: b.BlockVarietyID === c.BlockVarietyID }, L.blockLabel(b))));
  const row = numberInput('Row', c.Row, { whole: true });
  const bay = numberInput('Bay', c.Bay, { whole: true });
  const lastBox = h('div', { class: 'last-check', 'aria-live': 'polite' });

  // Section 2 — block overview
  const overview = L.BLOCK_OVERVIEW.map((q) => ({ q, ctl: chips(q.key, L.PLANT_OPTIONS[q.key], c[q.key]) }));
  const overviewPhoto = { value: c.OverviewPhoto || '' };

  // Section 3 — growth stage
  const stage = chips('GrowthStage', L.PLANT_OPTIONS.GrowthStage, c.GrowthStage, { column: true, onChange: () => updateQuestions() });

  // Section 4 — vine evaluation (7 plants in the bay)
  const bines = numberInput('BinesTrained', c.BinesTrained, { unit: `/ ${L.MAX_BINES_PER_BAY}`, whole: true, max: L.MAX_BINES_PER_BAY });
  const avgH = numberInput('AvgBineHeightCm', c.AvgBineHeightCm, { unit: 'cm' });
  const maxH = numberInput('MaxBineHeightCm', c.MaxBineHeightCm, { unit: 'cm' });
  const in1 = numberInput('InternodeUnder1mCm', c.InternodeUnder1mCm, { unit: 'cm' });
  const in2 = numberInput('Internode1to2mCm', c.Internode1to2mCm, { unit: 'cm' });
  const in3 = numberInput('Internode2to3mCm', c.Internode2to3mCm, { unit: 'cm' });
  const lat = numberInput('AvgLateralLengthCm', c.AvgLateralLengthCm, { unit: 'cm' });
  const tipsB = numberInput('SnappedTipsBine', c.SnappedTipsBine, { whole: true });
  const tipsL = numberInput('SnappedTipsLateral', c.SnappedTipsLateral, { whole: true });
  const overall = chips('OverallBineHealth', L.PLANT_OPTIONS.OverallBineHealth, c.OverallBineHealth);
  const colour = colourPicker(c.LeafColour);
  const leafSize = chips('LeafSize', L.PLANT_OPTIONS.LeafSize, c.LeafSize);
  const damage = chips('LeafDamage', L.PLANT_OPTIONS.LeafDamage, c.LeafDamage, { multi: true });
  const leafPhoto1 = { value: c.LeafPhoto1 || '' };
  const leafPhoto2 = { value: c.LeafPhoto2 || '' };
  const comments = h('textarea', { id: 'Comments', rows: 3, placeholder: 'Anything else worth noting (optional)' }, c.Comments || '');

  const fields = {};
  const fieldBox = (key, label, control, opts) => (fields[key] = field(label, control, { id: key, ...opts }));

  function updateQuestions() {
    const show = L.plantQuestions({ AvgBineHeightCm: avgH.input.value, GrowthStage: stage.getValue() });
    for (const k of ['InternodeUnder1mCm', 'Internode1to2mCm', 'Internode2to3mCm', 'AvgLateralLengthCm']) fields[k].hidden = !show[k];
  }

  function updateLast() {
    const prev = previousFor(all, blockSel.value, date.value, existing?.CheckID);
    if (!blockSel.value) { lastBox.replaceChildren(); return; }
    if (!existing && prev) {
      if (!row.input.value) row.input.value = prev.Row;
      if (!bay.input.value) bay.input.value = prev.Bay;
    }
    lastBox.replaceChildren(prev
      ? h('span', {}, `Last check of this block: ${fmtDate(prev.InspectionDate)} · Row ${prev.Row}, Bay ${prev.Bay} · `,
        h('strong', {}, L.STAGE_SHORT[L.stageIndex(prev.GrowthStage)] || prev.GrowthStage || '—'),
        prev.AvgBineHeightCm !== '' && prev.AvgBineHeightCm != null ? ` · average height ${prev.AvgBineHeightCm} cm` : '')
      : h('span', {}, 'No earlier check of this block on this tablet.'));
  }

  blockSel.addEventListener('change', updateLast);
  date.addEventListener('change', updateLast);
  avgH.input.addEventListener('input', updateQuestions);

  const form = h('form', { class: 'plant-form', novalidate: true });
  clearErrorsOnEdit(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const show = L.plantQuestions({ AvgBineHeightCm: avgH.input.value, GrowthStage: stage.getValue() });
    const num = (x) => (x.input.value.trim() === '' ? '' : Number(x.input.value));
    const values = {
      InspectionDate: date.value,
      InspectionTime: time.value,
      BlockVarietyID: blockSel.value,
      Row: num(row), Bay: num(bay),
      ...Object.fromEntries(overview.map(({ q, ctl }) => [q.key, ctl.getValue()])),
      OverviewPhoto: overviewPhoto.value,
      GrowthStage: stage.getValue(),
      BinesTrained: num(bines),
      AvgBineHeightCm: num(avgH),
      MaxBineHeightCm: num(maxH),
      // Questions that don't apply right now are saved blank, not as stale values.
      InternodeUnder1mCm: show.InternodeUnder1mCm ? num(in1) : '',
      Internode1to2mCm: show.Internode1to2mCm ? num(in2) : '',
      Internode2to3mCm: show.Internode2to3mCm ? num(in3) : '',
      AvgLateralLengthCm: show.AvgLateralLengthCm ? num(lat) : '',
      SnappedTipsBine: num(tipsB),
      SnappedTipsLateral: num(tipsL),
      OverallBineHealth: overall.getValue(),
      LeafColour: colour.firstChild.getValue(),
      LeafSize: leafSize.getValue(),
      LeafDamage: damage.getValue(),
      LeafPhoto1: leafPhoto1.value,
      LeafPhoto2: leafPhoto2.value,
      Comments: comments.value.trim(),
    };
    const errors = L.validatePlantCheck(values);
    form.querySelectorAll('[data-error-for]').forEach((el) => { el.textContent = errors[el.dataset.errorFor] || ''; });
    form.querySelectorAll('.field').forEach((f) => f.classList.toggle('has-error', !!f.querySelector('.error')?.textContent));
    const firstBad = Object.keys(errors)[0];
    if (firstBad) {
      toast('Please fix the highlighted fields.', 'bad');
      document.getElementById(firstBad)?.scrollIntoView({ block: 'center' });
      return;
    }
    const b = blocks.find((x) => x.BlockVarietyID === values.BlockVarietyID);
    const photos = [overviewPhoto.newPhoto, leafPhoto1.newPhoto, leafPhoto2.newPhoto].filter(Boolean)
      .map((p) => ({ ...p, kind: 'plant', label: `${b.Block} ${b.Variety} row ${values.Row} bay ${values.Bay}` }));

    if (existing) {
      const patch = {};
      for (const [k, v] of Object.entries(values)) if (String(existing[k] ?? '') !== String(v ?? '')) patch[k] = v;
      if (Object.keys(patch).length) {
        const record = { ...existing, ...patch, Block: b.Block, Variety: b.Variety, Season: L.seasonOf(values.InspectionDate) };
        await db.saveChanges([{ table: 'PlantChecks', record, patch }], photos);
        syncSoon();
      }
      toast('Changes saved.');
      return ctx.go(`#/plant/${existing.CheckID}`);
    }
    const record = {
      CheckID: L.uuid(), ...values, InspectorEmail: me().UserEmail, CreatedAt: nowIso(),
      Block: b.Block, Variety: b.Variety, Season: L.seasonOf(values.InspectionDate),
    };
    const { CheckID, Block, Variety, Season, ...patch } = record;
    await db.saveChanges([{ table: 'PlantChecks', record, patch, isNew: true }], photos);
    syncSoon();
    savedScreen(record);
  });

  const section = (title, sub, ...children) => h('section', { class: 'card' }, h('h2', {}, title), sub ? h('p', { class: 'muted small' }, sub) : null, ...children);

  mount(ctx.main(),
    h('div', { class: 'page-head' },
      h('h1', {}, existing ? `Edit plant check ${recordLabel(existing)}` : 'New Plant Check'),
      h('div', { class: 'row' },
        // Opens over the form, so nothing typed is lost.
        h('button', { type: 'button', class: 'btn secondary', id: 'plantHelp', onclick: showPlantHelp }, '? Help'),
        h('a', { class: 'btn secondary', href: existing ? `#/plant/${existing.CheckID}` : '#/' }, 'Cancel'))),
    form);
  mount(form,
    section('1. Sample details', `Inspector: ${ctx.displayName(me())}`,
      h('div', { class: 'grid-2' },
        h('div', {},
          fieldBox('BlockVarietyID', 'Block and variety', blockSel),
          h('div', { class: 'grid-2 tight' }, fieldBox('Row', 'Row #', row.el), fieldBox('Bay', 'Bay # (from south)', bay.el))),
        h('div', {},
          h('div', { class: 'grid-2 tight' }, fieldBox('InspectionDate', 'Date', date), fieldBox('InspectionTime', 'Time', time)),
          lastBox))),
    section('2. Block overview', 'Tap the choice that fits. Tap again to clear.',
      h('div', { class: 'choice-grid' }, overview.map(({ q, ctl }) => h('div', { class: 'choice-row' }, h('div', { class: 'choice-label' }, q.label), ctl))),
      ctx.photoInput('Add block photo', overviewPhoto, 'plant')),
    section('3. Current stage of plants', null, fieldBox('GrowthStage', 'Growth stage', stage)),
    section('4. Vine evaluation', 'Look at and evaluate all 7 plants in the bay.',
      h('div', { class: 'grid-3' },
        fieldBox('BinesTrained', 'Number of bines on string', bines.el, { hint: '7 plants × 2 strings × 3 bines = 42' }),
        fieldBox('AvgBineHeightCm', 'Average bine height', avgH.el, { hint: 'Ground to growing tip, average of the 7 plants' }),
        fieldBox('MaxBineHeightCm', 'Maximum bine height', maxH.el, { hint: 'Tallest bine' }),
        fieldBox('InternodeUnder1mCm', 'Internode spacing <1 m', in1.el, { hint: 'Spacing between leaves in the first metre' }),
        fieldBox('Internode1to2mCm', 'Internode spacing 1–2 m', in2.el, { hint: 'Asked once the average is over 2 m' }),
        fieldBox('Internode2to3mCm', 'Internode spacing 2–3 m', in3.el, { hint: 'Asked once the average is over 3 m' }),
        fieldBox('AvgLateralLengthCm', 'Average lateral length', lat.el, { hint: 'Asked from Lateral Development on' }),
        fieldBox('SnappedTipsBine', 'Snapped tips — bines', tipsB.el),
        fieldBox('SnappedTipsLateral', 'Snapped tips — laterals', tipsL.el)),
      h('div', { class: 'choice-grid' },
        h('div', { class: 'choice-row' }, h('div', { class: 'choice-label' }, 'Overall bine health'), overall),
        h('div', { class: 'choice-row' }, h('div', { class: 'choice-label' }, 'Leaf size'), leafSize),
        h('div', { class: 'choice-row' }, h('div', { class: 'choice-label' }, 'Leaf damage', h('div', { class: 'hint' }, 'Tap all that apply')), damage)),
      fieldBox('LeafColour', 'Approximate leaf colour', colour),
      h('div', { class: 'row wrap' }, ctx.photoInput('Add leaf photo 1', leafPhoto1, 'plant'), ctx.photoInput('Add leaf photo 2', leafPhoto2, 'plant'))),
    section('Comments', null, comments),
    h('div', { class: 'row end sticky-actions' },
      existing ? h('button', {
        type: 'button', class: 'btn danger-outline', onclick: async () => {
          if (!(await confirmDialog('Delete this plant check?', 'It will be removed from the results. Administrators can still see it in the sheet.', { ok: 'Delete', danger: true }))) return;
          await db.saveChanges([{ table: 'PlantChecks', record: existing, patch: { Deleted: true }, remove: true }]);
          syncSoon();
          toast('Plant check deleted.');
          ctx.go('#/plants');
        },
      }, 'Delete') : null,
      h('button', { type: 'submit', class: 'btn primary big', id: 'savePlant' }, existing ? 'Save changes' : 'Save plant check')));
  updateQuestions();
  updateLast();
}

function savedScreen(c) {
  mount(ctx.main(),
    h('div', { class: 'card center' },
      h('div', { class: 'big-tick' }, '✓'),
      h('h1', {}, 'Plant check saved'),
      h('p', { class: 'target-line' }, where(c)),
      h('p', { class: 'muted' }, navigator.onLine ? 'It will upload in a moment and get its record number.' : 'Saved on this tablet. It will upload automatically when you are back online.'),
      h('div', { class: 'row center wrap' },
        h('button', { class: 'btn primary big', type: 'button', onclick: () => ctx.render() }, 'Check another bay'),
        h('a', { class: 'btn secondary big', href: '#/' }, 'Done'))));
}

// ---------------------------------------------------------------------------
// List and detail
// ---------------------------------------------------------------------------
const listFilter = { block: '', season: '', mine: false };

async function viewPlantList() {
  if (guard()) return;
  const nameOf = await ctx.userNames();
  const mineOnly = (c) => String(c.InspectorEmail).toLowerCase() === me().UserEmail.toLowerCase();
  const checks = live(await db.getAll('plantChecks')).filter((c) => isAdmin() || mineOnly(c));
  const pending = new Set((await db.getAll('outbox')).map((o) => o.id));
  const seasons = [...new Set(checks.map((c) => c.Season || L.seasonOf(c.InspectionDate)))].sort().reverse();
  const blocks = [...new Set(checks.map((c) => `${c.Block} - ${c.Variety}`))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const listEl = h('div', { class: 'list' });
  const countEl = h('div', { class: 'muted' });
  const refresh = () => {
    const rows = checks.filter((c) => (!listFilter.block || `${c.Block} - ${c.Variety}` === listFilter.block) &&
      (!listFilter.season || (c.Season || L.seasonOf(c.InspectionDate)) === listFilter.season) &&
      (!listFilter.mine || String(c.InspectorEmail).toLowerCase() === me().UserEmail.toLowerCase()))
      .sort((a, b) => String(b.InspectionDate).localeCompare(String(a.InspectionDate)) || String(b.CreatedAt).localeCompare(String(a.CreatedAt)));
    countEl.textContent = `${rows.length} check${rows.length === 1 ? '' : 's'}`;
    mount(listEl, rows.slice(0, 200).map((c) => h('a', { class: 'sample-card', href: `#/plant/${c.CheckID}` },
      h('div', { class: 'grow' },
        h('div', { class: 'title' }, `${c.Block} - ${c.Variety}`),
        h('div', { class: 'muted small' }, `${fmtDate(c.InspectionDate)} · Row ${c.Row}, Bay ${c.Bay} · ${nameOf(c.InspectorEmail)}`)),
      h('div', { class: 'right' },
        h('span', { class: 'pill role' }, L.STAGE_SHORT[L.stageIndex(c.GrowthStage)] || '—'),
        h('div', { class: 'small' }, c.AvgBineHeightCm !== '' && c.AvgBineHeightCm != null ? `${c.AvgBineHeightCm} cm` : ''),
        pending.has(c.CheckID) ? h('span', { class: 'pill warn' }, 'Not yet uploaded') : null))),
    rows.length ? null : h('p', { class: 'muted center' }, 'No plant checks match.'));
  };
  const sel = (key, label, options) => h('select', { 'aria-label': label, onchange: (e) => { listFilter[key] = e.target.value; refresh(); } },
    h('option', { value: '' }, label), options.map((o) => h('option', { value: o, selected: listFilter[key] === o }, o)));
  mount(ctx.main(),
    h('div', { class: 'page-head' }, h('h1', {}, isAdmin() ? 'Plant Checks' : 'My Plant Checks'), h('a', { class: 'btn primary', href: '#/plant/new' }, '+ New plant check')),
    h('div', { class: 'filters' },
      sel('block', 'All blocks', blocks), sel('season', 'All seasons', seasons),
      isAdmin() ? h('label', { class: 'check-row' }, h('input', { type: 'checkbox', class: 'checkbox', checked: listFilter.mine, onchange: (e) => { listFilter.mine = e.target.checked; refresh(); } }), h('span', {}, 'Only mine')) : null),
    countEl, listEl);
  refresh();
}

async function viewPlantCheck(id) {
  if (guard()) return;
  const c = (await db.getAll('plantChecks')).find((x) => x.CheckID === id);
  if (!c) return ctx.notFound();
  const nameOf = await ctx.userNames();
  const info = (label, value, unit = '') => (value === '' || value === null || value === undefined ? null
    : h('div', { class: 'kv' }, h('span', {}, label), h('strong', {}, `${value}${unit}`)));
  const colourBox = c.LeafColour ? h('span', { class: 'swatch-mini', style: { background: L.LEAF_COLOURS[Number(c.LeafColour) - 1] } }) : null;
  mount(ctx.main(),
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, where(c)), h('div', { class: 'muted' }, `${fmtDate(c.InspectionDate)} ${c.InspectionTime || ''} · ${nameOf(c.InspectorEmail)} · Record ${recordLabel(c)}`)),
      L.canEditPlantCheck(me(), c) ? h('a', { class: 'btn secondary', href: `#/plant/edit/${c.CheckID}` }, 'Edit') : null),
    h('div', { class: 'grid-2' },
      h('section', { class: 'card' }, h('h2', {}, 'Stage and vines'),
        info('Growth stage', c.GrowthStage),
        info('Bines on string', c.BinesTrained, ` / ${L.MAX_BINES_PER_BAY}`),
        info('Average bine height', c.AvgBineHeightCm, ' cm'),
        info('Maximum bine height', c.MaxBineHeightCm, ' cm'),
        info('Internode <1 m', c.InternodeUnder1mCm, ' cm'),
        info('Internode 1–2 m', c.Internode1to2mCm, ' cm'),
        info('Internode 2–3 m', c.Internode2to3mCm, ' cm'),
        info('Average lateral length', c.AvgLateralLengthCm, ' cm'),
        info('Snapped tips (bines / laterals)', (c.SnappedTipsBine !== '' || c.SnappedTipsLateral !== '') ? `${c.SnappedTipsBine || 0} / ${c.SnappedTipsLateral || 0}` : ''),
        info('Overall bine health', c.OverallBineHealth),
        c.LeafColour ? h('div', { class: 'kv' }, h('span', {}, 'Leaf colour'), h('strong', {}, colourBox, ` ${c.LeafColour} of ${L.LEAF_COLOURS.length}`)) : null,
        info('Leaf size', c.LeafSize),
        info('Leaf damage', c.LeafDamage),
        h('div', { class: 'row wrap' }, await ctx.photoView(c.LeafPhoto1), await ctx.photoView(c.LeafPhoto2))),
      h('section', { class: 'card' }, h('h2', {}, 'Block overview'),
        L.BLOCK_OVERVIEW.map((q) => info(q.label, c[q.key])),
        info('Comments', c.Comments),
        h('div', { class: 'row wrap' }, await ctx.photoView(c.OverviewPhoto)))));
}

// ---------------------------------------------------------------------------
// Reports: growth by week per block, stage timeline, CSV for Excel
// ---------------------------------------------------------------------------
const PLANT_MEASURES = [
  { key: 'AvgBineHeightCm', label: 'Average bine height (cm)', short: 'cm average height' },
  { key: 'MaxBineHeightCm', label: 'Maximum bine height (cm)', short: 'cm tallest' },
  { key: 'BinesTrained', label: `Bines on string (of ${L.MAX_BINES_PER_BAY})`, short: 'bines on string' },
  { key: 'InternodeUnder1mCm', label: 'Internode spacing <1 m (cm)', short: 'cm internode' },
  { key: 'AvgLateralLengthCm', label: 'Average lateral length (cm)', short: 'cm laterals' },
  { key: 'LeafColour', label: 'Leaf colour (1–7)', short: 'leaf colour' },
];

async function viewPlantReports() {
  if (guard()) return;
  if (!isAdmin()) { toast('Reports are for admins and owners.', 'bad'); return ctx.go('#/plant-health'); }
  const nameOf = await ctx.userNames();
  const checks = live(await db.getAll('plantChecks'));
  const seasons = [...new Set(checks.map((c) => c.Season || L.seasonOf(c.InspectionDate)))].filter(Boolean).sort().reverse();
  const blocks = (await db.getAll('blocks')).sort((a, b) => L.blockLabel(a).localeCompare(L.blockLabel(b), undefined, { numeric: true }));
  const used = blocks.filter((b) => checks.some((c) => c.BlockVarietyID === b.BlockVarietyID));

  const exportSeason = h('select', { id: 'plantExportSeason' }, h('option', { value: '' }, 'All seasons'), seasons.map((x) => h('option', { value: x }, x)));
  const exportBlock = h('select', {}, h('option', { value: '' }, 'All blocks'), blocks.map((b) => h('option', { value: b.BlockVarietyID }, L.blockLabel(b))));
  const msg = h('p', { class: 'muted small' });
  async function doExport() {
    const filter = { season: exportSeason.value, blockVarietyId: exportBlock.value };
    msg.textContent = 'Preparing…';
    try {
      if (!navigator.onLine) throw new OfflineError('offline');
      const res = await api('export', { type: 'plant', ...filter });
      download(res.filename, res.csv);
      msg.textContent = `Downloaded ${res.rows} plant checks (complete history from the spreadsheet).`;
    } catch (e) {
      if (e instanceof AuthError) { msg.textContent = e.message; return; }
      const pick = checks.filter((c) => (!filter.season || (c.Season || L.seasonOf(c.InspectionDate)) === filter.season) &&
        (!filter.blockVarietyId || c.BlockVarietyID === filter.blockVarietyId));
      download(`hopfarm_plant_checks_tablet_${L.todayLocal()}.csv`, L.toCSV(L.PLANT_EXPORT_HEADERS, L.plantExportRows(pick, nameOf)));
      msg.textContent = `${e instanceof OfflineError ? 'Offline' : `Server error (${e.message})`} — exported the checks stored on this tablet instead.`;
    }
  }

  const trendBlock = h('select', { id: 'plantTrendBlock' }, used.map((b) => h('option', { value: b.BlockVarietyID }, L.blockLabel(b))));
  const trendSeason = h('select', {}, h('option', { value: '' }, 'All seasons'), seasons.map((x) => h('option', { value: x, selected: x === seasons[0] }, x)));
  const chartBox = h('div', {});
  const drawTrend = () => {
    const series = PLANT_MEASURES.map((m) => ({
      m,
      pts: L.plantSeries(checks, trendBlock.value, m.key, trendSeason.value)
        .map((p) => ({ ...p, label: `Row ${p.check.Row} bay ${p.check.Bay}` })),
    })).filter((s) => s.pts.length);
    if (!series.length) { mount(chartBox, h('p', { class: 'muted' }, 'No checks for this block and season on this tablet yet.')); return; }
    mount(chartBox, h('div', { class: 'small-multiples' }, series.map(({ m, pts }) => h('figure', { class: 'chart-card' },
      h('figcaption', {}, m.label), ctx.weekBars(pts, m)))));
  };
  [trendBlock, trendSeason].forEach((el) => el.addEventListener('change', drawTrend));

  const tlSeason = h('select', {}, seasons.map((x) => h('option', { value: x }, x)));
  const tlBox = h('div', { class: 'table-wrap' });
  const drawTimeline = () => {
    const rows = L.stageTimeline(checks, tlSeason.value);
    mount(tlBox, rows.length ? h('table', { class: 'timeline' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Block'), L.STAGE_SHORT.map((s) => h('th', {}, s)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, `${r.block} - ${r.variety}`), r.firstSeen.map((d) => h('td', {}, d ? fmtDate(d).slice(0, 5) : '')))))) :
      h('p', { class: 'muted' }, 'No checks for this season on this tablet yet.'));
  };
  tlSeason.addEventListener('change', drawTimeline);

  // Latest checks: one row per bay check, newest first.
  const tblPeriod = h('select', { id: 'latestPeriod' },
    [['7', 'Last 7 days'], ['14', 'Last 14 days'], ['30', 'Last 30 days'], ['', 'All']].map(([v, t]) => h('option', { value: v, selected: v === '14' }, t)));
  const tblBlock = h('select', { id: 'latestBlock' }, h('option', { value: '' }, 'All blocks'), used.map((b) => h('option', { value: b.BlockVarietyID }, L.blockLabel(b))));
  const tblBox = h('div', { class: 'table-wrap' });
  const MAX_ROWS = 50;
  const drawTable = () => {
    const since = tblPeriod.value ? L.addDays(L.todayLocal(), -(Number(tblPeriod.value) - 1)) : '';
    const all = L.plantTableRows(checks.filter((c) => (!since || String(c.InspectionDate || '') >= since) &&
      (!tblBlock.value || c.BlockVarietyID === tblBlock.value)));
    if (!all.length) { mount(tblBox, h('p', { class: 'muted' }, 'No checks in this period on this tablet.')); return; }
    const rows = all.slice(0, MAX_ROWS);
    mount(tblBox,
      h('table', { class: 'latest-checks', id: 'latestChecks' },
        h('thead', {}, h('tr', {}, ['Date', 'Block', 'Variety', 'Bine health', 'Coir', 'Weeds', 'Bines on string', 'Avg height (cm)', 'Max height (cm)',
          'Internode (cm)', 'Avg lateral (cm)', 'Snapped bine', 'Snapped lateral', 'Leaf damage', 'Photo', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, rows.map((r) => {
          const c = r.check;
          const num = (v) => h('td', { class: 'num' }, v ?? '');
          return h('tr', {},
            h('td', { class: 'nowrap' }, fmtDate(c.InspectionDate).replace(/\/(\d\d)(\d\d)$/, '/$2')),
            h('td', { class: 'nowrap' }, c.Block || ''),
            h('td', {}, c.Variety || ''),
            h('td', {}, c.BineHealth || ''),
            h('td', {}, c.CoirStatus || ''),
            h('td', {}, c.WeedPressure || ''),
            num(c.BinesTrained),
            num(c.AvgBineHeightCm),
            num(c.MaxBineHeightCm),
            h('td', { class: 'nowrap num' }, r.internode === '' ? '' : `${r.internode}${r.internodeBand ? ` (${r.internodeBand})` : ''}`),
            num(c.AvgLateralLengthCm),
            num(c.SnappedTipsBine),
            num(c.SnappedTipsLateral),
            h('td', { class: 'center' }, r.leafDamage ? h('span', { class: 'flag', title: r.leafDamage, 'aria-label': `Leaf damage: ${r.leafDamage}` }, '⚠') : ''),
            h('td', { class: 'center' }, r.hasPhoto ? h('span', { class: 'tick', 'aria-label': 'Has photo' }, '✓') : ''),
            h('td', {}, h('a', { href: `#/plant/${c.CheckID}`, class: 'open-check' }, 'Open')));
        }))),
      all.length > MAX_ROWS ? h('p', { class: 'muted small', id: 'latestCapped' },
        `Showing the latest ${MAX_ROWS} of ${all.length} checks. Choose a shorter period or one block to narrow it down, or download the CSV for everything.`) : null);
  };
  [tblPeriod, tblBlock].forEach((el) => el.addEventListener('change', drawTable));

  mount(ctx.main(),
    h('div', { class: 'page-head' }, h('h1', {}, 'Plant Health Reports')),
    checks.length ? h('section', { class: 'card' },
      h('h2', {}, 'Latest checks'),
      h('p', { class: 'muted small' }, 'Newest first, up to 50. Internode is the highest band measured. ⚠ = leaf damage recorded. Tap Open to see the whole check.'),
      h('div', { class: 'row wrap' }, tblPeriod, tblBlock), tblBox) : null,
    h('section', { class: 'card' },
      h('h2', {}, 'Download for Excel'),
      h('p', { class: 'muted' }, 'One row per bay check, with a WeekStarting column for weekly PivotTables.'),
      h('div', { class: 'row wrap' }, exportSeason, exportBlock),
      h('button', { class: 'btn primary', type: 'button', id: 'exportPlant', onclick: doExport }, '⬇ Plant checks CSV'),
      msg),
    h('section', { class: 'card' },
      h('h2', {}, 'Growth week by week'),
      h('p', { class: 'muted small' }, 'Each bar is one check of the chosen block. Tap a bar to see its value.'),
      used.length ? h('div', {}, h('div', { class: 'row wrap' }, trendBlock, trendSeason), chartBox) : h('p', { class: 'muted' }, 'No plant checks yet.')),
    seasons.length ? h('section', { class: 'card' },
      h('h2', {}, 'When each stage was first recorded'),
      h('div', { class: 'row' }, tlSeason), tlBox) : null);
  if (used.length) drawTrend();
  if (checks.length) drawTable();
  if (seasons.length) drawTimeline();
}

async function showPlantHelp() {
  const extra = await db.getAll('help');
  contentDialog('Plant Health help', helpSection(PLANT_HELP.concat(sheetHelp(extra, 'Plant Health'))));
}
