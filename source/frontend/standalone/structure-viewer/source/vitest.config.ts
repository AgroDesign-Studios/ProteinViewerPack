import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { SOURCE_TESTS } from './sourceTests.ts'

/**
 * The tests of the Protein Viewer Pack's published source (PT-9911): the
 * test files `extract.json` names, run from frontend/ —
 *
 *   npx vitest run -c standalone/structure-viewer/source/vitest.config.ts
 *
 * The same command, the same files, before the source is cut and in the
 * extract (the publisher's clean build, not published, runs it there in a
 * clean container). The setup is src/test/domSetup.ts alone.
 */
const frontend = path.resolve(import.meta.dirname, '../../..')

// node_modules may be a symlink: allow its real path for `?raw` / `?url`
// loads.
const nodeModules = path.join(frontend, 'node_modules')

export default defineConfig({
  root: frontend,
  plugins: [react()],
  server: existsSync(nodeModules) ? { fs: { allow: [realpathSync(nodeModules)] } } : {},
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/domSetup.ts'],
    include: [...SOURCE_TESTS],
    pool: 'forks',
    maxWorkers: 4,
    execArgv: ['--max-old-space-size=8192'],
    clearMocks: true,
  },
})
