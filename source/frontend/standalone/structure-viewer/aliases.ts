/**
 * Modules the offline structure file swaps for its own (frontend-relative,
 * the `find` without extension): modules that report over the network, which
 * a file:// page has no way to reach. vite.structure-viewer.config.ts
 * applies them to the build; `entryGraph.ts` applies them when the tests
 * walk it.
 *
 * - `src/utils/errorCapture`: the surface controller reports a failed surface
 *   build there (`surfaceFailure.ts`). This one keeps errors in the page
 *   (the console line stays).
 */
export const STANDALONE_ALIASES: readonly { find: string; replacement: string }[] = Object.freeze([
  { find: 'src/utils/errorCapture', replacement: 'standalone/structure-viewer/offlineErrorCapture.ts' },
])
