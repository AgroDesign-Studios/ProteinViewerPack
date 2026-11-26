# Shared environment for the pymol-wasm build scripts. Source it from bash:
#   source env.sh <work-dir>
# <work-dir> is the (tmpfs) directory build.sh populated: emsdk/, xbuildenv/,
# glm/, pymol/, numpy-include/ and build/ live under it. Nothing here names a
# host path; the scripts' own directory is found from this file's location.
# Ported from TN0109 Appendix A env.sh with the job paths turned into arguments.

if [ -z "${1:-}" ]; then
  echo "usage: source env.sh <work-dir>" >&2
  return 2 2>/dev/null || exit 2
fi
W=$(cd "$1" && pwd -P) || { echo "env.sh: work dir $1 does not exist" >&2; return 2 2>/dev/null || exit 2; }
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
export W HERE

# Byte order everywhere: shell globs, sort and ls decide the object link order,
# and the link order decides the bytes of _cmd (an earlier build measured an en_US.UTF-8
# host and a C container linking the same objects into different modules).
export LC_ALL=C

export PYODIDE_VER=314.0.7
export PY_TAG=cp314
export PLATFORM_TAG=pyemscripten_2026_0_wasm32
export SRC=$W/pymol
export BLD=$W/build
export XB=$W/xbuildenv/$PYODIDE_VER/xbuildenv
export PYINC=$XB/pyodide-root/cpython/installs/python-3.14.2/include/python3.14
# numpy headers come ONLY from the sha256-checked Pyodide numpy wasm wheel
# (TN0110 D13). The xbuildenv carries just the two config headers, and a host
# x86_64 numpy include dir next to them made every TU see NPY_SIZEOF_LONG=8
# against sizeof(long)=4 in an earlier build.
export NPINC=$W/numpy-include
export GLMINC=$W/glm
export PYODIDE_XBUILDENV_PATH=$W/xbuildenv

# shellcheck disable=SC1091
source "$W/emsdk/emsdk_env.sh" >/dev/null 2>&1

# Strip the build location from every path the compiler embeds (__FILE__ in
# glm/CPython asserts was one of the three things that kept two earlier builds
# from matching). The work dir and the script dir map to fixed names, so the
# output does not depend on where either lives.
export PREFIX_MAP="-ffile-prefix-map=$W=/pymol-wasm-build -ffile-prefix-map=$HERE=/pymol-wasm"

# Emscripten flags shared by every object and both side modules: PIC plus
# wasm exceptions and wasm setjmp/longjmp, which is Pyodide 314's ABI.
export ABI_FLAGS="-fwasm-exceptions -sSUPPORT_LONGJMP=wasm"
export OPT=${OPT:--O2}
