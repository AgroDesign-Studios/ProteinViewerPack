"""Third-party notices inside the Open-Source PyMOL build (the wheel's _cmd and Python modules).

The in-browser PyMOL wheel is compiled from pymol-open-source `edcda80f`
(`compile.sh`: ov/src, layer0-5, layerGraphics, with contrib/pocketfft's
header on the include path) and carries its Python modules and data as
source (`wheel.sh`: modules/pymol, chempy, pymol2 and five data folders, less
`NOT_SHIPPED` and the members `s1_drop.json` lists, which wheel.sh removes
through `make_wheel.py --drop`; this script reads the same file).
Most of that code is Schrodinger's, under the Open-Source PyMOL licence
(licenses/LICENSE.pymol.txt), but some of it is other people's code under its
own terms, and its notice must travel with it. This script gathers those
notices from the source tree, verbatim, into one text that the runtime ships
as licenses/NOTICES.pymol-third-party.txt (the standalone HTML app's licence
list reads it).

    python3 -I pymol-wasm/third_party_notices.py <pymol-open-source tree> <out file>

Checked again on every run, at the level of the notice itself (PT-9275 item
8, PT-9276 item 2): every notice-like line in a compiled or shipped file
(`NOTICE_LINE`, case-insensitive) must sit inside a comment block an entry
quotes, or be listed in `NOT_A_NOTICE` with the reason; otherwise the run
fails (`uncovered`). A header a compiled folder holds but the wasm build
compiles out (`NOT_COMPILED`: the Gentium fonts since patch 0012) is not
scanned, and every run checks it is still compiled out; the faces the DejaVu
entry names (`WASM_FACES`) are checked against the tree the same way. So the
tree must be the one the build compiles: edcda80f with pymol-wasm/patches
applied. Comment blocks are found by one positional pass that
skips string and character literals (`c_blocks`, `py_blocks`). Each entry
names the files it covers and takes its text from the source: a whole licence
file, or the comment block of a file that carries the notice. A licence whose
full text is not in the tree is kept beside this script in notices/, copied
from the upstream repository (notices/README.md says from where). The
libraries linked from emscripten's ports (libpng, FreeType, zlib) and GLM have
their own files in licenses/ already.
"""

from __future__ import annotations

import io
import json
import re
import sys
import tokenize
from bisect import bisect_right
from fnmatch import fnmatch
from pathlib import Path

HERE = Path(__file__).resolve().parent

# The TrueType faces the wasm build registers (patch 0012, design 2026-11-16
# pymol-wasm-slim S2-1 option (2)), by their layer1/FontTTF.h array names
# (TTF_<face>_dat). The DejaVu entry names them; every run checks that
# FACES_FILE still references exactly these where __EMSCRIPTEN__ is defined
# (faces_problems), so the entry cannot claim a set the wasm does not link.
WASM_FACES = ("DejaVuSans", "DejaVuSans_Oblique", "DejaVuSans_Bold", "DejaVuSans_BoldOblique")
FACES_FILE: str | None = "layer1/Text.cpp"

# (component, licence, files it covers, where the text comes from)
#   ("file", path)            the whole file
#   ("block", path, marker)   the file's first comment block (in file order) that contains marker
#   ("here", path)            a file in pymol-wasm/notices/
ENTRIES: list[tuple[str, str, str, list[tuple[str, ...]]]] = [
    (
        "pocketfft (C++ header-only FFT)",
        "BSD-3-Clause",
        "contrib/pocketfft/pocketfft_hdronly.h (compiled in through -Icontrib/pocketfft)",
        # The compiled header's own notice names every holder (PT-9260 item 2); LICENSE.md is the older one.
        [
            ("block", "contrib/pocketfft/pocketfft_hdronly.h", "Peter Bell"),
            # The DCT-IV code's own origin note (FFTW3's apply_re11), beside the code.
            ("block", "contrib/pocketfft/pocketfft_hdronly.h", "apply_re11"),
            ("file", "contrib/pocketfft/LICENSE.md"),
        ],
    ),
    (
        "US-align (TM-align, ported to PyMOL)",
        "US-align licence: the notices on the head, the references and the copyright notice in all copies",
        "layer2/USalign.cpp, layer2/USalign.h (cmd.usalign)",
        [("block", "layer2/USalign.cpp", "Ported from USalign"), ("block", "layer2/USalign.cpp", "Chengxin Zhang")],
    ),
    (
        "Marching cubes, based on ilastik/marching_cubes",
        "BSD-3-Clause",
        "layer0/marching_cubes.h, layer0/marching_cubes.cpp, layer0/ContourSurf.cpp",
        [
            ("block", "layer0/marching_cubes.h", "ilastik"),
            ("block", "layer0/marching_cubes.cpp", "ilastik"),
            ("block", "layer0/ContourSurf.cpp", "ilastik/marching_cubes"),
            ("here", "notices/ilastik-marching_cubes.LICENSE"),
        ],
    ),
    (
        "Mersenne Twister (MT19937) random number generator",
        "BSD-3-Clause",
        "ov/src/OVRandom.cpp",
        [("block", "ov/src/OVRandom.cpp", "Makoto Matsumoto")],
    ),
    (
        "ccealign (CE structural alignment)",
        # Two conditions and the disclaimer, no non-endorsement clause (PT-9262 item 3).
        "BSD-2-Clause",
        "layer0/ccealignmodule.cpp",
        [("block", "layer0/ccealignmodule.cpp", "Jason Vertrees")],
    ),
    (
        "Template Numerical Toolkit (TNT)",
        "Public domain (NIST)",
        "include/tnt/*.h (used by layer0/ccealignmodule.cpp)",
        [("block", "include/tnt/tnt.h", "public domain"), ("block", "include/tnt/jama_eig.h", "Adapted from JAMA")],
    ),
    (
        "GLUT bitmap fonts",
        "GLUT licence (freely distributable)",
        "layer1/FontGLUT8x13.cpp, FontGLUT9x15.cpp, FontGLUTHel10.cpp, FontGLUTHel12.cpp, FontGLUTHel18.cpp",
        [("block", "layer1/FontGLUT8x13.cpp", "Mark J. Kilgard")],
    ),
    (
        # The Arev glyphs sit in DejaVu Sans and Sans Oblique, both linked, so the
        # Arev terms stay with the Bitstream Vera ones. The Gentium entry is gone:
        # patch 0012 (S2-1) compiles layer1/FontTTF2.h out of the wasm build
        # (NOT_COMPILED below), and a notice must not list code the wasm does not hold.
        "DejaVu fonts (Bitstream Vera, Arev glyphs)",
        "Bitstream Vera Fonts licence; Arev Fonts licence; DejaVu changes public domain",
        "layer1/FontTTF.h (included by layer1/Text.cpp); the wasm links its four Sans faces "
        + ", ".join(f.replace("_", "-") for f in WASM_FACES)
        + " (label_font_id 5-8), the other ids draw with DejaVuSans",
        [("block", "layer1/FontTTF.h", "Bitstream Vera Fonts Copyright")],
    ),
    (
        "Mesa (matrix routines MatrixInvertC44f, MatrixMultiplyC44f, rotation_matrix3f)",
        (
            "MIT (X11) licence, Mesa's. Which Mesa release the routines were taken from"
            " is not recorded in PyMOL (unconfirmed). All three, with the same comments, and the same"
            " permission notice by Brian Paul are in every Mesa release from 3.1 to 4.0 (copyright years"
            " 1999 to 1999-2001); Mesa 4.1 rewrote the rotation routine's comment, so the notice below is"
            " the one in src/mesa/math/m_matrix.c at Mesa's mesa_4_0 tag"
        ),
        "layer0/Matrix.cpp, layer0/Vector.cpp (rotation_matrix3f, found by this script's scan)",
        [
            ("block", "layer0/Matrix.cpp", "MIT consortium license"),
            ("block", "layer0/Matrix.cpp", "Code contributed by Jacques Leroy"),
            ("block", "layer0/Matrix.cpp", "original author: Thomas Malik"),
            ("block", "layer0/Vector.cpp", "Erich Boleyn"),
            ("here", "notices/mesa-m_matrix.LICENSE"),
        ],
    ),
    (
        "base64 decoding table (cited Stack Overflow answer)",
        (
            "CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/), the most likely source's. The"
            " comment cites the question, not an answer. The decoder keeps the names and the shape of ryyst's answer"
            " (https://stackoverflow.com/a/6782480, by https://stackoverflow.com/users/282635/ryyst, posted"
            " 2011-07-21, last edited 2014-01-10, when Stack Overflow published posts under CC BY-SA 3.0):"
            " decoded_data, triple, input_length / 4 * 3, (triple >> k * 8) & 0xFF. Its table (indexed from"
            " '+') is in none of the question's 21 answers (read 2026-11-15), so that source is not confirmed."
            " The citation came into PyMOL between its 2017-12-21 and 2018-02-28 snapshots, before the 4.0 change."
            " This build changes base64_decode (pymol-wasm/patches/0011-mypng-failed-read-builds-no-image.patch:"
            " an optional argument that returns the decoded length); the modified function stays under the"
            " same terms, CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/)"
        ),
        "layer0/MyPNG.cpp (base64_decoding_table)",
        [("block", "layer0/MyPNG.cpp", "stackoverflow.com")],
    ),
    (
        "COLLADA export",
        "Open-Source PyMOL licence (contributed code, co-owned with Schrodinger)",
        "layer1/COLLADA.cpp",
        [("block", "layer1/COLLADA.cpp", "Jared Sampson")],
    ),
    (
        "Jenarix (TM) Library",
        "Open-Source PyMOL licence (the LICENSE file it refers to)",
        "ov/src/* (the ObVec library), layer0/Matrix.cpp, layer1/PConv.h",
        [("block", "ov/src/ov_types.h", "Jenarix"), ("block", "ov/src/ov_defines.h", "Jenarix")],
    ),
    (
        "VRML2 export (Chris Want) and Bob Jenkins' hash",
        "Public domain, as the contributors say (no notice is required; credited here)",
        "layer1/Ray.cpp (RayRenderVRML2, the 96-to-32-bit hash)",
        [
            ("block", "layer1/Ray.cpp", "can be regarded as being in the public domain"),
            ("block", "layer1/Ray.cpp", "Robert Jenkin"),
        ],
    ),
    (
        # pymol/seqalign.py, pymol/plugins/*.py and data/startup/apbs_gui/{creating,electrostatics}.py
        # carried the same notice; the S1 wheel drops them (s1_drop.json). It drops
        # pymol/rpc.py (Greg Landrum's XML-RPC server) too, and its entry with it.
        "Thomas Holder's psico-derived module (shipped as Python source in the wheel)",
        (
            "BSD-2-Clause, as the file says; it carries no licence text, so the text below is the one"
            " pymol-psico (the project it is based on) ships, at commit f42cb1e4"
        ),
        "pymol/morphing.py",
        [
            ("block", "modules/pymol/morphing.py", "Thomas Holder"),
            ("here", "notices/pymol-psico.LICENSE"),
        ],
    ),
]

# A line naming someone's copyright, authorship, origin or terms. Case-insensitive
# and line-local; a hit only counts when no entry quotes the block it is in.
# "based on" alone is everyday prose ("based on unique_id"); with a URL, code
# or a dotted source name after it, it names where code came from.
NOTICE_LINE = re.compile(
    r"copyright|\(c\)\s*[0-9]{4}|©|\bported from|adapted from|taken from|derived from"
    r"|based on\s+(?:https?://|code\b|(?:the )?\S+ (?:algorithm|code|library)\b|[a-z]\w*\.[a-z]\w*)|code based on"
    r"|licen[cs]|public domain|spdx|permission (?:is hereby|to use)|stackoverflow|\bauthors?\b"
    r"|mit consortium|all rights reserved|contributed by",
    re.IGNORECASE,
)
# In data files (force-field tables, structures, settings help) only the
# strong words: their comments say "based on" and "derived from" about numbers.
DATA_NOTICE_LINE = re.compile(
    r"copyright|\(c\)\s*[0-9]{4}|©|licen[cs]|public domain|spdx|permission (?:is hereby|to use)"
    r"|all rights reserved|stackoverflow",
    re.IGNORECASE,
)
# Schrodinger's and DeLano's own lines (the PyMOL licence), and the fixed
# lines of PyMOL's own file header, are not third-party.
OWN_LINE = re.compile(
    r"Schr[oö]dinger|DeLano|PyMOL\(TM\)|AxPyMOL|products derived from this software"
    r"|It is unlawful to modify or remove this copyright notice|accompanying LICENSE file"
    r"|Additional authors of this source file include",
    re.IGNORECASE,
)

# What build.sh compiles (compile.sh DIRS), the contrib header it includes and the headers it reads.
COMPILED_DIRS = (
    "ov/src",
    "layer0",
    "layer1",
    "layer2",
    "layer3",
    "layer4",
    "layer5",
    "layerGraphics",
    "contrib/pocketfft",
    "include",
)
# What wheel.sh copies into the stage as files (source, data, shaders). The wheel
# holds these less NOT_SHIPPED and S1_DROPPED below (data/startup, data/shaders
# and setting_help.csv are copied and then dropped whole by the S1 list).
SHIPPED_DIRS = (
    "modules/pymol",
    "modules/chempy",
    "modules/pymol2",
    "data/chempy",
    "data/pymol",
    "data/startup",
    "data/shaders",
    "data/tut",
)
SHIPPED_FILES = ("data/setting_help.csv", "data/chem_comp_bond-top100.cif")
# What wheel.sh removes again from a shipped folder, so neither the wheel nor this
# scan holds it. data/chempy/tinker (PT-9285 item 1): chempy.prm is a modified
# TINKER amber.prm under TINKER's no-redistribution terms, and nothing in the
# browser can use the folder (chempy.tinker runs an external TINKER program).
NOT_SHIPPED = ("data/chempy/tinker",)

# Headers that sit in a compiled folder but that the wasm build does not compile
# in: (the file that includes it, why). Not scanned, and no entry may quote one.
# compile.sh compiles every .cpp of its folders, so only a header can be here,
# and only while every #include of it in COMPILED_DIRS sits where __EMSCRIPTEN__
# (which emcc always defines) is not defined. Checked on every run
# (not_compiled_problems): a missing file, an includer that no longer includes
# it, or an include the wasm build would compile fails the run, so the
# exclusion cannot outlive the patch that makes it true.
NOT_COMPILED: dict[str, tuple[str, str]] = {
    "layer1/FontTTF2.h": (
        "layer1/Text.cpp",
        "the Gentium faces (label_font_id 15, 16); patch 0012 registers only the four DejaVu Sans"
        " faces in the wasm build and includes this header only where __EMSCRIPTEN__ is not defined",
    ),
}

# The S1 drop list (design 2026-11-16-pymol-wasm-slim S1-7 / S1-8): the wheel
# members wheel.sh removes from the stage (make_wheel.py --drop s1_drop.json).
# Read from the same file, so this scan and the wheel cannot disagree on it.
S1_DROP_LIST = HERE / "s1_drop.json"
WHEEL_DATA = "pymol/pymol_path/data/"
WHEEL_PACKAGES = ("pymol", "chempy", "pymol2")


def source_path(member: str) -> str:
    """The source-tree path wheel.sh copies to wheel member `member` (data/, modules/<pkg>/)."""
    if member.startswith(WHEEL_DATA):
        return "data/" + member[len(WHEEL_DATA) :]
    if member.startswith("pymol/pymol_path/"):
        raise ValueError(f"{member}: not copied from data/")
    if member.split("/")[0] in WHEEL_PACKAGES and "/" in member:
        return "modules/" + member
    raise ValueError(f"{member}: not a wheel member copied from the source tree")


def s1_dropped(path: Path) -> frozenset[str]:
    """The source-tree paths of every member the S1 drop list names (both groups)."""
    spec = json.loads(path.read_text(encoding="utf-8"))
    return frozenset(source_path(m) for group in ("d_group", "p_group") for m in spec[group])


S1_DROPPED = s1_dropped(S1_DROP_LIST)

C_LIKE = {".c", ".cpp", ".h", ".hpp", ".fs", ".vs", ".gs", ".shared"}
# Other source and prose, scanned with the full pattern.
SOURCE = {".py", ".md", ""}
# Binary data: no text to scan (pickled chempy models, images).
BINARY = {".pkl", ".png", ".ppm"}

_OWN_CREDIT = "credits a PyMOL developer or contributor inside PyMOL's own code, under its licence"
_PROSE = "ordinary prose or code, no notice"
_ALGOL = "names the published Algol procedure the routine implements; no text copied"
_TNT_PD = "the NIST public-domain statement every TNT header repeats (quoted under TNT)"

# Notice-like lines that are not a notice, by file (a glob): (text the line contains, why).
NOT_A_NOTICE: dict[str, list[tuple[str, str]]] = {
    "layer2/CifMoleculeReader.cpp": [("based on components.cif", _PROSE + " (the wwPDB chemical component dictionary it reads)")],
    "layer0/Matrix.h": [("based on Mesa code", "describes the Matrix.cpp routines the Mesa entry covers")],
    "layer0/MyPNG.cpp": [("approach adapted from TJO", "an approach credited to a contributor; " + _OWN_CREDIT)],
    "layer0/os_proprietary.h": [("software subscriptions and licenses", "Schrodinger's own note on proprietary builds")],
    "layer1/COLLADA.cpp": [('"author"', "writes the COLLADA <author> element; " + _PROSE)],
    "layer1/Ortho.cpp": [
        ("Other Major Authors and Contributors", "PyMOL's own start-up credits (commented out)"),
        ("PyMOL is not in the public domain", "PyMOL's own start-up text"),
    ],
    "layer1/Ray.cpp": [("RayRenderVRML2, via the public domain", "the grant itself is quoted under the VRML2 entry")],
    "layer3/Executive.cpp": [("author: Thomas Holder", _OWN_CREDIT)],
    "layer3/MovieScene.cpp": [("Author: Thomas Holder", _OWN_CREDIT + " (the file is (c) Schrodinger, Inc.)")],
    "include/pymol/zstring_view.h": [("derived from djb2", "names the hash function it implements; no notice to carry")],
    "include/tnt/*.h": [
        ("is not subject to copyright protection", _TNT_PD),
        ("and is in the public domain", _TNT_PD),
        ("(Adapted from JAMA, a Java Matrix Library", "the JAMA credit each JAMA routine repeats (quoted under TNT)"),
        ("derived from the Algol procedure", _ALGOL),
    ],
    "include/tnt/tnt_array2d.h": [("public domain codes.", _PROSE + " (textbooks and codes that use C[i][j])")],
    "modules/pymol/experimenting.py": [("AUTHORS", _OWN_CREDIT + " (a command's help text)")],
    "modules/pymol/movie.py": [
        ("AUTHOR", _OWN_CREDIT + " (a command's help text)"),
        ("# Author: Peter Haebel", _OWN_CREDIT),
    ],
    "modules/pymol/diagnosing.py": [("License Information:", _PROSE)],
    "modules/pymol/save_shortcut.py": [("made for license", _PROSE)],
    "modules/pymol/viewing.py": [("are taken from the current viewpoint", _PROSE)],
    "modules/pymol/fitting.py": [
        ("Based on the USalign algorithm", "cmd.usalign's help text; the code is quoted under US-align")
    ],
    "modules/pymol/wizard/*.py": [("This wizard contributed by Ezequiel", "a wizard contributed to PyMOL; " + _OWN_CREDIT)],
    "modules/chempy/cpv.py": [("based on code submitted by Paul Sherwood", "code contributed to chempy; " + _OWN_CREDIT)],
}


class Block:
    """A comment block (or Python docstring) as written, and the lines it spans (1-based, inclusive)."""

    def __init__(self, first: int, last: int, text: str) -> None:
        self.first = first
        self.last = last
        self.text = text


def _line_of(starts: list[int], pos: int) -> int:
    return bisect_right(starts, pos)


def _lines(text: str) -> list[str]:
    r"""The text's lines, split on '\n' only, as c_blocks and tokenize number them.

    str.splitlines() also breaks on \x0b, \x0c, \x1c-\x1e, \x85 and
    \u2028/\u2029, so a line holding one would shift every later line number
    against the blocks' own (PT-9303 item 1). read_text has already made CRLF
    and CR into '\n'. A final '\n' ends the last line; it opens no empty one.
    """
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    return lines


def c_blocks(text: str) -> list[Block]:
    """Every comment in C-like source, in file order, in one pass that skips string and char literals.

    A /* */ comment is one block, as written. A run of // comments on
    consecutive lines is one block; a run that starts a line is taken from the
    line's start (its indent kept), one after code from the //.
    """
    starts = [0] + [m.end() for m in re.finditer("\n", text)]
    blocks: list[Block] = []
    # (text start, first line, last line, began a line) of an open // run
    run: tuple[int, int, int, bool] | None = None
    i, n = 0, len(text)

    def close_run() -> None:
        nonlocal run
        if run is not None:
            s, first, last, _ = run
            end = starts[last] - 1 if last < len(starts) else n
            blocks.append(Block(first, last, text[s:end]))
            run = None

    while i < n:
        c = text[i]
        if c == "/" and text.startswith("//", i):
            line = _line_of(starts, i)
            eol = text.find("\n", i)
            eol = n if eol < 0 else eol
            at_start = text[starts[line - 1] : i].strip() == ""
            if run is not None and run[3] and run[2] == line - 1 and at_start:
                run = (run[0], run[1], line, True)
            else:
                close_run()
                run = (starts[line - 1] if at_start else i, line, line, at_start)
            i = eol
            continue
        if c == "/" and text.startswith("/*", i):
            close_run()
            end = text.find("*/", i + 2)
            if end < 0:
                raise ValueError("unterminated comment")
            blocks.append(Block(_line_of(starts, i), _line_of(starts, end), text[i : end + 2]))
            i = end + 2
            continue
        if c in "\"'":
            j = i + 1
            while j < n and text[j] != c and text[j] != "\n":
                j += 2 if text[j] == "\\" else 1
            i = j + 1
            continue
        if c == "\n" and run is not None and _line_of(starts, i) > run[2]:
            close_run()
        i += 1
    close_run()
    return blocks


def py_blocks(text: str) -> list[Block]:
    """Every comment run and docstring-like string statement in Python source, in file order."""
    lines = _lines(text)
    blocks: list[Block] = []
    toks = list(tokenize.generate_tokens(io.StringIO(text).readline))
    run: list[int] = []
    prev = tokenize.NEWLINE
    for k, tok in enumerate(toks):
        if tok.type == tokenize.COMMENT:
            row = tok.start[0]
            if run and run[-1] == row - 1:
                run.append(row)
            else:
                if run:
                    blocks.append(Block(run[0], run[-1], "\n".join(lines[run[0] - 1 : run[-1]])))
                run = [row]
        elif tok.type == tokenize.STRING and prev in (tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT, tokenize.NL):
            nxt = next((t for t in toks[k + 1 :] if t.type not in (tokenize.COMMENT,)), None)
            if nxt is not None and nxt.type in (tokenize.NEWLINE, tokenize.ENDMARKER):
                blocks.append(Block(tok.start[0], tok.end[0], tok.string))
        if tok.type not in (tokenize.COMMENT, tokenize.NL):
            prev = tok.type
        elif tok.type == tokenize.NL and prev in (tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT):
            prev = tokenize.NEWLINE
    if run:
        blocks.append(Block(run[0], run[-1], "\n".join(lines[run[0] - 1 : run[-1]])))
    blocks.sort(key=lambda b: b.first)
    return blocks


def line_blocks(text: str) -> list[Block]:
    """Plain text (data, Markdown): each line is its own block."""
    return [Block(k, k, line) for k, line in enumerate(_lines(text), 1)]


def blocks_of(rel: str, text: str) -> list[Block]:
    suffix = Path(rel).suffix
    if suffix in C_LIKE:
        return c_blocks(text)
    if suffix == ".py":
        return py_blocks(text)
    return line_blocks(text)


def comment_with(rel: str, text: str, marker: str) -> Block:
    """The file's first comment block, in file order, that contains `marker` and reads as a notice."""
    for b in blocks_of(rel, text):
        if marker in b.text:
            if not NOTICE_LINE.search(b.text):
                raise ValueError(f"{rel}: the block with {marker!r} reads as no notice")
            return b
    raise ValueError(f"{rel}: no comment block contains {marker!r}")


def _not_shipped(rel: str) -> bool:
    """Whether wheel.sh removes `rel` (a source-tree path) before it writes the wheel."""
    return rel in S1_DROPPED or any(rel == d or rel.startswith(d + "/") for d in NOT_SHIPPED)


def _shipped_source(rel: str) -> bool:
    """Whether `rel` is a file wheel.sh copies into the stage (before any removal)."""
    return rel in SHIPPED_FILES or any(rel.startswith(d + "/") for d in SHIPPED_DIRS)


_C_TOKEN = re.compile(r"//[^\n]*|/\*.*?\*/|\"(?:\\.|[^\"\\\n])*\"|'(?:\\.|[^'\\\n])*'", re.DOTALL)
_PP_COND = re.compile(r"\s*#\s*(ifdef|ifndef|if|elif|else|endif)\b(.*)")
_PP_INCLUDE = re.compile(r"\s*#\s*include\s*[<\"]([^>\"]+)[>\"]")
_EMS_ON = re.compile(r"defined\s*\(\s*__EMSCRIPTEN__\s*\)|defined\s+__EMSCRIPTEN__")
_EMS_OFF = re.compile(r"!\s*defined\s*\(\s*__EMSCRIPTEN__\s*\)|!\s*defined\s+__EMSCRIPTEN__")
_FACE = re.compile(r"\bTTF_(\w+?)_dat\b")


def _without_comments(text: str) -> str:
    """C-like source with every comment blanked to spaces (newlines kept), string and char literals untouched."""

    def blank(m: re.Match[str]) -> str:
        s = m.group(0)
        return s if s[0] in "\"'" else re.sub(r"[^\n]", " ", s)

    return _C_TOKEN.sub(blank, text)


def _ems_branch(directive: str, expr: str) -> str | None:
    """'on' when the #if's first branch is the one compiled with __EMSCRIPTEN__, 'off' when it is
    never compiled then, None for any other condition (a mixed one too: it may be compiled)."""
    expr = expr.strip()
    if (directive == "ifdef" and expr == "__EMSCRIPTEN__") or (directive == "if" and _EMS_ON.fullmatch(expr)):
        return "on"
    if (directive == "ifndef" and expr == "__EMSCRIPTEN__") or (directive == "if" and _EMS_OFF.fullmatch(expr)):
        return "off"
    return None


def wasm_lines(text: str) -> list[tuple[int, str]]:
    """The lines of C-like source (comments blanked) the wasm build may compile, as far as __EMSCRIPTEN__ decides.

    A line is left out only when an enclosing #if branch is one __EMSCRIPTEN__
    excludes: the first branch of #ifndef __EMSCRIPTEN__ / #if
    !defined(__EMSCRIPTEN__), or any branch after the first of #ifdef
    __EMSCRIPTEN__ / #if defined(__EMSCRIPTEN__). Every other condition counts
    as compiled, so a guard this cannot read fails closed. Conditional
    directives themselves are not returned.
    """
    stack: list[list[str | bool | None]] = []  # per open #if: [its __EMSCRIPTEN__ kind, current branch excluded]
    out: list[tuple[int, str]] = []
    for k, line in enumerate(_lines(_without_comments(text)), 1):
        m = _PP_COND.match(line)
        if m is None:
            if not any(off for _, off in stack):
                out.append((k, line))
            continue
        directive, expr = m.group(1), m.group(2)
        if directive in ("if", "ifdef", "ifndef"):
            kind = _ems_branch(directive, expr)
            stack.append([kind, kind == "off"])
        elif not stack:
            raise ValueError(f"line {k}: #{directive} without an open #if")
        elif directive == "endif":
            stack.pop()
        else:
            # After the __EMSCRIPTEN__ branch every later one is excluded; after an
            # excluded first branch, a later one may be the compiled one.
            stack[-1][1] = stack[-1][0] == "on"
    if stack:
        raise ValueError("an #if is never closed")
    return out


def _read_source(f: Path) -> str:
    try:
        return f.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return f.read_text(encoding="latin-1")


def not_compiled_problems(src: Path) -> list[str]:
    """Why a NOT_COMPILED exclusion does not hold for the tree at `src` ([] when every one holds)."""
    out: list[str] = []
    by_name = {Path(rel).name: rel for rel in NOT_COMPILED}
    includes: dict[str, list[tuple[str, int, bool]]] = {rel: [] for rel in NOT_COMPILED}
    for d in COMPILED_DIRS:
        for f in sorted((src / d).rglob("*")):
            rel = f.relative_to(src).as_posix()
            if not f.is_file() or f.suffix not in C_LIKE or rel in NOT_COMPILED:
                continue
            text = _read_source(f)
            if not any(name in text for name in by_name):
                continue
            compiled = {k for k, _ in wasm_lines(text)}
            for k, line in enumerate(_lines(_without_comments(text)), 1):
                m = _PP_INCLUDE.match(line)
                if m and Path(m.group(1)).name in by_name:
                    includes[by_name[Path(m.group(1)).name]].append((rel, k, k in compiled))
    for rel, (includer, _why) in NOT_COMPILED.items():
        if Path(rel).suffix not in {".h", ".hpp"}:
            out.append(f"{rel}: NOT_COMPILED holds a source file, which compile.sh compiles whatever includes it")
        if not (src / rel).is_file():
            out.append(f"{rel}: NOT_COMPILED names a file the tree does not have (stale)")
        if not any(r == includer for r, _, _ in includes[rel]):
            out.append(f"{rel}: NOT_COMPILED says {includer} includes it, and no line there does (stale)")
        for r, k, compiled in includes[rel]:
            if compiled:
                out.append(
                    f"{r}:{k}: includes {rel} where __EMSCRIPTEN__ does not exclude it, so the wasm"
                    " compiles it in: its NOT_COMPILED exclusion is stale (scan it and quote its notice)"
                )
    return out


def wasm_faces(src: Path) -> list[str]:
    """The TTF_<face>_dat arrays FACES_FILE references on lines the wasm build may compile, sorted."""
    assert FACES_FILE is not None
    text = _read_source(src / FACES_FILE)
    return sorted({m.group(1) for _, line in wasm_lines(text) for m in _FACE.finditer(line)})


def faces_problems(src: Path) -> list[str]:
    """Whether the faces the DejaVu entry names are exactly the ones the wasm build links."""
    if FACES_FILE is None:
        return []
    if not (src / FACES_FILE).is_file():
        return [f"{FACES_FILE}: missing, so the faces the wasm links cannot be checked against WASM_FACES"]
    got = wasm_faces(src)
    if got != sorted(WASM_FACES):
        return [
            f"{FACES_FILE}: the wasm build links the faces {got},"
            f" WASM_FACES (the DejaVu entry) says {sorted(WASM_FACES)}"
        ]
    return []


def scanned_files(src: Path) -> list[Path]:
    files: list[Path] = []
    for d in COMPILED_DIRS:
        files += [
            f
            for f in sorted((src / d).rglob("*"))
            if f.is_file() and f.suffix in C_LIKE | {".md", ""} and f.relative_to(src).as_posix() not in NOT_COMPILED
        ]
    for d in SHIPPED_DIRS:
        files += [
            f
            for f in sorted((src / d).rglob("*"))
            if f.is_file() and "__pycache__" not in f.parts and not _not_shipped(f.relative_to(src).as_posix())
        ]
    files += [src / f for f in SHIPPED_FILES if not _not_shipped(f)]
    return files


def build(src: Path) -> tuple[str, dict[str, list[tuple[int, int]]], set[str]]:
    """The notices text; per source file the line spans it quotes (a whole file: (1, its last line)); the quoted texts."""
    quoted: dict[str, list[tuple[int, int]]] = {}
    texts: set[str] = set()
    out = [
        "Third-party code inside the Open-Source PyMOL build",
        "====================================================",
        "",
        "The in-browser PyMOL (pymol-open-source commit edcda80f3a73ebf0b5922991f85910d17ffbcce5,",
        "built by the pymol-wasm/ build scripts) contains the following code that is not Schrodinger's,",
        "each under its own terms: compiled into the wasm, or shipped as Python source in the",
        "wheel. Each notice below is copied verbatim from the PyMOL source tree (or, where",
        "marked, from the upstream project it names; pymol-wasm/notices/README.md says from where).",
        "Generated by pymol-wasm/third_party_notices.py.",
        "",
    ]
    for name, lic, covers, parts in ENTRIES:
        out += ["-" * 78, name, f"Licence: {lic}", f"In: {covers}", ""]
        for how, rel, *marker in parts:
            if how == "here":
                body = (HERE / rel).read_text(encoding="utf-8")
                out.append(f"[upstream licence text: {rel.removeprefix('notices/')}]")
            else:
                if _not_shipped(rel):
                    # A notice for a file the wheel no longer holds would list code it does not carry.
                    raise ValueError(f"{name}: quotes {rel}, which wheel.sh removes from the wheel")
                if rel in NOT_COMPILED:
                    raise ValueError(f"{name}: quotes {rel}, which the wasm build does not compile in (NOT_COMPILED)")
                text = (src / rel).read_text(encoding="utf-8", errors="strict")
                if how == "file":
                    body = text
                    quoted.setdefault(rel, []).append((1, max(1, len(_lines(text)))))
                else:
                    b = comment_with(rel, text, marker[0])
                    body = b.text
                    quoted.setdefault(rel, []).append((b.first, b.last))
                    texts.add(_same(b.text))
                out.append(f"[{rel}]")
            out += [body.rstrip("\n"), ""]
    return "\n".join(out).rstrip("\n") + "\n", quoted, texts


def _same(text: str) -> str:
    """A block's words, white space aside: how two copies of one notice compare."""
    return " ".join(text.split())


def uncovered(src: Path, quoted: dict[str, list[tuple[int, int]]], texts: set[str]) -> list[str]:
    """Notice-like lines no entry quotes and NOT_A_NOTICE does not explain: a notice this file would drop.

    A line is quoted when it sits in a block an entry quotes, or in a block
    with the same words as a quoted one (the GLUT notice four font files
    repeat). An unused NOT_A_NOTICE reason fails the run too, so the list
    cannot keep an excuse for a line that is gone, and so does a NOT_COMPILED
    exclusion that no longer holds or a WASM_FACES list the tree contradicts.
    """
    out: list[str] = not_compiled_problems(src) + faces_problems(src)
    used: set[tuple[str, str]] = set()
    for f in scanned_files(src):
        rel = f.relative_to(src).as_posix()
        if f.suffix in BINARY:
            continue
        try:
            text = f.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            text = f.read_text(encoding="latin-1")
        spans = list(quoted.get(rel, []))
        if f.suffix in C_LIKE or f.suffix == ".py":
            spans += [(b.first, b.last) for b in blocks_of(rel, text) if _same(b.text) in texts]
        excuses = [(key, s) for key in NOT_A_NOTICE if fnmatch(rel, key) for s, _ in NOT_A_NOTICE[key]]
        pattern = NOTICE_LINE if f.suffix in C_LIKE | SOURCE else DATA_NOTICE_LINE
        for k, line in enumerate(_lines(text), 1):
            if not pattern.search(line) or OWN_LINE.search(line):
                continue
            if any(a <= k <= b for a, b in spans):
                continue
            hit = next(((key, s) for key, s in excuses if s in line), None)
            if hit is not None:
                used.add(hit)
                continue
            out.append(f"{rel}:{k}: {line.strip()[:120]}")
    for key, reasons in NOT_A_NOTICE.items():
        for s, _ in reasons:
            if (key, s) not in used:
                out.append(f"{key}: NOT_A_NOTICE reason {s!r} matches no line (stale)")
    return out


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(
            "usage: python3 -I pymol-wasm/third_party_notices.py <pymol-open-source tree> <out file>", file=sys.stderr
        )
        return 2
    src = Path(argv[1])
    text, quoted, texts = build(src)
    missing = uncovered(src, quoted, texts)
    if missing:
        print(
            "third_party_notices: notice-like lines no entry covers (add an entry or a reason),"
            " or a reason that no longer holds:",
            file=sys.stderr,
        )
        for m in missing:
            print("  " + m, file=sys.stderr)
        return 1
    Path(argv[2]).write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
