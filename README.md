# Hop Farm Application — Nelson Lakes Hops

Mite monitoring for the hop garden: **record sample bags in the field (offline)
→ analyse leaves in the office → export to Excel for trends.**

- **App**: an offline-first web app that installs on a tablet like a normal app.
  Everything saved works with no signal and uploads automatically later.
- **Database**: a Google Sheet you can open, filter and download at any time.
  Photos go to Google Drive.
- **Exports**: CSV files (one row per leaf, or one row per sample with totals and
  averages) that open directly in Excel.

👉 **To set it up, follow [docs/setup-guide.md](docs/setup-guide.md)** (about 30 minutes, no coding).

## What it does

| Spec | Feature |
|---|---|
| §5 Field collection | Bag number, block + variety dropdown, date and collector filled in automatically, live **leaves-to-collect** target (`MAX(50, FLOOR(area×10/5)×5)`), comments, 2 photos, duplicate-bag warning. Works fully offline. |
| §6 Office analysis | **Start / Resume at leaf N**, automatic leaf numbering, five large count fields with +/− buttons, **Save & next leaf**, Enter-to-advance, **Blanks → 0**, high-count check, beneficial type, leaf comment and photo. |
| §7 Progress & completion | Analysed / target / remaining / %, completion below target with a warning and reason, over-target allowed, explicit **Complete analysis**. |
| §8 Statuses | Awaiting Analysis → Analysis In Progress → Analysis Complete, plus Cancelled; changed only by buttons and enforced by the server. |
| §11 Search | Search and filter by bag number, block, variety, collector, date, status and season. |
| §12 Reports | Leaf-level and sample-summary CSV, trend chart per block, block comparison table, plus the same exports and a data-quality report from the Sheet's **Hop Farm** menu. |
| §13 Roles | Collector, Analyst, Administrator; checked in the app and again on the server. |
| §14 Data quality | Validation on device and server, audit log for changes to completed samples, data-quality report (missing fields, duplicates, orphans, high counts, stale analyses, completed with no leaves). |

## Repository

| Path | Contents |
|---|---|
| `app/` | The web app (static files, no build step). Host this folder. |
| `app/js/logic.js` | Calculations and rules (leaf target, season, progress, validation, exports, permissions) |
| `app/js/db.js`, `app/js/sync.js` | On-device storage (IndexedDB) and the upload/download queue |
| `apps-script/` | Google Sheets backend: `Setup.gs` (tabs, menu, reports) and `Api.gs` (the web API) |
| `templates/` | CSV headers and example data for each tab |
| `tools/` | Python: leaf-target calculator and a CSV → one-row-per-leaf/summary converter |
| `docs/` | [Setup guide](docs/setup-guide.md), [data model](docs/data-model.md), [decisions and open questions](docs/decisions.md) |
| `tests/` | Unit, backend and end-to-end browser tests |

## Development

Requires Node 18+ (and Python 3 for the Python tools). There are no dependencies
to install. The end-to-end test uses Playwright, if it's available.

```bash
npm test               # logic + backend + end-to-end browser test
npm run test:unit      # logic + backend only (fast)
python3 -m unittest discover -s tests -t .
npm start              # local server at http://localhost:8080
```

`npm start` runs the real Apps Script code against an in-memory spreadsheet.
Sign in with server address `/api` and one of these test accounts
(username / code): `cole` / `222222` (Collector), `lee` / `333333` (Analyst),
`ana` / `111111` (Administrator).

When you change files in `app/`, bump `CACHE` in `app/sw.js` and `APP_VERSION`
in `app/js/config.js` so installed tablets pick up the new version.
