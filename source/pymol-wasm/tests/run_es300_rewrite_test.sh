#!/usr/bin/env bash
# Builds and runs tests/es300_rewrite_test.cpp: patch 0013's hand-written
# GLSL ES 3.00 rewrite (layer0/ShaderEs300.h) against patch 0005's std::regex
# rewrite, on every shader string the build can hand to glShaderSource plus an
# adversarial corpus (design 2026-11-16-pymol-wasm-slim §3.4 S2-4, evidence
# §3.24).
#
#   usage: run_es300_rewrite_test.sh <patched-src-dir> <out-dir>
#
# <patched-src-dir>: the pymol-open-source tree with patches/ applied (0013
# included). <out-dir> is emptied and refilled: the generated ShaderText,
# the stubbed preprocessor build, the test binary, report.txt. An existing
# <out-dir> that is not empty and holds no earlier run's output is refused.
# Compiler: ${CXX:-g++}, standard C++17 only. When CXX is em++ (the build's
# authority: emscripten 5.0.3's libc++ std::regex is what 0005 shipped) the
# test is a NODERAWFS .js run by ${NODE:-node} (build.sh passes $EMSDK_NODE).
# The native g++ run uses libstdc++'s std::regex as the reference instead.
#
# Exit 0 only when the test prints ES300_REWRITE_TEST PASS and exits 0; 1 on a
# failed test or check; 2 on a usage error.
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: run_es300_rewrite_test.sh <patched-src-dir> <out-dir>" >&2
  exit 2
fi
SRC=$(cd "$1" && pwd -P)
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
OUT=$2
case "$OUT" in ''|/) echo "run_es300_rewrite_test.sh: refusing out-dir '$OUT'" >&2; exit 2 ;; esac
CXX=${CXX:-g++}
TEST_CPP=$HERE/es300_rewrite_test.cpp
P0005=$HERE/../patches/0005-shadermgr-webgl2-glsl-es300.patch
for f in "$SRC/create_shadertext.py" "$SRC/data/shaders" "$SRC/layer0/ShaderPreprocessor.cpp" \
         "$SRC/layer0/ShaderPreprocessor.h" "$SRC/layer0/ShaderEs300.h" "$TEST_CPP" "$P0005"; do
  [ -e "$f" ] || { echo "run_es300_rewrite_test.sh: missing $f" >&2; exit 2; }
done
# Empty only a directory this script filled: an existing <out-dir> must be an
# empty directory or hold an earlier run's output (report.txt, or the marker
# written below, which a run that stopped before report.txt leaves too).
if [ -e "$OUT" ] || [ -L "$OUT" ]; then
  if [ ! -d "$OUT" ] || [ -L "$OUT" ]; then
    echo "run_es300_rewrite_test.sh: refusing out-dir '$OUT': not a directory" >&2; exit 2
  fi
  if [ -n "$(ls -A -- "$OUT")" ] && [ ! -e "$OUT/report.txt" ] && [ ! -e "$OUT/.es300_rewrite_test_out" ]; then
    echo "run_es300_rewrite_test.sh: refusing out-dir '$OUT': not empty and not an earlier run's output" >&2; exit 2
  fi
fi
rm -rf "$OUT"
mkdir -p "$OUT/generated" "$OUT/stubs"
: > "$OUT/.es300_rewrite_test_out"
OUT=$(cd "$OUT" && pwd -P)

# 1. The test's reference is 0005's text: its lines from `std::string s =` to
#    the last return must appear in the test file verbatim and in order.
python3 -I -B - "$P0005" "$TEST_CPP" <<'PY'
import sys
patch = open(sys.argv[1], encoding="utf-8").read().split("\n")
start = next(i for i, l in enumerate(patch) if l.startswith("+  std::string s = std::regex_replace(src"))
end = next(i for i in range(start, len(patch)) if patch[i] == '+  return "#version 300 es\\n" + s;')
block = "\n".join(l[1:] for l in patch[start:end + 1]) + "\n"
test = open(sys.argv[2], encoding="utf-8").read()
if test.count(block) != 1:
    sys.exit("es300_rewrite_test.cpp does not carry patch 0005's rewrite verbatim")
print(f"reference: patch 0005's {end - start + 1} lines found verbatim in the test")
PY

# 2. ShaderText.{h,cpp} exactly as compile.sh generates them (create_shadertext
#    only: its build-info half would run git).
python3 -I -B - "$SRC" "$OUT/generated" <<'PY'
import os, sys
src, gen = sys.argv[1], sys.argv[2]
sys.path.insert(0, src)
import create_shadertext
create_shadertext.create_shadertext(os.path.join(src, "data", "shaders"), gen,
    os.path.join(gen, "ShaderText.h"), os.path.join(gen, "ShaderText.cpp"))
PY

# 3. The real ShaderPreprocessor.{cpp,h} next to stubs of what it includes, so
#    its quoted includes find the stubs first.
cp "$SRC/layer0/ShaderPreprocessor.cpp" "$SRC/layer0/ShaderPreprocessor.h" "$OUT/stubs/"
cat > "$OUT/stubs/PyMOLGlobals.h" <<'H'
#pragma once
#include <cstdlib>
#define PATH_SEP "/"
struct CFeedback;
struct PyMOLGlobals {
  CFeedback* Feedback = nullptr;
};
H
cat > "$OUT/stubs/Feedback.h" <<'H'
#pragma once
#include "PyMOLGlobals.h"
#define FB_ShaderMgr 62
#define FB_Warnings 0x10
struct CFeedback {
  unsigned warnings = 0;
  void autoAdd(unsigned int, unsigned char, const char*) { ++warnings; }
};
H
cat > "$OUT/stubs/Setting.h" <<'H'
#pragma once
#include "PyMOLGlobals.h"
enum { cSetting_shaders_from_disk = 648 };
// shaders_from_disk is off: the preprocessor reads the embedded texts.
template <typename V> inline V SettingGet(PyMOLGlobals*, int) { return V(); }
H
cat > "$OUT/stubs/FileStream.h" <<'H'
#pragma once
#include <stdexcept>
#include <string>
namespace pymol {
inline std::string file_get_contents(const char*) { throw std::runtime_error("not used"); }
}
H

# 4. Build. Every TU sees the stubs first, then the patched tree.
INCS=(-I"$OUT/stubs" -I"$OUT/generated" -I"$SRC/layer0" -I"$SRC/include")
SRCS=("$TEST_CPP" "$OUT/stubs/ShaderPreprocessor.cpp" "$OUT/generated/ShaderText.cpp")
case "$(basename "$CXX")" in
  em++*)
    BIN=$OUT/es300_rewrite_test.js
    "$CXX" -std=c++17 -O2 "${INCS[@]}" "${SRCS[@]}" -o "$BIN" \
      -sNODERAWFS=1 -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2147483648 -sEXIT_RUNTIME=1 -sSTACK_SIZE=8388608
    RUN=("${NODE:-node}" "$BIN")
    ;;
  *)
    BIN=$OUT/es300_rewrite_test
    "$CXX" -std=c++17 -O2 "${INCS[@]}" "${SRCS[@]}" -o "$BIN"
    RUN=("$BIN")
    ;;
esac
echo "built $(basename "$BIN") with $CXX"

# 5. Run.
set +e
"${RUN[@]}" "$SRC/data/shaders" "$OUT" > "$OUT/report.txt" 2>&1
rc=$?
set -e
cat "$OUT/report.txt"
if [ "$rc" -ne 0 ] || ! grep -qx 'ES300_REWRITE_TEST PASS' "$OUT/report.txt"; then
  echo "run_es300_rewrite_test.sh: FAILED (exit $rc)" >&2
  exit 1
fi
