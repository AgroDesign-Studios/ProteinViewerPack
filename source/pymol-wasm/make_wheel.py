"""Write the PyMOL wheel as a byte-reproducible zip, and drop the S1 members from its stage.

usage: python3 -I make_wheel.py <stage-dir> <version> <tag> <out.whl>
       python3 -I make_wheel.py --drop <stage-dir> <s1_drop.json>

Every input that is not file content is fixed: member order (byte order of the
archive name, dist-info last), each member's timestamp (SOURCE_DATE_EPOCH,
clamped to the zip epoch 1980-01-01), its mode (0644), the host-system byte,
and the compression settings. The RECORD rows are sorted the same way. What is
left is the content and this Python's zlib, which the builder image pins by
digest. An earlier build measured the alternative (`python3 -m zipfile -c` over a
directory walk): walk order, mtimes and the umask all leaked into the wheel.
`write_wheel` is that writer on its own, for any member set (the .pyc stage
rewrites the wheel with it).

`--drop` removes from the stage dir exactly the members s1_drop.json lists
(design 2026-11-16-pymol-wasm-slim S1-7 / S1-8: the D group of 61 data files
and the P group of 31 Python modules nothing in the browser reads or can run;
evidence sections 3.7 / 3.8). It fails, before removing anything, when a listed
member is not a regular file in the stage, when a group does not hold exactly
61 / 31 names, when a name repeats, and when a member the file says to keep
is listed or missing. Folders the drop leaves empty are removed as well.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
import time
import zipfile

ZIP_EPOCH = 315532800  # 1980-01-01T00:00:00Z, the earliest time a zip entry can carry

# The group sizes are fixed here, not read from the list, so an edit of the
# list alone cannot change how much the wheel loses.
S1_DROP_COUNTS = {"d_group": 61, "p_group": 31}


def _record_hash(data: bytes) -> str:
    return "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()


def _collect(stage: str) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    for root, dirs, names in os.walk(stage):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for name in names:
            path = os.path.join(root, name)
            if os.path.islink(path) or not os.path.isfile(path):
                raise SystemExit(f"make_wheel: refusing non-regular file {path}")
            if name.endswith((".pyc", ".pyo")):
                continue
            arc = os.path.relpath(path, stage).replace(os.sep, "/")
            with open(path, "rb") as fh:
                files[arc] = fh.read()
    return files


def write_wheel(files: dict[str, bytes], dist_info: str, out: str, epoch: int) -> int:
    """Write `files` (archive name -> content) and a RECORD for them as the wheel `out`.

    `files` must not hold `<dist_info>/RECORD`: the RECORD written here lists
    every member with its sha256 and size, in member order, and itself last
    with empty fields. `epoch` is SOURCE_DATE_EPOCH. Returns the number of
    members written (RECORD included). `files` itself is not changed.
    """
    record_name = f"{dist_info}/RECORD"
    if record_name in files:
        raise ValueError(f"make_wheel: {record_name} is written by write_wheel, not passed in")
    date_time = time.gmtime(max(epoch, ZIP_EPOCH))[:6]

    def order(name: str) -> tuple[bool, bytes]:
        return (name.startswith(dist_info + "/"), name.encode())

    members = dict(files)
    rows = [f"{name},{_record_hash(data)},{len(data)}" for name, data in sorted(members.items(), key=lambda kv: order(kv[0]))]
    rows.append(f"{record_name},,")
    members[record_name] = ("\n".join(rows) + "\n").encode()

    with zipfile.ZipFile(out, "w") as zf:
        for name in sorted(members, key=order):
            info = zipfile.ZipInfo(name, date_time=date_time)
            info.create_system = 3  # Unix, so the mode bits below are honoured
            info.external_attr = (0o100644 & 0xFFFF) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, members[name], compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return len(members)


def _safe_member(name: object) -> bool:
    """A plain relative archive name: no absolute path, no '..', no empty part, no backslash."""
    if not isinstance(name, str) or not name or name.startswith("/") or "\\" in name:
        return False
    return all(part not in ("", ".", "..") for part in name.split("/"))


def drop_members(stage: str, spec_path: str) -> dict[str, int]:
    """Remove the S1 drop list's members from the stage dir (see the module docstring)."""
    with open(spec_path, encoding="utf-8") as fh:
        spec = json.load(fh)
    if not isinstance(spec, dict) or spec.get("schema") != 1:
        raise SystemExit(f"make_wheel --drop: {spec_path} is not schema 1")
    problems: list[str] = []
    seen: set[str] = set()
    groups: dict[str, list[str]] = {}
    for group, want in S1_DROP_COUNTS.items():
        names = spec.get(group)
        if not isinstance(names, list):
            raise SystemExit(f"make_wheel --drop: {spec_path} has no list {group!r}")
        if len(names) != want:
            problems.append(f"{group} lists {len(names)} members, expected {want}")
        groups[group] = names
        for name in names:
            if not _safe_member(name):
                problems.append(f"{group}: not a plain member name: {name!r}")
            elif name in seen:
                problems.append(f"{group}: {name} is listed twice")
            else:
                seen.add(name)
    keep = spec.get("keep", [])
    if not isinstance(keep, list):
        raise SystemExit(f"make_wheel --drop: {spec_path} 'keep' is not a list")
    for name in keep:
        if not _safe_member(name):
            problems.append(f"keep: not a plain member name: {name!r}")
            continue
        if name in seen:
            problems.append(f"keep: {name} is also listed for removal")
        path = os.path.join(stage, *name.split("/"))
        if os.path.islink(path) or not os.path.isfile(path):
            problems.append(f"keep: {name} is not in the stage")
    for name in sorted(seen):
        path = os.path.join(stage, *name.split("/"))
        if os.path.islink(path) or not os.path.isfile(path):
            problems.append(f"missing: {name} is not a regular file in the stage")
    if problems:
        print("make_wheel --drop: refusing to remove anything:", file=sys.stderr)
        for p in problems:
            print("  " + p, file=sys.stderr)
        raise SystemExit(1)

    removed_bytes = 0
    parents: set[str] = set()
    for name in sorted(seen):
        path = os.path.join(stage, *name.split("/"))
        removed_bytes += os.path.getsize(path)
        os.remove(path)
        parents.add(os.path.dirname(path))
    # Folders the drop emptied (data/shaders, pymol/plugins, chempy/tinker, ...),
    # deepest first, never the stage dir itself.
    root = os.path.abspath(stage)
    pruned = 0
    for d in sorted(parents, key=lambda p: p.count(os.sep), reverse=True):
        d = os.path.abspath(d)
        while d != root and d.startswith(root + os.sep) and os.path.isdir(d) and not os.listdir(d):
            os.rmdir(d)
            pruned += 1
            d = os.path.dirname(d)
    counts = {group: len(names) for group, names in groups.items()}
    counts.update({"bytes": removed_bytes, "folders_removed": pruned})
    return counts


def main(argv: list[str]) -> int:
    if len(argv) == 4 and argv[1] == "--drop":
        counts = drop_members(argv[2], argv[3])
        print(
            f"make_wheel --drop: removed {counts['d_group']} D-group + {counts['p_group']} P-group members"
            f" ({counts['bytes']} bytes) and {counts['folders_removed']} emptied folders"
        )
        return 0
    if len(argv) != 5:
        print(__doc__, file=sys.stderr)
        return 2
    stage, version, tag, out = argv[1:]
    epoch = int(os.environ["SOURCE_DATE_EPOCH"])

    files = _collect(stage)
    dist_info = f"pymol-{version}.dist-info"
    if any(name.startswith(dist_info + "/") for name in files):
        raise SystemExit(f"make_wheel: {dist_info}/ must not exist in the stage dir")
    files[f"{dist_info}/METADATA"] = f"Metadata-Version: 2.1\nName: pymol\nVersion: {version}\nRequires-Dist: numpy\n".encode()
    files[f"{dist_info}/WHEEL"] = (
        f"Wheel-Version: 1.0\nGenerator: agdb-pymol-wasm\nRoot-Is-Purelib: false\nTag: {tag}\n".encode()
    )
    files[f"{dist_info}/top_level.txt"] = b"pymol\n"

    n = write_wheel(files, dist_info, out, epoch)
    print(f"make_wheel: {out}: {n} members")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
