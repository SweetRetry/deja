#!/usr/bin/env python3
"""Turn per-image grades into an eval label file.

  python3 eval/build_labels.py <folder> <grades.json> [<grades.json> ...] > eval/labels-<folder>.json

Each grades file maps "NNN-hash.jpg" -> {"woman": "y"|"m"|"n", ...}. "y" is
relevant, "m" is left out of scoring, "n" is a negative.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

QUERIES = {
    "woman": "女性",
    "man": "男性",
    "anime": "动漫插画",
    "dog": "狗",
    "cat": "猫",
    "car": "汽车",
    "food": "美食",
    "building": "建筑外观",
    "mountain": "山",
    "app_ui": "手机 App 界面",
    "interior": "室内客厅",
    "flower": "花",
    "city_night": "城市夜景",
    "water": "水边",
}


def main() -> int:
    folder, *grade_files = sys.argv[1:]
    grades: dict[str, dict] = {}
    for path in grade_files:
        grades.update(json.loads(Path(path).read_text()))
    images = sorted(p.name for p in Path(folder).glob("*.jpg"))
    missing = [name for name in images if name not in grades]
    if missing:
        raise SystemExit(f"{len(missing)} images have no grades, first: {missing[0]}")

    queries = []
    for key, text in QUERIES.items():
        relevant = [n.split("-")[0] for n in images if grades[n].get(key) == "y"]
        ignore = [n.split("-")[0] for n in images if grades[n].get(key) == "m"]
        if relevant:
            queries.append({"query": text, "relevant": relevant, "ignore": ignore})
    json.dump(
        {"folder": str(Path(folder).resolve()), "note": "Graded per image by Haiku, spot-checked.", "queries": queries},
        sys.stdout,
        ensure_ascii=False,
        indent=1,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
