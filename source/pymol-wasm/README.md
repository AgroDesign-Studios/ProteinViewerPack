# pymol-wasm — the pinned builder for the in-browser Open-Source PyMOL

Builds Open-Source PyMOL as a [Pyodide](https://pyodide.org) 314.0.7 side-module
wheel, reproducibly, from pinned inputs. The output is what the in-browser PyMOL
page runs inside its sandboxed, opaque-origin frame. Nothing here runs in
the app: the wheel and the Pyodide runtime are vendored into
`frontend/public/vendor/pymol/<ver>/` by a separate step, and users install
nothing.

These scripts port the build scripts of an earlier prototype build ("the
prototype" below).

## Files

| File | What it is |
|---|---|
| `Dockerfile` | The builder image: `python:3.14.2-slim-bookworm` pinned by digest, git/curl/bzip2/xz, `pyodide-build==0.39.1`. Toolchain host only. |
| `build-in-docker.sh` | Host driver: builds the image, runs `build.sh` N times (default 2) in fresh tmpfs containers at different work-dir paths, requires identical outputs, compares them with `MANIFEST.sha256`, removes the image. |
| `build.sh` | The build, inside the container: fetch and verify every input, apply the patches, run the tests, compile, link, assemble the wheel, check it, stage it, write the manifest. All pins live at its top. |
| `env.sh`, `compile.sh`, `link.sh`, `wheel.sh` | The prototype's scripts with the job paths turned into a `<work-dir>` argument and the reproducibility fixes below. |
| `make_wheel.py` | Writes the wheel as a deterministic zip (`write_wheel`, also used by the `.pyc` stage); `--drop` removes exactly `s1_drop.json`'s members from the stage, failing on a missing member or counts other than 61 / 31. |
| `s1_drop.json` | S1: the 61 data files nothing reads and the 31 Python modules that cannot run in the browser, as wheel member names, plus the members that must stay. |
| `repickle.mjs` | S1: rewrites the 133 bundled chempy pickles in the stage with protocol 4, in the pinned core's CPython under node (pymol not imported), asserting a fixed point. |
| `cmyk_refilter.py` | S1: re-encodes `data/pymol/cmyk.png` losslessly with the standard library (gAMA and tEXt kept, pixels asserted identical). |
| `pyc_targets.json` | S1: the boot modules to ship as `.pyc` (stdlib 167, wheel 68; `chempy/pkl.py` never), selected in REAL Chrome (`bench/pyc/`), an input like a patch. |
| `pyc_compile.mjs`, `pyc_assemble.py` | S1, `build.sh` step 5b: compile the targets with the runtime's own CPython (the pinned core under node, one fresh process per kind; stdlib without, wheel with the column table; unchecked hash), then put them in place: sourceless `.pyc` in the stdlib zip (re-packed at deflate 9), `__pycache__/*.pyc` beside the kept `.py` in the wheel. |
| `numpy_trim.py`, `numpy_drop.json` | S2, `build.sh` step 2: the numpy wheel that ships is the pinned one less exactly the 206 members `numpy_drop.json` names (type stubs, headers, static libraries, C / Cython sources, build configuration, the PyInstaller hook, the doc module, pytest's conftest; `numpy/testing` and `numpy/f2py` keep their `.py`). Every kept member is copied byte for byte (local record and central entry), RECORD loses only the dropped rows, the file name stays; it refuses an input other than the pinned wheel, a list the documented rule no longer yields, or counts other than its own pins. The compile still reads the numpy headers from the original wheel. |
| `check_no_emjs.py` | Refuses a wasm module that carries EM_JS / EM_ASM / `run_script` / asm-const (each would need `'unsafe-eval'`). |
| `patches/0001`–`0014` | Applied in order to pymol-open-source `edcda80f`. 0001–0005 are byte-identical to the prototype's; 0006 is the restricted unpickler; 0007–0011 are S1 (FreeType modules, RepSurface `va`, Map + Triangle, upstream #522, MyPNG); 0012–0014 are S2 (the four Sans label fonts with a fallback, the GLSL ES 3.00 rewrite without `<regex>`, the bundled `.pkl` through the C unpickler) — table at the end. |
| `shim/os_gl_es.h`, `shim/gl_legacy_stub.h` | Stand-ins for Schrödinger's private GL header (from the prototype). |
| `INPUTS.sha256` | sha256 of every patch and shim and of the eight stage inputs (`s1_drop.json`, `repickle.mjs`, `cmyk_refilter.py`, `pyc_targets.json`, `pyc_compile.mjs`, `pyc_assemble.py`, `numpy_trim.py`, `numpy_drop.json`); `build.sh` refuses to start on a mismatch, or on a list that is not exactly those. |
| `MANIFEST.sha256` | sha256 of every file under `dist/` and `build/`. Two builds must reproduce it byte for byte. |
| `third_party_notices.py`, `notices/` | Gathers, verbatim from the PyMOL source tree, the notices of the other people's code in the wheel — compiled into `_cmd` (pocketfft, the ilastik-based marching cubes, Mersenne Twister, ccealign, TNT/JAMA, the GLUT bitmap fonts and the four DejaVu Sans faces, Mesa's matrix routines, the cited base64 table, Jenarix, the public-domain VRML2 export and hash) or shipped as Python source (Thomas Holder's BSD-2-Clause module `pymol/morphing.py`; the S1 drop list's files are not scanned, since they do not ship) — into the runtime's `licenses/NOTICES.pymol-third-party.txt`. Every notice-like line in those files must be quoted or carry a written reason, checked per comment block. `NOT_COMPILED` names a file in a compiled folder that the wasm build does not compile (Gentium's `layer1/FontTTF2.h`, compiled out by patch 0012), with its includer and why; the run fails when that stops being true (the file is gone, or an `#include` of it sits on a line the wasm build compiles), and when `Text.cpp` references any TrueType face other than the four Sans ones on such a line. So it runs on the PATCHED tree: `build.sh` step 4 runs it on every build and writes the text to `reports/`. `notices/` holds the upstream licence texts the tree does not carry (`notices/README.md` says from where). `tests/test_third_party_notices.py` covers its scanner and the `NOT_COMPILED` / faces checks. |
| `runtime_notices.py` | Writes `licenses/NOTICES.pyodide-core.txt` (what Pyodide links into `pyodide.asm.wasm` besides CPython: CPython's incorporated-software licences, Expat, HACL*, mimalloc, libffi, bzip2, liblzma, Zstandard, SQLite, hiwire, from pinned upstream files) and `licenses/NOTICES.numpy-bundled.txt` (every licence file NumPy's wheel lists, read out of the vendored wheel). Re-run after a Pyodide or NumPy bump. |
| `tests/` | `test_restricted_unpickler.py` and `test_check_no_emjs.py` (stdlib only), `smoke_wheel.mjs` (the built wheel in a real Pyodide runtime, headless), the four `frame_*.mjs` / `pt2891_frame_defences.mjs` real-runtime tests of `worker.js` (hand-run, `tests/run_runtime_tests.sh`), the EM_JS positive / negative controls, `npy_abi_probe.cpp` (the numpy ABI check below, compiled by `compile.sh` with the real include set), and the gates below. |
| `tests/check_side_modules.py` | The side-module gate: every import of `_cmd` / `_champ` has a provider in the loader's order (own export, a main-module export of the same kind, a `wasmImports` key of `pyodide.asm.mjs`, or `__memory_base` / `__table_base`); each module starts with `dylink.0` and exports `PyInit_<name>`, `__wasm_call_ctors`, `__wasm_apply_data_relocs`. Self imports are counted and limited by `--max-self-imports N`; `build.sh` passes 0 (the S1 `_cmd` has none; the build before S1 had 615). Exit 2 on unreadable input, never a pass. |
| `tests/side_module_controls.py` | Its positive controls on the real modules, no compiler: tampered copies (an import renamed or appended, each required export renamed away, the self-import limit) must fail for that reason, the untouched copy must pass. |
| `tests/check_pyc.py` | The `.pyc` gate, run by `build.sh` step 5b with `--targets pyc_targets.json --expect-pyc`: magic, unchecked-hash flags, source hash beside each wheel `.pyc`, sourceless stdlib, `chempy/pkl.py` kept as source with patch 0006's marks, member order, `--targets` (schema in its header), `--expect-pyc`. |
| `tests/tests_summary.py` | Judges the real-runtime tests by their own JSON verdicts (`expectations`, `ok` + `results` / `failures`); a missing key or `--require`d report fails. |
| `tests/test_check_side_modules.py`, `tests/test_check_pyc.py`, `tests/test_tests_summary.py` | stdlib-only unit tests on synthetic modules, zips and report dirs; `build.sh` runs all three, with `test_make_wheel.py`, `test_pyc_assemble.py`, `test_cmyk_refilter.py` and `test_third_party_notices.py`. |
| `tests/utf8_probe.mjs`, `tests/bg_image_probe.mjs`, `tests/interrupt_probe.mjs`, `tests/pickle_identity.mjs`, `tests/cmyk_table.mjs` | The S1 probes, run by `build.sh` step 7c on the final wheel and core (each case in its own `worker_threads` Pyodide, guarded, time-limited): UTF-8 wizard / scene text handling, background image handling, interrupt handling (the 17 conditions give the shipped values), the protocol-4 pickles load to identical objects, `space cmyk` gives a bit-identical table. `node <probe> <core> <numpy.whl> <pymol.whl> <report.json> [reference]`; exit 0 and an all-true `expectations`. |
| `tests/font_fallback_probe.mjs`, `tests/bundled_pkl_probe.mjs`, `tests/numpy_import_probe.mjs` | The S2 probes, step 7c, same shape: ray-traced labels with `label_font_id` 9–18 and ≥ 19 pixel-identical to Sans (5), 6–8 their own faces, distance / dihedral / session labels drawn (patch 0012); the 133 bundled pickles through the C unpickler identical to the pure-Python path, the `$PYMOL_DATA` boundary, the mutagenesis wizard / fragment / fab identical on both paths, a crafted `.pse` refused (patch 0014); every module of the pinned numpy wheel importing from the trimmed one exactly as from the original, with a built-in over-trimmed control (`numpy_import_probe.mjs <core> <original numpy.whl> <trimmed numpy.whl> <report.json>`). |
| `tests/es300_rewrite_test.cpp`, `tests/run_es300_rewrite_test.sh` | S2, step 4: patch 0013's hand-written GLSL ES 3.00 rewrite against patch 0005's `std::regex` version kept verbatim in the test, over every shader × preprocessor-variable combination the shipped build can make (the REAL `ShaderPreprocessor.cpp` with stubs, fed `create_shadertext.py`'s texts) and an adversarial corpus, with a positive control per rewrite rule; the build compiles it with `em++` (emscripten's libc++, the shipped regex) and runs it under emsdk's node. Natively: `bash tests/run_es300_rewrite_test.sh <patched tree> <out dir>` (host `g++`; `ES300_FULL=1` for the full cross product). |
| `tests/test_numpy_trim.py` | stdlib unit tests of `numpy_trim.py` on synthetic wheels (step 4). |
| `tests/map_equality.mjs`, `tests/map_worker.mjs`, `tests/map_compare.py` | Hand-run (S1): the 513 Map-dependent results (bonding, distance selections, dss, h_add, areas, surfaces, maps, ...) on 1hsg / 4ake / 8jxu / 1d3z of one wheel; `map_compare.py` exits 0 only when two wheels' results are identical. |
| `tests/fetch_pyodide_core.sh <dest>` | Fetches, verifies (pin read from `build.sh`) and unpacks the Pyodide core, which supplies the `pyodide.mjs` the vendored runtime lacks. |
| `tests/run_runtime_tests.sh <core-dir> <runtime-dir> <out-dir>` | Host runner, no docker: the five real-runtime tests (under `bench/lib/guard_preload.mjs`), `tests_summary.py`, `check_side_modules.py` and `check_no_emjs.py` against a runtime dir. They run in no CI. |
| `bench/` | Hand-run measurements for PR bodies (start-up, frame path, memory, HTML size, `.pyc` targets, rendering, GL counts, surface, the menu sweep, the menu/settings data generator); `bench/README.md` is the index. |

There is no `requirements.txt` here: `pyodide-build` is pinned in the
Dockerfile instead.

## Rebuilding

Needs docker and free space on `/`: the driver refuses below a floor of 70 GB
by default (`MIN_FREE_GB=<GB>` sets another). Network: `build.sh`'s own downloads
go to GitHub, storage.googleapis.com and cdn.jsdelivr.net; the image build also
reaches Docker Hub, the Debian mirrors (apt) and PyPI (pyodide-build and its
dependencies) on a host without a warm cache. Each run keeps about 2 GB in a
RAM-backed tmpfs and nothing heavy on disk.

```bash
bash pymol-wasm/build-in-docker.sh --out "$(mktemp -d)"
```

It runs `build.sh` twice (`/w/a` and `/w/second-run/nested` as work dirs),
fails if the two `MANIFEST.sha256` differ, then fails (exit 3) if they differ
from the committed one. Outputs land in `<out>/run1/`:

- `dist/` — `pymol-3.2.0a-cp314-cp314-pyemscripten_2026_0_wasm32.whl`, the
  numpy 2.4.6 wasm wheel, and `pyodide-core/` (the unpacked Pyodide 314.0.7 core:
  `pyodide.js`, `pyodide.asm.mjs`, `pyodide.asm.wasm`, `python_stdlib.zip`,
  `pyodide-lock.json`, …; the zip is the `.pyc` stage's, every other file the
  release's). This is what the vendoring step copies from.
- `build/` — `_cmd` and `_champ` on their own, to compare builds.
- `reports/` — test output, `check_no_emjs*.json`, `compile_result.txt`,
  `build-info.txt` (versions, timings) and the compiler logs.

Resource limits, defaults the caller can lower: the containerised build runs
under `--cpus` `CPUS` with up to `JOBS` compile jobs (both 24 by default,
clamped to 1..24) and `nice -n 19` on
the build.sh process inside the container, never `--gpus`; the outer `nice` on
`docker build` only slows the CLI. The tagged builder image is removed on exit
(`--keep-image` keeps it); the base image and BuildKit cache layers are left
for reuse. The driver mounts a snapshot of this directory, so editing a script
during a run does not reach the running build.

What `build.sh` stops on (non-zero exit): `INPUTS.sha256` mismatch, or a list
that is not exactly the patches, shims and eight stage inputs on disk; a numpy
wheel or drop list `numpy_trim.py` refuses; third-party notices that do not
generate on the patched tree (an uncovered notice, a stale `NOT_COMPILED`
entry, linked faces other than the four Sans ones); a difference between patch
0013's GLSL rewrite and patch 0005's regex version, or a compiled source still
using `<regex>`; a download or checkout that is not the
pinned sha256 / commit, or an `emcc --version` that is not the pinned build; a
failing unpickler or checker test; the numpy ABI probe in `compile.sh`;
any failed translation unit; an EM_JS / EM_ASM / run_script marker in `_cmd` or
`_champ`; a checker that does not flag its EM_JS positive control (in both an
import and an export) or that flags its plain negative control; a failing
unit test (`tests/test_*.py`, step 4); an S1 data stage that finds a listed
member missing, a count other than 61 / 31, a pickle set other than 133 or a
pickle that is not a fixed point, or a cmyk.png whose pixels would change; a
`.pyc` stage that cannot compile or assemble `pyc_targets.json`, or whose
output fails `tests/check_pyc.py` (exactly the targets, the runtime's magic,
unchecked hash, source hash, sourceless stdlib, `chempy/pkl.py` source only);
a side-module import that no loader source provides, any self import, or a
missing `PyInit_*` /
`__wasm_call_ctors` / `__wasm_apply_data_relocs` export
(`tests/check_side_modules.py`); a side-module gate that passes one of
`tests/side_module_controls.py`'s tampered copies; a wheel whose side modules
are not the ones just built or whose `chempy/pkl.py` lacks patch 0006's
markers; a wheel that fails `tests/smoke_wheel.mjs` on the final core (the
`.pyc` stdlib zip), or whose `reports/smoke_wheel.json` has a false or missing
verdict (`tests/tests_summary.py`); an S1 / S2 probe (step 7c) that fails or whose
report is not all true; and, run on its own with `VERIFY_MANIFEST` unset, an
output that differs from `MANIFEST.sha256`.

The S1 wheel (2026-11-17): the wheel is 5,519,720 B (was 5,807,696),
`_cmd` 7,893,218 B (was 9,007,372) with 0 self imports (was 615), the stdlib
zip 2,961,852 B (was the core's 2,545,637: 167 sourceless `.pyc`, deflate 9).
Order inside `build.sh`: compile / link / `wheel.sh` (with the S1 data stage)
-> step 5b, the `.pyc` stage, the LAST change to either archive (an
unchecked-hash `.pyc` does not notice an edited `.py`) -> the gates on the final
files. A full run takes about 105 s; `--runs 2` twice (a new image and new
containers the second time) reproduced every byte.

The S2 wheel (2026-11-18): patches 0012–0014 and the numpy trim stage. The
wheel is 4,261,708 B (S1 5,519,720), `_cmd` 5,558,818 B (S1 7,893,218; the ten dropped TrueType faces
are 2,279,816 B of it), the shipped numpy wheel 2,568,340 B (pinned
2,960,568), the stdlib zip unchanged. A full run now takes about 280 s, most
of the extra in step 4's em++ build and run of the GLSL rewrite test (130,895
strings); `--runs 2 --update-manifest` and then `--runs 2` again reproduced
every byte.

The S3 wheel (2026-11-22): the comments patches 0006, 0011 and 0014 add are
worded shorter (no internal document or task names, the fixed weaknesses
named but not how they were reached); their code is unchanged. `--runs 1` on
the S2 inputs first reproduced the S2 manifest, then `--runs 2
--update-manifest` agreed byte for byte. Only the PyMOL wheel's line moved:
4,261,268 B (S2 4,261,708), its members differing only in `chempy/pkl.py`
(comments; same tokens and AST without them) and that file's `RECORD` row.
`_cmd`, `_champ`, the numpy wheel and the stdlib zip are byte-identical to
S2's; 0011's comment keeps its line count, so `MyPNG.cpp`'s line numbers do
not move.

## Checking a runtime by hand: tests/ and bench/

The real-runtime tests run in no CI. After any change to `worker.js`,
`host.js` or the runtime, run them against the runtime dir:

```bash
bash pymol-wasm/tests/fetch_pyodide_core.sh "$SCRATCH/core"
bash pymol-wasm/tests/run_runtime_tests.sh "$SCRATCH/core/pyodide" frontend/public/vendor/pymol/<ver> "$SCRATCH/rt-tests"
```

`bench/` holds the measurements a version bump, the S1 / S2 PRs and any
`worker.js` change paste into their PR bodies (`bench/README.md`: when to run
which tool, the commands, how to report). Five rules every tool here keeps:

1. **node's Pyodide runs the HOST shell.** Under node, `os.system`,
   `cmd.system` and `chempy.bmin` reach `child_process.spawnSync`
   (`pyodide.asm.mjs`). Any node process that loads Pyodide calls
   `bench/lib/guard_host.mjs`'s `guardHost()` first (or runs under
   `node --import pymol-wasm/bench/lib/guard_preload.mjs`), and starts no
   child process of its own.
2. **Never run `emcc` / `em++` / `embuilder` on the host.** emscripten's
   start-up check wipes the shared cache. Builds run only in
   `build-in-docker.sh`; a host relink calls `wasm-ld` directly.
3. **CDP CPU throttling does not slow a worker** in Chrome 156, and PyMOL runs
   in one. The slow-device stand-in is the duty method (`bench/lib/duty.mjs`:
   SIGSTOP / SIGCONT of only the renderers of the Chrome the tool launched,
   SIGCONT on every ending).
4. **Memory only after a forced GC** (`--js-flags=--expose-gc`, `gc()` twice,
   1.5 s, then PSS — without it PSS moves by tens of MB). **Rendering only as
   decoded RGBA with a positive control** — lit-pixel counts cannot see a
   difference.
5. **Speed only as the median of alternating paired differences** (n ≥ 6;
   duty n ≥ 4), never while a build, a full vitest or another measurement
   runs (other load moves the values), with variant names
   matched exactly (a prefix match counts `S1-nopyc` as `S1`).

**A PR that changes what `worker.js` imports** (or the Python it runs at boot)
must confirm in REAL Chrome that, during boot, only `chempy/pkl.py` is compiled
from `.py` — the S1 wheel ships every other boot module as `.pyc`, selected in
real Chrome (node misses the four `multiprocessing` modules only the Chrome
worker imports), and `pkl.py` stays source because patch 0006's build check and
the frame's allow-list check read it:

```bash
node pymol-wasm/bench/pyc/pyc_boot.mjs --out-dir "$SCRATCH/pyc" --rt <runtime dir with the PR's worker.js> \
  --mode compiles --label pr --expect-only-pkl
```

Exit 0 with `only chempy/pkl.py: YES` passes. Otherwise re-select the target
list in real Chrome and rebuild (`bench/README.md` § A PR that changes what
worker.js imports). On the runtime before S1 it printed the baseline instead
(236 modules compiled from source at boot) and exited 1.

## Pins

All in `build.sh` unless noted.

| Input | Pin | Checked by |
|---|---|---|
| Base image | `python:3.14.2-slim-bookworm@sha256:e87711ef…` (Dockerfile) | docker (digest) |
| pyodide-build | `0.39.1` (Dockerfile) | `importlib.metadata` |
| emsdk | tag `5.0.3` = commit `a620cf1d…` → release `065bfade…`, emcc build `285c424d…` | `git rev-parse`, `.emsdk_version`, `emscripten-version.txt`, `emcc --version` (the toolchain tarballs themselves are TOFU over HTTPS keyed by the release hash) |
| Pyodide cross-build env | `314.0.7` | sha256 over its CPython include tree |
| pymol-open-source | `edcda80f3a73ebf0b5922991f85910d17ffbcce5` | `git rev-parse` |
| glm | tag `1.0.1` = commit `0af55cce…` | `git rev-parse` |
| Pyodide core | `pyodide-core-314.0.7.tar.bz2`, sha256 `2abdcc2e…` | sha256 |
| numpy wasm wheel | `numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl`, sha256 `a292c1f5d7d8…` (the input: the compile's headers come from it; the wheel that ships is its `numpy_trim.py` output, same name) | sha256, and the pinned core's `pyodide-lock.json` must name the same file and hash; `numpy_trim.py` pins the same sha256 and its 415 members |
| Patches, shims, stage inputs | `INPUTS.sha256` | `sha256sum -c` |

The apt packages in the image are not pinned: none of them writes a byte of the
output.

## Reproducibility

A from-scratch rebuild of the prototype's wheel differed from it for four
reasons, each closed here:

| Leak | Fix |
|---|---|
| Absolute build paths in `__FILE__` / assert strings (glm, CPython headers) | `-ffile-prefix-map` maps the work dir and the script dir to fixed names; the driver's two runs use different WORK dirs (the script dir is mounted at the same path in both, so the two-path run proves the work-dir mapping) |
| Link order followed the locale's glob order | `LC_ALL=C` everywhere, and the object list is sorted explicitly |
| `_PyMOL_BUILD_DATE` from the clock | `SOURCE_DATE_EPOCH` = the pinned PyMOL commit's commit time |
| zip member order, timestamps and modes | `make_wheel.py`: byte-ordered members (dist-info last), every entry dated `SOURCE_DATE_EPOCH`, mode 0644, fixed deflate level |

Also fixed from that rebuild: the numpy headers come only from the sha-checked
numpy **wasm** wheel. The prototype put the host x86_64 numpy include dir on the
path, and every TU then saw `NPY_SIZEOF_LONG=8` against `sizeof(long)=4`.
`tests/npy_abi_probe.cpp` fails the build if that ever comes back, and the
build checks with `-H` that every numpy header resolved inside the wheel's
include dir.

What is left to the environment: the Python and zlib of the pinned base image
(they write the zip) and the pinned toolchain. Same image, same bytes.

## Patch 0006 — restricted unpickler

A `.pse` session is a pickle, and unpickling calls whatever callable the pickle
names. A session file can come from anyone, so it must not be able to run
code in the viewer. Patch 0006 changes
`modules/chempy/pkl.py` so that, as soon as `pymol` is imported, every
`loads()` a session reaches unpickles with `RestrictedUnpickler`: both
`chempy.pkl.cPickle.loads` and the stdlib `pickle.loads` / `pickle._loads`.

`RestrictedUnpickler.find_class` first applies `_compat_pickle`'s
`NAME_MAPPING` / `IMPORT_MAPPING` for protocols below 4 (so PyMOL 2.x-era
`__builtin__.bytearray` / `copy_reg._reconstructor` resolve, while
`__builtin__.eval` maps to `builtins.eval` and stays refused), then allows
exactly these 18 names and nothing else:

`pymol.Session_Storage`, `_codecs.encode`, `chempy.Storage`, `chempy.Atom`,
`chempy.Bond`, `chempy.models.Indexed`, `chempy.models.Connected`,
`builtins.bytearray`, `builtins.bytes`, `builtins.complex`,
`collections.OrderedDict`, `copyreg._reconstructor`, `numpy.dtype`,
`numpy.ndarray`, `numpy.core.multiarray._reconstruct`,
`numpy._core.multiarray._reconstruct`, `numpy._core.multiarray.scalar`,
`numpy.core.multiarray.scalar`.

It resolves an allowed name as one attribute of an imported module (never
pickle's dotted-path walk), checks before importing anything, sends extension
codes through `find_class` instead of pickle's process-wide cache, refuses
persistent IDs, and refuses BUILD on any object `find_class` handed out (BUILD
on a class or function would rewrite it for the whole process). Nothing turns
it off: no setting, argument or message.

**One allowed name may be resolved but never called directly.** A
legitimate array never calls `ndarray` directly — it calls
`numpy._core.multiarray._reconstruct(ndarray, shape, dtype)` and then BUILD, so
`ndarray` is only `_reconstruct`'s first argument. So `_NEVER_CALLED_DIRECTLY`
(= `numpy.ndarray`) is refused as the callable of any REDUCE / NEWOBJ /
NEWOBJ_EX / INST / OBJ, while still resolvable as an argument. `smoke_wheel.mjs`
checks that the direct call raises `UnpicklingError` and that object and
float arrays still round-trip.

**`builtins.bytes` is allow-listed.** An empty
bytes object pickles as `bytes()` below protocol 3 (non-empty bytes go through
`_codecs.encode`), which a `pse_binary_dump` session's zero-length array
produces; before this, such a session was refused. `bytes()` has no side
effect, and what it allocates stays inside the isolated worker (the page that
hosts the frame caps the session size and rebuilds a worker that runs out of
memory).

Left alone on purpose: `cPickle.load` / `pickle.load` / `pickle._load` and the
`Unpickler` classes, which read the bundled, trusted fragments and
mutagenesis data. The frame refuses `.pkl` / `model` input from files and
asserts at start-up that `pickle.loads is chempy.pkl.restricted_loads`
(`tests/pt2891_frame_defences.mjs`).

Patch 0014 (S2) changes only which loader `PKL.fromFile` uses: a
file whose realpath lies inside the realpath of `$PYMOL_DATA` (the bundled
fragments and side-chain libraries; not a URL, `$PYMOL_DATA` set) is read with
the C `pickle.load`, everything else with `cPickle.load` as before. A session
is read with `fromString` / `loads()`, never `fromFile`, so sessions go only
through the restricted unpickler.
The two loaders can differ
only on a protocol < 3 string of non-printable bytes; the bundled pickles are
protocol 4 (S1), and `tests/bundled_pkl_probe.mjs` compares both paths on all
133 at every build. `tests/test_restricted_unpickler.py` pins the
`$PYMOL_DATA` boundary and that every session entry point still refuses a
payload, with live controls.

Two tests pin it. `tests/test_restricted_unpickler.py` runs against the
patched source (stdlib only, PyMOL and numpy stubbed) and pairs every refusal
with a run of the same bytes through the unrestricted C unpickler that must
show the payload's effect. `tests/smoke_wheel.mjs` loads the built wheel in
Pyodide (node, headless PyMOL) and checks the restriction is active after
`import pymol`, that a normal session saved by that PyMOL loads back, and that
payloads inside a session are refused, each with the same live control.

### Known limits

The allow-list is deliberately narrow; widening it is a decision of its own,
not a fix. Found while writing the tests:

- **Plain classes below protocol 2.** A protocol-0/1 pickle of an instance of a
  class without `__reduce__` (e.g. `chempy.Bond`) names
  `copy_reg._reconstructor` together with `builtins.object`, which is not
  allowed. `chempy.models.Indexed` also always carries a `chempy.Molecule`,
  which is not allowed either. Neither appears in a session `get_session`
  writes.

(The earlier empty-bytes limit is resolved: `builtins.bytes` is now
allow-listed, and `smoke_wheel.mjs` loads a `pse_binary_dump` session whose
bond-less object produces an empty bond blob.)

## check_no_emjs

`python3 -I check_no_emjs.py [--json REPORT] FILE…` parses each module
(imports, exports, custom-section names, `dylink.0` needed / export / import /
runtime-path info, the name section) and greps the raw bytes, case-insensitively,
for `__em_js__`, `em_js`, `em_asm`, `run_script`, `emscripten_asm_const`
(`run_script`, not `emscripten_run_script`, so it also catches
`emscripten_async_run_script`). Exit 0 clean, 1 a marker found, 2 not a readable
wasm module (fail closed — a malformed section or an unreadable path is exit 2,
never exit 1). `build.sh` runs it on `_cmd` and `_champ`, and on a real EM_JS +
EM_ASM + run_script + async_run_script side module built by the same toolchain
(`tests/emjs_positive.c`), which must exit 1 with a hit in both an import and an
export, and a plain one (`tests/emjs_negative.c`), which must exit 0.

## Editing a patch

Never run `pre-commit` (or an editor that strips trailing whitespace) over
`patches/*.patch`: a context line that is a single space is part of the patch,
and stripping it changes the sha256 or breaks `git apply`
(`.pre-commit-config.yaml` excludes them from `trailing-whitespace`). Regenerate
a patch with `git diff` in a checkout of the pinned commit, then refresh its
line in `INPUTS.sha256` (`sha256sum patches/*.patch shim/*.h s1_drop.json
repickle.mjs cmyk_refilter.py pyc_targets.json pyc_compile.mjs pyc_assemble.py
> INPUTS.sha256` from this directory) and rebuild with `--update-manifest`. The
same holds for an edit of any of those six files.

## Bumping a version

1. Change the pin(s) at the top of `build.sh` (and the Dockerfile for the base
   image or pyodide-build). A Pyodide bump moves several together: emsdk must
   be exactly what the new release's `Makefile.envs` names, its
   `EMCC_COMMIT`, the cross-build env's include-tree hash, the core tarball's
   sha256, the numpy wheel's name and sha256 from the new `pyodide-lock.json`,
   the Python / ABI tags in `env.sh` (`PY_TAG`, `PLATFORM_TAG`, the
   `PYODIDE_VER` that env.sh re-exports, and the `python-3.14.2` include path),
   and the `cpython-314` side-module names hard-coded in `build.sh` (the wheel
   content check), `link.sh` and `wheel.sh`.
2. Re-check that patches 0001–0014 still apply and still mean the same thing
   (0010 is upstream #522: drop it once the pin includes bebf5f0644; 0013 must
   still match 0005's passes, which `tests/es300_rewrite_test.cpp` checks), that
   `s1_drop.json`'s members still exist, re-derive `numpy_drop.json` from a new
   numpy wheel with the rule in `numpy_trim.py` (and its pins), and re-select
   `pyc_targets.json` in real Chrome (`bench/pyc/`); refresh `INPUTS.sha256`
   if any changed.
3. `bash pymol-wasm/build-in-docker.sh --update-manifest` — two runs must
   agree before the manifest is written.
4. Commit `MANIFEST.sha256` with the pin change, then re-vendor the outputs
   (step 3's directory and its digest test) in the same or the next PR.
5. Re-run the browser checks the vendoring step owns, in particular the
   representation-matrix smoke test patch 0005 needs.

Pyodide 315.0.0a2 (emscripten 6.0.5, Python 3.15.0rc1, ABI 2026_5) was
measured to build and load with these five patches and the numpy headers of
its own wasm wheel, but no bump is planned with this builder.

## Candidates for upstream

| Patch | What it does | Upstream? |
|---|---|---|
| 0001 `memoryusage-emscripten` | `memory_usage()` / `memory_available()` return 0 under `__EMSCRIPTEN__` as they already do under `_WEBGL` | yes — small and self-contained |
| 0002 `shaders-webgl1-fragdepth-ext` | cylinder / sphere fragment shaders write `gl_FragDepthEXT` on WebGL1 | yes |
| 0003 `glgenbuffer-clear-stale-errors` | drain stale GL errors before `glGenBuffers`, so an unrelated earlier error does not silently drop a representation's VBO | yes |
| 0004 `replabel-es2-use-label-shader` | labels use the label shader on ES2, which needs no geometry shader | yes |
| 0005 `shadermgr-webgl2-glsl-es300` | rewrites the ES2 shaders to GLSL ES 3.00 with regexes on a WebGL2 context | no — works, but brittle; upstream would want ES 3.00 shader sources |
| 0006 `chempy-restricted-unpickler` | the session allow-list above | no — this viewer's threat model, not a general PyMOL change |
| 0007 `typeface-truetype-modules-only` | FreeType registers only autofit, truetype, sfnt and smooth (S1) | maybe — harmless off the web, but upstream may want every font format |
| 0008 `repsurface-empty-va-is-null` | an empty per-vertex alpha array counts as none, so an opaque surface is not sorted every frame (S1) | yes |
| 0009 `map-express-two-pass-triangle-start` | neighbour lists in two passes at their exact size, reset on an interrupt; a loop-invariant test hoisted in TriangleFill (S1; rewritten from the idea of pymolish-studio 3e4218d / 3f91dbe, no code taken) | yes |
| 0010 `utf8-byte-lengths-upstream-522` | upstream #522 (bebf5f0644), byte lengths for UTF-8 buffers (S1) | already upstream — drop it on a pin bump |
| 0011 `mypng-failed-read-builds-no-image` | hardens PNG reading (S1) | yes |
| 0012 `text-sans-four-fonts-fallback` | under `__EMSCRIPTEN__`, only the four DejaVu Sans faces (label fonts 5–8) are compiled in and registered; any other id ≥ 5 draws with Sans instead of drawing nothing (in `CText::getFont`, which the GL and the ray label paths share) (S2) | hardly — it suits a web build only; upstream's `_WEBGL` path fetches the faces at run time instead |
| 0013 `shadermgr-es300-without-regex` | 0005's GLSL ES 3.00 rewrite as plain string scans (`layer0/ShaderEs300.h`), byte-identical output, without `<regex>` (S2) | with 0005 — this builder's own |
| 0014 `chempy-pkl-bundled-c-unpickler` | `PKL.fromFile` reads files under `$PYMOL_DATA` with the C unpickler (the bundled fragments and side-chain libraries) | maybe — it assumes printable-ASCII Python 2 strings in the bundled data, true of today's data |
