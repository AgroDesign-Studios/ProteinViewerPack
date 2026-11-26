"""S1-11: put the compiled .pyc into python_stdlib.zip and the PyMOL wheel.

usage: python3 -I -B pyc_assemble.py [--json REPORT] TARGETS_JSON
           STDLIB_IN STD_PYC_DIR STDLIB_OUT WHEEL_IN SITE_PYC_DIR WHEEL_OUT

TARGETS_JSON is pyc_targets.json (schema 1, the one tests/check_pyc.py --targets
reads); STD_PYC_DIR / SITE_PYC_DIR are pyc_compile.mjs's out dirs for kind std /
site (the .pyc plus _summary.json). SOURCE_DATE_EPOCH must be set (build.sh sets it).
build.sh runs this AFTER wheel.sh: it is the last change to both archives (a .py
edited after its unchecked-hash .pyc was made would silently run the old code).

stdlib zip  each `stdlib` target x.py is REPLACED, in its place, by the sourceless
            x.pyc with the same ZipInfo fields (the name aside). The WHOLE archive is
            re-packed at deflate level 9 (owner ruling 2026-11-17; the core's zip is
            level 6); stored members (the directories) stay stored. Every other
            member keeps its content (CRC, size and bytes asserted) and its fields.
wheel       each `wheel` target keeps its .py and gains
            <dir>/__pycache__/<mod>.<cache-tag>.pyc; the wheel is rewritten by
            make_wheel.write_wheel (this script's directory), so member order,
            timestamps, modes, deflate 9 and the RECORD rows follow make_wheel.py.

Refused (exit 1): a target missing from its archive or its .pyc dir; a .pyc that is
not a target (added) or a target without one (dropped); chempy/pkl.py listed or
compiled (patch 0006's restricted unpickler stays source); a .pyc whose header is
not (the compile's magic, unchecked hash, the hash of the archive's own source); a
.pyc dir whose summary does not match its files, its archive or the other kind; an
input wheel that already carries a .pyc, whose RECORD does not match it, or whose
timestamps are not SOURCE_DATE_EPOCH's; any member count other than the expected
one. The outputs are written under a temporary name and renamed into place only
after every check passed. Ported from the study's exp3/v11/scripts/py/assemble_pyc.py
(which kept the zip at level 6).

exit: 0 written | 1 refused | 2 usage error or an unreadable input
"""

from __future__ import annotations

import _imp
import argparse
import base64
import hashlib
import importlib.util
import json
import os
import re
import struct
import sys
import time
import zipfile
import zlib
from collections import Counter
from collections.abc import Callable
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
PKL = "chempy/pkl.py"
SUMMARY = "_summary.json"
TARGET_KEYS = {"schema", "stdlib", "wheel", "comment"}
ZIP_EPOCH = 315532800  # make_wheel.py's clamp: the earliest time a zip entry can carry
LEVEL = 9
# ZipInfo fields an in-place replacement keeps (the name is the only change).
FIELDS = (
    "date_time",
    "compress_type",
    "comment",
    "extra",
    "create_system",
    "create_version",
    "extract_version",
    "flag_bits",
    "volume",
    "internal_attr",
    "external_attr",
)


class Refused(Exception):
    """A rule did not hold (exit 1)."""


class Unreadable(Exception):
    """An input this script cannot read (exit 2)."""


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _record_hash(data: bytes) -> str:
    return "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()


def load_write_wheel() -> Callable[[dict[str, bytes], str, str, int], int]:
    """make_wheel.write_wheel from this script's own directory (-I keeps it off sys.path)."""
    path = os.path.join(HERE, "make_wheel.py")
    spec = importlib.util.spec_from_file_location("make_wheel", path)
    if spec is None or spec.loader is None:
        raise Unreadable(f"cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except OSError as exc:
        raise Unreadable(f"cannot load {path}: {exc}") from None
    fn = getattr(mod, "write_wheel", None)
    if not callable(fn):
        raise Unreadable(f"{path} has no write_wheel(files, dist_info, out, epoch)")
    return fn  # type: ignore[no-any-return]


def read_targets(path: str) -> dict[str, list[str]]:
    try:
        with open(path, encoding="utf-8") as fh:
            t = json.load(fh)
    except (OSError, ValueError) as exc:
        raise Unreadable(f"cannot read targets {path}: {exc}") from None
    if not isinstance(t, dict) or t.get("schema") != 1 or set(t) - TARGET_KEYS:
        raise Unreadable(f"targets {path}: not schema 1 with keys {sorted(TARGET_KEYS)}")
    out: dict[str, list[str]] = {}
    for key in ("stdlib", "wheel"):
        lst = t.get(key)
        if not isinstance(lst, list) or not lst or not all(isinstance(x, str) for x in lst):
            raise Unreadable(f"targets {path}: {key!r} is not a non-empty list of strings")
        for x in lst:
            parts = x.split("/")
            if not x.endswith(".py") or x.startswith("/") or "\\" in x or "" in parts or ".." in parts or "__pycache__" in parts:
                raise Unreadable(f"targets {path}: {key} entry {x!r} is not a relative POSIX .py path")
        if len(set(lst)) != len(lst):
            raise Unreadable(f"targets {path}: {key} lists a path twice")
        out[key] = lst
    if PKL in out["wheel"]:
        raise Refused(f"{PKL} is listed as a wheel target; patch 0006's restricted unpickler stays source")
    return out


def read_pyc_dir(path: str, kind: str, archive: str) -> tuple[dict[str, Any], dict[str, bytes]]:
    """The summary and every .pyc (relative POSIX name -> bytes) of a pyc_compile.mjs out dir."""
    try:
        with open(os.path.join(path, SUMMARY), encoding="utf-8") as fh:
            summary = json.load(fh)
        files: dict[str, bytes] = {}
        others: list[str] = []
        for root, dirs, names in os.walk(path):
            dirs.sort()
            for name in sorted(names):
                full = os.path.join(root, name)
                rel = os.path.relpath(full, path).replace(os.sep, "/")
                if rel == SUMMARY:
                    continue
                if not name.endswith(".pyc") or os.path.islink(full) or not os.path.isfile(full):
                    others.append(rel)
                    continue
                with open(full, "rb") as fh:
                    files[rel] = fh.read()
        with open(archive, "rb") as fh:
            archive_sha = _sha256(fh.read())
    except (OSError, ValueError) as exc:
        raise Unreadable(f"cannot read the {kind} .pyc dir {path}: {exc}") from None
    if not isinstance(summary, dict) or summary.get("tool") != "pyc_compile" or summary.get("kind") != kind:
        raise Refused(f"{path}/{SUMMARY} is not a pyc_compile summary of kind {kind}")
    if others:
        raise Refused(f"{path} holds files that are not .pyc: {others[:5]}")
    if summary.get("archive_sha256") != archive_sha:
        raise Refused(f"{path} was compiled from another archive than {archive}")
    sums = summary.get("sha256")
    if not isinstance(sums, dict) or set(sums) != set(files):
        raise Refused(f"{path}: the summary's file list differs from the .pyc on disk")
    bad = sorted(n for n, data in files.items() if _sha256(data) != sums[n])
    if bad:
        raise Refused(f"{path}: .pyc changed after compiling: {bad[:5]}")
    return summary, files


def runtime(std: dict[str, Any], site: dict[str, Any]) -> tuple[bytes, str, str]:
    """The magic, CPython version and cache tag both compiles agree on."""
    keys = ("magic", "version", "cache_tag")
    a, b = (tuple(s.get(k) for k in keys) for s in (std, site))
    if a != b:
        raise Refused(f"the std and site compiles disagree on {keys}: {a} vs {b}")
    magic_hex, version, tag = a
    if not isinstance(magic_hex, str) or not re.fullmatch(r"[0-9a-f]{4}0d0a", magic_hex):
        raise Refused(f"magic {magic_hex!r} is not a pyc magic")
    m = re.fullmatch(r"(\d+)\.(\d+)\.\d+", str(version))
    if not m or tag != f"cpython-{m.group(1)}{m.group(2)}":
        raise Refused(f"cache tag {tag!r} does not belong to CPython {version!r}")
    return bytes.fromhex(magic_hex), str(version), str(tag)


def check_header(name: str, blob: bytes, magic: bytes, source: bytes) -> None:
    if len(blob) < 16 or blob[:4] != magic:
        raise Refused(f"{name}: magic {blob[:4].hex()} (the compile's {magic.hex()})")
    flags = struct.unpack("<I", blob[4:8])[0]
    if flags != 0b01:
        raise Refused(f"{name}: flags {flags:#04b}, want 0b01 (unchecked hash)")
    if blob[8:16] != _imp.source_hash(int.from_bytes(magic, "little"), source):
        raise Refused(f"{name}: source hash is not the archive's source (a stale or foreign .pyc)")


def match_targets(where: str, targets: list[str], pyc: dict[str, bytes]) -> None:
    want = {t + "c" for t in targets}
    dropped = sorted(want - set(pyc))
    added = sorted(set(pyc) - want)
    if dropped:
        raise Refused(f"{where}: target(s) without a .pyc: {dropped[:5]}")
    if added:
        raise Refused(f"{where}: .pyc that are not targets: {added[:5]}")
    if any(n == PKL + "c" for n in pyc):
        raise Refused(f"{where}: {PKL} was compiled")


def _raw_member(fp: Any, info: zipfile.ZipInfo) -> bytes:
    """The member's bytes as stored in the archive (after its local header)."""
    fp.seek(info.header_offset)
    head = fp.read(30)
    if len(head) != 30 or head[:4] != b"PK\x03\x04":
        raise Refused(f"{info.filename}: bad local header")
    n, m = struct.unpack("<HH", head[26:30])
    fp.seek(info.header_offset + 30 + n + m)
    return fp.read(info.compress_size)  # type: ignore[no-any-return]


def _deflate(data: bytes) -> bytes:
    co = zlib.compressobj(LEVEL, zlib.DEFLATED, -15)
    return co.compress(data) + co.flush()


def assemble_stdlib(src: str, targets: list[str], pyc: dict[str, bytes], magic: bytes, out: str) -> dict[str, Any]:
    tset = set(targets)
    try:
        with zipfile.ZipFile(src) as zin:
            infos = zin.infolist()
            data_in = {i.filename: zin.read(i) for i in infos}
    except (OSError, zipfile.BadZipFile, RuntimeError, ValueError, EOFError) as exc:
        raise Unreadable(f"cannot read {src}: {exc}") from None
    names = [i.filename for i in infos]
    dup = sorted(n for n, c in Counter(names).items() if c > 1)
    if dup:
        raise Refused(f"{src} holds member name(s) twice: {dup[:5]}")
    missing = sorted(tset - set(names))
    if missing:
        raise Refused(f"stdlib target(s) not in {src}: {missing[:5]}")
    clash = sorted(t for t in targets if t + "c" in data_in)
    if clash:
        raise Refused(f"{src} already holds a .pyc for target(s) {clash[:5]}")
    match_targets("stdlib", targets, pyc)
    for t in targets:
        check_header("stdlib " + t + "c", pyc[t + "c"], magic, data_in[t])
    with zipfile.ZipFile(out, "w") as zout:
        for i in infos:
            name, data = i.filename, data_in[i.filename]
            if name in tset:
                name, data = name + "c", pyc[name + "c"]
            o = zipfile.ZipInfo(name, date_time=i.date_time)
            for f in FIELDS[1:]:
                setattr(o, f, getattr(i, f))
            if i.compress_type == zipfile.ZIP_DEFLATED:
                zout.writestr(o, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=LEVEL)
            elif i.compress_type == zipfile.ZIP_STORED:
                zout.writestr(o, data, compress_type=zipfile.ZIP_STORED)
            else:
                raise Refused(f"{src}: {i.filename} uses compression {i.compress_type}")
    # Every member in its place with its fields; the untouched ones with their content.
    with zipfile.ZipFile(out) as zo, open(out, "rb") as fp:
        o_infos = zo.infolist()
        if len(o_infos) != len(infos):
            raise Refused(f"stdlib: {len(o_infos)} members written, {len(infos)} read")
        stored = deflated = untouched = 0
        for i, o in zip(infos, o_infos):
            want_name = i.filename + "c" if i.filename in tset else i.filename
            if o.filename != want_name:
                raise Refused(f"stdlib: member {o.filename} where {want_name} belongs")
            diff = [f for f in FIELDS if getattr(o, f) != getattr(i, f)]
            if diff:
                raise Refused(f"stdlib {o.filename}: ZipInfo field(s) changed: {diff}")
            data = zo.read(o)
            if i.filename in tset:
                if data != pyc[want_name]:
                    raise Refused(f"stdlib {o.filename}: not the compiled bytes")
            else:
                if (o.CRC, o.file_size) != (i.CRC, i.file_size) or data != data_in[i.filename]:
                    raise Refused(f"stdlib {o.filename}: content changed")
                untouched += 1
            raw = _raw_member(fp, o)
            if o.compress_type == zipfile.ZIP_STORED:
                ok = raw == data
                stored += 1
            else:
                ok = raw == _deflate(data)
                deflated += 1
            if not ok:
                raise Refused(f"stdlib {o.filename}: not stored / deflated at level {LEVEL} as required")
    return {
        "members": len(o_infos),
        "replaced": len(tset),
        "untouched_same_content": untouched,
        "stored": stored,
        "deflated_level": LEVEL,
        "deflated": deflated,
        "py": sum(1 for n in data_in if n.endswith(".py")) - len(tset),
        "pyc": len(tset),
    }


def pycache_path(src: str, tag: str) -> str:
    d, _, base = src.rpartition("/")
    return (d + "/" if d else "") + "__pycache__/" + base[: -len(".py")] + "." + tag + ".pyc"


def wheel_date_time(epoch: int) -> tuple[int, ...]:
    """make_wheel.py's timestamp as a zip entry reads it back (DOS time: even seconds)."""
    dt = list(time.gmtime(max(epoch, ZIP_EPOCH))[:6])
    dt[5] -= dt[5] % 2
    return tuple(dt)


def assemble_wheel(
    src: str,
    targets: list[str],
    pyc: dict[str, bytes],
    magic: bytes,
    tag: str,
    out: str,
    epoch: int,
    write_wheel: Callable[[dict[str, bytes], str, str, int], int],
) -> dict[str, Any]:
    try:
        with zipfile.ZipFile(src) as zin:
            infos = zin.infolist()
            data_in = {i.filename: zin.read(i) for i in infos}
    except (OSError, zipfile.BadZipFile, RuntimeError, ValueError, EOFError) as exc:
        raise Unreadable(f"cannot read {src}: {exc}") from None
    names = [i.filename for i in infos]
    dup = sorted(n for n, c in Counter(names).items() if c > 1)
    if dup:
        raise Refused(f"{src} holds member name(s) twice: {dup[:5]}")
    if any(i.is_dir() for i in infos):
        raise Refused(f"{src} holds directory entries (make_wheel.py writes none)")
    records = [n for n in names if re.fullmatch(r"[^/]+\.dist-info/RECORD", n)]
    if len(records) != 1:
        raise Refused(f"{src}: want exactly one <name>.dist-info/RECORD, found {records}")
    record = records[0]
    dist_info = record[: -len("/RECORD")]
    old = [n for n in names if n.endswith((".pyc", ".pyo")) or "__pycache__/" in n]
    if old:
        raise Refused(f"{src} already carries compiled files: {old[:5]}")
    want_dt = wheel_date_time(epoch)
    stamps = sorted({i.date_time for i in infos})
    if stamps != [want_dt]:
        raise Refused(f"{src}: member timestamps {stamps[:3]} are not SOURCE_DATE_EPOCH {epoch}'s {want_dt}")
    files = {n: d for n, d in data_in.items() if n != record}
    rows = sorted(files.items(), key=lambda kv: (kv[0].startswith(dist_info + "/"), kv[0].encode()))
    want_record = "\n".join([f"{n},{_record_hash(d)},{len(d)}" for n, d in rows] + [f"{record},,"]) + "\n"
    if data_in[record].decode("utf-8", "replace") != want_record:
        raise Refused(f"{src}: RECORD does not match the wheel's members")
    missing = sorted(set(targets) - set(files))
    if missing:
        raise Refused(f"wheel target(s) not in {src}: {missing[:5]}")
    match_targets("wheel", targets, pyc)
    added: dict[str, bytes] = {}
    for t in targets:
        check_header("wheel " + t + "c", pyc[t + "c"], magic, files[t])
        added[pycache_path(t, tag)] = pyc[t + "c"]
    files.update(added)
    n = write_wheel(files, dist_info, out, epoch)
    with zipfile.ZipFile(out) as zo:
        o_names = zo.namelist()
        o_data = {name: zo.read(name) for name in o_names}
    expect = len(infos) + len(targets)
    if n != expect or len(o_names) != expect or len(set(o_names)) != expect:
        raise Refused(f"wheel: {len(o_names)} members written (write_wheel said {n}), want {expect}")
    if o_names != sorted(o_names, key=lambda x: (".dist-info/" in x, x.encode())):
        raise Refused("wheel: member order is not make_wheel.py's (byte-sorted, .dist-info last)")
    changed = sorted(k for k, v in files.items() if o_data.get(k) != v)
    if changed:
        raise Refused(f"wheel: member(s) dropped or changed: {changed[:5]}")
    extra = sorted(set(o_names) - set(files) - {record})
    if extra:
        raise Refused(f"wheel: unexpected member(s) {extra[:5]}")
    if any(x.startswith("chempy/__pycache__/pkl.") for x in o_names) or PKL not in o_data:
        raise Refused(f"wheel: {PKL} is not source-only")
    return {
        "members": len(o_names),
        "members_in": len(infos),
        "pycache_added": len(added),
        "dist_info": dist_info,
        "date_time": list(want_dt),
    }


def run(args: argparse.Namespace) -> dict[str, Any]:
    raw_epoch = os.environ.get("SOURCE_DATE_EPOCH", "")
    if not raw_epoch.isdigit():
        raise Unreadable("SOURCE_DATE_EPOCH is not set to a number (build.sh sets it)")
    epoch = int(raw_epoch)
    ins = {os.path.realpath(p) for p in (args.stdlib_in, args.wheel_in)}
    outs = [args.stdlib_out, args.wheel_out]
    if len({os.path.realpath(p) for p in outs}) != 2 or ins & {os.path.realpath(p) for p in outs}:
        raise Unreadable("the two outputs must differ from each other and from the inputs")
    targets = read_targets(args.targets)
    std_sum, std_pyc = read_pyc_dir(args.std_pyc, "std", args.stdlib_in)
    site_sum, site_pyc = read_pyc_dir(args.site_pyc, "site", args.wheel_in)
    magic, version, tag = runtime(std_sum, site_sum)
    write_wheel = load_write_wheel()
    tmps = [p + ".pyc_assemble.tmp" for p in outs]
    try:
        std_rep = assemble_stdlib(args.stdlib_in, targets["stdlib"], std_pyc, magic, tmps[0])
        whl_rep = assemble_wheel(args.wheel_in, targets["wheel"], site_pyc, magic, tag, tmps[1], epoch, write_wheel)
        for tmp, final in zip(tmps, outs):
            os.replace(tmp, final)
    finally:
        for tmp in tmps:
            if os.path.exists(tmp):
                os.remove(tmp)
    std_rep.update(input=args.stdlib_in, output=args.stdlib_out, bytes_in=os.path.getsize(args.stdlib_in), bytes_out=os.path.getsize(args.stdlib_out))
    whl_rep.update(input=args.wheel_in, output=args.wheel_out, bytes_in=os.path.getsize(args.wheel_in), bytes_out=os.path.getsize(args.wheel_out))
    with open(args.stdlib_out, "rb") as fh:
        std_rep["sha256"] = _sha256(fh.read())
    with open(args.wheel_out, "rb") as fh:
        whl_rep["sha256"] = _sha256(fh.read())
    return {
        "tool": "pyc_assemble",
        "runtime_python": version,
        "cache_tag": tag,
        "magic": magic.hex(),
        "source_date_epoch": epoch,
        "targets": {"stdlib": len(targets["stdlib"]), "wheel": len(targets["wheel"])},
        "stdlib": std_rep,
        "wheel": whl_rep,
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="pyc_assemble.py", description=(__doc__ or "").split("\n")[0])
    ap.add_argument("--json", dest="report")
    for name in ("targets", "stdlib_in", "std_pyc", "stdlib_out", "wheel_in", "site_pyc", "wheel_out"):
        ap.add_argument(name)
    args = ap.parse_args(argv[1:])
    rc = 0
    try:
        rep = run(args)
        rep["ok"] = True
        s, w = rep["stdlib"], rep["wheel"]
        print(
            f"pyc_assemble: CPython {rep['runtime_python']} ({rep['cache_tag']}), magic {rep['magic']}; "
            f"stdlib {s['replaced']} .py -> sourceless .pyc, {s['members']} members ({s['untouched_same_content']} untouched, "
            f"{s['stored']} stored, {s['deflated']} at deflate {LEVEL}), {s['bytes_in']} -> {s['bytes_out']} B; "
            f"wheel +{w['pycache_added']} __pycache__ .pyc, {w['members_in']} -> {w['members']} members, "
            f"{w['bytes_in']} -> {w['bytes_out']} B"
        )
    except Refused as exc:
        rep, rc = {"tool": "pyc_assemble", "ok": False, "error": str(exc)}, 1
        print(f"pyc_assemble: REFUSED: {exc}", file=sys.stderr)
    except Unreadable as exc:
        rep, rc = {"tool": "pyc_assemble", "ok": False, "error": str(exc)}, 2
        print(f"pyc_assemble: CANNOT READ: {exc}", file=sys.stderr)
    if args.report:
        try:
            with open(args.report, "w", encoding="utf-8") as fh:
                fh.write(json.dumps(rep, indent=1, sort_keys=True) + "\n")
        except OSError as exc:
            print(f"pyc_assemble: cannot write {args.report}: {exc}", file=sys.stderr)
            return 2
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv))
