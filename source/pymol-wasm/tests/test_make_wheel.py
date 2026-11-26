"""Unit tests for make_wheel.py: write_wheel and the S1 drop (stdlib only).

    python3 -I -B tests/test_make_wheel.py

write_wheel is shared by make_wheel.py's main and the .pyc stage, and must
write the same bytes main wrote before it existed (the reference below is the
pre-S1 main's writer, verbatim in substance). --drop must remove exactly the
listed members or nothing, and the real s1_drop.json must apply to a stage
laid out like wheel.sh's.
"""

import base64
import contextlib
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import zipfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import make_wheel as mw  # noqa: E402

TOOL = os.path.join(HERE, "make_wheel.py")
DIST = "pymol-9.9.dist-info"


def legacy_write(files, dist_info, out, epoch):
    """make_wheel.py main's zip writing before write_wheel existed (the bytes it must keep)."""
    files = dict(files)
    date_time = time.gmtime(max(epoch, mw.ZIP_EPOCH))[:6]

    def order(name):
        return (name.startswith(dist_info + "/"), name.encode())

    def rh(data):
        return "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()

    record_name = f"{dist_info}/RECORD"
    rows = [f"{name},{rh(data)},{len(data)}" for name, data in sorted(files.items(), key=lambda kv: order(kv[0]))]
    rows.append(f"{record_name},,")
    files[record_name] = ("\n".join(rows) + "\n").encode()
    with zipfile.ZipFile(out, "w") as zf:
        for name in sorted(files, key=order):
            info = zipfile.ZipInfo(name, date_time=date_time)
            info.create_system = 3
            info.external_attr = (0o100644 & 0xFFFF) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, files[name], compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def sample_files():
    return {
        "pymol/__init__.py": b"x = 1\n" * 50,
        "pymol/Z.py": b"",
        "pymol/a.py": b"a",
        "chempy/__init__.py": bytes(range(256)) * 4,
        "pymol/_cmd.so": b"\x00asm" + b"\x01" * 1000,
        f"{DIST}/METADATA": b"Metadata-Version: 2.1\nName: pymol\n",
        f"{DIST}/WHEEL": b"Wheel-Version: 1.0\n",
        f"{DIST}/top_level.txt": b"pymol\n",
    }


class WriteWheel(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def read(self, p):
        with open(p, "rb") as fh:
            return fh.read()

    def test_same_bytes_as_the_pre_s1_writer(self):
        for epoch in (1791400572, 0):
            a, b = os.path.join(self.d, f"a{epoch}.whl"), os.path.join(self.d, f"b{epoch}.whl")
            n = mw.write_wheel(sample_files(), DIST, a, epoch)
            legacy_write(sample_files(), DIST, b, epoch)
            self.assertEqual(self.read(a), self.read(b))
            self.assertEqual(n, len(sample_files()) + 1)

    def test_layout_and_record(self):
        out = os.path.join(self.d, "w.whl")
        mw.write_wheel(sample_files(), DIST, out, 1791400572)
        with zipfile.ZipFile(out) as z:
            names = z.namelist()
            self.assertEqual(names, sorted(names, key=lambda n: (n.startswith(DIST + "/"), n.encode())))
            self.assertEqual(names[-4:], [f"{DIST}/METADATA", f"{DIST}/RECORD", f"{DIST}/WHEEL", f"{DIST}/top_level.txt"])
            self.assertEqual(names[:2], ["chempy/__init__.py", "pymol/Z.py"])  # byte order: 'Z' < '_' < 'a'
            for i in z.infolist():
                self.assertEqual(i.date_time, (2026, 10, 7, 19, 16, 12))
                self.assertEqual((i.create_system, i.external_attr >> 16, i.compress_type), (3, 0o100644, zipfile.ZIP_DEFLATED))
            rows = z.read(f"{DIST}/RECORD").decode().splitlines()
            self.assertEqual(rows[-1], f"{DIST}/RECORD,,")
            for row in rows[:-1]:
                name, digest, size = row.rsplit(",", 2)
                data = z.read(name)
                self.assertEqual(int(size), len(data))
                self.assertEqual(digest, mw._record_hash(data))
            self.assertEqual(len(rows), len(names))

    def test_epoch_before_1980_is_clamped(self):
        out = os.path.join(self.d, "w.whl")
        mw.write_wheel({"a": b"1"}, DIST, out, 0)
        with zipfile.ZipFile(out) as z:
            self.assertEqual(z.infolist()[0].date_time, (1980, 1, 1, 0, 0, 0))

    def test_record_is_refused_and_input_untouched(self):
        files = sample_files()
        before = dict(files)
        mw.write_wheel(files, DIST, os.path.join(self.d, "w.whl"), 1)
        self.assertEqual(files, before)
        files[f"{DIST}/RECORD"] = b""
        with self.assertRaises(ValueError):
            mw.write_wheel(files, DIST, os.path.join(self.d, "x.whl"), 1)

    def test_main_writes_through_write_wheel(self):
        st = os.path.join(self.d, "stage")
        os.makedirs(os.path.join(st, "pymol", "__pycache__"))
        os.makedirs(os.path.join(st, "chempy"))
        for rel, data in (("pymol/__init__.py", b"x\n"), ("pymol/__pycache__/x.cpython-314.pyc", b"pyc"),
                          ("pymol/stale.pyc", b"pyc"), ("chempy/a.pkl", b"\x80\x04.")):
            with open(os.path.join(st, *rel.split("/")), "wb") as fh:
                fh.write(data)
        out = os.path.join(self.d, "main.whl")
        env = dict(os.environ, SOURCE_DATE_EPOCH="1791400572")
        r = subprocess.run([sys.executable, "-I", TOOL, st, "9.9", "cp314-cp314-x", out], capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("6 members", r.stdout)
        files = {
            "pymol/__init__.py": b"x\n",
            "chempy/a.pkl": b"\x80\x04.",
            f"{DIST}/METADATA": b"Metadata-Version: 2.1\nName: pymol\nVersion: 9.9\nRequires-Dist: numpy\n",
            f"{DIST}/WHEEL": b"Wheel-Version: 1.0\nGenerator: agdb-pymol-wasm\nRoot-Is-Purelib: false\nTag: cp314-cp314-x\n",
            f"{DIST}/top_level.txt": b"pymol\n",
        }
        ref = os.path.join(self.d, "ref.whl")
        legacy_write(files, DIST, ref, 1791400572)
        self.assertEqual(self.read(out), self.read(ref))


class Drop(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.st = os.path.join(self.tmp.name, "stage")
        self.saved = dict(mw.S1_DROP_COUNTS)

    def tearDown(self):
        mw.S1_DROP_COUNTS.clear()
        mw.S1_DROP_COUNTS.update(self.saved)
        self.tmp.cleanup()

    def touch(self, *names):
        for n in names:
            p = os.path.join(self.st, *n.split("/"))
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "wb") as fh:
                fh.write(n.encode())

    def spec(self, **kw):
        s = {"schema": 1, "d_group": ["data/x/a.txt", "data/x/b.txt"], "p_group": ["pkg/gone/m.py"], "keep": ["pkg/kept.py"]}
        s.update(kw)
        p = os.path.join(self.tmp.name, "spec.json")
        with open(p, "w") as fh:
            json.dump(s, fh)
        return p

    def files(self):
        out = []
        for root, _, names in os.walk(self.st):
            out += [os.path.relpath(os.path.join(root, n), self.st).replace(os.sep, "/") for n in names]
        return sorted(out)

    def small(self):
        mw.S1_DROP_COUNTS.clear()
        mw.S1_DROP_COUNTS.update({"d_group": 2, "p_group": 1})
        self.touch("data/x/a.txt", "data/x/b.txt", "data/y.txt", "pkg/gone/m.py", "pkg/kept.py")

    def test_removes_exactly_the_list_and_emptied_folders(self):
        self.small()
        counts = mw.drop_members(self.st, self.spec())
        self.assertEqual(self.files(), ["data/y.txt", "pkg/kept.py"])
        self.assertFalse(os.path.exists(os.path.join(self.st, "data", "x")))
        self.assertFalse(os.path.exists(os.path.join(self.st, "pkg", "gone")))
        self.assertTrue(os.path.isdir(os.path.join(self.st, "pkg")))
        self.assertEqual((counts["d_group"], counts["p_group"], counts["folders_removed"]), (2, 1, 2))

    def refused(self, spec_path):
        before = self.files()
        with self.assertRaises(SystemExit) as cm, contextlib.redirect_stderr(io.StringIO()):
            mw.drop_members(self.st, spec_path)
        self.assertNotEqual(cm.exception.code, 0)
        self.assertEqual(self.files(), before, "a refused drop must remove nothing")

    def test_missing_member_removes_nothing(self):
        self.small()
        os.remove(os.path.join(self.st, "data", "x", "b.txt"))
        self.refused(self.spec())

    def test_wrong_counts(self):
        self.small()
        self.refused(self.spec(d_group=["data/x/a.txt"]))
        self.refused(self.spec(p_group=["pkg/gone/m.py", "data/y.txt"]))

    def test_duplicates_unsafe_names_and_schema(self):
        self.small()
        self.refused(self.spec(d_group=["data/x/a.txt", "data/x/a.txt"]))
        self.refused(self.spec(d_group=["data/x/a.txt", "../stage/data/x/b.txt"]))
        self.refused(self.spec(d_group=["data/x/a.txt", "/data/x/b.txt"]))
        self.refused(self.spec(p_group=["data/x/b.txt"], d_group=["data/x/a.txt", "data/x/b.txt"]))
        self.refused(self.spec(schema=2))

    def test_keep_listed_or_missing(self):
        self.small()
        self.refused(self.spec(keep=["data/x/a.txt"]))
        self.refused(self.spec(keep=["pkg/not_there.py"]))

    def test_cli(self):
        self.small()
        bad = subprocess.run([sys.executable, "-I", TOOL, "--drop", self.st, self.spec(schema=0)], capture_output=True, text=True)
        self.assertEqual(bad.returncode, 1)
        # the real counts (61 / 31) apply in a fresh process
        r = subprocess.run([sys.executable, "-I", TOOL, "--drop", self.st, self.spec()], capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertIn("expected 61", r.stderr)

    def test_the_real_list_on_a_stage_laid_out_like_wheel_sh(self):
        with open(os.path.join(HERE, "s1_drop.json"), encoding="utf-8") as fh:
            spec = json.load(fh)
        listed = spec["d_group"] + spec["p_group"]
        others = ["pymol/__init__.py", "pymol/wizard/mutagenesis.py", "chempy/__init__.py",
                  "pymol/pymol_path/data/pymol/cmyk.png", "pymol/pymol_path/data/chempy/fragments/ala.pkl",
                  "pymol/pymol_path/data/chempy/sidechains/sc_bb_dep.pkl", "pymol/pymol_path/data/chem_comp_bond-top100.cif"]
        self.touch(*(listed + spec["keep"] + others))
        counts = mw.drop_members(self.st, os.path.join(HERE, "s1_drop.json"))
        self.assertEqual((counts["d_group"], counts["p_group"]), (61, 31))
        self.assertEqual(self.files(), sorted(spec["keep"] + others))
        for gone in ("pymol/pymol_path/data/shaders", "pymol/pymol_path/data/startup", "pymol/Qt", "pymol/plugins",
                     "chempy/tinker", "chempy/bmin", "chempy/fast", "chempy/mmtf"):
            self.assertFalse(os.path.exists(os.path.join(self.st, *gone.split("/"))), gone)


class RealList(unittest.TestCase):
    """What s1_drop.json holds (design S1-7 / S1-8, evidence 3.7 / 3.8)."""

    @classmethod
    def setUpClass(cls):
        with open(os.path.join(HERE, "s1_drop.json"), encoding="utf-8") as fh:
            cls.spec = json.load(fh)

    def test_d_group(self):
        d = self.spec["d_group"]
        pre = "pymol/pymol_path/data/"
        self.assertEqual(len(d), 61)
        self.assertEqual(sum(n.startswith(pre + "shaders/") for n in d), 44)
        self.assertEqual(sum(n.startswith(pre + "startup/") for n in d), 8)
        rest = sorted(n for n in d if not n.startswith((pre + "shaders/", pre + "startup/")))
        self.assertEqual(rest, sorted([pre + "chempy/sidechains/" + f for f in
                                       ("generate1.py", "generate2.py", "sc_bb_dep.py", "sc_bb_ind.py", "sc_library.pkl")]
                                      + [pre + "pymol/" + f for f in ("hsv.ppm", "icons/icon2.svg", "splash.png")]
                                      + [pre + "setting_help.csv"]))

    def test_p_group(self):
        import re
        rules = [r"^pymol/Qt/", r"^pymol/plugins/", r"^pymol/(pymolhttpd|rpc)\.py$", r"^pymol/(mpeg_encode|xwin)\.py$",
                 r"^pymol/(seqalign|cgobuilder)\.py$", r"^pymol/wizard/(demo|stereodemo|cleanup)\.py$",
                 r"^chempy/tinker/", r"^chempy/bmin/", r"^chempy/fast/", r"^chempy/mmtf/", r"^chempy/gamess1\.py$"]
        p = self.spec["p_group"]
        self.assertEqual(len(p), 31)
        self.assertEqual([n for n in p if not any(re.search(r, n) for r in rules)], [])

    def test_kept_members(self):
        self.assertEqual(sorted(self.spec["keep"]), sorted([
            "pymol/pymol_path/data/chempy/water.pdb", "pymol/lazyio.py", "chempy/dictdb.py",
            "pymol/wizard/benchmark.py", "pymol/wizard/openvr.py"]))
        listed = set(self.spec["d_group"]) | set(self.spec["p_group"])
        self.assertFalse(listed & set(self.spec["keep"]))
        # S2-3 keeps the bundled fragments: none of them is listed
        self.assertFalse([n for n in listed if "/fragments/" in n])


if __name__ == "__main__":
    unittest.main()
