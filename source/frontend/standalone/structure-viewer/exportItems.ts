/**
 * What the offline file's one 「エクスポート」 offers (owner 2026-11-14: one
 * export for both viewers), and what the header's 「画像出力」 beside it
 * offers (owner 2026-11-16: the screenshot and the ray trace moved there).
 * The format comes first; each entry names the engine that writes it, and an
 * entry of the engine not shown now asks to switch to it when pressed — never
 * on its own (UI consult, Codex astra). The light edition has no PyMOL, so
 * none of PyMOL's entries.
 */

/** One format the export dialog offers. */
export type ExportItemId = 'structure' | 'mol' | 'pse' | 'vrml' | 'app'

/** One picture 「画像出力」 offers: the engine on screen's screenshot, or PyMOL's ray trace. */
export type ImageItemId = 'png' | 'ray'

/** Who writes it: an engine, or neither (the file as it was opened). */
export type ExportEngine = 'pymol' | '3dmol' | 'any'

/** An engine named on an entry's tag. */
export type TagEngine = Exclude<ExportEngine, 'any'>

/**
 * Why an entry cannot be used now: no WebGL at all; 3Dmol.js is still
 * loading (PT-9229 item 1); 3Dmol.js did not load; 3Dmol.js cannot read the open file (a `.pse`); this browser cannot run
 * PyMOL (a phone, PT-9192 item 3); PyMOL is still saving a picture
 * (PT-9188 item 2).
 */
export type ExportBlock = 'no-3d' | 'dmol-loading' | 'no-dmol-lib' | 'no-dmol-view' | 'no-pymol' | 'saving'

export interface ExportItem<Id extends string = ExportItemId> {
  id: Id
  engine: ExportEngine
  /** Set when the entry is shown but cannot be used. */
  blocked: ExportBlock | null
  /** The engine to switch to first, asked when pressed (PyMOL's entries while 3Dmol.js is shown). */
  switchTo: 'pymol' | null
  /**
   * The engines its tags name, one above the other (owner 2026-11-15): the
   * engine that writes it, or — for an entry needing neither — every engine
   * of this edition (the light edition has no PyMOL).
   */
  tags: readonly TagEngine[]
  /** The entry the dialog sets apart, with a 「おすすめ」 badge (the app itself, owner 2026-11-16). */
  featured?: true
}

export interface ExportContext {
  /** The full edition (PyMOL in it). */
  full: boolean
  /** The engine on screen. */
  shown: '3dmol' | 'pymol'
  /** WebGL works in this browser. */
  gl: boolean
  /** 3Dmol.js has a view of the open file (not a `.pse`, which only PyMOL reads). */
  dmolView: boolean
  /** 3Dmol.js itself loaded (false while it loads, or when its block failed, PT-9188 item 6). Default true. */
  dmolReady?: boolean
  /** 3Dmol.js is still loading (not ready, and no failure yet): said as such, never as a failure. Default false. */
  dmolLoading?: boolean
  /** This browser cannot run PyMOL (the phone mode's `pymolBlocker`). Default false. */
  pymolBlocked?: boolean
  /** PyMOL is saving a picture (PNG or ray trace): no second one meanwhile. Default false. */
  pymolSaving?: boolean
}

/** Why an entry of either engine cannot be used now (`picture`: a PNG, held while one is saving). */
function blocks(ctx: ExportContext) {
  const { shown, gl, dmolView, dmolReady = true, dmolLoading = false, pymolBlocked = false, pymolSaving = false } = ctx
  const pymol = (picture: boolean): ExportBlock | null =>
    !gl ? 'no-3d' : pymolBlocked && shown !== 'pymol' ? 'no-pymol' : picture && pymolSaving ? 'saving' : null
  const dmol: ExportBlock | null = !gl ? 'no-3d' : !dmolReady ? (dmolLoading ? 'dmol-loading' : 'no-dmol-lib') : !dmolView ? 'no-dmol-view' : null
  return { pymol, dmol }
}

/** An entry PyMOL writes: it asks to switch to PyMOL first while 3Dmol.js is shown. */
function pymolItem<Id extends string>(id: Id, shown: ExportContext['shown'], blocked: ExportBlock | null): ExportItem<Id> {
  return { id, engine: 'pymol', blocked, switchTo: shown === 'pymol' ? null : 'pymol', tags: ['pymol'] }
}

/**
 * The export dialog's entries, in its order: the app itself first (owner
 * 2026-11-15), set apart (`featured`), then files; 3Dmol.js's VRML just above
 * the PyMOL session (owner 2026-11-16: the two engines' scene files side by
 * side). The structure file as it came needs no engine; VRML is 3Dmol.js's,
 * written from its pane even when hidden. No pictures: 「画像出力」 saves
 * those (`imageItems`).
 */
export function exportItems(ctx: ExportContext): ExportItem[] {
  const { full, shown } = ctx
  const block = blocks(ctx)
  const either: readonly TagEngine[] = full ? ['pymol', '3dmol'] : ['3dmol']
  // The app itself, as one HTML file (owner 2026-11-15): first, needing no engine.
  const items: ExportItem[] = [{ id: 'app', engine: 'any', blocked: null, switchTo: null, tags: either, featured: true }]
  items.push({ id: 'structure', engine: 'any', blocked: null, switchTo: null, tags: either })
  if (full) items.push(pymolItem('mol', shown, block.pymol(false)))
  items.push({ id: 'vrml', engine: '3dmol', blocked: block.dmol, switchTo: null, tags: ['3dmol'] })
  if (full) items.push(pymolItem('pse', shown, block.pymol(false)))
  return items
}

/**
 * 「画像出力」's entries (owner 2026-11-16): the screenshot, the engine on
 * screen's, and — full edition — PyMOL's ray trace, which asks to switch to
 * PyMOL first while 3Dmol.js is shown, as the export dialog's PyMOL entries
 * do. Neither is offered again while PyMOL saves a picture (PT-9188 item 2).
 */
export function imageItems(ctx: ExportContext): ExportItem<ImageItemId>[] {
  const { full, shown } = ctx
  const block = blocks(ctx)
  const png: ExportItem<ImageItemId> =
    full && shown === 'pymol'
      ? { id: 'png', engine: 'pymol', blocked: block.pymol(true), switchTo: null, tags: ['pymol'] }
      : { id: 'png', engine: '3dmol', blocked: block.dmol, switchTo: null, tags: ['3dmol'] }
  return full ? [png, pymolItem('ray', shown, block.pymol(true))] : [png]
}
