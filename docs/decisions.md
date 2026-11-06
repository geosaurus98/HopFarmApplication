# Design Decisions and Open Questions

## Platform

| Decision | Reason |
|---|---|
| **Offline-first web app** (installable on tablets, no app store) instead of AppSheet | The client does not use AppSheet. A web app runs on any tablet, laptop or desktop, works fully offline, and is all code, so it can be tested automatically and kept in version control. |
| **Google Sheets as the database**, with Google Apps Script as the API | Free, familiar, and the data stays readable, filterable and downloadable as a normal spreadsheet. Suits the expected volume of tens of thousands of leaf rows per season. If it outgrows Sheets, only `apps-script/` needs replacing, for example with Supabase. |
| No build tools or frameworks | Plain HTML, CSS and JS modules. Anyone can host the `app/` folder, and nothing goes stale. |
| Sign-in by **username** (or email) + per-person access code, checked against the Users tab. Email stays the internal link between records, so usernames and names can be changed freely. | Google sign-in cannot be used from a separately hosted app talking to Apps Script without extra Google Cloud setup. Codes are simple to issue and revoke. |
| Edits are sent as **field-level patches** | Two people changing different fields of the same sample never overwrite each other. |
| Device keeps everything it needs in IndexedDB; changes are queued in the same transaction as the save | A record cannot be saved without also being queued for upload, so nothing is lost if the app is closed or the tablet restarts (§5.5). |
| The server recomputes block snapshot, leaf target and season | The sheet is always right even if a device has an old block list. |
| Leaves for samples older than about 13 months are not cached on devices | Keeps tablets fast as seasons accumulate. They download on demand when a sample is opened online. Full history is always in the Sheet and the CSV exports. |

## Open client questions (spec §23)

The defaults below are built in. Each can be changed in a few lines.

| # | Question | Default implemented | To change |
|---|---|---|---|
| D1 | Do count fields default to 0 or stay empty? | **Empty, and every count is required**, so a blank can never be mistaken for zero. The **Blanks → 0** button fills the remaining empty counts with one tap. | Pre-fill `0` in `viewLeaf` (`app/js/app.js`). |
| D2 | Duplicate sample-number policy | **Warning only**: same bag number, same season, ignoring cancelled samples. Also listed in the data-quality report. | Turn the warning into an error in `viewSampleForm`. |
| D3 | Can bag numbers be reused across seasons? | **Yes.** Each sample has its own hidden unique ID, and the season distinguishes reused bag numbers. | — |
| D4 | Number of photos | **2 per sample, 1 per leaf**, resized to at most 1600 px before upload. | Add `SamplePhoto3` (sheet column + form). |
| D5 | Editing completed records | **Administrators only.** Every change to a completed sample or its leaves is written to **AuditLog** with before → after values. Admins can also **Reopen analysis**. | `can()` in `app/js/logic.js` plus `authorizeSample_` / `authorizeLeaf_` in `Api.gs`. |
| D6 | Early completion: mandatory reason or warning? | **Warning plus an optional reason** (the client said it must not block completion). Shown in exports and the data-quality report. | Make the reason required in `viewComplete`. |
| D7 | Order of count fields | Spec §6.4 order: TwoSM, PP, TwoSM eggs, predator eggs, other beneficials. | Reorder `COUNT_FIELDS` in `logic.js`. |
| D8 | Beneficial organism categories | Ladybird (Stethorus), Ladybird (other), Lacewing, Predatory thrips, Predatory midge, Spider, Other (free text). | `BENEFICIAL_TYPES` in `logic.js`. |
| D9 | Export formats | CSV (opens in Excel) from the app; Excel or CSV from the Sheet; Python script for CSV downloads. | — |
| D10 | Plant health methodology | Not built. Proposed model in `data-model.md` §6. | — |

## Other choices

| Topic | Decision |
|---|---|
| Season | 1 July – 30 June, labelled `2026/27` (the NZ hop season spans New Year). |
| Unusually high count | A confirmation is asked above 100 for any count. The value is never blocked (§6.5). |
| Managing administrators | Admins can add users (including new admins) and edit Collectors and Analysts. Other admins are view-only, so one admin can't lock out or take over another. An admin can change their own name, username and code, but not their own role or access. Changes to admins are made by the spreadsheet owner in the Users tab. |
| Leaf deletion | Allowed while analysis is in progress (and for admins). The row is kept in the sheet with `Deleted = TRUE` and left out of all results. Remaining leaves keep their numbers. |
| Draft status | In the status list for completeness, but not used. Saving a sample makes it *Awaiting Analysis* (§5.6). |
| Two devices entering the same leaf number offline | Both rows are kept (no observation is lost) and the data-quality report flags the duplicate. |
| Extra columns beyond the spec | `Users.Username`, `Users.FullName` (instead of `UserName`), `Users.AccessCode`, `Samples.Season`, `Samples.AnalysisStartedBy`, `LastModifiedBy` (Samples, LeafAnalysis), `LeafAnalysis.Deleted`, plus the tabs `AuditLog` and `HelpReference`. |
