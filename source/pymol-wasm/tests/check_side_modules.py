"""Side-module gate: every import of a Pyodide side module must have a provider.

usage: python3 -I -B check_side_modules.py --main-wasm PYODIDE_ASM_WASM --main-js PYODIDE_ASM_MJS
           [--json REPORT] [--max-self-imports N] [--min-js-keys N] MODULE [MODULE ...]

MODULE is a path to a side module (.so) or `wheel:<path.whl>!<member>`, which
reads the member out of the wheel (e.g.
`wheel:pymol-<ver>.whl!pymol/_cmd.cpython-314-wasm32-emscripten.so`).

Why: Pyodide's loader binds an unresolvable `env` function import to a lazy
stub, so a missing symbol only throws "cannot resolve symbol" when a user
first reaches it; this catches it statically.

Provider rule (mirrors pyodide.asm.mjs 314.0.7, in the loader's order):

  import module                  kind     provided by
  env / wasi_snapshot_preview1   func     a `wasmImports` key (JS library); else a main-module
                                          func export; else the module's own func export
                                          (a "self import")
  env / wasi_snapshot_preview1   global   a loader special; else a main-module global export
  env / wasi_snapshot_preview1   memory,  a main-module export of the same name AND kind
                                 table,
                                 tag
  GOT.func                       global   the module's own func export; a main-module func
                                          export; a `wasmImports` key
  GOT.mem                        global   the module's own global export; a main-module
                                          global export
  any other module               -        nothing (the loader's import object has only these)

  * Loader specials = `__memory_base` / `__table_base` only (the env proxy's
    `switch` returns the module's own bases; main does not export them); each
    counts only if `case "<name>"` is in the given pyodide.asm.mjs.
  * Weak imports get NO exemption; dylink.0 must be the first section; NEEDED
    libraries are not loaded (a symbol only they provide is unresolved).

Required func exports of every module: `PyInit_<stem>` (stem = file name up to
its first dot), `__wasm_call_ctors`, `__wasm_apply_data_relocs` (without them
constructors / data relocations silently do not run).

Self imports are counted and reported; they fail only with
`--max-self-imports N` when a module has more than N.

The `wasmImports = {` block (exactly one) is bracket-matched (strings,
templates, comments respected) and split into keys. Refused (exit 2) when not
found, fewer than --min-js-keys keys (default 500; 314.0.7 has 1,370), or not
covering the main wasm's own env / wasi function imports.

exit: 0 every module passes | 1 a gate failure (unresolved import, missing
      required export, dylink.0 not first, too many self imports) | 2 usage
      error, unreadable or malformed input (wasm, wheel member, JS), or an
      unreadable / implausible wasmImports block (never a pass)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import zipfile
from typing import Any

KIND = {0: "func", 1: "table", 2: "memory", 3: "global", 4: "tag"}
# Non-custom section ids in the order the spec requires (13 = tag sits between
# memory and global, 12 = data count before code).
SECTION_ORDER = [1, 2, 3, 4, 5, 13, 6, 7, 8, 9, 12, 10, 11]
# Sections whose leading vector count is the number of DEFINED items of a kind.
DEFINED_COUNT_SECTION = {3: "func", 4: "table", 5: "memory", 6: "global", 13: "tag"}
VALTYPES = {0x7F, 0x7E, 0x7D, 0x7C, 0x7B, 0x70, 0x6F}
REFTYPES = {0x70, 0x6F}
ENV_MODULES = ("env", "wasi_snapshot_preview1")
# Used only if the given pyodide.asm.mjs names it in a `case` label.
LOADER_SPECIAL_CANDIDATES = ("__memory_base", "__table_base")
REQUIRED_FIXED = ("__wasm_call_ctors", "__wasm_apply_data_relocs")
DEFAULT_MIN_JS_KEYS = 500
WASMIMPORTS_RE = re.compile(r"(?<![A-Za-z0-9_$.])wasmImports\s*=(?!=)\s*\{")
IDENT = r"[A-Za-z_$][A-Za-z0-9_$]*"


class Malformed(Exception):
    """An input that is not what it claims to be (exit 2)."""


# ---- wasm reader -------------------------------------------------------------


class _Reader:
    def __init__(self, data: bytes, pos: int, end: int) -> None:
        self.b = data
        self.i = pos
        self.end = end

    def byte(self) -> int:
        if self.i >= self.end:
            raise Malformed(f"truncated at byte {self.i}")
        v = self.b[self.i]
        self.i += 1
        return v

    def leb(self, bits: int = 32) -> int:
        """Unsigned LEB128, at most ceil(bits/7) bytes, value < 2**bits."""
        result = shift = 0
        start = self.i
        for _ in range((bits + 6) // 7):
            x = self.byte()
            result |= (x & 0x7F) << shift
            shift += 7
            if not x & 0x80:
                if result >> bits:
                    raise Malformed(f"LEB128 at byte {start} overflows u{bits}")
                return result
        raise Malformed(f"LEB128 at byte {start} is longer than u{bits} allows")

    def name(self) -> str:
        n = self.leb()
        if self.i + n > self.end:
            raise Malformed(f"name at byte {self.i} runs past its section")
        raw = self.b[self.i : self.i + n]
        self.i += n
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise Malformed(f"name at byte {self.i - n} is not UTF-8: {exc}") from None

    def limits(self) -> None:
        flags = self.byte()
        if flags & ~0x07:
            raise Malformed(f"bad limits flags 0x{flags:02x} at byte {self.i - 1}")
        bits = 64 if flags & 0x04 else 32
        self.leb(bits)
        if flags & 0x01:
            self.leb(bits)


def _parse_dylink(r: _Reader, out: dict[str, Any]) -> None:
    # subsections: 1 MEM_INFO, 2 NEEDED, 3 EXPORT_INFO, 4 IMPORT_INFO, 5 RUNTIME_PATH
    while r.i < r.end:
        sub = r.byte()
        size = r.leb()
        send = r.i + size
        if send > r.end:
            raise Malformed(f"dylink.0 subsection {sub} runs past the section (byte {r.i})")
        sr = _Reader(r.b, r.i, send)
        if sub == 2:
            out["needed"].extend(sr.name() for _ in range(sr.leb()))
        elif sub == 4:
            for _ in range(sr.leb()):
                mod, field = sr.name(), sr.name()
                if sr.leb() & 0x3 == 1:  # WASM_SYMBOL_BINDING_WEAK, as the loader reads it
                    out["weak"].add((mod, field))
        r.i = send


def parse_wasm(data: bytes) -> dict[str, Any]:
    """Parse the parts the gate needs; raise Malformed on anything inconsistent."""
    if data[:4] != b"\0asm":
        raise Malformed("no wasm magic")
    if data[4:8] != b"\x01\0\0\0":
        raise Malformed(f"unsupported wasm version {data[4:8].hex()}")
    out: dict[str, Any] = {
        "imports": [],
        "exports": [],
        "first_section": None,
        "dylink_sections": 0,
        "needed": [],
        "weak": set(),
    }
    defined = {k: 0 for k in KIND.values()}
    seen_rank = -1
    seen_ids: set[int] = set()
    r = _Reader(data, 8, len(data))
    while r.i < r.end:
        sid = r.byte()
        size = r.leb()
        end = r.i + size
        if end > len(data):
            raise Malformed(f"section {sid} runs past the end of the file")
        sr = _Reader(data, r.i, end)
        if sid == 0:
            cname = sr.name()
            if out["first_section"] is None:
                out["first_section"] = "custom:" + cname
            if cname == "dylink.0":
                out["dylink_sections"] += 1
                _parse_dylink(sr, out)
        else:
            if sid not in SECTION_ORDER:
                raise Malformed(f"unknown section id {sid}")
            if sid in seen_ids:
                raise Malformed(f"section {sid} appears twice")
            rank = SECTION_ORDER.index(sid)
            if rank < seen_rank:
                raise Malformed(f"section {sid} is out of order")
            seen_rank = rank
            seen_ids.add(sid)
            if out["first_section"] is None:
                out["first_section"] = f"id:{sid}"
            if sid == 2:
                for _ in range(sr.leb()):
                    out["imports"].append(_parse_import(sr))
                if sr.i != end:
                    raise Malformed("import section has trailing bytes")
            elif sid == 7:
                names = set()
                for _ in range(sr.leb()):
                    field = sr.name()
                    kind = sr.byte()
                    if kind not in KIND:
                        raise Malformed(f"unknown export kind {kind} for {field!r}")
                    idx = sr.leb()
                    if field in names:
                        raise Malformed(f"duplicate export name {field!r}")
                    names.add(field)
                    out["exports"].append((field, KIND[kind], idx))
                if sr.i != end:
                    raise Malformed("export section has trailing bytes")
            elif sid in DEFINED_COUNT_SECTION:
                defined[DEFINED_COUNT_SECTION[sid]] = sr.leb()
        r.i = end
    imported = {k: 0 for k in KIND.values()}
    for _, _, kind in out["imports"]:
        imported[kind] += 1
    for field, kind, idx in out["exports"]:
        if idx >= imported[kind] + defined[kind]:
            raise Malformed(f"export {field!r} names {kind} {idx}, past the module's {imported[kind] + defined[kind]}")
    return out


def _parse_import(r: _Reader) -> tuple[str, str, str]:
    mod, field = r.name(), r.name()
    kind = r.byte()
    if kind == 0:
        r.leb()
    elif kind == 1:
        if r.byte() not in REFTYPES:
            raise Malformed(f"bad table element type in import {mod}.{field}")
        r.limits()
    elif kind == 2:
        r.limits()
    elif kind == 3:
        if r.byte() not in VALTYPES:
            raise Malformed(f"bad global type in import {mod}.{field}")
        if r.byte() not in (0, 1):
            raise Malformed(f"bad global mutability in import {mod}.{field}")
    elif kind == 4:
        if r.byte() != 0:
            raise Malformed(f"bad tag attribute in import {mod}.{field}")
        r.leb()
    else:
        raise Malformed(f"unknown import kind {kind} for {mod}.{field}")
    return mod, field, KIND[kind]


def load_spec(spec: str) -> tuple[str, bytes]:
    """(display name, bytes) of a path or a `wheel:<whl>!<member>` spec."""
    if spec.startswith("wheel:"):
        whl, sep, member = spec[len("wheel:") :].rpartition("!")
        if not sep or not whl or not member:
            raise Malformed(f"bad wheel spec {spec!r} (want wheel:<path.whl>!<member>)")
        try:
            with zipfile.ZipFile(whl) as z:
                hits = [i for i in z.infolist() if i.filename == member]
                if len(hits) != 1:
                    raise Malformed(f"{whl} has {len(hits)} members named {member!r} (want exactly 1)")
                return os.path.basename(member), z.read(hits[0])
        except (OSError, zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError, ValueError) as exc:
            raise Malformed(f"cannot read {member!r} from {whl}: {type(exc).__name__}: {exc}") from None
    try:
        with open(spec, "rb") as fh:
            return os.path.basename(spec), fh.read()
    except OSError as exc:
        raise Malformed(f"cannot read {spec}: {exc}") from None


# ---- pyodide.asm.mjs: the wasmImports keys ------------------------------------

_CLOSER = {"{": "}", "[": "]", "(": ")"}


def _skip_string(js: str, i: int) -> int:
    """js[i] is a quote; return the index just past the closing one."""
    q = js[i]
    i += 1
    n = len(js)
    while i < n:
        c = js[i]
        if c == "\\":
            i += 2
            continue
        if c == q:
            return i + 1
        if c == "\n" and q != "`":
            raise Malformed(f"newline inside a {q}-string at offset {i}")
        if q == "`" and c == "$" and js.startswith("${", i):
            i = _match(js, i + 1) + 1
            continue
        i += 1
    raise Malformed("unterminated string literal")


def _skip_comment(js: str, i: int) -> int | None:
    """If a comment starts at i, return the index just past it."""
    if js.startswith("//", i):
        j = js.find("\n", i)
        return len(js) if j < 0 else j
    if js.startswith("/*", i):
        j = js.find("*/", i + 2)
        if j < 0:
            raise Malformed("unterminated block comment")
        return j + 2
    return None


def _match(js: str, i: int, split: list[int] | None = None) -> int:
    """js[i] opens a bracket; return the index of its closer. With `split`,
    collect the offsets of commas at depth 1 (the object's own entries)."""
    stack = [_CLOSER[js[i]]]
    i += 1
    n = len(js)
    while i < n:
        c = js[i]
        if c in "\"'`":
            i = _skip_string(js, i)
            continue
        if c == "/":
            j = _skip_comment(js, i)
            if j is not None:
                i = j
                continue
        if c in _CLOSER:
            stack.append(_CLOSER[c])
        elif c in "}])":
            if c != stack.pop():
                raise Malformed(f"mismatched {c!r} at offset {i}")
            if not stack:
                return i
        elif c == "," and split is not None and len(stack) == 1:
            split.append(i)
        i += 1
    raise Malformed("unbalanced brackets: the block never closes")


def _strip_leading_comments(entry: str) -> str:
    entry = entry.strip()
    while True:
        j = _skip_comment(entry, 0)
        if j is None:
            return entry
        entry = entry[j:].strip()


def wasm_imports_keys(js: str) -> list[str]:
    hits = list(WASMIMPORTS_RE.finditer(js))
    if len(hits) != 1:
        raise Malformed(f"found {len(hits)} `wasmImports = {{` assignments (want exactly 1)")
    open_i = hits[0].end() - 1
    commas: list[int] = []
    close_i = _match(js, open_i, commas)
    bounds = [open_i] + commas + [close_i]
    keys: list[str] = []
    for n, (a, b) in enumerate(zip(bounds, bounds[1:])):
        entry = _strip_leading_comments(js[a + 1 : b])
        if not entry:
            if n == len(bounds) - 2 and n > 0:  # one trailing comma
                continue
            raise Malformed(f"empty wasmImports entry #{n}")
        m = (
            re.fullmatch(rf"({IDENT})", entry)
            or re.match(rf"({IDENT})\s*[:(]", entry)
            or re.match(r"\"([^\"\\]+)\"\s*:", entry)
            or re.match(r"'([^'\\]+)'\s*:", entry)
        )
        if not m:
            raise Malformed(f"cannot read wasmImports entry #{n}: {entry[:60]!r}")
        keys.append(m.group(1))
    return keys


def loader_specials(js: str) -> list[str]:
    return [s for s in LOADER_SPECIAL_CANDIDATES if re.search(rf"case\s*([\"']){re.escape(s)}\1\s*:", js)]


# ---- the gate ------------------------------------------------------------------


def required_exports(display: str) -> list[str]:
    stem = display.split(".", 1)[0]
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", stem):
        raise Malformed(f"cannot derive a PyInit_ name from the file name {display!r}")
    return ["PyInit_" + stem, *REQUIRED_FIXED]


def provider(mod: str, field: str, kind: str, ctx: dict[str, Any], own: dict[str, str]) -> str | None:
    """Which source satisfies one import, in the loader's order (None = nobody)."""
    main: dict[str, str] = ctx["main_exports"]
    js: set[str] = ctx["js_keys"]
    if mod in ENV_MODULES:
        if kind == "func":
            if field in js:
                return "js"
            if main.get(field) == "func":
                return "main"
            if own.get(field) == "func":
                return "own"
            return None
        if kind == "global" and field in ctx["specials"]:
            return "special"
        return "main" if main.get(field) == kind else None
    if mod == "GOT.func" and kind == "global":
        if own.get(field) == "func":
            return "own"
        if main.get(field) == "func":
            return "main"
        return "js" if field in js else None
    if mod == "GOT.mem" and kind == "global":
        if own.get(field) == "global":
            return "own"
        return "main" if main.get(field) == "global" else None
    return None


def check_module(spec: str, ctx: dict[str, Any], max_self: int | None) -> dict[str, Any]:
    rep: dict[str, Any] = {"spec": spec, "parsed": False}
    try:
        display, data = load_spec(spec)
        rep.update({"file": display, "bytes": len(data)})
        need = required_exports(display)
        p = parse_wasm(data)
    except Malformed as exc:
        rep["error"] = str(exc)
        return rep
    own = {f: k for f, k, _ in p["exports"]}
    by_source = {"js": 0, "main": 0, "own": 0, "special": 0}
    unresolved: list[str] = []
    self_imports: list[str] = []
    for mod, field, kind in p["imports"]:
        src = provider(mod, field, kind, ctx, own)
        if src is None:
            unresolved.append(f"{mod}.{field} ({kind})")
            continue
        by_source[src] += 1
        if src == "own" and mod in ENV_MODULES:
            self_imports.append(field)
    missing = [n for n in need if own.get(n) != "func"]
    failures = []
    if p["first_section"] != "custom:dylink.0":
        failures.append(f"the first section is {p['first_section']}, not dylink.0 (the loader refuses the module)")
    if p["dylink_sections"] != 1:
        failures.append(f"{p['dylink_sections']} dylink.0 sections (want 1)")
    if unresolved:
        failures.append(f"{len(unresolved)} unresolved import(s): {', '.join(unresolved[:5])}")
    if missing:
        failures.append(f"required export(s) missing: {', '.join(missing)}")
    if max_self is not None and len(self_imports) > max_self:
        failures.append(f"{len(self_imports)} self imports, more than --max-self-imports {max_self}")
    rep.update(
        {
            "parsed": True,
            "imports": len(p["imports"]),
            "exports": len(p["exports"]),
            "imports_by_source": by_source,
            "unresolved": sorted(unresolved),
            "n_unresolved": len(unresolved),
            "required_exports": need,
            "missing_exports": missing,
            "self_imports": len(self_imports),
            "self_import_names": sorted(self_imports),
            "weak_imports": len(p["weak"]),
            "needed": p["needed"],
            "first_section": p["first_section"],
            "failures": failures,
            "ok": not failures,
        }
    )
    return rep


def load_main(main_wasm: str, main_js: str, min_js_keys: int) -> dict[str, Any]:
    _, wasm = load_spec(main_wasm)
    m = parse_wasm(wasm)
    try:
        with open(main_js, encoding="utf-8") as fh:
            js = fh.read()
    except (OSError, UnicodeDecodeError) as exc:
        raise Malformed(f"cannot read {main_js}: {exc}") from None
    keys = wasm_imports_keys(js)
    key_set = set(keys)
    if len(key_set) < min_js_keys:
        raise Malformed(f"wasmImports has only {len(key_set)} keys (< --min-js-keys {min_js_keys}): misread or not Pyodide's loader")
    own_needs = sorted({f for mod, f, k in m["imports"] if mod in ENV_MODULES and k == "func"})
    uncovered = [f for f in own_needs if f not in key_set]
    if not own_needs or uncovered:
        raise Malformed(
            f"wasmImports ({len(key_set)} keys) does not cover the main wasm's own {len(own_needs)} env/wasi "
            f"function imports (missing {len(uncovered)}, e.g. {uncovered[:3]}): misread, or the JS and wasm differ"
        )
    exports = {f: k for f, k, _ in m["exports"]}
    return {
        "main_exports": exports,
        "js_keys": key_set,
        "specials": set(loader_specials(js)),
        "summary": {
            "main_wasm": main_wasm,
            "main_js": main_js,
            "main_exports": len(exports),
            "main_env_function_imports": len(own_needs),
            "wasm_imports_keys": len(key_set),
            "loader_specials": loader_specials(js),
        },
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="check_side_modules.py", description=__doc__.split("\n")[0])
    ap.add_argument("--main-wasm", required=True)
    ap.add_argument("--main-js", required=True)
    ap.add_argument("--json", dest="report")
    ap.add_argument("--max-self-imports", type=int)
    ap.add_argument("--min-js-keys", type=int, default=DEFAULT_MIN_JS_KEYS)
    ap.add_argument("modules", nargs="+")
    args = ap.parse_args(argv[1:])
    if args.max_self_imports is not None and args.max_self_imports < 0:
        ap.error("--max-self-imports must be >= 0")
    report: dict[str, Any] = {"tool": "check_side_modules", "max_self_imports": args.max_self_imports, "modules": []}
    rc = 0
    try:
        ctx = load_main(args.main_wasm, args.main_js, args.min_js_keys)
        report["main"] = ctx["summary"]
        s = ctx["summary"]
        print(
            f"check_side_modules: main {os.path.basename(s['main_wasm'])}: {s['main_exports']} exports; "
            f"{os.path.basename(s['main_js'])}: wasmImports {s['wasm_imports_keys']} keys (cover the main "
            f"wasm's {s['main_env_function_imports']} env/wasi function imports); loader specials {s['loader_specials']}"
        )
    except Malformed as exc:
        report["error"] = f"main module / loader: {exc}"
        print(f"check_side_modules: MAIN MODULE OR LOADER UNREADABLE: {exc}")
        rc = 2
    if rc == 0:
        for spec in args.modules:
            r = check_module(spec, ctx, args.max_self_imports)
            report["modules"].append(r)
            name = r.get("file", spec)
            if not r["parsed"]:
                print(f"check_side_modules: {name}: NOT A READABLE SIDE MODULE ({r['error']})")
                rc = 2
                continue
            b = r["imports_by_source"]
            print(
                f"check_side_modules: {name}: {r['imports']} imports (js {b['js']}, main {b['main']}, "
                f"own {b['own']}, special {b['special']}), unresolved {r['n_unresolved']}, required exports "
                f"{len(r['required_exports']) - len(r['missing_exports'])}/{len(r['required_exports'])}, "
                f"self imports {r['self_imports']} -> {'PASS' if r['ok'] else 'FAIL'}"
            )
            for f in r["failures"]:
                print(f"    - {f}")
            if not r["ok"] and rc == 0:
                rc = 1
    report["exit"] = rc
    report["ok"] = rc == 0
    if args.report:
        try:
            with open(args.report, "w", encoding="utf-8") as fh:
                fh.write(json.dumps(report, indent=1, sort_keys=True) + "\n")
        except OSError as exc:
            print(f"check_side_modules: cannot write {args.report}: {exc}")
            return 2
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv))
