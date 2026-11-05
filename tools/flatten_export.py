"""Build the one-row-per-leaf export (spec section 12.1) from CSV downloads.

Download the Samples, LeafAnalysis and (optionally) Users tabs from the Google
Sheet as CSV, then run:

    python -m tools.flatten_export --samples Samples.csv --leaves LeafAnalysis.csv \
        --users Users.csv --out leaf_results.csv [--summary sample_summary.csv]

The app's Reports screen and the spreadsheet's "Hop Farm" menu produce the same
columns; this script is for working from CSV downloads in Python.
Only the standard library is used.
"""
from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

LEAF_EXPORT_HEADERS = [
    "SampleID", "SampleNumber", "Season", "CollectionDate", "WeekStarting", "Collector", "Block",
    "Variety", "AreaHa", "TargetLeafCount", "LeafNumber", "Analyst", "AnalysisDateTime",
    "TetranychusCount", "PhytoseiulusCount", "TwoSpotEggCount", "PredatorEggCount",
    "OtherBeneficialCount", "OtherBeneficialDescription", "LeafComment", "SampleComments",
    "AnalysisComments", "SampleStatus", "SamplePhoto1", "SamplePhoto2", "LeafPhoto",
]

SUMMARY_HEADERS = [
    "SampleID", "SampleNumber", "Season", "CollectionDate", "WeekStarting", "Block", "Variety",
    "Status", "TargetLeafCount", "LeavesAnalysed", "BelowTarget",
    "TotalTwoSM", "AvgTwoSMPerLeaf", "TotalPP", "AvgPPPerLeaf",
    "TotalTwoSMEggs", "TotalPredatorEggs", "TotalOtherBeneficial",
    "PredatorToPestRatio", "LeavesWithTwoSM", "PctLeavesWithTwoSM", "EarlyCompletionReason",
]

COUNT_FIELDS = [
    "TetranychusCount", "PhytoseiulusCount", "TwoSpotEggCount",
    "PredatorEggCount", "OtherBeneficialCount",
]


def week_starting(iso_date: str) -> str:
    """Monday of the week containing the date ('YYYY-MM-DD'); '' if unparseable."""
    try:
        d = date.fromisoformat(str(iso_date)[:10])
    except ValueError:
        return ""
    return (d - timedelta(days=d.weekday())).isoformat()


def is_deleted(leaf: dict) -> bool:
    return str(leaf.get("Deleted", "")).strip().upper() == "TRUE"


def read_csv(path: Path | str) -> list[dict[str, str]]:
    with open(path, newline="", encoding="utf-8-sig") as fh:
        return [row for row in csv.DictReader(fh) if any((v or "").strip() for v in row.values())]


def _int(value: str | None) -> int:
    try:
        return int(float(value)) if value not in (None, "") else 0
    except ValueError:
        return 0


def _num_key(value: str) -> tuple:
    try:
        return (0, float(value), "")
    except (TypeError, ValueError):
        return (1, 0.0, str(value))


def flatten(samples: list[dict], leaves: list[dict], users: list[dict] | None = None) -> list[dict]:
    names = {u["UserEmail"].lower(): u.get("UserName") or u["UserEmail"] for u in users or []}

    def name(email: str) -> str:
        return names.get((email or "").lower(), email or "")

    by_id = {s["SampleID"]: s for s in samples}
    rows = []
    for leaf in leaves:
        s = by_id.get(leaf["SampleID"])
        if is_deleted(leaf) or s is None or s.get("Status") == "Cancelled":
            continue  # orphan leaf: reported by the data quality check, not exported
        rows.append({
            "SampleID": s["SampleID"], "SampleNumber": s["SampleNumber"], "Season": s.get("Season", ""),
            "CollectionDate": s["CollectionDate"], "WeekStarting": week_starting(s["CollectionDate"]),
            "Collector": name(s.get("CollectorEmail", "")),
            "Block": s["Block"], "Variety": s["Variety"], "AreaHa": s.get("AreaHaAtCollection", ""),
            "TargetLeafCount": s.get("TargetLeafCount", ""), "LeafNumber": leaf["LeafNumber"],
            "Analyst": name(leaf.get("AnalystEmail", "")), "AnalysisDateTime": leaf.get("AnalysisDateTime", ""),
            **{f: leaf.get(f, "") for f in COUNT_FIELDS},
            "OtherBeneficialDescription": leaf.get("OtherBeneficialDescription", ""),
            "LeafComment": leaf.get("LeafComment", ""), "SampleComments": s.get("SampleComments", ""),
            "AnalysisComments": s.get("AnalysisComments", ""), "SampleStatus": s.get("Status", ""),
            "SamplePhoto1": s.get("SamplePhoto1", ""), "SamplePhoto2": s.get("SamplePhoto2", ""),
            "LeafPhoto": leaf.get("LeafPhoto", ""),
        })
    rows.sort(key=lambda r: (r["CollectionDate"], _num_key(r["SampleNumber"]), r["SampleID"], _num_key(r["LeafNumber"])))
    return rows


def summarise(samples: list[dict], leaves: list[dict]) -> list[dict]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for leaf in leaves:
        if not is_deleted(leaf):
            grouped[leaf["SampleID"]].append(leaf)
    out = []
    for s in samples:
        if s.get("Status") == "Cancelled":
            continue
        ls = grouped.get(s["SampleID"], [])
        n = len(ls)
        tot = {f: sum(_int(l.get(f)) for l in ls) for f in COUNT_FIELDS}
        tsm, pp = tot["TetranychusCount"], tot["PhytoseiulusCount"]
        infested = sum(1 for l in ls if _int(l.get("TetranychusCount")) > 0)
        target = _int(s.get("TargetLeafCount"))
        out.append({
            "SampleID": s["SampleID"], "SampleNumber": s["SampleNumber"], "Season": s.get("Season", ""),
            "CollectionDate": s["CollectionDate"], "WeekStarting": week_starting(s["CollectionDate"]),
            "Block": s["Block"], "Variety": s["Variety"],
            "Status": s.get("Status", ""), "TargetLeafCount": target, "LeavesAnalysed": n,
            "BelowTarget": "YES" if n < target else "NO",
            "TotalTwoSM": tsm, "AvgTwoSMPerLeaf": round(tsm / n, 3) if n else "",
            "TotalPP": pp, "AvgPPPerLeaf": round(pp / n, 3) if n else "",
            "TotalTwoSMEggs": tot["TwoSpotEggCount"], "TotalPredatorEggs": tot["PredatorEggCount"],
            "TotalOtherBeneficial": tot["OtherBeneficialCount"],
            "PredatorToPestRatio": round(pp / tsm, 3) if tsm else "",
            "LeavesWithTwoSM": infested, "PctLeavesWithTwoSM": round(infested / n, 3) if n else "",
            "EarlyCompletionReason": s.get("EarlyCompletionReason", ""),
        })
    return out


def write_csv(path: Path | str, headers: list[str], rows: list[dict]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=headers)
        w.writeheader()
        w.writerows(rows)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--samples", required=True)
    p.add_argument("--leaves", required=True)
    p.add_argument("--users")
    p.add_argument("--out", required=True)
    p.add_argument("--summary")
    a = p.parse_args(argv)
    samples, leaves = read_csv(a.samples), read_csv(a.leaves)
    users = read_csv(a.users) if a.users else None
    rows = flatten(samples, leaves, users)
    write_csv(a.out, LEAF_EXPORT_HEADERS, rows)
    print(f"Wrote {len(rows)} leaf rows to {a.out}")
    if a.summary:
        summary = summarise(samples, leaves)
        write_csv(a.summary, SUMMARY_HEADERS, summary)
        print(f"Wrote {len(summary)} sample rows to {a.summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
