// Runs apps-script/*.gs in Node against an in-memory spreadsheet.
// Implements only the Apps Script APIs the project uses.
const fs = require('fs');
const path = require('path');

function makeSheet(name) {
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
      };
      return range;
    },
    setFrozenRows: () => {}, clearContents: () => { data.length = 0; }, activate: () => {},
  };
  return sh;
}

function createGas({ tz = 'Pacific/Auckland', user = 'owner@farm.nz' } = {}) {
  const sheets = {};
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n)),
    getSheets: () => Object.values(sheets),
    deleteSheet: (s) => delete sheets[s.name],
    toast: (msg) => { ss.lastToast = msg; },
    getSpreadsheetTimeZone: () => tz,
  };
  sheets.Sheet1 = makeSheet('Sheet1');
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
    SpreadsheetApp: { getActive: () => ss, newDataValidation: () => builder, getUi: () => ({}) },
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
  const exportsList = ['setupHopFarmWorkbook', 'buildLeafExport', 'buildSampleSummary', 'buildDataQualityReport',
    'doGet', 'doPost', 'requiredLeaves', 'seasonOf', 'weekStarting', 'SCHEMA', 'REPORT_TABS', 'LEAF_EXPORT_HEADERS', 'SUMMARY_HEADERS'];
  const gs = new Function(...Object.keys(globals), `${src}\n;return {${exportsList.join(',')}};`)(...Object.values(globals));

  const table = (name) => {
    const d = sheets[name].data;
    const headers = d[0];
    return d.slice(1).filter((r) => r && r.some((v) => v !== '' && v != null))
      .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] === undefined ? '' : r[i]]).filter(([h]) => h !== undefined && h !== '' && !String(h).startsWith('Generated'))));
  };
  const addRow = (name, obj) => { const h = sheets[name].data[0]; sheets[name].data.push(h.map((k) => (k in obj ? obj[k] : ''))); };
  const post = (body) => JSON.parse(gs.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());

  return { gs, ss, sheets, table, addRow, post, files };
}

/** A workbook with the standard test users and example blocks. */
function createSeededGas(opts) {
  const g = createGas(opts);
  g.gs.setupHopFarmWorkbook();
  g.sheets.Users.data.length = 1; // replace the auto-created admin with known users
  const now = new Date();
  [['admin@farm.nz', 'ana', 'Ana Admin', 'Administrator', '111111'], ['col@farm.nz', 'cole', 'Cole Collector', 'Collector', '222222'],
    ['lab@farm.nz', 'lee', 'Lee Analyst', 'Analyst', '333333'], ['gone@farm.nz', 'old', 'Old Staff', 'Analyst', '444444', false]]
    .forEach(([e, u, n, r, c, active = true]) => g.addRow('Users', { UserEmail: e, Username: u, FullName: n, Role: r, Active: active, AccessCode: c, CreatedAt: now, UpdatedAt: now }));
  return g;
}

module.exports = { createGas, createSeededGas };
