# AgroDesign Protein Viewer Pack (HTMLapp) — source

The source of the HTML app this repository releases: the code its files are built from, the
app's tests, the release scripts, and the builder of the in-browser Open-Source PyMOL runtime
it carries. It is cut from AgroDesign Studios' own repository at one commit, without that
repository's history, and holds only what the app, its build and its tests use.
`EXTRACT.json` names the commit and lists every file here with its SHA-256.

## What is here

| Path | What it is |
|---|---|
| `frontend/standalone/structure-viewer/` | The app: its entry, screens, HELP, the latest-version tab and the release signature check (`releaseSignature.ts`) |
| `frontend/src/` | The parts of AgroDesign's web application the app shares: the 3Dmol.js viewer, the PyMOL frame and dialogs, number and date formats, the test setup |
| `frontend/vite.structure-viewer.config.ts`, `frontend/vite-plugins/` | The build: one self-contained HTML file per edition |
| `frontend/public/vendor/pymol/3.2.0a-edcda80f-s3-pyodide-314.0.7/` | The in-browser runtime: Pyodide 314.0.7, Open-Source PyMOL 3.2.0a with 14 patches, NumPy; its `README.md` says what each file is, `licenses/` holds their licences |
| `pymol-wasm/` | The pinned, reproducible Docker builder of that runtime (its `README.md`). `pymol-wasm/bench/` is left out — AgroDesign's measurements of the runtime — except the helper modules the builder and its tests import |
| `scripts/` | The release build (`viewer_pack_release.mjs`), the signature format (`viewer_pack_signing.mjs`), the reproducibility check (`viewer_pack_reproduce.mjs`) and the clean-container build (`viewer_pack_source_build.sh`) |
| `EXTRACT.json` | The commit this source was cut from, and each file's size, SHA-256 and origin |

A few files differ from the commit, and `EXTRACT.json` says so in each one's `from`: the text
files under `frontend/src/i18n/locales/` keep only the keys the app uses (`strings`),
`frontend/src/index.css` only the rules the app can use (`css-prune`),
`frontend/package.json` and `frontend/package-lock.json` name only the packages the app needs,
at the versions AgroDesign's lockfile pins, and `frontend/src/utils/errorCapture.ts` is a
one-line stand-in for the web application's error-reporting module, which the app replaces
with an offline one (`shim`).

## Build and test

With Docker, from this folder:

```bash
scripts/viewer_pack_source_build.sh --work /tmp/pvp-build
```

It checks every file against `EXTRACT.json`, then in a container of one Node image pinned by
digest (Node 22.22.1): `npm ci` (the only step with the network), the type check, the tests,
the offline app (`/tmp/pvp-build/out/template/index.html`) and an unsigned release
(`/tmp/pvp-build/out/release/`). Without Docker, Node 22 and npm do the same from `frontend/`:
`npm ci`, `npm run typecheck`, `npm test`, `npm run build`.

## Check a release against this source

A release's files are built from this folder in that container, and AgroDesign signs the two
blank apps afterwards. To check that a release is what this source builds, clone the
repository at the release's tag and run, from its `source/` folder:

```bash
scripts/viewer_pack_source_build.sh --work /tmp/pvp-check --compare ..
```

It reads the release's inputs back from the published files — the time the release was made,
its time zone, the sample structure and the logo — rebuilds the release with them, and
compares (`scripts/viewer_pack_reproduce.mjs`): each blank app in `latest/` must carry
AgroDesign's signature, verified with the public key in
`frontend/standalone/structure-viewer/releaseSignature.ts`, and be the rebuilt file byte for
byte once the signature's own text is left out; `index.html`, `en/index.html`, `LICENSE` and
`NOTICE` must be the same bytes. A release's attached files are the same bytes as its
`latest/` copies. It prints `REPRODUCED` or names each file that differs.

## Licences

`LICENSE` is the MIT License for AgroDesign Studios' own code, including the files the app
shares with AgroDesign's web application, followed by what it does not cover: the vendored
runtime keeps its own licences (Pyodide: Mozilla Public License 2.0; CPython: the PSF License
Agreement; Open-Source PyMOL: its own licence; NumPy: BSD 3-Clause), the patches to
Open-Source PyMOL follow that project's licence, and patch 0011 changes code whose origin
`licenses/NOTICES.pymol-third-party.txt` records as most likely CC BY-SA 3.0. The npm
packages keep their own licences; a built app lists them, with their texts, in Help >
Licences.

## Numbers in comments

`PT-1234`, `#1234`, `TN0123`, `ADR-0049` and the like in comments and test names are
AgroDesign's internal tracking numbers — board tasks, pull requests, handoffs and design
records. The documents they name are not published.

## Claude Code skills used to make and check this source

AgroDesign develops this app with Anthropic's Claude Code and project skills of its own
(written instructions Claude Code follows for one kind of task). These were used to make and
check this source:

- `/agro-ship` — each change: its tests, a review by Claude and by OpenAI Codex, the merge.
- `/agro-test` — the test suites a change touches.
- `/agro-ui-consult` — the app's screen designs: one brief to Claude and to Codex, both views
  to the owner before building.
- `/agro-codex-consult` — a second opinion from Codex on other designs, this source's
  reproducibility check and publication steps among them.
- `/agro-relay-sessions` — the preparation of this source as a relay of separately reviewed
  steps.
- `/agro-github-publish` — the check of the exact upload set before it is published: a
  mechanical scan (gitleaks, secret and internal-information patterns, AgroDesign's own
  internal values), then Claude, Codex and Grok each read the set, a final Claude pass checks
  every finding, and the result is sealed to the set's digest; after the owner's recorded
  approval only the checked commit is pushed, and the release is made from the checked files.

Two skills are published, made general for any project, in
[AgroDesign-Studios/agrodesign-skills-for-claude-code v0.1.1](https://github.com/AgroDesign-Studios/agrodesign-skills-for-claude-code/tree/v0.1.1)
(commit `18f2d9a6d097fc10fe80052123f81827c12847e1`): `agrodesign-github-publish`, the public
form of `/agro-github-publish`, and `agrodesign-deep-review`, the public form of the Claude
review inside `/agro-ship` (AgDB's `/agro-ultrareview`). The others are not published.

PyMOL is a trademark of Schrodinger, LLC.
