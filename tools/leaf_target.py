"""Reference implementation of the mite-sample leaf target (spec section 5.3).

    Required Leaves = MAX(50, FLOOR((AreaHa x 10) / 5) x 5)

The AppSheet expression and the Apps Script `requiredLeaves` function must give
identical results; tests/test_leaf_target.py pins the behaviour.

Usage:  python -m tools.leaf_target 3.38 7.84 11.77
"""
from __future__ import annotations

import math
import sys

LEAVES_PER_HA = 10
MINIMUM_LEAVES = 50
ROUND_TO = 5


def required_leaves(area_ha: float) -> int:
    """Return the number of leaves to collect for a block of `area_ha` hectares."""
    area = float(area_ha)
    if not math.isfinite(area) or area <= 0:
        raise ValueError(f"Block area must be greater than zero hectares, got {area_ha!r}")
    return max(MINIMUM_LEAVES, math.floor((area * LEAVES_PER_HA) / ROUND_TO) * ROUND_TO)


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1
    for arg in argv:
        print(f"{arg} ha -> {required_leaves(float(arg))} leaves")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
