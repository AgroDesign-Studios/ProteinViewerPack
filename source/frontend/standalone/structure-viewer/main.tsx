/**
 * The offline structure file (「HTMLで保存」, owner 2026-11-13) — entry point.
 *
 * A Vite entry that bundles the 3Dmol.js toolbar and scene code, and the
 * PyMOL menu bar, command line and dialogs, into one self-contained HTML
 * document that runs from a double-clicked file:// URL with no server and no
 * login.
 *
 * vite.structure-viewer.config.ts builds it (an empty template); its payload
 * slot is filled with the structure, the looks, 3Dmol.js and (full edition) the
 * PyMOL runtime, each as a gzip + base64 block this page reads as text
 * (`blocks.ts`).
 *
 * This entry sets up i18next (./i18n, no HTTP backend) and index.css (pruned
 * to what the bundle uses by vite-plugins/gantt-css-prune.ts).
 * `boundary.test.ts` holds the entry graph to the published source and its
 * network calls to three modules.
 */
import { createRoot } from 'react-dom/client'
import thirdPartyJson from 'virtual:gantt-third-party-licenses'
import { parsePymolLook } from '../../src/pages/pymol-viewer/pymolLook'
import type { Mol3dLook } from '../../src/pages/structure-html-export/mol3dLook'
import { bytesOf, hasBlock, readConfig, readLogo, textOf } from './blocks'
import { embeddedFileDoc, type StructureDoc } from './localFile'
import { captureTemplate, MOL3D_SESSION_BLOCK, PYMOL_SESSION_BLOCK } from './selfCopy'
import { checkMol3dLook } from './exportedLook3d'
import { initStandaloneI18n } from './i18n'
import type { BundledLicence } from './LicenceDialog'
import { lockSharedPrototypes } from './localFile'
import { installProbe, probe } from './probe'
import { takePymolCrashMark } from './pymolCrashMark'
import { StandaloneApp } from './StandaloneApp'
import '../../src/index.css'
import '../../src/components/structure-viewer/structureViewer.css'
import '../../src/pages/pymol-viewer/pymolViewer.css'
import './standalone.css'

// The page as it arrived, for 「HTMLappとして出力」 (selfCopy.ts): before anything changes the document.
captureTemplate()
installProbe()
// Before any file is read or any parser runs: no NEW key can be added to the
// shared prototypes (a crafted structure file, PR #8239 review). Their existing
// keys are kept from the parsers by `safeModelText` (PT-9131; `localFile.ts`).
lockSharedPrototypes()

// Read (and cleared) once, before anything renders: the page closed while PyMOL was starting.
const pymolCrashed = takePymolCrashMark()

// The bundled packages' licences, written in at build time by
// vite-plugins/gantt-licenses.ts. Our own plugin's output: a parse failure is
// a build bug, so it fails loudly rather than ship the file without them.
const bundled = JSON.parse(thirdPartyJson) as BundledLicence[]

async function main(): Promise<void> {
  const config = await readConfig()
  initStandaloneI18n(config.lang)
  // A blank file (exported with no structure) has no structure block; a copy
  // the app made of itself may carry another format than mmCIF.
  let cif: string | null = null
  let initialDoc: StructureDoc | null = null
  if (hasBlock('structure')) {
    if (config.structureFormat === undefined) cif = await textOf('structure')
    else initialDoc = embeddedFileDoc(await bytesOf('structure'), config.structureFormat, config.title)
  }
  let mol3d: Mol3dLook | null = null
  let lookRefused = false
  if (hasBlock('mol3d')) {
    try {
      mol3d = checkMol3dLook(JSON.parse(await textOf('mol3d')))
    } catch {
      mol3d = null
    }
    lookRefused = mol3d === null
  }
  // A 3Dmol.js session saved into the file (「HTMLappとして出力」, owner
  // 2026-11-16) is shown in place of the exported look; one that fails its
  // checks leaves the exported look.
  if (hasBlock(MOL3D_SESSION_BLOCK)) {
    try {
      const saved = checkMol3dLook(JSON.parse(await textOf(MOL3D_SESSION_BLOCK)))
      if (saved !== null) mol3d = saved
    } catch (e) {
      probe.errors.push(`3Dmol.js session refused: ${String(e).slice(0, 200)}`)
    }
  }
  let pymolLookBytes: ArrayBuffer | null = null
  let pymolLook = null
  if (hasBlock('pymol-look')) {
    try {
      pymolLookBytes = await bytesOf('pymol-look')
      // Every check `parsePymolLook` makes, the reserved-identifier one
      // included (PT-9089 item 3), before 3Dmol.js or PyMOL sees it.
      pymolLook = parsePymolLook(pymolLookBytes)
    } catch (e) {
      probe.errors.push(`pymol look refused: ${String(e).slice(0, 200)}`)
      pymolLookBytes = null
      pymolLook = null
      lookRefused = true
    }
  }
  // A saved PyMOL session (owner 2026-11-16, 「HTMLappとして出力」): PyMOL opens
  // it in place of the structure, which 3Dmol.js shows. The full edition only;
  // PyMOL reads it through the runtime's restricted unpickler, as any .pse.
  let pymolSession: StructureDoc | null = null
  if (config.edition === 'full' && hasBlock(PYMOL_SESSION_BLOCK)) {
    try {
      pymolSession = embeddedFileDoc(await bytesOf(PYMOL_SESSION_BLOCK), 'pse', config.title)
    } catch (e) {
      probe.errors.push(`pymol session refused: ${String(e).slice(0, 200)}`)
      pymolSession = null
    }
  }
  // The header's logo is decoration: a damaged one leaves the name alone, never the page.
  const logo = await readLogo().catch((e: unknown) => {
    probe.errors.push(`logo refused: ${String(e).slice(0, 200)}`)
    return null
  })
  createRoot(document.getElementById('root')!).render(
    <StandaloneApp
      config={config}
      logo={logo}
      cif={cif}
      initialDoc={initialDoc}
      pymolSession={pymolSession}
      mol3d={mol3d}
      pymolLook={pymolLook}
      pymolLookBytes={pymolLookBytes}
      lookRefused={lookRefused}
      bundledLicences={bundled}
      pymolCrashed={pymolCrashed}
    />,
  )
}

main().catch((e: unknown) => {
  probe.errors.push(`main: ${String(e instanceof Error ? e.stack ?? e.message : e).slice(0, 400)}`)
  const root = document.getElementById('root')
  if (root) {
    const p = document.createElement('p')
    p.className = 'sav-fatal'
    // Text only: the reason may quote the file's own data.
    p.textContent = `The structure could not be shown / 構造を表示できませんでした: ${e instanceof Error ? e.message : String(e)}`
    root.replaceChildren(p)
  }
})
