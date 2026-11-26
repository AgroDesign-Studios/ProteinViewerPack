import type { PageMessage } from './ExportHub'
import type { StructureDoc } from './localFile'
import type { OpenMode } from './OpenDialog'
import { DocRefused } from './pymolBridge'

/** What one open acts on: the page as it is when the open dialog hands the document over. */
export interface OpenTarget {
  /** The file's PyMOL (full edition), or null. */
  bridge: { addDocument: (doc: StructureDoc) => Promise<void>; openDocument: (doc: StructureDoc) => Promise<void> } | null
  /** The document the page showed before its first open: where a refused session goes back to until one opens. */
  before: StructureDoc | null
  /** Shows a document in the page (both engines' panes, the heading). */
  show: (doc: StructureDoc | null) => void
  /** Says a sentence in the page's live regions; null clears them. */
  say: (message: PageMessage | null) => void
  /** A session is PyMOL's: start it whether it is off or failed. */
  startPymol: () => void
  /** The page's own reset for a new document: the exported look's status, an export form bound to the old one, the focus. */
  replaced: () => void
}

/** The engine's or the browser's own words, cut to a line. */
const detailOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200)

/**
 * A document the open dialog accepted (`OpenDialog`), shown instead of what
 * is open or added to PyMOL as one more object. The latest open wins: a
 * slower, older one that lands after it says nothing and reverts nothing
 * (PR #8239 review). A replaced document is shown at once in 3Dmol.js and
 * opened in PyMOL behind it; a session only PyMOL could show goes back to
 * what was shown when PyMOL refuses it, another format stays open in
 * 3Dmol.js, which may read what PyMOL could not. Separate from the page so
 * each branch is tested (`docOpener.test.ts`, PT-9133 item 7).
 *
 * Where a refused session goes back to is never the page's `before` of that
 * open, which may be an older session PyMOL itself refused while this one
 * was waiting: it is the scene PyMOL says it went back to (`DocRefused`), or
 * else the last document that did open here — a session once PyMOL has it,
 * another format once shown, 3Dmol.js keeping it (PT-9228 items 3, 4;
 * PT-9230 item 7).
 */
export class DocOpener {
  private seq = 0
  /** The last document that opened (undefined until the first open reads the page's own). */
  private lastGood: StructureDoc | null | undefined = undefined

  async open(next: StructureDoc, mode: OpenMode, page: OpenTarget): Promise<void> {
    const seq = ++this.seq
    const latest = () => seq === this.seq
    if (this.lastGood === undefined) this.lastGood = page.before
    page.say(null)
    const { bridge } = page
    if (mode === 'add' && bridge !== null) {
      try {
        await bridge.addDocument(next)
        if (latest()) page.say({ key: 'htmlExport:sa_open_added', vars: { name: next.name }, error: false })
      } catch (e) {
        if (latest()) page.say({ key: 'htmlExport:sa_open_err_add', vars: { detail: detailOf(e) }, error: true })
      }
      return
    }
    page.show(next)
    page.replaced()
    page.say({ key: 'htmlExport:sa_open_opened', vars: { name: next.name }, error: false })
    // 3Dmol.js shows any other format at once, whatever PyMOL makes of it.
    if (next.ext !== 'pse') this.lastGood = next
    if (bridge === null) return
    if (next.ext === 'pse') page.startPymol()
    try {
      await bridge.openDocument(next)
      if (latest() && next.ext === 'pse') this.lastGood = next
    } catch (e) {
      if (!latest()) return
      page.say({ key: 'htmlExport:sa_open_err_pymol', vars: { name: next.name, detail: detailOf(e) }, error: true })
      if (next.ext === 'pse') {
        const back = e instanceof DocRefused ? e.shown : (this.lastGood ?? null)
        this.lastGood = back
        page.show(back)
      }
    }
  }
}
