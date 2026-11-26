"""Unit tests for numpy_trim.py on synthetic wheels (stdlib only).

    python3 -I -B tests/test_numpy_trim.py

The stage must drop exactly the listed members or write nothing: every
refusal case below leaves the output path as it was. Kept members keep their
bytes, compressed streams, order and ZipInfo fields; RECORD loses only the
dropped rows and keeps its position; the output is the same bytes from
another directory. The committed numpy_drop.json must agree with the rule and
the pins in numpy_trim.py.
"""

import base64
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import numpy_trim as nt  # noqa: E402

TOOL = os.path.join(HERE, "numpy_trim.py")
NAME = "numpy-0.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl"
DIST = "numpy-0.0.dist-info"


def _payload(name, n=400):
    # varied, compressible text so deflate levels differ on it
    return ("".join(f"{name}:{i}:{(i * 7919) % 1013}\n" for i in range(n))).encode()


# (name, data, date_time, external mode, compress_type); dist-info last, RECORD last
MEMBERS = [
    ("numpy/__init__.py", _payload("init"), (2026, 9, 11, 8, 1, 22), 0o644, zipfile.ZIP_DEFLATED),
    ("numpy/__init__.pyi", _payload("stub"), (2026, 9, 11, 8, 1, 24), 0o600, zipfile.ZIP_DEFLATED),
    ("numpy/__init__.pxd", _payload("pxd"), (2026, 9, 11, 8, 1, 26), 0o600, zipfile.ZIP_DEFLATED),
    ("numpy/conftest.py", _payload("conftest"), (2026, 9, 11, 8, 1, 22), 0o600, zipfile.ZIP_DEFLATED),
    ("numpy/py.typed", b"", (2026, 9, 11, 8, 1, 22), 0o600, zipfile.ZIP_DEFLATED),
    ("numpy/_core/_multiarray_umath.cpython-314-wasm32-emscripten.so", bytes(range(256)) * 40,
     (2026, 9, 11, 8, 1, 30), 0o755, zipfile.ZIP_DEFLATED),
    ("numpy/_core/include/numpy/arrayobject.h", _payload("hdr"), (2026, 9, 11, 8, 1, 22), 0o600, zipfile.ZIP_DEFLATED),
    ("numpy/_core/include/numpy/random/LICENSE.txt", _payload("lic"), (2026, 9, 11, 8, 1, 22), 0o600,
     zipfile.ZIP_DEFLATED),
    ("numpy/_core/lib/libnpymath.a", bytes(range(200)) * 30, (2026, 9, 11, 8, 1, 22), 0o600, zipfile.ZIP_STORED),
    ("numpy/_core/lib/pkgconfig/numpy.pc", _payload("pc", 20), (2026, 9, 11, 8, 1, 22), 0o600, zipfile.ZIP_DEFLATED),
    ("numpy/_pyinstaller/__init__.py", b"", (2026, 9, 11, 8, 1, 22), 0o600, zipfile.ZIP_DEFLATED),
    ("numpy/doc/ufuncs.py", _payload("doc"), (2026, 9, 11, 8, 1, 22), 0o600, zipfile.ZIP_DEFLATED),
    ("numpy/f2py/__init__.py", _payload("f2py"), (2026, 9, 11, 8, 1, 22), 0o600, zipfile.ZIP_DEFLATED),
    ("numpy/f2py/src/fortranobject.c", _payload("csrc"), (2026, 9, 11, 8, 1, 22), 0o600, zipfile.ZIP_DEFLATED),
    ("numpy/random/_examples/cython/meson.build", _payload("meson", 30), (2026, 9, 11, 8, 1, 22), 0o600,
     zipfile.ZIP_DEFLATED),
    ("numpy/random/_examples/cython/extending.pyx", _payload("pyx"), (2026, 9, 11, 8, 1, 22), 0o600,
     zipfile.ZIP_DEFLATED),
    ("numpy/testing/__init__.py", _payload("testing"), (2026, 9, 11, 8, 1, 22), 0o600, zipfile.ZIP_DEFLATED),
    (f"{DIST}/licenses/LICENSE.txt", _payload("license"), (2026, 9, 11, 8, 1, 22), 0o600, zipfile.ZIP_DEFLATED),
    (f"{DIST}/METADATA", _payload("meta", 30), (2026, 9, 11, 8, 1, 22), 0o600, zipfile.ZIP_DEFLATED),
]
DROPPED = {
    "pyinstaller-hook": ["numpy/_pyinstaller/__init__.py"],
    "doc-module": ["numpy/doc/ufuncs.py"],
    "pytest-config": ["numpy/conftest.py"],
    "type-stub": ["numpy/__init__.pyi", "numpy/py.typed"],
    "c-header": ["numpy/_core/include/numpy/arrayobject.h"],
    "static-library": ["numpy/_core/lib/libnpymath.a"],
    "cython-source": ["numpy/__init__.pxd", "numpy/random/_examples/cython/extending.pyx"],
    "c-source": ["numpy/f2py/src/fortranobject.c"],
    "build-config": ["numpy/_core/lib/pkgconfig/numpy.pc", "numpy/random/_examples/cython/meson.build"],
}
COUNTS = {c: len(v) for c, v in DROPPED.items()}


def read(path):
    with open(path, "rb") as fh:
        return fh.read()


def write(path, data):
    with open(path, "wb") as fh:
        fh.write(data)


def rec_hash(data):
    return "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()


def make_wheel(path, members=MEMBERS, record_level=6, record_rows=None, record_extra=""):
    rows = record_rows if record_rows is not None else [f"{n},{rec_hash(d)},{len(d)}" for n, d, *_ in members]
    record = ("\n".join(rows + [f"{DIST}/RECORD,,"]) + "\n" + record_extra).encode()
    with zipfile.ZipFile(path, "w") as z:
        for n, d, dt, mode, ct in members:
            zi = zipfile.ZipInfo(n, date_time=dt)
            zi.create_system = 3
            zi.external_attr = mode << 16
            z.writestr(zi, d, compress_type=ct, compresslevel=6)
        zi = zipfile.ZipInfo(f"{DIST}/RECORD", date_time=(2026, 9, 11, 8, 1, 22))
        zi.create_system = 3
        zi.external_attr = 0o600 << 16
        z.writestr(zi, record, compress_type=zipfile.ZIP_DEFLATED, compresslevel=record_level)
    return record


def drop_doc(path, wheel, drop=None, counts=None, total=None, input_override=None):
    drop = DROPPED if drop is None else drop
    raw = read(wheel)
    doc = {
        "input": input_override or {"file_name": os.path.basename(wheel), "sha256": hashlib.sha256(raw).hexdigest(),
                                    "members": len(zipfile.ZipFile(io.BytesIO(raw)).namelist())},
        "counts": counts if counts is not None else {c: len(v) for c, v in drop.items()},
        "total": total if total is not None else sum(len(v) for v in drop.values()),
        "drop": drop,
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh)


class Case(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="numpy-trim-test-")
        os.makedirs(os.path.join(self.tmp, "in"))
        os.makedirs(os.path.join(self.tmp, "out"))
        self.src = os.path.join(self.tmp, "in", NAME)
        self.record = make_wheel(self.src)
        self.drop = os.path.join(self.tmp, "drop.json")
        drop_doc(self.drop, self.src)
        self.out = os.path.join(self.tmp, "out", NAME)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def pins(self, **kw):
        raw = read(self.src)
        p = {"pinned_name": NAME, "pinned_sha256": hashlib.sha256(raw).hexdigest(),
             "pinned_members": len(MEMBERS) + 1, "pinned_counts": dict(COUNTS)}
        p.update(kw)
        return p

    def run_trim(self, **kw):
        return nt.trim(self.src, self.drop, self.out, **self.pins(**kw))

    def refuses(self, pattern, **kw):
        with self.assertRaisesRegex(nt.TrimError, pattern):
            self.run_trim(**kw)
        self.assertFalse(os.path.exists(self.out), "a refused run wrote its output")
        self.assertEqual([n for n in os.listdir(os.path.dirname(self.out))], [], "a temp file was left behind")


class Positive(Case):
    def test_drops_exactly_the_list_and_keeps_the_rest(self):
        rep = self.run_trim()
        dropped = {n for v in DROPPED.values() for n in v}
        want = [n for n, *_ in MEMBERS if n not in dropped] + [f"{DIST}/RECORD"]
        with zipfile.ZipFile(self.out) as zo, zipfile.ZipFile(self.src) as zi:
            self.assertEqual(zo.namelist(), want)  # order kept, RECORD last
            self.assertIsNone(zo.testzip())
            for info in zo.infolist():
                o = zi.getinfo(info.filename)
                for f in ("date_time", "create_system", "create_version", "extract_version", "external_attr",
                          "compress_type", "flag_bits", "extra", "internal_attr"):
                    self.assertEqual(getattr(info, f), getattr(o, f), (info.filename, f))
                if not info.filename.endswith("/RECORD"):
                    self.assertEqual(zo.read(info.filename), zi.read(info.filename))
                    self.assertEqual(info.compress_size, o.compress_size)
                    self.assertEqual(info.CRC, o.CRC)
        self.assertEqual(rep["output"]["members"], len(want))
        self.assertEqual(rep["dropped"]["members"], len(dropped))
        self.assertEqual(rep["dropped"]["py"], sorted(n for n in dropped if n.endswith(".py")))
        self.assertEqual(rep["output"]["name"], NAME)
        self.assertLess(rep["output"]["bytes"], rep["input"]["bytes"])
        self.assertEqual(rep["html_base64_chars"]["after"], 4 * ((rep["gzip9"]["after"] + 2) // 3))

    def test_compressed_streams_copied_byte_for_byte(self):
        self.run_trim()
        src, out = read(self.src), read(self.out)
        es, _ = nt._entries(src)
        eo, _ = nt._entries(out)
        so = {e["name"]: e for e in es}
        for e in eo:
            if not e["name"].endswith("/RECORD"):
                self.assertEqual(e["local"], so[e["name"]]["local"], e["name"])
                self.assertEqual(e["central"][:42], so[e["name"]]["central"][:42], e["name"])
                self.assertEqual(e["central"][46:], so[e["name"]]["central"][46:], e["name"])

    def test_record_rows(self):
        self.run_trim()
        dropped = {n for v in DROPPED.values() for n in v}
        old = self.record.decode().splitlines(keepends=True)
        want = "".join(line for line in old if line.split(",")[0] not in dropped)
        with zipfile.ZipFile(self.out) as z:
            got = z.read(f"{DIST}/RECORD").decode()
            self.assertEqual(got, want)
            rows = [r.split(",") for r in got.splitlines()]
            self.assertEqual([r[0] for r in rows], z.namelist())  # RECORD lists exactly what is left
            for n, h, s in rows[:-1]:
                d = z.read(n)
                self.assertEqual((h, s), (rec_hash(d), str(len(d))))
            self.assertEqual(rows[-1], [f"{DIST}/RECORD", "", ""])

    def test_deterministic_from_another_dir(self):
        self.run_trim()
        first = hashlib.sha256(read(self.out)).hexdigest()
        other = os.path.join(self.tmp, "elsewhere", "deeper")
        os.makedirs(os.path.join(other, "o"))
        src2 = os.path.join(other, NAME)
        shutil.copy(self.src, src2)
        shutil.copy(self.drop, os.path.join(other, "d.json"))
        out2 = os.path.join(other, "o", NAME)
        nt.trim(src2, os.path.join(other, "d.json"), out2, **self.pins())
        self.assertEqual(hashlib.sha256(read(out2)).hexdigest(), first)
        os.unlink(out2)
        nt.trim(src2, os.path.join(other, "d.json"), out2, **self.pins())  # and once more
        self.assertEqual(hashlib.sha256(read(out2)).hexdigest(), first)

    def test_cli_exit_codes_and_report(self):
        # the CLI uses the pinned constants: on a synthetic wheel it must refuse (exit 1) and write nothing
        r = subprocess.run([sys.executable, "-I", "-B", TOOL, self.src, self.drop, self.out],
                           capture_output=True, text=True, check=False)
        self.assertEqual(r.returncode, 1, r.stderr)
        self.assertIn("pinned", r.stderr)
        self.assertFalse(os.path.exists(self.out))


class Refusals(Case):
    def edit_drop(self, **kw):
        drop_doc(self.drop, self.src, **kw)

    def test_missing_member(self):
        d = {k: list(v) for k, v in DROPPED.items()}
        d["c-header"].append("numpy/_core/include/numpy/nothere.h")
        self.edit_drop(drop=d)
        self.refuses("not in the input wheel", pinned_counts=dict(COUNTS, **{"c-header": 2}))

    def test_repeat_within_a_category(self):
        d = {k: list(v) for k, v in DROPPED.items()}
        d["c-header"].append(d["c-header"][0])
        self.edit_drop(drop=d)
        self.refuses("more than once")

    def test_repeat_across_categories(self):
        d = {k: list(v) for k, v in DROPPED.items()}
        d["c-source"].append("numpy/__init__.pyi")
        self.edit_drop(drop=d)
        self.refuses("more than once")

    def test_duplicate_json_key(self):
        text = read(self.drop).decode().replace('"drop": {', '"drop": {"c-header": [], ', 1)
        write(self.drop, text.encode())
        self.refuses("repeats the key")

    def test_counts_differ_from_pins(self):
        self.refuses("counts", pinned_counts=dict(COUNTS, **{"type-stub": 1}))

    def test_list_edit_alone_cannot_change_what_is_dropped(self):
        d = {k: list(v) for k, v in DROPPED.items()}
        d["type-stub"].remove("numpy/py.typed")
        self.edit_drop(drop=d)
        self.refuses("counts")  # the pins in the code still say 2

    def test_rule_yields_more_than_the_list(self):
        d = {k: list(v) for k, v in DROPPED.items()}
        d["type-stub"].remove("numpy/py.typed")
        self.edit_drop(drop=d)
        self.refuses("does not yield exactly the list", pinned_counts=dict(COUNTS, **{"type-stub": 1}))

    def test_dist_info_member(self):
        d = {k: list(v) for k, v in DROPPED.items()}
        d["build-config"].append(f"{DIST}/METADATA")
        self.edit_drop(drop=d)
        self.refuses("dist-info member", pinned_counts=dict(COUNTS, **{"build-config": 3}))

    def test_so_member(self):
        d = {k: list(v) for k, v in DROPPED.items()}
        d["c-source"].append("numpy/_core/_multiarray_umath.cpython-314-wasm32-emscripten.so")
        self.edit_drop(drop=d)
        self.refuses("extension module", pinned_counts=dict(COUNTS, **{"c-source": 2}))

    def test_licence_file(self):
        d = {k: list(v) for k, v in DROPPED.items()}
        d["build-config"].append("numpy/_core/include/numpy/random/LICENSE.txt")
        self.edit_drop(drop=d)
        self.refuses("licence-like", pinned_counts=dict(COUNTS, **{"build-config": 3}))

    def test_unknown_category(self):
        d = {k: list(v) for k, v in DROPPED.items()}
        d["python-source"] = ["numpy/testing/__init__.py"]
        self.edit_drop(drop=d)
        self.refuses("outside the allowed kinds")

    def test_kept_py_under_a_category(self):
        d = {k: list(v) for k, v in DROPPED.items()}
        d["c-source"].append("numpy/testing/__init__.py")
        self.edit_drop(drop=d)
        self.refuses("the rule makes it None", pinned_counts=dict(COUNTS, **{"c-source": 2}))

    def test_wrong_category(self):
        d = {k: list(v) for k, v in DROPPED.items()}
        d["c-header"], d["c-source"] = d["c-source"], d["c-header"]
        self.edit_drop(drop=d)
        self.refuses("the rule makes it")

    def test_input_sha256_not_pinned(self):
        self.refuses("sha256", pinned_sha256="0" * 64)

    def test_input_member_count_not_pinned(self):
        self.refuses("members, pinned", pinned_members=3)

    def test_input_name_not_pinned(self):
        self.refuses("pinned numpy-1", pinned_name="numpy-1.whl")

    def test_list_made_for_another_input(self):
        self.edit_drop(input_override={"file_name": NAME, "sha256": "f" * 64, "members": len(MEMBERS) + 1})
        self.refuses("was made for")

    def test_list_counts_field_disagrees(self):
        self.edit_drop(counts=dict(COUNTS, **{"c-header": 5}))
        self.refuses("own `counts`")

    def test_output_name_differs(self):
        self.out = os.path.join(self.tmp, "out", "numpy-trimmed.whl")
        self.refuses("file name")

    def test_output_is_input(self):
        self.out = self.src
        before = read(self.src)
        with self.assertRaisesRegex(nt.TrimError, "overwrite"):
            self.run_trim()
        self.assertEqual(read(self.src), before)

    def test_existing_output_untouched_on_refusal(self):
        write(self.out, b"previous")
        with self.assertRaises(nt.TrimError):
            self.run_trim(pinned_sha256="0" * 64)
        self.assertEqual(read(self.out), b"previous")

    def test_record_bad_hash(self):
        rows = [f"{n},{rec_hash(d)},{len(d)}" for n, d, *_ in MEMBERS]
        rows[0] = rows[0].replace("sha256=", "sha256=x", 1)
        make_wheel(self.src, record_rows=rows)
        drop_doc(self.drop, self.src)
        self.refuses("hash or size")

    def test_record_missing_a_member(self):
        rows = [f"{n},{rec_hash(d)},{len(d)}" for n, d, *_ in MEMBERS][1:]
        make_wheel(self.src, record_rows=rows)
        drop_doc(self.drop, self.src)
        self.refuses("exactly the wheel's members")

    def test_record_lists_a_stranger(self):
        rows = [f"{n},{rec_hash(d)},{len(d)}" for n, d, *_ in MEMBERS] + ["numpy/ghost.py,sha256=AAAA,1"]
        make_wheel(self.src, record_rows=rows)
        drop_doc(self.drop, self.src)
        self.refuses("not in the wheel")

    def test_zlib_must_reproduce_the_record(self):
        rec = make_wheel(self.src, record_level=1)
        self.assertNotEqual(nt._deflate(rec, 1), nt._deflate(rec, 6))  # the control is meaningful
        drop_doc(self.drop, self.src)
        self.refuses("re-deflate")

    def test_data_descriptor_refused(self):
        # a streamed write sets flag bit 3 (data descriptor)
        class Unseekable:  # zipfile streams to it with data descriptors
            def __init__(self):
                self.buf = bytearray()

            def write(self, b):
                self.buf += b
                return len(b)

            def flush(self):
                pass

        buf = Unseekable()
        with zipfile.ZipFile(buf, "w") as z:
            for n, d, *_ in MEMBERS:
                z.writestr(n, d, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
            z.writestr(f"{DIST}/RECORD", b"", compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
        write(self.src, bytes(buf.buf))
        self.assertTrue(all(zi.flag_bits & 0x08 for zi in zipfile.ZipFile(io.BytesIO(read(self.src))).infolist()))
        drop_doc(self.drop, self.src)
        self.refuses("data-descriptor")

    def test_archive_comment_refused(self):
        with zipfile.ZipFile(self.src, "a") as z:
            z.comment = b"note"
        drop_doc(self.drop, self.src)
        self.refuses("comment")


class CommittedList(unittest.TestCase):
    """pymol-wasm/numpy_drop.json against the rule and the pins (no wheel needed)."""

    @classmethod
    def setUpClass(cls):
        with open(os.path.join(HERE, "numpy_drop.json"), encoding="utf-8") as fh:
            cls.doc = json.load(fh)

    def test_input_is_the_pinned_wheel(self):
        self.assertEqual(self.doc["input"], {"file_name": nt.PINNED_INPUT_NAME, "sha256": nt.PINNED_INPUT_SHA256,
                                             "members": nt.PINNED_INPUT_MEMBERS})

    def test_counts_are_the_pins(self):
        counts = {c: len(v) for c, v in self.doc["drop"].items()}
        self.assertEqual(counts, nt.PINNED_COUNTS)
        self.assertEqual(self.doc["counts"], nt.PINNED_COUNTS)
        self.assertEqual(self.doc["total"], 206)

    def test_every_name_is_its_category_by_the_rule(self):
        for c, names in self.doc["drop"].items():
            self.assertEqual(names, sorted(names), c)
            for n in names:
                self.assertEqual(nt.category_of(n), c, n)

    def test_no_kept_kind_is_listed(self):
        names = [n for v in self.doc["drop"].values() for n in v]
        self.assertEqual(len(names), len(set(names)))
        self.assertFalse([n for n in names if ".dist-info/" in n or n.endswith(".so")])
        self.assertFalse([n for n in names if n.startswith(("numpy/testing/", "numpy/f2py/")) and n.endswith(".py")])
        # the only .py the rule drops, each justified in numpy_trim.py's docstring
        self.assertEqual(sorted(n for n in names if n.endswith(".py")), [
            "numpy/_pyinstaller/__init__.py", "numpy/_pyinstaller/hook-numpy.py", "numpy/conftest.py",
            "numpy/doc/ufuncs.py"])


if __name__ == "__main__":
    unittest.main()
