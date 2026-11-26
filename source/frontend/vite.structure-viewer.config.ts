import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STANDALONE_ALIASES } from './standalone/structure-viewer/aliases.ts'
import { APP_VERSION } from './standalone/structure-viewer/appLicence.ts'
import { buildSha, gitShortHead } from './standalone/structure-viewer/buildSha.ts'
import { STRUCTURE_VIEWER_STRING_FILTERS } from './standalone/structure-viewer/stringFilters.ts'
import { ganttCssPrune } from './vite-plugins/gantt-css-prune.ts'
import { ganttLicenses } from './vite-plugins/gantt-licenses.ts'
import { stringsOnly } from './vite-plugins/gantt-strings-only.ts'
import { inlineSingleFile } from './vite-plugins/singlefile.ts'

/**
 * The offline structure file:
 * `vite build -c vite.structure-viewer.config.ts` → `dist-structure-viewer/index.html`, one
 * self-contained offline page that runs from file:// with no server, no API
 * and no login. See standalone/structure-viewer/main.tsx for what it mounts.
 *
 * The entry graph starts at standalone/structure-viewer/main.tsx, so the
 * page carries the 3D viewer and PyMOL components and nothing else. The
 * output is an empty page that is filled with a structure afterwards;
 * 3Dmol.js and the PyMOL runtime are NOT bundled here but embedded as data
 * blocks when it is filled.
 */
const root = path.dirname(fileURLToPath(import.meta.url))
const stubs = new Map(STANDALONE_ALIASES.map(a => [path.resolve(root, a.find), path.resolve(root, a.replacement)]))

/** `aliases.ts`: the error-reporting modules, swapped for the offline page's own stubs. */
function offlineStubs(): Plugin {
  return {
    name: 'agdb-structure-viewer-stubs',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (importer === undefined || !source.includes('errorCapture')) return null
      // A relative import by its path first: the viewer's published source
      // carries the stub but not the module it stands for (PT-9911), which
      // Vite's own resolution would need to find.
      if (source.startsWith('.')) {
        const lexical = path.resolve(path.dirname(importer.split('?')[0]), source.split('?')[0]).replace(/\.(tsx?|js)$/, '')
        const stub = stubs.get(lexical)
        if (stub !== undefined) return stub
      }
      const hit = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (hit === null) return null
      return stubs.get(hit.id.split('?')[0].replace(/\.(tsx?|js)$/, '')) ?? null
    },
  }
}

/**
 * The app's version in its page (owner 2026-11-17): index.html's
 * `<meta name="agdb-viewer-pack">` carries `__SAV_APP_VERSION__`, made
 * `APP_VERSION` here, so a newer version's file says which it is to the
 * app that puts its data in it (`latestShell.ts`); a file without the mark
 * is refused there.
 */
function appVersionMark(): Plugin {
  return {
    name: 'agdb-structure-viewer-version-mark',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!html.includes('__SAV_APP_VERSION__')) throw new Error('index.html lacks the app version mark')
        return html.replaceAll('__SAV_APP_VERSION__', APP_VERSION)
      },
    },
  }
}

export default defineConfig({
  root: 'standalone/structure-viewer',
  // The short commit, for the licence tab's version (appLicence.ts APP_BUILD_SHA, buildSha.ts).
  define: { __SAV_BUILD_SHA__: JSON.stringify(buildSha(process.env, gitShortHead(root))) },
  // Relative asset URLs; the document has no server root to be relative to.
  base: './',
  // The file carries only what it uses: the strings-only filter drops every
  // key the bundle does not use, ganttCssPrune every rule no bundled element
  // can match. ganttCssPrune and ganttLicenses must run before
  // inlineSingleFile moves their chunks into the HTML. No self outline: this
  // page does not rebuild itself.
  plugins: [
    appVersionMark(),
    offlineStubs(),
    stringsOnly('agdb-structure-viewer-strings-only', STRUCTURE_VIEWER_STRING_FILTERS, 'structure viewer'),
    react(),
    ganttLicenses(),
    ganttCssPrune(),
    inlineSingleFile(),
  ],
  build: {
    outDir: '../../dist-structure-viewer',
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    chunkSizeWarningLimit: 8000,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // Classic-script output — a file:// document cannot run a module
        // script. See vite-plugins/singlefile.ts.
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'structure-viewer.js',
        assetFileNames: 'structure-viewer.[ext]',
      },
    },
  },
})
