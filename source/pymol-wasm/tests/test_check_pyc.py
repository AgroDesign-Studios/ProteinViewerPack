"""Unit tests for check_pyc.py on synthetic stdlib zips and wheels (stdlib only).

    python3 -I -B tests/test_check_pyc.py

Every rule G1-G8 gets a failing and a passing case; exit codes 0 / 1 / 2 are
pinned. The synthetic runtime is the host's CPython series, so it runs anywhere.
"""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
import warnings
import zipfile
from typing import Any

GATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "check_pyc.py")
MAGIC = importlib.util.MAGIC_NUMBER
TAG = f"cpython-{sys.version_info.major}{sys.version_info.minor}"
HOST_VER = f"{sys.version_info.major}.{sys.version_info.minor}.0"
PKL_SRC = b"RESTRICTED_GLOBALS = {}\n\ndef restricted_loads(b):\n    pass\n\npickle.loads = restricted_loads\n"


def pyc(src: bytes, *, magic: bytes = MAGIC, flags: int = 0b01, hash_of: bytes | None = None) -> bytes:
    if flags & 0b01:
        tail = importlib.util.source_hash(src if hash_of is None else hash_of)
    else:
        tail = (0).to_bytes(4, "little") + len(src).to_bytes(4, "little")
    # The gate reads only the 16-byte header; the code object is a stand-in.
    return magic + flags.to_bytes(4, "little") + tail + b"<code object not read by the gate>"


def wheel_order(names: Any) -> list[str]:
    return sorted(names, key=lambda n: (".dist-info/" in n, n.encode()))


def good_stdlib() -> dict[str, bytes]:
    return {"os.pyc": pyc(b"x = 1\n"), "json/__init__.pyc": pyc(b"y = 2\n"), "keep.py": b"z = 3\n"}


def good_wheel() -> dict[str, bytes]:
    a, b = b"A = 1\n", b"B = 2\n"
    return {
        "chempy/__init__.py": a,
        f"chempy/__pycache__/__init__.{TAG}.pyc": pyc(a),
        "chempy/pkl.py": PKL_SRC,
        "pymol/__init__.py": b,
        f"pymol/__pycache__/__init__.{TAG}.pyc": pyc(b),
        "pymol/plain.py": b"C = 3\n",
        "pymol-3.2.0a.dist-info/RECORD": b"",
        "pymol-3.2.0a.dist-info/WHEEL": b"",
    }


def plain_wheel() -> dict[str, bytes]:
    return {k: v for k, v in good_wheel().items() if not k.endswith(".pyc")}


GOOD_TARGETS = {"schema": 1, "stdlib": ["os.py", "json/__init__.py"], "wheel": ["chempy/__init__.py", "pymol/__init__.py"]}


class PycCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.d = self._tmp.name

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def path(self, name: str) -> str:
        return os.path.join(self.d, name)

    def write_zip(self, name: str, files: dict[str, bytes], order: list[tuple[str, bytes]] | None = None) -> str:
        p = self.path(name)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")  # the duplicate-name case
            with zipfile.ZipFile(p, "w") as z:
                for n, data in order or files.items():
                    z.writestr(n, data)
        return p

    def write_json(self, name: str, obj: Any) -> str:
        p = self.path(name)
        with open(p, "w") as fh:
            fh.write(obj if isinstance(obj, str) else json.dumps(obj))
        return p

    def run_gate(
        self,
        stdlib: dict[str, bytes] | None = None,
        wheel: dict[str, bytes] | None = None,
        *,
        wheel_items: list[tuple[str, bytes]] | None = None,
        targets: Any = None,
        extra: tuple[str, ...] | list[str] = (),
        lock: Any = None,
        magic: str | None = MAGIC.hex(),
        raw: list[str] | None = None,
    ) -> tuple[int, str, Any]:
        s = self.write_zip("stdlib.zip", good_stdlib() if stdlib is None else stdlib)
        w_files = good_wheel() if wheel is None else wheel
        items = wheel_items if wheel_items is not None else [(n, w_files[n]) for n in wheel_order(w_files)]
        w = self.write_zip("pymol.whl", w_files, order=items)
        lk = self.write_json("lock.json", {"info": {"python": HOST_VER}} if lock is None else lock)
        rep = self.path("report.json")
        if os.path.exists(rep):
            os.remove(rep)
        args = [sys.executable, "-I", "-B", GATE, "--json", rep, "--lock", lk]
        if magic is not None:
            args += ["--magic", magic]
        if targets is not None:
            args += ["--targets", self.write_json("targets.json", targets)]
        args += list(extra)
        args += list(raw) if raw is not None else [s, w]
        proc = subprocess.run(args, capture_output=True, text=True, check=False)
        data = None
        if os.path.exists(rep):
            with open(rep) as fh:
                data = json.load(fh)
        return proc.returncode, proc.stdout + proc.stderr, data

    def assertPass(self, *a: Any, **kw: Any) -> Any:
        rc, out, rep = self.run_gate(*a, **kw)
        self.assertEqual(rc, 0, out)
        self.assertTrue(rep["ok"])
        return rep

    def assertRule(self, rule: str, *a: Any, **kw: Any) -> Any:
        rc, out, rep = self.run_gate(*a, **kw)
        self.assertEqual(rc, 1, out)
        self.assertFalse(rep["rules"][rule]["ok"], out)
        return rep

    def assertExit2(self, *a: Any, **kw: Any) -> Any:
        rc, out, rep = self.run_gate(*a, **kw)
        self.assertEqual(rc, 2, out)
        self.assertIsNotNone(rep, "the report must be written on exit 2 too")
        self.assertFalse(rep["ok"])
        return rep


class Passing(PycCase):
    def test_no_pyc_passes_without_expect(self) -> None:
        rep = self.assertPass(stdlib={"os.py": b"x = 1\n"}, wheel=plain_wheel())
        self.assertEqual((rep["stdlib"]["pyc"], rep["wheel"]["pyc"]), (0, 0))

    def test_good_pyc_passes_with_expect_and_targets(self) -> None:
        rep = self.assertPass(targets=GOOD_TARGETS, extra=["--expect-pyc"])
        self.assertEqual((rep["stdlib"]["pyc"], rep["wheel"]["pyc"], rep["wheel"]["source_hash_ok"]), (2, 2, 2))
        self.assertEqual(rep["cache_tag"], TAG)
        self.assertEqual(rep["magic"], MAGIC.hex())


class G1Magic(PycCase):
    OTHER = bytes([MAGIC[0] ^ 1, MAGIC[1]]) + b"\r\n"

    def test_stdlib_wrong_magic(self) -> None:
        self.assertRule("G1", stdlib={**good_stdlib(), "os.pyc": pyc(b"x = 1\n", magic=self.OTHER)})

    def test_wheel_wrong_magic(self) -> None:
        w = good_wheel()
        w[f"pymol/__pycache__/__init__.{TAG}.pyc"] = pyc(b"B = 2\n", magic=self.OTHER)
        self.assertRule("G1", wheel=w)

    def test_explicit_wrong_magic_argument(self) -> None:
        self.assertRule("G1", magic=self.OTHER.hex())


class G2Flags(PycCase):
    def test_timestamp_checked_and_truncated(self) -> None:
        for label, blob in [
            ("timestamp", pyc(b"x = 1\n", flags=0)),
            ("checked hash", pyc(b"x = 1\n", flags=0b11)),
            ("truncated header", MAGIC + b"\x01\x00\x00\x00\x00\x00"),
        ]:
            with self.subTest(label=label):
                rep = self.assertRule("G2", stdlib={**good_stdlib(), "os.pyc": blob})
                self.assertTrue(rep["rules"]["G1"]["ok"])


class G3SourceHash(PycCase):
    def test_stale_pyc_beside_an_edited_py(self) -> None:
        w = good_wheel()
        w["pymol/__init__.py"] = b"B = 'edited after the .pyc was made'\n"
        rep = self.assertRule("G3", wheel=w)
        self.assertIn("stale", " ".join(rep["rules"]["G3"]["failures"]))

    def test_pyc_outside_pycache(self) -> None:
        self.assertRule("G3", wheel={**good_wheel(), "pymol/legacy.pyc": pyc(b"L = 1\n")})

    def test_wrong_cache_tag(self) -> None:
        for name in ("pymol/__pycache__/plain.cpython-27.pyc", f"pymol/__pycache__/plain.{TAG}.opt-1.pyc"):
            with self.subTest(name=name):
                self.assertRule("G3", wheel={**good_wheel(), name: pyc(b"C = 3\n")})

    def test_no_source_beside(self) -> None:
        self.assertRule("G3", wheel={**good_wheel(), f"pymol/__pycache__/gone.{TAG}.pyc": pyc(b"G = 1\n")})

    def test_top_level_pycache(self) -> None:
        w = {**good_wheel(), "top.py": b"T = 1\n", f"__pycache__/top.{TAG}.pyc": pyc(b"T = 1\n")}
        rep = self.assertPass(wheel=w)
        self.assertEqual(rep["wheel"]["source_hash_ok"], 3)


class G4Sourceless(PycCase):
    def test_source_beside_a_stdlib_pyc(self) -> None:
        self.assertRule("G4", stdlib={**good_stdlib(), "os.py": b"x = 1\n"})

    def test_pycache_in_the_stdlib_zip(self) -> None:
        self.assertRule("G4", stdlib={**good_stdlib(), "keep.py": b"z = 3\n", f"__pycache__/keep.{TAG}.pyc": pyc(b"z = 3\n")})


class G5Pkl(PycCase):
    def test_marks_lost(self) -> None:
        for mark in (b"RESTRICTED_GLOBALS", b"pickle.loads = restricted_loads"):
            with self.subTest(mark=mark):
                self.assertRule("G5", wheel={**good_wheel(), "chempy/pkl.py": PKL_SRC.replace(mark, b"gone")})

    def test_pkl_compiled(self) -> None:
        for name in (f"chempy/__pycache__/pkl.{TAG}.pyc", "chempy/pkl.pyc"):
            with self.subTest(name=name):
                self.assertRule("G5", wheel={**good_wheel(), name: pyc(PKL_SRC)})

    def test_pkl_missing(self) -> None:
        w = good_wheel()
        del w["chempy/pkl.py"]
        self.assertRule("G5", wheel=w)

    def test_pkl_as_a_target(self) -> None:
        t = {**GOOD_TARGETS, "wheel": GOOD_TARGETS["wheel"] + ["chempy/pkl.py"]}
        self.assertRule("G5", targets=t)


class G6Order(PycCase):
    def test_dist_info_not_last(self) -> None:
        w = good_wheel()
        items = sorted(w.items(), key=lambda kv: kv[0].encode())  # plain byte order: dist-info lands mid-way
        self.assertNotEqual([n for n, _ in items], wheel_order(w))
        self.assertRule("G6", wheel=w, wheel_items=items)

    def test_not_byte_sorted(self) -> None:
        w = good_wheel()
        items = [(n, w[n]) for n in wheel_order(w)]
        items[0], items[1] = items[1], items[0]
        self.assertRule("G6", wheel=w, wheel_items=items)

    def test_duplicate_member(self) -> None:
        w = good_wheel()
        items = [(n, w[n]) for n in wheel_order(w)]
        items.insert(1, items[0])
        self.assertRule("G6", wheel=w, wheel_items=items)


class G7Targets(PycCase):
    def test_exact_list_passes(self) -> None:
        self.assertPass(targets=GOOD_TARGETS)

    def test_mismatches(self) -> None:
        s, w = good_stdlib(), good_wheel()
        cases = {
            "stdlib target not compiled": ({**GOOD_TARGETS, "stdlib": GOOD_TARGETS["stdlib"] + ["keep.py"]}, s, w),
            "stdlib .pyc not a target": ({**GOOD_TARGETS, "stdlib": ["os.py"]}, s, w),
            "wheel target not compiled": ({**GOOD_TARGETS, "wheel": GOOD_TARGETS["wheel"] + ["pymol/plain.py"]}, s, w),
            "wheel .pyc not a target": ({**GOOD_TARGETS, "wheel": ["pymol/__init__.py"]}, s, w),
            "wheel target not in the wheel": ({**GOOD_TARGETS, "wheel": GOOD_TARGETS["wheel"] + ["pymol/absent.py"]}, s, w),
        }
        for label, (t, s_, w_) in cases.items():
            with self.subTest(label=label):
                self.assertRule("G7", stdlib=s_, wheel=w_, targets=t)

    def test_bad_targets_file_exit_2(self) -> None:
        for label, t in {
            "not JSON": "{",
            "not an object": [],
            "schema 2": {**GOOD_TARGETS, "schema": 2},
            "unknown key": {**GOOD_TARGETS, "std": []},
            "missing list": {"schema": 1, "stdlib": []},
            "non-string entry": {**GOOD_TARGETS, "stdlib": [1]},
            "not .py": {**GOOD_TARGETS, "stdlib": ["os.pyc"]},
            "absolute": {**GOOD_TARGETS, "stdlib": ["/os.py"]},
            "dot-dot": {**GOOD_TARGETS, "wheel": ["../x.py"]},
            "pycache": {**GOOD_TARGETS, "wheel": ["pymol/__pycache__/x.py"]},
            "duplicate": {**GOOD_TARGETS, "stdlib": ["os.py", "os.py"]},
            "comment not a string": {**GOOD_TARGETS, "comment": 1},
        }.items():
            with self.subTest(label=label):
                self.assertExit2(targets=t)


class G8Expect(PycCase):
    def test_expect_without_pyc_fails(self) -> None:
        self.assertRule("G8", stdlib={"os.py": b"x = 1\n"}, wheel=plain_wheel(), extra=["--expect-pyc"])

    def test_expect_with_pyc_in_one_archive_only_fails(self) -> None:
        self.assertRule("G8", wheel=plain_wheel(), extra=["--expect-pyc"])


class InputsAndMagic(PycCase):
    def test_unreadable_inputs_exit_2(self) -> None:
        notzip = self.path("notzip.zip")
        with open(notzip, "wb") as fh:
            fh.write(b"not a zip")
        good_w = self.write_zip("w.whl", good_wheel(), order=[(n, good_wheel()[n]) for n in wheel_order(good_wheel())])
        for label, raw in {"stdlib not a zip": [notzip, good_w], "wheel missing": [notzip, self.path("nope.whl")]}.items():
            with self.subTest(label=label):
                self.assertExit2(raw=raw)

    def test_bad_lock_exit_2(self) -> None:
        for label, lock in {"no info": {}, "bad version": {"info": {"python": "three"}}, "not JSON": "{"}.items():
            with self.subTest(label=label):
                self.assertExit2(lock=lock)

    def test_bad_magic_argument_exit_2(self) -> None:
        for m in ("zz", "2b0e", "2b0e0d0b0c", "2b0e0000"):
            with self.subTest(magic=m):
                self.assertExit2(magic=m)

    def test_magic_cannot_be_derived_for_another_series(self) -> None:
        lock = {"info": {"python": "2.7.18"}}
        self.assertExit2(lock=lock, magic=None)
        # with an explicit magic the same runtime is judged (cache tag cpython-27)
        rep = self.assertPass(stdlib={"os.py": b""}, wheel=plain_wheel(), lock=lock)
        self.assertEqual(rep["cache_tag"], "cpython-27")

    @unittest.skipUnless(sys.implementation.name == "cpython" and sys.version_info.releaselevel == "final", "needs a final CPython host")
    def test_magic_derived_from_the_same_series(self) -> None:
        rep = self.assertPass(magic=None)
        self.assertEqual(rep["magic"], MAGIC.hex())
        self.assertTrue(rep["magic_source"].startswith("derived"), rep["magic_source"])

    def test_usage_errors_exit_2(self) -> None:
        for args in ([], ["--lock", self.path("x.json"), "only-one-archive"]):
            with self.subTest(args=args):
                proc = subprocess.run([sys.executable, "-I", "-B", GATE, *args], capture_output=True, text=True, check=False)
                self.assertEqual(proc.returncode, 2, proc.stdout + proc.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
