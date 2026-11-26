import { useTranslation } from 'react-i18next'

import './PymolNotice.css'

/**
 * The notice AgDB shows wherever PyMOL source code is part of a screen
 * (owner 2026-11-13): who built this app, on what licence, and the PyMOL™
 * trademark line, in that order (owner wording 2026-11-15). The licence of
 * PyMOL asks that derivative software be plainly distinguished from
 * Schrödinger's PyMOL products: naming the developer and that the code was
 * modified and extended does that.
 *
 * - `block` (default): a padded strip with a top rule, for the foot of a card.
 * - `compact`: one bare paragraph (a dialog, a footer line).
 *
 * No `className`: no caller passed one (PT-9102 item 6); add it with the first that does.
 */
export function PymolNotice({ variant = 'block' }: { variant?: 'block' | 'compact' }) {
  const { t } = useTranslation('pymolNotice')
  return (
    <p className={`lib-notice lib-notice--${variant} pymol-notice`} data-testid="pymol-notice">
      {t('pymolNotice:notice')}
    </p>
  )
}
