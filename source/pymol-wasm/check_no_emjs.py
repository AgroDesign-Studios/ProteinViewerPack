"""Fail if a wasm module carries EM_JS / EM_ASM / emscripten_run_script.

Each of those makes the module evaluate JavaScript from a string at run time,
which needs 'unsafe-eval' in the page's CSP. ADR-0049 forbids 'unsafe-eval' on
every policy (TN0110 §4.2-2, §7-2), so the build refuses such a module rather
than leaving the CSP to discover it in the browser.

Two independent looks, both must be clean:
  structural  the module is parsed: import and export names, custom-section
              names, the dylink.0 needed / export-info / import-info names, and
              the name section (module name and every flat name map).
  raw         the whole file is grepped, case-insensitively, for the markers.
The markers: __em_js__, em_js, em_asm (also covers __start_em_asm /
emscripten_asm_const_*), emscripten_run_script, emscripten_asm_const.

usage: python3 -I check_no_emjs.py [--json REPORT] FILE [FILE ...]
exit:  0 every file clean | 1 a marker was found | 2 a file is not a readable
       wasm module (fail closed: an unparsable module is not a clean one)
Ported from an earlier build's check (TN0110 §2.1), which found 0 markers in _cmd and
_champ and 5 in an EM_JS + EM_ASM + run_script positive control.
"""

import json
import os
import re
import sys

# "run_script" (not "emscripten_run_script") so the match also covers
# emscripten_async_run_script, which likewise ends in a JS eval in Pyodide 314.
MARKERS = ("__em_js__", "em_js", "em_asm", "run_script", "emscripten_asm_const")
PATTERNS = [re.compile(re.escape(m), re.I) for m in MARKERS]
RAW_PATTERNS = [re.compile(re.escape(m).encode(), re.I) for m in MARKERS]
KIND = {0: "func", 1: "table", 2: "memory", 3: "global", 4: "tag"}


class WasmError(Exception):
    pass


class _Reader:
    def __init__(self, data: bytes, pos: int = 0, end: int | None = None) -> None:
        self.b = data
        self.i = pos
        self.end = len(data) if end is None else end

    def byte(self) -> int:
        if self.i >= self.end:
            raise WasmError(f"truncated at byte {self.i}")
        v = self.b[self.i]
        self.i += 1
        return v

    def uleb(self) -> int:
        result = shift = 0
        while True:
            x = self.byte()
            result |= (x & 0x7F) << shift
            shift += 7
            if not x & 0x80:
                return result
            if shift > 63:
                raise WasmError(f"LEB128 too long at byte {self.i}")

    def name(self) -> str:
        n = self.uleb()
        if self.i + n > self.end:
            raise WasmError(f"name runs past its section at byte {self.i}")
        s = self.b[self.i : self.i + n].decode("utf-8", "replace")
        self.i += n
        return s

    def limits(self) -> None:
        flags = self.uleb()
        self.uleb()
        if flags & 1:
            self.uleb()


def _parse_import(r: _Reader) -> tuple[str, str, str]:
    mod, field = r.name(), r.name()
    kind = r.byte()
    if kind == 0:
        r.uleb()
    elif kind == 1:
        r.byte()
        r.limits()
    elif kind == 2:
        r.limits()
    elif kind == 3:
        r.byte()
        r.byte()
    elif kind == 4:
        r.byte()
        r.uleb()
    else:
        raise WasmError(f"unknown import kind {kind}")
    return mod, field, KIND[kind]


def _parse_dylink(r: _Reader, out: dict[str, list]) -> None:
    # subsections: 1 MEM_INFO, 2 NEEDED, 3 EXPORT_INFO, 4 IMPORT_INFO, 5 RUNTIME_PATH
    while r.i < r.end:
        sub = r.byte()
        size = r.uleb()
        send = r.i + size
        if send > r.end:
            raise WasmError(f"dylink subsection {sub} runs past the section (byte {r.i})")
        sr = _Reader(r.b, r.i, send)
        if sub == 2:
            for _ in range(sr.uleb()):
                out["dylink_names"].append(("needed", sr.name()))
        elif sub == 3:
            for _ in range(sr.uleb()):
                n = sr.name()
                sr.uleb()
                out["dylink_names"].append(("export_info", n))
        elif sub == 4:
            for _ in range(sr.uleb()):
                m, n = sr.name(), sr.name()
                sr.uleb()
                out["dylink_names"].append(("import_info", f"{m}.{n}"))
        elif sub == 5:
            for _ in range(sr.uleb()):
                out["dylink_names"].append(("runtime_path", sr.name()))
        r.i += size


def _parse_name_section(r: _Reader, out: dict[str, list]) -> None:
    while r.i < r.end:
        sub = r.byte()
        size = r.uleb()
        send = r.i + size
        if send > r.end:
            raise WasmError(f"name subsection {sub} runs past the section (byte {r.i})")
        sr = _Reader(r.b, r.i, send)
        if sub == 0:  # module name
            out["name_section_names"].append(sr.name())
        elif sub in (2, 3, 10):  # indirect maps: local, label and field names
            for _ in range(sr.uleb()):
                sr.uleb()
                for _ in range(sr.uleb()):
                    sr.uleb()
                    out["name_section_names"].append(sr.name())
        elif sub in (1, 4, 5, 6, 7, 8, 9, 11):  # flat maps: functions, types, tables, memories, globals, elems, data, tags
            for _ in range(sr.uleb()):
                sr.uleb()
                out["name_section_names"].append(sr.name())
        # any other subsection is skipped here; the raw grep still reads its bytes
        r.i += size


def parse(data: bytes) -> dict[str, list]:
    if data[:4] != b"\0asm":
        raise WasmError("no wasm magic")
    if data[4:8] != b"\x01\0\0\0":
        raise WasmError(f"unsupported wasm version {data[4:8].hex()}")
    out: dict[str, list] = {"imports": [], "exports": [], "custom_sections": [], "dylink_names": [], "name_section_names": []}
    r = _Reader(data, 8)
    while r.i < r.end:
        sid = r.byte()
        size = r.uleb()
        end = r.i + size
        if end > len(data):
            raise WasmError(f"section {sid} runs past the end of the file")
        sr = _Reader(data, r.i, end)
        if sid == 0:
            cname = sr.name()
            out["custom_sections"].append(cname)
            if cname == "dylink.0":
                _parse_dylink(sr, out)
            elif cname == "name":
                _parse_name_section(sr, out)
        elif sid == 2:
            for _ in range(sr.uleb()):
                out["imports"].append(_parse_import(sr))
        elif sid == 7:
            for _ in range(sr.uleb()):
                field = sr.name()
                kind = sr.byte()
                sr.uleb()
                out["exports"].append((field, KIND.get(kind, str(kind))))
        r.i = end
    return out


def _hits(names) -> list[str]:
    return sorted({n for n in names if any(p.search(n) for p in PATTERNS)})


def check(path: str) -> dict:
    rep: dict = {"file": os.path.basename(path)}
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError as exc:
        rep.update({"bytes": 0, "error": f"cannot read: {exc}", "clean": False, "parsed": False})
        return rep
    rep["bytes"] = len(data)
    try:
        p = parse(data)
    except Exception as exc:  # malformed module -> not readable, fail closed (exit 2)
        rep.update({"error": f"{type(exc).__name__}: {exc}", "clean": False, "parsed": False})
        return rep
    rep.update(
        {
            "parsed": True,
            "n_imports": len(p["imports"]),
            "n_exports": len(p["exports"]),
            "custom_sections": p["custom_sections"],
            "n_dylink_names": len(p["dylink_names"]),
            "n_name_section_names": len(p["name_section_names"]),
            "forbidden_in_imports": _hits(f"{m}.{f}" for m, f, _ in p["imports"]),
            "forbidden_in_exports": _hits(f for f, _ in p["exports"]),
            "forbidden_in_custom_section_names": _hits(p["custom_sections"]),
            "forbidden_in_dylink": _hits(n for _, n in p["dylink_names"]),
            "forbidden_in_name_section": _hits(p["name_section_names"]),
            "raw_byte_grep_counts": {m: len(pat.findall(data)) for m, pat in zip(MARKERS, RAW_PATTERNS)},
        }
    )
    rep["structural_hits"] = sum(len(v) for k, v in rep.items() if k.startswith("forbidden_in_"))
    rep["raw_hits"] = sum(rep["raw_byte_grep_counts"].values())
    rep["clean"] = rep["structural_hits"] == 0 and rep["raw_hits"] == 0
    return rep


def main(argv: list[str]) -> int:
    args = argv[1:]
    report = None
    if args[:1] == ["--json"]:
        if len(args) < 2:
            print(__doc__, file=sys.stderr)
            return 2
        report, args = args[1], args[2:]
    if not args:
        print(__doc__, file=sys.stderr)
        return 2
    reps = [check(f) for f in args]
    text = json.dumps(reps, indent=1, sort_keys=True)
    if report:
        with open(report, "w") as fh:
            fh.write(text + "\n")
    for r in reps:
        if not r["parsed"]:
            print(f"check_no_emjs: {r['file']}: NOT A READABLE WASM MODULE ({r['error']})")
        else:
            print(f"check_no_emjs: {r['file']}: structural {r['structural_hits']}, raw {r['raw_hits']} -> {'clean' if r['clean'] else 'FORBIDDEN'}")
    if any(not r["parsed"] for r in reps):
        return 2
    return 0 if all(r["clean"] for r in reps) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
