import type { Plugin } from 'vite'
import {
  SELF_FRAME_JS_MARK,
  SELF_FRAME_SLOT,
  SELF_FRAME_STYLE_ATTR,
  rebuildFromFrame,
  selfFrameCssMark,
} from '../src/pages/tools/gantt/ganttSelfFrame.ts'

/**
 * Inline every build asset into `index.html` so the build output is ONE
 * portable file that runs from a double-clicked file:// URL.
 *
 * Written here rather than pulled from npm (vite-plugin-singlefile) for two
 * reasons: it is ~40 lines against Rollup's stable bundle API, and this build
 * exists precisely to be handed to people outside the project — a distribution
 * artifact should not gain a supply-chain dependency for string concatenation.
 *
 * file:// specifics, both of which the npm plugin does NOT handle:
 *   - the script is emitted as a CLASSIC script, not `type="module"`. A module
 *     script is fetched under CORS rules even when inline-adjacent, and
 *     Chromium refuses module resolution on opaque file:// origins. The
 *     companion config therefore builds `format: 'iife'`.
 *   - `</script>` inside the bundle (string literals, regexes) is escaped, or
 *     the HTML parser would end the tag early.
 *   - `<!--` inside the bundle FAILS the build. Followed by `<script` it puts
 *     the parser in the "double-escaped" state, where the escaped `<\/script`
 *     no longer ends the tag. No rewrite is safe in every JS context (`\!` is
 *     a SyntaxError in a /u regex), and the bundle holds none today.
 *
 * Self outline: when the entry chunk holds SELF_FRAME_SLOT as a string
 * literal, it is replaced by the finished page with the stylesheets and the
 * script left as marks (ganttSelfFrame.ts), so the page can rebuild its own
 * file at run time. The page itself is
 * then assembled from that outline by the same function the page uses, so
 * what the page rebuilds is what was written. Each inlined <style> carries
 * SELF_FRAME_STYLE_ATTR, so the page tells its own from one added later.
 * `requireSelfFrame` fails a build whose entry holds no slot, since without
 * the outline the page cannot rebuild itself (PT-2306).
 */
export function inlineSingleFile({ requireSelfFrame = false }: { requireSelfFrame?: boolean } = {}): Plugin {
  return {
    name: 'agdb-inline-single-file',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find(
        (c): c is import('rollup').OutputAsset =>
          c.type === 'asset' && c.fileName.endsWith('.html'),
      )
      if (!html) return

      let source = typeof html.source === 'string' ? html.source : Buffer.from(html.source).toString()
      // The page is first built as an outline — each piece a mark — and the
      // pieces go in at the end (the self outline needs the page without them).
      let entryCode: string | null = null
      const styles: string[] = []

      for (const chunk of Object.values(bundle)) {
        if (chunk === html) continue
        // NOTE: every replacement goes through a REPLACER FUNCTION. Bundled
        // code is full of `$&` / `$1` (regex replacement strings in React and
        // jsPDF); as a replacement *string* those would expand to the matched
        // <script> tag and silently corrupt the artifact.
        if (chunk.type === 'chunk' && chunk.isEntry) {
          if (chunk.code.includes('<!--')) {
            this.error(`${chunk.fileName} contains "<!--", which cannot be inlined safely`)
          }
          entryCode = chunk.code
          // Vite emits the entry as `<script type="module" src>` in <head>,
          // where a module's implicit `defer` makes it run after parsing.
          // An inline CLASSIC script has no defer, so it must MOVE to the end
          // of <body> — left in <head> it runs before #root exists and React
          // throws "Target container is not a DOM element" (#299).
          source = source
            .replace(new RegExp(`\\s*<script[^>]*src="[^"]*${escapeRe(chunk.fileName)}"[^>]*></script>`), () => '')
            .replace('</body>', () => `  <script>${SELF_FRAME_JS_MARK}</script>\n  </body>`)
          delete bundle[chunk.fileName]
        } else if (chunk.type === 'asset' && chunk.fileName.endsWith('.css')) {
          const css = typeof chunk.source === 'string' ? chunk.source : Buffer.from(chunk.source).toString()
          source = source.replace(
            new RegExp(`<link[^>]*href="[^"]*${escapeRe(chunk.fileName)}"[^>]*>`),
            () => `<style ${SELF_FRAME_STYLE_ATTR}>${selfFrameCssMark(styles.length)}</style>`,
          )
          styles.push(css)
          delete bundle[chunk.fileName]
        }
      }
      if (entryCode === null) {
        if (requireSelfFrame) this.error(`no entry chunk to hold ${SELF_FRAME_SLOT}`)
        styles.forEach((css, i) => {
          source = source.replace(selfFrameCssMark(i), () => css)
        })
        html.source = source
        return
      }

      const slot = new RegExp(`(["'\`])${SELF_FRAME_SLOT}\\1`, 'g')
      const slots = entryCode.match(slot)?.length ?? 0
      if (slots > 1) this.error(`the entry chunk holds ${SELF_FRAME_SLOT} ${slots} times`)
      if (slots === 0 && requireSelfFrame) this.error(`the entry chunk does not hold ${SELF_FRAME_SLOT}`)
      // JSON.stringify gives a valid JS string literal; its `</script` is
      // escaped with the rest of the code below (`<\/script` reads the same).
      const outline = source
      if (slots === 1) entryCode = entryCode.replace(slot, () => JSON.stringify(outline))
      if (entryCode.includes('<!--')) this.error('the self outline contains "<!--"')
      const code = entryCode.replace(/<\/script/gi, '<\\/script')
      const page = rebuildFromFrame(source, styles, code)
      // The script's own marks are fine (it goes in last, as it is).
      if (page === null) this.error('the page or a stylesheet holds an inliner mark')
      html.source = page
    },
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
