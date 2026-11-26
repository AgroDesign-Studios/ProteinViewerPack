// Shared by interrupt_probe.mjs and map_equality.mjs (patch 0009, S1-4): run Python jobs, each in
// its OWN worker thread with a fresh Pyodide + numpy + PyMOL wheel, so a wasm trap in one job can
// neither hide nor poison another. The wall-clock limit is enforced from the main thread
// (Worker.terminate()), so a job that loops forever inside wasm still ends, as a failure.
//
// Host safety (pymol-wasm/bench/README.md, section Rules, item 1): each worker calls guardHost() BEFORE it loads
// Pyodide and runs PY_HOST_BLOCK right after loadPyodide(), before `import pymol`; nothing here
// starts a child process (worker threads are threads of this process).
//
// A job: { name, core, wheels: [numpy.whl, pymol.whl], files: { '/tmp/x': Uint8Array },
//          globals: { NAME: string | number }, code: '<Python whose last expression is a JSON str>' }
// A result: { name, value | jsError | setupError | workerError | timedOut, alive, hostCalls, ms, heapMB }
//   jsError  = runPython threw a JS error (a wasm trap ends up here; Python exceptions inside the
//              job's own try/except do not); alive = the interpreter still answers `1 + 1` after.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { guardHost, hostCalls, PY_HOST_BLOCK } from '../bench/lib/guard_host.mjs';

const SELF = new URL(import.meta.url);
const clip = (e) => String((e && e.message) || e).split('\n').filter((l) => l.trim()).slice(-4).join(' | ').slice(0, 600);

/** Run `jobs` at most `parallel` at a time; resolves to the results in job order. */
export function runJobs(jobs, { parallel = 4, timeoutMs = 300000 } = {}) {
  const results = new Array(jobs.length);
  let next = 0;
  const one = (i) => new Promise((resolve) => {
    const job = jobs[i];
    const t0 = performance.now();
    let done = false;
    const w = new Worker(SELF, { workerData: job, resourceLimits: { maxOldGenerationSizeMb: 4096 } });
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      results[i] = { name: job.name, ms: Math.round(performance.now() - t0), ...r };
      w.terminate().catch(() => {}).finally(resolve);
    };
    const timer = setTimeout(() => finish({ timedOut: true, alive: false, hostCalls: [] }), timeoutMs);
    w.on('message', (m) => finish(m));
    w.on('error', (e) => finish({ workerError: clip(e), alive: false, hostCalls: [] }));
    w.on('exit', (code) => finish({ workerError: `worker exited (code ${code}) without a result`, alive: false, hostCalls: [] }));
  });
  const lane = async () => {
    while (next < jobs.length) {
      const i = next++;
      await one(i);
    }
  };
  return Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, jobs.length)) }, lane)).then(() => results);
}

async function workerMain(job) {
  guardHost();
  const out = {};
  let py;
  try {
    const indexURL = path.resolve(job.core) + '/';
    const { loadPyodide } = await import(pathToFileURL(path.join(indexURL, 'pyodide.mjs')).href);
    py = await loadPyodide({ indexURL, stdout: () => {}, stderr: () => {} });
    py.runPython(PY_HOST_BLOCK);
    await py.loadPackage(job.wheels.map((w) => path.resolve(w)), { messageCallback: () => {} });
    for (const [p, bytes] of Object.entries(job.files || {})) py.FS.writeFile(p, bytes);
    for (const [k, v] of Object.entries(job.globals || {})) py.globals.set(k, v);
  } catch (e) {
    parentPort.postMessage({ setupError: clip(e), alive: false, hostCalls: hostCalls.slice() });
    return;
  }
  try {
    out.value = JSON.parse(py.runPython(job.code));
  } catch (e) {
    out.jsError = clip(e);
  }
  try {
    out.alive = py.runPython('1 + 1') === 2;
  } catch (e) {
    out.alive = false;
  }
  try {
    out.heapMB = +(py._module.HEAP8.buffer.byteLength / 1048576).toFixed(1);
  } catch (e) {
    out.heapMB = null;
  }
  out.hostCalls = hostCalls.slice();
  parentPort.postMessage(out);
}

if (!isMainThread && workerData && workerData.code) {
  workerMain(workerData).catch((e) => parentPort.postMessage({ workerError: clip(e), alive: false, hostCalls: hostCalls.slice() }));
}
