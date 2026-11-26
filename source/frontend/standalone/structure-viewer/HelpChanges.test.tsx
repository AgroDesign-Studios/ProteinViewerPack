/**
 * HELP's 「改良点」 since v1.0.5 (owner 2026-11-20: the list moved to a
 * document on GitHub, linked): what the build is, that 3Dmol.js is used as
 * published, and the link to this version's CODE-CHANGES.md at the heading of
 * the language shown; the light edition without PyMOL.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { APP_VERSION } from './appLicence'
import { codeChangesUrl, HelpChanges, MOL3D_VERSION } from './HelpChanges'

let lang = 'ja'
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, vars?: Record<string, unknown>) => (vars === undefined ? k : `${k} ${JSON.stringify(vars)}`), i18n: { language: lang } }),
}))

describe('HelpChanges', () => {
  it('says what the build is, and links this version’s document at the Japanese half', () => {
    lang = 'ja'
    const { container } = render(<HelpChanges full />)
    expect(container).toHaveTextContent(`htmlExport:sa_chg_intro {"version":"3.2.0a","commit":"edcda80f","pyodide":"314.0.7","mol3d":"${MOL3D_VERSION}"}`)
    expect(container).toHaveTextContent(`htmlExport:sa_chg_doc {"version":"${APP_VERSION}"}`)
    const link = screen.getByRole('link', { name: /htmlExport:sa_chg_doc_link/ })
    expect(link).toHaveAttribute('href', `https://github.com/AgroDesign-Studios/ProteinViewerPack/blob/v${APP_VERSION}/CODE-CHANGES.md#日本語`)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(container).toHaveTextContent('htmlExport:sa_chg_doc_offline')
  })

  it('the light edition names 3Dmol.js alone; English opens the English half', () => {
    lang = 'en'
    const { container } = render(<HelpChanges full={false} />)
    expect(container).toHaveTextContent(`htmlExport:sa_chg_intro_light {"mol3d":"${MOL3D_VERSION}"}`)
    expect(container).not.toHaveTextContent('sa_chg_intro {')
    expect(screen.getByRole('link')).toHaveAttribute('href', expect.stringMatching(/\/CODE-CHANGES\.md#english$/))
  })

  it('no repository, no link', () => {
    expect(codeChangesUrl('ja', '')).toBeNull()
    expect(codeChangesUrl('en-US', 'https://example.org/r', '9.9.9')).toBe('https://example.org/r/blob/v9.9.9/CODE-CHANGES.md#english')
  })
})
