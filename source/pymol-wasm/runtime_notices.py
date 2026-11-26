"""Notices of the code inside the Pyodide core and the NumPy wheel (PT-9275 item 7).

The runtime's licenses/ folder carried CPython's top-level LICENSE only, but
pyodide.asm.wasm links more than CPython's own code, and the NumPy wheel
bundles code under other licences. This script writes the two texts the
runtime ships for them, each notice copied verbatim from its source:

  licenses/NOTICES.pyodide-core.txt   what Pyodide 314.0.7 links into
                                      pyodide.asm.wasm besides CPython, from
                                      the upstream files pinned in INPUTS
  licenses/NOTICES.numpy-bundled.txt  every licence file NumPy's own wheel
                                      lists (dist-info/licenses), read out of
                                      the vendored wheel itself

    python3 -I pymol-wasm/runtime_notices.py fetch <dir>      # gh api, into <dir>
    python3 -I pymol-wasm/runtime_notices.py build <dir> <runtime dir>

What is linked was read from Pyodide's own build at tag 314.0.7
(cpython/Makefile and cpython/Setup.local: libffi, hiwire, liblzma, libzstd,
libsqlite3, bzip2 and zlib through emscripten ports, libmpdec and expat from
CPython's tree, HACL* hash modules; _ssl, _hashlib and _uuid disabled) and
checked against the strings of the vendored pyodide.asm.wasm (2026-11-15:
"expat_2.7.3", "bzip2/libbzip2", "1.0.6, 6-Sept-2010", "libmpdec",
"HACL* algorithm", "liblzma", ZSTD_* symbols, ffi_call, sqlite3_* and the
source id "2022-06-25 14:57:57 14e166f4", mimalloc's messages, "deflate 1.3.1").
build refuses an input whose bytes are not the pinned ones.
"""

from __future__ import annotations

import hashlib
import subprocess
import sys
import zipfile
from pathlib import Path

# (title, licence, what it is in the wasm, (repo, ref, path, sha256), how to quote)
#   how: ("file",)                 the whole file
#   how: ("from", heading)         from the line that is `heading` to the end
#   how: ("lines", first, last)    those lines (1-based, inclusive)
INPUTS: list[tuple[str, str, str, tuple[str, str, str, str], tuple[object, ...]]] = [
    (
        "CPython 3.14.2: licences and acknowledgements for incorporated software",
        "as each section says (CPython's Doc/license.rst)",
        (
            "CPython's own list of other people's code in its tree; it covers, among others, libmpdec, mimalloc,"
            " the Mersenne Twister, SipHash24, strtod/dtoa, cfuhash, expat, libffi and zlib, all linked into"
            " pyodide.asm.wasm. Its OpenSSL section does not apply: Pyodide's core does not build _ssl or"
            " _hashlib (cpython/Setup.local, *disabled*)."
        ),
        (
            "python/cpython",
            "v3.14.2",
            "Doc/license.rst",
            "c695d550b135e53e38807e76496d1db17d22c40e461d1f3f354c86188d3305dd",
        ),
        ("from", "Licenses and Acknowledgements for Incorporated Software"),
    ),
    (
        "Expat 2.7.3 (pyexpat, xml.etree)",
        "MIT",
        "CPython's bundled copy (Modules/expat), compiled into the core by Pyodide (LIBEXPAT_OBJS)",
        (
            "python/cpython",
            "v3.14.2",
            "Modules/expat/COPYING",
            "122f2c27000472a201d337b9b31f7eb2b52d091b02857061a8880371612d9534",
        ),
        ("file",),
    ),
    (
        "HACL* (hashlib's MD5, SHA-1, SHA-2, SHA-3, BLAKE2 and HMAC)",
        "MIT",
        "CPython's Modules/_hacl, built into _hmac and the hash modules (Setup.local); the notice heads each .c file",
        (
            "python/cpython",
            "v3.14.2",
            "Modules/_hacl/Hacl_Hash_SHA2.c",
            "f8af382de7e29a73c726f9c70770498ddd99e2c4702489ed6e634f0b68597c95",
        ),
        ("lines", 1, 23),
    ),
    (
        "mimalloc (CPython's object allocator)",
        "MIT (the full text is in CPython's section above)",
        "CPython's Objects/mimalloc; this is the header its files carry in 3.14.2",
        (
            "python/cpython",
            "v3.14.2",
            "Include/internal/mimalloc/mimalloc.h",
            "7c4e2fc555724fe674efbb2cfe64344fafa86f8c43d22e48263c33dd07ac7d81",
        ),
        ("lines", 1, 6),
    ),
    (
        "libffi (ctypes)",
        "MIT",
        "built by Pyodide from libffi commit f08493d249d2067c8b3207ba46693dd858f95db3 (cpython/Makefile)",
        (
            "libffi/libffi",
            "f08493d249d2067c8b3207ba46693dd858f95db3",
            "LICENSE",
            "2c9c2acb9743e6b007b91350475308aee44691d96aa20eacef8e199988c8c388",
        ),
        ("file",),
    ),
    (
        "bzip2 / libbzip2 1.0.6 (bz2)",
        "bzip2 licence (BSD-style)",
        "emscripten's bzip2 port (-sUSE_BZIP2=1; emscripten 5.0.3 tools/ports/bzip2.py, emscripten-ports/bzip2 1.0.6)",
        (
            "emscripten-ports/bzip2",
            "1.0.6",
            "LICENSE",
            "4919cfb14a73cd64fcef67b107613970cf1659a09aa675dba31314f373bc7204",
        ),
        ("file",),
    ),
    (
        "liblzma from XZ Utils 5.2.2 (lzma)",
        "Public domain (liblzma), as the file says",
        "built by Pyodide from xz-5.2.2 with the command line tools disabled (cpython/Makefile)",
        (
            "xz-mirror/xz",
            "v5.2.2",
            "COPYING",
            "c4f8e14fafe458d84808a4cd8b69f94673ebe2bf8fc992291629a69ac12218f8",
        ),
        ("file",),
    ),
    (
        "Zstandard 1.5.7 (compression.zstd)",
        "BSD-3-Clause (zstd is dual-licensed BSD or GPLv2; this distribution takes the BSD licence)",
        "built by Pyodide from python/cpython-source-deps tag zstd-1.5.7 (cpython/Makefile)",
        (
            "python/cpython-source-deps",
            "zstd-1.5.7",
            "LICENSE",
            "7055266497633c9025b777c78eb7235af13922117480ed5c674677adc381c9d8",
        ),
        ("file",),
    ),
    (
        "SQLite 3.39.0 (sqlite3)",
        "Public domain (no notice is required; credited here)",
        (
            "built by Pyodide from sqlite-autoconf-3390000 (the wasm's source id is 2022-06-25 14:57:57 14e166f4)."
            " The dedication below is quoted from SQLite 3.39.4's sqlite3.h (python/cpython-source-deps tag"
            " sqlite-3.39.4.0); 3.39.0's own sqlite3.h (sqlite.org's sqlite-autoconf-3390000.tar.gz, source id"
            " 2022-06-25 14:57:57 14e166f4) has the same ten lines, word for word"
        ),
        (
            "python/cpython-source-deps",
            "sqlite-3.39.4.0",
            "sqlite3.h",
            "2650d56a86f18e521e649dabd6e4ec2616afe7e43f097d5668fbabdf7e7cbaba",
        ),
        ("lines", 1, 10),
    ),
    (
        "hiwire (Pyodide's JavaScript reference table)",
        "Mozilla Public License 2.0 (the same text as LICENSE.pyodide.txt, byte for byte)",
        (
            "built by Pyodide from pyodide/hiwire commit 6a1e67280a15d929ebeceee54a6358c9c8d5f697 (cpython/Makefile)."
            " MPL section 3.2(a): its source is at https://github.com/pyodide/hiwire, that commit. Unmodified."
        ),
        (
            "pyodide/hiwire",
            "6a1e67280a15d929ebeceee54a6358c9c8d5f697",
            "LICENSE",
            "1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5",
        ),
        ("lines", 1, 2),
    ),
]

NUMPY_WHEEL = "numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl"
NUMPY_LICENCES = "numpy-2.4.6.dist-info/licenses/"


def src_path(root: Path, repo_ref_path: tuple[str, str, str, str]) -> Path:
    _repo, ref, path, _sha = repo_ref_path
    return root / ref / path


def fetch(root: Path) -> int:
    """Each input, through `gh api` (raw media type), to <root>/<ref>/<path>."""
    for _t, _l, _w, src, _how in INPUTS:
        repo, ref, path, _sha = src
        r = subprocess.run(
            ["gh", "api", "-H", "Accept: application/vnd.github.raw", f"repos/{repo}/contents/{path}?ref={ref}"],
            capture_output=True,
            check=False,
        )
        if r.returncode != 0:
            print(f"runtime_notices: could not fetch {repo}@{ref}:{path}", file=sys.stderr)
            return 1
        dest = src_path(root, src)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(r.stdout)
    return 0


def quote(text: str, how: tuple[object, ...]) -> str:
    lines = text.splitlines()
    if how[0] == "file":
        return text.rstrip("\n")
    if how[0] == "from":
        i = lines.index(str(how[1]))
        return "\n".join(lines[i:]).rstrip("\n")
    first, last = int(str(how[1])), int(str(how[2]))
    return "\n".join(lines[first - 1 : last])


def pyodide_core(root: Path) -> str:
    out = [
        "Code inside the Pyodide core besides CPython's own",
        "==================================================",
        "",
        "pyodide.asm.wasm (Pyodide 314.0.7, CPython 3.14.2) links the libraries below into",
        "the one WebAssembly module, each under its own terms. Each notice is copied",
        "verbatim from the source named in its heading (repository, tag or commit, path).",
        "CPython's own licence is LICENSE.cpython.txt, Pyodide's LICENSE.pyodide.txt, and",
        "zlib's (emscripten's zlib 1.3.1 port) LICENSE.zlib.txt, beside this file.",
        "Generated by pymol-wasm/runtime_notices.py.",
        "",
    ]
    for title, lic, what, src, how in INPUTS:
        data = src_path(root, src).read_bytes()
        if hashlib.sha256(data).hexdigest() != src[3]:
            raise SystemExit(f"runtime_notices: {src[0]}@{src[1]}:{src[2]} is not the pinned file")
        repo, ref, path, _sha = src
        out += ["-" * 78, title, f"Licence: {lic}", f"In the core: {what}", "", f"[{repo} {ref} {path}]"]
        out += [quote(data.decode("utf-8"), how), ""]
    return "\n".join(out).rstrip("\n") + "\n"


def numpy_bundled(runtime: Path) -> str:
    out = [
        "Licences of the code NumPy 2.4.6 bundles",
        "========================================",
        "",
        "Every licence file the vendored NumPy wheel itself lists (its dist-info/licenses",
        "folder and METADATA License-File lines), copied verbatim out of",
        f"{NUMPY_WHEEL}, beside NumPy's own licence (LICENSE.numpy.txt, the same",
        "bytes as its dist-info/licenses/LICENSE.txt). Some of these are for code built",
        "only on other processors (svml and x86-simd-sort are x86 code); whether each is",
        "compiled into this WebAssembly build is not checked here, so all are listed.",
        "Generated by pymol-wasm/runtime_notices.py.",
        "",
    ]
    with zipfile.ZipFile(runtime / NUMPY_WHEEL) as z:
        names = sorted(n for n in z.namelist() if n.startswith(NUMPY_LICENCES) and not n.endswith("/"))
        for n in names:
            rel = n.removeprefix(NUMPY_LICENCES)
            if rel == "LICENSE.txt":
                continue
            out += ["-" * 78, rel, ""]
            out += [z.read(n).decode("utf-8").rstrip("\n"), ""]
    return "\n".join(out).rstrip("\n") + "\n"


def main(argv: list[str]) -> int:
    if len(argv) == 3 and argv[1] == "fetch":
        return fetch(Path(argv[2]))
    if len(argv) == 4 and argv[1] == "build":
        root, runtime = Path(argv[2]), Path(argv[3])
        (runtime / "licenses" / "NOTICES.pyodide-core.txt").write_text(pyodide_core(root), encoding="utf-8")
        (runtime / "licenses" / "NOTICES.numpy-bundled.txt").write_text(numpy_bundled(runtime), encoding="utf-8")
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
