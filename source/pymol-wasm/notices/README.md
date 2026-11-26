# Upstream licence texts the PyMOL source tree does not carry

`third_party_notices.py` quotes these beside the notices it takes from the
pymol-open-source tree. Each file is the upstream bytes, unedited.

| File | Upstream (repository, ref, path) | Why it is here |
|---|---|---|
| `ilastik-marching_cubes.LICENSE` | ilastik/marching_cubes, `main` (blob `5a91743b`), `LICENSE` | PyMOL's marching cubes say they are based on it; the tree has no copy of its licence |
| `mesa-m_matrix.LICENSE` | mirror/mesa (Mesa's history on GitHub), tag `mesa_4_0`, `src/mesa/math/m_matrix.c` lines 3-25 (the header comment) | Matrix.cpp's and Vector.cpp's matrix routines come from Mesa under its MIT licence; the tree quotes no Mesa notice. Which release they came from is not recorded: they and this notice are the same from Mesa 3.1 to 4.0, and 4.1 rewrote one routine's comment |
| `pymol-psico.LICENSE` | speleo3/pymol-psico, commit `f42cb1e4f565685b95fba63820b5f37db32b5954`, `LICENSE` | Thomas Holder's BSD-2-Clause modules in the wheel say "License: BSD-2-Clause" with no text; this is the text of the project they are based on |

Fetched with `gh api -H "Accept: application/vnd.github.raw" repos/<repo>/contents/<path>?ref=<ref>`
(2026-11-15). gitlab.freedesktop.org, Mesa's own host, refuses scripted reads,
so the Mesa header comes from its GitHub mirror; the header is the same text in
every release tag from `mesa_3_1` to `mesa_4_0` apart from the version and the
copyright years.
