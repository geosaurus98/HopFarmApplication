# Plan: Spray Diary (Property Inputs Diary)

Status: **draft for discussion with Jason**. Nothing is built yet.

## 1. What the farm uses now

The Excel workbook *2026-27 Property Inputs Diary* (draft) has:

| Sheet | What it holds |
|---|---|
| **Diary** | The record: **one row per product per block per application**. 484 rows from 2 Apr to 26 Nov 2026. Columns: Status, Date, Time, Block, Product, Supplier, Applicator 1 & 2, Sprayer, Comments. The rest are worked out by formula: nozzles, water rate/ha, swath, canopy area, sprayed area, rate per 100 L, rate per ha, amount of product used, active ingredient, chemical group, variety, and N, P, K, S, Ca, Mg applied. |
| **Products** | 163 products in 5 groups (herbicides/pesticides/fungicides, adjuvants, fertigation, foliar fertiliser, solid fertiliser). For each: form, label rates, water rate, nozzle, active ingredient, chemical group, type, cost, reason for use, last application date (Europe and NZ), NZ withholding period, protective clothing, unit, and nutrients per application. |
| **Data** | Lookup lists: 65 blocks with area, rows, row metres, plants and variety; 33 pieces of equipment with gear, pressure, speed, nozzle, water rate and swath; 19 applicators (staff and contractors); 14 suppliers; time slots; weather choices; safety instructions; statuses. |
| **Job Sheet 1–6** | Printable job sheets. The office plans a job by giving diary rows the status *"Job N - Prod. M"*. The sheet then lists the blocks with area, time and water needed, the equipment settings, and the tank mix (per ha, per 100 L and per 2000 L tank) with safety equipment. It has tick boxes per block, circles for weather (temperature, wind, wind direction, rain) and the applicator's signature. |
| **NPK / Pivot** | Totals of N, P, K, S, Ca and Mg per block against target levels (e.g. N 185). |

**How it's used today:** the office plans jobs in Excel and prints job sheets.
Applicators do the work, tick the blocks and circle the weather on paper. The
office then marks the rows *Complete*.

The diary already covers more than sprays: herbicides, miticides, adjuvants,
solid, foliar and fertigation fertiliser, and **predator releases** (products
starting "Pred", equipment "Predators on Leaf"). So it also covers two other
items on the roadmap: the predator release log and fertiliser applications.

## 2. What the app would add

- **Recorded at the time, on the tablet:** blocks ticked off as they're done,
  with the real time, weather and who did it. No retyping from paper.
- **Next to the mite counts:** sprays and predator releases shown as markers on
  each block's mite trend chart. This answers *did the miticide work, and did it
  knock back the predators?* and *did PP numbers rise after a release?*
- **Checks in Needs Attention:**
  - a product applied within its NZ withholding period before harvest;
  - a product used after its last allowed date (NZ or Europe);
  - the same chemical group used too many times in a row (resistance);
  - nutrients per block running over target.
- **The same columns as the Excel Diary** in the export, so the existing pivots,
  NPK totals and reports keep working.

## 3. Proposed design

A new **Spray Diary** section on the home screen, for people given that section
(like Mite Monitoring and Plant Health).

**Its own Google Sheet, "Spray Diary"**, linked like Plant Health:

| Tab | Contents |
|---|---|
| `Applications` | The diary: one row per product per block, same columns as today, with the worked-out values stored (not formulas) so they can't change if a product's details are edited later. |
| `Jobs` | Planned jobs: date, blocks, equipment, applicators, products and status (Planned / In progress / Complete). |
| `Products` | Imported from the Excel Products sheet; maintained by admins. |
| `Equipment` | Imported from the Excel Data sheet (settings, nozzle, water rate, swath). |
| `Applicators` | Staff and contractors, with GrowSafe certificate number and expiry. Staff can be linked to their app user. |
| `Areas` | Non-hop areas such as fencelines, building surrounds, easements and other crops, with area, alongside the hop blocks already in the app. |

**The calculations from Excel move into the app**, worked out on the tablet so
they also work offline:
- sprayed area = block area × swath ÷ 2.7 (swath above 2.7 m counts as 2.7);
- rate per 100 L and rate per ha;
- product needed per block and per tank;
- water needed;
- nutrients applied.

Each has a unit test checked against the Excel workbook, row by row.

### Screens

1. **Jobs (office):** plan a job by choosing date, blocks, equipment, products
   and applicators. The app shows the tank mix, water needed per block and the
   safety equipment, like the job sheet. It can still be **printed** for jobs
   done on paper or by contractors.
2. **Today's jobs (tablet, in the field):** open a job, see the mix, settings
   and safety. Tick each block when done (the time is recorded), tap the weather
   choices, and sign off by name. Works offline; uploads later.
3. **Record an application:** for work done without a planned job, such as a
   contractor's spreading or a one-off spot spray. Entered after the event in
   the office.
4. **Diary:** list and search by date, block, product or chemical group;
   corrections are logged in AuditLog.
5. **Reports:**
   - mite trend charts with spray and release markers;
   - nutrients per block against targets;
   - product use and cost per block;
   - CSV export with the Excel Diary columns.

## 4. Suggested order

| Phase | What | Value |
|---|---|---|
| **1** | Spray Diary sheet and lists (import Products, Equipment, Applicators, Areas from the Excel). *Record an application* and *Diary* screens. Calculations. CSV export. | Replaces typing into Excel; the data is in one place with the mite data. |
| **2** | Markers on the mite trend charts; spray/release history on each block. | The main reason to link it to the mite data. |
| **3** | Jobs: plan in the office, complete on the tablet with weather and sign-off; printable job sheet. | Replaces paper job sheets and the retyping. |
| **4** | Compliance checks in Needs Attention (withholding, last application dates, chemical group rotation, nutrient targets); cost per block. | Catches problems before an audit or a buyer does. |

Each phase is built and tried on the TEST app first, as before.

This season's 484 existing rows can be **imported** once, so the history isn't
split between Excel and the app.

## 5. Questions for Jason

1. **Who records what?** Should applicators complete jobs on the tablet in the
   field, or does the office keep entering everything? Contractors (spreading,
   aerial, contract spraying) would stay office-entered. Is that right?
2. **Paper job sheets:** keep printing them, or move to the tablet, or both for
   a while?
3. **Compliance:**
   - Which programme or buyer requirements does the diary need to meet (e.g. NZ
     Hops, GAP, European export)?
   - Are there fields they require that the current diary doesn't have, e.g.
     wind speed, GrowSafe certificate number (the Data sheet has an empty
     *Growsafe* column), or a re-entry period?
4. **Withholding:** to check withholding periods, the app needs each block's
   expected harvest date. Can that be added per block each season?
5. **Blocks:** the diary has 65 block names, including old or season-specific
   ones (e.g. *L2 - Ca (25)* / *(26)*, *M1 - ??*) and non-hop areas. Which are
   current, and how should they match the app's block list?
6. **Cost:** is cost per block wanted? The Products sheet has a Cost column,
   but it's mostly blank.
7. **Weather:** keep tapping the same choices as the paper sheet, or also pull
   readings from a weather station?
8. **Nutrient targets:** are the targets on the NPK sheet (e.g. N 185) the
   same for every block, or per block or variety?

## 6. Hosting note

Building and testing on the `develop` branch should not use Netlify credits
(check this on the Netlify usage page). Releasing to the workers' app needs a production deploy, so plan the
release together with the hosting decision (stay on Netlify, or move to
Cloudflare Pages).
