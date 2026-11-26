/**
 * The page buttons' icons: 全画面, スマホ表示 and PC表示 (PT-9263 item 2),
 * and 画像出力's camera (owner 2026-11-16).
 * Inline SVG in the text's colour, not emoji: ⛶ is no emoji and many phone
 * fonts lack it (a box or another glyph), and 📱/🖥 render as each platform's
 * picture, outside DESIGN.md §3's emoji list. Decoration beside the words.
 * And the language switch's two flags (owner 2026-11-17).
 */
import type { ReactNode } from 'react'

function PageIcon({ children }: { children: ReactNode }) {
  return (
    <svg className="sav-page-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </svg>
  )
}

/** Four corners pointing out. */
export const FullscreenIcon = () => (
  <PageIcon>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </PageIcon>
)

/** A phone, upright. */
export const PhoneIcon = () => (
  <PageIcon>
    <rect x="7" y="3" width="10" height="18" rx="2" />
    <path d="M11 18h2" />
  </PageIcon>
)

/** A computer screen on its stand. */
export const DesktopIcon = () => (
  <PageIcon>
    <rect x="3" y="4" width="18" height="12" rx="1.5" />
    <path d="M9 20h6M12 16v4" />
  </PageIcon>
)

/** A camera: 「画像出力」 (owner 2026-11-16). */
export const CameraIcon = () => (
  <PageIcon>
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13" r="3.5" />
  </PageIcon>
)

/**
 * The language switch's flags (owner 2026-11-17: 英国国旗と日の丸), drawn
 * here in plain shapes — a flag emoji is the letters 「GB」 on Windows. Each
 * is this app's own simplified drawing of the national flag (no picture
 * taken from elsewhere): the Union Flag as a blue field, the white and red
 * diagonals and the white-edged red cross (its red diagonals drawn centred,
 * not offset); the Hinomaru as a red disc three fifths of the height on
 * white. Decoration, `aria-hidden`: the language's name beside it is the
 * button's text. `sav-flag` gives the white one an edge on a white button.
 * Each slices to its box (`preserveAspectRatio`), so the phone's round flag
 * (owner 2026-11-21) is the flag's middle in a circle; a computer's box has
 * the flag's own proportions and shows all of it.
 */
export const FlagUk = () => (
  <svg className="sav-flag sav-flag--uk" viewBox="0 0 60 30" width="24" height="12" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <rect width="60" height="30" fill="#012169" />
    <path d="M0 0L60 30M60 0L0 30" stroke="#fff" strokeWidth="6" />
    <path d="M0 0L60 30M60 0L0 30" stroke="#c8102e" strokeWidth="2" />
    <path d="M30 0v30M0 15h60" stroke="#fff" strokeWidth="10" />
    <path d="M30 0v30M0 15h60" stroke="#c8102e" strokeWidth="6" />
  </svg>
)

export const FlagJapan = () => (
  <svg className="sav-flag sav-flag--jp" viewBox="0 0 30 20" width="18" height="12" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <rect width="30" height="20" fill="#fff" />
    <circle cx="15" cy="10" r="6" fill="#bc002d" />
  </svg>
)
