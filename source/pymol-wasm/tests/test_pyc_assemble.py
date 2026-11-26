"""Unit tests for pyc_assemble.py on synthetic stdlib zips, wheels and .pyc dirs (stdlib only).

    python3 -I -B tests/test_pyc_assemble.py

The synthetic runtime is the host's CPython (its magic, cache tag and marshal), so it
runs anywhere; the input wheels are written by make_wheel.write_wheel, the function the
assembler itself uses. Pinned: the in-place sourceless replacement, the level-9 repack
that keeps every other member's content and fields, stored members staying stored, the
__pycache__ naming, every refusal (exit 1) and usage error (exit 2), no output left
behind on a refusal, determinism, and that tests/check_pyc.py passes the result.
"""

from __future__ import annotations

import _imp
import hashlib
import importlib.util
import json
import marshal
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
import zlib
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TOOL = os.path.join(ROOT, "pyc_assemble.py")
GATE = os.path.join(HERE, "check_pyc.py")
MAGIC = importlib.util.MAGIC_NUMBER
VI = sys.version_info
TAG = f"cpython-{VI.major}{VI.minor}"
VERSION = f"{VI.major}.{VI.minor}.{VI.micro}"
EPOCH = 1791400572  # the pinned PyMOL commit's time, as build.sh's SOURCE_DATE_EPOCH
DIST = "pymol-3.2.0a.dist-info"
PKL_SRC = b"RESTRICTED_GLOBALS = {}\n\ndef restricted_loads(b):\n    pass\n\npickle.loads = restricted_loads\n"


def _load_make_wheel() -> Any:
    spec = importlib.util.spec_from_file_location("make_wheel", os.path.join(ROOT, "make_wheel.py"))
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


MW = _load_make_wheel()


def pyc(src: bytes, dfile: str, *, magic: bytes = MAGIC, flags: int = 0b01, hash_of: bytes | None = None) -> bytes:
    code = compile(src, dfile, "exec", dont_inherit=True, optimize=0)
    h = _imp.source_hash(int.from_bytes(magic, "little"), src if hash_of is None else hash_of)
    # nosemgrep: marshal-usage — dumps a code object this test just compiled from its own literal source, to build a fixture .pyc
    return magic + flags.to_bytes(4, "little") + h + marshal.dumps(code)


# Varied text whose deflate output differs between level 6 and level 9.
VARIED = b"".join(("V%d = %d  # %s\n" % (i, i * i % 9973, hashlib.sha256(str(i).encode()).hexdigest()[: i % 40])).encode() for i in range(2000))

# The stdlib stand-in: deflated files at level 6 (like the core's zip), stored directory
# entries, and one stored file, in a non-sorted order the assembler must keep.
STD_MEMBERS: list[tuple[str, bytes, int]] = [
    ("zz_first.py", b"Z = 'first member, not a target'\n" * 20, zipfile.ZIP_DEFLATED),
    ("json/", b"", zipfile.ZIP_STORED),
    ("json/__init__.py", b"from .decoder import D\nJ = 1\n" * 30, zipfile.ZIP_DEFLATED),
    ("json/decoder.py", b"D = 'decoder'\n" * 40, zipfile.ZIP_DEFLATED),
    ("os_extra.py", b"X = [i * i for i in range(10)]\n" * 25, zipfile.ZIP_DEFLATED),
    ("stored.txt", b"kept stored\n" * 10, zipfile.ZIP_STORED),
    ("keep/", b"", zipfile.ZIP_STORED),
    ("keep/data.py", VARIED, zipfile.ZIP_DEFLATED),
]
STD_TARGETS = ["json/__init__.py", "os_extra.py"]

WHEEL_FILES: dict[str, bytes] = {
    "chempy/__init__.py": b"C = 1\n" * 10,
    "chempy/pkl.py": PKL_SRC,
    "pymol/__init__.py": b"P = 'pymol'\n" * 10,
    "pymol/cmd.py": b"def load(x):\n    return x\n" * 5,
    "pymol/plain.py": b"N = 'not a target'\n",
    "toplevel.py": b"T = 1\n",
    "pymol/pymol_path/data/x.txt": b"data\n",
    f"{DIST}/METADATA": b"Metadata-Version: 2.1\nName: pymol\nVersion: 3.2.0a\n",
    f"{DIST}/WHEEL": b"Wheel-Version: 1.0\n",
}
WHEEL_TARGETS = ["chempy/__init__.py", "pymol/__init__.py", "pymol/cmd.py", "toplevel.py"]


def pycache(src: str) -> str:
    d, _, base = src.rpartition("/")
    return (d + "/" if d else "") + f"__pycache__/{base[:-3]}.{TAG}.pyc"


def level(data: bytes, lvl: int) -> bytes:
    co = zlib.compressobj(lvl, zlib.DEFLATED, -15)
    return co.compress(data) + co.flush()


def raw_member(path: str, info: zipfile.ZipInfo) -> bytes:
    with open(path, "rb") as fh:
        fh.seek(info.header_offset)
        head = fh.read(30)
        n = int.from_bytes(head[26:28], "little")
        m = int.from_bytes(head[28:30], "little")
        fh.seek(info.header_offset + 30 + n + m)
        return fh.read(info.compress_size)


class AssembleCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.d = self._tmp.name

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def path(self, *parts: str) -> str:
        return os.path.join(self.d, *parts)

    # ---- inputs -----------------------------------------------------------------
    def write_stdlib(self, members: list[tuple[str, bytes, int]] | None = None) -> str:
        p = self.path("python_stdlib.zip")
        with zipfile.ZipFile(p, "w") as z:
            for name, data, ct in STD_MEMBERS if members is None else members:
                info = zipfile.ZipInfo(name, date_time=(2026, 9, 14, 3, 3, 50))
                info.create_system = 3
                info.external_attr = ((0o40755 << 16) | 0x10) if name.endswith("/") else (0o100644 << 16)
                z.writestr(info, data, compress_type=ct, compresslevel=6 if ct == zipfile.ZIP_DEFLATED else None)
        return p

    def write_wheel(self, files: dict[str, bytes] | None = None, epoch: int = EPOCH, name: str = "in.whl") -> str:
        p = self.path(name)
        MW.write_wheel(dict(WHEEL_FILES if files is None else files), DIST, p, epoch)
        return p

    def write_pyc_dir(
        self,
        name: str,
        kind: str,
        archive: str,
        targets: list[str],
        prefix: str,
        *,
        tamper: dict[str, bytes | None] | None = None,
        summary_patch: dict[str, Any] | None = None,
    ) -> str:
        """What pyc_compile.mjs writes: <member>c files and _summary.json."""
        out = self.path(name)
        os.makedirs(out)
        with zipfile.ZipFile(archive) as z:
            blobs = {t + "c": pyc(z.read(t), prefix + t) for t in targets}
        for k, v in (tamper or {}).items():
            if v is None:
                blobs.pop(k, None)
            else:
                blobs[k] = v
        for k, v in blobs.items():
            os.makedirs(os.path.dirname(os.path.join(out, k)), exist_ok=True)
            with open(os.path.join(out, k), "wb") as fh:
                fh.write(v)
        with open(archive, "rb") as fh:
            arch_sha = hashlib.sha256(fh.read()).hexdigest()
        summary = {
            "tool": "pyc_compile",
            "kind": kind,
            "archive_sha256": arch_sha,
            "version": VERSION,
            "cache_tag": TAG,
            "magic": MAGIC.hex(),
            "sha256": {k: hashlib.sha256(v).hexdigest() for k, v in blobs.items()},
        }
        summary.update(summary_patch or {})
        with open(os.path.join(out, "_summary.json"), "w") as fh:
            json.dump(summary, fh)
        return out

    def write_targets(self, stdlib: list[str] | None = None, wheel: list[str] | None = None) -> str:
        p = self.path("pyc_targets.json")
        with open(p, "w") as fh:
            json.dump({"schema": 1, "stdlib": STD_TARGETS if stdlib is None else stdlib, "wheel": WHEEL_TARGETS if wheel is None else wheel}, fh)
        return p

    # ---- the tool -----------------------------------------------------------------
    def assemble(
        self,
        *,
        std_dir: str | None = None,
        site_dir: str | None = None,
        targets: str | None = None,
        stdlib: str | None = None,
        wheel: str | None = None,
        epoch: str | None = str(EPOCH),
        tag: str = "out",
    ) -> tuple[int, str, dict[str, Any] | None, str, str]:
        stdlib = stdlib or self.write_stdlib()
        wheel = wheel or self.write_wheel()
        std_dir = std_dir or self.write_pyc_dir(tag + ".std", "std", stdlib, STD_TARGETS, "/lib/python3x.zip/")
        site_dir = site_dir or self.write_pyc_dir(tag + ".site", "site", wheel, WHEEL_TARGETS, "/lib/site-packages/")
        targets = targets or self.write_targets()
        os.makedirs(self.path(tag), exist_ok=True)
        s_out, w_out = self.path(tag, "python_stdlib.zip"), self.path(tag, "pymol.whl")
        rep = self.path(tag, "report.json")
        env = {k: v for k, v in os.environ.items() if k != "SOURCE_DATE_EPOCH"}
        if epoch is not None:
            env["SOURCE_DATE_EPOCH"] = epoch
        args = [sys.executable, "-I", "-B", TOOL, "--json", rep, targets, stdlib, std_dir, s_out, wheel, site_dir, w_out]
        proc = subprocess.run(args, capture_output=True, text=True, check=False, env=env)
        data = None
        if os.path.exists(rep):
            with open(rep) as fh:
                data = json.load(fh)
        return proc.returncode, proc.stdout + proc.stderr, data, s_out, w_out

    def assertRefused(self, needle: str, **kw: Any) -> str:
        rc, out, rep, s_out, w_out = self.assemble(**kw)
        self.assertEqual(rc, 1, out)
        self.assertIn(needle, out)
        self.assertIsNotNone(rep)
        assert rep is not None
        self.assertFalse(rep["ok"])
        for p in (s_out, w_out):
            self.assertFalse(os.path.exists(p), f"{p} written although the assembly was refused")
        self.assertEqual([f for f in os.listdir(os.path.dirname(s_out)) if f.endswith(".tmp")], [], "temporary output left behind")
        return out


class Stdlib(AssembleCase):
    def test_in_place_sourceless_replacement(self) -> None:
        rc, out, rep, s_out, _ = self.assemble()
        self.assertEqual(rc, 0, out)
        src = self.path("python_stdlib.zip")
        with zipfile.ZipFile(src) as zi, zipfile.ZipFile(s_out) as zo:
            ii, oo = zi.infolist(), zo.infolist()
            self.assertEqual(len(ii), len(oo))
            for i, o in zip(ii, oo):
                want = i.filename + "c" if i.filename in STD_TARGETS else i.filename
                self.assertEqual(o.filename, want, "replacement must keep the member's position")
                for f in ("date_time", "compress_type", "create_system", "external_attr", "internal_attr", "extra", "comment", "flag_bits"):
                    self.assertEqual(getattr(o, f), getattr(i, f), f"{o.filename}.{f}")
            names = zo.namelist()
            for t in STD_TARGETS:
                self.assertNotIn(t, names, "sourceless: the .py must be gone")
                blob = zo.read(t + "c")
                self.assertEqual(blob[:4], MAGIC)
                self.assertEqual(int.from_bytes(blob[4:8], "little"), 1)
                self.assertEqual(blob[8:16], _imp.source_hash(int.from_bytes(MAGIC, "little"), zi.read(t)))
                # nosemgrep: marshal-usage — loads the .pyc this test built from its own literal sources, to read the dfile back
                self.assertEqual(marshal.loads(blob[16:]).co_filename, "/lib/python3x.zip/" + t)
        assert rep is not None
        self.assertEqual((rep["stdlib"]["replaced"], rep["stdlib"]["members"], rep["stdlib"]["untouched_same_content"]), (2, 8, 6))

    def test_level9_repack_keeps_contents_and_stored_stays_stored(self) -> None:
        rc, out, rep, s_out, _ = self.assemble()
        self.assertEqual(rc, 0, out)
        src = self.path("python_stdlib.zip")
        with zipfile.ZipFile(src) as zi, zipfile.ZipFile(s_out) as zo:
            for i, o in zip(zi.infolist(), zo.infolist()):
                data = zo.read(o)
                if i.filename not in STD_TARGETS:
                    self.assertEqual((o.CRC, o.file_size), (i.CRC, i.file_size), o.filename)
                    self.assertEqual(data, zi.read(i), o.filename)
                if i.compress_type == zipfile.ZIP_STORED:
                    self.assertEqual(o.compress_type, zipfile.ZIP_STORED, o.filename)
                    self.assertEqual(raw_member(s_out, o), data, o.filename)
                else:
                    self.assertEqual(raw_member(s_out, o), level(data, 9), f"{o.filename} is not deflate level 9")
            # The input really was level 6, so the repack is observable on some member.
            self.assertTrue(any(raw_member(src, i) != level(zi.read(i), 9) for i in zi.infolist() if i.compress_type == zipfile.ZIP_DEFLATED))
        assert rep is not None
        self.assertEqual((rep["stdlib"]["stored"], rep["stdlib"]["deflated_level"]), (3, 9))

    def test_missing_target_refused(self) -> None:
        self.assertRefused("not in", targets=self.write_targets(stdlib=STD_TARGETS + ["absent.py"]))

    def test_dropped_pyc_refused(self) -> None:
        s = self.write_stdlib()
        d = self.write_pyc_dir("std", "std", s, STD_TARGETS, "/x/", tamper={"os_extra.pyc": None})
        self.assertRefused("without a .pyc", stdlib=s, std_dir=d)

    def test_added_pyc_refused(self) -> None:
        s = self.write_stdlib()
        d = self.write_pyc_dir("std", "std", s, STD_TARGETS, "/x/", tamper={"keep/data.pyc": pyc(b"K = 1\n", "x")})
        self.assertRefused("not targets", stdlib=s, std_dir=d)

    def test_stale_or_foreign_pyc_refused(self) -> None:
        s = self.write_stdlib()
        stale = pyc(b"J = 'old'\n", "x")
        d = self.write_pyc_dir("std", "std", s, STD_TARGETS, "/x/", tamper={"json/__init__.pyc": stale})
        self.assertRefused("source hash", stdlib=s, std_dir=d)

    def test_wrong_magic_or_flags_refused(self) -> None:
        other = bytes([MAGIC[0] ^ 1, MAGIC[1]]) + b"\r\n"
        for label, blob, needle in (
            ("magic", lambda src: pyc(src, "x", magic=other), "magic"),
            ("timestamp pyc", lambda src: pyc(src, "x", flags=0), "flags"),
        ):
            with self.subTest(label=label):
                sub = tempfile.mkdtemp(dir=self.d)
                s = self.path(sub, "python_stdlib.zip")
                os.replace(self.write_stdlib(), s)
                with zipfile.ZipFile(s) as z:
                    bad = blob(z.read("json/__init__.py"))
                d = self.write_pyc_dir(os.path.join(sub, "std"), "std", s, STD_TARGETS, "/x/", tamper={"json/__init__.pyc": bad})
                self.assertRefused(needle, stdlib=s, std_dir=d, tag=os.path.join(sub, "out"))

    def test_pyc_changed_after_compiling_refused(self) -> None:
        s = self.write_stdlib()
        d = self.write_pyc_dir("std", "std", s, STD_TARGETS, "/x/", summary_patch={"sha256": {"json/__init__.pyc": "0" * 64, "os_extra.pyc": "0" * 64}})
        self.assertRefused("changed after compiling", stdlib=s, std_dir=d)

    def test_pyc_dir_of_another_archive_refused(self) -> None:
        s = self.write_stdlib()
        d = self.write_pyc_dir("std", "std", s, STD_TARGETS, "/x/", summary_patch={"archive_sha256": "f" * 64})
        self.assertRefused("another archive", stdlib=s, std_dir=d)

    def test_compiles_disagreeing_on_magic_refused(self) -> None:
        s = self.write_stdlib()
        d = self.write_pyc_dir("std", "std", s, STD_TARGETS, "/x/", summary_patch={"version": "3.0.0"})
        self.assertRefused("disagree", stdlib=s, std_dir=d)


class Wheel(AssembleCase):
    def test_pycache_naming_and_sources_kept(self) -> None:
        rc, out, rep, _, w_out = self.assemble()
        self.assertEqual(rc, 0, out)
        with zipfile.ZipFile(self.path("in.whl")) as zi, zipfile.ZipFile(w_out) as zo:
            names = zo.namelist()
            self.assertEqual(names, sorted(names, key=lambda n: (".dist-info/" in n, n.encode())))
            self.assertEqual(len(names), len(zi.namelist()) + len(WHEEL_TARGETS))
            for n in zi.namelist():
                if not n.endswith("/RECORD"):
                    self.assertEqual(zo.read(n), zi.read(n), n)
            for t in WHEEL_TARGETS:
                blob = zo.read(pycache(t))
                self.assertEqual(blob[8:16], _imp.source_hash(int.from_bytes(MAGIC, "little"), zo.read(t)))
            self.assertIn(f"__pycache__/toplevel.{TAG}.pyc", names)
            self.assertIn(f"pymol/__pycache__/cmd.{TAG}.pyc", names)
            self.assertFalse([n for n in names if "pkl." in n and n.endswith(".pyc")])
            record = zo.read(f"{DIST}/RECORD").decode()
            self.assertIn(f"pymol/__pycache__/cmd.{TAG}.pyc,sha256=", record)
            self.assertEqual(len(record.splitlines()), len(names))
            self.assertEqual({i.date_time for i in zo.infolist()}, {i.date_time for i in zi.infolist()})
        assert rep is not None
        self.assertEqual((rep["wheel"]["pycache_added"], rep["wheel"]["members"]), (4, len(WHEEL_FILES) + 1 + 4))

    def test_output_is_what_write_wheel_makes(self) -> None:
        rc, out, _, _, w_out = self.assemble()
        self.assertEqual(rc, 0, out)
        files = dict(WHEEL_FILES)
        with zipfile.ZipFile(w_out) as zo:
            for t in WHEEL_TARGETS:
                files[pycache(t)] = zo.read(pycache(t))
        ref = self.path("ref.whl")
        MW.write_wheel(files, DIST, ref, EPOCH)
        with open(ref, "rb") as a, open(w_out, "rb") as b:
            self.assertEqual(a.read(), b.read())

    def test_pkl_listed_refused(self) -> None:
        self.assertRefused("chempy/pkl.py", targets=self.write_targets(wheel=WHEEL_TARGETS + ["chempy/pkl.py"]))

    def test_pkl_compiled_refused(self) -> None:
        w = self.write_wheel()
        d = self.write_pyc_dir("site", "site", w, WHEEL_TARGETS, "/s/", tamper={"chempy/pkl.pyc": pyc(PKL_SRC, "x")})
        self.assertRefused("not targets", wheel=w, site_dir=d)

    def test_missing_target_refused(self) -> None:
        self.assertRefused("not in", targets=self.write_targets(wheel=WHEEL_TARGETS + ["pymol/absent.py"]))

    def test_wheel_already_compiled_refused(self) -> None:
        w = self.write_wheel({**WHEEL_FILES, f"pymol/__pycache__/plain.{TAG}.pyc": pyc(b"N = 1\n", "x")})
        self.assertRefused("already carries compiled", wheel=w)

    def test_record_mismatch_refused(self) -> None:
        good = self.write_wheel(name="good.whl")
        bad = self.path("in.whl")
        with zipfile.ZipFile(good) as zi, zipfile.ZipFile(bad, "w") as zo:
            for i in zi.infolist():
                data = zi.read(i)
                if i.filename == "pymol/plain.py":
                    data = b"N = 'edited after RECORD was written'\n"
                zo.writestr(i, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        self.assertRefused("RECORD does not match", wheel=bad)

    def test_timestamps_not_source_date_epoch_refused(self) -> None:
        w = self.write_wheel(epoch=EPOCH + 3600)
        self.assertRefused("SOURCE_DATE_EPOCH", wheel=w)


class Cli(AssembleCase):
    def test_deterministic(self) -> None:
        s, w = self.write_stdlib(), self.write_wheel()
        sd = self.write_pyc_dir("std", "std", s, STD_TARGETS, "/x/")
        wd = self.write_pyc_dir("site", "site", w, WHEEL_TARGETS, "/s/")
        outs = []
        for tag in ("a", "b"):
            rc, out, _, s_out, w_out = self.assemble(stdlib=s, wheel=w, std_dir=sd, site_dir=wd, tag=tag)
            self.assertEqual(rc, 0, out)
            with open(s_out, "rb") as f1, open(w_out, "rb") as f2:
                outs.append((f1.read(), f2.read()))
        self.assertEqual(outs[0], outs[1])

    def test_check_pyc_passes_the_result(self) -> None:
        rc, out, _, s_out, w_out = self.assemble()
        self.assertEqual(rc, 0, out)
        lock = self.path("lock.json")
        with open(lock, "w") as fh:
            json.dump({"info": {"python": VERSION}}, fh)
        args = [sys.executable, "-I", "-B", GATE, "--lock", lock, "--magic", MAGIC.hex(), "--targets", self.write_targets(), "--expect-pyc", s_out, w_out]
        proc = subprocess.run(args, capture_output=True, text=True, check=False)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)

    def test_no_source_date_epoch_is_exit_2(self) -> None:
        rc, out, rep, s_out, w_out = self.assemble(epoch=None)
        self.assertEqual(rc, 2, out)
        assert rep is not None
        self.assertFalse(rep["ok"])
        self.assertFalse(os.path.exists(s_out) or os.path.exists(w_out))

    def test_bad_targets_is_exit_2(self) -> None:
        p = self.path("bad_targets.json")
        with open(p, "w") as fh:
            json.dump({"schema": 2, "stdlib": [], "wheel": []}, fh)
        rc, out, _, _, _ = self.assemble(targets=p)
        self.assertEqual(rc, 2, out)

    def test_output_over_an_input_is_exit_2(self) -> None:
        s, w = self.write_stdlib(), self.write_wheel()
        sd = self.write_pyc_dir("std", "std", s, STD_TARGETS, "/x/")
        wd = self.write_pyc_dir("site", "site", w, WHEEL_TARGETS, "/s/")
        env = {**os.environ, "SOURCE_DATE_EPOCH": str(EPOCH)}
        args = [sys.executable, "-I", "-B", TOOL, self.write_targets(), s, sd, s, w, wd, self.path("o.whl")]
        proc = subprocess.run(args, capture_output=True, text=True, check=False, env=env)
        self.assertEqual(proc.returncode, 2, proc.stdout + proc.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
