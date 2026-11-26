// Stop a node-hosted Pyodide from reaching the HOST shell (bench/README.md, trap 1).
//
// Under node, emscripten's system() is `require("node:child_process").spawnSync(cmd,
// [], {shell: true})` (pyodide.asm.mjs), so `os.system`, `cmd.system` and
// `chempy.bmin` in a node-hosted PyMOL run a real shell on this host. pyodide.js
// also hands Python an ESM namespace of child_process through `globalThis.require`.
// guardHost() replaces every process-starting function on the shared builtin
// module object, then re-syncs the ESM namespaces, so both routes hit the stub.
// Call it BEFORE loading Pyodide, in a process that starts no child process of
// its own afterwards (a tool that drives Chrome never loads Pyodide in node, so
// it never needs this). PY_HOST_BLOCK is the same guard on the Python side; run
// it right after loadPyodide(), before `import pymol`.
import { createRequire, syncBuiltinESMExports } from 'node:module';

/** Every blocked call, in order (command text cut to 200 characters). */
export const hostCalls = [];

const STARTERS = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'];

export function guardHost() {
  const cp = createRequire(import.meta.url)('node:child_process');
  for (const name of STARTERS) {
    cp[name] = (...args) => {
      hostCalls.push(`${name} ${String(args[0]).slice(0, 200)}`);
      if (name === 'spawnSync') {
        // emscripten's system() reads .status; 127 = "command not found".
        return { status: 127, signal: null, pid: 0, output: [], stdout: '', stderr: '' };
      }
      throw new Error(`host process start (${name}) is blocked by pymol-wasm/bench/lib/guard_host.mjs`);
    };
  }
  syncBuiltinESMExports();
  // Fail closed: prove the stub is what a later caller gets, by both routes.
  const again = createRequire(import.meta.url)('child_process');
  const before = hostCalls.length;
  const r = again.spawnSync('true', [], { shell: true });
  if (r.status !== 127 || hostCalls.length !== before + 1) {
    throw new Error('guardHost: child_process.spawnSync is not the stub; refusing to continue');
  }
  hostCalls.pop();
}

/** Python-side belt and braces: nothing in the interpreter may start a host process. */
export const PY_HOST_BLOCK = `
import os as _gh_os, subprocess as _gh_sp
def _gh_blocked(*a, **k):
    raise OSError('host process execution is blocked by pymol-wasm/bench/lib/guard_host.mjs')
_gh_os.system = lambda *a, **k: -1
_gh_os.popen = _gh_blocked
for _gh_name in ('Popen', 'run', 'call', 'check_call', 'check_output', 'getoutput', 'getstatusoutput'):
    setattr(_gh_sp, _gh_name, _gh_blocked)
del _gh_name
`;
