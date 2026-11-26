/**
 * gantt-css-prune: a single-file standalone build keeps only the CSS rules its
 * bundle can match (PT-2204).
 */
import { describe, expect, it } from 'vitest'
import { classUsage, ganttCssPrune, pruneCss, pruneSelector } from './gantt-css-prune'

const prune = (css: string, code: string) => pruneCss(css, classUsage(code))

describe('classUsage', () => {
  const used = classUsage(
    [
      'className:"gantt-grid btn btn-primary"',
      'className:`gantt-color-${c}`',
      'className:"gantt-weekend-"+d',
      'className:`gantt-timeline${s ? " scroll-mode" : ""}`',
      'const unit = "pt", x = "abs-"',
      'className:`bar${on ? "Active" : "Idle"}`',
      'el.style.setProperty(`--gantt-${k}`, v)',
      'style:{left:`-${x}px`, [`--${k}`]: v}',
    ].join(';'),
  )

  it('finds a class named whole in the code', () => {
    expect(used('gantt-grid')).toBe(true)
    expect(used('btn-primary')).toBe(true)
    expect(used('scroll-mode')).toBe(true)
  })

  it('finds a class a literal prefix can build at run time', () => {
    expect(used('gantt-color-pink')).toBe(true)
    expect(used('gantt-weekend-sat')).toBe(true)
    // A token right before a template slot may continue without a hyphen.
    expect(used('gantt-timeline-wide')).toBe(true)
  })

  // PT-2206 #1: a token before a template slot may go on without a hyphen.
  it('finds a class a template slot continues without a hyphen', () => {
    expect(used('barActive')).toBe(true)
    expect(used('barIdle')).toBe(true)
    expect(used('ba')).toBe(false)
  })

  // PT-2206 #5: the prefix rule reaches custom properties too.
  it('finds a custom property built at run time from a literal', () => {
    expect(used('--gantt-day')).toBe(true)
  })

  it('takes no token of dashes alone as a prefix', () => {
    // `-${x}px` and `--${k}` must not keep every --token and every -class.
    expect(used('--other-bg')).toBe(false)
    expect(used('-x')).toBe(false)
  })

  // PT-11072: React keys, nonces and formats put one letter before a slot,
  // and an escape in a template literal reads as a letter too; as prefixes
  // they kept every class starting with b, n, r or x.
  it('takes no single character or escape before a slot as a prefix', () => {
    const keys = classUsage(
      ['key:`b${i}`', 'id:`n${nonce}`', 'size:`${w}x${h}`', 'msg:`line\\n${rest}`', 'cls:`ab${k}`'].join(';'),
    )
    for (const name of ['bzap-chip', 'nfoo-panel', 'nqux-row', 'xyz-detail']) expect(keys(name)).toBe(false)
    // A two-character token still begins a family.
    expect(keys('abc')).toBe(true)
  })

  it('does not take a plain string ending without "-" as a prefix', () => {
    // "pt" (a jsPDF unit) must not keep the whole .pt-* family.
    expect(used('pt-other')).toBe(false)
    expect(used('btn-lg')).toBe(false)
  })

  it('needs the token to stand alone', () => {
    // "abs-" is a prefix, but of nothing named "bs-…".
    expect(used('bs-other')).toBe(false)
    expect(used('grid')).toBe(false)
  })

  // PT-4072: tokens are ASCII words, so no token can spell these names whole.
  it('counts a name holding a non-word character as used', () => {
    const none = classUsage('')
    for (const name of ['md:flex', 'w-1/2', 'w-0.5', 'ガント', 'gantt-行']) expect(none(name)).toBe(true)
    expect(none('')).toBe(false)
    expect(none('gantt-grid')).toBe(false)
  })
})

describe('pruneCss', () => {
  it('drops a rule whose every selector names an unused class', () => {
    expect(prune('.gantt-grid{a:1}.other-host{b:2}', '"gantt-grid"')).toBe('.gantt-grid{a:1}')
  })

  it('keeps the used selectors of a mixed list', () => {
    expect(prune('.gantt-grid,.other-host{a:1}', '"gantt-grid"')).toBe('.gantt-grid{a:1}')
  })

  it('needs every class of a compound selector', () => {
    expect(prune('.gantt-grid .other-panel{a:1}', '"gantt-grid"')).toBe('')
  })

  it('keeps selectors without classes', () => {
    const css = ':root{--blue:#00f}html,body{a:1}[hidden]{display:none}'
    expect(prune(`${css}.x-y{b:2}`, 'color:"var(--blue)"')).toBe(css)
  })

  it('never requires a class inside :not()', () => {
    expect(prune('.gantt-grid:not(.other-panel){a:1}', '"gantt-grid"')).toBe('.gantt-grid:not(.other-panel){a:1}')
  })

  it('requires one alternative of :has() / :is()', () => {
    expect(prune('.gantt-grid:has(>.other-panel){a:1}', '"gantt-grid"')).toBe('')
    expect(prune(':is(.other-panel,.gantt-grid) p{a:1}', '"gantt-grid"')).toBe(':is(.gantt-grid) p{a:1}')
    expect(prune(':where(.other-panel,.other-box) p{a:1}', '"gantt-grid"')).toBe('')
  })

  // PT-2206 #2: the selector is read token by token, not by a regex over it.
  it('reads no class inside an attribute value or a string', () => {
    expect(prune('a[href$=".pdf"]{a:1}', '')).toBe('a[href$=".pdf"]{a:1}')
    expect(prune('.gantt-grid[data-k=\'x.other-box\']{a:1}', '"gantt-grid"')).toBe(".gantt-grid[data-k='x.other-box']{a:1}")
    expect(prune('.gantt-grid:not([title="a.b, c"]){a:1}', '"gantt-grid"')).toBe('.gantt-grid:not([title="a.b, c"]){a:1}')
    expect(prune('a[href$=".pdf"] .other-box{a:1}', '')).toBe('')
  })

  // PT-4072: an escaped or non-ASCII class name is kept, not dropped.
  it('keeps a class whose unescaped name holds a non-word character', () => {
    expect(prune('.ガント{color:red}', 'h("div",{className:"ガント"})')).toBe('.ガント{color:red}')
    expect(prune('.md\\:flex{a:1}.w-1\\/2{b:2}.w-0\\.5{c:3}', '')).toBe('.md\\:flex{a:1}.w-1\\/2{b:2}.w-0\\.5{c:3}')
    expect(pruneSelector('.md\\:flex', classUsage('"md flex"'))).toBe('.md\\:flex')
    // A minifier may write the name as hex escapes (U+30AC U+30F3 U+30C8).
    expect(prune('.\\30AC\\30F3\\30C8{a:1}', '')).toBe('.\\30AC\\30F3\\30C8{a:1}')
    // The other classes of the selector are still required.
    expect(pruneSelector('.ガント .other-box', classUsage(''))).toBeNull()
    // An escape that unescapes to an ASCII word is still looked up as one.
    expect(prune('.\\31 0{a:1}.\\32 0{b:2}', '"10"')).toBe('.\\31 0{a:1}')
  })

  it('drops the unused alternatives of :is() / :where() / :has()', () => {
    const used = classUsage('"gantt-grid gantt-row"')
    expect(pruneSelector(':where(.other-panel, .gantt-grid) p', used)).toBe(':where(.gantt-grid) p')
    expect(pruneSelector('.gantt-grid:has(> .other-panel, > .gantt-row)', used)).toBe('.gantt-grid:has(> .gantt-row)')
    expect(pruneSelector(':is(:is(.other-panel, .gantt-grid), .other-box) b', used)).toBe(':is(:is(.gantt-grid)) b')
    // Nothing to drop: the selector stays exactly as written.
    expect(pruneSelector(':is( .gantt-grid , .gantt-row ) p', used)).toBe(':is( .gantt-grid , .gantt-row ) p')
  })

  it('keeps an :is() whole when dropping an alternative would lower its specificity', () => {
    const used = classUsage('"gantt-grid"')
    expect(pruneSelector(':is(#top .other-panel, .gantt-grid) p', used)).toBe(':is(#top .other-panel, .gantt-grid) p')
    expect(pruneSelector(':is(.other-panel.other-box, .gantt-grid) p', used)).toBe(':is(.other-panel.other-box, .gantt-grid) p')
    // :where() weighs nothing, so its alternatives can always go.
    expect(pruneSelector(':where(#top .other-panel, .gantt-grid) p', used)).toBe(':where(.gantt-grid) p')
    // A tie is no loss.
    expect(pruneSelector(':is(.other-panel, .gantt-grid) p', used)).toBe(':is(.gantt-grid) p')
  })

  it('removes an at-rule left empty', () => {
    expect(prune('@media (max-width:600px){.other-box{a:1}}.gantt-grid{b:2}', '"gantt-grid"')).toBe('.gantt-grid{b:2}')
    expect(prune('@media print{@supports (x:y){.other-box{a:1}}}', '')).toBe('')
  })

  it('keeps the keyframes a kept rule names, drops the rest', () => {
    const css = '@keyframes spin{0%{a:0}to{a:1}}@keyframes other-hop{0%{a:0}}.gantt-grid{animation:spin 1s}.other{animation:other-hop 1s}'
    expect(prune(css, '"gantt-grid"')).toBe('@keyframes spin{0%{a:0}to{a:1}}.gantt-grid{animation:spin 1s}')
  })

  // PT-2206 #3
  it('keeps the keyframes a kept rule names through a custom property', () => {
    const css =
      ':root{--spin-anim:spin 1s;--hop:var(--hop-name) 2s;--hop-name:hop}@keyframes spin{to{a:1}}@keyframes hop{to{a:1}}' +
      '@keyframes other-hop{to{a:1}}.gantt-grid{animation:var(--spin-anim)}.gantt-row{animation:var(--hop)}'
    expect(prune(css, '"gantt-grid gantt-row"')).toBe(css.replace('@keyframes other-hop{to{a:1}}', ''))
  })

  it('keeps the keyframes the code names through a custom property', () => {
    const css = ':root{--gantt-pulse:pulse 1s}@keyframes pulse{to{a:1}}@keyframes other-hop{to{a:1}}'
    expect(prune(css, 'el.style.animation="var(--gantt-pulse)"')).toBe(':root{--gantt-pulse:pulse 1s}@keyframes pulse{to{a:1}}')
  })

  it('reads a quoted @keyframes name', () => {
    const css = '@keyframes "spin"{to{a:1}}@keyframes \'other-hop\'{to{a:1}}.gantt-grid{animation:"spin" 1s}'
    expect(prune(css, '"gantt-grid"')).toBe('@keyframes "spin"{to{a:1}}.gantt-grid{animation:"spin" 1s}')
  })

  // PT-2206 #6
  it('keeps the layer order an emptied @layer block declared', () => {
    expect(prune('@layer a{.other-box{x:1}}@layer b{.gantt-grid{y:1}}@layer a{.gantt-grid{z:1}}', '"gantt-grid"')).toBe(
      '@layer a;@layer b{.gantt-grid{y:1}}@layer a{.gantt-grid{z:1}}',
    )
    expect(prune('@layer a, b;@layer{.other-box{x:1}}.gantt-grid{y:1}', '"gantt-grid"')).toBe('@layer a, b;.gantt-grid{y:1}')
    // Left last, the statement still ends in ";".
    expect(prune('.gantt-grid{y:1}@layer a{.other-box{x:1}}', '"gantt-grid"')).toBe('.gantt-grid{y:1}@layer a;')
  })

  it('keeps the custom properties something left reads, transitively', () => {
    const css = ':root{--blue:#00f;--bar:var(--blue);--other-bg:#000;--unused:1px}.gantt-grid{color:var(--bar)}.other-box{color:var(--other-bg)}'
    expect(prune(css, '"gantt-grid"')).toBe(':root{--blue:#00f;--bar:var(--blue)}.gantt-grid{color:var(--bar)}')
  })

  it('keeps a custom property the code names', () => {
    expect(prune(':root{--gantt-day:20px;--x:1}', 'getPropertyValue("--gantt-day")')).toBe(':root{--gantt-day:20px}')
  })
})

describe('ganttCssPrune', () => {
  it('prunes the CSS asset against the chunk code and the HTML', () => {
    const bundle: Record<string, unknown> = {
      'gantt.js': { type: 'chunk', fileName: 'gantt.js', code: 'h("div",{className:"gantt-grid"})' },
      'index.html': { type: 'asset', fileName: 'index.html', source: '<div class="standalone-page"></div>' },
      'gantt.css': {
        type: 'asset',
        fileName: 'gantt.css',
        source: '.gantt-grid{a:1}.standalone-page{b:2}.other-row{c:3}',
      },
    }
    const plugin = ganttCssPrune()
    expect(plugin.enforce).toBe('post')
    ;(plugin.generateBundle as (o: unknown, b: unknown) => void).call({}, {}, bundle)
    expect((bundle['gantt.css'] as { source: string }).source).toBe('.gantt-grid{a:1}.standalone-page{b:2}')
  })
})
