#!/usr/bin/env bash
# Link _cmd as a Pyodide-compatible SIDE_MODULE (unresolved GL/Python symbols
# import from pyodide.asm.wasm at dlopen).
#   usage: link.sh <work-dir>
# S1-1 (design 2026-11-16-pymol-wasm-slim 3.2, evidence 3.1): SIDE_MODULE=2
# exports only what -sEXPORTED_FUNCTIONS names, plus __wasm_call_ctors,
# __wasm_apply_data_relocs and the few functions the port libraries take the
# address of; with compile.sh's hidden visibility that is 422 exports instead
# of 5,972 and no self imports. -sEXPORTED_FUNCTIONS=_PyInit__cmd is required:
# without it the link still succeeds, into an empty module (46,061 B, 13
# functions), and `import pymol` then fails with "ImportError: dynamic module
# does not define module export function" (the smoke test and
# tests/check_side_modules.py's required exports catch that). -O2, the ABI
# flags, the byte-order object list and the two port libraries are unchanged.
# Ported from TN0109 Appendix A link.sh. Changes: paths are arguments, and the
# object list is sorted explicitly in byte order instead of trusting the
# locale's glob order (in an earlier build en_US.UTF-8 and C sorted obj/*.o differently and
# produced different modules from the same objects).
# Links the ports embuilder built (PIC + wasm sjlj) and never asks emcc for
# the ports themselves, which would pull in the wrong variants (TN0110 §7-5).
set -euo pipefail
# shellcheck source=env.sh
source "$(dirname "${BASH_SOURCE[0]}")/env.sh" "${1:?usage: link.sh <work-dir>}"

cd "$BLD"
PICLIB=$W/emsdk/upstream/emscripten/cache/sysroot/lib/wasm32-emscripten/pic
OUT=$BLD/_cmd.cpython-314-wasm32-emscripten.so
mapfile -t OBJS < <(find obj -maxdepth 1 -name '*.o' -type f | sort)
[ "${#OBJS[@]}" -gt 0 ] || { echo "link.sh: no objects under $BLD/obj" >&2; exit 1; }
t0=$(date +%s)
em++ $OPT -g0 $ABI_FLAGS -sSIDE_MODULE=2 -sEXPORTED_FUNCTIONS=_PyInit__cmd \
  "${OBJS[@]}" "$PICLIB/libpng-legacysjlj.a" "$PICLIB/libfreetype-legacysjlj.a" -o "$OUT" 2>&1 | tee "$BLD/logs/link.log" | tail -20
t1=$(date +%s)
echo "link wall: $((t1 - t0)) s; objects: ${#OBJS[@]}; size: $(stat -c %s "$OUT") bytes"
