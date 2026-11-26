"""Positive controls for check_side_modules.py on REAL side modules (no compiler).

usage: python3 -I -B side_module_controls.py --main-wasm PYODIDE_ASM_WASM --main-js PYODIDE_ASM_MJS
           --work-dir DIR [--json REPORT] MODULE [MODULE ...]

MODULE is as for the gate. Each module's tampered copies go into a fresh
`DIR/side_controls.XXXX/`; the gate runs on each as a subprocess:

  clean            byte-identical copy                        -> exit 0
  rename_import    one env FUNCTION import renamed in place   -> exit 1, only that name unresolved
                   to an equal-length name nobody provides
  append_import    one env function import appended (count    -> exit 1, only that name unresolved
                   and size re-encoded; parses, not runnable)
  drop_export:<n>  each required export renamed away          -> exit 1, only that name missing
  self_limit       --max-self-imports count-1 and count       -> exit 1 at count-1 (skipped if 0),
                                                                 exit 0 at count

build.sh runs it after the real gate, so a gate that went blind fails the build.

exit: 0 every control caught for the right reason and every clean run passed |
      1 a control not caught, caught for another reason, or a clean run failed |
      2 usage error or an input the controls cannot read
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from types import ModuleType
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
GATE = os.path.join(HERE, "check_side_modules.py")


def _load_gate() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_side_modules", GATE)
    if spec is None or spec.loader is None:
        raise SystemExit(f"side_module_controls: cannot load {GATE}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


gate = _load_gate()


def uleb(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def _name(s: str) -> bytes:
    raw = s.encode()
    return uleb(len(raw)) + raw


def layout(data: bytes) -> dict[str, Any]:
    """Byte offsets of the import section and of every import / export name."""
    out: dict[str, Any] = {"imports": [], "exports": [], "import_section": None}
    r = gate._Reader(data, 8, len(data))
    while r.i < r.end:
        sec_start = r.i
        sid = r.byte()
        size = r.leb()
        end = r.i + size
        sr = gate._Reader(data, r.i, end)
        if sid == 2:
            count = sr.leb()
            out["import_section"] = {"start": sec_start, "end": end, "count": count, "entries": sr.i}
            for _ in range(count):
                start = sr.i
                mod, field = sr.name(), sr.name()
                field_end = sr.i
                sr.i = start
                _, _, kind = gate._parse_import(sr)
                out["imports"].append((mod, field, kind, field_end - len(field.encode()), field_end))
        elif sid == 7:
            for _ in range(sr.leb()):
                field = sr.name()
                field_end = sr.i
                kind = sr.byte()
                sr.leb()
                out["exports"].append((field, gate.KIND.get(kind), field_end - len(field.encode()), field_end))
        r.i = end
    return out


def unprovided_name(length: int, taken: set[str]) -> str:
    """An ASCII name of exactly `length` bytes that is in no provider set."""
    for tag in "QZXWVK":
        base = f"agdb_ctl_{tag}_unresolved_"
        cand = (base + tag * length)[:length] if length >= 4 else tag * length
        if cand not in taken:
            return cand
    raise RuntimeError(f"no free {length}-byte name")


def renamed(field: str, taken: set[str]) -> str:
    """Same length, first character changed, not an existing name."""
    for c in "XYZQWK":
        cand = c + field[1:]
        if cand != field and cand not in taken:
            return cand
    raise RuntimeError(f"cannot rename {field!r}")


def splice(orig: bytes, start: int, end: int, new: str) -> bytes:
    """Replace a name's bytes in place; refuse anything that would move a byte."""
    raw = new.encode()
    if len(raw) != end - start:
        raise RuntimeError(f"in-place rename to {new!r} would change the module size")
    return orig[:start] + raw + orig[end:]


def run_gate(path: str, out_dir: str, label: str, main_wasm: str, main_js: str, extra: list[str]) -> dict[str, Any]:
    rep_path = os.path.join(out_dir, f"{label}.gate.json")
    if os.path.exists(rep_path):
        os.remove(rep_path)
    cmd = [sys.executable, "-I", "-B", GATE, "--json", rep_path, "--main-wasm", main_wasm, "--main-js", main_js, *extra, path]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    res: dict[str, Any] = {"rc": proc.returncode, "stdout_tail": proc.stdout.strip().splitlines()[-3:]}
    try:
        with open(rep_path, encoding="utf-8") as fh:
            rep = json.load(fh)
        res["module"] = rep["modules"][0] if rep.get("modules") else None
    except (OSError, ValueError, KeyError, IndexError) as exc:
        res["module"] = None
        res["report_error"] = f"{type(exc).__name__}: {exc}"
    return res


def _write(dir_: str, name: str, data: bytes) -> str:
    os.makedirs(dir_, exist_ok=True)
    p = os.path.join(dir_, name)
    with open(p, "wb") as fh:
        fh.write(data)
    return p


def controls_for(spec: str, base: str, idx: int, args: argparse.Namespace, ctx: dict[str, Any]) -> list[dict[str, Any]]:
    display, orig = gate.load_spec(spec)
    p = gate.parse_wasm(orig)  # raises Malformed on an unreadable module -> exit 2
    lay = layout(orig)
    need = gate.required_exports(display)
    own = {f for f, _, _ in p["exports"]}
    imported = {f for _, f, _ in p["imports"]}
    taken = own | imported | set(ctx["main_exports"]) | ctx["js_keys"] | ctx["specials"]
    mdir = os.path.join(base, f"{idx}-{display.split('.', 1)[0]}")
    results: list[dict[str, Any]] = []

    def record(control: str, data: bytes, want_rc: int, check: Any, extra: list[str] | None = None, note: str = "") -> dict[str, Any]:
        cdir = os.path.join(mdir, control.replace(":", "_"))
        path = _write(cdir, display, data)
        g = run_gate(path, cdir, "run", args.main_wasm, args.main_js, extra or [])
        m = g.get("module")
        why = None
        if g["rc"] != want_rc:
            why = f"gate exit {g['rc']}, want {want_rc}"
        elif m is None or not m.get("parsed"):
            why = f"gate report unusable: {g.get('report_error') or (m or {}).get('error')}"
        else:
            why = check(m)
        r = {
            "module": display,
            "control": control,
            "note": note,
            "gate_exit": g["rc"],
            "want_exit": want_rc,
            "unresolved": (m or {}).get("unresolved"),
            "missing_exports": (m or {}).get("missing_exports"),
            "self_imports": (m or {}).get("self_imports"),
            "gate_failures": (m or {}).get("failures"),
            "ok": why is None,
            "why_not": why,
        }
        results.append(r)
        return r

    # clean
    clean = record("clean", orig, 0, lambda m: None if m["ok"] and not m["unresolved"] and not m["missing_exports"] else "clean copy not clean")
    n_self = clean.get("self_imports") or 0

    # rename_import: the first env function import, renamed in place
    cands = [e for e in lay["imports"] if e[0] == "env" and e[2] == "func" and len(e[1].encode()) >= 4]
    if not cands:
        results.append({"module": display, "control": "rename_import", "ok": False, "why_not": "no env function import to rename"})
    else:
        _, old, _, fs, fe = cands[0]
        new = unprovided_name(fe - fs, taken)
        t = splice(orig, fs, fe, new)
        want = [f"env.{new} (func)"]
        record(
            "rename_import",
            t,
            1,
            lambda m: None if m["unresolved"] == want and not m["missing_exports"] else f"unresolved {m['unresolved'][:3]}, missing {m['missing_exports']}",
            note=f"env.{old} -> env.{new}",
        )

    # append_import: one more env function import, count and size re-encoded
    sec = lay["import_section"]
    if sec is None:
        results.append({"module": display, "control": "append_import", "ok": False, "why_not": "no import section"})
    else:
        new = unprovided_name(28, taken)
        entry = _name("env") + _name(new) + b"\x00" + uleb(0)
        body = uleb(sec["count"] + 1) + orig[sec["entries"] : sec["end"]] + entry
        t = orig[: sec["start"]] + b"\x02" + uleb(len(body)) + body + orig[sec["end"] :]
        want_a = [f"env.{new} (func)"]
        n_imports = len(p["imports"])
        record(
            "append_import",
            t,
            1,
            lambda m: None
            if m["unresolved"] == want_a and not m["missing_exports"] and m["imports"] == n_imports + 1
            else f"unresolved {m['unresolved'][:3]}, missing {m['missing_exports']}, imports {m['imports']}",
            note=f"+ env.{new} (import count {n_imports} -> {n_imports + 1})",
        )

    # drop_export:<name>: each required export renamed in place
    exp_at = {f: (fs, fe) for f, _, fs, fe in lay["exports"]}
    for name in need:
        if name not in exp_at:
            results.append({"module": display, "control": f"drop_export:{name}", "ok": False, "why_not": "the clean module does not export it"})
            continue
        fs, fe = exp_at[name]
        new = renamed(name, own)
        t = splice(orig, fs, fe, new)
        record(
            f"drop_export:{name}",
            t,
            1,
            lambda m, name=name: None if m["missing_exports"] == [name] and not m["unresolved"] else f"missing {m['missing_exports']}, unresolved {m['unresolved'][:3]}",
            note=f"{name} -> {new}",
        )

    # self_limit: the option is live (and means "more than N")
    if n_self > 0:
        record(
            "self_limit:over",
            orig,
            1,
            lambda m: None
            if any("self imports" in f for f in m["failures"]) and not m["unresolved"] and not m["missing_exports"]
            else f"failures {m['failures']}",
            extra=["--max-self-imports", str(n_self - 1)],
            note=f"--max-self-imports {n_self - 1} with {n_self}",
        )
    else:
        results.append({"module": display, "control": "self_limit:over", "ok": True, "skipped": True, "note": "the module has 0 self imports"})
    record("self_limit:at", orig, 0, lambda m: None if m["ok"] else f"failures {m['failures']}", extra=["--max-self-imports", str(n_self)], note=f"--max-self-imports {n_self} with {n_self}")
    return results


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="side_module_controls.py", description=__doc__.split("\n")[0])
    ap.add_argument("--main-wasm", required=True)
    ap.add_argument("--main-js", required=True)
    ap.add_argument("--work-dir", required=True)
    ap.add_argument("--json", dest="report")
    ap.add_argument("modules", nargs="+")
    args = ap.parse_args(argv[1:])
    try:
        ctx = gate.load_main(args.main_wasm, args.main_js, gate.DEFAULT_MIN_JS_KEYS)
        os.makedirs(args.work_dir, exist_ok=True)
        base = tempfile.mkdtemp(prefix="side_controls.", dir=args.work_dir)
    except (gate.Malformed, OSError) as exc:
        print(f"side_module_controls: cannot read the inputs: {exc}")
        return 2
    results: list[dict[str, Any]] = []
    for i, spec in enumerate(args.modules):
        try:
            results.extend(controls_for(spec, base, i, args, ctx))
        except gate.Malformed as exc:
            print(f"side_module_controls: {spec}: NOT A READABLE SIDE MODULE ({exc})")
            return 2
    for r in results:
        passing_run = r["control"] in ("clean", "self_limit:at")  # must pass, not be caught
        if r.get("skipped"):
            state = "SKIPPED"
        elif passing_run:
            state = "PASS" if r["ok"] else "FAIL"
        else:
            state = "CAUGHT" if r["ok"] else "NOT CAUGHT"
        parts = [r["note"]] if r.get("note") else []
        if not r.get("skipped") and "gate_exit" in r:
            reason = r["unresolved"] or r["missing_exports"] or [f for f in (r.get("gate_failures") or []) if "self imports" in f]
            parts.append(f"gate exit {r['gate_exit']} (want {r['want_exit']})" + (f", reason {reason[:2]}" if reason else ""))
        if r.get("why_not"):
            parts.append(r["why_not"])
        print(f"side_module_controls: {r['module']}: {r['control']}: {'; '.join(parts)} -> {state}")
    bad = [r for r in results if not r["ok"]]
    print(f"side_module_controls: work dir {base}")
    print(f"side_module_controls: {len(results)} runs, {len(bad)} not as required -> {'PASS' if not bad else 'FAIL'}")
    if args.report:
        try:
            with open(args.report, "w", encoding="utf-8") as fh:
                fh.write(json.dumps({"tool": "side_module_controls", "work_dir": base, "results": results, "ok": not bad}, indent=1, sort_keys=True) + "\n")
        except OSError as exc:
            print(f"side_module_controls: cannot write {args.report}: {exc}")
            return 2
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
