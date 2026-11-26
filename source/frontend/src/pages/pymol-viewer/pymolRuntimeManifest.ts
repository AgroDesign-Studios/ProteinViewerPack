/**
 * The PyMOL runtime's version and the digests of the five files the worker's
 * fetch shim serves — the digest is the only integrity check on them, and
 * every byte is checked against it before it crosses into a frame.
 *
 * A module of its own, with no imports, because a build plugin loads it too:
 * vite-plugins/protein-viewer-pages.ts embeds the same five files in the
 * blank Protein Viewer Pack it serves, and checks them against this same
 * table.
 */

/** The version directory under `public/vendor/pymol/` this page runs. */
export const PYMOL_RUNTIME_VERSION = '3.2.0a-edcda80f-s3-pyodide-314.0.7'

/**
 * SHA-256 of each file the parent hands over. Four values are the version
 * directory's README table; the lock's row there carries no digest (it is
 * regenerated, not upstream), so its value is pinned against the file itself;
 * a version bump that leaves one stale fails.
 */
export const PYMOL_ASSET_DIGESTS: Readonly<Record<string, string>> = Object.freeze({
  'pyodide-lock.json': 'dd2b7f7699c5d5fa99a4dfdc8d4f20f2db69940f698047e989828f62e179df44',
  'python_stdlib.zip': '26a668c6cefb4a4aa3cb653727e23cbc5baeeff5332be8d1f017fd8eeeebdfbf',
  'pyodide.asm.wasm': 'cc36e3cab04fdfc9a63ff13eb52eae2b911bf46c025cc7b281f394bd3de1d5e6',
  'numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl':
    'ac2db75025a6dd4ce140c571d60c11f61b0c2010f879865952e513c57ff3d9b0',
  'pymol-3.2.0a-cp314-cp314-pyemscripten_2026_0_wasm32.whl':
    '45f41f18b403ecdc9713bfef26e6194ae7483dbbdcf3cd95fe6022a7f98585fd',
})

/**
 * The exact length of each file in `PYMOL_ASSET_DIGESTS`, pinned against the
 * file itself. It is the read cap: a longer body
 * cannot match the digest, so the download stops at the first byte past it
 * instead of holding the rest (PT-3272 item 1). Exact, not "plus a margin",
 * because the bytes are pinned; and never compared with Content-Length, which
 * behind a reverse proxy that compresses responses is the compressed size — for a wheel or the zip,
 * already compressed, a few bytes MORE than the file.
 */
export const PYMOL_ASSET_BYTES: Readonly<Record<string, number>> = Object.freeze({
  'pyodide-lock.json': 933,
  'python_stdlib.zip': 2_961_852,
  'pyodide.asm.wasm': 9_598_218,
  'numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl': 2_568_340,
  'pymol-3.2.0a-cp314-cp314-pyemscripten_2026_0_wasm32.whl': 4_261_268,
})
