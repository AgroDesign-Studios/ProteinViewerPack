# Pinned builder for the in-browser Open-Source PyMOL wheel (ADR-0049; TN0110 §4.3).
#
# This image is only the toolchain HOST: Python 3.14.2 (the same CPython Pyodide
# 314.0.7 ships, so the unpickler tests run against the stdlib pickle the
# browser runs), git/curl/bzip2/xz, and pyodide-build. Everything heavy
# (emsdk, the Pyodide cross-build env, the PyMOL and glm sources, the Pyodide
# core and numpy wheel) is fetched by build.sh at run time and either checked
# against a pinned sha256 / commit (the Pyodide core tarball, numpy wheel, the
# PyMOL and glm checkouts) or confirmed by version marker (emsdk's toolchain is
# TOFU over HTTPS keyed by the pinned release hash; emcc --version is checked).
# build-in-docker.sh builds this image with `-f` and an empty context directory.
#
# The base is pinned by digest, not only by tag: the wheel is a zip written by
# this Python's zlib, so a re-published tag with a newer Debian zlib would move
# the wheel's bytes. The apt packages are not pinned: they write no output byte,
# and any drift in the toolchain would change the output and fail the
# committed-manifest comparison (build-in-docker.sh exit 3).
#
# pyodide-build's version is installed here and re-checked at the top of
# build.sh. There is deliberately no pymol-wasm/requirements.txt.
FROM python:3.14.2-slim-bookworm@sha256:e87711ef5c86aaeaa7031718a69db79d334d94c545c709583f651b8185870941

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates bzip2 xz-utils \
 && rm -rf /var/lib/apt/lists/*

RUN python3.14 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir "pyodide-build==0.39.1"

ENV VENV=/opt/venv
