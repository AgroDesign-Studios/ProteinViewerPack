/**
 * A single-file page rebuilds its own template, for when it cannot fetch
 * itself (a page opened from file:// cannot; Chrome blocks file:// fetches).
 * The build hands the file its own outline: vite-plugins/singlefile.ts writes the finished
 * page — with the stylesheet and the script replaced by the marks below and
 * the seed slot still empty — into the script, in place of SELF_FRAME_SLOT.
 * At run time the page puts the text of its own <style> and <script> elements
 * back into the outline, which gives the template byte for byte: the text of
 * a <style> or <script> element is raw, so the parser keeps it exactly as
 * written. Only the <style> elements the build wrote are read, by
 * SELF_FRAME_STYLE_ATTR: one an extension adds to the page would not match a
 * mark (PT-2306). The seed slot in the outline is always the empty one.
 *
 * No imports: the build plugin loads this file too.
 */

/** Replaced at build time by the outline, as a JS string literal. */
export const SELF_FRAME_SLOT = '__AGDB_GANTT_SELF_FRAME__'

/** Where the n-th inlined stylesheet goes in the outline. */
export const selfFrameCssMark = (n: number): string => `__AGDB_SINGLEFILE_CSS_${n}__`
/** Where the inlined script goes in the outline. */
export const SELF_FRAME_JS_MARK = '__AGDB_SINGLEFILE_JS__'
/** On each <style> the build inlines, in the outline and the page alike. */
export const SELF_FRAME_STYLE_ATTR = 'data-agdb-inline'

/**
 * The template from the outline and the text of the page's own inlined
 * <style> elements (in document order) and <script>. Null when the outline
 * does not hold exactly one mark per piece — a page built without one, or a
 * stylesheet count that does not match the marks — or when a stylesheet
 * holds the script mark, which would take the script's place.
 */
export function rebuildFromFrame(
  frame: string,
  styles: readonly string[],
  script: string,
): string | null {
  const once = (s: string, mark: string) => s.split(mark).length === 2
  if (frame.includes(selfFrameCssMark(styles.length))) return null
  let out = frame
  for (let i = 0; i < styles.length; i++) {
    const mark = selfFrameCssMark(i)
    if (!once(out, mark)) return null
    out = out.replace(mark, () => styles[i])
  }
  // Counted after the stylesheets are in, so a mark one of them carries
  // counts too (PT-2306).
  if (!once(out, SELF_FRAME_JS_MARK)) return null
  return out.replace(SELF_FRAME_JS_MARK, () => script)
}

/**
 * The template getter for this page, or undefined when the build wrote no
 * outline (the dev server, a test). `script` is the running script's element
 * (document.currentScript, read while the script runs at the top level).
 */
export function selfTemplateSource(
  frame: string,
  doc: Document,
  script: HTMLScriptElement | null,
): (() => Promise<string | null>) | undefined {
  // An outline is a whole page; the unreplaced slot is not.
  if (!frame.startsWith('<!') || script === null) return undefined
  // Read now, before anything else adds a <style> to the page, and only the
  // build's own: an extension may have added one before this script ran.
  const styles = Array.from(doc.querySelectorAll(`style[${SELF_FRAME_STYLE_ATTR}]`), s => s.textContent ?? '')
  const code = script.textContent ?? ''
  return () => Promise.resolve(rebuildFromFrame(frame, styles, code))
}
