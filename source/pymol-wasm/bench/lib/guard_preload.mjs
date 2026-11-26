// `node --import <this file> some_test.mjs` runs guardHost() before the test's own
// code, so a node-hosted Pyodide in a script that does not guard itself (the
// pymol-wasm/tests/*.mjs real-runtime tests) still cannot reach the host shell.
// See guard_host.mjs.
import { guardHost } from './guard_host.mjs';

guardHost();
