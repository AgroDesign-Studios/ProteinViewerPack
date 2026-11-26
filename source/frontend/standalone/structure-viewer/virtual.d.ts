/**
 * The bundled-licence data vite-plugins/gantt-licenses.ts writes into the
 * standalone build (a shared plugin, reused as is): a JSON string of
 * the bundled packages' licences, filled in once the bundle is final.
 */
declare module 'virtual:gantt-third-party-licenses' {
  const json: string
  export default json
}

/**
 * The short commit the offline file was built from: written in by
 * vite.structure-viewer.config.ts (`define`), absent anywhere else (a test,
 * AgDB's own build) — read it only through `typeof` (`appLicence.ts`).
 */
declare const __SAV_BUILD_SHA__: string | undefined
