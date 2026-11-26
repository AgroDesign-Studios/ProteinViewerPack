import { useTranslation } from 'react-i18next'
import {
  SURFACE_TYPE_KEYS,
  SURFACE_TYPES_WITH_CAVEAT,
  type SurfaceTypeKey,
} from './surfaceType'

interface Props {
  value: SurfaceTypeKey
  /**
   * A click is its own gesture, so this commits immediately — there is no live
   * value to keep separate the way the depth sliders have one.
   */
  onChange: (next: SurfaceTypeKey) => void
  /**
   * Namespace for the `id` this group's label is wired to. Both viewers can be
   * open at once as separate documents, but a future host mounting two of these
   * in ONE document would otherwise collide.
   */
  idPrefix: string
}

/**
 * Which surface the viewer draws: van der Waals, molecular, solvent-accessible
 * or 3Dmol's "SES".
 *
 * CHIPS, NOT A `<select>` AND NOT A `role="radiogroup"` — both are load-bearing
 * and both are enforced by tests that would fail for a misleading reason:
 *
 *  - DESIGN.md 6.2.2 bans a second `<select>`. A page test resolves the colour
 *    scheme with a bare `screen.getByRole('combobox')`, which searches the
 *    whole document; a second one throws.
 *  - A page test asserts `getAllByRole('radiogroup')).toHaveLength(1)`
 *    page-wide, deliberately, so that another style control is the only one.
 *    A radiogroup here makes that count 2, and the failure points at the
 *    wrong control.
 *
 * The host reveals this group only while the surface is on: DESIGN.md 6.2.5
 * records the measurement that three permanently-visible controls push this
 * toolbar onto another line at real usage widths, and a toolbar line is a line
 * the canvas below it does not get.
 */
export default function SurfaceTypeChips({ value, onChange, idPrefix }: Props) {
  const { t } = useTranslation('proteindb')

  const valueHasCaveat = SURFACE_TYPES_WITH_CAVEAT.includes(value)

  return (
    <div className="sv3d-chips" role="group" aria-labelledby={`${idPrefix}-surface-type-label`}>
      <span className="sv3d-chip-label" id={`${idPrefix}-surface-type-label`}>
        {t('proteindb:viewer_surface_type')}
      </span>

      {SURFACE_TYPE_KEYS.map(key => {
        const caveat = SURFACE_TYPES_WITH_CAVEAT.includes(key)
        return (
          <button
            key={key}
            type="button"
            className="sv3d-chip"
            aria-pressed={value === key}
            onClick={() => onChange(key)}
            title={t(`proteindb:viewer_surface_type_${key.toLowerCase()}_hint`)}
          >
            {t(`proteindb:viewer_surface_type_${key.toLowerCase()}`)}
            {/*
              The caveat marker is a character, not a colour: DESIGN.md 9 forbids
              carrying meaning in colour alone, and this one has to survive a
              screenshot. It stays `aria-hidden` — a bare "!" announced on its
              own says nothing — and the warning it stands for is carried into
              the chip's own accessible NAME by the span below instead.

              In the name, not in `aria-describedby` and not in `title`. A title
              on a button that already has text is at best an optional
              description and never reaches a keyboard-only or touch user; a
              describedby aimed at the on-screen note would only cover the chip
              that is already selected, leaving the OTHER caveat chip announced
              as a bare "SAS, button" while a sighted user sees its "!". The
              name is the one channel every AT reads, on every chip, before the
              click rather than after it.
            */}
            {caveat && (
              <>
                <span className="sv3d-chip-caveat" aria-hidden="true">
                  !
                </span>
                <span className="sr-only">
                  {t(`proteindb:viewer_surface_type_${key.toLowerCase()}_caveat`)}
                </span>
              </>
            )}
          </button>
        )
      })}

      {/*
        The caveat stated on screen, not only in a hover title, while the surface
        it applies to is the one being drawn. A user judging a pocket or a
        contact against a surface that is systematically thin (SES) or
        systematically fat (SAS) has no way to see that from the picture: both
        read as "smoother than VDW".

        `aria-hidden` because this is the SIGHTED half of a warning assistive
        technology already receives, verbatim, inside the chip's own accessible
        name. Exposing both would announce the same sentence twice on every
        selection.

        ⚠️ Do not "improve" this into an `aria-live` region. That was tried and
        removed: a live region inserted in the same mutation as its content is
        not announced at all, so it was inert for exactly the pointer-click case
        it was added for — and once the text is in the chip's name there is
        nothing left for it to do. Deleting the mechanism was the fix; adding a
        second one to prop it up would not have been.
      */}
      {valueHasCaveat && (
        <span className="sv3d-chip-note" aria-hidden="true">
          {t(`proteindb:viewer_surface_type_${value.toLowerCase()}_caveat`)}
        </span>
      )}
    </div>
  )
}
