# Design Decisions and Open Questions

Spec §23 lists details still to be confirmed with Nelson Lakes Hops. The build
ships with the default below for each; every default can be changed in a few
minutes without touching data. **Confirmed client requirements take precedence.**

| # | Question (§23) | Default implemented | How to change |
|---|---|---|---|
| D1 | Do count fields default to 0 or stay empty? | **Empty and required.** A leaf cannot be saved until all five counts are entered, so `0` always means "checked, none found" (§6.5). | For speed, set *Initial value* `0` on the five count columns. Trade-off: an unchecked field would then be saved as 0. |
| D2 | Duplicate sample-number policy | **Warning only**, scoped to the same season and ignoring cancelled samples. The data-quality report also lists duplicates. | To block: add to `SampleNumber` Valid_If `AND([_THIS] > 0, COUNT(SELECT(Samples[SampleID], AND([SampleNumber] = [_THISROW].[SampleNumber], [Season] = [_THISROW].[Season], [SampleID] <> [_THISROW].[SampleID], [Status] <> "Cancelled"))) = 0)`. |
| D3 | Can bag numbers be reused across seasons? | **Yes.** `SampleID` (UNIQUEID) is the real key; `Season` distinguishes reused bag numbers. | Remove the `[Season] = …` term from D2 to forbid reuse ever. |
| D4 | Number of photos | **2 per sample, 1 per leaf.** | Add `SamplePhoto3` etc., or introduce a `Photos` child table (`PhotoID, ParentTable, ParentID, Photo, Caption`) for unlimited photos. |
| D5 | Editing completed records | **Administrators only**, via the system *Edit* action condition; changes recorded in `UpdatedAt`, `LastModifiedBy` and the `AuditLog` bots. *Reopen Analysis* (admin) allows adding leaves. | Widen the *Edit* conditions in build guide §4. |
| D6 | Early completion: mandatory reason or warning? | **Warning + optional reason** (client: "must not impose an absolute barrier"). Below-target completions are flagged in the data-quality report. | Set `EarlyCompletionReason` Required_If `[LeavesAnalysed] < [TargetLeafCount]`. |
| D7 | Order of count fields | Spec §6.4 order: TwoSM, PP, TwoSM eggs, predator eggs, other beneficials. | Reorder the LeafAnalysis form columns. |
| D8 | Beneficial organism categories | Ladybird (Stethorus), Ladybird (other), Lacewing, Predatory thrips, Predatory midge, Spider, Other — free text also allowed. | Edit the Enum values on `OtherBeneficialDescription`. |
| D9 | Export formats | CSV from the app; Excel/CSV from the spreadsheet; Python script. | — |
| D10 | Plant health methodology | Not built. Proposed data model in `data-model.md` §5. | — |

## Other choices made during the build

| Topic | Decision | Reason |
|---|---|---|
| Season | 1 July – 30 June, labelled `2026/27`. | New Zealand hop growing season spans the calendar year end. |
| Snapshot of block data | Block, variety, area and target are copied onto the sample and frozen once analysis starts. | Historical records must not change when reference data changes (§5.3, §11). |
| Draft status | Present in the status list but not used by the standard flow — saving a sample makes it *Awaiting Analysis* (§5.6). | AppSheet forms save atomically; a half-filled form is simply not saved. |
| High counts | Warning above 100 per field, never blocked. | §6.5: valid observations must not be discarded. |
| Extra columns vs spec | `Samples.Season`, `Samples.AnalysisStartedBy`, `LastModifiedBy` on Samples and LeafAnalysis; tables `AuditLog`, `HelpReference`, `HomeMenu`. | Season filtering (§11), responsible analyst (§6.3), traceability (§14), help screen (§9.7), role-based home screen (§9.1). |
| Leaf counting UI | AppSheet Number inputs with step buttons. | Native, works offline, numeric keypad on tablets. |
