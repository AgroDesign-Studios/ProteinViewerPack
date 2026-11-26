#!/usr/bin/env bash
# Compile every PyMOL _cmd translation unit to a PIC wasm object (parallel).
#   usage: compile.sh <work-dir>          (JOBS=24 by default)
# Ported from TN0109 Appendix A compile.sh. Changes: paths are arguments; the
# numpy headers come from the Pyodide wasm wheel only ($NPINC, D13); build
# paths are mapped away ($PREFIX_MAP); object names never contain the work
# dir; and one failed translation unit fails the script (Appendix A only
# counted failures).
# S1-1 (design 2026-11-16-pymol-wasm-slim 3.2, evidence 3.1): every TU, and
# the numpy ABI probe that shares FLAGS, is compiled with -fvisibility=hidden
# -fvisibility-inlines-hidden, so with link.sh's SIDE_MODULE=2 only what the
# link exports leaves _cmd: 800,124 B smaller, 5,972 exported names down to
# 422, and the 615 self imports (weak C++ functions the loader bound to JS
# stubs) down to 0. Optimisation stays -O2 and the ABI flags are unchanged.
# _champ (wheel.sh) does not use these flags.
set -euo pipefail
# shellcheck source=env.sh
source "$(dirname "${BASH_SOURCE[0]}")/env.sh" "${1:?usage: compile.sh <work-dir>}"
: "${SOURCE_DATE_EPOCH:?compile.sh needs SOURCE_DATE_EPOCH (build.sh sets it)}"

rm -rf "$BLD/obj" "$BLD/generated"
mkdir -p "$BLD/obj" "$BLD/generated" "$BLD/logs"
cd "$SRC"
# Writes ShaderText.{h,cpp} and PyMOLBuildInfo.h; the latter takes its build
# date from SOURCE_DATE_EPOCH, which is why build.sh pins it.
python3 -I create_shadertext.py data/shaders "$BLD/generated" "$BLD/generated/ShaderText.h" "$BLD/generated/ShaderText.cpp" >/dev/null

DIRS="ov/src layer0 layer1 layer2 layer3 layer4 layer5 layerGraphics layerGraphics/gl"
INCS="-I$HERE/shim -Iinclude -I$BLD/generated -Icontrib/pocketfft -I$PYINC -I$NPINC -I$GLMINC"
for d in $DIRS; do INCS="$INCS -I$d"; done
DEFS="-D_PYMOL_LIBPNG -D_PYMOL_FREETYPE -D_PYMOL_NO_MAIN -D_PYMOL_NO_MSGPACKC -D_PYMOL_NUMPY -DPURE_OPENGL_ES_2 -DGL_GLEXT_PROTOTYPES"
FLAGS="$OPT -g0 -fPIC $ABI_FLAGS $PREFIX_MAP -sUSE_LIBPNG=1 -sUSE_FREETYPE=1 -sUSE_ZLIB=1 -std=c++17 -Werror=return-type -Wno-switch -Wno-narrowing -Wno-char-subscripts -Wno-deprecated-declarations -Wno-unused-command-line-argument -fvisibility=hidden -fvisibility-inlines-hidden"

# numpy ABI probe (TN0110 D13), compiled with the SAME include set as the TUs,
# so that a host numpy include dir landing anywhere in $INCS (an earlier build's bug) is
# caught here — not with a reduced -I$PYINC -I$NPINC that could not see it.
# -H prints the include tree; every numpy header must resolve under $NPINC.
probe_log="$BLD/logs/npy_abi_probe.txt"
if ! em++ $FLAGS $DEFS $INCS -fsyntax-only -H "$HERE/tests/npy_abi_probe.cpp" > "$probe_log" 2>&1; then
  cat "$probe_log"
  echo "compile.sh: numpy ABI probe failed (D13)" >&2
  exit 1
fi
n_np=$(grep -cE '/numpy/.*\.h$' "$probe_log" || true)
n_bad=$(grep -E '/numpy/.*\.h$' "$probe_log" | grep -cv "$NPINC/numpy/" || true)
if [ "$n_np" -eq 0 ] || [ "$n_bad" -ne 0 ]; then
  grep -E '/numpy/.*\.h$' "$probe_log" >&2 || true
  echo "compile.sh: numpy headers resolved outside $NPINC ($n_bad of $n_np) -- D13" >&2
  exit 1
fi
echo "numpy ABI probe: ok, $n_np numpy headers all under $NPINC"

shopt -s nullglob
: > "$BLD/srclist.txt"
for d in $DIRS; do
  for f in "$d"/*.cpp "$d"/*.c; do echo "$f" >> "$BLD/srclist.txt"; done
done
echo "$BLD/generated/ShaderText.cpp" >> "$BLD/srclist.txt"
shopt -u nullglob

export INCS DEFS FLAGS
compile_one() {
  local f=$1 rel o
  rel=${f#"$BLD"/}                          # generated/ShaderText.cpp, never the work dir
  o=$BLD/obj/${rel//\//__}.o
  if em++ $FLAGS $DEFS $INCS -c "$f" -o "$o" > "$BLD/logs/$(basename "$o").log" 2>&1; then
    echo "OK $f"
  else
    echo "FAIL $f"
  fi
}
export -f compile_one

t0=$(date +%s)
tr '\n' '\0' < "$BLD/srclist.txt" | xargs -0 -P "${JOBS:-24}" -n 1 bash -c 'compile_one "$1"' _ | sort > "$BLD/compile_result.txt"
t1=$(date +%s)
n_src=$(wc -l < "$BLD/srclist.txt")
n_ok=$(grep -c '^OK ' "$BLD/compile_result.txt" || true)
n_fail=$(grep -c '^FAIL ' "$BLD/compile_result.txt" || true)
echo "compile wall: $((t1 - t0)) s; TUs: $n_src; OK: $n_ok; FAIL: $n_fail"
if [ "$n_fail" -ne 0 ] || [ "$n_ok" -ne "$n_src" ]; then
  grep '^FAIL ' "$BLD/compile_result.txt" | while read -r _ f; do
    rel=${f#"$BLD"/}
    echo "--- $f"; tail -20 "$BLD/logs/${rel//\//__}.o.log"
  done
  echo "compile.sh: $n_fail of $n_src translation units failed" >&2
  exit 1
fi
