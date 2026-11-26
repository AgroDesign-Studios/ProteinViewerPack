#!/usr/bin/env bash
# Fetch, verify and unpack the pinned Pyodide core, for running the real-runtime
# tests (run_runtime_tests.sh) on a host without a build.
#
#   usage: fetch_pyodide_core.sh <dest-dir>
#
# The pin and URL are READ FROM pymol-wasm/build.sh (PYODIDE_VER,
# PYODIDE_CORE_TARBALL, PYODIDE_CORE_SHA256): no second copy here.
#
#   writes <dest-dir>/pyodide-core-<ver>.tar.bz2 (verified) and <dest-dir>/pyodide/ (unpacked)
#
# Idempotent: an existing tarball is re-verified and reused, a mismatching one
# refused (never overwritten); downloads go via .part. An existing
# <dest-dir>/pyodide/ is kept only if identical to a fresh unpack.
#
# exit: 0 the core is at <dest-dir>/pyodide | 1 a sha256 mismatch, a download
#       failure, or an existing unpack that differs | 2 usage error, or a pin
#       build.sh does not state in the expected form
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: fetch_pyodide_core.sh <dest-dir>" >&2
  exit 2
fi
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
BUILD_SH=$HERE/../build.sh
die() { echo "fetch_pyodide_core: $*" >&2; exit 1; }
usage_die() { echo "fetch_pyodide_core: $*" >&2; exit 2; }

[ -f "$BUILD_SH" ] || usage_die "cannot find build.sh at $BUILD_SH"
# pin <NAME>: the value of the one top-level `NAME=value` line of build.sh.
pin() {
  local n
  n=$(grep -cE "^$1=" "$BUILD_SH" || true)
  [ "$n" = 1 ] || usage_die "build.sh has $n lines setting $1 (want exactly 1)"
  sed -nE "s/^$1=([^[:space:]#]*).*/\\1/p" "$BUILD_SH"
}
VER=$(pin PYODIDE_VER)
SHA=$(pin PYODIDE_CORE_SHA256)
TARBALL_EXPR=$(pin PYODIDE_CORE_TARBALL)
[[ $VER =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage_die "PYODIDE_VER '$VER' is not X.Y.Z"
[[ $SHA =~ ^[0-9a-f]{64}$ ]] || usage_die "PYODIDE_CORE_SHA256 '$SHA' is not 64 hex digits"
# build.sh writes the name as pyodide-core-$PYODIDE_VER.tar.bz2; expand that one form only.
[ "$TARBALL_EXPR" = 'pyodide-core-$PYODIDE_VER.tar.bz2' ] || usage_die "PYODIDE_CORE_TARBALL is '$TARBALL_EXPR', not the expected pyodide-core-\$PYODIDE_VER.tar.bz2"
TARBALL=pyodide-core-$VER.tar.bz2
URL=https://github.com/pyodide/pyodide/releases/download/$VER/$TARBALL

mkdir -p "$1"
DEST=$(cd "$1" && pwd -P)
sha_of() { sha256sum "$1" | cut -d' ' -f1; }

if [ -e "$DEST/$TARBALL" ]; then
  got=$(sha_of "$DEST/$TARBALL")
  [ "$got" = "$SHA" ] || die "$DEST/$TARBALL is already there with sha256 $got, not the pin $SHA; refusing (remove it to fetch again)"
  echo "fetch_pyodide_core: $TARBALL already present and verified ($SHA), no download"
else
  part=$DEST/$TARBALL.part
  rm -f "$part"
  echo "fetch_pyodide_core: downloading $URL"
  curl -sSfL --proto '=https' --proto-redir '=https' --tlsv1.2 -o "$part" "$URL" || { rm -f "$part"; die "download of $URL failed"; }
  got=$(sha_of "$part")
  if [ "$got" != "$SHA" ]; then
    rm -f "$part"
    die "downloaded $TARBALL has sha256 $got, pinned $SHA; refused"
  fi
  mv "$part" "$DEST/$TARBALL"
  echo "fetch_pyodide_core: $TARBALL downloaded and verified ($SHA)"
fi

fresh=$(mktemp -d "$DEST/.unpack.XXXXXX")
trap 'rm -rf "$fresh"' EXIT
tar --no-same-owner --no-same-permissions -xjf "$DEST/$TARBALL" -C "$fresh"
[ -f "$fresh/pyodide/pyodide.mjs" ] && [ -f "$fresh/pyodide/pyodide.asm.wasm" ] \
  || die "$TARBALL does not hold pyodide/pyodide.mjs and pyodide/pyodide.asm.wasm"
if [ -e "$DEST/pyodide" ]; then
  diff -r -q "$fresh/pyodide" "$DEST/pyodide" > /dev/null \
    || die "$DEST/pyodide exists and differs from $TARBALL; refusing (remove it to unpack again)"
  echo "fetch_pyodide_core: $DEST/pyodide already unpacked and identical to the tarball"
else
  mv "$fresh/pyodide" "$DEST/pyodide"
  echo "fetch_pyodide_core: unpacked to $DEST/pyodide"
fi
echo "fetch_pyodide_core: Pyodide $VER core ready at $DEST/pyodide"
