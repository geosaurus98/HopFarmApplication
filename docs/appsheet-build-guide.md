# AppSheet Build Guide — Mite Monitoring (Release 1)

This guide is the step-by-step configuration of the Hop Farm Application in the
AppSheet editor. Every expression below is written to be pasted directly into
the relevant AppSheet field. Section numbers in brackets (e.g. *§6.7*) refer to
the functional specification.

> Conventions
> - `isAdmin` below is shorthand for `ANY(CurrentUser[Role]) = "Administrator"`.
> - `isLab` is shorthand for `IN(ANY(CurrentUser[Role]), {"Analyst", "Administrator"})`.
> - Paste the full expression (not the shorthand) into AppSheet.
> - Column *Display name* is shown in quotes where it differs from the column name.

---

## 0. Prerequisites

1. Create the backend: follow [`apps-script/Setup.gs`](../apps-script/Setup.gs)
   (new Google Sheet → Extensions → Apps Script → paste → run
   `setupHopFarmWorkbook`). This creates the tabs `Users`, `BlockVarieties`,
   `Samples`, `LeafAnalysis`, `AuditLog`, `HelpReference` and `HomeMenu` with the
   exact headers this guide expects.
2. Replace the example rows in `BlockVarieties` with the real block / variety /
   area list. Add every staff member to `Users` with the correct `Role`.
3. In AppSheet: **Create → App → Start with existing data** → choose the sheet.
   Then **Data → Add table** for each of the seven tabs.
   Do **not** add the `Export_*` / `Report_*` tabs — they are generated reports.

> **AppSheet Database instead of Sheets?** The same tables and columns work. Import
> the CSVs in [`templates/`](../templates) to create them. The reporting menu in
> `Setup.gs` is Sheets-only; use [`tools/flatten_export.py`](../tools/flatten_export.py)
> instead.

---

## 1. Tables — update modes and security

**Data → Tables → (table) → Are updates allowed?** — use the expression option.

| Table | Updates allowed (expression) | Security filter |
|---|---|---|
| Users | `IF(ANY(CurrentUser[Role]) = "Administrator", "ALL_CHANGES", "READ_ONLY")` | *(none — small table, names needed for display)* |
| BlockVarieties | `IF(ANY(CurrentUser[Role]) = "Administrator", "ALL_CHANGES", "READ_ONLY")` | *(none)* |
| Samples | `IF(ANY(CurrentUser[Role]) = "Administrator", "ALL_CHANGES", "ADDS_AND_UPDATES")` | `IN(USEREMAIL(), SELECT(Users[UserEmail], [Active]))` |
| LeafAnalysis | `SWITCH(ANY(CurrentUser[Role]), "Administrator", "ALL_CHANGES", "Analyst", "ADDS_AND_UPDATES", "READ_ONLY")` | `IN(USEREMAIL(), SELECT(Users[UserEmail], [Active]))` |
| AuditLog | `ADDS_ONLY` *(rows are written by the audit bots; nobody edits or deletes them)* | `ANY(CurrentUser[Role]) = "Administrator"` |
| HelpReference | `IF(ANY(CurrentUser[Role]) = "Administrator", "ALL_CHANGES", "READ_ONLY")` | *(none)* |
| HomeMenu | `READ_ONLY` | *(none)* |

**Security → Require user signin: ON.** Under **Security → Domain authentication /
Users**, add every staff Google account (or the farm's Workspace domain). The
security filters above additionally hide all sample data from anyone who is not
an *Active* user in the `Users` table, so deactivating a user is one click.

---

## 2. Slices (Data → Slices)

| Slice | Table | Row filter condition | Update mode | Purpose |
|---|---|---|---|---|
| **CurrentUser** | Users | `[UserEmail] = USEREMAIL()` | Read-only | Role look-ups in every expression |
| **ActiveBlockVarieties** | BlockVarieties | `[Active]` | Read-only | Dropdown source |
| **MySamples** | Samples | `AND([CollectorEmail] = USEREMAIL(), [CollectionDate] >= TODAY() - 14)` | Adds & updates | Collector's recent work |
| **AnalysisQueue** | Samples | `IN([Status], {"Awaiting Analysis", "Analysis In Progress"})` | Updates | *Analyse Samples* (§6.2) – excludes Cancelled |
| **InProgressSamples** | Samples | `[Status] = "Analysis In Progress"` | Updates | *Samples In Progress* |
| **CompletedSamples** | Samples | `[Status] = "Analysis Complete"` | Updates | Historical records (§9.6) |
| **CancelledSamples** | Samples | `[Status] = "Cancelled"` | Updates | Admin only |
| **SampleCompletion** | Samples | `TRUE` · **Slice columns:** `SampleLabel, CompletionSummary, BelowTargetWarning, EarlyCompletionReason, AnalysisComments` | Updates | The *Complete Analysis* form (§7.5) |
| **DataQualityIssues** | Samples | see below | Read-only | Admin review (§14) |
| **LeafResults** | LeafAnalysis | `[SampleID].[Status] <> "Cancelled"` | Read-only | One row per leaf for export (§12.1) |
| **MyHomeMenu** | HomeMenu | `IN(ANY(CurrentUser[Role]), SPLIT([Roles], ","))` | Read-only | Role-based home screen |

`DataQualityIssues` row filter:

```
OR(
  ISBLANK([TargetLeafCount]),
  AND([Status] = "Analysis Complete", [LeavesAnalysed] = 0),
  AND([Status] = "Analysis Complete", [ActualLeafCount] <> [LeavesAnalysed]),
  AND([Status] = "Awaiting Analysis", [LeavesAnalysed] > 0),
  AND([Status] = "Analysis In Progress", [AnalysisStartedAt] < NOW() - 7)
)
```

Duplicate bag numbers, orphan leaves, duplicate leaf numbers and unusually high
counts are expensive to compute on a phone; they are covered by the
**Hop Farm → Run data quality report** menu in the spreadsheet instead.

---

## 3. Column configuration

Open **Data → Columns → (table)**. Set the *Type* and the listed properties;
anything not mentioned keeps the AppSheet default. "Hidden" means *Show?* = OFF.

### 3.1 Users

| Column | Type | Settings |
|---|---|---|
| UserEmail | Email | **Key**. Required. |
| UserName | Name | **Label**. Required. |
| Role | Enum (Text) | Values: `Collector`, `Analyst`, `Administrator`. Required. Input mode *Buttons*. |
| Active | Yes/No | Initial value `TRUE`. |
| CreatedAt | DateTime | Initial value `NOW()`. Editable_If `FALSE`. |
| UpdatedAt | ChangeTimestamp | |

### 3.2 BlockVarieties

| Column | Type | Settings |
|---|---|---|
| BlockVarietyID | Text | **Key**. Initial value `UPPER(CONCATENATE([Block], "-", SUBSTITUTE([Variety], " ", "")))`. Editable_If `ISBLANK([_THIS])` *(never change an ID once samples reference it)*. Hidden. |
| Block | Text | Required. |
| Variety | Text | Required. |
| AreaHa | Decimal | Display name "Area (ha)". Decimal digits 2. Required. Valid_If `[_THIS] > 0`, error "Area must be greater than zero hectares." |
| Active | Yes/No | Initial value `TRUE`. *Deactivate instead of deleting — historical samples keep working.* |
| Notes | LongText | |
| UpdatedAt | ChangeTimestamp | |
| **BlockVarietyLabel** *(virtual)* | Text | App formula `CONCATENATE([Block], " - ", [Variety])`. **Set as the table Label** (untick Label on any other column). Produces "A1 - Cascade" in the dropdown (§5.2). |
| **RequiredLeaves** *(virtual)* | Number | Display name "Leaves required". App formula `MAX(LIST(50, FLOOR(([AreaHa] * 10) / 5) * 5))`. |

### 3.3 Samples

Physical columns (in sheet order). The *Form?* column tells you whether the field
should appear on the field-collection form (control with *Show_If*, below).

| Column | Type | Settings | Form? |
|---|---|---|---|
| SampleID | Text | **Key**. Initial value `UNIQUEID()`. Hidden. | – |
| SampleNumber | Number | Display "Bag number". Required. Valid_If `[_THIS] > 0`, error "Enter the number written on the sample bag." Editable_If `OR(IN([Status], {"Draft", "Awaiting Analysis"}), ANY(CurrentUser[Role]) = "Administrator")`. Searchable. | ✔ first |
| CollectionDate | Date | Display "Collection date". Initial value `TODAY()`. Required. Valid_If `AND([_THIS] <= TODAY(), [_THIS] >= TODAY() - 365)` *(admins can still save historical entries: wrap in `OR(isAdmin, …)` if needed)*. | ✔ |
| Season | Text | App formula `IF(MONTH([CollectionDate]) >= 7, CONCATENATE(YEAR([CollectionDate]), "/", RIGHT(TEXT(YEAR([CollectionDate]) + 1), 2)), CONCATENATE(YEAR([CollectionDate]) - 1, "/", RIGHT(TEXT(YEAR([CollectionDate])), 2)))`. Southern-hemisphere season, 1 July – 30 June, e.g. `2026/27`. Searchable. Hidden in form. | – |
| CollectorEmail | Ref → Users | Display "Collector". Initial value `USEREMAIL()`. Required. Editable_If `ANY(CurrentUser[Role]) = "Administrator"`. | ✔ (read-only) |
| BlockVarietyID | Ref → BlockVarieties | Display "Block and variety". Required. Input mode *Dropdown*. Valid_If `SELECT(BlockVarieties[BlockVarietyID], OR([Active], [BlockVarietyID] = [_THISROW].[BlockVarietyID]))` *(only active blocks offered; an old sample whose block was later deactivated still validates)*. Editable_If same as SampleNumber. Searchable. | ✔ |
| Block | Text | Snapshot. Initial value `[BlockVarietyID].[Block]`. Editable_If `FALSE`. Searchable. Show_If `CONTEXT("ViewType") <> "Form"`. | – |
| Variety | Text | Snapshot. Initial value `[BlockVarietyID].[Variety]`. Editable_If `FALSE`. Searchable. Show_If `CONTEXT("ViewType") <> "Form"`. | – |
| AreaHaAtCollection | Decimal | Display "Area at collection (ha)". Snapshot. Initial value `[BlockVarietyID].[AreaHa]`. Editable_If `FALSE`. Show_If `CONTEXT("ViewType") <> "Form"`. | – |
| TargetLeafCount | Number | Display "Target leaves". Snapshot. Initial value `MAX(LIST(50, FLOOR(([BlockVarietyID].[AreaHa] * 10) / 5) * 5))`. Editable_If `FALSE`. Show_If `CONTEXT("ViewType") <> "Form"`. | – |
| SampleComments | LongText | Display "Comments (optional)". | ✔ |
| SamplePhoto1 | Image | Display "Photo 1 (optional)". Image/File folder path `"Photos/Samples"`. | ✔ |
| SamplePhoto2 | Image | Display "Photo 2 (optional)". Same folder. Show_If `ISNOTBLANK([SamplePhoto1])`. | ✔ |
| Status | Enum (Text) | Values `Draft`, `Awaiting Analysis`, `Analysis In Progress`, `Analysis Complete`, `Cancelled`. Initial value `"Awaiting Analysis"`. Editable_If `ANY(CurrentUser[Role]) = "Administrator"`. Show_If `CONTEXT("ViewType") <> "Form"`. Searchable. | – |
| AnalysisStartedAt | DateTime | Editable_If `FALSE`. Hidden in forms. | – |
| AnalysisStartedBy | Ref → Users | Editable_If `FALSE`. Hidden in forms. | – |
| AnalysisCompletedAt | DateTime | Editable_If `FALSE`. Hidden in forms. | – |
| CompletedBy | Ref → Users | Editable_If `FALSE`. Hidden in forms. | – |
| ActualLeafCount | Number | Editable_If `FALSE`. Hidden in forms. | – |
| AnalysisComments | LongText | Display "Analysis comments". Show_If `CONTEXT("View") = "Sample_Complete"` in forms, always in detail. Use `OR(CONTEXT("ViewType") <> "Form", CONTEXT("View") = "Sample_Complete")`. | – |
| EarlyCompletionReason | Enum (Text) | Display "Reason fewer leaves were analysed". Values `Damaged leaves`, `Missing leaves`, `Contamination`, `Insufficient material`, `Other`. **Allow other values: ON.** Show_If `AND([LeavesAnalysed] < [TargetLeafCount], OR(CONTEXT("ViewType") <> "Form", CONTEXT("View") = "Sample_Complete"))`. Required: OFF (see `docs/decisions.md` D6). | – |
| CreatedAt | DateTime | Initial value `NOW()`. Editable_If `FALSE`. Hidden in forms. | – |
| UpdatedAt | ChangeTimestamp | Hidden in forms. | – |
| LastModifiedBy | Email | App formula `USEREMAIL()` *(re-evaluated on every save → records who last changed the row)*. Hidden in forms. | – |

> **Why snapshots?** `Block`, `Variety`, `AreaHaAtCollection` and
> `TargetLeafCount` are stored on the sample so that a later change to a block's
> area or name never rewrites history (§5.3, §11). They are *not* app formulas,
> because app formulas recalculate every time the row is edited. They are set by
> their initial values while the form is open, and re-applied on save by the
> `Snapshot Block Details` action (§4), which is also the safety net if the device
> did not refresh the initial values.

Virtual columns (**Add virtual column**):

| Column | Type | App formula | Notes |
|---|---|---|---|
| **Leaves** | List | `REF_ROWS("LeafAnalysis", "SampleID")` | AppSheet auto-creates `Related LeafAnalysiss`; rename that to `Leaves` instead of adding a second one. Display "Leaf results". Hidden in forms. |
| **LeavesToCollect** | Number | `IF(ISBLANK([BlockVarietyID]), "", MAX(LIST(50, FLOOR(([BlockVarietyID].[AreaHa] * 10) / 5) * 5)))` | Display "**Leaves to collect**". Show_If `CONTEXT("ViewType") = "Form"`. Live on the form as soon as a block is picked (§5.3). |
| **AreaPreview** | Decimal | `[BlockVarietyID].[AreaHa]` | Display "Block area (ha)". Show_If `AND(CONTEXT("ViewType") = "Form", ISNOTBLANK([BlockVarietyID]))`. |
| **DuplicateWarning** | Text | `IF(CONTEXT("ViewType") <> "Form", "", IF(COUNT(SELECT(Samples[SampleID], AND([SampleNumber] = [_THISROW].[SampleNumber], [Season] = [_THISROW].[Season], [SampleID] <> [_THISROW].[SampleID], [Status] <> "Cancelled"))) > 0, "⚠ This bag number has already been used this season. Check the label.", ""))` | Show_If `ISNOTBLANK([_THIS])`. Non-blocking warning (decision D2). |
| **SampleLabel** | Text | `CONCATENATE("Bag ", [SampleNumber], " · ", [Block], " - ", [Variety], " · ", TEXT([CollectionDate], "DD/MM/YYYY"))` | **Set as table Label.** |
| **LeavesAnalysed** | Number | `COUNT([Leaves])` | Display "Leaves analysed" (§7.1). |
| **LeavesRemaining** | Number | `MAX(LIST(0, [TargetLeafCount] - [LeavesAnalysed]))` | Never below zero. |
| **ProgressPct** | Percent | `IF([TargetLeafCount] > 0, DECIMAL([LeavesAnalysed]) / [TargetLeafCount], 0)` | Display "Progress". `DECIMAL()` avoids integer division. Display mode *Progress* bar if offered. |
| **NextLeafNumber** | Number | `IF([LeavesAnalysed] = 0, 1, MAX([Leaves][LeafNumber]) + 1)` | Highest existing + 1 → safe resume (§6.6). |
| **CompletionSummary** | Text | `CONCATENATE([LeavesAnalysed], " of ", [TargetLeafCount], " target leaves analysed")` | |
| **BelowTargetWarning** | Text | `IF([LeavesAnalysed] < [TargetLeafCount], CONCATENATE("⚠ Target not reached — ", [LeavesRemaining], " leaves short. You can still complete; please give a reason."), "")` | Show_If `ISNOTBLANK([_THIS])`. |
| **TotalTwoSM** | Number | `SUM([Leaves][TetranychusCount])` | §12.2 |
| **AvgTwoSMPerLeaf** | Decimal | `IF([LeavesAnalysed] > 0, DECIMAL([TotalTwoSM]) / [LeavesAnalysed], 0)` | |
| **TotalPP** | Number | `SUM([Leaves][PhytoseiulusCount])` | |
| **AvgPPPerLeaf** | Decimal | `IF([LeavesAnalysed] > 0, DECIMAL([TotalPP]) / [LeavesAnalysed], 0)` | |
| **TotalTwoSMEggs** | Number | `SUM([Leaves][TwoSpotEggCount])` | |
| **TotalPredatorEggs** | Number | `SUM([Leaves][PredatorEggCount])` | |
| **TotalOtherBeneficial** | Number | `SUM([Leaves][OtherBeneficialCount])` | |
| **PredatorToPestRatio** | Decimal | `IF([TotalTwoSM] > 0, DECIMAL([TotalPP]) / [TotalTwoSM], "")` | Blank when no pests. |

Mark `SampleNumber`, `CollectionDate`, `Season`, `CollectorEmail`, `BlockVarietyID`,
`Block`, `Variety`, `Status` as **Searchable** (§6.2, §11).

Column **order on the form** (drag in *Data → Columns* or set *Column order* on
the form view): `SampleNumber, BlockVarietyID, LeavesToCollect, AreaPreview,
DuplicateWarning, CollectionDate, CollectorEmail, SampleComments, SamplePhoto1,
SamplePhoto2`.

### 3.4 LeafAnalysis

| Column | Type | Settings |
|---|---|---|
| LeafAnalysisID | Text | **Key**. Initial value `UNIQUEID()`. Hidden. |
| SampleID | Ref → Samples | **Is a part of: ON** (leaves belong to the sample, shown inline). Required. Editable_If `ANY(CurrentUser[Role]) = "Administrator"`. Show_If `CONTEXT("ViewType") <> "Form"` *(the header below identifies the sample instead)*. |
| LeafNumber | Number | Display "Leaf". Initial value `IF(ISBLANK([SampleID]), 1, [SampleID].[NextLeafNumber])`. Required. Editable_If `ANY(CurrentUser[Role]) = "Administrator"`. Valid_If (uniqueness, §6.6): see below. |
| AnalystEmail | Ref → Users | Display "Analyst". Initial value `USEREMAIL()`. Editable_If `ANY(CurrentUser[Role]) = "Administrator"`. Hidden in form. |
| AnalysisDateTime | DateTime | Initial value `NOW()`. Editable_If `FALSE`. Hidden in form. |
| TetranychusCount | Number | Display "**TwoSM** (T. urticae)". Required. Valid_If `[_THIS] >= 0`, error "Counts cannot be negative. Enter 0 if none were seen." See *count settings*. |
| PhytoseiulusCount | Number | Display "**PP** (P. persimilis)". Same settings. |
| TwoSpotEggCount | Number | Display "TwoSM eggs". Same settings. |
| PredatorEggCount | Number | Display "Predator eggs". Same settings. |
| OtherBeneficialCount | Number | Display "Other beneficials". Same settings. |
| OtherBeneficialDescription | Enum (Text) | Display "Type of beneficial". Values `Ladybird (Stethorus)`, `Ladybird (other)`, `Lacewing`, `Predatory thrips`, `Predatory midge`, `Spider`, `Other`. **Allow other values: ON.** Show_If `[OtherBeneficialCount] > 0`. |
| LeafComment | LongText | Display "Comment (optional)". |
| LeafPhoto | Image | Display "Photo (optional)". Folder path `"Photos/Leaves"`. |
| CreatedAt | DateTime | Initial value `NOW()`. Editable_If `FALSE`. Hidden in form. |
| UpdatedAt | ChangeTimestamp | Hidden in form. |
| LastModifiedBy | Email | App formula `USEREMAIL()`. Hidden in form. |

**LeafNumber Valid_If** (unique within the sample, ≥ 1):

```
AND(
  [_THIS] >= 1,
  COUNT(SELECT(LeafAnalysis[LeafAnalysisID],
    AND([SampleID] = [_THISROW].[SampleID],
        [LeafNumber] = [_THISROW].[LeafNumber],
        [LeafAnalysisID] <> [_THISROW].[LeafAnalysisID]))) = 0
)
```
Invalid value error: `"Leaf " & [_THIS] & " already exists for this sample."`

**Count settings (all five counts).** Type *Number* stores whole numbers only.
Required = ON and **no initial value**, so a leaf cannot be saved until every
count has been entered — an explicit `0` therefore always means "looked, none
found" and a blank can never be mistaken for zero (§6.5, decision D1). Set
*Increase/decrease step* = 1 to get the +/– buttons, and leave *Maximum value*
empty so large counts are accepted.

Virtual columns:

| Column | Type | App formula | Notes |
|---|---|---|---|
| **LeafHeader** | Text | `CONCATENATE("Bag ", [SampleID].[SampleNumber], " · ", [SampleID].[Block], " - ", [SampleID].[Variety], "  —  LEAF ", [LeafNumber], " of ", [SampleID].[TargetLeafCount])` | **Table Label.** First column on the form; makes the sample and leaf number prominent (§9.5). |
| **HighCountWarning** | Text | `IF(MAX(LIST([TetranychusCount], [PhytoseiulusCount], [TwoSpotEggCount], [PredatorEggCount], [OtherBeneficialCount])) > 100, "⚠ Unusually high count — please double-check before saving.", "")` | Show_If `ISNOTBLANK([_THIS])`. Non-blocking (§6.5). |
| SampleNumber | Number | `[SampleID].[SampleNumber]` | Export context. Hidden in form. |
| CollectionDate | Date | `[SampleID].[CollectionDate]` | " |
| Season | Text | `[SampleID].[Season]` | " |
| Block | Text | `[SampleID].[Block]` | " |
| Variety | Text | `[SampleID].[Variety]` | " |
| Collector | Text | `[SampleID].[CollectorEmail].[UserName]` | " |
| TargetLeafCount | Number | `[SampleID].[TargetLeafCount]` | " |
| SampleStatus | Text | `[SampleID].[Status]` | " |

**Form column order:** `LeafHeader, TetranychusCount, PhytoseiulusCount,
TwoSpotEggCount, PredatorEggCount, OtherBeneficialCount,
OtherBeneficialDescription, HighCountWarning, LeafComment, LeafPhoto`.
(Order of the counts follows §6.4; change here if the analysts prefer the order
they read the microscope in — decision D7.)

### 3.5 AuditLog, HelpReference, HomeMenu

| Table | Column settings |
|---|---|
| AuditLog | `AuditID` Text, Key, Initial `UNIQUEID()`. `ChangedAt` DateTime. `Summary` LongText. Everything else Text. |
| HelpReference | `HelpID` Key. `Title` Label. `Category` Enum (`Identification`, `How to`). `Description` LongText. `Image` Image (folder `"Photos/Help"`). `SortOrder` Number. |
| HomeMenu | `MenuID` Key. `Title` Label. `IsForm` Yes/No. `SortOrder` Number. |

---

## 4. Actions (Behavior → Actions)

### 4.1 Samples

| Action | Type | Settings | Only if (condition) |
|---|---|---|---|
| **Snapshot Block Details** | Data: set the values of some columns in this row | `Block` = `[BlockVarietyID].[Block]`; `Variety` = `[BlockVarietyID].[Variety]`; `AreaHaAtCollection` = `[BlockVarietyID].[AreaHa]`; `TargetLeafCount` = `MAX(LIST(50, FLOOR(([BlockVarietyID].[AreaHa] * 10) / 5) * 5))`. Display: *hidden* (Do not display). | `IN([Status], {"Draft", "Awaiting Analysis"})` — frozen once analysis starts |
| **Refresh Block Snapshot** | *same set-values as above* | Prominent in detail view, icon *sync*. Confirmation: "Recalculate the area and target from the current block record?" | `ANY(CurrentUser[Role]) = "Administrator"` |
| **Set Analysis Started** | Data: set values | `Status` = `"Analysis In Progress"`; `AnalysisStartedAt` = `NOW()`; `AnalysisStartedBy` = `USEREMAIL()`. Hidden. | `[Status] = "Awaiting Analysis"` |
| **Open Next Leaf Form** | App: go to another view within this app | Target `LINKTOFORM("LeafAnalysis_Form", "SampleID", [SampleID], "LeafNumber", [NextLeafNumber])`. Hidden. | `TRUE` |
| **Start Analysis** | Grouped: execute a sequence of actions | 1. Set Analysis Started → 2. Open Next Leaf Form. Display *Prominent*, icon *play*. | `AND([Status] = "Awaiting Analysis", IN(ANY(CurrentUser[Role]), {"Analyst", "Administrator"}))` |
| **Resume Analysis** | → Open Next Leaf Form *(reference the same target expression)* | Display name `"Resume at leaf " & [NextLeafNumber]`. Prominent. | `AND([Status] = "Analysis In Progress", IN(ANY(CurrentUser[Role]), {"Analyst", "Administrator"}))` |
| **Complete Analysis** | App: go to another view | Target `LINKTOROW([SampleID], "Sample_Complete")`. Prominent, icon *check*. | `AND([Status] = "Analysis In Progress", [LeavesAnalysed] > 0, IN(ANY(CurrentUser[Role]), {"Analyst", "Administrator"}))` |
| **Finalise Completion** | Data: set values | `Status` = `"Analysis Complete"`; `AnalysisCompletedAt` = `NOW()`; `CompletedBy` = `USEREMAIL()`; `ActualLeafCount` = `[LeavesAnalysed]`. Hidden. | `[Status] = "Analysis In Progress"` |
| **Back To Sample** | App: go to another view | `LINKTOROW([SampleID], "Samples_Detail")`. Hidden. | `TRUE` |
| **Finish Completion** | Grouped | 1. Finalise Completion → 2. Back To Sample. Hidden. | `TRUE` |
| **Reopen Analysis** | Data: set values | `Status` = `"Analysis In Progress"`. Confirmation required. | `AND([Status] = "Analysis Complete", ANY(CurrentUser[Role]) = "Administrator")` |
| **Cancel Sample** | Data: set values | `Status` = `"Cancelled"`. Confirmation "Cancel this sample? It will be removed from the analysis queue but kept for records." | `AND(IN([Status], {"Draft", "Awaiting Analysis", "Analysis In Progress"}), OR(ANY(CurrentUser[Role]) = "Administrator", AND([CollectorEmail] = USEREMAIL(), [Status] = "Awaiting Analysis")))` |
| **Restore Sample** | Data: set values | `Status` = `IF([LeavesAnalysed] > 0, "Analysis In Progress", "Awaiting Analysis")`. | `AND([Status] = "Cancelled", ANY(CurrentUser[Role]) = "Administrator")` |

**System actions — tighten "Edit" and "Delete" on Samples:**
- *Edit* → Only if: `OR(ANY(CurrentUser[Role]) = "Administrator", AND(IN([Status], {"Draft", "Awaiting Analysis"}), [CollectorEmail] = USEREMAIL()))`
  — completed samples are editable by administrators only (§7.5, decision D5).
- *Delete* → Only if: `ANY(CurrentUser[Role]) = "Administrator"` (normal practice is *Cancel*, not delete).

### 4.2 LeafAnalysis

| Action | Type | Settings | Only if |
|---|---|---|---|
| **Mark Sample In Progress** | Data: execute an action on a set of rows | Referenced table *Samples*, Referenced rows `LIST([SampleID])`, Referenced action *Set Analysis Started*. Hidden. | `[SampleID].[Status] = "Awaiting Analysis"` |
| **Open Next Leaf** | App: go to another view | `LINKTOFORM("LeafAnalysis_Form", "SampleID", [SampleID], "LeafNumber", MAX(SELECT(LeafAnalysis[LeafNumber], [SampleID] = [_THISROW].[SampleID])) + 1)` Hidden. | `[LeafNumber] = MAX(SELECT(LeafAnalysis[LeafNumber], [SampleID] = [_THISROW].[SampleID]))` — only after saving the *newest* leaf, so correcting an old leaf does not open a new one |
| **Return To Sample** | App: go to another view | `LINKTOROW([SampleID], "Samples_Detail")`. Hidden. | `[LeafNumber] < MAX(SELECT(LeafAnalysis[LeafNumber], [SampleID] = [_THISROW].[SampleID]))` |
| **After Leaf Saved** | Grouped | 1. Mark Sample In Progress → 2. Open Next Leaf → 3. Return To Sample *(each runs only if its own condition holds)*. Hidden. | `TRUE` |

**System *Edit* on LeafAnalysis** → Only if:
`OR(ANY(CurrentUser[Role]) = "Administrator", AND([SampleID].[Status] = "Analysis In Progress", IN(ANY(CurrentUser[Role]), {"Analyst", "Administrator"})))`

**System *Add* on LeafAnalysis** → Only if:
`AND(IN([SampleID].[Status], {"Awaiting Analysis", "Analysis In Progress"}), IN(ANY(CurrentUser[Role]), {"Analyst", "Administrator"}))`
(Admins may need to add to completed samples: *Reopen Analysis* first.)

### 4.3 HomeMenu

| Action | Type | Target | Only if |
|---|---|---|---|
| **Open Menu Item** | App: go to another view | `IF([IsForm], LINKTOFORM([TargetView]), LINKTOVIEW([TargetView]))` | `TRUE` |

### 4.4 How "Save and Next Leaf" works (§6.7)

1. The analyst taps **Start Analysis** (or **Resume at leaf N**). The leaf form
   opens pre-filled with `SampleID` and `LeafNumber = NextLeafNumber`.
2. They type the counts and tap **Save**.
3. The form's *Form Saved* event runs **After Leaf Saved**:
   - the sample is set to *Analysis In Progress* if it was still *Awaiting*;
   - because this is the newest leaf, **Open Next Leaf** opens a fresh form for
     leaf N + 1 — same sample, same analyst, empty counts, no comment, no photo.
4. To stop, the analyst taps **Cancel** on the empty form. Nothing is saved and the
   app returns to the sample, where progress is shown and **Resume at leaf N+1**
   continues later — even after closing the app (§6.8).

All of this runs on the device (no bots), so it also works with poor Wi-Fi.

Rename the form buttons app-wide in **UX → Localize**: *Save* → `Save ✓`,
*Cancel* → `Stop / Cancel`. The leaf form's `LeafHeader` row reminds the analyst
that saving opens the next leaf.

---

## 5. Views (UX → Views)

Use **Brand → Theme: Light**, primary colour a dark green, **Font size: Large**,
and set **Options → Preferred phone/tablet mode: Tablet** with **Landscape** in
mind. Keep the bottom navigation to the four entries marked *Primary*.

| View | Type | Data | Position | Key settings |
|---|---|---|---|---|
| **Home** | Card *(or Gallery)* | MyHomeMenu | Primary (first) | Sort `SortOrder`. Layout: large title + subtitle. Row-selected event → **Open Menu Item**. This is the home screen (§9.1) and shows only items allowed for the user's role. |
| **Samples_Form** | Form *(auto)* | Samples | – | Column order per §3.3. **Event → Form Saved: Snapshot Block Details.** Finish view: `My Samples`. Page style: *Auto-advance OFF*. |
| **My Samples** | Deck | MySamples | Primary | Sort `CreatedAt` desc. Primary header `SampleLabel`, secondary `Status`, summary `TargetLeafCount`. Show the + (Add) button → opens Samples_Form. |
| **Analyse Samples** | Deck | AnalysisQueue | Primary | Group by `Status`. Sort `CollectionDate` asc. Primary header `SampleLabel`, secondary `CompletionSummary`. Show_If `IN(ANY(CurrentUser[Role]), {"Analyst", "Administrator"})`. Search box searches all *Searchable* columns (§6.2). |
| **In Progress** | Deck | InProgressSamples | Menu | Show_If as above. |
| **Completed Samples** | Table | CompletedSamples | Primary | Group by `Season`, then `Block`. Sort `CollectionDate` desc. Columns: SampleNumber, CollectionDate, Block, Variety, LeavesAnalysed, TotalTwoSM, AvgTwoSMPerLeaf, TotalPP. |
| **Samples_Detail** | Detail *(auto)* | Samples | – | **Quick edit: OFF.** Column order: `SampleLabel, Status, ProgressPct, LeavesAnalysed, LeavesRemaining, TargetLeafCount, BelowTargetWarning, CollectionDate, CollectorEmail, AreaHaAtCollection, SampleComments, SamplePhoto1, SamplePhoto2, AnalysisStartedAt, AnalysisCompletedAt, CompletedBy, AnalysisComments, EarlyCompletionReason, TotalTwoSM, AvgTwoSMPerLeaf, TotalPP, AvgPPPerLeaf, TotalTwoSMEggs, TotalPredatorEggs, TotalOtherBeneficial, PredatorToPestRatio, Leaves`. Prominent actions appear as large buttons at the top (§9.4). |
| **Sample_Complete** | Form | SampleCompletion | Ref | **Event → Form Saved: Finish Completion.** Title "Complete analysis". |
| **LeafAnalysis_Form** | Form *(auto)* | LeafAnalysis | – | Column order per §3.4. **Event → Form Saved: After Leaf Saved.** Finish view: *(leave default — the event navigates)*. |
| **LeafAnalysis_Inline** | Table *(auto)* | LeafAnalysis | – | Columns: LeafNumber, TetranychusCount, PhytoseiulusCount, TwoSpotEggCount, PredatorEggCount, OtherBeneficialCount. Sort LeafNumber asc. |
| **Help** | Gallery | HelpReference | Menu | Group by `Category`, sort `SortOrder`. |
| **Reports** | Dashboard | – | Menu | Contains *Mites by Block* + *Leaf Results*. Show_If `IN(ANY(CurrentUser[Role]), {"Analyst", "Administrator"})`. |
| **Mites by Block** | Chart (Histogram / column) | CompletedSamples | Ref | Series: `AvgTwoSMPerLeaf`, `AvgPPPerLeaf` grouped by `Block`. |
| **Leaf Results** | Table | LeafResults | Ref | Columns in the export order (§12.1). Add the action **Export Leaf CSV** (type *App: export this view to a CSV file*) — one row per leaf with sample context. |
| **Admin** | Dashboard | – | Menu | Contains *Block Varieties*, *Users*, *Data Quality*, *Cancelled*, *Audit Log*. Show_If `ANY(CurrentUser[Role]) = "Administrator"`. |
| **Block Varieties** | Table | BlockVarieties | Ref | |
| **Users** | Table | Users | Ref | |
| **Data Quality** | Deck | DataQualityIssues | Ref | |

Settings → **Starting view: Home**.

### 5.1 Format rules (UX → Format rules)

| Rule | Table | Condition | Format |
|---|---|---|---|
| Awaiting | Samples | `[Status] = "Awaiting Analysis"` | Status column: amber, icon *hourglass* |
| In progress | Samples | `[Status] = "Analysis In Progress"` | blue, icon *play* |
| Complete | Samples | `[Status] = "Analysis Complete"` | green, icon *check* |
| Cancelled | Samples | `[Status] = "Cancelled"` | grey, strikethrough |
| Below target | Samples | `AND([Status] = "Analysis Complete", [LeavesAnalysed] < [TargetLeafCount])` | `CompletionSummary` red |
| Target reached | Samples | `[LeavesAnalysed] >= [TargetLeafCount]` | `ProgressPct` green, bold |
| Warnings | Samples, LeafAnalysis | `TRUE` on `DuplicateWarning`, `BelowTargetWarning`, `HighCountWarning` | red, bold |
| Leaf header | LeafAnalysis | `TRUE` on `LeafHeader` | Text size 1.5×, bold |

---

## 6. Offline operation (Behavior → Offline mode) — §5.5, §16.2

| Setting | Value | Why |
|---|---|---|
| Use offline mode | **ON** | App and data cached on the tablet. |
| Store content for offline use | **ON** | Images and reference data available offline. |
| Delayed sync | **ON** | Saves queue on the device; the sync button shows the pending-change count (the "not yet synchronised" indicator). |
| Automatic updates | **ON** | Queued changes upload by themselves once a connection returns; manual sync is still possible. |
| Sync on start | **ON** | Pulls the latest blocks/users each time the app opens with a connection. |
| Server caching | ON (default) | |

**Behavior → Image upload size: Medium** (good enough to identify mites, keeps
sync times short — §15).

Everything the field form needs (`UNIQUEID()`, `USEREMAIL()`, `TODAY()`, block
look-ups, the leaf target, the form-saved action) runs on the device. Bots
(§7) run on the server after a sync and are not needed for any field step.

Field-staff routine: open the app on Wi-Fi before going out and wait for the
sync to finish; samples saved outdoors upload automatically on return.

---

## 7. Automation (Automation → Bots) — server-side, optional for go-live

| Bot | Event | Process | Purpose |
|---|---|---|---|
| **Audit completed sample edits** | Data change: *Updates* on Samples. Condition `[_THISROW_BEFORE].[Status] = "Analysis Complete"` | *Add new rows* to AuditLog: `TableName` = `"Samples"`, `RowID` = `[SampleID]`, `ChangedBy` = `[LastModifiedBy]`, `ChangedAt` = `NOW()`, `Summary` = `CONCATENATE("Status: ", [_THISROW_BEFORE].[Status], " → ", [Status], "; leaves recorded ", [_THISROW_BEFORE].[ActualLeafCount], " → ", [ActualLeafCount], "; comments: ", [AnalysisComments])` | Traceable corrections (§7.5, §14) |
| **Audit completed leaf edits** | Data change: *Updates or Deletes* on LeafAnalysis. Condition `[SampleID].[Status] = "Analysis Complete"` | *Add new rows* to AuditLog: `TableName` = `"LeafAnalysis"`, `RowID` = `[LeafAnalysisID]`, `ChangedBy` = `[LastModifiedBy]`, `ChangedAt` = `NOW()`, `Summary` = `CONCATENATE("Bag ", [SampleID].[SampleNumber], " leaf ", [LeafNumber], ": TwoSM ", [_THISROW_BEFORE].[TetranychusCount], "→", [TetranychusCount], ", PP ", [_THISROW_BEFORE].[PhytoseiulusCount], "→", [PhytoseiulusCount], ", TwoSM eggs ", [_THISROW_BEFORE].[TwoSpotEggCount], "→", [TwoSpotEggCount], ", Pred eggs ", [_THISROW_BEFORE].[PredatorEggCount], "→", [PredatorEggCount], ", Other ", [_THISROW_BEFORE].[OtherBeneficialCount], "→", [OtherBeneficialCount])` | |
| **Weekly stale-analysis reminder** *(future, §19)* | Schedule: Mondays 07:00 | Send email to administrators listing `InProgressSamples` older than 7 days | |

---

## 8. Reports and exports (§12)

| Need | How |
|---|---|
| One row per leaf, CSV, from the app | *Reports → Leaf Results → Export Leaf CSV*. |
| One row per leaf, Excel, from the spreadsheet | Sheet menu **Hop Farm → Build leaf results export**, then *File → Download → Microsoft Excel (.xlsx)*. |
| Per-sample summary (totals, averages, predator:pest ratio, % leaves infested) | In-app: *Completed Samples* columns. Spreadsheet: **Hop Farm → Build sample summary**. |
| Python / offline analysis | `python -m tools.flatten_export --samples Samples.csv --leaves LeafAnalysis.csv --users Users.csv --out leaf_results.csv --summary sample_summary.csv` |
| Data quality | In-app *Admin → Data Quality*; full check via **Hop Farm → Run data quality report**. |
| Trends over time | *Mites by Block* chart; for week-by-week trends pivot `Export_SampleSummary` by `Season`, `Block`, `CollectionDate`. |

---

## 9. Go-live checklist

- [ ] Real `BlockVarieties` loaded; the example rows removed.
- [ ] All staff in `Users` with roles, and added under *Security → Users*.
- [ ] App deployed (**Manage → Deploy → Move app to deployed state**).
- [ ] App installed on the field tablet and opened once on Wi-Fi.
- [ ] Every row of [`test-plan.md`](test-plan.md) passed on the field tablet,
      an office laptop and a desktop.
- [ ] Open decisions in [`decisions.md`](decisions.md) confirmed with the client.
