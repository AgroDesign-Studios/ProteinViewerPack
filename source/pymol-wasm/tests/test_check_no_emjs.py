"""Unit tests for check_no_emjs.py on hand-assembled wasm modules (stdlib only).

    python3 -I -B tests/test_check_no_emjs.py

build.sh also runs the checker on a REAL side module that uses EM_JS, EM_ASM
and emscripten_run_script (tests/emjs_positive.c) and on a plain one
(tests/emjs_negative.c), built by the pinned toolchain. These cases pin each
place a marker can sit, so a parser change cannot quietly stop looking at one,
and pin the exit codes the build depends on: 0 clean, 1 marker, 2 unreadable.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest

CHECKER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "check_no_emjs.py")


def uleb(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def name(s):
    data = s.encode()
    return uleb(len(data)) + data


def vec(items):
    return uleb(len(items)) + b"".join(items)


def section(sid, payload):
    return bytes([sid]) + uleb(len(payload)) + payload


def custom(cname, payload=b""):
    return section(0, name(cname) + payload)


# import descriptors (kind byte + payload)
def imp_func(typeidx=0):
    return b"\x00" + uleb(typeidx)


def imp_table(reftype=0x70, flags=0, mn=0, mx=None):
    d = b"\x01" + bytes([reftype]) + bytes([flags]) + uleb(mn)
    return d + (uleb(mx) if flags & 1 else b"")


def imp_memory(flags=0, mn=0, mx=None):
    d = b"\x02" + bytes([flags]) + uleb(mn)
    return d + (uleb(mx) if flags & 1 else b"")


def imp_global(valtype=0x7F, mutable=0):
    return b"\x03" + bytes([valtype]) + bytes([mutable])


def imp_tag(typeidx=0):
    return b"\x04" + b"\x00" + uleb(typeidx)


def _nfunc(imports):
    return sum(1 for it in imports if (it[2] if len(it) > 2 else imp_func())[:1] == b"\x00")


def module(imports=(), exports=(), customs=(), ntypes=1):
    """A valid module: `() -> ()` types, imports (func by default, or a 3-tuple
    (module, field, descriptor) for other kinds), and one local function to export."""
    imports = [it if len(it) > 2 else (it[0], it[1], imp_func()) for it in imports]
    parts = [b"\0asm\x01\0\0\0", section(1, vec([b"\x60\x00\x00"] * ntypes))]
    if imports:
        parts.append(section(2, vec([name(m) + name(f) + d for m, f, d in imports])))
    parts.append(section(3, vec([uleb(0)])))
    if exports:
        # export the one local function, whose index is after the imported funcs
        parts.append(section(7, vec([name(e) + b"\x00" + uleb(_nfunc(imports)) for e in exports])))
    parts.append(section(10, vec([uleb(2) + b"\x00\x0b"])))
    parts.extend(customs)
    return b"".join(parts)


def dylink(needed=(), export_info=(), import_info=()):
    subs = b""
    if needed:
        p = vec([name(n) for n in needed])
        subs += b"\x02" + uleb(len(p)) + p
    if export_info:
        p = vec([name(n) + uleb(0) for n in export_info])
        subs += b"\x03" + uleb(len(p)) + p
    if import_info:
        p = vec([name(m) + name(f) + uleb(0) for m, f in import_info])
        subs += b"\x04" + uleb(len(p)) + p
    return custom("dylink.0", subs)


def name_section(module_name=None, functions=(), locals_=(), runtime_path=(), fields=()):
    subs = b""
    if module_name is not None:
        p = name(module_name)
        subs += b"\x00" + uleb(len(p)) + p
    if functions:
        p = vec([uleb(i) + name(n) for i, n in enumerate(functions)])
        subs += b"\x01" + uleb(len(p)) + p
    if locals_:
        p = vec([uleb(0) + vec([uleb(i) + name(n) for i, n in enumerate(locals_)])])
        subs += b"\x02" + uleb(len(p)) + p
    if fields:  # subsection 10: indirect field-name map
        p = vec([uleb(0) + vec([uleb(i) + name(n) for i, n in enumerate(fields)])])
        subs += b"\x0a" + uleb(len(p)) + p
    return custom("name", subs)


def dylink_runtime_path(paths):
    p = vec([name(n) for n in paths])
    return custom("dylink.0", b"\x05" + uleb(len(p)) + p)


# A clean module exercising every import kind and a memory with a max, so the
# descriptor parsing is proven not to desync before the function imports that
# carry the exported-symbol marker test.
CLEAN = module(
    imports=[
        ("env", "glDrawArrays"),
        ("GOT.mem", "PyExc_TypeError", imp_global()),
        ("env", "__indirect_function_table", imp_table(flags=1, mn=1, mx=9)),
        ("env", "memory", imp_memory(flags=3, mn=256, mx=65536)),  # max + shared
        ("env", "__cpp_exception", imp_tag()),
    ],
    exports=["plain_add"],
    customs=[
        dylink(needed=["libpython.so"], export_info=["plain_add"], import_info=[("env", "glDrawArrays")]),
        dylink_runtime_path(["$ORIGIN"]),
        name_section("cmd", ["plain_add"], ["x"], fields=["f0"]),
    ],
)


class CheckNoEmJs(unittest.TestCase):
    def run_checker(self, *blobs, report=False):
        with tempfile.TemporaryDirectory() as d:
            paths = []
            for i, blob in enumerate(blobs):
                p = os.path.join(d, f"m{i}.so")
                with open(p, "wb") as fh:
                    fh.write(blob)
                paths.append(p)
            args = [sys.executable, "-I", "-B", CHECKER]
            rep_path = os.path.join(d, "report.json")
            if report:
                args += ["--json", rep_path]
            proc = subprocess.run(args + paths, capture_output=True, text=True, check=False)
            data = None
            if report:
                with open(rep_path) as fh:
                    data = json.load(fh)
            return proc.returncode, proc.stdout, data

    def assertFlagged(self, blob, field, raw_expected=True):
        rc, out, rep = self.run_checker(blob, report=True)
        self.assertEqual(rc, 1, out)
        self.assertTrue(rep[0][field], f"{field} empty: {rep[0]}")
        self.assertGreater(rep[0]["structural_hits"], 0)
        if raw_expected:
            self.assertGreater(rep[0]["raw_hits"], 0)

    def test_clean_module_passes(self):
        rc, out, rep = self.run_checker(CLEAN, report=True)
        self.assertEqual(rc, 0, out)
        self.assertTrue(rep[0]["clean"])
        self.assertEqual(rep[0]["n_imports"], 5)
        self.assertEqual(rep[0]["n_exports"], 1)
        self.assertEqual(rep[0]["custom_sections"], ["dylink.0", "dylink.0", "name"])
        self.assertEqual(rep[0]["n_dylink_names"], 4)  # needed, export_info, import_info, runtime_path
        self.assertEqual(rep[0]["n_name_section_names"], 4)  # module, function, local, field

    def test_marker_in_nonfunction_imports(self):
        for desc, label in [
            (imp_global(), "global"),
            (imp_tag(), "tag"),
            (imp_table(flags=1, mn=1, mx=3), "table"),
            (imp_memory(flags=1, mn=1, mx=2), "memory"),
        ]:
            with self.subTest(kind=label):
                # a marker-named func import AFTER the non-func one: a desc parse
                # that desynced would misread the following import's name
                blob = module(imports=[("env", "harmless", desc), ("env", "emscripten_run_script")])
                self.assertFlagged(blob, "forbidden_in_imports")

    def test_async_run_script_import(self):
        self.assertFlagged(module(imports=[("env", "emscripten_async_run_script")]), "forbidden_in_imports")

    def test_marker_only_in_dylink_runtime_path(self):
        self.assertFlagged(module(customs=[dylink_runtime_path(["em_asm_dir"])]), "forbidden_in_dylink")

    def test_marker_only_in_name_field_subsection(self):
        self.assertFlagged(module(customs=[name_section(fields=["__em_js__x"])]), "forbidden_in_name_section")

    def test_em_js_export(self):
        self.assertFlagged(module(exports=["__em_js__js_add"]), "forbidden_in_exports")

    def test_em_asm_section_bounds_export(self):
        self.assertFlagged(module(exports=["__start_em_asm"]), "forbidden_in_exports")

    def test_run_script_import(self):
        self.assertFlagged(module(imports=[("env", "emscripten_run_script")]), "forbidden_in_imports")

    def test_asm_const_import(self):
        self.assertFlagged(module(imports=[("env", "emscripten_asm_const_int")]), "forbidden_in_imports")

    def test_marker_only_in_dylink(self):
        self.assertFlagged(module(customs=[dylink(import_info=[("env", "emscripten_run_script_int")])]), "forbidden_in_dylink")

    def test_marker_only_in_name_section(self):
        self.assertFlagged(module(customs=[name_section(functions=["EM_JS_helper"])]), "forbidden_in_name_section")
        self.assertFlagged(module(customs=[name_section(locals_=["em_asm_arg"])]), "forbidden_in_name_section")

    def test_marker_as_custom_section_name(self):
        self.assertFlagged(module(customs=[custom("em_js", b"\x00")]), "forbidden_in_custom_section_names")

    def test_marker_only_in_raw_bytes(self):
        rc, out, rep = self.run_checker(module(customs=[custom("payload", b"...EM_ASM({ return 1; })...")]), report=True)
        self.assertEqual(rc, 1, out)
        self.assertEqual(rep[0]["structural_hits"], 0)
        self.assertGreater(rep[0]["raw_hits"], 0)

    def test_case_insensitive(self):
        self.assertFlagged(module(exports=["EM_JS_UPPER"]), "forbidden_in_exports")

    def test_unreadable_input_fails_closed(self):
        overrun_dylink = module(customs=[custom("dylink.0", b"\x02" + uleb(100))])  # NEEDED subsection size past section
        overrun_name = module(customs=[custom("name", b"\x01" + uleb(100))])  # function-names subsection size past section
        for blob in (
            b"not wasm at all",
            b"\0asm\x02\0\0\0",  # unsupported version
            CLEAN[:-5],  # truncated
            b"\0asm\x01\0\0\0" + section(2, b"\x05"),  # import count exceeds section
            overrun_dylink,
            overrun_name,
        ):
            with self.subTest(blob=blob[:16]):
                rc, out, rep = self.run_checker(blob, report=True)
                self.assertEqual(rc, 2, out)
                self.assertFalse(rep[0]["parsed"])

    def test_missing_and_nonfile_input_fail_closed(self):
        with tempfile.TemporaryDirectory() as d:
            for target in (os.path.join(d, "does-not-exist.so"), d):  # missing file, and a directory
                proc = subprocess.run(
                    [sys.executable, "-I", "-B", CHECKER, target], capture_output=True, text=True, check=False
                )
                self.assertEqual(proc.returncode, 2, proc.stdout + proc.stderr)

    def test_one_bad_file_fails_the_run(self):
        rc, out, _ = self.run_checker(CLEAN, module(exports=["__em_js__x"]))
        self.assertEqual(rc, 1, out)

    def test_no_arguments_is_a_usage_error(self):
        proc = subprocess.run([sys.executable, "-I", "-B", CHECKER], capture_output=True, text=True, check=False)
        self.assertEqual(proc.returncode, 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
