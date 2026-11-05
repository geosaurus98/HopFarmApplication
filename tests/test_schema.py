"""Keeps templates/*.csv headers in step with the SCHEMA in apps-script/Setup.gs,
and the export headers identical across Apps Script, the app and the Python tool."""
import csv
import re
import unittest
from pathlib import Path

from tools import flatten_export as fe
from tools.leaf_target import required_leaves

ROOT = Path(__file__).resolve().parent.parent
GS = (ROOT / "apps-script" / "Setup.gs").read_text()


def js_string_array(src: str) -> list[str]:
    return re.findall(r"'([^']*)'", src)


def gs_schema() -> dict[str, list[str]]:
    block = re.search(r"const SCHEMA = \{(.*?)\n\};", GS, re.S).group(1)
    return {m.group(1): js_string_array(m.group(2)) for m in re.finditer(r"(\w+): \[(.*?)\]", block, re.S)}


class SchemaTest(unittest.TestCase):
    def test_templates_match_apps_script_schema(self):
        schema = gs_schema()
        self.assertEqual(set(schema), {p.stem for p in (ROOT / "templates").glob("*.csv")})
        for table, headers in schema.items():
            with open(ROOT / "templates" / f"{table}.csv", newline="") as fh:
                self.assertEqual(next(csv.reader(fh)), headers, table)

    def test_export_headers_match(self):
        block = re.search(r"const LEAF_EXPORT_HEADERS = \[(.*?)\];", GS, re.S).group(1)
        self.assertEqual(js_string_array(block), fe.LEAF_EXPORT_HEADERS)

    def test_summary_headers_match(self):
        block = re.search(r"const SUMMARY_HEADERS = \[(.*?)\];", GS, re.S).group(1)
        self.assertEqual(js_string_array(block), fe.SUMMARY_HEADERS)

    def test_app_headers_match(self):
        js = (ROOT / "app" / "js" / "logic.js").read_text()
        for name, expected in (("LEAF_EXPORT_HEADERS", fe.LEAF_EXPORT_HEADERS), ("SUMMARY_HEADERS", fe.SUMMARY_HEADERS)):
            block = re.search(rf"export const {name} = \[(.*?)\];", js, re.S).group(1)
            self.assertEqual(js_string_array(block), expected, name)

    def test_example_block_targets(self):
        with open(ROOT / "templates" / "BlockVarieties.csv", newline="") as fh:
            for row in csv.DictReader(fh):
                self.assertGreater(float(row["AreaHa"]), 0)
                self.assertEqual(required_leaves(row["AreaHa"]) % 5, 0)


if __name__ == "__main__":
    unittest.main()
