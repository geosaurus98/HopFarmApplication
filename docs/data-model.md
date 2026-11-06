# Data Model

```
Users ──< Samples (CollectorEmail, AnalysisStartedBy, CompletedBy)
Users ──< LeafAnalysis (AnalystEmail)
BlockVarieties ──< Samples (BlockVarietyID)        one block/variety, many samples
Samples ──< LeafAnalysis (SampleID)                one sample, many leaves
```

A sample of 75 leaves = 1 `Samples` row + 75 `LeafAnalysis` rows. All summary
figures are calculated from the leaf rows; nothing is pre-aggregated.

## 1. Users

| Column | Type | Notes |
|---|---|---|
| UserEmail | Email, **key** | Google sign-in address |
| Username | Text | Typed to sign in; unique, not case-sensitive (email also works) |
| FullName | Text | Real name, shown in the app and exports |
| Role | `Collector` / `Analyst` / `Administrator` | Drives views, actions and update permissions |
| Active | TRUE/FALSE | Inactive users cannot sign in; their history stays |
| AccessCode | Text | The code the person types to sign in (never sent to devices) |
| CreatedAt, UpdatedAt | DateTime | |

## 2. BlockVarieties

| Column | Type | Notes |
|---|---|---|
| BlockVarietyID | Text, **key** | e.g. `A1-CASCADE`; never change once used |
| Block, Variety | Text | Dropdown shows "A1 - Cascade" |
| AreaHa | Decimal > 0 | Hectares |
| Active | TRUE/FALSE | Only active rows offered for new samples |
| Notes, UpdatedAt | | |

## 3. Samples

| Column | Type | Set by | Notes |
|---|---|---|---|
| SampleID | Text, **key** | device (UUID) | Internal; never shown |
| SampleNumber | Number | Collector | Bag label; may repeat across seasons |
| CollectionDate | Date | default today | |
| Season | Text | server | `2026/27` (1 Jul – 30 Jun) |
| CollectorEmail | Ref Users | current user | |
| BlockVarietyID | Ref BlockVarieties | Collector | |
| Block, Variety, AreaHaAtCollection, TargetLeafCount | snapshot | server | Copied from the block when chosen; never changed by later block edits |
| SampleComments, SamplePhoto1, SamplePhoto2 | | Collector | optional |
| Status | Enum | actions | Draft · Awaiting Analysis · Analysis In Progress · Analysis Complete · Cancelled |
| AnalysisStartedAt, AnalysisStartedBy | | *Start Analysis* | |
| AnalysisCompletedAt, CompletedBy, ActualLeafCount | | *Complete Analysis* | |
| AnalysisComments, EarlyCompletionReason | | Analyst at completion | |
| CreatedAt, UpdatedAt, LastModifiedBy | | device / server | UpdatedAt is server time and drives incremental sync |

`TargetLeafCount = MAX(50, FLOOR((AreaHa × 10) / 5) × 5)` — e.g. 3.38 ha → 50,
7.84 ha → 75, 11.77 ha → 115. Implemented identically in `app/js/logic.js`, `apps-script/Setup.gs` and `tools/leaf_target.py` (all tested).

### Status transitions

```
            save form             Start Analysis /           Complete Analysis
  (new) ───────────────> Awaiting ──first leaf saved──> In Progress ──(confirm)──> Complete
                           │  ▲                           │   ▲                      │
                 Cancel    │  │ Restore (admin)   Cancel  │   └── Reopen (admin) ────┘
                           ▼  │                           ▼
                         Cancelled <──────────────────────┘
```

Status is changed only by the app's buttons; the API enforces who may make each transition.

## 4. LeafAnalysis

| Column | Type | Notes |
|---|---|---|
| LeafAnalysisID | Text, **key** | device (UUID) |
| SampleID | Ref Samples | Required; part-of |
| LeafNumber | Number ≥ 1 | Automatic; unique within the sample |
| AnalystEmail, AnalysisDateTime | | Automatic |
| TetranychusCount | whole number ≥ 0 | Two-spotted spider mite (TwoSM) |
| PhytoseiulusCount | whole number ≥ 0 | *P. persimilis* (PP) |
| TwoSpotEggCount | whole number ≥ 0 | |
| PredatorEggCount | whole number ≥ 0 | |
| OtherBeneficialCount | whole number ≥ 0 | |
| OtherBeneficialDescription | Enum + free text | Shown when other beneficials > 0 |
| LeafComment, LeafPhoto | | optional; photo is a Google Drive link |
| Deleted | TRUE/FALSE | Deleted leaves stay in the sheet but are excluded everywhere |
| CreatedAt, UpdatedAt, LastModifiedBy | | automatic |

Leaf numbers are assigned by the app (highest existing + 1) and checked for
uniqueness within the sample before saving. If two devices add the same leaf
number offline, both rows are kept and the data-quality report flags them.

## 5. Supporting tables

| Table | Purpose |
|---|---|
| AuditLog | Before → after summary of every change to a completed sample or its leaves (written by the API) |
| HelpReference | Identification and how-to content shown in the app, with optional image links |

## 6. Future: Plant Health Monitoring (§18)

Kept in **separate tables** so mite monitoring needs no changes and does not gain
plant-specific columns:

```
BlockVarieties ──< Plants ──< PlantInspections ──< PlantObservations (optional)
```

| Table | Columns (proposed) |
|---|---|
| Plants | PlantID (key), BlockVarietyID, Block, Row, PlantNumber, Active, Notes — persistent identity, e.g. `C2-R14-P07` |
| PlantInspections | InspectionID (key), PlantID, InspectionDate, Season, InspectorEmail, Status, Comments, Photo, CreatedAt, UpdatedAt |
| PlantObservations | ObservationID, InspectionID, Category (pest damage / disease / leaf condition / growth / general), Score or Value, Notes — keeps the assessment criteria configurable while they are still being finalised |

A weekly round of 14 plants per block becomes a slice of `Plants` per block and
a "Save & next plant" screen, mirroring the leaf workflow. No changes to the
mite tables are needed.
