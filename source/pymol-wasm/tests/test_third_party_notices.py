"""Unit tests for third_party_notices.py's comment scanner and coverage check (stdlib only).

    python3 -I -B tests/test_third_party_notices.py

The scanner decides which notices the shipped NOTICES file quotes and which
notice-like lines fail the run (PT-9275 item 8, PT-9276 item 2, PT-9264 item
4). These cases pin the places a notice could slip past it: a comment marker
inside a string, a // run before a /* */ block, a third-party line in a file
another entry already quotes, a lower-case or symbol-only notice, and an
excuse whose line is gone. The S1 drop list (s1_drop.json, which wheel.sh
applies and this scan reads) must keep the scan equal to the wheel: dropped
files are not scanned, no entry quotes one, and wheel.sh applies the list
between copying and writing.
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import make_wheel  # noqa: E402
import third_party_notices as tpn  # noqa: E402


class CBlocks(unittest.TestCase):
    def test_comment_markers_inside_literals_open_nothing(self):
        src = 'const char *s = "/* not a comment";\nchar c = \'/\';\n// real\n'
        blocks = tpn.c_blocks(src)
        self.assertEqual([b.text for b in blocks], ["// real"])

    def test_slash_run_and_block_in_file_order(self):
        src = "// Copyright 2001 A\n// line two\nint x;\n/* Copyright 2002 B */\n"
        blocks = tpn.c_blocks(src)
        self.assertEqual([(b.first, b.last) for b in blocks], [(1, 2), (4, 4)])
        # The earlier // run wins over the later /* */ block that also holds the marker.
        self.assertEqual(tpn.comment_with("a.cpp", src, "Copyright").first, 1)

    def test_trailing_comment_is_its_own_block(self):
        src = "x = 1; // Copyright 2003 C\n// unrelated\n"
        blocks = tpn.c_blocks(src)
        self.assertEqual([b.text for b in blocks], ["// Copyright 2003 C", "// unrelated"])

    def test_unterminated_comment_raises(self):
        with self.assertRaises(ValueError):
            tpn.c_blocks("/* open")


class PyBlocks(unittest.TestCase):
    def test_docstrings_and_comment_runs(self):
        src = "'''\n(c) 2011 Someone\nLicense: BSD-2-Clause\n'''\n# one\n# two\nx = 'License: not a block'\n"
        blocks = tpn.py_blocks(src)
        self.assertEqual([(b.first, b.last) for b in blocks], [(1, 4), (5, 6)])


class Patterns(unittest.TestCase):
    def test_case_and_symbols(self):
        for line in ("COPYRIGHT 1999", "License: MIT", "© 2020 X", "SPDX-License-Identifier: MIT",
                     "see stackoverflow.com/q/1", "public domain", "Author: Someone", "taken from libfoo",
                     "based on https://example.org/x", "code based on", "based on Mesa code"):
            self.assertTrue(tpn.NOTICE_LINE.search(line), line)

    def test_everyday_based_on_is_not_a_notice(self):
        for line in ("setting based on unique_id", "match based on rank"):
            self.assertIsNone(tpn.NOTICE_LINE.search(line), line)

    def test_block_that_reads_as_no_notice_is_refused(self):
        with self.assertRaises(ValueError):
            tpn.comment_with("a.c", "/* marker only */\n", "marker")


class SyntheticTree(unittest.TestCase):
    """A scratch source tree with the scan narrowed to its src/ folder (no tests of its own)."""

    def setUp(self):
        self.saved = {
            k: getattr(tpn, k)
            for k in (
                "ENTRIES", "COMPILED_DIRS", "SHIPPED_DIRS", "SHIPPED_FILES", "NOT_SHIPPED",
                "S1_DROPPED", "NOT_A_NOTICE",
                "NOT_COMPILED", "WASM_FACES", "FACES_FILE",
            )
        }
        tpn.COMPILED_DIRS = ("src",)
        tpn.SHIPPED_DIRS = ()
        tpn.SHIPPED_FILES = ()
        tpn.S1_DROPPED = frozenset()
        tpn.NOT_A_NOTICE = {}
        tpn.NOT_COMPILED = {}
        tpn.FACES_FILE = None
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "src").mkdir()

    def tearDown(self):
        for k, v in self.saved.items():
            setattr(tpn, k, v)
        self.tmp.cleanup()

    def run_scan(self):
        text, quoted, texts = tpn.build(self.root)
        return text, tpn.uncovered(self.root, quoted, texts)


class Coverage(SyntheticTree):
    def test_a_second_notice_in_a_quoted_file_is_still_found(self):
        (self.root / "src/a.cpp").write_text("/* Copyright 2001 Alpha */\nint x;\n/* adapted from Beta's code */\n")
        tpn.ENTRIES = [("Alpha", "MIT", "src/a.cpp", [("block", "src/a.cpp", "Alpha")])]
        text, missing = self.run_scan()
        self.assertIn("Copyright 2001 Alpha", text)
        self.assertEqual(len(missing), 1)
        self.assertIn("src/a.cpp:3", missing[0])

    def test_same_words_elsewhere_count_as_quoted(self):
        notice = "/* Copyright (c) Gamma, 1994.\n * freely distributable */\n"
        (self.root / "src/a.cpp").write_text(notice)
        (self.root / "src/b.cpp").write_text("int y;\n" + notice.replace("\n *", "\n   *"))
        tpn.ENTRIES = [("Gamma", "X", "src/*.cpp", [("block", "src/a.cpp", "Gamma")])]
        self.assertEqual(self.run_scan()[1], [])

    def test_stale_excuse_fails(self):
        (self.root / "src/a.cpp").write_text("int x;\n")
        tpn.ENTRIES = []
        tpn.NOT_A_NOTICE = {"src/a.cpp": [("gone line", "why")]}
        missing = self.run_scan()[1]
        self.assertEqual(len(missing), 1)
        self.assertIn("stale", missing[0])

    def test_lines_are_numbered_as_the_blocks_number_them(self):
        # PT-9303 item 1: a form feed inside a quoted block made splitlines()
        # count one line more than c_blocks, so the uncovered notice was
        # reported one line late and the span could cover the wrong line.
        (self.root / "src/a.cpp").write_text("/* Copyright 2001 Alpha\x0c more */\nint x;\n/* adapted from Beta's code */\n")
        tpn.ENTRIES = [("Alpha", "MIT", "src/a.cpp", [("block", "src/a.cpp", "Alpha")])]
        missing = self.run_scan()[1]
        self.assertEqual(len(missing), 1)
        self.assertTrue(missing[0].startswith("src/a.cpp:3: "), missing[0])

    def test_a_whole_file_span_ends_on_its_last_line(self):
        (self.root / "src/LICENSE.md").write_text("Copyright 2001 Alpha\x0bstill line one\nline two\n")
        tpn.ENTRIES = [("Alpha", "MIT", "src/LICENSE.md", [("file", "src/LICENSE.md")])]
        quoted = tpn.build(self.root)[1]
        self.assertEqual(quoted["src/LICENSE.md"], [(1, 2)])

    def test_glob_excuse(self):
        (self.root / "src/x1.h").write_text("/* and is in the public domain */\n")
        (self.root / "src/x2.h").write_text("/* and is in the public domain. */\n")
        tpn.ENTRIES = []
        tpn.NOT_A_NOTICE = {"src/x*.h": [("and is in the public domain", "repeated statement")]}
        self.assertEqual(self.run_scan()[1], [])

    def test_a_folder_wheel_sh_removes_is_not_scanned(self):
        # PT-9285 item 1: wheel.sh copies data/chempy and then removes its
        # tinker folder; the scan must follow the wheel, not the copied folder,
        # while the folder's siblings (and a name that only starts the same)
        # are still read.
        (self.root / "data/chempy/tinker").mkdir(parents=True)
        (self.root / "data/chempy/tinker/chempy.prm").write_text("# Copyright 1999 Removed\n")
        (self.root / "data/chempy/tinkerish.py").write_text("# Copyright 2000 Kept\n")
        (self.root / "data/chempy/fragments.py").write_text("x = 1\n")
        tpn.ENTRIES = []
        tpn.SHIPPED_DIRS = ("data/chempy",)
        tpn.NOT_SHIPPED = ("data/chempy/tinker",)
        scanned = [f.relative_to(self.root).as_posix() for f in tpn.scanned_files(self.root)]
        self.assertEqual(scanned, ["data/chempy/fragments.py", "data/chempy/tinkerish.py"])
        missing = self.run_scan()[1]
        self.assertEqual(len(missing), 1)
        self.assertTrue(missing[0].startswith("data/chempy/tinkerish.py:1: "), missing[0])

    def test_wheel_sh_removes_every_not_shipped_folder(self):
        # The two lists must not drift: a folder named here but still copied
        # into the wheel would ship without its notice.
        wheel_sh = (Path(tpn.HERE) / "wheel.sh").read_text(encoding="utf-8")
        for d in self.saved["NOT_SHIPPED"]:
            rel = d.removeprefix("data/")
            self.assertIn(f'rm -rf "$ST/pymol/pymol_path/data/{rel}"', wheel_sh, d)

    def test_a_file_the_s1_list_drops_is_not_scanned(self):
        # S1-7 / S1-8: wheel.sh copies whole folders and files, then removes the
        # members s1_drop.json lists; the scan must follow the wheel, file by file,
        # for a copied folder and for a single copied file alike.
        (self.root / "modules/pymol").mkdir(parents=True)
        (self.root / "data").mkdir()
        (self.root / "modules/pymol/dropped.py").write_text("# Copyright 2001 Dropped\n")
        (self.root / "modules/pymol/kept.py").write_text("# Copyright 2002 Kept\n")
        (self.root / "data/setting_help.csv").write_text("x, Copyright 2003 Dropped\n")
        (self.root / "data/top100.cif").write_text("x\n")
        tpn.ENTRIES = []
        tpn.SHIPPED_DIRS = ("modules/pymol",)
        tpn.SHIPPED_FILES = ("data/setting_help.csv", "data/top100.cif")
        tpn.S1_DROPPED = frozenset({"modules/pymol/dropped.py", "data/setting_help.csv"})
        scanned = [f.relative_to(self.root).as_posix() for f in tpn.scanned_files(self.root)]
        self.assertEqual(scanned, ["modules/pymol/kept.py", "data/top100.cif"])
        missing = self.run_scan()[1]
        self.assertEqual(len(missing), 1)
        self.assertTrue(missing[0].startswith("modules/pymol/kept.py:1: "), missing[0])

    def test_an_entry_that_quotes_a_dropped_file_fails(self):
        # The notices must not list code the wheel no longer carries.
        (self.root / "modules/pymol").mkdir(parents=True)
        (self.root / "modules/pymol/gone.py").write_text("# (c) 2011 Someone\n# License: BSD-2-Clause\n")
        tpn.SHIPPED_DIRS = ("modules/pymol",)
        tpn.S1_DROPPED = frozenset({"modules/pymol/gone.py"})
        tpn.ENTRIES = [("Gone", "BSD-2-Clause", "pymol/gone.py", [("block", "modules/pymol/gone.py", "Someone")])]
        with self.assertRaises(ValueError):
            tpn.build(self.root)


class WasmLines(unittest.TestCase):
    """The preprocessor reading behind NOT_COMPILED and WASM_FACES: which lines emcc may compile."""

    def kept(self, src):
        return [line.strip() for _, line in tpn.wasm_lines(src) if line.strip()]

    def test_guard_forms(self):
        src = (
            "#ifndef __EMSCRIPTEN__\nA\n#else\nB\n#endif\n"
            "#if !defined(__EMSCRIPTEN__)\nC\n#endif\n"
            "#if ! defined __EMSCRIPTEN__\nC2\n#endif\n"
            "#ifdef __EMSCRIPTEN__\nD\n#else\nE\n#endif\n"
            "#if defined(__EMSCRIPTEN__)\nF\n#elif X\nG\n#else\nH\n#endif\n"
            "#ifndef __EMSCRIPTEN__\nI\n#elif X\nJ\n#endif\n"
        )
        self.assertEqual(self.kept(src), ["B", "D", "F", "J"])

    def test_other_and_mixed_conditions_count_as_compiled(self):
        # Fail closed: a guard this reading cannot decide is treated as compiled.
        src = "#if !defined(__EMSCRIPTEN__) && X\nA\n#endif\n#ifdef _WEBGL\nB\n#else\nC\n#endif\n#if 0\nD\n#endif\n"
        self.assertEqual(self.kept(src), ["A", "B", "C", "D"])

    def test_nesting(self):
        src = "#ifdef FOO\n#ifndef __EMSCRIPTEN__\n#ifdef BAR\nA\n#endif\nB\n#endif\nC\n#endif\n"
        self.assertEqual(self.kept(src), ["C"])

    def test_directives_in_comments_and_strings_are_not_read(self):
        src = (
            '/* #ifndef __EMSCRIPTEN__ */\nA\n// #endif\n'
            'const char *s = "#ifndef __EMSCRIPTEN__";\n/*\n#ifndef __EMSCRIPTEN__\n*/\nB\n'
        )
        self.assertEqual(self.kept(src), ["A", 'const char *s = "#ifndef __EMSCRIPTEN__";', "B"])

    def test_unbalanced_raises(self):
        for src in ("#ifndef __EMSCRIPTEN__\nA\n", "A\n#endif\n", "#else\n"):
            with self.assertRaises(ValueError, msg=src):
                tpn.wasm_lines(src)


class NotCompiled(SyntheticTree):
    """NOT_COMPILED: a header in a compiled folder the wasm build compiles out is not scanned, while that holds."""

    GENTIUM = "/* Copyright (c) 2005, Font Makers. Licensed under the Font Licence. */\nstatic unsigned char TTF_Gen_dat[] = {0};\n"

    def setUp(self):
        super().setUp()
        (self.root / "src/Gen.h").write_text(self.GENTIUM)
        tpn.ENTRIES = []
        tpn.NOT_COMPILED = {"src/Gen.h": ("src/Text.cpp", "a face the wasm build does not register")}

    def text_cpp(self, body):
        (self.root / "src/Text.cpp").write_text('#include "Other.h"\n' + body + "int x;\n")

    def test_positive_guarded_header_is_not_scanned(self):
        self.text_cpp('#ifndef __EMSCRIPTEN__\n#include "Gen.h"\n#endif\n')
        scanned = [f.relative_to(self.root).as_posix() for f in tpn.scanned_files(self.root)]
        self.assertEqual(scanned, ["src/Text.cpp"])
        self.assertEqual(self.run_scan()[1], [])

    def test_positive_else_branch_of_ifdef(self):
        self.text_cpp('#ifdef __EMSCRIPTEN__\n#include "Sans.h"\n#else\n#include "Gen.h"\n#endif\n')
        self.assertEqual(self.run_scan()[1], [])

    def test_control_without_the_exclusion_the_notice_is_uncovered(self):
        # What the exclusion is for: with it gone, the header's notice lines fail the run.
        self.text_cpp('#ifndef __EMSCRIPTEN__\n#include "Gen.h"\n#endif\n')
        tpn.NOT_COMPILED = {}
        missing = self.run_scan()[1]
        self.assertTrue(missing and all(m.startswith("src/Gen.h:1: ") for m in missing), missing)

    def test_stale_unguarded_include_fails(self):
        # The patch that compiles the header out is gone: Text.cpp includes it for emcc too.
        self.text_cpp('#include "Gen.h"\n')
        missing = self.run_scan()[1]
        self.assertEqual(len(missing), 1, missing)
        self.assertTrue(missing[0].startswith("src/Text.cpp:2: includes src/Gen.h"), missing[0])
        self.assertIn("stale", missing[0])

    def test_stale_commented_guard_fails(self):
        self.text_cpp('/* #ifndef __EMSCRIPTEN__ */\n#include "Gen.h"\n// #endif\n')
        missing = self.run_scan()[1]
        self.assertEqual(len(missing), 1, missing)
        self.assertIn("src/Text.cpp:3: includes src/Gen.h", missing[0])

    def test_stale_mixed_guard_fails_closed(self):
        self.text_cpp('#if !defined(__EMSCRIPTEN__) || defined(FOO)\n#include "Gen.h"\n#endif\n')
        self.assertEqual(len(self.run_scan()[1]), 1)

    def test_stale_include_in_an_elif_after_the_guard_fails(self):
        self.text_cpp('#ifndef __EMSCRIPTEN__\n#include "Sans.h"\n#elif FOO\n#include "Gen.h"\n#endif\n')
        self.assertEqual(len(self.run_scan()[1]), 1)

    def test_stale_second_includer_fails(self):
        # Guarded in the named includer, compiled in through another file.
        self.text_cpp('#ifndef __EMSCRIPTEN__\n#include "Gen.h"\n#endif\n')
        (self.root / "src/Other.cpp").write_text('#include <sub/Gen.h>\n')
        missing = self.run_scan()[1]
        self.assertEqual(len(missing), 1, missing)
        self.assertTrue(missing[0].startswith("src/Other.cpp:1: includes src/Gen.h"), missing[0])

    def test_stale_includer_no_longer_includes_it(self):
        self.text_cpp("")
        missing = self.run_scan()[1]
        self.assertEqual(len(missing), 1, missing)
        self.assertIn("src/Text.cpp includes it, and no line there does (stale)", missing[0])

    def test_stale_file_gone(self):
        self.text_cpp('#ifndef __EMSCRIPTEN__\n#include "Gen.h"\n#endif\n')
        (self.root / "src/Gen.h").unlink()
        missing = self.run_scan()[1]
        self.assertEqual(len(missing), 1, missing)
        self.assertIn("src/Gen.h: NOT_COMPILED names a file the tree does not have (stale)", missing[0])

    def test_a_source_file_cannot_be_excluded(self):
        (self.root / "src/Gen.cpp").write_text("int g;\n")
        self.text_cpp('#ifndef __EMSCRIPTEN__\n#include "Gen.h"\n#endif\n')
        tpn.NOT_COMPILED["src/Gen.cpp"] = ("src/Text.cpp", "why")
        missing = self.run_scan()[1]
        self.assertTrue(any("NOT_COMPILED holds a source file" in m for m in missing), missing)

    def test_an_entry_that_quotes_an_excluded_header_fails(self):
        self.text_cpp('#ifndef __EMSCRIPTEN__\n#include "Gen.h"\n#endif\n')
        tpn.ENTRIES = [("Gen", "Font Licence", "src/Gen.h", [("block", "src/Gen.h", "Font Makers")])]
        with self.assertRaises(ValueError):
            tpn.build(self.root)


class WasmFaces(SyntheticTree):
    """WASM_FACES: the faces the DejaVu entry names are the ones the wasm build references."""

    def setUp(self):
        super().setUp()
        tpn.ENTRIES = []
        tpn.FACES_FILE = "src/Text.cpp"
        tpn.WASM_FACES = ("Sans", "Sans_Bold")
        self.body = (
            "#ifdef FREETYPE\n#if !defined(_WEBGL) || defined(X)\n  add(5, TTF_Sans_dat, TTF_Sans_len);\n#endif\n"
            "  add(7, TTF_Sans_Bold_dat, TTF_Sans_Bold_len);\n#ifndef __EMSCRIPTEN__\n  add(9, TTF_Serif_dat, TTF_Serif_len);\n#endif\n#endif\n"
        )

    def test_positive_faces_match(self):
        (self.root / "src/Text.cpp").write_text(self.body)
        self.assertEqual(tpn.wasm_faces(self.root), ["Sans", "Sans_Bold"])
        self.assertEqual(self.run_scan()[1], [])

    def test_stale_guard_dropped_links_more_faces(self):
        (self.root / "src/Text.cpp").write_text(self.body.replace("#ifndef __EMSCRIPTEN__\n", "#ifndef OTHER\n"))
        missing = self.run_scan()[1]
        self.assertEqual(len(missing), 1, missing)
        self.assertIn("links the faces ['Sans', 'Sans_Bold', 'Serif']", missing[0])

    def test_stale_face_removed(self):
        (self.root / "src/Text.cpp").write_text(self.body.replace("TTF_Sans_Bold_dat", "nullptr"))
        self.assertEqual(len(self.run_scan()[1]), 1)

    def test_missing_faces_file_fails(self):
        self.assertEqual(len(self.run_scan()[1]), 1)


class RealExclusions(unittest.TestCase):
    """The real NOT_COMPILED / WASM_FACES / ENTRIES and patch 0012 (no source tree needed)."""

    PATCH = Path(tpn.HERE) / "patches" / "0012-text-sans-four-fonts-fallback.patch"

    def test_gentium_is_excluded_not_quoted(self):
        self.assertEqual(tpn.NOT_COMPILED["layer1/FontTTF2.h"][0], "layer1/Text.cpp")
        quoted = {part[1] for _, _, _, parts in tpn.ENTRIES for part in parts if part[0] != "here"}
        self.assertEqual(sorted(quoted & set(tpn.NOT_COMPILED)), [])
        self.assertFalse([e[0] for e in tpn.ENTRIES if "Gentium" in " ".join(map(str, e))])

    def test_every_exclusion_lies_in_a_compiled_folder(self):
        # Otherwise the scan would not read it and the exclusion would excuse nothing.
        for rel in tpn.NOT_COMPILED:
            self.assertTrue(any(rel.startswith(d + "/") for d in tpn.COMPILED_DIRS), rel)

    def test_dejavu_entry_names_the_linked_faces(self):
        (dejavu,) = [e for e in tpn.ENTRIES if e[0].startswith("DejaVu")]
        for face in tpn.WASM_FACES:
            self.assertIn(face.replace("_", "-"), dejavu[2])
        self.assertEqual(sorted(tpn.WASM_FACES), ["DejaVuSans", "DejaVuSans_Bold", "DejaVuSans_BoldOblique", "DejaVuSans_Oblique"])

    def test_patch_0012_compiles_the_gentium_header_out(self):
        # The new side of the hunk that touches the include, read as the run reads Text.cpp.
        hunks = self.PATCH.read_text(encoding="utf-8").split("\n@@")
        (hunk,) = [h for h in hunks if '#include "FontTTF2.h"' in h]
        new_side = [line[1:] for line in hunk.split("\n")[1:] if line[:1] in (" ", "+")]
        lines = tpn.wasm_lines("\n".join(new_side) + "\n")
        self.assertFalse([line for _, line in lines if "FontTTF2.h" in line])
        self.assertTrue([line for _, line in lines if "FontTTF.h" in line])


class S1DropList(unittest.TestCase):
    """The real s1_drop.json, the scan's view of it, and wheel.sh's use of it (no source tree needed)."""

    def test_counts_match_make_wheel(self):
        spec = json.loads(tpn.S1_DROP_LIST.read_text(encoding="utf-8"))
        self.assertEqual({g: len(spec[g]) for g in make_wheel.S1_DROP_COUNTS}, make_wheel.S1_DROP_COUNTS)
        self.assertEqual(len(tpn.S1_DROPPED), sum(make_wheel.S1_DROP_COUNTS.values()))

    def test_every_dropped_member_lies_in_what_wheel_sh_copies(self):
        # Otherwise a name could point outside the scan and drop nothing from it.
        outside = sorted(rel for rel in tpn.S1_DROPPED if not tpn._shipped_source(rel))
        self.assertEqual(outside, [])

    def test_no_entry_quotes_a_dropped_file(self):
        quoted = {part[1] for _, _, _, parts in tpn.ENTRIES for part in parts if part[0] != "here"}
        self.assertEqual(sorted(quoted & tpn.S1_DROPPED), [])

    def test_source_path(self):
        self.assertEqual(tpn.source_path("pymol/pymol_path/data/shaders/bg.fs"), "data/shaders/bg.fs")
        self.assertEqual(tpn.source_path("pymol/plugins/__init__.py"), "modules/pymol/plugins/__init__.py")
        self.assertEqual(tpn.source_path("chempy/tinker/amber.py"), "modules/chempy/tinker/amber.py")
        for bad in ("pymol/pymol_path/LICENSE", "numpy/x.py", "pymol"):
            with self.assertRaises(ValueError):
                tpn.source_path(bad)

    def test_wheel_sh_drops_after_copying_and_before_writing(self):
        lines = (Path(tpn.HERE) / "wheel.sh").read_text(encoding="utf-8").splitlines()
        drop = [k for k, line in enumerate(lines) if line.strip() == 'python3 -I "$HERE/make_wheel.py" --drop "$ST" "$HERE/s1_drop.json"']
        write = [k for k, line in enumerate(lines) if line.strip().startswith('python3 -I "$HERE/make_wheel.py" "$ST"')]
        copy = [k for k, line in enumerate(lines) if line.strip().startswith("cp ") and "$ST" in line]
        self.assertEqual(len(drop), 1, "wheel.sh must run the S1 drop exactly once")
        self.assertEqual(len(write), 1)
        self.assertTrue(copy and max(copy) < drop[0] < write[0], (copy, drop, write))


class PublicText(unittest.TestCase):
    """The text the generators write ships in the public NOTICE files."""

    CC_BY_SA_3 = "https://creativecommons.org/licenses/by-sa/3.0/"
    INTERNAL_ID = __import__("re").compile(r"\bPT-\d+|\bTN\d{4}\b|\bAgDB\b|relay step")

    def _entry(self, name_start):
        hits = [e for e in tpn.ENTRIES if e[0].startswith(name_start)]
        self.assertEqual(len(hits), 1, name_start)
        return hits[0]

    def test_base64_entry_gives_the_licence_uri_and_covers_patch_0011(self):
        # CC BY-SA 3.0 section 4(a) wants the licence's URI with the work; patch
        # 0011 changes base64_decode, so the entry says the change keeps those terms.
        _, lic, covers, _ = self._entry("base64 decoding table")
        self.assertIn("CC BY-SA 3.0 (" + self.CC_BY_SA_3 + ")", lic)
        self.assertIn("0011-mypng-failed-read-builds-no-image.patch", lic)
        self.assertIn("base64_decode", lic)
        self.assertIn("same terms", lic)
        self.assertIn("base64_decoding_table", covers)

    def test_no_internal_ids_in_written_text(self):
        import runtime_notices
        for name, lic, covers, _ in tpn.ENTRIES:
            for text in (name, lic, covers):
                self.assertIsNone(self.INTERNAL_ID.search(text), text)
        for row in runtime_notices.INPUTS:
            for text in row[:3]:
                self.assertIsNone(self.INTERNAL_ID.search(text), text)


if __name__ == "__main__":
    unittest.main()
