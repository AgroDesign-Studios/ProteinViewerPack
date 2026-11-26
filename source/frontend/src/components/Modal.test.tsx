/**
 * Modal — AgDB-best-practices.md §5.1 design policy: clicking the overlay
 * MUST NOT close the modal. This file is the regression guard for that
 * behaviour, plus the maxWidth / zIndex / stopPropagation paths.
 *
 * Since review #13 it also guards the ARIA attributes `DESIGN.md §9` says this
 * component carries for every call site, and since PT-573 the focus lifecycle
 * that makes `aria-modal` safe by default: the opening focus, the restore, the
 * Tab trap and Escape. The restore tests are one per shape that broke #1921's
 * withdrawn first attempt (autoFocus, StrictMode, a modal->modal handoff,
 * `<body>`, a disabled opener) — see PT-573 for that history. Since PT-1170
 * the accessible name is required.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode, StrictMode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import Modal, { type ModalSuggestionRowProps, registerModalSuggestionRow } from './Modal'
import { announceInTopDialog, anyDialogOpen, resetModalStackForTests, topDialog } from './modalStack'

describe('Modal', () => {
  afterEach(() => resetModalStackForTests())

  it('renders children inside the modal body', () => {
    render(
      <Modal label="dialog">
        <h2>Hello</h2>
        <p>body content</p>
      </Modal>,
    )
    expect(screen.getByText('Hello')).toBeVisible()
    expect(screen.getByText('body content')).toBeVisible()
  })

  it('clicking the overlay does NOT trigger any onClose callback (AgDB §5.1)', async () => {
    // Modal component intentionally has NO overlay-click handler. We assert
    // by registering a click listener on the overlay and confirming it
    // doesn't propagate any close behaviour to the children.
    const childOnClick = vi.fn()
    const { container } = render(
      <Modal label="dialog">
        <button onClick={childOnClick}>inside</button>
      </Modal>,
    )
    const overlay = container.querySelector('.modal-overlay')!
    await userEvent.click(overlay)
    // Overlay click does NOT bubble to the inner button.
    expect(childOnClick).not.toHaveBeenCalled()
  })

  it('applies the supplied maxWidth as inline style', () => {
    const { container } = render(
      <Modal label="dialog" maxWidth={800}>
        <span>x</span>
      </Modal>,
    )
    const modal = container.querySelector('.modal') as HTMLDivElement
    expect(modal.style.maxWidth).toBe('800px')
  })

  it('keeps the .modal padding by default and drops it when flush (PT-1315)', () => {
    const { unmount } = render(<Modal label="padded">x</Modal>)
    expect((document.querySelector('.modal') as HTMLElement).style.padding).toBe('')
    unmount()
    render(<Modal label="flush" flush maxWidth={480}>x</Modal>)
    const modal = document.querySelector('.modal') as HTMLElement
    expect(modal.style.padding).toBe('0px')
    expect(modal.style.maxWidth).toBe('480px')
  })

  it('applies the supplied zIndex to the overlay', () => {
    const { container } = render(
      <Modal label="dialog" zIndex={500}>
        <span>x</span>
      </Modal>,
    )
    const overlay = container.querySelector('.modal-overlay') as HTMLDivElement
    expect(overlay.style.zIndex).toBe('500')
  })

  it('clicks inside the modal body stop propagating to the overlay', () => {
    const overlayClick = vi.fn()
    const { container } = render(
      <div onClick={overlayClick}>
        <Modal label="dialog">
          <button>inner</button>
        </Modal>
      </div>,
    )
    fireEvent.click(screen.getByText('inner'))
    expect(overlayClick).not.toHaveBeenCalled()
    // Sanity: a click on the overlay element itself bubbles up because the
    // overlay has no onClick handler — only the .modal child does.
    const overlay = container.querySelector('.modal-overlay')!
    fireEvent.click(overlay)
    expect(overlayClick).toHaveBeenCalledTimes(1)
  })

  // ── Review #13: the ARIA attributes §9 says this component carries ────

  it('declares itself a dialog by default, so every call site is announced', () => {
    // Without a role a dialog is not announced as one: a plain <div> is
    // never read as a dialog by a screen reader.
    const { container } = render(<Modal label="dialog"><span>x</span></Modal>)
    expect((container.querySelector('.modal') as HTMLDivElement).getAttribute('role')).toBe('dialog')
  })

  it('lets a caller ask for alertdialog instead, so it need not nest its own', () => {
    // A caller that put `role="alertdialog"` on an inner div while Modal
    // renders a role too would give two NESTED dialog roles — ambiguous to
    // assistive tech and to getByRole alike.
    const { container } = render(
      <Modal role="alertdialog" labelledBy="t" describedBy="m">
        <h2 id="t">Delete?</h2>
        <p id="m">This cannot be undone.</p>
      </Modal>,
    )
    const dialog = container.querySelector('.modal') as HTMLDivElement
    expect(dialog.getAttribute('role')).toBe('alertdialog')
    expect(dialog.getAttribute('aria-labelledby')).toBe('t')
    expect(dialog.getAttribute('aria-describedby')).toBe('m')
  })

  it('takes a plain `label` when the caller has no heading to point at', () => {
    const { container } = render(<Modal label="Export"><span>x</span></Modal>)
    const dialog = container.querySelector('.modal') as HTMLDivElement
    expect(dialog.getAttribute('aria-label')).toBe('Export')
    expect(dialog.getAttribute('aria-labelledby')).toBeNull()
  })

  it('prefers labelledBy over label rather than emitting both', () => {
    // Both would be a contradiction for a screen reader; `aria-labelledby` wins
    // per spec, so emitting `aria-label` as well is noise at best.
    const { container } = render(
      <Modal label="ignored" labelledBy="t"><h2 id="t">Real name</h2></Modal>,
    )
    const dialog = container.querySelector('.modal') as HTMLDivElement
    expect(dialog.getAttribute('aria-labelledby')).toBe('t')
    expect(dialog.getAttribute('aria-label')).toBeNull()
  })

  // ── PT-1170: the accessible name is required ──────────────────────────

  it('takes its name from the heading a caller points labelledBy at', () => {
    // The recipe every call site follows: a `useId()` on its own heading.
    function Caller() {
      const titleId = useId()
      return (
        <Modal labelledBy={titleId}>
          <h2 id={titleId}>Upload files</h2>
        </Modal>
      )
    }
    render(<Caller />)
    expect(screen.getByRole('dialog', { name: 'Upload files' })).toBeInTheDocument()
  })

  it('refuses a dialog with no name at compile time', () => {
    // Pinned by tsc (`npm run build`), not by vitest: should `ModalProps` ever
    // accept a nameless `<Modal>` again, this directive goes unused and the
    // build fails. What it prevents is below — a dialog read with no name.
    // @ts-expect-error -- neither `label` nor `labelledBy`
    render(<Modal><span>x</span></Modal>)
    expect(screen.getByRole('dialog')).not.toHaveAccessibleName()
  })

  // ── PT-573: aria-modal by default, because focus is now managed here ──

  it('carries its own empty live region, without a role a caller could collide with (PT-1172)', () => {
    render(<Modal label="x">body</Modal>)
    const region = screen.getByTestId('modal-announcer')
    expect(screen.getByRole('dialog')).toContainElement(region)
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).not.toHaveAttribute('role')
    expect(region).toBeEmptyDOMElement()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('sets aria-modal by default and lets a caller opt out', () => {
    const { container, unmount } = render(<Modal label="dialog"><button>x</button></Modal>)
    expect((container.querySelector('.modal') as HTMLDivElement).getAttribute('aria-modal')).toBe('true')
    unmount()
    const r = render(<Modal label="dialog" modal={false}><button>x</button></Modal>)
    expect((r.container.querySelector('.modal') as HTMLDivElement).getAttribute('aria-modal')).toBeNull()
  })

  // ── Opening focus ─────────────────────────────────────────────────────

  it('moves focus to the dialog container, not to a button, when nothing inside claimed it', () => {
    const { container } = render(<Modal label="dialog"><button>inside</button></Modal>)
    const dialog = container.querySelector('.modal') as HTMLDivElement
    expect(dialog.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(dialog)
  })

  it('defers to a call-site autoFocus instead of overriding it', () => {
    render(<Modal label="dialog"><input aria-label="field" autoFocus /></Modal>)
    expect(document.activeElement).toBe(screen.getByLabelText('field'))
  })

  // ── Restore on close (one test per shape that broke #1921) ───────────

  function Harness({ autoFocusInside = false, strict = false }: { autoFocusInside?: boolean; strict?: boolean }) {
    const [open, setOpen] = useState(false)
    const body = (
      <>
        <button onClick={() => setOpen(true)}>open</button>
        {open && (
          <Modal label="dialog" onClose={() => setOpen(false)}>
            <input aria-label="field" autoFocus={autoFocusInside} />
            <button onClick={() => setOpen(false)}>close</button>
          </Modal>
        )}
      </>
    )
    return strict ? <StrictMode>{body}</StrictMode> : body
  }

  it('returns focus to the trigger on close', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('open'))
    await user.click(screen.getByText('close'))
    expect(document.activeElement).toBe(screen.getByText('open'))
  })

  it('returns focus to the trigger when Escape closes the dialog', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('open'))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByText('open'))
  })

  it('records the trigger, not the autofocused field, as the opener (round 3)', async () => {
    const user = userEvent.setup()
    render(<Harness autoFocusInside />)
    await user.click(screen.getByText('open'))
    expect(document.activeElement).toBe(screen.getByLabelText('field'))
    await user.click(screen.getByText('close'))
    expect(document.activeElement).toBe(screen.getByText('open'))
  })

  it('keeps focus inside under StrictMode and still restores on the real close (round 4)', async () => {
    const user = userEvent.setup()
    render(<Harness autoFocusInside strict />)
    await user.click(screen.getByText('open'))
    // The simulated unmount must not have walked focus back to the trigger.
    expect(document.activeElement).toBe(screen.getByLabelText('field'))
    await user.click(screen.getByText('close'))
    expect(document.activeElement).toBe(screen.getByText('open'))
  })

  it('lands on the first page control after a modal->modal handoff (round 4)', async () => {
    function Handoff() {
      const [step, setStep] = useState<'none' | 'a' | 'b'>('none')
      return (
        <>
          <button onClick={() => setStep('a')}>start</button>
          {step === 'a' && <Modal label="A"><button onClick={() => setStep('b')}>next</button></Modal>}
          {step === 'b' && <Modal label="B"><button onClick={() => setStep('none')}>done</button></Modal>}
        </>
      )
    }
    const user = userEvent.setup()
    render(<Handoff />)
    await user.click(screen.getByText('start'))
    await user.click(screen.getByText('next'))
    // B is open and holds focus; A's restore did not pull it out.
    expect(screen.getByRole('dialog', { name: 'B' }).contains(document.activeElement)).toBe(true)
    await user.click(screen.getByText('done'))
    expect(document.activeElement).toBe(screen.getByText('start'))
  })

  it('does not treat <body> as a place to restore to, and falls back to the dialog below (round 5)', () => {
    // Opened with focus on <body> (programmatically, no trigger): the upper
    // dialog's recorded opener is <body>, which must not count as a landing.
    ;(document.activeElement as HTMLElement | null)?.blur()
    function Stack() {
      const [upper, setUpper] = useState(true)
      return (
        <>
          <Modal label="lower"><button>lower-btn</button></Modal>
          {upper && <Modal label="upper"><button onClick={() => setUpper(false)}>close-upper</button></Modal>}
        </>
      )
    }
    render(<Stack />)
    fireEvent.click(screen.getByText('close-upper'))
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'lower' }))
  })

  it('falls back to the dialog below when the opener cannot take focus (round 6)', async () => {
    function Nested() {
      const [inner, setInner] = useState(false)
      return (
        <Modal label="outer">
          <button onClick={() => setInner(true)}>open-inner</button>
          {inner && <Modal label="inner"><button onClick={() => setInner(false)}>close-inner</button></Modal>}
        </Modal>
      )
    }
    const user = userEvent.setup()
    render(<Nested />)
    await user.click(screen.getByText('open-inner'))
    // A disabled control is a silent `.focus()` no-op — exactly round 6.
    const opener = screen.getByText('open-inner') as HTMLButtonElement
    opener.disabled = true
    const outer = screen.getByRole('dialog', { name: 'outer' })
    await user.click(screen.getByText('close-inner'))
    expect(document.activeElement).not.toBe(opener)
    expect(document.activeElement).not.toBe(document.body)
    expect(outer.contains(document.activeElement)).toBe(true)
  })

  it('never overrides focus a call site placed itself on close', async () => {
    function Placed() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>open</button>
          <button id="elsewhere">elsewhere</button>
          {open && (
            <Modal label="dialog">
              <button
                onClick={() => {
                  setOpen(false)
                  document.getElementById('elsewhere')?.focus()
                }}
              >
                close
              </button>
            </Modal>
          )}
        </>
      )
    }
    const user = userEvent.setup()
    render(<Placed />)
    await user.click(screen.getByText('open'))
    await user.click(screen.getByText('close'))
    expect(document.activeElement).toBe(screen.getByText('elsewhere'))
  })

  it('keeps focus in the dialog still open ABOVE when a lower one closes on its own', () => {
    // PR #2402 round 1 (both lanes): the lower dialog's own opener sits in the
    // page behind the upper dialog, so it must not take focus.
    let closeLower: () => void = () => {}
    function S() {
      const [lower, setLower] = useState(true)
      closeLower = () => setLower(false)
      return (
        <>
          {lower && <Modal label="lower"><button>l</button></Modal>}
          <Modal label="upper"><button>u</button></Modal>
        </>
      )
    }
    const page = document.createElement('button')
    document.body.appendChild(page)
    page.focus() // both dialogs record this page control as their opener
    render(<S />)
    const upper = screen.getByRole('dialog', { name: 'upper' })
    ;(document.activeElement as HTMLElement).blur()
    act(() => closeLower())
    expect(document.activeElement).not.toBe(page)
    expect(upper.contains(document.activeElement)).toBe(true)
    page.remove()
  })

  it('restores to the opener when it sits inside the dialog still open below', async () => {
    function Nested() {
      const [inner, setInner] = useState(false)
      return (
        <Modal label="outer">
          <button onClick={() => setInner(true)}>open-inner</button>
          {inner && <Modal label="inner"><button onClick={() => setInner(false)}>close-inner</button></Modal>}
        </Modal>
      )
    }
    const user = userEvent.setup()
    render(<Nested />)
    await user.click(screen.getByText('open-inner'))
    await user.click(screen.getByText('close-inner'))
    expect(document.activeElement).toBe(screen.getByText('open-inner'))
  })

  // A dialog that renders `.modal-overlay` itself is not in the stack. Such a
  // dialog may park rather than unmount (`hidden`).
  function HandRolledHandoff() {
    const [step, setStep] = useState<'none' | 'modal' | 'own'>('none')
    return (
      <>
        <button onClick={() => setStep('modal')}>open</button>
        {step === 'modal' && (
          <Modal label="error">
            <button onClick={() => setStep('none')}>cancel</button>
            <button onClick={() => setStep('own')}>fix-in-editor</button>
          </Modal>
        )}
        <div className="modal-overlay" hidden={step !== 'own'}>
          <div className="modal"><button>editor-btn</button></div>
        </div>
      </>
    )
  }

  it('does not restore to an opener behind a hand-rolled overlay the close handed over to (PT-1171 item 3)', async () => {
    const user = userEvent.setup()
    render(<HandRolledHandoff />)
    await user.click(screen.getByText('open'))
    await user.click(screen.getByText('fix-in-editor'))
    // The opener sits in the page the editor overlay now covers: Enter there
    // would press a button the user cannot see.
    expect(document.activeElement).not.toBe(screen.getByText('open'))
  })

  it('does not fall back to the handoff opener behind a hand-rolled overlay either', async () => {
    // A -> B in one commit, then B -> a hand-rolled overlay: B's own opener died
    // with A, and its fallback (A's opener) is behind the overlay.
    function Chain() {
      const [step, setStep] = useState<'none' | 'a' | 'b' | 'own'>('none')
      return (
        <>
          <button onClick={() => setStep('a')}>start</button>
          {step === 'a' && <Modal label="A"><button onClick={() => setStep('b')}>next</button></Modal>}
          {step === 'b' && <Modal label="B"><button onClick={() => setStep('own')}>edit</button></Modal>}
          {step === 'own' && <div className="modal-overlay"><div className="modal"><button>own-btn</button></div></div>}
        </>
      )
    }
    const user = userEvent.setup()
    render(<Chain />)
    await user.click(screen.getByText('start'))
    await user.click(screen.getByText('next'))
    await user.click(screen.getByText('edit'))
    expect(document.activeElement).not.toBe(screen.getByText('start'))
  })

  it('still restores while a hand-rolled overlay is only parked (`hidden`)', async () => {
    const user = userEvent.setup()
    render(<HandRolledHandoff />)
    await user.click(screen.getByText('open'))
    await user.click(screen.getByText('cancel'))
    expect(document.activeElement).toBe(screen.getByText('open'))
  })

  it('restores to an opener inside a showing hand-rolled overlay (a confirm raised from one)', async () => {
    function Inside() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <div className="modal-overlay">
            <div className="modal"><button onClick={() => setOpen(true)}>reset</button></div>
          </div>
          {open && <Modal label="confirm"><button onClick={() => setOpen(false)}>ok</button></Modal>}
        </>
      )
    }
    const user = userEvent.setup()
    render(<Inside />)
    await user.click(screen.getByText('reset'))
    await user.click(screen.getByText('ok'))
    expect(document.activeElement).toBe(screen.getByText('reset'))
  })

  it('does not touch the page opener between the two dialogs of a same-commit handoff (PT-1171 item 5)', async () => {
    // Focusing it scrolls the page behind to it — and the page can have been
    // scrolled while A was open (a wheel over the overlay scrolls it).
    function Handoff() {
      const [step, setStep] = useState<'none' | 'a' | 'b'>('none')
      return (
        <>
          <button onClick={() => setStep('a')}>start</button>
          {step === 'a' && <Modal label="A"><button onClick={() => setStep('b')}>next</button></Modal>}
          {step === 'b' && <Modal label="B"><button onClick={() => setStep('none')}>done</button></Modal>}
        </>
      )
    }
    const user = userEvent.setup()
    render(<Handoff />)
    await user.click(screen.getByText('start'))
    const focused = vi.fn()
    screen.getByText('start').addEventListener('focus', focused)
    await user.click(screen.getByText('next'))
    expect(focused).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'B' }).contains(document.activeElement)).toBe(true)
    await user.click(screen.getByText('done'))
    expect(document.activeElement).toBe(screen.getByText('start'))
  })

  it('returns focus to an SVG opener (PT-1171 item 6: every recharts <svg> has tabIndex 0)', async () => {
    function Chart() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <svg tabIndex={0} aria-label="chart" onClick={() => setOpen(true)}><rect width="10" height="10" /></svg>
          {open && <Modal label="detail"><button onClick={() => setOpen(false)}>close</button></Modal>}
        </>
      )
    }
    const user = userEvent.setup()
    const { container } = render(<Chart />)
    const chart = container.querySelector('svg')!
    await user.click(chart) // focuses the <svg> on mousedown, opens on click
    expect(screen.getByRole('dialog', { name: 'detail' }).contains(document.activeElement)).toBe(true)
    await user.click(screen.getByText('close'))
    expect(document.activeElement).toBe(chart)
  })

  // ── Tab trap ──────────────────────────────────────────────────────────

  it('wraps Tab and Shift+Tab at the ends of the dialog', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button>behind</button>
        <Modal label="dialog">
          <button>first</button>
          <button>last</button>
        </Modal>
      </>,
    )
    await user.tab()
    expect(document.activeElement).toBe(screen.getByText('first'))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByText('last'))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByText('first'))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByText('last'))
  })

  it('Shift+Tab from the container goes to the last control, not behind', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button>behind</button>
        <Modal label="dialog"><button>first</button><button>last</button></Modal>
      </>,
    )
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByText('last'))
  })

  it('pulls focus back in when it escaped to <body>', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button>behind</button>
        <Modal label="dialog"><button>first</button><button>last</button></Modal>
      </>,
    )
    ;(document.activeElement as HTMLElement).blur()
    expect(document.activeElement).toBe(document.body)
    await user.tab()
    expect(document.activeElement).toBe(screen.getByText('first'))
  })

  it('traps Tab even when a call site stops keydown propagation', async () => {
    const user = userEvent.setup()
    render(
      <Modal label="dialog">
        <div onKeyDown={e => e.stopPropagation()}>
          <button>first</button>
          <button>last</button>
        </div>
      </Modal>,
    )
    await user.click(screen.getByText('last'))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByText('first'))
  })

  it('only the top dialog traps Tab', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Modal label="lower"><button>lower-btn</button></Modal>
        <Modal label="upper"><button>upper-1</button><button>upper-2</button></Modal>
      </>,
    )
    await user.click(screen.getByText('upper-2'))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByText('upper-1'))
  })

  it('puts an inner dialog on top when both mount in the same commit', async () => {
    // Effects run child-first, so the stack is ordered by render, not by effect.
    const outer = vi.fn()
    const inner = vi.fn()
    const user = userEvent.setup()
    render(
      <Modal label="outer" onClose={outer}>
        <Modal label="inner" onClose={inner}><button>in</button></Modal>
      </Modal>,
    )
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'inner' }))
    await user.keyboard('{Escape}')
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })

  it('keeps the keyboard on a higher-zIndex dialog when a lower one opens after it (PT-1171 item 1)', async () => {
    // A confirm dialog (z 10000) is still showing when an async completion
    // opens a form dialog (z 200) — painted UNDER it, so it must not take
    // focus, Tab or Escape until the confirm is answered.
    let openForm: () => void = () => {}
    const formClose = vi.fn()
    function S() {
      const [confirm, setConfirm] = useState(true)
      const [form, setForm] = useState(false)
      openForm = () => setForm(true)
      return (
        <>
          {confirm && (
            <Modal label="confirm" zIndex={10000}>
              <button>cancel</button>
              <button onClick={() => setConfirm(false)}>ok</button>
            </Modal>
          )}
          {form && <Modal label="form" onClose={formClose}><button>save</button></Modal>}
        </>
      )
    }
    const user = userEvent.setup()
    render(<S />)
    const confirm = screen.getByRole('dialog', { name: 'confirm' })
    await user.click(screen.getByText('cancel'))
    act(() => openForm())
    expect(confirm.contains(document.activeElement)).toBe(true)
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByText('ok'))
    await user.keyboard('{Escape}')
    expect(formClose).not.toHaveBeenCalled()
    // Answering the confirm hands focus to the form still open below it.
    await user.click(screen.getByText('ok'))
    expect(screen.getByRole('dialog', { name: 'form' }).contains(document.activeElement)).toBe(true)
  })

  it('a dialog opened inside a higher-zIndex Modal is its top one, whatever the numbers (PT-6578 item 2)', async () => {
    // A lower-zIndex dialog rendered inside a higher-zIndex Modal paints
    // above it, within that overlay's stacking context.
    const outerClose = vi.fn()
    const innerClose = vi.fn()
    let openInner: () => void = () => {}
    function S() {
      const [inner, setInner] = useState(false)
      openInner = () => setInner(true)
      return (
        <Modal label="print" zIndex={1000} onClose={outerClose}>
          <button>print</button>
          {inner && <Modal label="danger" zIndex={220} onClose={innerClose}><button>confirm</button></Modal>}
        </Modal>
      )
    }
    const user = userEvent.setup()
    render(<S />)
    await user.click(screen.getByText('print'))
    act(() => openInner())
    const inner = screen.getByRole('dialog', { name: 'danger' })
    expect(inner.contains(document.activeElement)).toBe(true)
    await user.tab()
    expect(document.activeElement).toBe(screen.getByText('confirm'))
    await user.keyboard('{Escape}')
    expect(innerClose).toHaveBeenCalledTimes(1)
    expect(outerClose).not.toHaveBeenCalled()
  })

  it('a high-zIndex dialog nested in a low one ranks where the low one does (PT-6578 item 2)', async () => {
    // z 300 inside z 200 paints under a sibling z 250 — the inner number
    // counts only inside its outer overlay.
    const nestedClose = vi.fn()
    const siblingClose = vi.fn()
    let openSibling: () => void = () => {}
    function S() {
      const [sibling, setSibling] = useState(false)
      openSibling = () => setSibling(true)
      return (
        <>
          <Modal label="form">
            <Modal label="nested" zIndex={300} onClose={nestedClose}><button>nested</button></Modal>
          </Modal>
          {sibling && <Modal label="sibling" zIndex={250} onClose={siblingClose}><button>sibling</button></Modal>}
        </>
      )
    }
    const user = userEvent.setup()
    render(<S />)
    act(() => openSibling())
    expect(screen.getByRole('dialog', { name: 'sibling' }).contains(document.activeElement)).toBe(true)
    await user.keyboard('{Escape}')
    expect(siblingClose).toHaveBeenCalledTimes(1)
    expect(nestedClose).not.toHaveBeenCalled()
  })

  it('does not wrap onto a control native Tab skips (tabIndex -1)', async () => {
    const user = userEvent.setup()
    render(
      <Modal label="dialog">
        <button>first</button>
        <button>last</button>
        <button tabIndex={-1}>skipped</button>
      </Modal>,
    )
    await user.click(screen.getByText('last'))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByText('first'))
  })

  it('treats a radio group as one Tab stop, on its checked radio (PT-1171 item 2)', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button>behind</button>
        <Modal label="dialog">
          <input type="radio" name="modality" aria-label="xray" />
          <input type="radio" name="modality" aria-label="cryoem" defaultChecked />
          <button>save</button>
        </Modal>
      </>,
    )
    await user.click(screen.getByLabelText('cryoem'))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByText('save'))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByLabelText('cryoem'))
  })

  it('does not wrap onto a control the browser does not render (PT-1171 item 2)', async () => {
    const user = userEvent.setup()
    render(
      <Modal label="dialog">
        <button>first</button>
        <button>last</button>
        <input type="file" data-testid="picker" style={{ display: 'none' }} />
      </Modal>,
    )
    // jsdom has no layout and no Element.checkVisibility, so the browser's
    // answer for this element is supplied here (Chrome 152 returns false).
    Object.defineProperty(screen.getByTestId('picker'), 'checkVisibility', { value: () => false })
    await user.click(screen.getByText('last'))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByText('first'))
  })

  it('reaches a contenteditable at the end, whose default tabIndex is -1 (PT-1180 item 6)', async () => {
    const user = userEvent.setup()
    render(
      <Modal label="dialog">
        <button>first</button>
        <button>mid</button>
        <div role="textbox" aria-label="notes" contentEditable suppressContentEditableWarning>x</div>
      </Modal>,
    )
    await user.click(screen.getByText('mid'))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'notes' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByText('first'))
  })

  // ── PT-1333: #2587's review residuals ─────────────────────────────────

  it('gives back focus an autoFocus took in a dialog opened under the confirm dialog (PT-1333 item 1)', async () => {
    // React applies `autoFocus` during commit, before the effect that keeps a
    // lower dialog from taking focus; keys typed then went into a form the
    // user could not see.
    let openForm: () => void = () => {}
    function S() {
      const [form, setForm] = useState(false)
      openForm = () => setForm(true)
      return (
        <>
          <Modal label="confirm" zIndex={10000}><button>cancel</button><button>ok</button></Modal>
          {form && <Modal label="form"><input aria-label="name" autoFocus /><button>save</button></Modal>}
        </>
      )
    }
    const user = userEvent.setup()
    render(<S />)
    await user.click(screen.getByText('cancel'))
    act(() => openForm())
    expect(document.activeElement).toBe(screen.getByText('cancel'))
  })

  it('falls back to the confirm dialog itself when nothing in it was focused (PT-1333 item 1)', () => {
    let openForm: () => void = () => {}
    function S() {
      const [form, setForm] = useState(false)
      openForm = () => setForm(true)
      return (
        <>
          <button>page</button>
          <Modal label="confirm" zIndex={10000}><button>ok</button></Modal>
          {form && <Modal label="form"><input aria-label="name" autoFocus /></Modal>}
        </>
      )
    }
    render(<S />)
    // The page button: the form records it as its opener, but it sits behind.
    screen.getByText('page').focus()
    act(() => openForm())
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'confirm' }))
  })

  it('counts a checked radio in the page behind into a form-less group (PT-1333 item 2)', async () => {
    // HTML groups radios by name, form owner and tree, not by dialog: native
    // Tab skips the dialog's unchecked radio, so the trap must wrap before it.
    const user = userEvent.setup()
    render(
      <>
        <input type="radio" name="mode" aria-label="page-mode" defaultChecked />
        <Modal label="dialog">
          <button>first</button>
          <button>mid</button>
          <input type="radio" name="mode" aria-label="dialog-mode" />
        </Modal>
      </>,
    )
    await user.click(screen.getByText('mid'))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByText('first'))
  })

  it('restores to an opener in the overlay painted on top of two showing hand-rolled ones (PT-1333 item 3)', async () => {
    // z-index outranks document order, as it does on screen.
    function Two() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <div className="modal-overlay" style={{ zIndex: 500 }}>
            <div className="modal"><button onClick={() => setOpen(true)}>reset-top</button></div>
          </div>
          <div className="modal-overlay" style={{ zIndex: 100 }}>
            <div className="modal"><button onClick={() => setOpen(true)}>reset-below</button></div>
          </div>
          {open && <Modal label="confirm"><button onClick={() => setOpen(false)}>ok</button></Modal>}
        </>
      )
    }
    const user = userEvent.setup()
    render(<Two />)
    await user.click(screen.getByText('reset-top'))
    await user.click(screen.getByText('ok'))
    expect(document.activeElement).toBe(screen.getByText('reset-top'))
    // One in the overlay underneath is still covered.
    await user.click(screen.getByText('reset-below'))
    await user.click(screen.getByText('ok'))
    expect(document.activeElement).not.toBe(screen.getByText('reset-below'))
  })

  it('tries a MathML opener too (PT-1333 item 4)', async () => {
    // jsdom cannot focus MathML (Chrome can, with tabindex), so the formula is
    // supplied as the focused element while the dialog renders, and the
    // restore's focus() on it is observed.
    let openDetail: () => void = () => {}
    function Formula() {
      const [open, setOpen] = useState(false)
      openDetail = () => setOpen(true)
      return open ? <Modal label="detail"><button onClick={() => setOpen(false)}>close</button></Modal> : null
    }
    // React's JSX types carry no MathML tags.
    const formula = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'math')
    formula.setAttribute('tabindex', '0')
    document.body.appendChild(formula)
    onTestFinished(() => formula.remove())
    render(<Formula />)
    const focus = vi.fn()
    Object.defineProperty(formula, 'focus', { value: focus })
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => formula })
    try {
      act(() => openDetail())
    } finally {
      delete (document as { activeElement?: Element }).activeElement
    }
    await userEvent.setup().click(screen.getByText('close'))
    expect(focus).toHaveBeenCalled()
  })

  it('wraps onto a <details> summary at the end (PT-1333 item 6)', async () => {
    const user = userEvent.setup()
    render(
      <Modal label="dialog">
        <button>first</button>
        <details><summary>more</summary><p>detail</p></details>
      </Modal>,
    )
    await user.click(screen.getByText('first'))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByText('more'))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByText('first'))
  })

  it('lets native Tab stop on a scroll container past the end, and pulls back only if it left (PT-1333 item 6)', async () => {
    render(
      <>
        <button>behind</button>
        <Modal label="dialog">
          <button>first</button>
          <button>last</button>
          <div data-testid="log" style={{ overflowY: 'auto' }}><p>line</p></div>
        </Modal>
      </>,
    )
    // jsdom has no layout; Chrome 130+ makes this one keyboard-focusable.
    const log = screen.getByTestId('log')
    Object.defineProperty(log, 'scrollHeight', { value: 400 })
    Object.defineProperty(log, 'clientHeight', { value: 100 })
    const last = screen.getByText('last')
    last.focus()
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(true)
    // A browser that does not stop on it (Safari) moves on out of the dialog.
    screen.getByText('behind').focus()
    const first = screen.getByText('first')
    const focus = vi.spyOn(first, 'focus')
    // jsdom has no scrollIntoView; stand one in to see the call.
    const scrollIntoView = vi.fn()
    Object.defineProperty(first, 'scrollIntoView', { value: scrollIntoView })
    await act(() => new Promise(resolve => setTimeout(resolve, 0)))
    expect(document.activeElement).toBe(first)
    // Native Tab has already scrolled the page behind; the pull-back must not
    // scroll again (PT-2896 item 6)...
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    // ...but the dialog, itself a scroll container, still shows where focus
    // went (PT-4082), and only as far as it must.
    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('brings the target into view within the dialog after a Shift+Tab pull-back too (PT-4082)', async () => {
    render(
      <>
        <Modal label="dialog">
          <div data-testid="log" style={{ overflowY: 'auto' }}><p>line</p></div>
          <button>first</button>
          <button>last</button>
        </Modal>
        <button>behind</button>
      </>,
    )
    const log = screen.getByTestId('log')
    Object.defineProperty(log, 'scrollHeight', { value: 400 })
    Object.defineProperty(log, 'clientHeight', { value: 100 })
    const first = screen.getByText('first')
    const last = screen.getByText('last')
    first.focus()
    expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(true)
    // Safari passes over the scroll container and leaves the dialog.
    screen.getByText('behind').focus()
    const scrollIntoView = vi.fn()
    Object.defineProperty(last, 'scrollIntoView', { value: scrollIntoView })
    await act(() => new Promise(resolve => setTimeout(resolve, 0)))
    expect(document.activeElement).toBe(last)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('does not scroll when native Tab stopped on the scroll container inside the dialog (PT-4082)', async () => {
    render(
      <>
        <button>behind</button>
        <Modal label="dialog">
          <button>first</button>
          <button>last</button>
          <div data-testid="log" style={{ overflowY: 'auto' }}><p>line</p></div>
        </Modal>
      </>,
    )
    const log = screen.getByTestId('log')
    Object.defineProperty(log, 'scrollHeight', { value: 400 })
    Object.defineProperty(log, 'clientHeight', { value: 100 })
    const first = screen.getByText('first')
    const last = screen.getByText('last')
    last.focus()
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(true)
    // Chrome 130+ stops on it, which jsdom cannot focus; what matters is that
    // focus stayed in the dialog, so there is no pull-back and no scroll.
    const scrollIntoView = vi.fn()
    Object.defineProperty(first, 'scrollIntoView', { value: scrollIntoView })
    await act(() => new Promise(resolve => setTimeout(resolve, 0)))
    expect(document.activeElement).toBe(last)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  // ── PT-2896: the scroll container cases #3099 left untested (item 8) ──
  // Native Tab is the browser's, so these play its part: `fireEvent.keyDown`
  // reports whether the trap let the key through (true) or wrapped it
  // (false), and the test then moves focus where that browser would.

  /** A dialog whose `history` region overflows; `before` puts it ahead of the buttons. */
  function ScrollerDialog({ before = false, children = <p>line</p> }: { before?: boolean; children?: ReactNode }) {
    const region = <div role="region" aria-label="history" style={{ overflowY: 'auto' }}>{children}</div>
    return (
      <>
        <button>behind</button>
        <Modal label="dialog">
          {before && region}
          <button>first</button>
          <button>last</button>
          {!before && region}
        </Modal>
      </>
    )
  }
  const overflowing = () => {
    const region = screen.getByRole('region', { name: 'history' })
    Object.defineProperty(region, 'scrollHeight', { value: 400 })
    Object.defineProperty(region, 'clientHeight', { value: 100 })
    return region
  }
  const flushTimers = () => act(() => new Promise(resolve => setTimeout(resolve, 0)))

  it('lets native Shift+Tab stop on a scroll container before the first control, and pulls back to the last', async () => {
    render(<ScrollerDialog before />)
    overflowing()
    const first = screen.getByText('first')
    first.focus()
    expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(true)
    screen.getByText('behind').focus()
    await flushTimers()
    expect(document.activeElement).toBe(screen.getByText('last'))
  })

  it('wraps Shift+Tab when the only scroll container before the first control contains it', () => {
    // Chrome does not stop on a scroller that has something focusable inside.
    render(
      <Modal label="dialog">
        <div role="region" aria-label="history" style={{ overflowY: 'auto' }}>
          <button>first</button>
        </div>
        <button>last</button>
      </Modal>,
    )
    overflowing()
    const first = screen.getByText('first')
    first.focus()
    expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(document.activeElement).toBe(screen.getByText('last'))
  })

  it('leaves focus on a scroll container native Tab stopped on (Chrome)', async () => {
    render(<ScrollerDialog />)
    const region = overflowing()
    const last = screen.getByText('last')
    last.focus()
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(true)
    // jsdom focuses a div only with a tabindex; Chrome needs none here.
    region.setAttribute('tabindex', '-1')
    region.focus()
    await flushTimers()
    expect(document.activeElement).toBe(region)
  })

  it('wraps Tab from a scroll container that native Tab stopped on', () => {
    render(<ScrollerDialog />)
    const region = overflowing()
    region.setAttribute('tabindex', '-1')
    region.focus()
    expect(fireEvent.keyDown(region, { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(screen.getByText('first'))
  })

  it('does not pull back once the dialog has unmounted before the timer', async () => {
    function Toggle() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button onClick={() => setOpen(false)}>behind</button>
          {open && (
            <Modal label="dialog">
              <button>first</button>
              <button>last</button>
              <div role="region" aria-label="history" style={{ overflowY: 'auto' }}><p>line</p></div>
            </Modal>
          )}
        </>
      )
    }
    render(<Toggle />)
    overflowing()
    const last = screen.getByText('last')
    last.focus()
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(true)
    const behind = screen.getByText('behind')
    behind.focus()
    fireEvent.click(behind)
    await flushTimers()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(behind)
  })

  it('counts a child with tabindex="-1" as focusable, so its scroll container is no stop (PT-2896 item 6)', () => {
    render(<ScrollerDialog><p tabIndex={-1}>anchor</p></ScrollerDialog>)
    overflowing()
    const last = screen.getByText('last')
    last.focus()
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(screen.getByText('first'))
  })

  it('does not count a child the browser does not render, so its scroll container is a stop (PT-2896 item 6)', () => {
    render(<ScrollerDialog><button>hidden-action</button></ScrollerDialog>)
    overflowing()
    // jsdom has no checkVisibility(); this one answers as `display: none` would.
    Object.defineProperty(screen.getByText('hidden-action'), 'checkVisibility', { value: () => false })
    const last = screen.getByText('last')
    last.focus()
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(true)
  })

  it.each([
    ['under inert', (region: HTMLElement) => region.setAttribute('inert', '')],
    ['not rendered', (region: HTMLElement) => Object.defineProperty(region, 'checkVisibility', { value: () => false })],
  ])('counts no scroll container %s (PT-2896 item 6)', (_, hide) => {
    render(<ScrollerDialog />)
    hide(overflowing())
    const last = screen.getByText('last')
    last.focus()
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(screen.getByText('first'))
  })

  it("sends back what the call site's own effect focused in a dialog under another, and returns there once on top (PT-2896 items 3, 4)", async () => {
    // A dialog may move focus to its heading in its own effect, which runs
    // after Modal's — so the mount-time give-back never saw it.
    let openForm: () => void = () => {}
    function Form() {
      const id = useId()
      const heading = useRef<HTMLHeadingElement>(null)
      useEffect(() => heading.current?.focus(), [])
      return <Modal labelledBy={id}><h2 id={id} ref={heading} tabIndex={-1}>form</h2><button>save</button></Modal>
    }
    function S() {
      const [confirm, setConfirm] = useState(true)
      const [form, setForm] = useState(false)
      openForm = () => setForm(true)
      return (
        <>
          {confirm && <Modal label="confirm" zIndex={10000}><button onClick={() => setConfirm(false)}>ok</button></Modal>}
          {form && <Form />}
        </>
      )
    }
    const user = userEvent.setup()
    render(<S />)
    const ok = screen.getByText('ok')
    ok.focus()
    act(() => openForm())
    expect(document.activeElement).toBe(ok)
    await user.click(ok)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'form' }))
  })

  it('returns to the field an autoFocus chose in a dialog opened under another, once that one closes (PT-2896 item 4)', async () => {
    let openForm: () => void = () => {}
    function S() {
      const [confirm, setConfirm] = useState(true)
      const [form, setForm] = useState(false)
      openForm = () => setForm(true)
      return (
        <>
          {confirm && <Modal label="confirm" zIndex={10000}><button onClick={() => setConfirm(false)}>ok</button></Modal>}
          {form && <Modal label="form"><input aria-label="name" autoFocus /><button>save</button></Modal>}
        </>
      )
    }
    const user = userEvent.setup()
    render(<S />)
    const ok = screen.getByText('ok')
    ok.focus()
    act(() => openForm())
    expect(document.activeElement).toBe(ok)
    await user.click(ok)
    expect(document.activeElement).toBe(screen.getByLabelText('name'))
  })

  it('compares a nested overlay by its outermost one (PT-2896 item 5)', async () => {
    // z 9999 inside z 100 is drawn inside that one's stacking context, so the
    // sibling at z 500 is painted over it.
    function Nested() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <div className="modal-overlay" style={{ zIndex: 100 }}>
            <div className="modal">
              <div className="modal-overlay" style={{ zIndex: 9999 }}>
                <div className="modal"><button onClick={() => setOpen(true)}>reset-inner</button></div>
              </div>
            </div>
          </div>
          <div className="modal-overlay" style={{ zIndex: 500 }}>
            <div className="modal"><button onClick={() => setOpen(true)}>reset-sibling</button></div>
          </div>
          {open && <Modal label="confirm"><button onClick={() => setOpen(false)}>ok</button></Modal>}
        </>
      )
    }
    const user = userEvent.setup()
    render(<Nested />)
    await user.click(screen.getByText('reset-inner'))
    await user.click(screen.getByText('ok'))
    expect(document.activeElement).not.toBe(screen.getByText('reset-inner'))
    await user.click(screen.getByText('reset-sibling'))
    await user.click(screen.getByText('ok'))
    expect(document.activeElement).toBe(screen.getByText('reset-sibling'))
  })

  // ── Escape ────────────────────────────────────────────────────────────

  it('calls onClose on Escape', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<Modal label="dialog" onClose={onClose}><button>x</button></Modal>)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does nothing on Escape without onClose (explicit-button-only dialogs)', async () => {
    const user = userEvent.setup()
    render(<Modal label="dialog"><button>x</button></Modal>)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('ignores the Escape that cancels an IME composition', () => {
    const onClose = vi.fn()
    render(<Modal label="dialog" onClose={onClose}><input aria-label="ja" /></Modal>)
    const input = screen.getByLabelText('ja')
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 229, bubbles: true }))
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('leaves an Escape an inner control already handled', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <Modal label="dialog" onClose={onClose}>
        <input aria-label="inline" onKeyDown={e => { if (e.key === 'Escape') e.preventDefault() }} />
      </Modal>,
    )
    await user.click(screen.getByLabelText('inline'))
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('only the top dialog answers Escape', async () => {
    const lower = vi.fn()
    const upper = vi.fn()
    const user = userEvent.setup()
    render(
      <>
        <Modal label="lower" onClose={lower}><button>a</button></Modal>
        <Modal label="upper" onClose={upper}><button>b</button></Modal>
      </>,
    )
    await user.keyboard('{Escape}')
    expect(upper).toHaveBeenCalledTimes(1)
    expect(lower).not.toHaveBeenCalled()
  })

  it('ignores a held Escape, so one press never closes two nested dialogs (PT-1180)', () => {
    const outerClose = vi.fn()
    function Nested() {
      const [inner, setInner] = useState(true)
      return (
        <>
          <Modal label="outer" onClose={outerClose}><button>a</button></Modal>
          {inner && <Modal label="inner" onClose={() => setInner(false)}><button>b</button></Modal>}
        </>
      )
    }
    render(<Nested />)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'inner' })).not.toBeInTheDocument()
    // The auto-repeat of the same press now reaches the outer dialog, the top
    // one. user-event never sets `repeat`, so the event is dispatched directly.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', repeat: true })
    expect(outerClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(outerClose).toHaveBeenCalledTimes(1)
  })

  it('claims a held Escape it ignores, so a page listener behind does not answer it (PT-1328 item 3)', () => {
    // A page's document listener may defer only to `defaultPrevented`. With
    // two dialogs stacked, the press closes the inner one and its repeats reach
    // the outer, top one — which must swallow them, not leave them to the page.
    // Document listeners run in registration order, so this holds for a page
    // listener registered after the dialog mounted (the popover opened over
    // it), the same ordering the press itself already relies on.
    const onClose = vi.fn()
    const page = vi.fn()
    const onPage = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) page() }
    render(<Modal label="dialog" onClose={onClose}><button>a</button></Modal>)
    document.addEventListener('keydown', onPage)
    onTestFinished(() => document.removeEventListener('keydown', onPage))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', repeat: true })
    expect(onClose).not.toHaveBeenCalled()
    expect(page).not.toHaveBeenCalled()
  })

  it('leaves a held Escape to the page when it has no onClose, like the press itself', () => {
    const page = vi.fn()
    const onPage = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) page() }
    render(<Modal label="dialog"><button>a</button></Modal>)
    document.addEventListener('keydown', onPage)
    onTestFinished(() => document.removeEventListener('keydown', onPage))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', repeat: true })
    expect(page).toHaveBeenCalledTimes(1)
  })

  it('obeys an onClose withdrawn in the same commit as the Escape (PT-1180)', () => {
    // The Escape is dispatched from the parent's LAYOUT effect, i.e. inside the
    // commit that withdrew onClose and before any passive effect of it has
    // run. Modal syncs onClose in a layout effect, and a child's layout
    // effects run before its parent's, so the withdrawal is already visible;
    // a passive sync would still hold the old function here. A click-driven
    // version cannot tell the two apart — React flushes the passive effects
    // of a discrete update before the next keystroke arrives.
    const onClose = vi.fn()
    function Busy({ busy }: { busy: boolean }) {
      useLayoutEffect(() => {
        if (busy) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      }, [busy])
      return (
        <Modal label="dialog" onClose={busy ? undefined : onClose}>
          <button>save</button>
        </Modal>
      )
    }
    const { rerender } = render(<Busy busy={false} />)
    rerender(<Busy busy />)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('answers the same layout-effect Escape when onClose is kept (control for the test above, PT-1328 item 2)', () => {
    // The withdrawn-onClose test only asserts "not called", so it would stay
    // green if the synthetic KeyboardEvent stopped reaching the listener at
    // all (say, an `isTrusted` check). This sends the identical event with
    // onClose kept and demands the call, so the pair together pins the sync.
    const onClose = vi.fn()
    function Kept({ fire }: { fire: boolean }) {
      useLayoutEffect(() => {
        if (fire) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      }, [fire])
      return (
        <Modal label="dialog" onClose={onClose}>
          <button>save</button>
        </Modal>
      )
    }
    const { rerender } = render(<Kept fire={false} />)
    rerender(<Kept fire />)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// The slot for an optional row, tested with a stand-in row component: a
// registered row is drawn after the children, inside the dialog and its Tab trap.
describe('the registered row', () => {
  afterEach(() => {
    registerModalSuggestionRow(null)
    resetModalStackForTests()
  })

  const given: ModalSuggestionRowProps[] = []
  function StandInRow(props: ModalSuggestionRowProps) {
    given.push(props)
    return <button type="button" data-testid="stand-in-row">row</button>
  }
  function DarkRow() {
    return null
  }

  function Named({ flush = false, suggestionRow }: { flush?: boolean; suggestionRow?: boolean }) {
    const titleId = useId()
    return (
      <Modal labelledBy={titleId} flush={flush} suggestionRow={suggestionRow} onClose={() => {}}>
        <h2 id={titleId}>Add stock</h2>
        <button type="button">Save</button>
      </Modal>
    )
  }

  it('none registered: the children, then the announcer, nothing between', () => {
    render(<Named />)
    expect(screen.getByTestId('modal-announcer').previousElementSibling).toBe(screen.getByRole('button', { name: 'Save' }))
  })

  it('registered: drawn after the children and before the announcer, inside the dialog and its Tab trap', async () => {
    registerModalSuggestionRow(StandInRow)
    render(<Named />)
    const row = screen.getByTestId('stand-in-row')
    expect(screen.getByRole('dialog', { name: 'Add stock' })).toContainElement(row)
    expect(row.previousElementSibling).toBe(screen.getByRole('button', { name: 'Save' }))
    expect(row.nextElementSibling).toBe(screen.getByTestId('modal-announcer'))
    screen.getByRole('button', { name: 'Save' }).focus()
    await userEvent.tab()
    expect(row).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
  })

  it('is given the dialog’s own name props and its layout', () => {
    registerModalSuggestionRow(StandInRow)
    given.length = 0
    const { unmount } = render(<Named flush />)
    const titleId = screen.getByRole('heading', { name: 'Add stock' }).id
    expect(given).toContainEqual({ labelledBy: titleId, label: undefined, flush: true })
    // The dialog's own column layout is untouched by it.
    const flushDialog = screen.getByRole('dialog', { name: 'Add stock' })
    expect(flushDialog.style.flexDirection).toBe('column')
    expect(flushDialog.style.padding).toBe('0px')
    unmount()
    render(
      <Modal label="Plain">
        <p>body</p>
      </Modal>,
    )
    expect(given).toContainEqual({ labelledBy: undefined, label: 'Plain', flush: false })
  })

  it('suggestionRow={false}: not drawn', () => {
    registerModalSuggestionRow(StandInRow)
    render(<Named suggestionRow={false} />)
    expect(screen.queryByTestId('stand-in-row')).toBeNull()
  })

  it('a row that draws nothing leaves the dialog as it was', () => {
    registerModalSuggestionRow(DarkRow)
    render(<Named />)
    expect(screen.getByTestId('modal-announcer').previousElementSibling).toBe(screen.getByRole('button', { name: 'Save' }))
  })
})

// The keep-mounted dialog: a parked dialog keeps its iframe mounted rather
// than reload it.
describe('parked (`hidden`): mounted, off the dialog stack', () => {
  afterEach(() => {
    registerModalSuggestionRow(null)
    resetModalStackForTests()
  })

  /** Two triggers and a parkable dialog holding an iframe that must survive. */
  function Parked({ initiallyShown = false }: { initiallyShown?: boolean }) {
    const [shown, setShown] = useState(initiallyShown)
    return (
      <>
        <button onClick={() => setShown(true)}>show-a</button>
        <button onClick={() => setShown(true)}>show-b</button>
        <Modal label="parked" hidden={!shown} onClose={() => setShown(false)}>
          <iframe title="editor" />
          <button onClick={() => setShown(false)}>x</button>
        </Modal>
      </>
    )
  }
  const overlayOf = (el: Element) => el.closest('.modal-overlay')

  it('parked: the overlay is hidden, the children mounted, and nothing is on the stack', () => {
    render(<Parked />)
    const editor = screen.getByTitle('editor')
    expect(overlayOf(editor)).toHaveAttribute('hidden')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(anyDialogOpen()).toBe(false)
    expect(topDialog()).toBeNull()
    // No live region speaks for it either.
    expect(announceInTopDialog('saved')).toBe(false)
  })

  it('mounting parked moves no focus', async () => {
    function Late() {
      const [mounted, setMounted] = useState(false)
      return (
        <>
          <button onClick={() => setMounted(true)}>mount</button>
          {mounted && <Modal label="parked" hidden><button>inside</button></Modal>}
        </>
      )
    }
    const user = userEvent.setup()
    render(<Late />)
    await user.click(screen.getByText('mount'))
    expect(screen.getByText('inside')).toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByText('mount'))
  })

  it('parked: Tab is not trapped; shown, the same Tab is pulled into the dialog', () => {
    function Toggle({ hidden }: { hidden: boolean }) {
      return (
        <>
          <button>page</button>
          <Modal label="parked" hidden={hidden}><button>inside</button></Modal>
        </>
      )
    }
    const { rerender } = render(<Toggle hidden />)
    const page = screen.getByText('page')
    page.focus()
    // fireEvent answers false when a listener called preventDefault.
    expect(fireEvent.keyDown(page, { key: 'Tab' })).toBe(true)
    expect(document.activeElement).toBe(page)

    rerender(<Toggle hidden={false} />)
    page.focus()
    expect(fireEvent.keyDown(page, { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(screen.getByText('inside'))
  })

  it('a parked dialog above or below a shown one leaves it the keyboard: Escape and Tab go to the shown one', async () => {
    const user = userEvent.setup()
    // Rendered later at the same zIndex, or at a higher one: either would be
    // the top dialog if it were on the stack.
    for (const zIndex of [200, 10000]) {
      const shownClose = vi.fn()
      const parkedClose = vi.fn()
      const { unmount } = render(
        <>
          <Modal label="shown" onClose={shownClose}><button>shown-1</button><button>shown-2</button></Modal>
          <Modal label="parked" hidden zIndex={zIndex} onClose={parkedClose}><button>parked-btn</button></Modal>
        </>,
      )
      expect(topDialog()).toBe(screen.getByRole('dialog', { name: 'shown' }))
      await user.click(screen.getByText('shown-2'))
      await user.tab()
      expect(document.activeElement).toBe(screen.getByText('shown-1'))
      await user.keyboard('{Escape}')
      expect(shownClose).toHaveBeenCalledTimes(1)
      expect(parkedClose).not.toHaveBeenCalled()
      unmount()
      resetModalStackForTests()
    }
  })

  it('a dialog closing over a parked one returns focus to its own opener, not into the parked one', async () => {
    function Beneath() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <Modal label="parked" hidden><button>parked-btn</button></Modal>
          <button onClick={() => setOpen(true)}>open</button>
          {open && <Modal label="open" onClose={() => setOpen(false)}><button>in</button></Modal>}
        </>
      )
    }
    const user = userEvent.setup()
    render(<Beneath />)
    await user.click(screen.getByText('open'))
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'open' }))
    await user.keyboard('{Escape}')
    expect(document.activeElement).toBe(screen.getByText('open'))
  })

  it('un-parked: on top, focus inside, the same iframe node; parked again by X: focus back on the trigger', async () => {
    const user = userEvent.setup()
    render(<Parked />)
    const editor = screen.getByTitle('editor')
    await user.click(screen.getByText('show-a'))
    const dialog = screen.getByRole('dialog', { name: 'parked' })
    expect(overlayOf(dialog)).not.toHaveAttribute('hidden')
    expect(topDialog()).toBe(dialog)
    expect(document.activeElement).toBe(dialog)
    expect(screen.getByTitle('editor')).toBe(editor)
    expect(announceInTopDialog('saved')).toBe(true)

    await user.click(screen.getByText('x'))
    expect(overlayOf(editor)).toHaveAttribute('hidden')
    expect(anyDialogOpen()).toBe(false)
    expect(document.activeElement).toBe(screen.getByText('show-a'))
    expect(screen.getByTitle('editor')).toBe(editor)
  })

  it('returns focus to the trigger of the LAST show, Escape closing as X does', async () => {
    const user = userEvent.setup()
    render(<Parked />)
    const editor = screen.getByTitle('editor')
    await user.click(screen.getByText('show-a'))
    await user.keyboard('{Escape}')
    expect(overlayOf(editor)).toHaveAttribute('hidden')
    expect(document.activeElement).toBe(screen.getByText('show-a'))

    await user.click(screen.getByText('show-b'))
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'parked' }))
    await user.keyboard('{Escape}')
    expect(document.activeElement).toBe(screen.getByText('show-b'))
    expect(screen.getByTitle('editor')).toBe(editor)
  })

  it('parked with nowhere to return to, it lets focus go rather than hold it unseen', async () => {
    // Shown at mount with focus on <body>: no opener to go back to.
    ;(document.activeElement as HTMLElement | null)?.blur()
    const user = userEvent.setup()
    render(<Parked initiallyShown />)
    await user.click(screen.getByText('x'))
    expect(overlayOf(screen.getByTitle('editor'))).toHaveAttribute('hidden')
    expect(document.activeElement).toBe(document.body)
  })

  it('under StrictMode: un-parking keeps focus inside, and parking still restores', async () => {
    const user = userEvent.setup()
    render(
      <StrictMode>
        <Parked />
      </StrictMode>,
    )
    await user.click(screen.getByText('show-a'))
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'parked' }))
    await user.click(screen.getByText('x'))
    expect(document.activeElement).toBe(screen.getByText('show-a'))
  })

  it('un-parked in the commit that closes another dialog: focus goes in, and back to the first trigger on close', async () => {
    // An error dialog hands over to the parked editor dialog.
    function Handoff() {
      const [step, setStep] = useState<'none' | 'error' | 'editor'>('none')
      return (
        <>
          <button onClick={() => setStep('error')}>search</button>
          {step === 'error' && <Modal label="error"><button onClick={() => setStep('editor')}>fix-in-editor</button></Modal>}
          <Modal label="editor" hidden={step !== 'editor'} onClose={() => setStep('none')}><button>editor-btn</button></Modal>
        </>
      )
    }
    const user = userEvent.setup()
    render(<Handoff />)
    await user.click(screen.getByText('search'))
    await user.click(screen.getByText('fix-in-editor'))
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'editor' }))
    await user.keyboard('{Escape}')
    expect(document.activeElement).toBe(screen.getByText('search'))
  })

  it('draws the registered row only while shown', async () => {
    registerModalSuggestionRow(() => <button type="button" data-testid="stand-in-row">row</button>)
    const user = userEvent.setup()
    render(<Parked />)
    expect(screen.queryByTestId('stand-in-row')).toBeNull()
    await user.click(screen.getByText('show-a'))
    expect(screen.getByRole('dialog', { name: 'parked' })).toContainElement(screen.getByTestId('stand-in-row'))
    await user.click(screen.getByText('x'))
    expect(screen.queryByTestId('stand-in-row')).toBeNull()
  })
})
