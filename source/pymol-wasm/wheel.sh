#!/usr/bin/env bash
# Build chempy.champ._champ, then assemble a Pyodide wheel (pure-python modules
# + data + the two side modules).
#   usage: wheel.sh <work-dir>      -> $BLD/pymol-<ver>-cp314-cp314-pyemscripten_2026_0_wasm32.whl
# Ported from TN0109 Appendix A wheel.sh. Changes: paths are arguments, build
# paths are mapped away, objects link in byte order, and the zip is written by
# make_wheel.py with fixed member order, timestamps and modes instead of
# `python3 -m zipfile -c` (whose walk order, mtimes and umask made an earlier build's
# wheel differ from the spike's although 401 of 403 members were identical).
# The file name follows PEP 427: Pyodide refuses to compile a >8 MB wasm on
# the main thread when the wheel is served as "pymol.whl" (TN0110 §7-6).
#
# The S1 data stage (design 2026-11-16-pymol-wasm-slim 3.2, S1-7..S1-10) runs on
# the stage dir before make_wheel.py, with pinned tools only (the image's python3
# and zlib, emsdk's node, the sha256-checked Pyodide core):
#   S1-7/S1-8  make_wheel.py --drop removes the 61 + 31 members s1_drop.json lists
#              (unread data, modules that cannot run in the browser); it fails on a
#              missing member, on counts other than 61 / 31, or on a kept one listed
#   S1-9       repickle.mjs rewrites the 133 bundled chempy pickles with protocol 4
#              in the pinned Pyodide core's CPython under emsdk's node
#   S1-10      cmyk_refilter.py re-encodes data/pymol/cmyk.png losslessly (gAMA and
#              tEXt kept, pixels asserted identical)
# third_party_notices.py reads s1_drop.json too, so the notices follow the drop.
# _champ is built exactly as before (SIDE_MODULE=1, no visibility flags): S1-1
# applies to _cmd only (compile.sh, link.sh).
set -euo pipefail
# shellcheck source=env.sh
source "$(dirname "${BASH_SOURCE[0]}")/env.sh" "${1:?usage: wheel.sh <work-dir>}"
: "${SOURCE_DATE_EPOCH:?wheel.sh needs SOURCE_DATE_EPOCH (build.sh sets it)}"

cd "$SRC"
CH=$BLD/_champ.cpython-314-wasm32-emscripten.so
rm -rf "$BLD/champ_obj"
mkdir -p "$BLD/champ_obj" "$BLD/logs"
: > "$BLD/logs/champ.log"
for f in contrib/champ/*.c; do
  emcc $OPT -g0 -fPIC $ABI_FLAGS $PREFIX_MAP -Icontrib/champ -I"$PYINC" -c "$f" -o "$BLD/champ_obj/$(basename "$f").o" 2>>"$BLD/logs/champ.log"
done
mapfile -t CHOBJS < <(find "$BLD/champ_obj" -maxdepth 1 -name '*.o' -type f | sort)
emcc $OPT -g0 $ABI_FLAGS -sSIDE_MODULE=1 "${CHOBJS[@]}" -o "$CH"

VER=$(python3 -I -c "import re;print(re.findall(r'_PyMOL_VERSION \"(.*)\"', open('layer0/Version.h').read())[0])")
TAG=$PY_TAG-$PY_TAG-$PLATFORM_TAG
ST=$BLD/wheel_stage
rm -rf "$ST"
mkdir -p "$ST"
cp -r modules/pymol modules/chempy modules/pymol2 "$ST/"
cp "$BLD/_cmd.cpython-314-wasm32-emscripten.so" "$ST/pymol/"
cp "$CH" "$ST/chempy/champ/"
mkdir -p "$ST/pymol/pymol_path/data"
for d in chempy pymol startup shaders tut; do cp -r "data/$d" "$ST/pymol/pymol_path/data/"; done
# data/chempy/tinker is not shipped (PT-9285 item 1): its chempy.prm is a modified
# TINKER amber.prm, and TINKER's terms forbid passing copies on without the
# author's permission, which PyMOL does not record. Nothing in the browser can
# use the folder: chempy.tinker needs an external TINKER program (os.popen).
# The AMBER tables beside it (parm*.dat, parm_simple.inp) serve only that
# program and go with it. third_party_notices.py's NOT_SHIPPED says the same.
rm -rf "$ST/pymol/pymol_path/data/chempy/tinker"
cp data/setting_help.csv data/chem_comp_bond-top100.cif "$ST/pymol/pymol_path/data/"
cp LICENSE "$ST/pymol/pymol_path/"
find "$ST" -name '__pycache__' -prune -exec rm -rf {} +

# ---- S1 data stage (see the header) ----
python3 -I "$HERE/make_wheel.py" --drop "$ST" "$HERE/s1_drop.json"
# emsdk_env.sh (sourced by env.sh) exports EMSDK_NODE; build.sh fetched the core.
"${EMSDK_NODE:-node}" "$HERE/repickle.mjs" "$W/dl/core/pyodide" "$ST"
CMYK=$ST/pymol/pymol_path/data/pymol/cmyk.png
python3 -I "$HERE/cmyk_refilter.py" "$CMYK" "$CMYK"

WHL=$BLD/pymol-$VER-$TAG.whl
rm -f "$WHL"
python3 -I "$HERE/make_wheel.py" "$ST" "$VER" "$TAG" "$WHL"
ls -la "$WHL" "$CH"
