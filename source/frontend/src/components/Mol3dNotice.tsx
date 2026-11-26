import { useTranslation } from 'react-i18next'

import './PymolNotice.css'

/** The anchor of the full 3Dmol.js license text (`Mol3dLicenseText`); defined once here (PT-9113 item 3). */
export const MOL3D_LICENSE_ANCHOR = 'lic-3dmol'

/** The link to the full 3Dmol.js license text. */
export const MOL3D_LICENSE_HREF = `/help/third-party#${MOL3D_LICENSE_ANCHOR}`

/** The 3Dmol.js entry's title in the offline file's license list, which its notice opens at. */
export const MOL3D_LICENSE_TITLE = '3Dmol.js'

/**
 * The 3Dmol.js credit shown beside a 3Dmol.js view (owner 2026-11-14): the
 * library's copyright line, its license (BSD-3-Clause) and a way to the full
 * license text. BSD-3-Clause asks that a binary redistribution reproduce the
 * notice, the conditions and the disclaimer, so the full text is one link or
 * dialog away. The wording only says the library is used: clause 3 forbids
 * using its authors' names to endorse a product.
 *
 * Shares `PymolNotice`'s look (the neutral `lib-notice` classes): `block` is
 * a padded strip, `follow` the same strip directly under a `PymolNotice`
 * block (no second rule), `compact` one bare paragraph. `brief` shows a
 * shorter line on a phone (640 px and narrower) — the fullscreen viewer's
 * strip, which would otherwise take three lines of the view (PT-9114 item 3);
 * the full line and its license link stay one tap away.
 */
export function Mol3dNotice(props: {
  /** Where the full license text is: a link in AgDB, the license dialog in the offline file. */
  license: { href: string } | { onOpen: () => void }
  variant?: 'block' | 'follow' | 'compact'
  brief?: boolean
  className?: string
}) {
  const { license, variant = 'block', brief = false, className } = props
  const { t } = useTranslation(['proteindb', 'common'])
  const link =
    'href' in license ? (
      // A new tab: the viewer beside it keeps its scene.
      <a href={license.href} target="_blank" rel="noopener noreferrer">
        {t('proteindb:viewer_3dmol_license_link')}
        <span className="sr-only"> {t('common:opens_in_new_tab')}</span>
      </a>
    ) : (
      <button type="button" className="lib-notice-link" onClick={license.onOpen}>
        {t('proteindb:viewer_3dmol_license_link')}
      </button>
    )
  const kind = variant === 'follow' ? 'block lib-notice--follow' : variant
  return (
    <p className={`lib-notice lib-notice--${kind} mol3d-notice${className ? ` ${className}` : ''}`} data-testid="mol3d-notice">
      {brief ? (
        <>
          <span className="lib-notice-full">{t('proteindb:viewer_3dmol_notice')}</span>
          <span className="lib-notice-brief">{t('proteindb:viewer_3dmol_notice_brief')}</span>
        </>
      ) : (
        t('proteindb:viewer_3dmol_notice')
      )}{' '}
      {link}
    </p>
  )
}
