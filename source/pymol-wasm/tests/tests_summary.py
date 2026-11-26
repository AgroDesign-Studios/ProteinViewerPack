"""The verdict of the real-runtime tests, read from the JSON reports they write.

usage: python3 -I -B tests_summary.py REPORTS_DIR [--require NAME[,NAME...]]

Reads each report's verdict key, never console text. Report shapes:

  smoke_wheel        PASS = non-empty `expectations`, every value true
  frame_gl_defaults  PASS = ok true, `results` non-empty, every result's ok true
  frame_guard_loads, frame_load_formats, pt2891_frame_defences, any other
  frame_*.json / pt*_frame_*.json
                     PASS = ok true and `failures` present and empty

A report FAILs when it is not valid JSON, its verdict key is missing or not
exactly `true` / a list, or its parts disagree. Other *.json files are listed
as "not a test report" and do NOT fail (their tools judge them by exit code).
No test report at all = FAIL. `--require` names reports that must exist (bare
names, e.g. smoke_wheel): missing = FAIL; a name no rule reads = usage error.

Prints one line per report and a final verdict line.
exit: 0 every report passes and every required one exists | 1 any FAIL or a
      required report missing | 2 usage error (bad arguments, no such directory)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Any

FRAME_RE = re.compile(r"(?:frame_[A-Za-z0-9_]+|pt[0-9]+_frame_[A-Za-z0-9_]+)")
MAX_SHOWN = 5


def rule_for(name: str) -> str | None:
    if name == "smoke_wheel":
        return "expectations"
    if name == "frame_gl_defaults":
        return "results"
    if FRAME_RE.fullmatch(name):
        return "failures"
    return None


def _short(items: list[Any]) -> str:
    # ASCII-escaped: build.sh runs under LC_ALL=C and a report may quote any text.
    shown = "; ".join(str(x)[:160].encode("ascii", "backslashreplace").decode("ascii") for x in items[:MAX_SHOWN])
    return shown + (f"; ... {len(items) - MAX_SHOWN} more" if len(items) > MAX_SHOWN else "")


def judge(rule: str, rep: Any) -> tuple[bool, str]:
    """(passed, one-line detail)."""
    if not isinstance(rep, dict):
        return False, "the report is not a JSON object"
    if rule == "expectations":
        exp = rep.get("expectations")
        if not isinstance(exp, dict) or not exp:
            return False, "no `expectations` object (verdict key missing or empty)"
        bad = [k for k, v in exp.items() if v is not True]
        if bad:
            return False, f"{len(exp) - len(bad)}/{len(exp)} expectations true; false: {_short(bad)}"
        return True, f"{len(exp)}/{len(exp)} expectations true"
    ok = rep.get("ok")
    if ok is not True and ok is not False:
        return False, "no boolean `ok` (verdict key missing)"
    if rule == "results":
        res = rep.get("results")
        if not isinstance(res, list) or not res:
            return False, f"ok={ok}, but no `results` list"
        bad = [r.get("name", "?") if isinstance(r, dict) else repr(r) for r in res if not (isinstance(r, dict) and r.get("ok") is True)]
        fails = rep.get("failures", [])
        if not isinstance(fails, list):
            return False, f"ok={ok}, `failures` is not a list"
        if ok and (bad or fails):
            return False, f"ok=true but {len(bad)} result(s) false / {len(fails)} failure(s): {_short(bad + fails)}"
        if not ok:
            return False, f"ok=false; {len(res) - len(bad)}/{len(res)} results ok; false: {_short(bad)}"
        return True, f"ok=true, {len(res)}/{len(res)} results ok"
    fails = rep.get("failures")
    if not isinstance(fails, list):
        return False, f"ok={ok}, but no `failures` list (no check ran, or not this test's report)"
    if ok and fails:
        return False, f"ok=true beside {len(fails)} failure(s): {_short(fails)}"
    if not ok:
        return False, f"ok=false, {len(fails)} failure(s): {_short(fails) if fails else '(none listed)'}"
    return True, "ok=true, failures=[]"


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="tests_summary.py", description=__doc__.split("\n")[0])
    ap.add_argument("reports_dir")
    ap.add_argument("--require", action="append", default=[], help="NAME[,NAME...] reports that must exist")
    args = ap.parse_args(argv[1:])
    required: list[str] = []
    for chunk in args.require:
        for n in chunk.split(","):
            n = n.strip()
            if not n:
                continue
            if rule_for(n) is None:
                ap.error(f"--require {n!r}: not a test report name (want smoke_wheel, frame_*, pt<N>_frame_*)")
            if n not in required:
                required.append(n)
    if not os.path.isdir(args.reports_dir):
        ap.error(f"no such directory: {args.reports_dir}")
    names = sorted(f[: -len(".json")] for f in os.listdir(args.reports_dir) if f.endswith(".json"))
    judged = passed = 0
    lines = []
    for n in names:
        rule = rule_for(n)
        if rule is None:
            lines.append(f"tests_summary: {n:<24} -     not a test report (not judged here)")
            continue
        judged += 1
        try:
            with open(os.path.join(args.reports_dir, n + ".json"), encoding="utf-8") as fh:
                rep = json.load(fh)
            ok, detail = judge(rule, rep)
        except (OSError, ValueError) as exc:
            ok, detail = False, f"unreadable report: {type(exc).__name__}: {exc}"
        passed += ok
        lines.append(f"tests_summary: {n:<24} {'PASS' if ok else 'FAIL'}  {detail}")
    missing = [n for n in required if n not in names]
    for n in missing:
        lines.append(f"tests_summary: {n:<24} FAIL  required report missing ({n}.json)")
    for line in lines:
        print(line)
    failed = judged - passed + len(missing)
    if judged == 0 and not missing:
        print(f"tests_summary: no test report in {args.reports_dir} -> FAIL")
        return 1
    print(f"tests_summary: {judged} report(s) judged, {passed} pass, {judged - passed} fail, {len(missing)} required missing -> {'PASS' if failed == 0 else 'FAIL'}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
