import csv
import tempfile
import unittest
from pathlib import Path

from tools import flatten_export as fe

SAMPLES = [
    {"SampleID": "s2", "SampleNumber": "1043", "Season": "2026/27", "CollectionDate": "2026-11-03",
     "CollectorEmail": "c@x.nz", "Block": "A1", "Variety": "Cascade", "AreaHaAtCollection": "7.84",
     "TargetLeafCount": "75", "Status": "Analysis In Progress"},
    {"SampleID": "s1", "SampleNumber": "1042", "Season": "2026/27", "CollectionDate": "2026-11-02",
     "CollectorEmail": "C@x.nz", "Block": "H1", "Variety": "Nugget", "AreaHaAtCollection": "3.38",
     "TargetLeafCount": "50", "Status": "Analysis Complete", "SampleComments": "windy"},
    {"SampleID": "s3", "SampleNumber": "1044", "Season": "2026/27", "CollectionDate": "2026-11-03",
     "Block": "K2", "Variety": "X", "TargetLeafCount": "115", "Status": "Cancelled"},
]

def leaf(sid, n, tsm, pp, e1=0, e2=0, ob=0):
    return {"LeafAnalysisID": f"{sid}-{n}", "SampleID": sid, "LeafNumber": str(n), "AnalystEmail": "a@x.nz",
            "TetranychusCount": str(tsm), "PhytoseiulusCount": str(pp), "TwoSpotEggCount": str(e1),
            "PredatorEggCount": str(e2), "OtherBeneficialCount": str(ob)}

LEAVES = [dict(leaf("s1", 11, 99, 99), Deleted="TRUE"), leaf("s1", 10, 0, 0), leaf("s1", 2, 4, 1, 3), leaf("s1", 1, 6, 1), leaf("s2", 1, 0, 2),
          leaf("orphan", 1, 9, 9)]
USERS = [{"UserEmail": "c@x.nz", "Username": "casey", "FullName": "Casey"}, {"UserEmail": "a@x.nz", "UserName": "Alex"}]  # old layout still works


class FlattenTest(unittest.TestCase):
    def test_one_row_per_leaf_with_sample_context(self):
        rows = fe.flatten(SAMPLES, LEAVES, USERS)
        self.assertEqual(len(rows), 4)  # orphan leaf excluded
        self.assertEqual([(r["SampleNumber"], r["LeafNumber"]) for r in rows],
                         [("1042", "1"), ("1042", "2"), ("1042", "10"), ("1043", "1")])
        first = rows[0]
        self.assertEqual(first["Collector"], "Casey")  # email match is case-insensitive
        self.assertEqual(first["Analyst"], "Alex")
        self.assertEqual(first["AreaHa"], "3.38")
        self.assertEqual(first["SampleComments"], "windy")
        self.assertEqual(first["WeekStarting"], "2026-11-02")
        self.assertEqual(set(first), set(fe.LEAF_EXPORT_HEADERS))

    def test_summary(self):
        by_id = {r["SampleID"]: r for r in fe.summarise(SAMPLES, LEAVES)}
        self.assertNotIn("s3", by_id)  # cancelled excluded
        s1 = by_id["s1"]
        self.assertEqual(s1["LeavesAnalysed"], 3)
        self.assertEqual(s1["TotalTwoSM"], 10)
        self.assertEqual(s1["AvgTwoSMPerLeaf"], 3.333)
        self.assertEqual(s1["TotalPP"], 2)
        self.assertEqual(s1["PredatorToPestRatio"], 0.2)
        self.assertEqual(s1["LeavesWithTwoSM"], 2)
        self.assertEqual(s1["BelowTarget"], "YES")
        self.assertEqual(by_id["s2"]["PredatorToPestRatio"], "")  # no pests -> undefined

    def test_cli_round_trip(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            for name, rows in (("s.csv", SAMPLES), ("l.csv", LEAVES), ("u.csv", USERS)):
                with open(d / name, "w", newline="") as fh:
                    keys = sorted({k for r in rows for k in r})
                    w = csv.DictWriter(fh, fieldnames=keys)
                    w.writeheader()
                    w.writerows(rows)
            rc = fe.main(["--samples", str(d / "s.csv"), "--leaves", str(d / "l.csv"), "--users",
                          str(d / "u.csv"), "--out", str(d / "o.csv"), "--summary", str(d / "sum.csv")])
            self.assertEqual(rc, 0)
            out = fe.read_csv(d / "o.csv")
            self.assertEqual(len(out), 4)
            self.assertEqual(list(out[0]), fe.LEAF_EXPORT_HEADERS)


if __name__ == "__main__":
    unittest.main()
