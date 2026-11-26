#!/usr/bin/env bash
# Host driver for the pinned PyMOL wasm builder (README.md § Rebuilding).
#
#   usage: build-in-docker.sh [--runs N] [--out DIR] [--update-manifest] [--keep-image]
#
# Builds the builder image from Dockerfile (no build context), runs build.sh
# N times (default 2), each in a fresh container whose work dir is a tmpfs
# mounted at a DIFFERENT path, and requires every run to produce byte-identical
# outputs. The agreed manifest is then compared with MANIFEST.sha256 here, or,
# with --update-manifest, written over it (a version bump). The image is
# removed on exit unless --keep-image.
#
# Limits, each a default the caller can tune (TN0110 §7-22): refuses to start
# below MIN_FREE_GB (default 70) GB free on /; the heavy work stays in RAM-backed
# tmpfs; the containerised build runs under --cpus CPUS with up to JOBS compile
# jobs (both default 24, clamped to 1..24) and nice -n 19 on build.sh; never
# --gpus (the build needs none). The outer `nice` on `docker build` only slows
# the CLI, not BuildKit's daemon; the image build is just an apt + pip step.
# The tagged builder image is removed on exit (unless --keep-image); the base
# image and BuildKit cache layers are left for reuse.
set -euo pipefail

RUNS=2
OUT=""
UPDATE=0
KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --runs) RUNS=$2; shift 2 ;;
    --out) OUT=$2; shift 2 ;;
    --update-manifest) UPDATE=1; shift ;;
    --keep-image) KEEP=1; shift ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "build-in-docker.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
case "$RUNS" in ''|*[!0-9]*) echo "--runs needs a number" >&2; exit 2 ;; esac
[ "$RUNS" -ge 1 ] || { echo "--runs must be at least 1" >&2; exit 2; }
if [ "$UPDATE" = 1 ] && [ "$RUNS" -lt 2 ]; then
  echo "--update-manifest needs at least 2 runs: a manifest is only written once two builds agree" >&2
  exit 2
fi

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# Defaults the caller can lower: 1..24 compile jobs and CPU cap, never more
# (JOBS=0 would make xargs -P run all 173 TUs at once).
JOBS=${JOBS:-24}
CPUS=${CPUS:-24}
case "$JOBS" in ''|*[!0-9]*) echo "JOBS must be a number" >&2; exit 2 ;; esac
case "$CPUS" in ''|*[!0-9]*) echo "CPUS must be a number" >&2; exit 2 ;; esac
[ "$JOBS" -ge 1 ] && [ "$JOBS" -le 24 ] || { echo "JOBS must be 1..24 (got $JOBS)" >&2; exit 2; }
[ "$CPUS" -ge 1 ] && [ "$CPUS" -le 24 ] || { echo "CPUS must be 1..24 (got $CPUS)" >&2; exit 2; }
# The free-space floor, a default: raise it for more headroom
# (MIN_FREE_GB=100 bash build-in-docker.sh ...).
MIN_FREE_GB=${MIN_FREE_GB:-70}
case "$MIN_FREE_GB" in ''|*[!0-9]*) echo "MIN_FREE_GB must be a number" >&2; exit 2 ;; esac
avail=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
if [ "${avail:-0}" -lt "$MIN_FREE_GB" ]; then
  echo "build-in-docker.sh: only ${avail} GB free on /; refusing below ${MIN_FREE_GB} GB (MIN_FREE_GB)" >&2
  exit 1
fi
if [ -z "$OUT" ]; then
  OUT=$(mktemp -d "${TMPDIR:-/tmp}/pymol-wasm-out.XXXXXX")
fi
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd -P)
CTX=$(mktemp -d "${TMPDIR:-/tmp}/pymol-wasm-ctx.XXXXXX")
# The containers read a snapshot, not this directory: bash reads a script as
# it runs, so an edit made here mid-build would otherwise land in the running
# build.sh at a shifted offset.
SNAP=$(mktemp -d "${TMPDIR:-/tmp}/pymol-wasm-src.XXXXXX")
cp -a "$HERE/." "$SNAP/"
chmod -R a+rX "$SNAP"
IMG="agdb-pymol-wasm-builder:$(date +%Y%m%d%H%M%S)-$$"
cleanup() {
  rmdir "$CTX" 2>/dev/null || true
  rm -rf "$SNAP"
  if [ "$KEEP" = 0 ]; then docker rmi -f "$IMG" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

echo "== image $IMG (out: $OUT, df avail ${avail} GB)"
nice -n 19 docker build -q -t "$IMG" -f "$HERE/Dockerfile" "$CTX" >/dev/null

# Different absolute paths, and different lengths, for the work dir of each
# run: a build path that leaks into the output shows up as a mismatch.
workdir() {
  case "$1" in
    1) echo /w/a ;;
    2) echo /w/second-run/nested ;;
    *) echo "/w/run-$1" ;;
  esac
}
for i in $(seq 1 "$RUNS"); do
  rm -rf "$OUT/run$i"
  mkdir -p "$OUT/run$i"
  echo "== run $i: work dir $(workdir "$i")"
  docker run --rm --name "pymol-wasm-build-$$-$i" \
    --cpus "$CPUS" --user "$(id -u):$(id -g)" \
    -e HOME=/w/home -e JOBS="$JOBS" -e VERIFY_MANIFEST=0 \
    --tmpfs /w:rw,exec,size=40g,mode=1777 \
    -v "$SNAP:/pymol-wasm:ro" -v "$OUT/run$i:/out" \
    "$IMG" nice -n 19 bash /pymol-wasm/build.sh "$(workdir "$i")" /out
done

status=0
for i in $(seq 2 "$RUNS"); do
  if ! cmp -s "$OUT/run1/MANIFEST.sha256" "$OUT/run$i/MANIFEST.sha256"; then
    echo "== NOT REPRODUCIBLE: run 1 and run $i differ"
    diff "$OUT/run1/MANIFEST.sha256" "$OUT/run$i/MANIFEST.sha256" || true
    status=1
  fi
done
[ "$status" = 0 ] || exit 1
[ "$RUNS" -ge 2 ] && echo "== reproducible: $RUNS runs produced identical MANIFEST.sha256"

if [ "$UPDATE" = 1 ]; then
  cp "$OUT/run1/MANIFEST.sha256" "$HERE/MANIFEST.sha256"
  echo "== wrote $HERE/MANIFEST.sha256"
elif [ -f "$HERE/MANIFEST.sha256" ]; then
  if cmp -s "$OUT/run1/MANIFEST.sha256" "$HERE/MANIFEST.sha256"; then
    echo "== output matches the committed MANIFEST.sha256"
  else
    echo "== output differs from the committed MANIFEST.sha256"
    diff "$HERE/MANIFEST.sha256" "$OUT/run1/MANIFEST.sha256" || true
    exit 3
  fi
else
  echo "== no committed MANIFEST.sha256 to compare against; run with --update-manifest to create it" >&2
  exit 3
fi
grep -h 'pymol-.*\.whl$' "$OUT/run1/MANIFEST.sha256"
echo "== outputs: $OUT/run1/dist (reports: $OUT/run1/reports)"
