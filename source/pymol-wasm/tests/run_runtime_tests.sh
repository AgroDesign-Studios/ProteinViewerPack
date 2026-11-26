#!/usr/bin/env bash
# Run the five real-runtime tests and the build gates against a RUNTIME DIR
# (vendored or candidate), on the host, with node. No docker, no compiler.
#
#   usage: run_runtime_tests.sh <core-dir> <runtime-dir> <out-dir>
#
#   <core-dir>     an unpacked Pyodide core of the SAME version (supplies
#                  pyodide.mjs), e.g. fetch_pyodide_core.sh's <dest>/pyodide
#   <runtime-dir>  pyodide.js, pyodide.asm.mjs, pyodide.asm.wasm,
#                  python_stdlib.zip, pyodide-lock.json, worker.js, one
#                  pymol-*.whl and one numpy-*.whl
#   <out-dir>      created; receives core/ (merged core, symlinks), so/,
#                  reports/ (all JSON) and logs/
#
# Steps, all run even if an earlier one fails, each with its own exit status:
#   1-5  smoke_wheel.mjs, frame_gl_defaults.mjs, frame_guard_loads.mjs,
#        frame_load_formats.mjs, pt2891_frame_defences.mjs, each as
#        `node --import pymol-wasm/bench/lib/guard_preload.mjs <test> ...`
#        (host-shell guard); the frame tests get the runtime's own worker.js
#   6    tests_summary.py reports/ --require <the five>
#   7    check_side_modules.py on the wheel's _cmd and _champ, against the
#        runtime's own pyodide.asm.wasm / pyodide.asm.mjs (no self-import limit)
#   8    check_no_emjs.py on _cmd and _champ
# The merged core takes the five runtime files FROM THE RUNTIME DIR (what ships
# is what is tested), the rest from <core-dir>; a core whose version is not the
# runtime's (pyodide.asm.mjs API.version) is refused.
#
# Env: NODE (default node).
# exit: 0 every step passed | 1 a step failed (the final line names it) |
#       2 usage error or a runtime / core dir that is incomplete or mismatched
set -euo pipefail

if [ $# -ne 3 ]; then
  echo "usage: run_runtime_tests.sh <core-dir> <runtime-dir> <out-dir>" >&2
  exit 2
fi
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
PW=$(cd "$HERE/.." && pwd -P)
GUARD=$PW/bench/lib/guard_preload.mjs
NODE=${NODE:-node}
usage_die() { echo "run_runtime_tests: $*" >&2; exit 2; }

[ -d "$1" ] || usage_die "no core dir $1"
[ -d "$2" ] || usage_die "no runtime dir $2"
CORE=$(cd "$1" && pwd -P)
RT=$(cd "$2" && pwd -P)
REPO=$(cd "$PW/.." && pwd -P)
OUT=$(realpath -m -- "$3")   # resolved before anything is created
case "$OUT/" in
  "$REPO"/*|"$RT"/*|"$CORE"/*) usage_die "the out dir $OUT must be outside the repository, the runtime dir and the core dir" ;;
esac
mkdir -p "$OUT"
[ -f "$GUARD" ] || usage_die "missing $GUARD (the host guard every node run needs)"
RT_FILES=(pyodide.js pyodide.asm.mjs pyodide.asm.wasm python_stdlib.zip pyodide-lock.json)
for f in "${RT_FILES[@]}" worker.js; do
  [ -f "$RT/$f" ] || usage_die "runtime dir $RT has no $f"
done
[ -f "$CORE/pyodide.mjs" ] || usage_die "core dir $CORE has no pyodide.mjs"
one() {  # one <glob-pattern>: the single file in $RT matching it
  local hits=()
  shopt -s nullglob
  hits=("$RT"/$1)
  shopt -u nullglob
  [ "${#hits[@]}" -eq 1 ] || usage_die "runtime dir $RT has ${#hits[@]} files matching $1 (want 1)"
  printf '%s\n' "${hits[0]}"
}
WHL=$(one 'pymol-*.whl')
NUMPY=$(one 'numpy-*.whl')
WORKER=$RT/worker.js

# ---- versions: the core must be the runtime's Pyodide ---------------------------
api_version() {  # API.version="X" in a pyodide.asm.mjs, exactly once
  python3 -I - "$1" <<'PY'
import re, sys
hits = set(re.findall(r'API\.version\s*=\s*"([^"]+)"', open(sys.argv[1], encoding="utf-8").read()))
if len(hits) != 1:
    sys.exit(f"{sys.argv[1]}: {len(hits)} distinct API.version values")
print(hits.pop())
PY
}
RT_VER=$(api_version "$RT/pyodide.asm.mjs") || usage_die "cannot read the runtime's Pyodide version"
CORE_ASM_VER=$(api_version "$CORE/pyodide.asm.mjs") || usage_die "cannot read the core's Pyodide version"
CORE_PKG_VER=$(python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1]))["version"])' "$CORE/package.json") \
  || usage_die "cannot read $CORE/package.json version"
[ "$CORE_PKG_VER" = "$RT_VER" ] && [ "$CORE_ASM_VER" = "$RT_VER" ] \
  || usage_die "core is Pyodide $CORE_PKG_VER (package.json) / $CORE_ASM_VER (pyodide.asm.mjs), runtime is $RT_VER: refusing"
echo "run_runtime_tests: runtime $RT (Pyodide $RT_VER), core $CORE"

# ---- the merged core dir -------------------------------------------------------
M=$OUT/core
rm -rf "$M" "$OUT/so" "$OUT/reports" "$OUT/logs"
mkdir -p "$M" "$OUT/so" "$OUT/reports" "$OUT/logs"
for f in "$CORE"/*; do
  [ -f "$f" ] || continue
  ln -s "$f" "$M/$(basename "$f")"
done
for f in "${RT_FILES[@]}"; do
  rm -f "$M/$f"
  ln -s "$RT/$f" "$M/$f"
done
R=$OUT/reports
L=$OUT/logs

# ---- steps ---------------------------------------------------------------------
declare -a FAILED=()
step() {  # step [--show] <label> <command...>: run, log, record the verdict
  local show=0 label rc=0
  if [ "$1" = --show ]; then show=1; shift; fi
  label=$1
  shift
  "$@" > "$L/$label.txt" 2>&1 || rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "run_runtime_tests: $label PASS"
  else
    echo "run_runtime_tests: $label FAIL (exit $rc; log $L/$label.txt)"
    FAILED+=("$label")
  fi
  if [ "$show" = 1 ]; then
    sed 's/^/    | /' "$L/$label.txt"
  elif [ "$rc" -ne 0 ]; then
    tail -5 "$L/$label.txt" | sed 's/^/    | /'
  fi
}
step smoke_wheel "$NODE" --import "$GUARD" "$HERE/smoke_wheel.mjs" "$M" "$NUMPY" "$WHL" "$R/smoke_wheel.json"
for t in frame_gl_defaults frame_guard_loads frame_load_formats pt2891_frame_defences; do
  step "$t" "$NODE" --import "$GUARD" "$HERE/$t.mjs" "$M" "$NUMPY" "$WHL" "$WORKER" "$R/$t.json"
done
step --show tests_summary python3 -I -B "$HERE/tests_summary.py" "$R" \
  --require smoke_wheel,frame_gl_defaults,frame_guard_loads,frame_load_formats,pt2891_frame_defences

CMD_MEMBER=pymol/_cmd.cpython-314-wasm32-emscripten.so
CHAMP_MEMBER=chempy/champ/_champ.cpython-314-wasm32-emscripten.so
step --show side_modules python3 -I -B "$HERE/check_side_modules.py" --json "$R/side_modules.json" \
  --main-wasm "$RT/pyodide.asm.wasm" --main-js "$RT/pyodide.asm.mjs" "wheel:$WHL!$CMD_MEMBER" "wheel:$WHL!$CHAMP_MEMBER"

extract() {
  python3 -I - "$WHL" "$OUT/so" "$CMD_MEMBER" "$CHAMP_MEMBER" <<'PY'
import os, sys, zipfile
whl, out, *members = sys.argv[1:]
with zipfile.ZipFile(whl) as z:
    for m in members:
        with open(os.path.join(out, os.path.basename(m)), "wb") as fh:
            fh.write(z.read(m))
        print(f"extracted {m}")
PY
}
step extract_side_modules extract
step --show check_no_emjs python3 -I -B "$PW/check_no_emjs.py" --json "$R/check_no_emjs.json" \
  "$OUT/so/$(basename "$CMD_MEMBER")" "$OUT/so/$(basename "$CHAMP_MEMBER")"

TOTAL=9
if [ "${#FAILED[@]}" -eq 0 ]; then
  echo "run_runtime_tests: PASS ($TOTAL/$TOTAL steps; runtime $RT)"
  exit 0
fi
echo "run_runtime_tests: FAIL ($(( TOTAL - ${#FAILED[@]} ))/$TOTAL steps passed; failed: ${FAILED[*]}; runtime $RT)"
exit 1
