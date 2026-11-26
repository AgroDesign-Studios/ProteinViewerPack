/**
 * The page's sequence row (owner 2026-11-21): a residue lit by the mouse, a
 * tap or the keyboard, and the box naming it.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatSI } from '../../src/utils/formatSI'
import { SEQ_MAX, type SeqReport } from './pymolSeq'
import { PymolSeqStrip, SEQ_STRIP_H } from './PymolSeqStrip'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o === undefined ? k : `${k} ${JSON.stringify(o)}`) }),
}))

afterEach(cleanup)

// jsdom has no PointerEvent: the pointer's type, which the row reads (as PymolObjectDrawerTab.test.tsx).
if (!('PointerEvent' in window)) {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number
    readonly pointerType: string
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
      this.pointerType = init.pointerType ?? ''
    }
  }
  Object.defineProperty(window, 'PointerEvent', { value: PointerEventPolyfill, writable: true })
}

const REPORT: SeqReport = { v: 1, objs: ['Structure_25HN'], res: [[0, 'A', '9', 'ALA'], [0, 'A', '10', 'HEM'], [0, 'B', '1', 'GLY']], more: true }
const RECT = { x: 10, y: 20, w: 300 }

describe('PymolSeqStrip', () => {
  it('heads each chain, numbers every tenth residue, and says the list was cut', () => {
    render(<PymolSeqStrip rect={RECT} report={REPORT} lit={null} onHover={vi.fn()} />)
    const row = document.querySelector('.sav-seq') as HTMLElement
    expect(row.style.height).toBe(`${SEQ_STRIP_H}px`)
    expect([...row.querySelectorAll('.sav-seq-chain')].map(c => c.textContent)).toEqual(['/Structure_25HN/A', '/Structure_25HN/B'])
    expect([...row.querySelectorAll('.sav-seq-num')].map(c => c.textContent)).toEqual(['9', '10', '1'])
    expect(row).toHaveTextContent('[HEM]')
    expect(row).toHaveTextContent(`htmlExport:sa_pymol_seq_more {"n":"${formatSI(SEQ_MAX)}"}`)
    // Nothing lit: the box is empty but stays, so what it says later is read out (PR #10172 review).
    const info = screen.getByRole('status')
    expect(info).toHaveClass('sav-seq-info', 'is-empty')
    expect(info).toBeEmptyDOMElement()
  })

  it('the mouse over a residue lights it, leaving takes it down; a tap lights it and stays', () => {
    const onHover = vi.fn()
    render(<PymolSeqStrip rect={RECT} report={REPORT} lit={null} onHover={onHover} />)
    const res = document.querySelectorAll('.sav-seq-res')
    fireEvent.pointerMove(res[2], { pointerType: 'mouse' })
    expect(onHover).toHaveBeenLastCalledWith(2)
    fireEvent.pointerLeave(document.querySelector('.sav-seq-row')!, { pointerType: 'mouse' })
    expect(onHover).toHaveBeenLastCalledWith(null)
    onHover.mockClear()
    fireEvent.pointerDown(res[1], { pointerType: 'touch' })
    expect(onHover).toHaveBeenLastCalledWith(1)
    fireEvent.pointerLeave(document.querySelector('.sav-seq-row')!, { pointerType: 'touch' })
    expect(onHover).toHaveBeenCalledTimes(1)
  })

  it('the keyboard moves the lit residue with ← →, Esc takes it down; the box names it at the top left', () => {
    const onHover = vi.fn()
    const { rerender } = render(<PymolSeqStrip rect={RECT} report={REPORT} lit={null} onHover={onHover} />)
    const row = screen.getByRole('group', { name: 'htmlExport:sa_pymol_seq_label' })
    fireEvent.keyDown(row, { key: 'ArrowRight' })
    expect(onHover).toHaveBeenLastCalledWith(0)
    rerender(<PymolSeqStrip rect={RECT} report={REPORT} lit={2} onHover={onHover} />)
    const res = document.querySelectorAll('.sav-seq-res')
    expect([...res].map(r => r.classList.contains('is-lit'))).toEqual([false, false, true])
    fireEvent.keyDown(row, { key: 'ArrowRight' })
    expect(onHover).toHaveBeenLastCalledWith(2)
    fireEvent.keyDown(row, { key: 'ArrowLeft' })
    expect(onHover).toHaveBeenLastCalledWith(1)
    const info = document.querySelector('.sav-seq-info') as HTMLElement
    expect(info).toHaveTextContent('htmlExport:sa_pymol_seq_info {"obj":"Structure_25HN","chain":"B","resi":"1","resn":"GLY"}')
    expect(info.style.top).toBe(`${20 + SEQ_STRIP_H + 6}px`)
    expect(row).toHaveAttribute('aria-describedby', info.id)
    fireEvent.keyDown(row, { key: 'Escape' })
    expect(onHover).toHaveBeenLastCalledWith(null)
    // The lit one moves without the residues being drawn again (PR #10172 review).
    rerender(<PymolSeqStrip rect={RECT} report={REPORT} lit={0} onHover={onHover} />)
    expect(document.querySelectorAll('.sav-seq-res')[0]).toBe(res[0])
    expect([...res].map(r => r.classList.contains('is-lit'))).toEqual([true, false, false])
    rerender(<PymolSeqStrip rect={RECT} report={REPORT} lit={null} onHover={onHover} />)
    expect(document.querySelector('.sav-seq-res.is-lit')).toBeNull()
  })

  it('says it is reading before the first report, and when no chain is shown', () => {
    const { rerender } = render(<PymolSeqStrip rect={RECT} report={undefined} lit={null} onHover={vi.fn()} />)
    expect(document.querySelector('.sav-seq')).toHaveTextContent('htmlExport:sa_pymol_seq_loading')
    rerender(<PymolSeqStrip rect={RECT} report={{ ...REPORT, res: [], more: false }} lit={null} onHover={vi.fn()} />)
    expect(document.querySelector('.sav-seq')).toHaveTextContent('htmlExport:sa_pymol_seq_none')
  })
})
