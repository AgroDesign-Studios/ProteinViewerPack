"""The .pyc gate: the compiled bytecode in the stdlib zip and the PyMOL wheel is
exactly what the runtime will use, and nothing stale.

usage: python3 -I -B check_pyc.py --lock PYODIDE_LOCK_JSON [--magic HEX] [--targets TARGETS_JSON]
           [--expect-pyc] [--json REPORT] STDLIB_ZIP WHEEL

  G1 every .pyc (zip and wheel) starts with the runtime's magic (else: stdlib
     unimportable, wheel silently ignored).
  G2 every .pyc is unchecked-hash based (PEP 552 flags == 0b01).
  G3 every wheel .pyc sits at <dir>/__pycache__/<mod>.<cache-tag>.pyc, its
     <dir>/<mod>.py is in the wheel, and it carries that .py's source hash (a
     stale unchecked .pyc runs the OLD code).
  G4 the stdlib .pyc are sourceless: no x.py beside an x.pyc, and no
     __pycache__/ in the zip (zipimport never reads it).
  G5 chempy/pkl.py is in the wheel as source, has no .pyc anywhere, and still
     carries patch 0006's marks (`RESTRICTED_GLOBALS`, `pickle.loads =
     restricted_loads`).
  G6 the wheel's member order is build.sh step 7's rule (byte-sorted,
     .dist-info last); no archive holds a member name twice.
  G7 (only with --targets) the .pyc are EXACTLY the targets: stdlib x.py ships
     as x.pyc, a wheel target gains its __pycache__ .pyc, nothing else.
  G8 (only with --expect-pyc) both archives carry at least one .pyc.

The runtime is --lock's `info.python` (e.g. "3.14.2"; cache tag
cpython-<major><minor>). The magic is --magic (8 hex digits, e.g. 2b0e0d0a) or
DERIVED from this CPython when it is a final release of the runtime's
major.minor; otherwise exit 2. G3's source hash is keyed by that magic.

--targets JSON, schema 1 (PR-3 creates it, e.g. pymol-wasm/pyc_targets.json):
    {"schema": 1,
     "stdlib": ["asyncio/__init__.py", ...],   stdlib zip members shipped as sourceless .pyc
     "wheel": ["pymol/__init__.py", ...],      wheel .py members that gain __pycache__ .pyc
     "comment": "optional provenance text"}
  Each list holds unique relative POSIX paths ending in .py (no leading "/",
  no "..", no "__pycache__"); any other key is an error. chempy/pkl.py may not
  be a target (G5).

Today's shipped runtime has no .pyc: passes without --expect-pyc, fails with it.

exit: 0 every rule holds | 1 a rule failed | 2 usage error, an unreadable
      archive / lock / targets file, or a magic that cannot be derived
"""

from __future__ import annotations

import _imp
import argparse
import importlib.util
import json
import re
import sys
import zipfile
from collections import Counter
from typing import Any

PKL = "chempy/pkl.py"
PKL_MARKS = ("RESTRICTED_GLOBALS", "pickle.loads = restricted_loads")
TARGET_KEYS = {"schema", "stdlib", "wheel", "comment"}
PYCACHE_RE = re.compile(r"(?:(?P<dir>.+)/)?__pycache__/(?P<base>[^/]+)\.pyc")
MAX_LISTED = 20


class Unreadable(Exception):
    """An input the gate cannot judge (exit 2)."""


def runtime_version(lock_path: str) -> tuple[int, int, str]:
    try:
        with open(lock_path, encoding="utf-8") as fh:
            ver = json.load(fh)["info"]["python"]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise Unreadable(f"cannot read info.python from {lock_path}: {type(exc).__name__}: {exc}") from None
    m = re.fullmatch(r"(\d+)\.(\d+)(?:\.\d+)?", str(ver))
    if not m:
        raise Unreadable(f"{lock_path}: info.python {ver!r} is not X.Y[.Z]")
    return int(m.group(1)), int(m.group(2)), str(ver)


def runtime_magic(arg: str | None, major: int, minor: int, full: str) -> tuple[bytes, str]:
    if arg is not None:
        try:
            magic = bytes.fromhex(arg)
        except ValueError:
            raise Unreadable(f"--magic {arg!r} is not hex") from None
        if len(magic) != 4 or magic[2:] != b"\r\n":
            raise Unreadable(f"--magic {arg!r} is not a 4-byte pyc magic ending in 0d0a")
        return magic, "argument"
    host = sys.version_info
    if sys.implementation.name == "cpython" and (host.major, host.minor) == (major, minor) and host.releaselevel == "final":
        return importlib.util.MAGIC_NUMBER, (
            f"derived: host CPython {host.major}.{host.minor}.{host.micro} is the runtime's {major}.{minor} series ({full})"
        )
    raise Unreadable(
        f"cannot derive the magic: this is {sys.implementation.name} {host.major}.{host.minor}.{host.micro} "
        f"({host.releaselevel}), the runtime is CPython {full}; pass --magic"
    )


def read_archive(path: str) -> tuple[list[str], dict[str, bytes]]:
    """Member names in order (directories included) and the bytes of every file member."""
    try:
        with zipfile.ZipFile(path) as z:
            names = [i.filename for i in z.infolist()]
            data = {i.filename: z.read(i) for i in z.infolist() if not i.is_dir()}
    except (OSError, zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError, ValueError, EOFError) as exc:
        raise Unreadable(f"cannot read {path}: {type(exc).__name__}: {exc}") from None
    return names, data


def read_targets(path: str) -> dict[str, list[str]]:
    try:
        with open(path, encoding="utf-8") as fh:
            t = json.load(fh)
    except (OSError, ValueError) as exc:
        raise Unreadable(f"cannot read targets {path}: {type(exc).__name__}: {exc}") from None
    if not isinstance(t, dict):
        raise Unreadable(f"targets {path}: not a JSON object")
    extra = set(t) - TARGET_KEYS
    if extra:
        raise Unreadable(f"targets {path}: unknown key(s) {sorted(extra)}")
    if t.get("schema") != 1:
        raise Unreadable(f"targets {path}: schema is {t.get('schema')!r}, want 1")
    if "comment" in t and not isinstance(t["comment"], str):
        raise Unreadable(f"targets {path}: comment must be a string")
    out: dict[str, list[str]] = {}
    for key in ("stdlib", "wheel"):
        lst = t.get(key)
        if not isinstance(lst, list) or not all(isinstance(x, str) for x in lst):
            raise Unreadable(f"targets {path}: {key!r} must be a list of strings")
        for x in lst:
            parts = x.split("/")
            if not x.endswith(".py") or x.startswith("/") or "\\" in x or ".." in parts or "" in parts or "__pycache__" in parts:
                raise Unreadable(f"targets {path}: {key} entry {x!r} is not a relative POSIX .py path")
        if len(set(lst)) != len(lst):
            raise Unreadable(f"targets {path}: {key} lists a path twice")
        out[key] = lst
    return out


def pycache_path(src: str, tag: str) -> str:
    d, _, base = src.rpartition("/")
    return (d + "/" if d else "") + "__pycache__/" + base[: -len(".py")] + "." + tag + ".pyc"


def _header(blob: bytes) -> tuple[bytes, int | None, bytes]:
    if len(blob) < 16:
        return blob[:4], None, b""
    return blob[:4], int.from_bytes(blob[4:8], "little"), blob[8:16]


def check(args: argparse.Namespace) -> dict[str, Any]:
    major, minor, full = runtime_version(args.lock)
    magic, magic_src = runtime_magic(args.magic, major, minor, full)
    tag = f"cpython-{major}{minor}"
    targets = read_targets(args.targets) if args.targets else None
    s_names, s_data = read_archive(args.stdlib)
    w_names, w_data = read_archive(args.wheel)
    key = int.from_bytes(magic, "little")
    fails: dict[str, list[str]] = {g: [] for g in ("G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8")}

    def header_rules(where: str, name: str, blob: bytes) -> bytes:
        m, flags, h = _header(blob)
        if m != magic:
            fails["G1"].append(f"{where} {name}: magic {m.hex()} (runtime {magic.hex()})")
        if flags is None:
            fails["G2"].append(f"{where} {name}: header truncated ({len(blob)} bytes)")
        elif flags != 0b01:
            fails["G2"].append(f"{where} {name}: flags {flags:#04b} (want 0b01, unchecked hash)")
        return h

    s_pyc = [n for n in s_names if n.endswith(".pyc")]
    s_set = set(s_names)
    for n in s_pyc:
        header_rules("stdlib", n, s_data.get(n, b""))
        if n[:-1] in s_set:
            fails["G4"].append(f"stdlib {n}: its source {n[:-1]} is in the zip too")
    for n in s_names:
        if "__pycache__/" in n or n.startswith("__pycache__"):
            fails["G4"].append(f"stdlib {n}: zipimport never reads __pycache__")

    w_pyc = [n for n in w_names if n.endswith(".pyc")]
    w_set = set(w_names)
    hash_ok = 0
    for n in w_pyc:
        h = header_rules("wheel", n, w_data.get(n, b""))
        m = PYCACHE_RE.fullmatch(n)
        if not m:
            fails["G3"].append(f"wheel {n}: a .pyc outside __pycache__")
            continue
        if not m.group("base").endswith("." + tag) or "." in m.group("base")[: -len(tag) - 1]:
            fails["G3"].append(f"wheel {n}: cache tag is not {tag} (the runtime never reads it)")
            continue
        src = (m.group("dir") + "/" if m.group("dir") else "") + m.group("base")[: -len(tag) - 1] + ".py"
        if src not in w_set:
            fails["G3"].append(f"wheel {n}: no {src} beside it")
            continue
        if h != _imp.source_hash(key, w_data[src]):
            fails["G3"].append(f"wheel {n}: source hash differs from {src} (a stale .pyc)")
            continue
        hash_ok += 1

    if PKL not in w_data:
        fails["G5"].append(f"wheel has no {PKL} source")
    else:
        text = w_data[PKL].decode("utf-8", "replace")
        for mark in PKL_MARKS:
            if mark not in text:
                fails["G5"].append(f"{PKL} lost patch 0006's mark {mark!r}")
    pkl_pycs = [n for n in w_names if n == PKL + "c" or n.startswith("chempy/__pycache__/pkl.")]
    if pkl_pycs:
        fails["G5"].append(f"{PKL} has compiled copies: {pkl_pycs}")
    if targets is not None and PKL in targets["wheel"]:
        fails["G5"].append(f"{PKL} is listed as a .pyc target")

    if w_names != sorted(w_names, key=lambda n: (".dist-info/" in n, n.encode())):
        fails["G6"].append("wheel member order is not build.sh step 7's rule (byte-sorted, .dist-info last)")
    for where, names in (("stdlib", s_names), ("wheel", w_names)):
        dup = sorted(n for n, c in Counter(names).items() if c > 1)
        if dup:
            fails["G6"].append(f"{where} holds member name(s) twice: {dup[:5]}")

    if targets is not None:
        want_s = {t[:-3] + ".pyc" for t in targets["stdlib"]}
        for n in sorted(want_s - set(s_pyc)):
            fails["G7"].append(f"stdlib target {n[:-1]} is not shipped as {n}")
        for n in sorted(set(s_pyc) - want_s):
            fails["G7"].append(f"stdlib {n} is not a target")
        want_w = {pycache_path(t, tag) for t in targets["wheel"]}
        for t in targets["wheel"]:
            if t not in w_set:
                fails["G7"].append(f"wheel target {t} is not in the wheel")
        for n in sorted(want_w - set(w_pyc)):
            fails["G7"].append(f"wheel target has no {n}")
        for n in sorted(set(w_pyc) - want_w):
            fails["G7"].append(f"wheel {n} is not a target")
    if args.expect_pyc and not (s_pyc and w_pyc):
        fails["G8"].append(f"--expect-pyc: stdlib has {len(s_pyc)} .pyc, wheel has {len(w_pyc)} (want both > 0)")

    return {
        "tool": "check_pyc",
        "runtime_python": full,
        "cache_tag": tag,
        "magic": magic.hex(),
        "magic_source": magic_src,
        "stdlib": {"path": args.stdlib, "members": len(s_names), "pyc": len(s_pyc), "py": sum(1 for n in s_names if n.endswith(".py"))},
        "wheel": {"path": args.wheel, "members": len(w_names), "pyc": len(w_pyc), "source_hash_ok": hash_ok},
        "targets": None if targets is None else {"path": args.targets, "stdlib": len(targets["stdlib"]), "wheel": len(targets["wheel"])},
        "expect_pyc": bool(args.expect_pyc),
        "rules": {g: {"ok": not f, "failures": f} for g, f in fails.items()},
        "ok": not any(fails.values()),
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="check_pyc.py", description=__doc__.split("\n")[0])
    ap.add_argument("--lock", required=True)
    ap.add_argument("--magic")
    ap.add_argument("--targets")
    ap.add_argument("--expect-pyc", action="store_true")
    ap.add_argument("--json", dest="report")
    ap.add_argument("stdlib")
    ap.add_argument("wheel")
    args = ap.parse_args(argv[1:])
    try:
        rep = check(args)
        rc = 0 if rep["ok"] else 1
    except Unreadable as exc:
        rep = {"tool": "check_pyc", "ok": False, "error": str(exc)}
        rc = 2
    rep["exit"] = rc
    if rc == 2:
        print(f"check_pyc: CANNOT JUDGE: {rep['error']}")
    else:
        print(
            f"check_pyc: runtime CPython {rep['runtime_python']} ({rep['cache_tag']}), magic {rep['magic']} ({rep['magic_source']}); "
            f"stdlib {rep['stdlib']['pyc']} .pyc / {rep['stdlib']['py']} .py, wheel {rep['wheel']['pyc']} .pyc "
            f"({rep['wheel']['source_hash_ok']} with a matching source hash)"
            + (f"; targets {rep['targets']['stdlib']} stdlib + {rep['targets']['wheel']} wheel" if rep["targets"] else "")
        )
        for g, r in rep["rules"].items():
            if (g == "G7" and rep["targets"] is None) or (g == "G8" and not rep["expect_pyc"]):
                print(f"check_pyc: {g} not asked")
                continue
            print(f"check_pyc: {g} {'ok' if r['ok'] else 'FAIL (%d)' % len(r['failures'])}")
            for f in r["failures"][:MAX_LISTED]:
                print(f"    - {f}")
        print(f"check_pyc: -> {'PASS' if rc == 0 else 'FAIL'}")
    if args.report:
        try:
            with open(args.report, "w", encoding="utf-8") as fh:
                fh.write(json.dumps(rep, indent=1, sort_keys=True) + "\n")
        except OSError as exc:
            print(f"check_pyc: cannot write {args.report}: {exc}")
            return 2
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv))
