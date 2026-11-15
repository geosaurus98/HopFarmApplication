// Runs apps-script/*.gs in Node against an in-memory spreadsheet.
// Implements only the Apps Script APIs the project uses.
const fs = require('fs');
const path = require('path');

function makeSheet(name, book) {
  const data = [];
  const rangeOps = { setFontWeight: () => rangeOps, setBackground: () => rangeOps };
  const sh = {
    name, data,
    getName: () => name,
    getLastRow: () => { for (let r = data.length; r > 0; r--) if ((data[r - 1] || []).some((v) => v !== '' && v != null)) return r; return 0; },
    getLastColumn: () => data.reduce((m, r) => { let c = (r || []).length; while (c > 0 && (r[c - 1] === '' || r[c - 1] == null)) c--; return Math.max(m, c); }, 0),
    getMaxRows: () => Math.max(1000, data.length),
    getRange: (r, c, nr = 1, nc = 1) => {
      const range = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
          const v = (data[r - 1 + i] || [])[c - 1 + j];
          return v === undefined || v === null ? '' : v;
        })),
        setValues: (vals) => {
          if (vals.length !== nr || vals.some((row) => row.length !== nc)) throw new Error(`setValues size mismatch on ${name}`);
          vals.forEach((row, i) => row.forEach((v, j) => { (data[r - 1 + i] = data[r - 1 + i] || [])[c - 1 + j] = v; }));
          return range;
        },
        setValue: (v) => { (data[r - 1] = data[r - 1] || [])[c - 1] = v; return range; },
        setFontWeight: () => range, setBackground: () => range, setNumberFormat: () => range, setDataValidation: () => range,
        clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (data[r - 1 + i]) data[r - 1 + i][c - 1 + j] = ''; return range; },
      };
      return range;
    },
    setFrozenRows: () => {}, clearContents: () => { data.length = 0; }, activate: () => {},
    hidden: false,
    hideSheet: () => { sh.hidden = true; return sh; },
    isSheetHidden: () => sh.hidden,
    setName: (n) => { if (book) { delete book.sheets[sh.name]; book.sheets[n] = sh; } sh.name = n; return sh; },
  };
  return sh;
}

/** An in-memory spreadsheet ("book"). */
function makeBook(id, tz) {
  const book = {
    id,
    sheets: {},
    getId: () => id,
    getSheetByName: (n) => book.sheets[n] || null,
    insertSheet: (n) => (book.sheets[n] = makeSheet(n, book)),
    getSheets: () => Object.values(book.sheets),
    deleteSheet: (s) => delete book.sheets[s.name],
    toast: (msg) => { book.lastToast = msg; },
    getSpreadsheetTimeZone: () => tz,
  };
  book.sheets.Sheet1 = makeSheet('Sheet1', book);
  return book;
}

function createGas({ tz = 'Pacific/Auckland', user = 'owner@farm.nz' } = {}) {
  const books = {};
  const newBook = (id) => (books[id] = makeBook(id, tz));
  const ss = newBook('MITE_SHEET_ID_0000000000000000');
  const sheets = ss.sheets;
  const builder = new Proxy({}, { get: (t, k) => (k === 'build' ? () => ({}) : () => builder) });

  const files = [];
  const makeFolder = (fname) => {
    const folder = {
      name: fname, children: [], files: [],
      getId: () => `folder-${fname}`,
      getFoldersByName: (n) => iter(folder.children.filter((f) => f.name === n)),
      createFolder: (n) => { const f = makeFolder(n); folder.children.push(f); return f; },
      getFilesByName: (n) => iter(folder.files.filter((f) => f.name === n)),
      createFile: (blob) => {
        const f = { name: blob.name, bytes: blob.bytes, type: blob.type, getUrl: () => `https://drive.example/${blob.name}`, setDescription: () => f };
        folder.files.push(f); files.push(f); return f;
      },
    };
    return folder;
  };
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const root = makeFolder('root');
  const props = {};

  const globals = {
    SpreadsheetApp: {
      getActive: () => ss,
      openById: (id) => { if (!books[id]) throw new Error('Not found'); return books[id]; },
      newDataValidation: () => builder,
      getUi: () => ({}),
    },
    Session: { getActiveUser: () => ({ getEmail: () => user }), getScriptTimeZone: () => tz },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; }, getContent() { return this.text; } }),
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    DriveApp: {
      getFoldersByName: (n) => root.getFoldersByName(n),
      createFolder: (n) => root.createFolder(n),
      getFolderById: (id) => { const find = (f) => (f.getId() === id ? f : f.children.map(find).find(Boolean)); const f = find(root); if (!f) throw new Error('no folder'); return f; },
    },
    Utilities: {
      getUuid: () => require('crypto').randomUUID(),
      base64Decode: (b64) => Array.from(Buffer.from(b64, 'base64')),
      newBlob: (bytes, type, name) => ({ bytes, type, name }),
      formatDate: (d, zone, fmt) => {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
          .formatToParts(d).map((p) => [p.type, p.value]));
        const date = `${parts.year}-${parts.month}-${parts.day}`;
        if (fmt === 'yyyy-MM-dd') return date;
        if (fmt === 'yyyy-MM-dd HH:mm:ss') return `${date} ${parts.hour}:${parts.minute}:${parts.second}`;
        throw new Error(`mock formatDate: unsupported format ${fmt}`);
      },
    },
  };

  const dir = path.join(__dirname, '..', '..', 'apps-script');
  const src = ['Setup.gs', 'Api.gs'].map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const exportsList = ['setupHopFarmWorkbook', 'connectSetupSheet_', 'buildLeafExport', 'buildSampleSummary', 'buildDataQualityReport',
    'doGet', 'doPost', 'requiredLeaves', 'seasonOf', 'weekStarting', 'SCHEMA', 'REPORT_TABS', 'LEAF_EXPORT_HEADERS', 'SUMMARY_HEADERS'];
  const gs = new Function(...Object.keys(globals), `${src}\n;return {${exportsList.join(',')}};`)(...Object.values(globals));

  // Tabs are looked up in whichever spreadsheet now holds them.
  const bookOf = (name) => Object.values(books).find((b) => b.sheets[name] && b !== ss && ['Users', 'BlockVarieties', 'HelpReference'].includes(name) && props.SETUP_SHEET_ID === b.id) || ss;
  const table = (name, book) => {
    const d = (book || bookOf(name)).sheets[name].data;
    const headers = d[0];
    return d.slice(1).filter((r) => r && r.some((v) => v !== '' && v != null))
      .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] === undefined ? '' : r[i]]).filter(([h]) => h !== undefined && h !== '' && !String(h).startsWith('Generated'))));
  };
  const addRow = (name, obj, book) => { const t = (book || bookOf(name)).sheets[name]; const h = t.data[0]; t.data.push(h.map((k) => (k in obj ? obj[k] : ''))); };
  const post = (body) => JSON.parse(gs.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());

  return { gs, ss, sheets, books, newBook, bookOf, props, table, addRow, post, files };
}

/**
 * A workbook with the standard test users and the farm's blocks.
 * split: true moves Users, blocks and help into a separate Users & Setup sheet (as deployed).
 */
function createSeededGas(opts = {}) {
  const g = createGas(opts);
  g.gs.setupHopFarmWorkbook();
  g.sheets.Users.data.length = 1; // replace the auto-created admin with known users
  const now = new Date();
  [['admin@farm.nz', 'ana', 'Ana Admin', 'Administrator', '111111'], ['col@farm.nz', 'cole', 'Cole Collector', 'Collector', '222222'],
    ['lab@farm.nz', 'lee', 'Lee Analyst', 'Analyst', '333333'], ['gone@farm.nz', 'old', 'Old Staff', 'Analyst', '444444', false]]
    .forEach(([e, u, n, r, c, active = true]) => g.addRow('Users', { UserEmail: e, Username: u, FullName: n, Role: r, Active: active, AccessCode: c, CreatedAt: now, UpdatedAt: now }));
  if (opts.split) {
    g.setup = g.newBook('SETUP_SHEET_ID_000000000000000');
    g.gs.connectSetupSheet_('https://docs.google.com/spreadsheets/d/SETUP_SHEET_ID_000000000000000/edit');
  }
  return g;
}

module.exports = { createGas, createSeededGas };
