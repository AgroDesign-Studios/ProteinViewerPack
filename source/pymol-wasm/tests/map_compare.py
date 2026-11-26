"""Compare two map_equality.mjs result files (patch 0009, S1-4), item by item.

usage: python3 -I -B pymol-wasm/tests/map_compare.py <base.json> <candidate.json> [--items] [--table]

Both files must be complete (their "ok" is true: every structure ran to the end) and cover the
same structures. Per structure: the items compared and the items whose values differ (the first 8
shown, base and candidate side by side). Values compare as canonical JSON; the per-item times are
not compared. --table prints the per-category item counts of the base file; --items lists every
base item with its value.

exit: 0 = both files complete, the same structures, 0 differing items; 1 = any differing item, a
structure or item missing on one side, or a file that is not complete; 2 = usage / unreadable file.
"""

import collections
import json
import sys
from typing import Any


def die(msg: str) -> None:
    sys.stderr.write("map_compare: %s\n\n%s\n" % (msg, __doc__))
    sys.exit(2)


def load(path: str) -> dict[str, Any]:
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError) as e:
        die("cannot read %s: %s" % (path, e))
    if not isinstance(data, dict) or data.get("probe") != "map_equality" or not isinstance(data.get("structures"), dict):
        die("%s is not a map_equality.mjs result file" % path)
    return data


def canon(v: Any) -> str:
    return json.dumps(v, sort_keys=True)


def table(base: dict[str, Any]) -> None:
    cats: dict[str, collections.Counter[str]] = collections.OrderedDict()
    cols = []
    for name, s in base["structures"].items():
        items = s.get("items") or {}
        col = "%s(%s)" % (name, (items.get("anchors") or {}).get("nat"))
        cols.append(col)
        for k in items:
            if k == "anchors":
                continue
            cats.setdefault(k.split(".")[0], collections.Counter())[col] += 1
    print("| category | " + " | ".join(cols) + " |")
    print("|---|" + "---|" * len(cols))
    for c, cnt in cats.items():
        print("| %s | %s |" % (c, " | ".join(str(cnt.get(col, 0)) for col in cols)))
    print("| total (without anchors) | %s |" % " | ".join(str(sum(cnt.get(col, 0) for cnt in cats.values())) for col in cols))


def main(argv: list[str]) -> int:
    flags = {a for a in argv if a.startswith("--")}
    unknown = flags - {"--items", "--table"}
    if unknown:
        die("unknown option %s" % sorted(unknown)[0])
    pos = [a for a in argv if not a.startswith("--")]
    if len(pos) != 2:
        die("expected two result files")
    base, cand = load(pos[0]), load(pos[1])
    problems = 0
    for label, data, path in (("base", base, pos[0]), ("candidate", cand, pos[1])):
        if data.get("ok") is not True:
            failed = [k for k, v in (data.get("expectations") or {}).items() if v is not True]
            print("NOT COMPLETE %s %s: %s" % (label, path, failed or "ok is not true"))
            problems += 1
    print("base      %s  sha256 %s" % (base.get("wheel"), base.get("wheelSha256")))
    print("candidate %s  sha256 %s" % (cand.get("wheel"), cand.get("wheelSha256")))
    total = differ = 0
    for name in sorted(set(base["structures"]) | set(cand["structures"])):
        b = base["structures"].get(name)
        c = cand["structures"].get(name)
        if b is None or c is None:
            print("== %s: only in %s" % (name, "candidate" if b is None else "base"))
            problems += 1
            continue
        bi, ci = b.get("items") or {}, c.get("items") or {}
        keys = sorted(set(bi) | set(ci))
        diff = [k for k in keys if k not in bi or k not in ci or canon(bi[k]) != canon(ci[k])]
        errs = sorted(k for k, v in bi.items() if isinstance(v, str) and v.startswith("ERR"))
        if b.get("input") != c.get("input"):
            print("== %s: the two runs read different input files %s / %s" % (name, b.get("input"), c.get("input")))
            problems += 1
        total += len(keys)
        differ += len(diff)
        print("== %s tier=%s atoms=%s: %d items compared, %d differ; base wall %ss heap %s MiB; ERR items in base: %s"
              % (name, b.get("tier"), (bi.get("anchors") or {}).get("nat"), len(keys), len(diff), b.get("wallS"), b.get("heapMB"), errs))
        for k in diff[:8]:
            print("     %s\n        base:      %s\n        candidate: %s" % (k, canon(bi.get(k, "<missing>"))[:300], canon(ci.get(k, "<missing>"))[:300]))
        if "--items" in flags:
            for k, v in bi.items():
                print("     %-34s %s" % (k, canon(v)[:170]))
    print("TOTAL %d item comparisons, %d differ%s" % (total, differ, "" if not problems else ", %d problem(s) above" % problems))
    if "--table" in flags:
        table(base)
    return 0 if (differ == 0 and problems == 0 and total > 0) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
