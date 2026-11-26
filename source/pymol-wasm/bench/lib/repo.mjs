// Where things are, for every bench tool: the repository root, the runtime the
// app ships, playwright-core from the frontend's own node_modules, and Chrome.
// Nothing here starts a process or loads Pyodide.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The checkout this file belongs to (pymol-wasm/bench/lib/ -> three levels up). */
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const MANIFEST = path.join(REPO, 'frontend/src/pages/pymol-viewer/pymolRuntimeManifest.ts');

/** The version directory the app runs, read from pymolRuntimeManifest.ts (never hard-coded here). */
export function shippedRuntimeVersion() {
  const m = /export const PYMOL_RUNTIME_VERSION = '([^'\\/]+)'/.exec(readFileSync(MANIFEST, 'utf8'));
  if (!m) throw new Error(`cannot read PYMOL_RUNTIME_VERSION from ${MANIFEST}`);
  return m[1];
}

/** frontend/public/vendor/pymol/<version>/ of this checkout. */
export function shippedRuntimeDir() {
  const dir = path.join(REPO, 'frontend/public/vendor/pymol', shippedRuntimeVersion());
  if (!existsSync(path.join(dir, 'worker.js'))) throw new Error(`no runtime at ${dir}`);
  return dir;
}

/** playwright-core, resolved from frontend/node_modules (no install of our own). */
export async function loadChromium() {
  const req = createRequire(path.join(REPO, 'frontend', 'package.json'));
  const entry = req.resolve('playwright-core');
  const mod = await import(pathToFileURL(entry).href);
  return (mod.default ?? mod).chromium;
}

/** The Chrome binary: $CHROME, else the system google-chrome (Chrome 156 when these tools were written). */
export const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
