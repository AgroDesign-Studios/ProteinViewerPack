import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import './PymolContainsLabel.css'

/** The translation key: the whole phrase, its tiers marked up, so a translation can reorder it. */
const KEY = 'pymolNotice:contains_label'

/** The tags the phrase may carry, each a class here. Anything else is text. */
const TAG_CLASS = { small: 'pymol-contains-small', line: 'pymol-contains-line', big: 'pymol-contains-big' } as const
type Tag = keyof typeof TAG_CLASS
const TAG = /<(\/?)(small|line|big)>/g

/** The phrase as plain text: the accessible name, and what decides `lang`. */
export function pymolContainsText(translated: string): string {
  return translated.replace(TAG, '').replace(/\s+/g, ' ').trim()
}

/**
 * The phrase's language when it is not the page's: the owner's wording is the
 * English one in both languages (the PyMOL™ licence), so inside the Japanese
 * UI it is marked `lang="en"` for a screen reader's voice (PT-9103 item 7). A
 * translation in another script drops the mark by itself.
 */
export function pymolContainsLang(translated: string): 'en' | undefined {
  return /^[\x20-\x7e™]*$/.test(pymolContainsText(translated)) ? 'en' : undefined
}

/** Builds the marked-up phrase as spans; a tag left open closes at the end. */
function renderTiers(translated: string): ReactNode[] {
  type Frame = { tag: Tag | null; children: ReactNode[] }
  const stack: Frame[] = [{ tag: null, children: [] }]
  let at = 0
  let key = 0
  const close = () => {
    const done = stack.pop()
    if (!done || done.tag === null) return
    stack[stack.length - 1].children.push(
      <span key={key++} className={TAG_CLASS[done.tag]}>
        {done.children}
      </span>,
    )
  }
  for (const m of translated.matchAll(TAG)) {
    if (m.index > at) stack[stack.length - 1].children.push(translated.slice(at, m.index))
    at = m.index + m[0].length
    const tag = m[2] as Tag
    if (m[1] === '') stack.push({ tag, children: [] })
    else if (stack[stack.length - 1].tag === tag) close()
  }
  if (at < translated.length) stack[stack.length - 1].children.push(translated.slice(at))
  while (stack.length > 1) close()
  return stack[0].children
}

/**
 * "Includes PyMOL™" (owner 2026-11-16; "Contains PyMOL™ source code" before) in the licence's two tiers — PyMOL™ the large
 * part, the rest small (owner 2026-11-13) — drawn the same by the
 * engine switch (`md`, PyMOL™ 14 px) and a brand bar (`lg`,
 * 16 px) (PT-9102 item 4). The phrase is ONE translation key with its tiers
 * marked up (`<small>`, `<line>`, `<big>`), so word order and spacing live in
 * the translation, not in the markup (PT-9103 item 1).
 *
 * Decoration only (`aria-hidden`): the caller names its control with
 * `pymolContainsText` — one reading of the whole phrase.
 *
 * `stacked` (the compact engine switch, owner 2026-11-16): the
 * `<big>` part takes a line of its own, so the phrase reads a tier a line
 * (Includes / PyMOL™) from the same translation; default off.
 */
export function PymolContainsLabel({ size, stacked = false }: { size: 'md' | 'lg'; stacked?: boolean }) {
  const { t } = useTranslation('pymolNotice')
  const translated = t(KEY)
  return (
    <span
      className={`pymol-contains pymol-contains--${size}${stacked ? ' pymol-contains--stacked' : ''}`}
      lang={pymolContainsLang(translated)}
      aria-hidden="true"
    >
      {renderTiers(translated)}
    </span>
  )
}

/** The phrase as text and its language, for the name of the control that shows the label. */
export function usePymolContainsName(): { text: string; lang: 'en' | undefined } {
  const { t } = useTranslation('pymolNotice')
  const translated = t(KEY)
  return { text: pymolContainsText(translated), lang: pymolContainsLang(translated) }
}
