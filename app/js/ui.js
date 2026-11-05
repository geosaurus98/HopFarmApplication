// Small DOM helpers. Text is always set with textContent, never innerHTML,
// so data typed by users can never inject markup.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function mount(root, ...children) {
  root.replaceChildren();
  append(root, children);
}

let toastTimer;
export function toast(message, kind = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

/** Promise-based confirm dialog with large buttons. Resolves true/false. */
export function confirmDialog(title, message, { ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog' },
      h('h2', {}, title),
      message ? h('p', {}, message) : null,
      h('div', { class: 'row end' },
        h('button', { class: 'btn secondary', type: 'button', onclick: () => close(false) }, cancel),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', onclick: () => close(true) }, ok)));
    function close(v) { dlg.close(); dlg.remove(); resolve(v); }
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(false); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export const fmtDate = (iso) => {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

export const fmtDateTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-NZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const fmtAgo = (iso) => {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return fmtDateTime(iso);
};

export const pct = (x) => `${(Math.round(x * 1000) / 10).toFixed(1)}%`;

export function download(filename, text, type = 'text/csv;charset=utf-8') {
  // A BOM makes Excel open UTF-8 CSV files with the right characters.
  const blob = new Blob(['﻿', text], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function field(label, control, { error, hint, id } = {}) {
  return h('div', { class: `field${error ? ' has-error' : ''}` },
    h('label', { for: id || control.id }, label),
    control,
    hint ? h('div', { class: 'hint' }, hint) : null,
    h('div', { class: 'error', 'data-error-for': id || control.id }, error || ''));
}

export function statusPill(status) {
  const cls = {
    'Awaiting Analysis': 'awaiting', 'Analysis In Progress': 'progress', 'Analysis Complete': 'complete',
    Cancelled: 'cancelled', Draft: 'draft',
  }[status] || '';
  return h('span', { class: `pill ${cls}` }, status);
}

export function progressBar(p) {
  return h('div', { class: `progress-track${p.reached ? ' reached' : ''}`, role: 'progressbar', 'aria-valuenow': Math.round(p.pct * 100) },
    h('div', { class: 'bar', style: { width: `${Math.min(100, p.pct * 100)}%` } }));
}
