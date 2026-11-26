# In-browser Open-Source PyMOL runtime (vendored)

The Pyodide 314.0.7 runtime and the Open-Source PyMOL side-module wheel that the
sandboxed PyMOL viewer frame runs.
Loaded at runtime inside an opaque-origin `sandbox="allow-scripts"` iframe and its
classic blob Worker; never bundled, never imported by application code.

Every file here except this README, `../pymol-host.html`, `host.js` and
`worker.js` is an output of the pinned, reproducible builder in
`pymol-wasm/` — `pyodide.js`, `pyodide.asm.mjs` and
`pyodide.asm.wasm` are the unpacked Pyodide 314.0.7 core, unmodified;
`python_stdlib.zip` is that core's, with its 167 boot modules compiled to
sourceless `.pyc` and re-packed at deflate 9 (below); the PyMOL wheel, the
numpy wheel (Pyodide's, less the members no run reads — below) and
`pyodide-lock.json` are its build output. Two builds reproduce them byte for
byte (`pymol-wasm/MANIFEST.sha256`); the digests below are pinned by
`frontend/src/pages/pymol-viewer/vendoredPymol.test.ts`.

This is the S3 build: the S2 build (the four Sans label fonts, the trimmed
numpy wheel, the GLSL ES 3.00 rewrite without `std::regex` and the bundled
`.pkl` through the C unpickler) rebuilt by the same builder from the same inputs, except that the comments
patches 0006, 0011 and 0014 add are worded shorter. The PyMOL wheel differs
from the S2 one only in `chempy/pkl.py` (comments; it ships as source) and the
line of its `RECORD` that hashes it. The side modules, every other wheel
member, the numpy wheel, the core files, `host.js`, `worker.js` and
`licenses/` are byte-identical to S2's; `pyodide-lock.json` differs only in the
PyMOL wheel's sha256, and `patches/` only in those three patches. The previous
directory, `../3.2.0a-edcda80f-s2-pyodide-314.0.7/` (the S2 build), stays
frozen for tabs opened before the bump; the
next version bump deletes it. The S2 bump's predecessor,
`3.2.0a-edcda80f-s1-pyodide-314.0.7`, was deleted with this bump.

| | |
|---|---|
| Version | PyMOL `3.2.0a` (commit `edcda80f3a73ebf0b5922991f85910d17ffbcce5`), Pyodide `314.0.7`, numpy `2.4.6` |
| Python / ABI | CPython 3.14.2, emscripten 5.0.3, Pyodide ABI `2026_0` |
| Builder | `pymol-wasm/` (see its README to rebuild or bump) |
| Licences | `licenses/` in this directory |

## What is here

| File | Origin | SHA-256 |
|---|---|---|
| `pyodide.js` | Pyodide 314.0.7 core | `3141b814715a72e59b51b1b18b9ceae5bf19f7c852417e431bb0a34feadf825c` |
| `pyodide.asm.mjs` | Pyodide 314.0.7 core | `f7cdc8ece80678ceb712f8e65ebe6d3a83203a180c399865f49612a051693635` |
| `pyodide.asm.wasm` | Pyodide 314.0.7 core | `cc36e3cab04fdfc9a63ff13eb52eae2b911bf46c025cc7b281f394bd3de1d5e6` |
| `python_stdlib.zip` | Pyodide 314.0.7 core's, boot modules as `.pyc` (`pymol-wasm/` builder) | `26a668c6cefb4a4aa3cb653727e23cbc5baeeff5332be8d1f017fd8eeeebdfbf` |
| `numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl` | Pyodide 314.0.7 numpy wheel (`a292c1f5…`) less 206 members no run reads (`pymol-wasm/numpy_trim.py`) | `ac2db75025a6dd4ce140c571d60c11f61b0c2010f879865952e513c57ff3d9b0` |
| `pymol-3.2.0a-cp314-cp314-pyemscripten_2026_0_wasm32.whl` | `pymol-wasm/` builder | `45f41f18b403ecdc9713bfef26e6194ae7483dbbdcf3cd95fe6022a7f98585fd` |
| `pyodide-lock.json` | written by the builder (core `info` + numpy + the PyMOL wheel) | — |
| `../pymol-host.html`, `host.js`, `worker.js` | written here, not upstream | — |

`sha256sum pyodide.* python_stdlib.zip *.whl` in this directory verifies the
binaries. `pyodide-lock.json` is regenerated, not upstream: it keeps Pyodide's
own `info` block and numpy entry (its sha256 the trimmed wheel's above) and adds
the PyMOL wheel with the sha256 above,
so the frame can `loadPackage(['pymol'])` by name.

## A modified build of Open-Source PyMOL

The PyMOL in this directory is NOT Schrödinger's PyMOL product, nor an
unmodified build of pymol-open-source `edcda80f`: AgDB's builder changes it as
listed here (sources: `pymol-wasm/patches/`, `pymol-wasm/README.md`). The
upstream file headers are left as they are. `patches/` beside this README holds
a byte-identical copy of each patch: the full HTML app carries them for its
HELP tab 「改良点」 (`PYMOL_PATCH_FILES` in
`frontend/src/pages/structure-html-export/standaloneFormat.ts`).

| Patch / step | What it changes |
|---|---|
| `0001-memoryusage-emscripten` | `memory_usage()` / `memory_available()` return 0 under emscripten |
| `0002-shaders-webgl1-fragdepth-ext` | cylinder / sphere shaders write `gl_FragDepthEXT` on WebGL1 |
| `0003-glgenbuffer-clear-stale-errors` | stale GL errors are drained before `glGenBuffers` |
| `0004-replabel-es2-use-label-shader` | labels use the label shader on ES2 |
| `0005-shadermgr-webgl2-glsl-es300` | the ES2 shaders are rewritten to GLSL ES 3.00 on WebGL2 |
| `0006-chempy-restricted-unpickler` | sessions are unpickled through an allow-list (`chempy/pkl.py`) |
| `0007-typeface-truetype-modules-only` | FreeType registers only the four modules the bundled TrueType fonts use |
| `0008-repsurface-empty-va-is-null` | an opaque surface no longer takes the per-vertex-transparency path (no per-frame sort; `transparency_global_sort 1` draws it) |
| `0009-map-express-two-pass-triangle-start` | neighbour lists built in two passes at their exact size, cleared on an interrupt; a loop-invariant test moved out of the surface start search (rewritten from the idea of pymolish-studio 3e4218d / 3f91dbe; no code taken) |
| `0010-utf8-byte-lengths-upstream-522` | upstream #522 (bebf5f0644): buffers sized by UTF-8 bytes, not code points |
| `0011-mypng-failed-read-builds-no-image` | a PNG read that fails builds no image (width / height start at 0, data-URI length checked; a size whose byte count does not fit `size_t` / `int` is refused before allocating, an arithmetic check: no size limit added) |
| `0012-text-sans-four-fonts-fallback` | only the four DejaVu Sans faces are compiled in (label fonts 5–8: Sans, Sans Oblique, Sans Bold, Sans Bold Oblique); any other label font id ≥ 5 (Serif, Mono, Gentium, or an id a session brings) is drawn as Sans instead of not at all |
| `0013-shadermgr-es300-without-regex` | patch 0005's GLSL ES 3.00 rewrite done with plain string scans instead of `std::regex` (byte-identical output, checked over every shader and preprocessor combination at build time) |
| `0014-chempy-pkl-bundled-c-unpickler` | `chempy.io.pkl.fromFile` reads the bundled data under `$PYMOL_DATA` (fragments, mutagenesis side-chain libraries) with Python's C unpickler; sessions still go through the restricted unpickler only |
| build flags (`compile.sh`, `link.sh`) | `-fvisibility=hidden -fvisibility-inlines-hidden`; `_cmd` linked with `-sSIDE_MODULE=2`, exporting only `PyInit__cmd` |
| wheel contents (`wheel.sh`, `pymol-wasm/s1_drop.json`) | 61 data files no code reads (the on-disk shaders, `data/startup`, `setting_help.csv`, splash / icon images, the sidechain generator scripts and `sc_library.pkl`) and 31 Python modules that cannot run in the browser (Qt, plugins, the HTTP / RPC servers, demo wizards, external-program bindings) are left out, as is `data/chempy/tinker` |
| numpy wheel (`numpy_trim.py`, `numpy_drop.json`) | Pyodide's numpy wheel less 206 members no run reads: type stubs, C headers, static libraries, C / Cython sources, build configuration, the PyInstaller hook, the doc module and pytest's conftest (every licence file and every runtime module kept, byte for byte) |
| data re-encoded (`repickle.mjs`, `cmyk_refilter.py`) | the 133 bundled fragment / sidechain pickles rewritten with pickle protocol 4 (objects identical); `cmyk.png` re-compressed losslessly (gAMA / tEXt kept, pixels identical) |
| `.pyc` (`pyc_compile.mjs`, `pyc_assemble.py`, `pyc_targets.json`) | the 68 wheel modules imported at start-up carry `__pycache__/*.pyc` beside their `.py` (`chempy/pkl.py` stays source only); the stdlib zip carries its 167 start-up modules as sourceless `.pyc` (`licenses/SOURCE.pyodide.txt` says what that means for the MPL / PSF parts) |

Five files reach the worker as bytes the parent page fetched same-origin and
checked against SHA-256: `pyodide-lock.json`,
`python_stdlib.zip`, `pyodide.asm.wasm` and the two wheels — exactly what
Pyodide asks the worker's fetch shim for. The digests are the parent's table
in `frontend/src/pages/pymol-viewer/pymolAssets.ts`, which also pins the lock
(whose row above carries no digest).
`pyodide.js` (importScripts) and `pyodide.asm.mjs` (dynamic import) are never
handed over: the worker loads them from the network under the frame CSP's
`script-src`. The handshake carries the runtime base
the parent keyed those five to, `host.js` refuses a base that is not its own
directory, and once the parent has handed anything over, the worker's fetch
shim refuses a lock, zip, wasm or wheel it was not handed.

## The three files AgDB wrote

`../pymol-host.html` (a version-less path, the same across version bumps),
`host.js` and `worker.js` are the isolation layer, not upstream code.
Read their header comments before changing how the engine is
loaded, the handshake is accepted, or the restricted unpickler is installed.
An open tab keeps the page code it was loaded with, but every frame it builds
loads `host.js` and `worker.js` fresh, so the handshake carries a protocol
number (`PROTOCOL` in `host.js`, `PYMOL_FRAME_PROTOCOL` in the page) and
`host.js` refuses another one, which the page shows as a request to reload.
Raise both when a change alters a message an open page sends or expects.
`pymolHostHandshake.test.ts` pins the two files' digests, so every change has
to be classed one way or the other.
The web server that serves these files sets the frame's response headers.

## The standalone HTML export (frame protocol 4)

The standalone HTML file is one `.html` that opens offline
from `file://` and runs this same `worker.js`, with no `host.js`: a minimal
in-page host spawns it as a classic blob Worker under the page's own
`<meta>` CSP. The worker is one script the page builds from bytes embedded
in the file — a prelude, `pyodide.js`, `pyodide.asm.mjs` turned into a
classic script, then `worker.js` — and loads no script of its own: WebKit
refuses the worker a `blob:` URL it mints itself (from a `file://` page and
in a sandboxed frame alike), and Chrome, from a `file://` page, one
the page minted (measured 2026-11-15). `worker.js` has two
things for it, and nothing in the AgDB frame can reach either:

- the core hook: `importCore` takes `self.__AGDB_CORE_FACTORY` when the
  page's script left one before `init`, else imports the network URL. No
  message carries it.
- `applyLook{bytes}`: rebuild a scene from a look. `host.js` never forwards
  it (it is not in its `IN` set); only the standalone page posts it.

The look itself comes from the AgDB frame as `exportLook{nonce}` →
`look{nonce, bytes}`, through the same click-scoped export gate as a
molecule file, capped at 64 MiB. It is JSON DATA, never a session (a `.pse`
is an unrestricted pickle): per molecule object the current state
as mmCIF written by PyMOL (plus `_struct_conf` / `_struct_sheet_range`
loops, which PyMOL's writer leaves out), each atom's colour (0xRRGGBB) and
representation bitmask, and the object's values of the allow-listed
settings (`LOOK_NUM_SETTINGS` / `LOOK_COLOR_SETTINGS` in `worker.js`), plus
the view, the background and the global values; non-molecule objects are
listed as skipped. The export proves the atom order for every object (it
reads the written text back with `retain_order` and compares atom by atom,
`_atom_site.id` included) and refuses the export otherwise. `applyLook`
parses with `json.loads` (no NaN), checks every field, sets only
allow-listed setting names, loads with `retain_order=1` / `auto_dss=0` and
checks the atom count — fixed Python only, nothing from the data is run as
code or a command line. `frontend/src/pages/pymol-viewer/pymolLook.ts` is
the page-side parser; its test holds the allow-lists and caps equal to
`worker.js`.

## Re-vendoring

Bump and rebuild in `pymol-wasm/` (its README), then copy `dist/pyodide-core/`'s
four core files and the two wheels here under a NEW `<ver>/` directory (never
new bytes under an old name: an open tab would check them against the old
digests), write a fresh `pyodide-lock.json` from the new core lock, refresh the
digest table above and `vendoredPymol.test.ts`, copy `pymol-wasm/patches/*.patch`
into the new directory's `patches/` (and `PYMOL_PATCH_FILES`, `codeChanges.ts`
for a patch added or dropped), update `PYMOL_RUNTIME_VERSION`,
`PYMOL_ASSET_DIGESTS` and `PYMOL_ASSET_BYTES` in
`frontend/src/pages/pymol-viewer/pymolRuntimeManifest.ts` (the lock's digest
included, from `sha256sum pyodide-lock.json`), the script src in
`../pymol-host.html` and the version name in the tests that read a runtime file
by path. Keep the previous directory, frozen, until the next bump, and
re-run the browser checks. A version bump adds 15–22 MB to git history.
