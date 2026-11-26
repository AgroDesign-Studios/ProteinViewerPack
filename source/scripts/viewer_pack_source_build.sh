#!/usr/bin/env bash
# viewer_pack_source_build.sh — builds and tests the Protein Viewer Pack from
# its published source alone, in clean containers of one Node image pinned by
# digest, and can check that a release is what that source builds (PT-9911;
# docs/runbooks/standalone-viewer-pack-distribution.md §9 in AgDB). Part of
# the published source: run it from the source's top folder, with Docker.
#
#   scripts/viewer_pack_source_build.sh [--source DIR] [--work DIR]
#       [--made ISO-INSTANT] [--time-zone TZ] [--sample FILE.cif] [--logo FILE.png]
#       [--compare PUBLISHED-DIR [--allow-unsigned]]
#
# 1. Checks the source: EXTRACT.json lists every file there is, each with its
#    SHA-256 (no network, as every step but the next).
# 2. WITH the network, on a copy of it: `npm ci` — exactly the packages
#    frontend/package-lock.json pins, nothing of this host's.
# 3. With --compare: the release's inputs are read back from the published
#    files (scripts/viewer_pack_reproduce.mjs inputs: the instant it was made,
#    the time zone, the sample, the logo), each unless given here.
# 4. With NO network, on the copy: `tsc --noEmit`, the source's tests, the
#    offline file's build, and the release build (`--unsigned`).
# 5. With --compare: the rebuilt release against the published one
#    (viewer_pack_reproduce.mjs compare: a signed blank app must verify with
#    the app's public key and be the rebuilt file without its signature;
#    everything else byte for byte). --allow-unsigned accepts unsigned blank
#    apps equal to the rebuild: two unsigned builds compared in development,
#    never a release.
#
# The inputs a release's bytes depend on, all pinned or given: the source
# (EXTRACT.json names its commit, which the build stamps), its lockfile, the
# Node image (Node, npm, zlib, ICU) and its platform, the working path inside
# the containers, the locale (C.UTF-8), the time zone (--time-zone, default
# UTC), the instant (--made, default now), the sample and the logo. Nothing
# else of this host reaches the containers: no environment beyond those, no
# secret, no signing key (a release built here is unsigned; AgroDesign signs
# it afterwards, outside any container). The containers run as this user.
#
# --work DIR keeps the copy, the outputs and out/source-build.json (default: a
# temporary folder, removed at the end). Exit 0 only when every step passed
# and, with --compare, the release is reproduced.
set -euo pipefail

# node:22.22.1-bookworm-slim, linux/amd64 (pulled 2026-11-20).
NODE_IMAGE="node@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d"
PLATFORM="linux/amd64"
# Inside the containers: one fixed path (a release refuses a file that carries
# its build path; a short one such as /tree is in many a repository URL).
TREE="/viewer-pack-src"
DEFAULT_SAMPLE="frontend/src/pages/structure-html-export/__fixtures__/1crn.cif"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$HERE/.." && pwd)"
WORK=""
MADE=""
TZONE=""
SAMPLE=""
LOGO=""
COMPARE=""
UNSIGNED=()
usage() { echo "usage: viewer_pack_source_build.sh [--source DIR] [--work DIR] [--made ISO-INSTANT] [--time-zone TZ] [--sample FILE.cif] [--logo FILE] [--compare PUBLISHED-DIR [--allow-unsigned]]" >&2; exit 2; }
abspath() { (cd "$(dirname "$1")" && printf '%s/%s\n' "$(pwd)" "$(basename "$1")"); }
while [ $# -gt 0 ]; do
  if [ "$1" = "--allow-unsigned" ]; then UNSIGNED=(--allow-unsigned); shift; continue; fi
  [ $# -ge 2 ] && [ -n "$2" ] || usage
  case "$1" in
    --source) SRC="$(cd "$2" && pwd)" ;;
    --work) WORK="$2" ;;
    --made) MADE="$2" ;;
    --time-zone) TZONE="$2" ;;
    --sample) SAMPLE="$(abspath "$2")" ;;
    --logo) LOGO="$(abspath "$2")" ;;
    --compare) COMPARE="$(cd "$2" && pwd)" ;;
    *) usage ;;
  esac
  shift 2
done
command -v docker >/dev/null || { echo "docker is not installed" >&2; exit 2; }
[ -f "$SRC/EXTRACT.json" ] || { echo "$SRC: no EXTRACT.json — not a finished source extract" >&2; exit 2; }
[ "${#UNSIGNED[@]}" -eq 0 ] || [ -n "$COMPARE" ] || usage
for f in "$SAMPLE" "$LOGO"; do [ -z "$f" ] || [ -f "$f" ] || { echo "$f: not a file" >&2; exit 2; }; done

if [ -n "$WORK" ]; then
  mkdir -p "$WORK"
  [ -z "$(ls -A "$WORK")" ] || { echo "--work $WORK is not empty" >&2; exit 2; }
  WORK="$(cd "$WORK" && pwd)"
else
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/viewer-source-build.XXXXXX")"
  trap 'rm -rf "$WORK"' EXIT
fi
# Made here, as this user: a directory docker makes for a mount or -w is root's.
mkdir -p "$WORK/tree" "$WORK/out" "$WORK/inputs"
[ -z "$SAMPLE" ] || cp "$SAMPLE" "$WORK/inputs/sample.cif"
[ -z "$LOGO" ] || cp "$LOGO" "$WORK/inputs/logo"
PUBLISHED=()
[ -z "$COMPARE" ] || PUBLISHED=(-v "$COMPARE:/published:ro")

# One container: this user, a fixed HOME, locale and time zone, the source
# read-only, nothing else of this host. Arguments: docker run options, the image, the command.
run_c() {
  docker run --rm --platform "$PLATFORM" --user "$(id -u):$(id -g)" \
    -e HOME=/tmp/home -e npm_config_cache=/tmp/home/.npm -e npm_config_update_notifier=false \
    -e LANG=C.UTF-8 -e LC_ALL=C.UTF-8 -e "TZ=${TZONE:-UTC}" \
    -v "$SRC:/source:ro" -v "$WORK/tree:$TREE" -v "$WORK/out:/out" -v "$WORK/inputs:/inputs" \
    "${PUBLISHED[@]}" "$@"
}

echo "== check the source (EXTRACT.json)"
run_c --network none -w /source "$NODE_IMAGE" node -e '
  const fs = require("fs"), path = require("path"), crypto = require("crypto")
  const m = JSON.parse(fs.readFileSync("EXTRACT.json", "utf8"))
  const want = [...Object.keys(m.files), "EXTRACT.json"].sort()
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
    const p = d === "." ? e.name : d + "/" + e.name
    if (e.isDirectory()) return walk(p)
    if (!e.isFile()) throw new Error(p + ": neither a file nor a directory")
    return [p]
  })
  const have = walk(".").sort()
  const extra = have.filter(f => !want.includes(f)), lost = want.filter(f => !have.includes(f))
  if (extra.length || lost.length) throw new Error("not the files EXTRACT.json lists (extra: " + (extra.join(", ") || "-") + "; missing: " + (lost.join(", ") || "-") + ")")
  for (const [f, e] of Object.entries(m.files)) {
    if (crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") !== e.sha256) throw new Error(f + ": not the bytes EXTRACT.json lists")
  }
  if (!/^[0-9a-f]{40}$/.test(m.commit)) throw new Error("EXTRACT.json names no commit")
  fs.writeFileSync("/out/commit", m.commit)
  console.log("source: " + have.length + " files, commit " + m.commit)
'
SHA="$(cat "$WORK/out/commit")"

echo "== npm ci (network on; $NODE_IMAGE)"
run_c -w "$TREE" "$NODE_IMAGE" sh -euc '
  cp -a /source/. "$0"/
  cd "$0"/frontend
  node --version > /out/node-version
  npm --version > /out/npm-version
  node -p "[\"zlib\", process.versions.zlib, \"icu\", process.versions.icu, \"tz\", process.versions.tz].join(\" \")" > /out/node-libs
  npm ci --include=dev --ignore-scripts --no-audit --no-fund
' "$TREE"

if [ -n "$COMPARE" ]; then
  echo "== the release's inputs, read back from $COMPARE"
  run_c --network none -w "$TREE" "$NODE_IMAGE" sh -euc '
    node scripts/viewer_pack_reproduce.mjs inputs --published /published --out /out/read
    node -e "
      const fs = require(\"fs\"), i = require(\"/out/read/inputs.json\")
      fs.writeFileSync(\"/out/read/made\", i.made)
      fs.writeFileSync(\"/out/read/time-zone\", i.timeZone ?? \"\")
      fs.writeFileSync(\"/out/read/logo-file\", i.logo?.file ?? \"\")
    "
  '
  [ -n "$MADE" ] || MADE="$(cat "$WORK/out/read/made")"
  [ -n "$TZONE" ] || TZONE="$(cat "$WORK/out/read/time-zone")"
  [ -n "$SAMPLE" ] || [ ! -f "$WORK/out/read/sample.cif" ] || cp "$WORK/out/read/sample.cif" "$WORK/inputs/sample.cif"
  LOGO_FILE="$(cat "$WORK/out/read/logo-file")"
  [ -n "$LOGO" ] || [ -z "$LOGO_FILE" ] || cp "$WORK/out/read/$LOGO_FILE" "$WORK/inputs/logo"
fi
ARGS=()
[ -z "$MADE" ] || ARGS+=(--made "$MADE")
[ ! -f "$WORK/inputs/logo" ] || ARGS+=(--logo /inputs/logo)
if [ -f "$WORK/inputs/sample.cif" ]; then SAMPLE_IN=/inputs/sample.cif; else SAMPLE_IN="$TREE/$DEFAULT_SAMPLE"; fi

echo "== type check, tests, offline file, release build (network off; TZ=${TZONE:-UTC})"
run_c --network none -e "AGDB_GIT_SHA=${SHA:0:10}" -w "$TREE/frontend" "$NODE_IMAGE" sh -euc '
  echo "-- tsc"
  npx --no-install tsc --noEmit -p tsconfig.json
  echo "-- vitest"
  npx --no-install vitest run -c standalone/structure-viewer/source/vitest.config.ts
  echo "-- vite build (offline file)"
  NODE_ENV=production npx --no-install vite build -c vite.structure-viewer.config.ts --outDir /out/template --emptyOutDir --logLevel warn
  echo "-- release build (--unsigned)"
  node ../scripts/viewer_pack_release.mjs --unsigned --sample "$0" --out /out/release "$@"
' "$SAMPLE_IN" "${ARGS[@]}"

RESULT="built"
if [ -n "$COMPARE" ]; then
  echo "== compare with $COMPARE"
  if run_c --network none -w "$TREE" "$NODE_IMAGE" node scripts/viewer_pack_reproduce.mjs compare --built /out/release --published /published "${UNSIGNED[@]}"; then
    RESULT="reproduced"
  else
    RESULT="not-reproduced"
  fi
fi

run_c --network none -i -w /out "$NODE_IMAGE" node - "$SHA" "$NODE_IMAGE" "$PLATFORM" "$RESULT" <<'NODE'
const fs = require('fs')
const crypto = require('crypto')
const [sha, image, platform, result] = process.argv.slice(2)
const digest = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const read = f => fs.readFileSync(f, 'utf8').trim()
const record = {
  commit: sha,
  image,
  platform,
  node: read('/out/node-version'),
  npm: read('/out/npm-version'),
  libs: read('/out/node-libs'),
  source: { manifest: digest('/source/EXTRACT.json'), lockfile: digest('/source/frontend/package-lock.json') },
  template: { sha256: digest('/out/template/index.html'), bytes: fs.statSync('/out/template/index.html').size },
  release: JSON.parse(fs.readFileSync('/out/release/build.json', 'utf8')),
  result,
}
fs.writeFileSync('/out/source-build.json', JSON.stringify(record, null, 2) + '\n')
console.log(`== ${result}: ${sha.slice(0, 10)} built and tested from its source alone (node ${record.node}, npm ${record.npm}; ${record.libs})`)
console.log(`   offline file ${record.template.bytes} bytes, sha256 ${record.template.sha256}`)
console.log(`   release ${record.release.version}, made ${record.release.made} (${record.release.timeZone}): ${Object.keys(record.release.files).length} files (unsigned)`)
NODE
[ "$RESULT" != "not-reproduced" ] || { echo "NOT REPRODUCED: the release differs from what this source builds (lines above)" >&2; exit 1; }
echo "   outputs: $WORK/out (source-build.json, release/, template/)"
exit 0
