"""Unit tests for check_side_modules.py on hand-assembled wasm modules (stdlib only).

    python3 -I -B tests/test_check_side_modules.py

Pins the provider rule on synthetic modules (build.sh covers the real ones):
every source and non-source, required exports, self imports, dylink.0
placement, and exit codes 0 / 1 / 2.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from typing import Any

GATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "check_side_modules.py")
SIDE_NAME = "_mod.cpython-314-wasm32-emscripten.so"
REQUIRED = ["PyInit__mod", "__wasm_call_ctors", "__wasm_apply_data_relocs"]


def uleb(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def name(s: str | bytes) -> bytes:
    data = s.encode() if isinstance(s, str) else s
    return uleb(len(data)) + data


def vec(items: list[bytes]) -> bytes:
    return uleb(len(items)) + b"".join(items)


def section(sid: int, payload: bytes) -> bytes:
    return bytes([sid]) + uleb(len(payload)) + payload


def custom(cname: str, payload: bytes = b"") -> bytes:
    return section(0, name(cname) + payload)


def dylink(weak: Any = ()) -> bytes:
    mem_info = uleb(0) * 4  # memorySize, memoryAlign, tableSize, tableAlign
    subs = b"\x01" + uleb(len(mem_info)) + mem_info
    if weak:
        p = vec([name(m) + name(f) + uleb(1) for m, f in weak])  # flags 1 = WASM_SYMBOL_BINDING_WEAK
        subs += b"\x04" + uleb(len(p)) + p
    return custom("dylink.0", subs)


IMPORT_DESC = {
    "func": b"\x00" + uleb(0),
    "table": b"\x01\x70\x00" + uleb(1),
    "memory": b"\x02\x00" + uleb(1),
    "global": b"\x03\x7f\x00",
    "tag": b"\x04\x00" + uleb(0),
}
KIND_BYTE = {"func": 0, "table": 1, "memory": 2, "global": 3, "tag": 4}


def build(imports: Any = (), exports: Any = (), *, dylink_section: bytes | None = b"default", dylink_after_types: bool = False) -> bytes:
    """A valid module: one `() -> ()` type, the given imports ((module, field, kind)),
    one defined item of every kind an export needs, and exports ((field, kind))
    that each name the first DEFINED item of their kind."""
    if dylink_section == b"default":
        dylink_section = dylink()
    imported = {k: sum(1 for _, _, kk in imports if kk == k) for k in KIND_BYTE}
    need = {k for _, k in exports}
    parts = [b"\0asm\x01\0\0\0"]
    if dylink_section and not dylink_after_types:
        parts.append(dylink_section)
    parts.append(section(1, vec([b"\x60\x00\x00"])))
    if dylink_section and dylink_after_types:
        parts.append(dylink_section)
    if imports:
        parts.append(section(2, vec([name(m) + name(f) + IMPORT_DESC[k] for m, f, k in imports])))
    parts.append(section(3, vec([uleb(0)])))  # one defined function
    if "table" in need:
        parts.append(section(4, vec([b"\x70\x00" + uleb(1)])))
    if "memory" in need:
        parts.append(section(5, vec([b"\x00" + uleb(1)])))
    if "tag" in need:
        parts.append(section(13, vec([b"\x00" + uleb(0)])))
    if "global" in need:
        parts.append(section(6, vec([b"\x7f\x00\x41\x00\x0b"])))
    if exports:
        parts.append(section(7, vec([name(f) + bytes([KIND_BYTE[k]]) + uleb(imported[k]) for f, k in exports])))
    parts.append(section(10, vec([uleb(2) + b"\x00\x0b"])))
    return b"".join(parts)


def side(imports: Any = (), extra_exports: Any = (), required: list[str] = REQUIRED, **kw: Any) -> bytes:
    return build(imports, [(n, "func") for n in required] + list(extra_exports), **kw)


MAIN = build(
    imports=[
        ("env", "js_a", "func"),
        ("env", "js_b", "func"),
        ("wasi_snapshot_preview1", "fd_write", "func"),
        ("GOT.func", "js_a", "global"),  # not an env/wasi function import: not part of the cover check
    ],
    exports=[
        ("main_fn", "func"),
        ("main_glob", "global"),
        ("__stack_pointer", "global"),
        ("memory", "memory"),
        ("__indirect_function_table", "table"),
        ("__cpp_exception", "tag"),
        ("__c_longjmp", "tag"),
    ],
    dylink_section=None,
)

# Exercises the reader: braces / commas inside strings, templates and comments,
# nesting, arrows, a method, quoted keys, a trailing comma, and decoys.
JS_KEYS = ["js_a", "js_b", "fd_write", "js_only", "quoted_key", "str_val", "tpl_val", "arrow", "commented", "meth", "arr", "regexish", "own_and_js"]
LOADER_CASES = 'function proxy(prop){switch(prop){case"__memory_base":return memoryBase;case"__table_base":return tableBase}}\n'
JS_BODY = (
    'js_a:_js_a,js_b,fd_write:_fd_write,js_only:_js_only,"quoted_key":q,str_val:"},{\\"",'
    "tpl_val:`a${ {k:1,j:2}.k }b`,arrow:(a,b)=>{return{c:a,d:b}},/* , } */ commented:1,"
    "meth(a,b){return a},arr:[1,2,{z:3}],regexish:a/b,own_and_js:x,"
)
MAIN_JS = (
    "var Module={};Module.wasmImports={decoy:1};if(wasmImports=={}){}\n"
    + LOADER_CASES
    + "var wasmImports={"
    + JS_BODY
    + "};\nfunction after(){return {not_a_key:1}}\n"
)


class GateCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.d = self._tmp.name

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def write(self, rel: str, data: bytes | str) -> str:
        p = os.path.join(self.d, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb" if isinstance(data, bytes) else "w") as fh:
            fh.write(data)
        return p

    def run_gate(
        self,
        *modules: bytes | str,
        main: bytes = MAIN,
        js: str | bytes = MAIN_JS,
        extra: tuple[str, ...] | list[str] = (),
        min_keys: str | None = "3",
        names: dict[int, str] | None = None,
    ) -> tuple[int, str, Any]:
        mw = self.write("main/pyodide.asm.wasm", main)
        mj = self.write("main/pyodide.asm.mjs", js)
        paths = []
        for i, blob in enumerate(modules):
            if isinstance(blob, str):
                paths.append(blob)  # a ready spec
                continue
            paths.append(self.write(f"m{i}/{(names or {}).get(i, SIDE_NAME)}", blob))
        rep = os.path.join(self.d, "report.json")
        if os.path.exists(rep):
            os.remove(rep)
        args = [sys.executable, "-I", "-B", GATE, "--json", rep, "--main-wasm", mw, "--main-js", mj]
        if min_keys is not None:
            args += ["--min-js-keys", min_keys]
        proc = subprocess.run(args + list(extra) + paths, capture_output=True, text=True, check=False)
        data = None
        if os.path.exists(rep):
            with open(rep) as fh:
                data = json.load(fh)
        return proc.returncode, proc.stdout + proc.stderr, data

    def assertPass(self, blob: bytes | str, **kw: Any) -> Any:
        rc, out, rep = self.run_gate(blob, **kw)
        self.assertEqual(rc, 0, out)
        self.assertTrue(rep["ok"])
        return rep["modules"][0]

    def assertUnresolved(self, blob: bytes, want: list[str], **kw: Any) -> Any:
        rc, out, rep = self.run_gate(blob, **kw)
        self.assertEqual(rc, 1, out)
        self.assertEqual(rep["modules"][0]["unresolved"], want, out)
        return rep["modules"][0]

    def assertExit2(self, *blobs: bytes | str, **kw: Any) -> tuple[str, Any]:
        rc, out, rep = self.run_gate(*blobs, **kw)
        self.assertEqual(rc, 2, out)
        self.assertIsNotNone(rep, "the report must be written on exit 2 too")
        self.assertFalse(rep["ok"])
        return out, rep


class Sources(GateCase):
    def test_clean_module_with_no_imports(self) -> None:
        m = self.assertPass(side())
        self.assertEqual(m["required_exports"], REQUIRED)
        self.assertEqual((m["n_unresolved"], m["self_imports"]), (0, 0))

    def test_each_source_satisfies_an_import(self) -> None:
        cases = {
            "js": [("env", "js_only", "func"), ("wasi_snapshot_preview1", "js_b", "func"), ("GOT.func", "js_only", "global")],
            "main": [
                ("env", "main_fn", "func"),
                ("env", "__stack_pointer", "global"),
                ("env", "memory", "memory"),
                ("env", "__indirect_function_table", "table"),
                ("env", "__cpp_exception", "tag"),
                ("env", "__c_longjmp", "tag"),
                ("GOT.func", "main_fn", "global"),
                ("GOT.mem", "main_glob", "global"),
            ],
            "own": [("env", "own_fn", "func"), ("GOT.func", "own_fn", "global"), ("GOT.mem", "own_glob", "global")],
            "special": [("env", "__memory_base", "global"), ("env", "__table_base", "global")],
        }
        own_exports = [("own_fn", "func"), ("own_glob", "global")]
        for source, imports in cases.items():
            for imp in imports:
                with self.subTest(source=source, imp=imp):
                    m = self.assertPass(side([imp], own_exports))
                    self.assertEqual(m["imports_by_source"][source], 1, m)

    def test_report_numbers(self) -> None:
        rc, out, rep = self.run_gate(side([("env", "js_a", "func")]))
        self.assertEqual(rc, 0, out)
        self.assertEqual(rep["main"]["wasm_imports_keys"], len(JS_KEYS))
        self.assertEqual(rep["main"]["main_env_function_imports"], 3)
        self.assertEqual(rep["main"]["main_exports"], 7)
        self.assertEqual(rep["main"]["loader_specials"], ["__memory_base", "__table_base"])

    def test_wheel_member_spec(self) -> None:
        whl = os.path.join(self.d, "x.whl")
        with zipfile.ZipFile(whl, "w") as z:
            z.writestr("pkg/" + SIDE_NAME, side([("env", "js_a", "func")]))
        rc, out, rep = self.run_gate(f"wheel:{whl}!pkg/{SIDE_NAME}")
        self.assertEqual(rc, 0, out)
        self.assertEqual(rep["modules"][0]["file"], SIDE_NAME)

    def test_required_name_follows_the_file_name(self) -> None:
        blob = side(required=["PyInit__champ", "__wasm_call_ctors", "__wasm_apply_data_relocs"])
        rc, out, rep = self.run_gate(blob, names={0: "_champ.cpython-314-wasm32-emscripten.so"})
        self.assertEqual(rc, 0, out)
        rc, out, rep = self.run_gate(blob)  # the same bytes as _mod: PyInit__mod is missing
        self.assertEqual(rc, 1, out)
        self.assertEqual(rep["modules"][0]["missing_exports"], ["PyInit__mod"])


class Unresolved(GateCase):
    def test_unknown_import_fails(self) -> None:
        self.assertUnresolved(side([("env", "nobody", "func")]), ["env.nobody (func)"])

    def test_one_bad_module_fails_the_run(self) -> None:
        rc, out, _ = self.run_gate(side(), side([("env", "nobody", "func")]))
        self.assertEqual(rc, 1, out)

    def test_kind_must_match_the_main_export(self) -> None:
        for imp in [("env", "main_fn", "global"), ("env", "__stack_pointer", "memory"), ("env", "main_glob", "func"), ("GOT.mem", "main_fn", "global")]:
            with self.subTest(imp=imp):
                self.assertUnresolved(side([imp]), [f"{imp[0]}.{imp[1]} ({imp[2]})"])

    def test_js_key_is_not_a_global(self) -> None:
        for imp in [("GOT.mem", "js_only", "global"), ("env", "js_only", "global")]:
            with self.subTest(imp=imp):
                self.assertUnresolved(side([imp]), [f"{imp[0]}.{imp[1]} ({imp[2]})"])

    def test_own_export_does_not_satisfy_a_non_function_env_import(self) -> None:
        self.assertUnresolved(side([("env", "own_glob", "global")], [("own_glob", "global")]), ["env.own_glob (global)"])

    def test_unknown_import_module(self) -> None:
        self.assertUnresolved(side([("foo", "js_a", "func")]), ["foo.js_a (func)"])

    def test_special_counts_only_if_the_loader_names_it(self) -> None:
        js = MAIN_JS.replace(LOADER_CASES, "")
        self.assertUnresolved(side([("env", "__memory_base", "global")]), ["env.__memory_base (global)"], js=js)

    def test_weak_import_gets_no_exemption(self) -> None:
        m = self.assertUnresolved(side([("env", "nobody", "func")], dylink_section=dylink(weak=[("env", "nobody")])), ["env.nobody (func)"])
        self.assertEqual(m["weak_imports"], 1)


class RequiredExports(GateCase):
    def test_each_missing_required_export_fails(self) -> None:
        for missing in REQUIRED:
            with self.subTest(missing=missing):
                rc, out, rep = self.run_gate(side(required=[n for n in REQUIRED if n != missing]))
                self.assertEqual(rc, 1, out)
                self.assertEqual(rep["modules"][0]["missing_exports"], [missing])
                self.assertEqual(rep["modules"][0]["unresolved"], [])

    def test_required_export_must_be_a_function(self) -> None:
        blob = side(required=["PyInit__mod", "__wasm_apply_data_relocs"], extra_exports=[("__wasm_call_ctors", "global")])
        rc, out, rep = self.run_gate(blob)
        self.assertEqual(rc, 1, out)
        self.assertEqual(rep["modules"][0]["missing_exports"], ["__wasm_call_ctors"])

    def test_dylink_must_be_first(self) -> None:
        for label, kw in [("after the type section", {"dylink_after_types": True}), ("absent", {"dylink_section": None})]:
            with self.subTest(label=label):
                rc, out, rep = self.run_gate(side(**kw))
                self.assertEqual(rc, 1, out)
                self.assertTrue(any("dylink.0" in f for f in rep["modules"][0]["failures"]), rep)


class SelfImports(GateCase):
    OWN = [("own_fn", "func"), ("own_fn2", "func"), ("own_and_js", "func"), ("main_fn", "func")]
    IMPORTS = [
        ("env", "own_fn", "func"),
        ("env", "own_fn2", "func"),
        ("env", "own_and_js", "func"),  # a JS key wins: not a self import
        ("env", "main_fn", "func"),  # the main export wins: not a self import
        ("GOT.func", "own_fn", "global"),  # an address, not a call: not a self import
    ]

    def test_counted_and_passing_without_the_option(self) -> None:
        m = self.assertPass(side(self.IMPORTS, self.OWN))
        self.assertEqual(m["self_imports"], 2)
        self.assertEqual(m["self_import_names"], ["own_fn", "own_fn2"])

    def test_fail_only_over_the_limit(self) -> None:
        blob = side(self.IMPORTS, self.OWN)
        for limit, want in [("2", 0), ("3", 0), ("1", 1), ("0", 1)]:
            with self.subTest(limit=limit):
                rc, out, rep = self.run_gate(blob, extra=["--max-self-imports", limit])
                self.assertEqual(rc, want, out)
        self.assertTrue(any("self imports" in f for f in rep["modules"][0]["failures"]))

    def test_negative_limit_is_a_usage_error(self) -> None:
        rc, out, _ = self.run_gate(side(), extra=["--max-self-imports", "-1"])
        self.assertEqual(rc, 2, out)


def _bad_leb_section() -> bytes:
    # a type section whose size LEB has 6 bytes (u32 allows 5)
    return b"\0asm\x01\0\0\0" + b"\x01" + b"\x81\x80\x80\x80\x80\x00" + b"\x60"


class Malformed(GateCase):
    def test_malformed_side_modules_exit_2(self) -> None:
        good = side([("env", "js_a", "func")])
        imp_sec = section(2, vec([name("env") + name("js_a") + IMPORT_DESC["func"]]))
        cases = {
            "bad magic": b"\0asn" + good[4:],
            "bad version": good[:4] + b"\x02\0\0\0" + good[8:],
            "truncated section": good[:-1],
            "LEB longer than u32": _bad_leb_section(),
            "LEB overflows u32": b"\0asm\x01\0\0\0\x01" + b"\xff\xff\xff\xff\x7f",
            "import count past the section": b"\0asm\x01\0\0\0" + dylink() + section(2, b"\x05"),
            "import section trailing bytes": b"\0asm\x01\0\0\0" + dylink() + section(2, imp_sec[2:] + b"\x00"),
            "unknown import kind": b"\0asm\x01\0\0\0" + dylink() + section(2, vec([name("env") + name("x") + b"\x07"])),
            "non-UTF-8 name": b"\0asm\x01\0\0\0" + dylink() + section(2, vec([name("env") + name(b"\xff\xfe") + IMPORT_DESC["func"]])),
            "export index out of range": b"\0asm\x01\0\0\0" + dylink() + section(7, vec([name("f") + b"\x00" + uleb(5)])),
            "duplicate export": b"\0asm\x01\0\0\0"
            + dylink()
            + section(1, vec([b"\x60\x00\x00"]))
            + section(3, vec([uleb(0)]))
            + section(7, vec([name("f") + b"\x00\x00", name("f") + b"\x00\x00"])),
            "section twice": b"\0asm\x01\0\0\0" + dylink() + section(1, vec([])) + section(1, vec([])),
            "sections out of order": b"\0asm\x01\0\0\0" + dylink() + section(3, vec([])) + section(1, vec([])),
            "unknown section id": b"\0asm\x01\0\0\0" + dylink() + section(14, b""),
            "dylink subsection past the section": b"\0asm\x01\0\0\0" + custom("dylink.0", b"\x02" + uleb(100)),
            "empty file": b"",
        }
        for label, blob in cases.items():
            with self.subTest(label=label):
                _, rep = self.assertExit2(blob)
                self.assertFalse(rep["modules"][0]["parsed"])

    def test_missing_inputs_exit_2(self) -> None:
        whl = os.path.join(self.d, "y.whl")
        with zipfile.ZipFile(whl, "w") as z:
            z.writestr("other.so", side())
        notzip = self.write("notzip.whl", b"not a zip")
        for spec in [
            os.path.join(self.d, "does-not-exist.so"),
            self.d,  # a directory
            f"wheel:{whl}!pkg/{SIDE_NAME}",  # no such member
            f"wheel:{notzip}!x.so",
            f"wheel:{whl}",  # no member at all
        ]:
            with self.subTest(spec=spec):
                self.assertExit2(spec)

    def test_malformed_main_wasm_exit_2(self) -> None:
        out, rep = self.assertExit2(side(), main=MAIN[:-3])
        self.assertIn("main", rep["error"])

    def test_one_unreadable_module_dominates_a_failing_one(self) -> None:
        rc, out, _ = self.run_gate(side([("env", "nobody", "func")]), b"junk")
        self.assertEqual(rc, 2, out)


class WasmImportsBlock(GateCase):
    def test_reader_handles_strings_templates_comments_and_nesting(self) -> None:
        rc, out, rep = self.run_gate(side())
        self.assertEqual(rc, 0, out)
        self.assertEqual(rep["main"]["wasm_imports_keys"], len(JS_KEYS))

    def test_garbled_or_missing_block_exit_2(self) -> None:
        head = LOADER_CASES
        cases = {
            "no block": head + "var notImports={js_a,js_b,fd_write};",
            "two blocks": head + "var wasmImports={js_a,js_b,fd_write};wasmImports={js_a,js_b,fd_write};",
            "never closes": head + "var wasmImports={js_a,js_b,fd_write,x:{y:1};",
            "unterminated string": head + 'var wasmImports={js_a,js_b,fd_write,x:"abc};',
            "unterminated comment": head + "var wasmImports={js_a,js_b,fd_write /* x };",
            "mismatched bracket": head + "var wasmImports={js_a,js_b,fd_write,x:(1]};",
            "spread entry": head + "var wasmImports={...others,js_a,js_b,fd_write};",
            "computed key": head + "var wasmImports={[k]:1,js_a,js_b,fd_write};",
            "empty entry": head + "var wasmImports={js_a,,js_b,fd_write};",
            "does not cover the main wasm": head + "var wasmImports={js_a,js_b,other};",
        }
        for label, js in cases.items():
            with self.subTest(label=label):
                out, rep = self.assertExit2(side(), js=js)
                self.assertEqual(rep["modules"], [])

    def test_implausibly_small_block_exit_2(self) -> None:
        # the real default (--min-js-keys 500): 13 keys are refused even though they parse
        out, rep = self.assertExit2(side(), min_keys=None)
        self.assertIn("min-js-keys", rep["error"])

    def test_js_not_utf8_exit_2(self) -> None:
        self.assertExit2(side(), js=b"\xff\xfe var wasmImports={};")


class Usage(GateCase):
    def test_usage_errors_exit_2(self) -> None:
        mw = self.write("main/a.wasm", MAIN)
        for args in ([], ["--main-wasm", mw, self.write("s.so", side())], ["--main-wasm", mw, "--main-js", mw]):
            with self.subTest(args=args):
                proc = subprocess.run([sys.executable, "-I", "-B", GATE, *args], capture_output=True, text=True, check=False)
                self.assertEqual(proc.returncode, 2, proc.stdout + proc.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
