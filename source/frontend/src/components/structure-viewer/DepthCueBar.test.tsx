/**
 * Component tests for DepthCueBar — the depth-cue / cross-section chip row
 * mounted in both viewers' toolbars.
 *
 * `react-i18next` is replaced by a lookup into the REAL `ja/proteindb.json`
 * bundle: the bar's whole job is rendering
 * labelled controls, and a key-echoing stub would pass against a typo'd key
 * that ships on screen.
 */
import { useState } from 'react'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import jaCommon from '../../i18n/locales/ja/common.json'
import jaProteindb from '../../i18n/locales/ja/proteindb.json'
import enProteindb from '../../i18n/locales/en/proteindb.json'

const BUNDLES: Record<string, Record<string, string>> = {
  proteindb: jaProteindb as Record<string, string>,
  common: jaCommon as Record<string, string>,
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'ja' },
    t: (key: string, opts?: Record<string, unknown>) => {
      const [ns, name] = key.includes(':') ? key.split(':') : ['proteindb', key]
      const template = BUNDLES[ns]?.[name]
      if (template === undefined) return (opts?.defaultValue as string) ?? name
      return template.replace(/\{\{(\w+)\}\}/g, (_m, token) => String(opts?.[token] ?? ''))
    },
  }),
}))

import DepthCueBar from './DepthCueBar'
import { useDepthCue } from './useDepthCue'
import {
  CAP_OPACITY_DEFAULT,
  CAP_OPACITY_MAX,
  CAP_OPACITY_MIN,
  CUT_MAX,
  DEPTH_CUE_DEFAULT,
  THICKNESS_MIN,
  type DepthCue,
} from './depthCue'
import { setNumberFormatStyle } from '../../utils/formatSI'

/**
 * A 100 A molecule. The readouts are the fraction times the slab WINDOW
 * (span/2 + span/1.9 = 102.6 A), not times the span — see `depthWindowA`.
 */
const SPAN = 100
const WINDOW = SPAN / 2 + SPAN / 1.9
const readout = (fraction: number) => `${(fraction * WINDOW).toFixed(1)} Å`

/**
 * Mirrors the shape of `useDepthCue`'s contract so the BAR's own wiring can be
 * checked in isolation: `value` follows every change (the canvas has to),
 * `committed` advances only when a gesture ends, and `commits` records each
 * commit so a test can count them.
 *
 * It is a stand-in, not the hook — nothing here proves the shipped controller
 * behaves this way, and a page could still wire `onChange` to the committing
 * callback. Those two are covered where they live: `useDepthCue.test.ts` for
 * the controller, and a page-level case that asserts a slider value
 * reaches the persisted blob only on release.
 */
function Harness({
  initial = DEPTH_CUE_DEFAULT,
  spanA = SPAN as number | null,
  commits,
  cancels,
  external,
  capAvailable = true,
  densityShown,
}: {
  initial?: DepthCue
  spanA?: number | null
  commits?: DepthCue[]
  /** Each `onCancelGesture` call, so a test can assert one did NOT happen. */
  cancels?: DepthCue[]
  /**
   * A cue some OTHER surface commits, exposed as a button.
   *
   * Stands in for a stored view's restore, which commits a whole cue from outside
   * this bar — the writer that made a remembered confirm go stale (PT-413).
   */
  external?: DepthCue
  /** Defaults to true so the pre-existing cases see the full bar. */
  capAvailable?: boolean
  /**
   * A density map is on screen — what an unset projection follows. Left
   * undefined it is passed as undefined, which is how a viewer with no density
   * mounts the bar.
   */
  densityShown?: boolean
}) {
  const [value, setValue] = useState<DepthCue>(initial)
  const [committed, setCommitted] = useState<DepthCue>(initial)
  const commit = (next: DepthCue): void => {
    commits?.push(next)
    setValue(next)
    setCommitted(next)
  }
  return (
    <>
    {external && (
      <button type="button" onClick={() => commit(external)}>external</button>
    )}
    <DepthCueBar
      value={value}
      onChange={setValue}
      onCommit={commit}
      onCancelGesture={() => { cancels?.push(committed); setValue(committed) }}
      committed={committed}
      spanA={spanA}
      idPrefix="test-depth"
      capAvailable={capAvailable}
      densityShown={densityShown}
    />
    </>
  )
}

const chip = (name: string) => screen.getByRole('button', { name })

beforeEach(() => {
  cleanup()
  // Pin the style: the angstrom readouts run through formatSI, whose grouping
  // and decimal mark are a user preference that would otherwise follow the
  // runner's locale.
  setNumberFormatStyle('si')
})

describe('resting state', () => {
  it('offers the three switches and hides every slider', () => {
    render(<Harness />)
    expect(chip('奥行き強調')).toHaveAttribute('aria-pressed', 'false')
    expect(chip('断面')).toHaveAttribute('aria-pressed', 'false')
    expect(chip('平行投影')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryAllByRole('slider')).toHaveLength(0)
  })

  it('offers no reset while nothing is set', () => {
    // A Reset that is always there invites a click that does nothing.
    render(<Harness />)
    expect(screen.queryByRole('button', { name: '奥行きリセット' })).not.toBeInTheDocument()
  })
})

describe('depth cue', () => {
  it('reveals the strength slider only once the cue is on', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(chip('奥行き強調'))
    expect(chip('奥行き強調')).toHaveAttribute('aria-pressed', 'true')
    const slider = screen.getByRole('slider', { name: '強さ' })
    expect(slider).toHaveValue(String(DEPTH_CUE_DEFAULT.fogStrength))
  })

  it('reports the strength as a percentage', async () => {
    const user = userEvent.setup()
    render(<Harness initial={{ ...DEPTH_CUE_DEFAULT, fog: true, fogStrength: 0.35 }} />)
    expect(screen.getByText('35%')).toBeInTheDocument()
    await user.click(chip('奥行き強調'))
    expect(screen.queryByText('35%')).not.toBeInTheDocument()
  })
})

describe('cut face', () => {
  it('stays hidden until there is both a cut and a surface to cap', () => {
    // Off either of those the chip would toggle a setting with nothing to show
    // for it, on the widest row in the toolbar.
    render(<Harness />)
    expect(screen.queryByRole('button', { name: '切り口を塞ぐ' })).not.toBeInTheDocument()
    cleanup()

    render(<Harness initial={{ ...DEPTH_CUE_DEFAULT, slab: true }} capAvailable={false} />)
    expect(screen.queryByRole('button', { name: '切り口を塞ぐ' })).not.toBeInTheDocument()
  })

  it('appears pressed with the cross-section, because filled is the default', () => {
    // Owner ruling 2026-08-27: a cut that shows a filled face is what people
    // mean by a cross-section, so a fresh viewer starts capped.
    render(<Harness initial={{ ...DEPTH_CUE_DEFAULT, slab: true }} />)
    expect(chip('切り口を塞ぐ')).toHaveAttribute('aria-pressed', 'true')
  })

  it('commits the toggle on click', async () => {
    const user = userEvent.setup()
    const commits: DepthCue[] = []
    render(<Harness initial={{ ...DEPTH_CUE_DEFAULT, slab: true }} commits={commits} />)

    await user.click(chip('切り口を塞ぐ'))
    expect(commits[commits.length - 1]?.cap).toBe(false)
    expect(chip('切り口を塞ぐ')).toHaveAttribute('aria-pressed', 'false')

    await user.click(chip('切り口を塞ぐ'))
    expect(commits[commits.length - 1]?.cap).toBe(true)
  })

  it('leaves the cross-section itself alone', () => {
    // The cap is a property OF the cut, not a second way to switch it off.
    const commits: DepthCue[] = []
    render(<Harness initial={{ ...DEPTH_CUE_DEFAULT, slab: true, cut: 0.3 }} commits={commits} />)
    fireEvent.click(chip('切り口を塞ぐ'))
    expect(commits[commits.length - 1]).toMatchObject({ slab: true, cut: 0.3, cap: false })
  })
})

describe('cross-section', () => {
  it('reveals both sliders, in angstroms of the measured molecule', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(chip('断面'))
    expect(screen.getByRole('slider', { name: '手前カット' })).toHaveValue('0')
    expect(screen.getByRole('slider', { name: '厚み' }))
      .toHaveValue(String(DEPTH_CUE_DEFAULT.thickness))
    // thickness 0.6 of the 102.6 A slab window, NOT of the 100 A span.
    expect(screen.getByText(readout(0.6))).toBeInTheDocument()
    expect(screen.queryByText('60.0 Å')).not.toBeInTheDocument()
  })

  it('pins the sliders to the ranges the geometry allows', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(chip('断面'))
    const cut = screen.getByRole('slider', { name: '手前カット' })
    // Capped below 1: a cut that reaches the back face would empty the scene.
    expect(cut).toHaveAttribute('max', String(CUT_MAX))
    expect(screen.getByRole('slider', { name: '厚み' }))
      .toHaveAttribute('min', String(THICKNESS_MIN))
  })

  it('moves the front cut without touching the thickness', async () => {
    // The two-slider shape exists so the slice can be walked backwards through
    // the molecule at a constant depth. If moving the cut also moved the
    // thickness, the control would be a "show me less" knob instead.
    render(<Harness initial={{ ...DEPTH_CUE_DEFAULT, slab: true }} />)
    const cut = screen.getByRole('slider', { name: '手前カット' })
    // fireEvent, not userEvent: jsdom produces no intermediate values for a
    // range drag, so there is no user-level gesture that sets one.
    fireEvent.change(cut, { target: { value: '0.25' } })
    expect(cut).toHaveValue('0.25')
    expect(screen.getByText(readout(0.25))).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: '厚み' }))
      .toHaveValue(String(DEPTH_CUE_DEFAULT.thickness))
    expect(screen.getByText(readout(0.6))).toBeInTheDocument()
  })

  it('shows a dash instead of a fabricated size before the molecule is measured', () => {
    // The controls stay usable in that window because they are fractions; only
    // the angstrom captions have nothing honest to say yet.
    render(<Harness initial={{ ...DEPTH_CUE_DEFAULT, slab: true }} spanA={null} />)
    expect(screen.getAllByText('- Å').length).toBeGreaterThan(0)
  })
})

describe('reset', () => {
  it('appears once something is set and returns every switch to its default', async () => {
    const user = userEvent.setup()
    render(<Harness initial={{ ...DEPTH_CUE_DEFAULT, fog: true, slab: true, ortho: true }} />)
    await user.click(chip('奥行きリセット'))
    expect(chip('奥行き強調')).toHaveAttribute('aria-pressed', 'false')
    expect(chip('断面')).toHaveAttribute('aria-pressed', 'false')
    expect(chip('平行投影')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryAllByRole('slider')).toHaveLength(0)
  })
})

describe('the projection chip under density (PT-1299)', () => {
  it('reads pressed over a density map with nothing set, and offers no reset', () => {
    // The canvas is orthographic there, so an unpressed chip would misstate it;
    // and nothing has been set, so Reset would do nothing.
    render(<Harness densityShown />)
    expect(chip('平行投影')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: '奥行きリセット' })).not.toBeInTheDocument()
  })

  it('records a click against the density, then drops it on the click back', async () => {
    const user = userEvent.setup()
    const commits: DepthCue[] = []
    render(<Harness densityShown commits={commits} />)

    await user.click(chip('平行投影'))
    expect(commits[commits.length - 1]?.ortho).toBe(false)
    expect(chip('平行投影')).toHaveAttribute('aria-pressed', 'false')
    expect(chip('奥行きリセット')).toBeInTheDocument()

    await user.click(chip('平行投影'))
    expect(commits[commits.length - 1]?.ortho).toBeNull()
    expect(chip('平行投影')).toHaveAttribute('aria-pressed', 'true')
  })

  it('says what a click does: held against the automatic side, automatic again on the way back', () => {
    // PT-2044 item 2. "a click takes precedence" was false — a click back to the
    // side the density picks drops the override (`orthoAfterToggle`).
    render(<Harness densityShown={false} />)
    const hint = chip('平行投影').getAttribute('title')
    expect(hint).toBe(jaProteindb.viewer_depth_ortho_hint_follow)
    expect(hint).toContain('電子密度')
    expect(hint).toContain('自動に戻ります')
    expect(hint).not.toContain('優先')
  })

  it('keeps the hint under a fresh top-level key', () => {
    // PT-3994. Both bundles carry the hint under the new top-level key and no
    // longer carry the old key `viewer_depth_ortho_hint`, so the pre-#3660
    // sentence cannot come back under the old key.
    for (const bundle of [jaProteindb, enProteindb] as Record<string, unknown>[]) {
      expect(typeof bundle.viewer_depth_ortho_hint_follow).toBe('string')
      expect(bundle).not.toHaveProperty('viewer_depth_ortho_hint')
    }
  })

  it('leaves the density sentence out of the hint on a viewer that never shows density', () => {
    // PT-2044 item 3: a viewer with no density mounts the bar without
    // `densityShown`, and "turns on while density is shown" can never happen there.
    render(<Harness />)
    const hint = chip('平行投影').getAttribute('title')
    expect(hint).toBe(jaProteindb.viewer_depth_ortho_hint_no_density)
    expect(hint).not.toContain('電子密度')
  })

  it('without density, a click on and off returns to following', async () => {
    const user = userEvent.setup()
    const commits: DepthCue[] = []
    render(<Harness commits={commits} />)
    await user.click(chip('平行投影'))
    expect(commits[commits.length - 1]?.ortho).toBe(true)
    await user.click(chip('平行投影'))
    expect(commits[commits.length - 1]?.ortho).toBeNull()
  })

  it('names the density rule in the chip’s hint', () => {
    // The chip can light up on its own now; the hint is where that is explained
    // — on a page that can show density, which passes `densityShown`.
    render(<Harness densityShown={false} />)
    expect(chip('平行投影').getAttribute('title')).toContain('電子密度')
  })
})

describe('accessibility', () => {
  it('states each switch through aria-pressed, not colour alone', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(chip('平行投影'))
    expect(chip('平行投影')).toHaveAttribute('aria-pressed', 'true')
  })

  it('gives every slider a real label rather than a bare track', () => {
    render(<Harness initial={{ ...DEPTH_CUE_DEFAULT, fog: true, slab: true }} />)
    for (const name of ['強さ', '手前カット', '厚み']) {
      expect(screen.getByRole('slider', { name })).toBeInTheDocument()
    }
  })

  it('adds no combobox — the toolbar tests resolve Color as the only one', () => {
    render(<Harness initial={{ ...DEPTH_CUE_DEFAULT, fog: true, slab: true }} />)
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
  })
})

describe('release-commit (the localStorage write path)', () => {
  it('does not commit while a slider is being dragged', () => {
    // The whole point: `onCommit` is what writes the viewer-state blob, and a
    // drag fires onChange per pointer move. Committing there made every frame
    // a synchronous getView + JSON.stringify + localStorage.setItem.
    const commits: DepthCue[] = []
    render(<Harness initial={{ ...DEPTH_CUE_DEFAULT, slab: true }} commits={commits} />)
    const cut = screen.getByRole('slider', { name: '手前カット' })

    for (const v of ['0.1', '0.2', '0.3', '0.4']) {
      fireEvent.change(cut, { target: { value: v } })
    }
    expect(commits).toHaveLength(0)
    // …but the canvas HAS followed every one of them.
    expect(cut).toHaveValue('0.4')
    expect(screen.getByText(readout(0.4))).toBeInTheDocument()
  })

  it('commits once when the gesture ends', () => {
    const commits: DepthCue[] = []
    render(<Harness initial={{ ...DEPTH_CUE_DEFAULT, slab: true }} commits={commits} />)
    const cut = screen.getByRole('slider', { name: '手前カット' })

    fireEvent.change(cut, { target: { value: '0.3' } })
    fireEvent.mouseUp(cut, { target: { value: '0.3' } })
    expect(commits).toHaveLength(1)
    expect(commits[0].cut).toBe(0.3)
  })

  it('commits on the release of a key that moves a range input', () => {
    // A keyboard user fires neither mouseup nor touchend, so without this their
    // changes would never reach the persisted state at all.
    const commits: DepthCue[] = []
    render(<Harness initial={{ ...DEPTH_CUE_DEFAULT, slab: true }} commits={commits} />)
    const cut = screen.getByRole('slider', { name: '手前カット' })

    fireEvent.change(cut, { target: { value: '0.2' } })
    fireEvent.keyUp(cut, { key: 'ArrowRight', target: { value: '0.2' } })
    expect(commits).toHaveLength(1)

    // A key that does NOT move a range input is not a gesture ending.
    fireEvent.change(cut, { target: { value: '0.5' } })
    fireEvent.keyUp(cut, { key: 'Shift', target: { value: '0.5' } })
    expect(commits).toHaveLength(1)
  })

  it('commits a value an assistive technology set without any pointer or key', () => {
    // VoiceOver's swipe-adjust and voice control change a range with no mouse
    // and no key, so `blur` is the only ending they produce. The user DID
    // choose the value, so it is committed, not discarded.
    const commits: DepthCue[] = []
    render(<Harness initial={{ ...DEPTH_CUE_DEFAULT, slab: true }} commits={commits} />)
    const cut = screen.getByRole('slider', { name: '手前カット' })

    fireEvent.change(cut, { target: { value: '0.45' } })
    fireEvent.blur(cut, { target: { value: '0.45' } })
    expect(commits).toHaveLength(1)
    expect(commits[0].cut).toBe(0.45)
  })

  it('drops the in-progress value when the system takes the touch over', () => {
    const commits: DepthCue[] = []
    render(<Harness initial={{ ...DEPTH_CUE_DEFAULT, slab: true, cut: 0.1 }} commits={commits} />)
    const cut = screen.getByRole('slider', { name: '手前カット' })

    fireEvent.change(cut, { target: { value: '0.8' } })
    expect(cut).toHaveValue('0.8')
    fireEvent.touchCancel(cut)

    expect(commits).toHaveLength(0)
    expect(screen.getByRole('slider', { name: '手前カット' })).toHaveValue('0.1')
  })

  it('commits a chip immediately — a click is its own gesture', () => {
    const commits: DepthCue[] = []
    render(<Harness commits={commits} />)
    fireEvent.click(chip('断面'))
    expect(commits).toHaveLength(1)
    expect(commits[0].slab).toBe(true)
  })
})

describe('cut-face colour', () => {
  const CAPPED: DepthCue = { ...DEPTH_CUE_DEFAULT, slab: true, cap: true }

  it('appears only once there is a cut face to colour', () => {
    // Seven more controls on the widest row in the toolbar, all of them
    // changing nothing on screen — the same reasoning that hides the sliders.
    render(<Harness initial={{ ...CAPPED, cap: false }} />)
    expect(screen.queryByRole('button', { name: 'グレー(既定)' })).not.toBeInTheDocument()
    cleanup()

    render(<Harness initial={CAPPED} capAvailable={false} />)
    expect(screen.queryByRole('button', { name: 'グレー(既定)' })).not.toBeInTheDocument()
    cleanup()

    render(<Harness initial={CAPPED} />)
    expect(chip('グレー(既定)')).toHaveAttribute('aria-pressed', 'true')
  })

  it('commits a preset on the click and marks only that one', async () => {
    const user = userEvent.setup()
    const commits: DepthCue[] = []
    render(<Harness initial={CAPPED} commits={commits} />)

    await user.click(chip('レンガ'))

    expect(commits[commits.length - 1]?.capColor).toBe('firebrick')
    expect(chip('レンガ')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('グレー(既定)')).toHaveAttribute('aria-pressed', 'false')
  })

  it('follows the picker live but persists only when the dialog closes', () => {
    const commits: DepthCue[] = []
    render(<Harness initial={CAPPED} commits={commits} />)
    const picker = screen.getByLabelText('自由色') as HTMLInputElement

    // `input` is what the colour dialog emits per pointer move, and React maps
    // its own `onChange` onto that event — which is why the commit cannot be an
    // `onChange` handler too.
    fireEvent.input(picker, { target: { value: '#112233' } })
    expect(picker.value).toBe('#112233')
    expect(commits).toHaveLength(0)

    // `change` is the dialog closing: the end of the gesture.
    fireEvent.change(picker, { target: { value: '#112233' } })
    expect(commits[commits.length - 1])
      .toMatchObject({ capColor: 'custom', capCustomColor: '#112233' })
  })

  it('restores the preset when the colour dialog is dismissed', () => {
    // The picker has no `touchcancel`, so it needs its own abort path: `onChange`
    // fires per pointer move INSIDE the dialog and switches the live choice to
    // `custom`, and a dismissed dialog emits no `change`. Without the abort, the
    // cut face keeps a colour the user rejected and the next blur writes it to
    // the viewer-state blob with the preset silently gone.
    const commits: DepthCue[] = []
    render(<Harness initial={{ ...CAPPED, capColor: 'firebrick' }} commits={commits} />)
    const picker = screen.getByLabelText('自由色') as HTMLInputElement

    fireEvent.focus(picker)
    fireEvent.input(picker, { target: { value: '#ff0000' } })
    expect(chip('レンガ')).toHaveAttribute('aria-pressed', 'false')

    // Dismissed — no `change`.
    fireEvent.blur(picker)

    expect(commits).toHaveLength(0)
    expect(chip('レンガ')).toHaveAttribute('aria-pressed', 'true')
  })

  it('restores the preset when a RE-OPENED dialog is dismissed', () => {
    // A colour input keeps focus when its dialog closes, so opening it a second
    // time fires no `focus`. A boolean cleared on focus would still be set from
    // the first dialog, and the second dismissal would stand — which is why the
    // guard compares against the COMMITTED cue instead of remembering a confirm.
    const commits: DepthCue[] = []
    render(<Harness initial={{ ...CAPPED, capColor: 'firebrick' }} commits={commits} />)
    const picker = screen.getByLabelText('自由色') as HTMLInputElement

    fireEvent.input(picker, { target: { value: '#00ff00' } })
    fireEvent.change(picker, { target: { value: '#00ff00' } })
    expect(commits).toHaveLength(1)

    // Second dialog: no `focus` in between, and dismissed rather than confirmed.
    fireEvent.input(picker, { target: { value: '#ff0000' } })
    fireEvent.blur(picker)

    expect(commits).toHaveLength(1)
    expect(picker.value).toBe('#00ff00')
  })

  it('restores the preset when a dismissed re-open lands back on the confirmed colour', () => {
    // The narrow mouth of the same defect: a colour an EARLIER dialog confirmed
    // is not confirmed now that the committed choice is a preset again, so the
    // blur must not read it as "already confirmed" and skip the cancel.
    const commits: DepthCue[] = []
    render(<Harness initial={{ ...CAPPED, capColor: 'firebrick' }} commits={commits} />)
    const picker = screen.getByLabelText('自由色') as HTMLInputElement

    // Session 1: confirm a colour.
    fireEvent.input(picker, { target: { value: '#00ff00' } })
    fireEvent.change(picker, { target: { value: '#00ff00' } })
    expect(commits[commits.length - 1]?.capColor).toBe('custom')

    // Reaching for the preset takes focus off the input first — the browser
    // fires this, `fireEvent.click` does not, and the session ends here.
    fireEvent.blur(picker)

    // Back to a preset. `capCustomColor` stays #00ff00 on purpose — having
    // CONFIRMED it once must not count once the choice moved on.
    fireEvent.click(chip('レンガ'))
    expect(commits[commits.length - 1]?.capColor).toBe('firebrick')

    // Session 2: drift, then dismiss back on the colour session 1 confirmed.
    fireEvent.input(picker, { target: { value: '#123456' } })
    fireEvent.input(picker, { target: { value: '#00ff00' } })
    fireEvent.blur(picker)

    expect(chip('レンガ')).toHaveAttribute('aria-pressed', 'true')

    // And the harm the live state would otherwise do: every other control
    // spreads it, so an unrelated commit would persist the rejected choice.
    fireEvent.click(chip('平行投影'))
    expect(commits[commits.length - 1]).toMatchObject({ capColor: 'firebrick', ortho: true })
  })

  it('keeps a confirm the same session made', () => {
    // The other direction, and it needs the cancel RECORDER to be worth writing:
    // a spurious cancel here restores the identical committed cue, so asserting
    // on the rendered value alone cannot fail. A blur that cancelled
    // unconditionally is exactly that mutation.
    const commits: DepthCue[] = []
    const cancels: DepthCue[] = []
    render(<Harness initial={CAPPED} commits={commits} cancels={cancels} />)
    const picker = screen.getByLabelText('自由色') as HTMLInputElement

    fireEvent.input(picker, { target: { value: '#112233' } })
    fireEvent.change(picker, { target: { value: '#112233' } })
    fireEvent.blur(picker)

    expect(cancels).toHaveLength(0)
    expect(commits).toHaveLength(1)
    expect(commits[0]).toMatchObject({ capColor: 'custom', capCustomColor: '#112233' })
    expect(picker.value).toBe('#112233')
  })

  it('does not treat a colour committed from elsewhere as confirmed', () => {
    // A stored view's restore commits a whole cue from outside this bar, changing
    // `capCustomColor` while the choice stays `custom`. A guard that remembered
    // the confirmed hex would read a dismissed dialog landing back on it as
    // confirmed; the committed cue already says #ff0000.
    const commits: DepthCue[] = []
    const cancels: DepthCue[] = []
    const restored: DepthCue = { ...CAPPED, capColor: 'custom', capCustomColor: '#ff0000' }
    render(<Harness initial={CAPPED} commits={commits} cancels={cancels} external={restored} />)
    const picker = screen.getByLabelText('自由色') as HTMLInputElement

    // Session 1: confirm #00ff00, then leave.
    fireEvent.input(picker, { target: { value: '#00ff00' } })
    fireEvent.change(picker, { target: { value: '#00ff00' } })
    fireEvent.blur(picker)

    // Something else commits a different custom colour.
    fireEvent.click(screen.getByRole('button', { name: 'external' }))
    expect(commits[commits.length - 1]?.capCustomColor).toBe('#ff0000')

    // Session 2: re-open, land back on the OLD confirmed colour, dismiss.
    fireEvent.input(picker, { target: { value: '#00ff00' } })
    fireEvent.blur(picker)

    // The restored colour survives.
    expect(cancels).toHaveLength(1)
    expect(picker.value).toBe('#ff0000')
  })

  it('does not count a confirm from before the input went away', () => {
    // Removing a FOCUSED element fires neither `blur` nor `focusout`. A guard
    // that remembered the confirmed hex until blur needed the listener cleanup
    // to forget it; comparing against the committed cue has nothing to forget.
    const commits: DepthCue[] = []
    const cancels: DepthCue[] = []
    const bar = (capAvailable = true) => (
      <Harness initial={CAPPED} commits={commits} cancels={cancels} capAvailable={capAvailable} />
    )
    const { rerender } = render(bar())
    const picker = () => screen.getByLabelText(/自由色/) as HTMLInputElement

    // Session 1: confirm, with focus never leaving the input. The explicit focus
    // is the case's own premise — "removing a FOCUSED element" — and jsdom does
    // not focus on `fireEvent.input`.
    fireEvent.focus(picker())
    fireEvent.input(picker(), { target: { value: '#00ff00' } })
    fireEvent.change(picker(), { target: { value: '#00ff00' } })

    // The row goes away and comes back, with no blur in between.
    rerender(bar(false))
    expect(screen.queryByLabelText(/自由色/)).not.toBeInTheDocument()
    rerender(bar())

    fireEvent.click(chip('レンガ'))

    // Session 2: re-open, drift, land back on the colour session 1 confirmed,
    // dismiss. The drift is not decoration — the input already HOLDS #00ff00, so
    // React sees no change and fires no onChange without it.
    fireEvent.input(picker(), { target: { value: '#123456' } })
    fireEvent.input(picker(), { target: { value: '#00ff00' } })
    fireEvent.blur(picker())

    expect(cancels).toHaveLength(1)
    expect(chip('レンガ')).toHaveAttribute('aria-pressed', 'true')
  })

  it('does not cancel when a custom choice is merely passed through', () => {
    // The live colour is the committed one, so there is nothing to drop. The
    // guard compares against the committed cue, not against a remembered
    // confirm, so it needs no "the dialog opened" signal to stay quiet here.
    const commits: DepthCue[] = []
    const cancels: DepthCue[] = []
    render(
      <Harness
        initial={{ ...CAPPED, capColor: 'custom', capCustomColor: '#112233' }}
        commits={commits}
        cancels={cancels}
      />,
    )
    const picker = screen.getByLabelText('自由色 選択中') as HTMLInputElement

    fireEvent.blur(picker)

    expect(cancels).toHaveLength(0)
    expect(commits).toHaveLength(0)
    expect(picker.value).toBe('#112233')
  })

  it('leaves the preset alone when focus merely passes through the picker', () => {
    // Without the guard, tabbing across the row would silently repaint the cut
    // face in a colour nobody chose.
    const commits: DepthCue[] = []
    render(<Harness initial={CAPPED} commits={commits} />)

    fireEvent.blur(screen.getByLabelText('自由色'))

    expect(commits).toHaveLength(0)
    expect(chip('グレー(既定)')).toHaveAttribute('aria-pressed', 'true')
  })

  it('says the mixed colour is the one in use without relying on colour', () => {
    // The swatches ARE colour, so the chosen-ness of the picker cannot be
    // carried by its ring alone (DESIGN.md §9): no preset is pressed, and the
    // picker's own accessible name says it is the one being drawn.
    render(<Harness initial={{ ...CAPPED, capColor: 'custom', capCustomColor: '#112233' }} />)

    for (const name of ['グレー(既定)', 'レンガ', 'ホワイト']) {
      expect(chip(name)).toHaveAttribute('aria-pressed', 'false')
    }
    expect(screen.getByLabelText('自由色 選択中')).toBeInTheDocument()
  })
})

describe('a dismissed colour dialog with no blur after it (PT-413)', () => {
  // On Safari/macOS a click does not move focus, so a dismissed dialog can be
  // followed by a click on another control with no `blur` in between. The live
  // cue still carries the colour the dialog emitted, and every case here is a
  // commit that used to spread it into the persisted blob.
  const BRICK: DepthCue = { ...DEPTH_CUE_DEFAULT, slab: true, cap: true, capColor: 'firebrick' }
  const picker = () => screen.getByLabelText(/自由色/) as HTMLInputElement

  it('keeps the rejected colour out of an unrelated chip’s commit', () => {
    const commits: DepthCue[] = []
    render(<Harness initial={BRICK} commits={commits} />)

    fireEvent.input(picker(), { target: { value: '#ff0000' } })
    fireEvent.click(chip('平行投影'))

    expect(commits).toHaveLength(1)
    expect(commits[0]).toMatchObject({
      ortho: true,
      capColor: 'firebrick',
      capCustomColor: BRICK.capCustomColor,
    })
    expect(chip('レンガ')).toHaveAttribute('aria-pressed', 'true')
  })

  it.each([
    ['断面', { slab: false }],
    ['切り口を塞ぐ', { cap: false }],
  ] as const)('commits the preset when the %s chip unmounts the picker in the same click', (name, flipped) => {
    // The click both commits and removes the input, and removing it fires no
    // blur — so nothing else would get a chance to drop the rejected colour.
    const commits: DepthCue[] = []
    const cancels: DepthCue[] = []
    render(<Harness initial={BRICK} commits={commits} cancels={cancels} />)

    fireEvent.input(picker(), { target: { value: '#ff0000' } })
    fireEvent.click(chip(name))

    expect(screen.queryByLabelText(/自由色/)).not.toBeInTheDocument()
    expect(commits).toHaveLength(1)
    expect(commits[0]).toMatchObject({
      ...flipped,
      capColor: 'firebrick',
      capCustomColor: BRICK.capCustomColor,
    })
    // Live and committed agree after that commit, so the unmount has nothing
    // left to cancel.
    expect(cancels).toHaveLength(0)

    fireEvent.click(chip(name))
    expect(chip('レンガ')).toHaveAttribute('aria-pressed', 'true')
  })

  it('puts the committed colour back when the Surface switch removes the picker', () => {
    // `capAvailable` flips from outside the bar and commits nothing, so the
    // listener cleanup is the only place left to drop the live colour.
    const commits: DepthCue[] = []
    const cancels: DepthCue[] = []
    const bar = (capAvailable = true) => (
      <Harness initial={BRICK} commits={commits} cancels={cancels} capAvailable={capAvailable} />
    )
    const { rerender } = render(bar())

    fireEvent.input(picker(), { target: { value: '#ff0000' } })
    rerender(bar(false))
    expect(cancels).toHaveLength(1)

    rerender(bar())
    expect(chip('レンガ')).toHaveAttribute('aria-pressed', 'true')
    expect(commits).toHaveLength(0)
  })

  it('does not cancel when the Surface switch removes a picker with nothing unconfirmed', () => {
    const cancels: DepthCue[] = []
    const bar = (capAvailable = true) => (
      <Harness initial={BRICK} cancels={cancels} capAvailable={capAvailable} />
    )
    const { rerender } = render(bar())

    rerender(bar(false))
    expect(cancels).toHaveLength(0)
  })

  it('keeps a restored colour when a dismissed dialog lands on an earlier confirm', () => {
    // The restore commits while the choice stays `custom`, inside one focus
    // session: no blur anywhere. The dialog then drifts back to the hex the
    // FIRST dialog confirmed and is dismissed.
    const commits: DepthCue[] = []
    const restored: DepthCue = { ...BRICK, capColor: 'custom', capCustomColor: '#ff0000' }
    render(<Harness initial={BRICK} commits={commits} external={restored} />)

    fireEvent.input(picker(), { target: { value: '#00ff00' } })
    fireEvent.change(picker(), { target: { value: '#00ff00' } })
    fireEvent.click(screen.getByRole('button', { name: 'external' }))

    fireEvent.input(picker(), { target: { value: '#00ff00' } })
    fireEvent.click(chip('平行投影'))

    expect(commits[commits.length - 1]).toMatchObject({
      ortho: true,
      capColor: 'custom',
      capCustomColor: '#ff0000',
    })
    expect(picker().value).toBe('#ff0000')
  })

  it('keeps the earlier custom colour when a preset is picked over a rejected one', () => {
    // The preset commit must not carry the dialog's hex along as the saved
    // custom colour, or the picker re-opens on a colour nobody confirmed.
    const commits: DepthCue[] = []
    render(<Harness initial={BRICK} commits={commits} />)

    fireEvent.input(picker(), { target: { value: '#ff0000' } })
    fireEvent.click(chip('ホワイト'))

    expect(commits[commits.length - 1]).toMatchObject({
      capColor: 'white',
      capCustomColor: BRICK.capCustomColor,
    })
  })

  it('keeps the rejected colour out of a slider’s release commit', () => {
    const commits: DepthCue[] = []
    render(<Harness initial={BRICK} commits={commits} />)

    fireEvent.input(picker(), { target: { value: '#ff0000' } })
    const cut = screen.getByRole('slider', { name: '手前カット' })
    fireEvent.change(cut, { target: { value: '0.3' } })
    fireEvent.mouseUp(cut, { target: { value: '0.3' } })

    expect(commits).toHaveLength(1)
    expect(commits[0]).toMatchObject({ cut: 0.3, capColor: 'firebrick' })
  })
})

describe('cut-face opacity', () => {
  const CAPPED: DepthCue = { ...DEPTH_CUE_DEFAULT, slab: true, cap: true }
  const OPACITY = '切り口の不透明度'

  it('is offered only where the cut face itself is', () => {
    // Nothing to make translucent without a filled cut, and the row it lives on
    // is already the widest in the toolbar.
    render(<Harness initial={{ ...CAPPED, cap: false }} />)
    expect(screen.queryByRole('button', { name: OPACITY })).not.toBeInTheDocument()
    cleanup()

    render(<Harness initial={{ ...DEPTH_CUE_DEFAULT, slab: true }} capAvailable={false} />)
    expect(screen.queryByRole('button', { name: OPACITY })).not.toBeInTheDocument()
  })

  it('starts UNPRESSED, with no slider, because the cut face follows the surface', () => {
    // The state every existing viewer is in. A pressed chip here would claim an
    // override that is not set, and would invite the user to "fix" it.
    render(<Harness initial={CAPPED} />)
    expect(chip(OPACITY)).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('slider', { name: OPACITY })).not.toBeInTheDocument()
  })

  it('commits an override and reveals its slider on click', async () => {
    const user = userEvent.setup()
    const commits: DepthCue[] = []
    render(<Harness initial={CAPPED} commits={commits} />)

    await user.click(chip(OPACITY))

    expect(commits[commits.length - 1]?.capOpacity).toBe(CAP_OPACITY_DEFAULT)
    const slider = screen.getByRole('slider', { name: OPACITY })
    expect(slider).toHaveValue(String(CAP_OPACITY_DEFAULT))
    expect(chip(OPACITY)).toHaveAttribute('aria-pressed', 'true')
  })

  it('gives the slider back to the surface on a second click', async () => {
    const user = userEvent.setup()
    const commits: DepthCue[] = []
    render(<Harness initial={{ ...CAPPED, capOpacity: 0.5 }} commits={commits} />)

    await user.click(chip(OPACITY))

    // `null`, not a number that happens to match the surface: the two are
    // different states, and only `null` keeps following it when the surface's
    // own chip is flipped later.
    expect(commits[commits.length - 1]?.capOpacity).toBeNull()
    expect(screen.queryByRole('slider', { name: OPACITY })).not.toBeInTheDocument()
  })

  it('follows the drag live and commits only on release', () => {
    // Same contract as every other slider in this bar: the canvas has to follow
    // the pointer, but the viewer-state blob must not be written per frame.
    const commits: DepthCue[] = []
    render(<Harness initial={{ ...CAPPED, capOpacity: 0.5 }} commits={commits} />)
    const slider = screen.getByRole('slider', { name: OPACITY })

    fireEvent.change(slider, { target: { value: '0.3' } })
    expect(slider).toHaveValue('0.3')
    expect(commits).toHaveLength(0)

    fireEvent.mouseUp(slider)
    expect(commits[commits.length - 1]?.capOpacity).toBe(0.3)
  })

  it('reports the override as a percentage', () => {
    render(<Harness initial={{ ...CAPPED, capOpacity: 0.35 }} />)
    expect(screen.getByText('35%')).toBeInTheDocument()
  })

  it('offers a range that cannot make the cut face vanish', () => {
    // The floor exists so the slider does not duplicate the chip beside it: a
    // cut face at zero is the hollow cut `切り口を塞ぐ` already switches off, and
    // a user who reached it that way could not tell which control did it.
    render(<Harness initial={{ ...CAPPED, capOpacity: 0.5 }} />)
    const slider = screen.getByRole('slider', { name: OPACITY })
    expect(slider).toHaveAttribute('min', String(CAP_OPACITY_MIN))
    expect(slider).toHaveAttribute('max', String(CAP_OPACITY_MAX))
    expect(Number(CAP_OPACITY_MIN)).toBeGreaterThan(0)
  })

  it('names the slider from the chip that revealed it, not from a second caption', () => {
    // The chip IS the caption. A `<label>` of its own would put the same four
    // words on screen twice; hiding that label instead would leave the
    // on-screen name and the accessible name coming from different elements.
    render(<Harness initial={{ ...CAPPED, capOpacity: 0.5 }} />)
    expect(screen.getAllByText(OPACITY)).toHaveLength(1)
    expect(screen.getByRole('slider', { name: OPACITY })).toBeInTheDocument()
  })
})

describe('a structure switch while a colour preview is unconfirmed (PT-4272)', () => {
  // The Harness re-implements the controller and so cannot have its stale
  // closure; this case drives the SHIPPED hook. When a page removes the whole
  // toolbar and calls `resetForStructureChange` in one flush, the
  // picker's cleanup then calls the `cancelGesture` from the last render the
  // bar drew — the one that still held the previous structure's committed cue.
  const BRICK: DepthCue = { ...DEPTH_CUE_DEFAULT, slab: true, cap: true, capColor: 'firebrick' }

  function RealHost({ seen }: { seen: { cue?: DepthCue; persisted?: DepthCue } }) {
    const ctl = useDepthCue({ viewerInstanceRef: { current: null }, viewerEpoch: 0 })
    const [shown, setShown] = useState(true)
    seen.cue = ctl.cue
    seen.persisted = ctl.persistedCue
    return (
      <>
        <button type="button" onClick={() => ctl.commit(BRICK)}>seed</button>
        <button
          type="button"
          onClick={() => { setShown(false); ctl.resetForStructureChange() }}
        >
          switch
        </button>
        {shown && (
          <DepthCueBar
            value={ctl.cue}
            onChange={ctl.setCue}
            onCommit={ctl.commit}
            onCancelGesture={ctl.cancelGesture}
            committed={ctl.persistedCue}
            spanA={SPAN}
            idPrefix="real-depth"
            capAvailable
          />
        )}
      </>
    )
  }

  it('keeps the live cue at the reset defaults when the bar goes with it', () => {
    const seen: { cue?: DepthCue; persisted?: DepthCue } = {}
    render(<RealHost seen={seen} />)
    fireEvent.click(screen.getByRole('button', { name: 'seed' }))

    fireEvent.input(screen.getByLabelText(/自由色/), { target: { value: '#ff0000' } })
    expect(seen.cue?.capCustomColor).toBe('#ff0000')

    fireEvent.click(screen.getByRole('button', { name: 'switch' }))

    expect(screen.queryByLabelText(/自由色/)).not.toBeInTheDocument()
    expect(seen.persisted).toEqual(DEPTH_CUE_DEFAULT)
    // Not BRICK: a live cue left on the previous structure's settings would be
    // spread into the blob by the next commit from the bar (`base`).
    expect(seen.cue).toEqual(DEPTH_CUE_DEFAULT)
  })
})
