# Hop Farm Application — Nelson Lakes Hops

Mite monitoring (field sample collection → office leaf analysis → reporting),
with plant health monitoring planned for later.

> **Status:** early groundwork. The platform is still being decided: the
> original spec named Google AppSheet, but an offline-first web app is being
> considered instead. The AppSheet-specific files are marked below; the rest is
> independent of the platform.

| Path | What | Platform-specific? |
|---|---|---|
| `docs/data-model.md` | Tables, status flow, future plant-health model | No |
| `docs/decisions.md` | Open client questions (§23) and the defaults used | Mostly no |
| `tools/leaf_target.py` | Leaf target: `MAX(50, FLOOR(AreaHa×10/5)×5)` | No |
| `tools/flatten_export.py` | One-row-per-leaf export plus per-sample summary from CSVs | No |
| `templates/*.csv` | Table headers and example reference data | No |
| `apps-script/Setup.gs` | Google Sheets backend setup, exports, data-quality report | Google Sheets |
| `docs/appsheet-build-guide.md` | Full AppSheet configuration | **AppSheet** |

## Tests

```bash
python3 -m unittest discover -s tests -t .
node tests/gs_smoke.js
```
