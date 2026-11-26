import { describe, expect, it } from 'vitest'
import {
  SELF_FRAME_JS_MARK,
  SELF_FRAME_SLOT,
  SELF_FRAME_STYLE_ATTR,
  rebuildFromFrame,
  selfFrameCssMark,
  selfTemplateSource,
} from './ganttSelfFrame'

const frame =
  `<!doctype html><html><head><style>${selfFrameCssMark(0)}</style><style>${selfFrameCssMark(1)}</style></head>` +
  `<body><div id="root"></div><script>${SELF_FRAME_JS_MARK}</script></body></html>`

describe('rebuildFromFrame', () => {
  it('puts each stylesheet and the script back in place', () => {
    expect(rebuildFromFrame(frame, ['a{}', 'b{}'], 'run()')).toBe(
      '<!doctype html><html><head><style>a{}</style><style>b{}</style></head>' +
        '<body><div id="root"></div><script>run()</script></body></html>',
    )
  })

  it('keeps replacement patterns like $& and $1 literal', () => {
    const script = 'x.replace(/a/, "$&$1$$$`")'
    const out = rebuildFromFrame(frame, ['$&', "$'"], script)
    expect(out).toContain(`<script>${script}</script>`)
    expect(out).toContain("<style>$&</style><style>$'</style>")
  })

  it('refuses a frame without the script mark, or with it twice', () => {
    expect(rebuildFromFrame(frame.replace(SELF_FRAME_JS_MARK, ''), ['a', 'b'], 's')).toBeNull()
    expect(rebuildFromFrame(`${frame}${SELF_FRAME_JS_MARK}`, ['a', 'b'], 's')).toBeNull()
  })

  it('refuses a stylesheet count that does not match the marks', () => {
    expect(rebuildFromFrame(frame, ['a'], 's')).toBeNull()
    expect(rebuildFromFrame(frame, ['a', 'b', 'c'], 's')).toBeNull()
  })

  it('refuses a duplicated stylesheet mark', () => {
    expect(rebuildFromFrame(`${frame}${selfFrameCssMark(0)}`, ['a', 'b'], 's')).toBeNull()
  })

  // PT-2306 item 7: the stylesheets come first, so the script would go into this one.
  it('refuses a stylesheet that holds the script mark', () => {
    expect(rebuildFromFrame(frame, [`a{}/*${SELF_FRAME_JS_MARK}*/`, 'b{}'], 's')).toBeNull()
  })
})

describe('selfTemplateSource', () => {
  it('is undefined for the unreplaced slot (the dev server, a test)', () => {
    const script = document.createElement('script')
    expect(selfTemplateSource(SELF_FRAME_SLOT, document, script)).toBeUndefined()
  })

  it('is undefined without the running script', () => {
    expect(selfTemplateSource(frame, document, null)).toBeUndefined()
  })

  /** A <style> in `doc`'s head; `own`: one the build inlined (it carries the attribute). */
  function addStyle(doc: Document, css: string, own: boolean): void {
    const style = doc.createElement('style')
    if (own) style.setAttribute(SELF_FRAME_STYLE_ATTR, '')
    style.textContent = css
    doc.head.appendChild(style)
  }

  it('rebuilds the page from the styles and script read when it was made', async () => {
    const doc = document.implementation.createHTMLDocument('t')
    for (const css of ['a{}', 'b{}']) addStyle(doc, css, true)
    const script = doc.createElement('script')
    script.textContent = 'run()'
    doc.body.appendChild(script)

    const source = selfTemplateSource(frame, doc, script)
    // A <style> added later (after the page started) is not read.
    addStyle(doc, 'late{}', true)

    expect(source).toBeDefined()
    expect(await source?.()).toBe(rebuildFromFrame(frame, ['a{}', 'b{}'], 'run()'))
  })

  // PT-2306 item 4: an extension's <style>, there before the script ran.
  it('reads only the stylesheets the build inlined', async () => {
    const doc = document.implementation.createHTMLDocument('t')
    addStyle(doc, 'extension{}', false)
    addStyle(doc, 'a{}', true)
    addStyle(doc, 'injected{}', false)
    addStyle(doc, 'b{}', true)
    const script = doc.createElement('script')
    script.textContent = 'run()'
    doc.body.appendChild(script)

    const rebuilt = await selfTemplateSource(frame, doc, script)?.()
    expect(rebuilt).not.toBeNull()
    expect(rebuilt).toBe(rebuildFromFrame(frame, ['a{}', 'b{}'], 'run()'))
  })
})
