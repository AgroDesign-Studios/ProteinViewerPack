#!/usr/bin/env bash
# Pinned, reproducible build of Open-Source PyMOL for the browser: a Pyodide
# 314.0.7 side-module wheel (ADR-0049; TN0110 §4.3, D13).
#
#   usage: build.sh <work-dir> <out-dir>
#
# Runs inside the builder image (Dockerfile), normally through
# build-in-docker.sh. <work-dir> must be empty and should be a tmpfs: emsdk,
# the Pyodide cross-build env, the sources and every object land there.
# <out-dir> receives
#   dist/            what the vendoring step ships: the PyMOL wheel (with the
#                    boot modules' .pyc in __pycache__), the numpy wasm wheel
#                    less the members no run reads (numpy_trim.py, S2-2 (3); same
#                    file name) and the unpacked Pyodide core whose
#                    python_stdlib.zip carries the boot modules as sourceless
#                    .pyc (S1-11)
#   build/           the two side modules on their own, for comparing builds
#   MANIFEST.sha256  sha256sum of dist/ and build/, byte-sorted
#   reports/         test output, check_no_emjs / side-module / .pyc JSON, the
#                    wheel smoke report, compile results, build-info.txt
#
# It stops (non-zero) on: an input or download whose sha256 / commit is not the
# pinned one, or an INPUTS.sha256 that does not list exactly patches/*.patch,
# shim/*.h and the top-level inputs of step 0; a failing unpickler or checker
# test; the numpy ABI probe; a failed translation unit; an EM_JS / EM_ASM /
# run_script marker in a side module; a checker that misses its positive
# control; a side-module import no loader source provides, any self import, or
# a missing PyInit_* / __wasm_call_ctors / __wasm_apply_data_relocs export; a
# side-module gate that passes a tampered copy; a .pyc stage that cannot compile
# or assemble the targets of pyc_targets.json, or whose .pyc fail check_pyc.py
# (exactly the targets, the runtime's magic, unchecked hash, source hash,
# sourceless stdlib, chempy/pkl.py source only); a wheel that fails its Pyodide
# smoke test on the final core, or whose smoke report has a false or missing
# verdict; an S1 / S2 probe (tests/utf8_probe, bg_image_probe, interrupt_probe,
# pickle_identity, cmyk_table, font_fallback_probe, bundled_pkl_probe,
# numpy_import_probe) that fails or whose report is not all true; a numpy
# wheel or drop list numpy_trim.py refuses; the third-party notices of the
# patched tree failing to generate (an uncovered notice, a stale NOT_COMPILED
# file, linked fonts other than the four Sans faces); the GLSL ES 3.00 rewrite
# test (patch 0013 vs patch 0005's regex) finding a difference; and,
# unless VERIFY_MANIFEST=0, an output that differs from the committed
# MANIFEST.sha256.
#
# Ported from TN0109 Appendix A build.sh: the job paths are arguments, every
# fetched input is checked against a pin below, and an earlier build's reproducibility
# leaks are closed (SOURCE_DATE_EPOCH, byte-order link, -ffile-prefix-map,
# a deterministic zip). Network is used here only, never at run time.
set -euo pipefail

# ---- pins (bumping any of these is README.md § Bumping a version) ----------
PYODIDE_VER=314.0.7            # Python 3.14.2, emscripten 5.0.3, ABI 2026_0
PYODIDE_BUILD_VER=0.39.1       # installed by the Dockerfile; checked here
EMSDK_VER=5.0.3                # exactly what Pyodide 314.0.7's Makefile.envs asks for (TN0110 §7-4)
EMSDK_COMMIT=a620cf1d71c62dfdfbb0c01fe0a371e2af2dda6c          # emsdk tag 5.0.3
EMSCRIPTEN_RELEASE=065bfade0ee2c02138b83cb10049d8be95e146b6    # what tag 5.0.3 resolves 5.0.3 to
EMCC_COMMIT=285c424dfa9e83b03cf8490c65ceadb7c45f28eb           # the commit emcc --version prints
XBUILDENV_PYINC_TREE_SHA256=6f25dbcbfe236d026fbd612b89bb34f88db727c17d4e9739d8d3b7568846fc05
PYMOL_REPO=https://github.com/schrodinger/pymol-open-source
PYMOL_COMMIT=edcda80f3a73ebf0b5922991f85910d17ffbcce5        # master 2026-10-07
GLM_TAG=1.0.1
GLM_COMMIT=0af55ccecd98d4e5a8d1fad7de25ba429d60e863
PYODIDE_CORE_TARBALL=pyodide-core-$PYODIDE_VER.tar.bz2
PYODIDE_CORE_SHA256=2abdcc2e35208af406e07724cffa85bc582ced97e9028383ecf5462541393f95
NUMPY_WHEEL=numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl
NUMPY_WHEEL_SHA256=a292c1f5d7d8a2208cd5e94fc467604c131cabcd2fc14fed6eefde121e7fabdf   # = Pyodide 314.0.7 pyodide-lock.json

if [ $# -ne 2 ]; then
  echo "usage: build.sh <work-dir> <out-dir>" >&2
  exit 2
fi
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
mkdir -p "$1" "$2"
W=$(cd "$1" && pwd -P)
OUT=$(cd "$2" && pwd -P)
if [ -n "$(ls -A "$W")" ]; then
  echo "build.sh: work dir $W is not empty; give it a fresh (tmpfs) directory" >&2
  exit 2
fi
case "$OUT/" in "$W"/*) echo "build.sh: the out dir must not be inside the work dir" >&2; exit 2 ;; esac
VENV=${VENV:-/opt/venv}
export LC_ALL=C
mkdir -p "$W/home" "$W/dl" "$OUT/reports"
export HOME=${HOME:-$W/home}
REPORTS=$OUT/reports
INFO=$REPORTS/build-info.txt
: > "$INFO"
T0=$(date +%s)
phase() { echo "PHASE $1 +$(( $(date +%s) - T0 ))s" | tee -a "$INFO"; }
die() { echo "build.sh: $*" >&2; exit 1; }
sha_ok() {  # sha_ok <file> <sha256>
  local got
  got=$(sha256sum "$1" | cut -d' ' -f1)
  [ "$got" = "$2" ] || die "sha256 of $(basename "$1") is $got, pinned $2"
}

# ---- 0. our own inputs: patches, shims and S1 stage inputs are the reviewed bytes
# An editor or a pre-commit hook that strips the whitespace-only context lines
# breaks `git apply`, or worse, applies a different hunk (TN0110 §7-28). The S1
# data stage (wheel.sh: s1_drop.json, repickle.mjs, cmyk_refilter.py) and the
# .pyc stage (step 5b: pyc_targets.json, pyc_compile.mjs, pyc_assemble.py)
# decide shipped bytes as much as a patch does, so they are pinned the same way;
# so do the numpy trim stage's tool and list (step 2: numpy_trim.py,
# numpy_drop.json, S2-2 (3)).
TOP_INPUTS=(s1_drop.json repickle.mjs cmyk_refilter.py pyc_targets.json pyc_compile.mjs pyc_assemble.py numpy_trim.py numpy_drop.json)
for f in "${TOP_INPUTS[@]}"; do
  [ -f "$HERE/$f" ] || die "input $f is missing"
done
(cd "$HERE" && sha256sum --quiet --strict -c INPUTS.sha256) || die "INPUTS.sha256 does not match patches/, shim/ or the top-level inputs"
# INPUTS.sha256 checks only the files it lists; refuse a stray patch or shim
# that is not listed (it would otherwise be applied / put on the include path),
# and a list that is not exactly those plus the top-level inputs above.
on_disk=$( (cd "$HERE" && ls patches/*.patch shim/*.h && printf '%s\n' "${TOP_INPUTS[@]}") | sort)
listed=$(awk '{print $2}' "$HERE/INPUTS.sha256" | sort)
[ "$on_disk" = "$listed" ] || die "INPUTS.sha256 does not list exactly patches/*.patch, shim/*.h and ${TOP_INPUTS[*]}"
phase inputs_verified

# ---- 1. toolchain ----------------------------------------------------------
got=$("$VENV/bin/python3" -I -c 'import importlib.metadata as m; print(m.version("pyodide-build"))')
[ "$got" = "$PYODIDE_BUILD_VER" ] || die "pyodide-build is $got, pinned $PYODIDE_BUILD_VER (rebuild the image)"
git -c advice.detachedHead=false clone -q --depth 1 --branch "$EMSDK_VER" https://github.com/emscripten-core/emsdk.git "$W/emsdk"
[ "$(git -C "$W/emsdk" rev-parse HEAD)" = "$EMSDK_COMMIT" ] || die "emsdk tag $EMSDK_VER is not commit $EMSDK_COMMIT"
(cd "$W/emsdk" && ./emsdk install "$EMSDK_VER" && ./emsdk activate "$EMSDK_VER") > "$REPORTS/emsdk-install.log" 2>&1 \
  || { tail -20 "$REPORTS/emsdk-install.log"; die "emsdk install $EMSDK_VER failed"; }
[ "$(cat "$W/emsdk/upstream/.emsdk_version")" = "releases-$EMSCRIPTEN_RELEASE-64bit" ] || die "emsdk installed $(cat "$W/emsdk/upstream/.emsdk_version"), pinned release $EMSCRIPTEN_RELEASE"
[ "$(cat "$W/emsdk/upstream/emscripten/emscripten-version.txt")" = "\"$EMSDK_VER\"" ] || die "emscripten is not $EMSDK_VER"
# emsdk fetches the toolchain tarballs over HTTPS from a URL keyed by the pinned
# release hash (same trust root as any emsdk user); their bytes are not
# sha256-pinned here. This confirms the compiler build that actually ran, and
# the committed-manifest comparison (exit 3) is the backstop on any output drift.
# shellcheck disable=SC2086
source "$W/emsdk/emsdk_env.sh" >/dev/null 2>&1
emcc_ver=$(emcc --version | sed -n 1p)
case "$emcc_ver" in
  *"$EMCC_COMMIT"*) ;;
  *) die "emcc is '$emcc_ver', expected the build at $EMCC_COMMIT" ;;
esac
phase emsdk_installed
"$VENV/bin/pyodide" xbuildenv install "$PYODIDE_VER" --path "$W/xbuildenv" > "$REPORTS/xbuildenv-install.log" 2>&1 \
  || { tail -20 "$REPORTS/xbuildenv-install.log"; die "xbuildenv install $PYODIDE_VER failed"; }
# shellcheck source=env.sh
source "$HERE/env.sh" "$W"
got=$(cd "$PYINC" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)
[ "$got" = "$XBUILDENV_PYINC_TREE_SHA256" ] || die "xbuildenv CPython headers hash to $got, pinned $XBUILDENV_PYINC_TREE_SHA256"
phase xbuildenv_installed
# PIC + wasm sjlj = Pyodide's ABI
embuilder --pic build libpng-legacysjlj freetype-legacysjlj > "$REPORTS/embuilder.log" 2>&1 \
  || { tail -20 "$REPORTS/embuilder.log"; die "embuilder failed"; }
phase ports_built

# ---- 2. Pyodide core and the numpy wasm wheel -------------------------------
curl -sSfL -o "$W/dl/$PYODIDE_CORE_TARBALL" "https://github.com/pyodide/pyodide/releases/download/$PYODIDE_VER/$PYODIDE_CORE_TARBALL"
sha_ok "$W/dl/$PYODIDE_CORE_TARBALL" "$PYODIDE_CORE_SHA256"
mkdir -p "$W/dl/core"
tar -xjf "$W/dl/$PYODIDE_CORE_TARBALL" -C "$W/dl/core"
curl -sSfL -o "$W/dl/$NUMPY_WHEEL" "https://cdn.jsdelivr.net/pyodide/v$PYODIDE_VER/full/$NUMPY_WHEEL"
sha_ok "$W/dl/$NUMPY_WHEEL" "$NUMPY_WHEEL_SHA256"
# The lock in the pinned core must name the same numpy wheel, or the browser
# would refuse what we compiled against.
python3 -I - "$W/dl/core/pyodide/pyodide-lock.json" "$NUMPY_WHEEL" "$NUMPY_WHEEL_SHA256" <<'PY' || die "pyodide-lock.json disagrees with the numpy pin"
import json, sys
lock = json.load(open(sys.argv[1]))
np = lock["packages"]["numpy"]
assert (np["file_name"], np["sha256"]) == (sys.argv[2], sys.argv[3]), np
PY
# numpy headers come from this wheel and nowhere else (D13)
python3 -I - "$W/dl/$NUMPY_WHEEL" "$NPINC" <<'PY'
import os, sys, zipfile
prefix = "numpy/_core/include/"
n = 0
with zipfile.ZipFile(sys.argv[1]) as z:
    for name in z.namelist():
        if name.startswith(prefix) and not name.endswith("/"):
            dest = os.path.join(sys.argv[2], name[len(prefix):])
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "wb") as fh:
                fh.write(z.read(name))
            n += 1
if not os.path.isfile(os.path.join(sys.argv[2], "numpy", "arrayobject.h")):
    sys.exit("numpy wheel carries no numpy/arrayobject.h")
print(f"numpy headers: {n} files from the wasm wheel")
PY
# The numpy wheel that ships (S2-2 (3)): the pinned one less the 206 members no
# run reads (type stubs, headers, static libraries, C / Cython sources, build
# configuration, the PyInstaller hook, the doc module, pytest's conftest), named
# by numpy_drop.json and refused unless the documented rule still yields
# exactly that list; every kept member is copied byte for byte. The compile
# above reads its headers from the ORIGINAL wheel; the smoke test, the probes
# and dist/ use this copy, under the same file name.
mkdir -p "$W/numpy-trim"
NUMPY_SHIPPED=$W/numpy-trim/$NUMPY_WHEEL
python3 -I -B "$HERE/numpy_trim.py" "$W/dl/$NUMPY_WHEEL" "$HERE/numpy_drop.json" "$NUMPY_SHIPPED" \
  --json "$REPORTS/numpy_trim.json" || die "numpy_trim refused the numpy wheel or its drop list"
phase downloads_verified

# ---- 3. sources -------------------------------------------------------------
git -c advice.detachedHead=false clone -q --depth 1 --branch "$GLM_TAG" https://github.com/g-truc/glm "$W/glm"   # header-only
[ "$(git -C "$W/glm" rev-parse HEAD)" = "$GLM_COMMIT" ] || die "glm tag $GLM_TAG is not commit $GLM_COMMIT"
git init -q "$SRC"
git -C "$SRC" fetch -q --depth 1 "$PYMOL_REPO" "$PYMOL_COMMIT"
git -C "$SRC" -c advice.detachedHead=false checkout -q FETCH_HEAD
[ "$(git -C "$SRC" rev-parse HEAD)" = "$PYMOL_COMMIT" ] || die "pymol checkout is not $PYMOL_COMMIT"
for p in "$HERE"/patches/*.patch; do
  git -C "$SRC" apply "$p" || die "patch $(basename "$p") does not apply"
done
git -C "$SRC" diff --stat | tail -1
# PyMOLBuildInfo.h embeds SOURCE_DATE_EPOCH (or the clock); the pinned
# commit's own time makes it a function of the source.
SOURCE_DATE_EPOCH=$(git -C "$SRC" log -1 --format=%ct HEAD)
export SOURCE_DATE_EPOCH
phase sources_ready

# ---- 4. tests that need no compiler output, before spending the compile -----
python3 -I -B "$HERE/tests/test_restricted_unpickler.py" "$SRC/modules" > "$REPORTS/test_restricted_unpickler.txt" 2>&1 \
  || { tail -40 "$REPORTS/test_restricted_unpickler.txt"; die "restricted-unpickler tests failed"; }
tail -3 "$REPORTS/test_restricted_unpickler.txt"
python3 -I -B "$HERE/tests/test_check_no_emjs.py" > "$REPORTS/test_check_no_emjs.txt" 2>&1 \
  || { tail -40 "$REPORTS/test_check_no_emjs.txt"; die "check_no_emjs tests failed"; }
tail -3 "$REPORTS/test_check_no_emjs.txt"
python3 -I -B "$HERE/tests/test_check_side_modules.py" > "$REPORTS/test_check_side_modules.txt" 2>&1 \
  || { tail -40 "$REPORTS/test_check_side_modules.txt"; die "check_side_modules tests failed"; }
tail -3 "$REPORTS/test_check_side_modules.txt"
python3 -I -B "$HERE/tests/test_tests_summary.py" > "$REPORTS/test_tests_summary.txt" 2>&1 \
  || { tail -40 "$REPORTS/test_tests_summary.txt"; die "tests_summary tests failed"; }
tail -3 "$REPORTS/test_tests_summary.txt"
python3 -I -B "$HERE/tests/test_check_pyc.py" > "$REPORTS/test_check_pyc.txt" 2>&1 \
  || { tail -40 "$REPORTS/test_check_pyc.txt"; die "check_pyc tests failed"; }
tail -3 "$REPORTS/test_check_pyc.txt"
python3 -I -B "$HERE/tests/test_pyc_assemble.py" > "$REPORTS/test_pyc_assemble.txt" 2>&1 \
  || { tail -40 "$REPORTS/test_pyc_assemble.txt"; die "pyc_assemble tests failed"; }
tail -3 "$REPORTS/test_pyc_assemble.txt"
python3 -I -B "$HERE/tests/test_cmyk_refilter.py" > "$REPORTS/test_cmyk_refilter.txt" 2>&1 \
  || { tail -40 "$REPORTS/test_cmyk_refilter.txt"; die "cmyk_refilter tests failed"; }
tail -3 "$REPORTS/test_cmyk_refilter.txt"
python3 -I -B "$HERE/tests/test_make_wheel.py" > "$REPORTS/test_make_wheel.txt" 2>&1 \
  || { tail -40 "$REPORTS/test_make_wheel.txt"; die "make_wheel tests failed"; }
tail -3 "$REPORTS/test_make_wheel.txt"
python3 -I -B "$HERE/tests/test_third_party_notices.py" > "$REPORTS/test_third_party_notices.txt" 2>&1 \
  || { tail -40 "$REPORTS/test_third_party_notices.txt"; die "third_party_notices tests failed"; }
tail -3 "$REPORTS/test_third_party_notices.txt"
python3 -I -B "$HERE/tests/test_numpy_trim.py" > "$REPORTS/test_numpy_trim.txt" 2>&1 \
  || { tail -40 "$REPORTS/test_numpy_trim.txt"; die "numpy_trim tests failed"; }
tail -3 "$REPORTS/test_numpy_trim.txt"
# The third-party notices of THIS patched tree (what the vendoring step copies to
# licenses/NOTICES.pymol-third-party.txt). Generating them also proves what the
# patches leave compiled: no uncovered notice, no stale NOT_COMPILED file (patch
# 0012 compiles Gentium's FontTTF2.h out), and exactly the four Sans faces
# referenced on the lines the wasm build compiles.
python3 -I -B "$HERE/third_party_notices.py" "$SRC" "$REPORTS/NOTICES.pymol-third-party.txt" \
  || die "third_party_notices.py refused the patched tree"
# S2-4: patch 0013's hand-written GLSL ES 3.00 rewrite (layer0/ShaderEs300.h)
# must return patch 0005's std::regex output byte for byte, over every shader x
# preprocessor-variable combination the shipped build can make and an
# adversarial corpus, compiled by emscripten against its own libc++ (the
# shipped regex) and run under emsdk's node; and no compiled source may use
# <regex> any more.
CXX=em++ NODE="${EMSDK_NODE:-node}" bash "$HERE/tests/run_es300_rewrite_test.sh" "$SRC" "$W/es300_rewrite_test" \
  > "$REPORTS/es300_rewrite_test.txt" 2>&1 \
  || { tail -60 "$REPORTS/es300_rewrite_test.txt"; die "es300 rewrite test failed (patch 0013 vs 0005)"; }
grep -E '^(shipped|\(i\) totals|\(ii\) adversarial|differences|ES300_REWRITE_TEST )' "$REPORTS/es300_rewrite_test.txt"
if grep -rnE '#include *<regex>|std::regex' "$SRC"/ov/src "$SRC"/layer0 "$SRC"/layer1 "$SRC"/layer2 "$SRC"/layer3 \
     "$SRC"/layer4 "$SRC"/layer5 "$SRC"/layerGraphics "$SRC"/include "$SRC"/contrib/pocketfft; then
  die "a compiled source still uses <regex> (S2-4)"
fi
# The numpy ABI probe (D13) runs inside compile.sh, with that script's full
# include set, so it sees exactly what the translation units see.
phase tests_passed

# ---- 5. compile, link, wheel ------------------------------------------------
export OPT=-O2   # pin the opt level for the shipped build (env.sh honours ${OPT})
bash "$HERE/compile.sh" "$W"
phase compiled
bash "$HERE/link.sh" "$W"
phase linked
bash "$HERE/wheel.sh" "$W" || { tail -40 "$BLD/logs/champ.log" 2>/dev/null; die "wheel.sh failed"; }
phase wheel_built
SRC_WHL=$(find "$BLD" -maxdepth 1 -name 'pymol-*.whl' -type f)
[ "$(printf '%s\n' "$SRC_WHL" | wc -l)" -eq 1 ] || die "expected exactly one PyMOL wheel in $BLD"
CMD_SO=$BLD/_cmd.cpython-314-wasm32-emscripten.so
CHAMP_SO=$BLD/_champ.cpython-314-wasm32-emscripten.so

# ---- 5b. the .pyc stage (S1-11): the LAST change to the wheel and the stdlib zip
# The boot modules of the real Chrome worker (pyc_targets.json: selected in
# Chrome per bench/pyc/README.md, since this container has no Chrome) are
# compiled by the runtime's own CPython, the pinned core under node, in one
# fresh process per kind that imports nothing of PyMOL: std without, site with
# the column table. The stdlib zip then carries them as sourceless .pyc in
# place (re-packed at deflate 9), the wheel in __pycache__ beside the kept .py.
# chempy/pkl.py stays source (patch 0006; step 7 and the frame read it). Nothing
# may change either archive after this: an unchecked-hash .pyc does not notice
# an edited .py and would run the old code.
PYC=$W/pyc
CORE=$W/core-final/pyodide   # the pinned core with the new python_stdlib.zip
rm -rf "$PYC" "$W/core-final"
mkdir -p "$PYC/final"
"${EMSDK_NODE:-node}" "$HERE/pyc_compile.mjs" "$W/dl/core/pyodide" std "$W/dl/core/pyodide/python_stdlib.zip" \
  "$HERE/pyc_targets.json" "$PYC/std" || die "pyc_compile.mjs std failed"
"${EMSDK_NODE:-node}" "$HERE/pyc_compile.mjs" "$W/dl/core/pyodide" site "$SRC_WHL" \
  "$HERE/pyc_targets.json" "$PYC/site" || die "pyc_compile.mjs site failed"
cp "$PYC/std/_summary.json" "$REPORTS/pyc_compile_std.json"
cp "$PYC/site/_summary.json" "$REPORTS/pyc_compile_site.json"
WHL=$PYC/final/$(basename "$SRC_WHL")
rm -f "$REPORTS/pyc_assemble.json"
python3 -I -B "$HERE/pyc_assemble.py" --json "$REPORTS/pyc_assemble.json" "$HERE/pyc_targets.json" \
  "$W/dl/core/pyodide/python_stdlib.zip" "$PYC/std" "$PYC/final/python_stdlib.zip" "$SRC_WHL" "$PYC/site" "$WHL" \
  || die "pyc_assemble.py refused the .pyc stage (reports/pyc_assemble.json)"
# The magic the .pyc carry is the compiling runtime's; it must also be the one
# check_pyc.py derives for the lock's CPython (this image's CPython is the same
# 3.14 series), so the gate below is not merely checking the files against
# their own claim.
MAGIC=$(python3 -I -c 'import json, sys; m = {json.load(open(p))["magic"] for p in sys.argv[1:]}; assert len(m) == 1, m; print(m.pop())' \
  "$PYC/std/_summary.json" "$PYC/site/_summary.json") || die "the two .pyc compiles disagree on the magic"
python3 -I -B - "$HERE/tests/check_pyc.py" "$W/dl/core/pyodide/pyodide-lock.json" "$MAGIC" <<'PY' || die "the compile's magic $MAGIC is not the one check_pyc.py derives"
import importlib.util, sys
gate_path, lock, magic = sys.argv[1:]
spec = importlib.util.spec_from_file_location("check_pyc", gate_path)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
major, minor, full = gate.runtime_version(lock)
derived, how = gate.runtime_magic(None, major, minor, full)
assert derived.hex() == magic, (derived.hex(), magic, how)
print(f"pyc magic {magic}: the compile's equals check_pyc's ({how})")
PY
rm -f "$REPORTS/check_pyc.json"
python3 -I -B "$HERE/tests/check_pyc.py" --lock "$W/dl/core/pyodide/pyodide-lock.json" --magic "$MAGIC" \
  --targets "$HERE/pyc_targets.json" --expect-pyc --json "$REPORTS/check_pyc.json" "$PYC/final/python_stdlib.zip" "$WHL" \
  || die "check_pyc: the .pyc are not exactly pyc_targets.json's, or stale, or not the runtime's (reports/check_pyc.json)"
# The final core: the pinned core with the sourceless-boot stdlib zip. Steps 6b,
# 7b and 8 use it, so the smoke test proves the new zip boots.
mkdir -p "$CORE"
cp -r "$W/dl/core/pyodide/." "$CORE/"
cp "$PYC/final/python_stdlib.zip" "$CORE/python_stdlib.zip"
phase pyc_built

# ---- 6. no EM_JS / EM_ASM / run_script, and the checker still sees one ------
python3 -I -B "$HERE/check_no_emjs.py" --json "$REPORTS/check_no_emjs.json" "$CMD_SO" "$CHAMP_SO" \
  || die "check_no_emjs: a side module carries EM_JS / EM_ASM / emscripten_run_script"
mkdir -p "$W/controls"
for c in positive negative; do
  emcc -O2 -g0 -fPIC $ABI_FLAGS $PREFIX_MAP -sSIDE_MODULE=1 "$HERE/tests/emjs_$c.c" -o "$W/controls/emjs_$c.so"
done
rc=0
# Remove any earlier run's report first, so a crashing checker (which writes
# none) cannot be blessed by a stale one.
rm -f "$REPORTS/check_no_emjs_positive_control.json"
python3 -I -B "$HERE/check_no_emjs.py" --json "$REPORTS/check_no_emjs_positive_control.json" "$W/controls/emjs_positive.so" || rc=$?
[ "$rc" -eq 1 ] || die "check_no_emjs exited $rc on the EM_JS positive control (expected 1): the checker is broken"
python3 -I - "$REPORTS/check_no_emjs_positive_control.json" <<'PY' || die "positive control not seen structurally in both imports and exports"
import json, sys
r = json.load(open(sys.argv[1]))[0]
# The control carries EM_JS (export) AND run_script / asm_const (import), so a
# working checker must see a hit in BOTH, not just the three EM_JS/EM_ASM exports.
assert r["raw_hits"] >= 1, r
assert r["forbidden_in_exports"], r
assert r["forbidden_in_imports"], r
print("positive control: exports %s, imports %s, raw %d -> exit 1 as required"
      % (r["forbidden_in_exports"], r["forbidden_in_imports"], r["raw_hits"]))
PY
python3 -I -B "$HERE/check_no_emjs.py" --json "$REPORTS/check_no_emjs_negative_control.json" "$W/controls/emjs_negative.so" \
  || die "check_no_emjs flagged the plain negative control"
phase emjs_checked

# ---- 6b. every side-module import has a provider, none is a self import, ----
# and the gate still sees a miss.
# Self imports (env functions only the module itself provides): the base build's
# _cmd had 615; S1-1 (-fvisibility=hidden + SIDE_MODULE=2) leaves 0 in both
# modules, so the limit is 0. side_module_controls.py runs its self-limit
# "over" control only on a module that has self imports: at 0 it records that
# control as skipped (tests/test_check_side_modules.py pins the limit on
# synthetic modules) and still requires the at-limit run to pass.
rm -f "$REPORTS/side_modules.json" "$REPORTS/side_module_controls.json"
python3 -I -B "$HERE/tests/check_side_modules.py" --json "$REPORTS/side_modules.json" --max-self-imports 0 \
  --main-wasm "$CORE/pyodide.asm.wasm" --main-js "$CORE/pyodide.asm.mjs" "$CMD_SO" "$CHAMP_SO" \
  || die "check_side_modules: an unresolved import, a self import or a missing required export (reports/side_modules.json)"
python3 -I -B "$HERE/tests/side_module_controls.py" --json "$REPORTS/side_module_controls.json" --work-dir "$W/controls" \
  --main-wasm "$CORE/pyodide.asm.wasm" --main-js "$CORE/pyodide.asm.mjs" "$CMD_SO" "$CHAMP_SO" \
  || die "side_module_controls: the side-module gate missed a tampered copy (reports/side_module_controls.json)"
phase side_modules_checked

# ---- 7. the FINAL wheel carries the patched code and these exact side modules
python3 -I - "$WHL" "$CMD_SO" "$CHAMP_SO" <<'PY' || die "wheel content check failed"
import sys, zipfile
whl, cmd_so, champ_so = sys.argv[1:]
with zipfile.ZipFile(whl) as z:
    assert z.read("pymol/_cmd.cpython-314-wasm32-emscripten.so") == open(cmd_so, "rb").read()
    assert z.read("chempy/champ/_champ.cpython-314-wasm32-emscripten.so") == open(champ_so, "rb").read()
    pkl = z.read("chempy/pkl.py").decode()
    assert "RESTRICTED_GLOBALS" in pkl and "pickle.loads = restricted_loads" in pkl, "patch 0006 missing"
    names = z.namelist()
    assert names == sorted(names, key=lambda n: (".dist-info/" in n, n.encode())), "member order"
    pyc = sum(1 for n in names if n.endswith(".pyc"))
    print(f"wheel: {len(names)} members ({pyc} .pyc), patch 0006 present, side modules match")
PY

# ---- 7b. the final wheel on the final core (emsdk's node, headless PyMOL) ----
# The restriction must be ACTIVE once pymol is imported, and hold on the nested
# wizard pickle and the C++ ObjectCallback path, with live controls. Run on the
# final core, so the sourceless stdlib zip and the __pycache__ wheel are what
# boots (a smoke on the pinned core's zip would prove neither).
# A stale report must not be judged in place of this run's.
rm -f "$REPORTS/smoke_wheel.json"
"${EMSDK_NODE:-node}" "$HERE/tests/smoke_wheel.mjs" "$CORE" "$NUMPY_SHIPPED" "$WHL" "$REPORTS/smoke_wheel.json" \
  || die "the built wheel failed its Pyodide smoke test (reports/smoke_wheel.json)"
# The verdict is the report's own expectations, not the exit code alone.
python3 -I -B "$HERE/tests/tests_summary.py" "$REPORTS" --require smoke_wheel \
  || die "tests_summary: a test report failed or is missing (reports/*.json)"
phase smoke_passed

# ---- 7c. the S1 and S2 probes on the final wheel and core --------------------
# Each probe pins one S1 / S2 change on the built bytes: utf8_probe (S1-5,
# upstream #522: UTF-8 wizard / scene text handling, each case time-limited),
# bg_image_probe (S1-6: background image handling), interrupt_probe (S1-4:
# interrupt handling, the 17 conditions give the shipped values), pickle_identity
# (S1-9: the protocol-4 pickles load to objects identical to the source tree's),
# cmyk_table (S1-10: `space cmyk` gives a bit-identical colour table with the
# source tree's cmyk.png), font_fallback_probe (S2-1, patch 0012: ray-traced
# labels with label_font_id 9-18 and >= 19 are pixel-identical to Sans (5), ids
# 6-8 keep their own faces, distance / dihedral / session labels draw),
# bundled_pkl_probe (patch 0014: the 133 bundled pickles take the C unpickler
# through chempy.io.pkl.fromFile and load identical to the pure-Python path,
# the $PYMOL_DATA boundary holds, the mutagenesis wizard, fragment and fab give
# identical results on both paths, a crafted .pse is refused inside and
# outside $PYMOL_DATA) and numpy_import_probe (S2-2 (3): every module of the
# pinned numpy wheel imports from the trimmed one exactly as from the original,
# `from numpy import *`, numpy.testing, help(numpy) and the rest, with a
# built-in over-trimmed control). Each is judged by its exit code AND its own
# report: `ok` true and a non-empty `expectations` of only true. A stale report
# must not be judged in place of this run's.
verdict_ok() {  # verdict_ok <name>: the report <name>.json says every expectation held
  python3 -I - "$REPORTS/$1.json" "$1" <<'PY' || die "$1: its report does not say every expectation held"
import json, sys
r = json.load(open(sys.argv[1]))
e = r.get("expectations")
assert r.get("probe") == sys.argv[2], r.get("probe")
assert isinstance(e, dict) and e and all(v is True for v in e.values()), e
assert r.get("ok") is True, r.get("ok")
print(f"{sys.argv[2]}: {len(e)}/{len(e)} expectations held")
PY
}
probe_ok() {  # probe_ok <name> <extra args...>
  local name=$1; shift
  rm -f "$REPORTS/$name.json"
  "${EMSDK_NODE:-node}" "$HERE/tests/$name.mjs" "$CORE" "$NUMPY_SHIPPED" "$WHL" "$REPORTS/$name.json" "$@" \
    > "$REPORTS/$name.txt" 2>&1 || { tail -20 "$REPORTS/$name.txt"; die "$name failed (reports/$name.json)"; }
  verdict_ok "$name"
}
probe_ok utf8_probe
probe_ok bg_image_probe
probe_ok interrupt_probe
probe_ok pickle_identity "$SRC/data/chempy"
probe_ok cmyk_table "$SRC/data/pymol/cmyk.png"
probe_ok font_fallback_probe
probe_ok bundled_pkl_probe
# numpy_import_probe takes both numpy wheels (the pinned original, the trimmed one).
rm -f "$REPORTS/numpy_import_probe.json"
"${EMSDK_NODE:-node}" "$HERE/tests/numpy_import_probe.mjs" "$CORE" "$W/dl/$NUMPY_WHEEL" "$NUMPY_SHIPPED" \
  "$REPORTS/numpy_import_probe.json" > "$REPORTS/numpy_import_probe.txt" 2>&1 \
  || { tail -20 "$REPORTS/numpy_import_probe.txt"; die "numpy_import_probe failed (reports/numpy_import_probe.json)"; }
verdict_ok numpy_import_probe
phase probes_passed

# ---- 8. stage the outputs and the manifest ----------------------------------
rm -rf "$OUT/dist" "$OUT/build"
mkdir -p "$OUT/dist/pyodide-core" "$OUT/build"
cp "$WHL" "$NUMPY_SHIPPED" "$OUT/dist/"
cp -r "$CORE/." "$OUT/dist/pyodide-core/"
cp "$CMD_SO" "$CHAMP_SO" "$OUT/build/"
cp "$BLD/compile_result.txt" "$REPORTS/"
rm -rf "$REPORTS/logs"
cp -r "$BLD/logs" "$REPORTS/logs"
(cd "$OUT" && find dist build -type f -print0 | sort -z | xargs -0 sha256sum > MANIFEST.sha256)
phase staged
{
  echo "pyodide $PYODIDE_VER; pyodide-build $PYODIDE_BUILD_VER; emsdk $EMSDK_VER ($EMSDK_COMMIT, release $EMSCRIPTEN_RELEASE)"
  echo "pymol $PYMOL_COMMIT; glm $GLM_TAG ($GLM_COMMIT); numpy wheel $NUMPY_WHEEL_SHA256"
  echo "SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH work-dir=$W"
  emcc --version | sed -n 1p
  echo "wheel: $(basename "$WHL") $(stat -c %s "$WHL") bytes"
  echo "numpy shipped: $(sha256sum "$NUMPY_SHIPPED" | cut -d' ' -f1) $(stat -c %s "$NUMPY_SHIPPED") bytes (pinned: $(stat -c %s "$W/dl/$NUMPY_WHEEL"))"
  echo "python_stdlib.zip: $(stat -c %s "$CORE/python_stdlib.zip") bytes (pinned core's: $(stat -c %s "$W/dl/core/pyodide/python_stdlib.zip"))"
  echo "total: $(( $(date +%s) - T0 )) s"
} | tee -a "$INFO"
cat "$OUT/MANIFEST.sha256"

if [ "${VERIFY_MANIFEST:-1}" != 0 ] && [ -f "$HERE/MANIFEST.sha256" ]; then
  if ! cmp -s "$OUT/MANIFEST.sha256" "$HERE/MANIFEST.sha256"; then
    diff "$HERE/MANIFEST.sha256" "$OUT/MANIFEST.sha256" || true
    echo "build.sh: the output differs from the committed MANIFEST.sha256" >&2
    exit 3
  fi
  echo "MANIFEST.sha256: output matches the committed manifest"
fi
