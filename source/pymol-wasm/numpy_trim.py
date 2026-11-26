"""Drop the numpy wheel members that play no part at run time (PT-9554 S2-2 (3)).

    python3 -I numpy_trim.py <in numpy.whl> <numpy_drop.json> <out numpy.whl> [--json report.json]

The pinned numpy wasm wheel (build.sh NUMPY_WHEEL) carries type stubs, C
headers, static libraries, Cython and C sources and build configuration that
Pyodide never reads when it runs numpy: they serve type checkers, C / Cython
compilers and packaging tools. This stage writes a copy of the wheel without
exactly the members numpy_drop.json names, under the same file name (the lock
and the app key the wheel by name). The compile still reads the numpy headers
from the ORIGINAL wheel (build.sh step 2); only the shipped copy is trimmed.

The rule (evidence §3.22, the "safe" rule; owner ruling 2026-11-17 判断 3 (3)).
A member is dropped when it is not under `*.dist-info/`, and the FIRST line
below that matches it gives its category:

    numpy/_pyinstaller/...   pyinstaller-hook  PyInstaller's hook dir; read only
                             by PyInstaller (entry point pyinstaller40 ->
                             numpy._pyinstaller_hooks_dir, which only returns
                             the path); hook-numpy.py imports PyInstaller at
                             module level and __init__.py is empty
    numpy/doc/...            doc-module        numpy/doc/ufuncs.py: a module that
                             is one docstring, in a dir without __init__.py,
                             imported by nothing
    numpy/conftest.py        pytest-config     pytest's configuration; imports
                             pytest and hypothesis at module level
    *.pyi, */py.typed        type-stub         read by type checkers only
    *.h                      c-header          C compilers only
    *.a                      static-library    C linkers only
    *.pxd, *.pyx             cython-source     Cython only
    *.c                      c-source          C compilers only
    *.pc, *.ini, *.cfg, *.build, *.template
                             build-config      pkg-config / meson / f2py's build
                             backends only

Never dropped: any `*.dist-info/` member (METADATA, WHEEL, entry points, RECORD
and every licence file), any `.so`, any other `.py`. numpy/testing/ and
numpy/f2py/ keep their .py: `numpy.__all__` names `testing` and `f2py`, and
numpy's lazy `__getattr__` imports them, so `from numpy import *`,
`numpy.matlib`, `help(numpy)` and `np.testing.*` need them (evidence §3.22,
the run2 rule that dropped them broke all five).

It refuses (exit 1, nothing written) when: the input is not the pinned wheel
(name, sha256 and member count), or the list's own `input`, `counts` and
`total` disagree with the input or with its lists; the list is not exactly what the rule yields on the
input; a listed name is missing, repeats, is a dist-info member, a `.so`, a
licence-like name, or not of the category the list files it under; the
per-category or total counts differ from PINNED_COUNTS (editing the list alone
cannot change what is dropped); RECORD does not list exactly the members with
their hashes; or the zip uses a feature this copier does not handle (data
descriptor, zip64, encryption, an archive comment).

What it writes. Every kept member's local record (header, name, extra field
and compressed bytes) and its central-directory entry are copied byte for
byte from the input, only the central entry's offset is new: kept members keep
their bytes, order, compressed stream and every ZipInfo field (date_time,
create_system, external_attr, compress_type, flags, versions). RECORD is the
input's RECORD without the dropped members' rows (kept rows and their order
unchanged, line ends unchanged), in RECORD's own position, with the original
RECORD entry's metadata, re-deflated at DEFLATE_LEVEL = 6: the level the input
itself used (every member of the pinned wheel re-deflates to its own bytes at
6). The stage refuses a zlib that does not reproduce the input RECORD's own
compressed bytes at that level, so the output is byte-reproducible wherever
it runs. The output is checked by reading it back (every kept member's bytes
and fields, RECORD's text) before it is moved into place.

Report (stdout, and --json): members and bytes before / after, gzip -9 of
both (Python's gzip module, zlib level 9, mtime 0; GNU `gzip -9 -n` gives
sizes about 0.05 % smaller), and the HTML size estimate: the base64 length of
the gzip (4 * ceil(n / 3)), as the HTML export inlines a wheel.
"""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import io
import json
import os
import struct
import sys
import zipfile
import zlib
from collections import Counter
from typing import Any

PINNED_INPUT_NAME = "numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl"
PINNED_INPUT_SHA256 = "a292c1f5d7d8a2208cd5e94fc467604c131cabcd2fc14fed6eefde121e7fabdf"
PINNED_INPUT_MEMBERS = 415
# What the rule drops from the pinned wheel, per category (206 of 415 members).
PINNED_COUNTS = {
    "pyinstaller-hook": 4,
    "doc-module": 1,
    "pytest-config": 1,
    "type-stub": 153,
    "c-header": 27,
    "static-library": 2,
    "cython-source": 9,
    "c-source": 3,
    "build-config": 6,
}
DEFLATE_LEVEL = 6

CATEGORIES = tuple(PINNED_COUNTS)
# (category, kind of match, value); the first match wins.
RULE: tuple[tuple[str, str, Any], ...] = (
    ("pyinstaller-hook", "prefix", "numpy/_pyinstaller/"),
    ("doc-module", "prefix", "numpy/doc/"),
    ("pytest-config", "name", "numpy/conftest.py"),
    ("type-stub", "suffix", (".pyi", "/py.typed")),
    ("c-header", "suffix", (".h",)),
    ("static-library", "suffix", (".a",)),
    ("cython-source", "suffix", (".pxd", ".pyx")),
    ("c-source", "suffix", (".c",)),
    ("build-config", "suffix", (".pc", ".ini", ".cfg", ".build", ".template")),
)
LICENCE_MARKS = ("licen", "copying", "notice")

LOCAL_SIG = b"PK\x03\x04"
CENTRAL_SIG = b"PK\x01\x02"
EOCD_SIG = b"PK\x05\x06"
LOCAL_FMT = "<4sHHHHHIIIHH"  # 30 bytes
CENTRAL_FMT = "<4sHHHHHHIIIHHHHHII"  # 46 bytes
EOCD_FMT = "<4sHHHHIIH"  # 22 bytes


class TrimError(Exception):
    """A refusal: the stage writes nothing."""


def category_of(name: str) -> str | None:
    """The rule: the category a member is dropped under, or None (kept)."""
    if ".dist-info/" in name or name.endswith("/"):
        return None
    for cat, how, val in RULE:
        if how == "prefix" and name.startswith(val):
            return cat
        if how == "name" and name == val:
            return cat
        if how == "suffix" and name.endswith(val):
            return cat
    return None


def _no_dup_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    keys = [k for k, _ in pairs]
    dup = sorted(k for k, n in Counter(keys).items() if n > 1)
    if dup:
        raise TrimError(f"the drop list repeats the key(s) {dup}")
    return dict(pairs)


def load_drop_list(path: str, src_name: str, src_sha256: str, src_members: int) -> dict[str, list[str]]:
    """numpy_drop.json's `drop`: {category: [member, ...]}; its `input`, `counts` and `total` must agree."""
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh, object_pairs_hook=_no_dup_keys)
    except (OSError, ValueError) as e:
        raise TrimError(f"cannot read the drop list {path}: {e}") from None
    drop = doc.get("drop") if isinstance(doc, dict) else None
    if not isinstance(drop, dict) or not all(
        isinstance(v, list) and all(isinstance(n, str) for n in v) for v in drop.values()
    ):
        raise TrimError("the drop list has no `drop` object of {category: [member names]}")
    want_input = {"file_name": src_name, "sha256": src_sha256, "members": src_members}
    if doc.get("input") != want_input:
        raise TrimError(f"the drop list was made for {doc.get('input')}, not this input {want_input}")
    if doc.get("counts") != {c: len(v) for c, v in drop.items()} or doc.get("total") != sum(map(len, drop.values())):
        raise TrimError("the drop list's own `counts` / `total` do not match its `drop` lists")
    return drop


def check_drop_list(
    drop: dict[str, list[str]], members: list[str], pinned_counts: dict[str, int]
) -> dict[str, str]:
    """Every refusal about the list itself; returns {member: category}."""
    unknown = sorted(set(drop) - set(pinned_counts))
    if unknown:
        raise TrimError(f"the drop list has categories outside the allowed kinds: {unknown}")
    flat = [(n, c) for c, names in drop.items() for n in names]
    dup = sorted(n for n, k in Counter(n for n, _ in flat).items() if k > 1)
    if dup:
        raise TrimError(f"the drop list names a member more than once: {dup[:10]}")
    listed = dict(flat)
    have = set(members)
    missing = sorted(n for n in listed if n not in have)
    if missing:
        raise TrimError(f"listed member(s) not in the input wheel: {missing[:10]}")
    for n, c in sorted(listed.items()):
        if ".dist-info/" in n:
            raise TrimError(f"a dist-info member is listed: {n}")
        if n.endswith(".so"):
            raise TrimError(f"an extension module (.so) is listed: {n}")
        if any(m in n.rsplit("/", 1)[-1].lower() for m in LICENCE_MARKS):
            raise TrimError(f"a licence-like file is listed: {n}")
        rc = category_of(n)
        if rc != c:
            raise TrimError(f"{n} is listed as {c}, the rule makes it {rc}")
    counts = {c: len(drop.get(c, [])) for c in pinned_counts}
    if counts != pinned_counts:
        bad = {c: (counts[c], pinned_counts[c]) for c in pinned_counts if counts[c] != pinned_counts[c]}
        raise TrimError(f"per-category counts (listed, pinned) differ: {bad}")
    by_rule = {n: category_of(n) for n in members if category_of(n) is not None}
    extra_rule = sorted(set(by_rule) - set(listed))
    extra_list = sorted(set(listed) - set(by_rule))
    if extra_rule or extra_list:
        raise TrimError(
            f"the rule on the input does not yield exactly the list: the rule also drops {extra_rule[:10]},"
            f" the list also names {extra_list[:10]}"
        )
    return listed


def _entries(raw: bytes) -> tuple[list[dict[str, Any]], bytes]:
    """Parse the central directory (no zip64, no multi-disk). Returns entries and the EOCD comment."""
    at = raw.rfind(EOCD_SIG, max(0, len(raw) - 22 - 65535))
    if at < 0 or at + 22 > len(raw):
        raise TrimError("no end-of-central-directory record")
    _sig, disk, cd_disk, n_disk, n_total, cd_size, cd_off, clen = struct.unpack(EOCD_FMT, raw[at : at + 22])
    comment = raw[at + 22 : at + 22 + clen]
    if disk or cd_disk or n_disk != n_total or 0xFFFF in (n_disk, n_total) or 0xFFFFFFFF in (cd_size, cd_off):
        raise TrimError("multi-disk or zip64 archives are not handled")
    if at + 22 + clen != len(raw):
        raise TrimError("bytes after the end-of-central-directory record")
    out = []
    p = cd_off
    for _ in range(n_total):
        f = struct.unpack(CENTRAL_FMT, raw[p : p + 46])
        if f[0] != CENTRAL_SIG:
            raise TrimError("a broken central directory")
        (_s, made, need, flags, method, mtime, mdate, crc, csize, usize, nlen, xlen, klen, _dsk, _ia, _ea, off) = f
        name = raw[p + 46 : p + 46 + nlen]
        end = p + 46 + nlen + xlen + klen
        if flags & 0x0009:
            raise TrimError(f"{name!r}: encrypted or data-descriptor members are not handled")
        if 0xFFFFFFFF in (csize, usize, off):
            raise TrimError(f"{name!r}: zip64 members are not handled")
        if flags & 0x0800 == 0 and any(b > 0x7F for b in name):
            raise TrimError(f"{name!r}: a non-ASCII name without the UTF-8 flag")
        lf = struct.unpack(LOCAL_FMT, raw[off : off + 30])
        if lf[0] != LOCAL_SIG or raw[off + 30 : off + 30 + lf[9]] != name:
            raise TrimError(f"{name!r}: the local header does not match the central directory")
        if lf[1:9] != (need, flags, method, mtime, mdate, crc, csize, usize):
            raise TrimError(f"{name!r}: the local header's fields differ from the central directory's")
        data_at = off + 30 + lf[9] + lf[10]
        out.append(
            {
                "name": name.decode("utf-8"),
                "central": raw[p:end],
                "local": raw[off : data_at + csize],
                "data": raw[data_at : data_at + csize],
                "method": method,
                "usize": usize,
                "crc": crc,
                "made": made,
                "need": need,
                "flags": flags,
                "mtime": mtime,
                "mdate": mdate,
                "ia": _ia,
                "ea": _ea,
                "local_extra": raw[off + 30 + lf[9] : data_at],
                "central_extra": raw[p + 46 + nlen : p + 46 + nlen + xlen],
                "central_comment": raw[p + 46 + nlen + xlen : end],
            }
        )
        p = end
    if p != cd_off + cd_size:
        raise TrimError("the central directory size does not add up")
    return out, comment


def _inflate(e: dict[str, Any]) -> bytes:
    if e["method"] == 0:
        data = bytes(e["data"])
    elif e["method"] == 8:
        data = zlib.decompress(e["data"], -15)
    else:
        raise TrimError(f"{e['name']}: compression method {e['method']} is not handled")
    if len(data) != e["usize"] or zlib.crc32(data) != e["crc"]:
        raise TrimError(f"{e['name']}: size or CRC does not match")
    return data


def _deflate(data: bytes, level: int) -> bytes:
    c = zlib.compressobj(level, zlib.DEFLATED, -15)
    return c.compress(data) + c.flush()


def _record_hash(data: bytes) -> str:
    return "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()


def new_record(text: str, record_name: str, members: dict[str, bytes], dropped: set[str]) -> str:
    """The input RECORD minus the dropped rows; refuses a RECORD that does not list exactly the members."""
    lines = text.splitlines(keepends=True)
    seen: list[str] = []
    keep = []
    for line in lines:
        row = line.rstrip("\r\n")
        if not row:
            raise TrimError("RECORD has an empty line")
        # RECORD is CSV; numpy's member names hold no comma or quote, so the
        # path is the text before the second-to-last comma.
        path, digest, size = row.rsplit(",", 2)
        if path.startswith('"'):
            raise TrimError(f"RECORD row with a quoted path is not handled: {row[:80]}")
        seen.append(path)
        if path == record_name:
            if digest or size:
                raise TrimError("RECORD's own row carries a hash")
        else:
            if path not in members:
                raise TrimError(f"RECORD lists {path}, which is not in the wheel")
            data = members[path]
            if digest != _record_hash(data) or size != str(len(data)):
                raise TrimError(f"RECORD's hash or size for {path} does not match the member")
        if path not in dropped:
            keep.append(line)
    dup = sorted(p for p, k in Counter(seen).items() if k > 1)
    if dup:
        raise TrimError(f"RECORD lists a path more than once: {dup[:5]}")
    if set(seen) != set(members) | {record_name}:
        raise TrimError(f"RECORD does not list exactly the wheel's members: {sorted(set(members) ^ set(seen))[:5]}")
    return "".join(keep)


def _gzip_len(data: bytes) -> int:
    return len(gzip.compress(data, compresslevel=9, mtime=0))


def _b64_len(n: int) -> int:
    return 4 * ((n + 2) // 3)


def trim(
    src: str,
    drop_path: str,
    out: str,
    *,
    pinned_name: str = PINNED_INPUT_NAME,
    pinned_sha256: str = PINNED_INPUT_SHA256,
    pinned_members: int = PINNED_INPUT_MEMBERS,
    pinned_counts: dict[str, int] | None = None,
    level: int = DEFLATE_LEVEL,
) -> dict[str, Any]:
    """Write the trimmed wheel to `out` (atomically) and return the report. Raises TrimError."""
    counts_pin = dict(PINNED_COUNTS if pinned_counts is None else pinned_counts)
    if os.path.basename(src) != pinned_name:
        raise TrimError(f"the input is {os.path.basename(src)}, pinned {pinned_name}")
    if os.path.basename(out) != os.path.basename(src):
        raise TrimError("the output must keep the input's file name (the lock and the app key the wheel by name)")
    if os.path.abspath(out) == os.path.abspath(src) or (
        os.path.exists(out) and os.path.samefile(out, src)
    ):
        raise TrimError("the output must not overwrite the input")
    with open(src, "rb") as fh:
        raw = fh.read()
    sha = hashlib.sha256(raw).hexdigest()
    if sha != pinned_sha256:
        raise TrimError(f"the input's sha256 is {sha}, pinned {pinned_sha256}")
    entries, comment = _entries(raw)
    if comment:
        raise TrimError("an archive comment is not handled")
    names = [e["name"] for e in entries]
    if len(entries) != pinned_members:
        raise TrimError(f"the input has {len(entries)} members, pinned {pinned_members}")
    if len(set(names)) != len(names):
        raise TrimError("the input repeats a member name")
    records = [n for n in names if n.endswith(".dist-info/RECORD") and n.count("/") == 1]
    if len(records) != 1:
        raise TrimError(f"the input has {len(records)} dist-info/RECORD members")
    record_name = records[0]

    listed = check_drop_list(load_drop_list(drop_path, os.path.basename(src), sha, len(entries)), names, counts_pin)

    contents = {e["name"]: _inflate(e) for e in entries}
    rec = next(e for e in entries if e["name"] == record_name)
    if rec["method"] != 8 or _deflate(contents[record_name], level) != rec["data"]:
        raise TrimError(
            f"this zlib ({zlib.ZLIB_RUNTIME_VERSION}) does not re-deflate the input RECORD to its own bytes"
            f" at level {level}: the output would not be reproducible"
        )
    rec_text = contents[record_name].decode("utf-8")
    new_rec = new_record(
        rec_text, record_name, {n: d for n, d in contents.items() if n != record_name}, set(listed)
    ).encode("utf-8")

    # ---- assemble
    body = bytearray()
    central = bytearray()
    kept = [e for e in entries if e["name"] not in listed]
    for e in kept:
        off = len(body)
        if e["name"] == record_name:
            data = _deflate(new_rec, level)
            crc = zlib.crc32(new_rec)
            nm = e["name"].encode("utf-8")
            body += struct.pack(
                LOCAL_FMT, LOCAL_SIG, e["need"], e["flags"], 8, e["mtime"], e["mdate"],
                crc, len(data), len(new_rec), len(nm), len(e["local_extra"]),
            ) + nm + e["local_extra"] + data
            central += struct.pack(
                CENTRAL_FMT, CENTRAL_SIG, e["made"], e["need"], e["flags"], 8, e["mtime"], e["mdate"],
                crc, len(data), len(new_rec), len(nm), len(e["central_extra"]), len(e["central_comment"]),
                0, e["ia"], e["ea"], off,
            ) + nm + e["central_extra"] + e["central_comment"]
        else:
            body += e["local"]
            c = bytearray(e["central"])
            c[42:46] = struct.pack("<I", off)
            central += c
    cd_off = len(body)
    blob = bytes(body + central + struct.pack(EOCD_FMT, EOCD_SIG, 0, 0, len(kept), len(kept), len(central), cd_off, 0))

    # ---- read it back before it lands
    with zipfile.ZipFile(io.BytesIO(raw)) as zin, zipfile.ZipFile(io.BytesIO(blob)) as zout:
        if zout.testzip() is not None:
            raise TrimError("the written wheel fails its own CRC check")
        if zout.namelist() != [e["name"] for e in kept]:
            raise TrimError("the written wheel's member order is not the input's")
        for zi in zout.infolist():
            orig = zin.getinfo(zi.filename)
            fields = ("date_time", "create_system", "create_version", "extract_version", "external_attr",
                      "internal_attr", "compress_type", "flag_bits", "extra", "comment")
            if any(getattr(zi, f) != getattr(orig, f) for f in fields):
                raise TrimError(f"{zi.filename}: a ZipInfo field changed")
            want = new_rec if zi.filename == record_name else contents[zi.filename]
            if zout.read(zi.filename) != want:
                raise TrimError(f"{zi.filename}: the written bytes differ")

    tmp = out + ".tmp-numpy-trim"
    try:
        with open(tmp, "wb") as fh:
            fh.write(blob)
        os.replace(tmp, out)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

    gz_in, gz_out = _gzip_len(raw), _gzip_len(blob)
    per_cat = {
        c: {
            "members": len([n for n in listed if listed[n] == c]),
            "bytes": sum(len(contents[n]) for n in listed if listed[n] == c),
            "zip_bytes": sum(len(e["data"]) for e in entries if listed.get(e["name"]) == c),
        }
        for c in counts_pin
    }
    return {
        "input": {"name": os.path.basename(src), "sha256": sha, "members": len(entries), "bytes": len(raw)},
        "output": {
            "name": os.path.basename(out),
            "sha256": hashlib.sha256(blob).hexdigest(),
            "members": len(kept),
            "bytes": len(blob),
        },
        "dropped": {"members": len(listed), "by_category": per_cat,
                    "py": sorted(n for n in listed if n.endswith(".py"))},
        "deflate_level": level,
        "zlib": zlib.ZLIB_RUNTIME_VERSION,
        "gzip9": {"before": gz_in, "after": gz_out, "delta": gz_out - gz_in},
        "html_base64_chars": {"before": _b64_len(gz_in), "after": _b64_len(gz_out),
                              "delta": _b64_len(gz_out) - _b64_len(gz_in)},
        "bytes_delta": len(blob) - len(raw),
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Drop the numpy wheel members numpy_drop.json names.")
    ap.add_argument("src")
    ap.add_argument("drop_list")
    ap.add_argument("out")
    ap.add_argument("--json", dest="json_out")
    a = ap.parse_args(argv)
    try:
        rep = trim(a.src, a.drop_list, a.out)
    except TrimError as e:
        print(f"numpy_trim: {e}", file=sys.stderr)
        return 1
    if a.json_out:
        with open(a.json_out, "w", encoding="utf-8") as fh:
            json.dump(rep, fh, indent=1, sort_keys=True)
            fh.write("\n")
    i, o = rep["input"], rep["output"]
    print(
        f"numpy_trim: {i['members']} -> {o['members']} members, {i['bytes']} -> {o['bytes']} B"
        f" ({rep['bytes_delta']}); gzip -9 {rep['gzip9']['before']} -> {rep['gzip9']['after']};"
        f" HTML (base64 of gzip) {rep['html_base64_chars']['delta']} chars; out sha256 {o['sha256']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
