"""Unit tests for tests_summary.py on synthetic report directories (stdlib only).

    python3 -I -B tests/test_tests_summary.py

Report shapes are the five real-runtime tests'. Fail closed: a missing verdict
key, a false verdict, non-empty `failures` or a missing required report fail;
an unrelated JSON (a gate report) is listed and does not fail.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from typing import Any

TOOL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tests_summary.py")
ALL5 = "smoke_wheel,frame_gl_defaults,frame_guard_loads,frame_load_formats,pt2891_frame_defences"

GOOD = {
    "smoke_wheel": {"result": {"start": {}}, "expectations": {"a holds": True, "b holds": True}},
    "frame_gl_defaults": {"ok": True, "results": [{"name": "x", "got": 1, "want": 1, "ok": True}]},
    "frame_guard_loads": {"ok": True, "formats": {}, "result": {}, "failures": [], "control_applied": True},
    "frame_load_formats": {"ok": True, "formats": {}, "map_formats": [], "result": {}, "failures": []},
    "pt2891_frame_defences": {"ok": True, "result": {}, "failures": []},
}


class Summary(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.d = self._tmp.name

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def write(self, reports: dict[str, Any]) -> None:
        for name, rep in reports.items():
            with open(os.path.join(self.d, name + ".json"), "w") as fh:
                fh.write(rep if isinstance(rep, str) else json.dumps(rep))

    def run_tool(self, *extra: str, dir_: str | None = None) -> tuple[int, str]:
        proc = subprocess.run(
            [sys.executable, "-I", "-B", TOOL, dir_ or self.d, *extra], capture_output=True, text=True, check=False
        )
        return proc.returncode, proc.stdout + proc.stderr

    def line(self, out: str, name: str) -> str:
        hits = [ln for ln in out.splitlines() if ln.startswith(f"tests_summary: {name} ")]
        self.assertEqual(len(hits), 1, out)
        return hits[0]

    def assertVerdict(self, reports: dict[str, Any], name: str, want_rc: int, word: str, *extra: str) -> str:
        self.write(reports)
        rc, out = self.run_tool(*extra)
        self.assertEqual(rc, want_rc, out)
        self.assertIn(word, self.line(out, name))
        return out

    def test_all_true_passes(self) -> None:
        out = self.assertVerdict(GOOD, "smoke_wheel", 0, "PASS", "--require", ALL5)
        self.assertIn("5 report(s) judged, 5 pass, 0 fail, 0 required missing -> PASS", out)

    def test_one_false_expectation_fails(self) -> None:
        bad = {**GOOD, "smoke_wheel": {"expectations": {"a holds": True, "b holds": False}}}
        out = self.assertVerdict(bad, "smoke_wheel", 1, "FAIL")
        self.assertIn("b holds", self.line(out, "smoke_wheel"))

    def test_truthy_but_not_true_expectation_fails(self) -> None:
        self.assertVerdict({"smoke_wheel": {"expectations": {"a": 1}}}, "smoke_wheel", 1, "FAIL")

    def test_frame_ok_false_or_failures_fail(self) -> None:
        for name, rep in [
            ("frame_guard_loads", {"ok": False, "failures": ["cif did not load"]}),
            ("frame_load_formats", {"ok": True, "failures": ["inconsistent: ok beside a failure"]}),
            ("pt2891_frame_defences", {"ok": False, "failures": []}),
        ]:
            with self.subTest(name=name):
                for f in os.listdir(self.d):
                    os.remove(os.path.join(self.d, f))
                self.assertVerdict({**GOOD, name: rep}, name, 1, "FAIL")

    def test_gl_defaults_shape(self) -> None:
        cases = [
            ({"ok": False, "results": [{"name": "after the boot call", "ok": False}]}, "FAIL"),
            ({"ok": True, "results": [{"name": "x", "ok": True}, {"name": "y", "ok": False}]}, "FAIL"),  # parts disagree
            ({"ok": True, "results": []}, "FAIL"),
            ({"ok": True}, "FAIL"),
        ]
        for rep, word in cases:
            with self.subTest(rep=rep):
                self.assertVerdict({"frame_gl_defaults": rep}, "frame_gl_defaults", 1, word)

    def test_missing_verdict_key_fails(self) -> None:
        for name, rep in [
            ("smoke_wheel", {"result": {}}),
            ("frame_gl_defaults", {"results": [{"name": "x", "ok": True}]}),
            ("frame_guard_loads", {"failures": []}),
            ("pt2891_frame_defences", {"ok": True}),  # no `failures`: pt2891 ran no check
            ("frame_load_formats", {"ok": "true", "failures": []}),  # not a JSON boolean
        ]:
            with self.subTest(name=name):
                self.assertVerdict({name: rep}, name, 1, "FAIL")

    def test_unreadable_report_fails(self) -> None:
        for text in ("{", "[]", "null"):
            with self.subTest(text=text):
                self.assertVerdict({"smoke_wheel": text}, "smoke_wheel", 1, "FAIL")

    def test_missing_required_report_fails(self) -> None:
        reports = {k: v for k, v in GOOD.items() if k != "frame_load_formats"}
        out = self.assertVerdict(reports, "frame_load_formats", 1, "required report missing", "--require", ALL5)
        self.assertIn("1 required missing -> FAIL", out)

    def test_require_accepts_repeats_and_lists(self) -> None:
        self.write(GOOD)
        rc, out = self.run_tool("--require", "smoke_wheel", "--require", "frame_gl_defaults,frame_guard_loads")
        self.assertEqual(rc, 0, out)

    def test_unknown_report_is_listed_not_failed(self) -> None:
        # Gate reports (e.g. the EM_JS positive control) are not this tool's to judge.
        out = self.assertVerdict({**GOOD, "check_no_emjs_positive_control": [{"clean": False}]}, "check_no_emjs_positive_control", 0, "not a test report")
        self.assertIn("5 report(s) judged", out)

    def test_new_frame_test_is_judged_not_skipped(self) -> None:
        self.assertVerdict({**GOOD, "frame_new_thing": {"ok": True}}, "frame_new_thing", 1, "FAIL")
        self.assertVerdict({**GOOD, "frame_new_thing": {"ok": True, "failures": []}}, "frame_new_thing", 0, "PASS")

    def test_no_test_report_fails(self) -> None:
        self.write({"side_modules": {"ok": True}})
        rc, out = self.run_tool()
        self.assertEqual(rc, 1, out)
        self.assertIn("no test report", out)

    def test_non_ascii_failure_text_prints(self) -> None:
        out = self.assertVerdict({"frame_guard_loads": {"ok": False, "failures": ["cif " + chr(0x2014) + " " + chr(0x5931) + chr(0x6557)]}}, "frame_guard_loads", 1, "FAIL")
        self.assertIn("\\u2014", out)

    def test_usage_errors_exit_2(self) -> None:
        rc, out = self.run_tool(dir_=os.path.join(self.d, "nope"))
        self.assertEqual(rc, 2, out)
        for bad in ("smoke-wheel", "smoke_wheel.json", "side_modules"):
            with self.subTest(bad=bad):
                rc, out = self.run_tool("--require", bad)
                self.assertEqual(rc, 2, out)
        proc = subprocess.run([sys.executable, "-I", "-B", TOOL], capture_output=True, text=True, check=False)
        self.assertEqual(proc.returncode, 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
