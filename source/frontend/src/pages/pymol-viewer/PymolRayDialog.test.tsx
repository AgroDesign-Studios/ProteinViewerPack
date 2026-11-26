import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, vars?: Record<string, unknown>) => {
      const key = k.replace(/^pymol:/, '')
      return vars ? `${key} ${JSON.stringify(vars)}` : key
    },
  }),
}))

import { PymolRayDialog } from './PymolRayDialog'
import { RAY_DEFAULTS, withQuality, type RayOptions } from './pymolRayOptions'

function open(initial: RayOptions = RAY_DEFAULTS, view: { w: number; h: number } | null = { w: 800, h: 600 }, ready = true) {
  const onCreate = vi.fn()
  const onClose = vi.fn()
  render(<PymolRayDialog initial={initial} view={view} ready={ready} onClose={onClose} onCreate={onCreate} />)
  return { onCreate, onClose }
}

const radio = (name: string | RegExp) => screen.getByRole('radio', { name })

describe('PymolRayDialog', () => {
  it('names each multiple of the view with the pixels it gives (owner 2026-11-16)', () => {
    open()
    expect(radio('ray_size_same_px {"w":800,"h":600}')).toBeChecked()
    expect(radio('ray_size_scale_px {"n":2,"w":1600,"h":1200}')).toBeEnabled()
    expect(radio('ray_size_scale_px {"n":3,"w":2400,"h":1800}')).toBeEnabled()
  })

  it('offers the common sizes, each with its pixels', async () => {
    const { onCreate } = open()
    expect(radio('ray_size_fhd {"w":1920,"h":1080}')).toBeInTheDocument()
    expect(radio('ray_size_print {"w":2400,"h":1800}')).toBeInTheDocument()
    await userEvent.click(radio('ray_size_uhd {"w":3840,"h":2160}'))
    // 16:9 against the view's 4:3: the picture frames another part of the scene.
    expect(screen.getByText(/ray_aspect_note/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'ray_create' }))
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ size: 'uhd' }), { w: 3840, h: 2160 })
  })

  it('a multiple past 4096 px a side cannot be chosen, and says so', () => {
    open(RAY_DEFAULTS, { w: 1600, h: 900 })
    const three = radio('ray_size_scale_over {"n":3,"w":4800,"h":2700,"max":4096}')
    expect(three).toBeDisabled()
  })

  it('refuses a remembered size past 4096 px a side, saying why', () => {
    const { onCreate } = open({ ...RAY_DEFAULTS, size: 3 }, { w: 1600, h: 900 })
    expect(screen.getByText(/^ray_size_too_large /)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ray_create' })).toBeDisabled()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('takes a width and a height of one’s own: the other side follows the view while locked, and is free once unlocked', async () => {
    const { onCreate } = open()
    await userEvent.click(radio('ray_size_custom'))
    const width = screen.getByLabelText('ray_width_label')
    const height = screen.getByLabelText('ray_height_label')
    await userEvent.clear(width)
    await userEvent.type(width, '1000')
    expect(height).toHaveValue(750)
    await userEvent.clear(height)
    await userEvent.type(height, '300')
    expect(width).toHaveValue(400)
    await userEvent.click(screen.getByRole('checkbox', { name: 'ray_lock_label' }))
    await userEvent.clear(width)
    await userEvent.type(width, '1200')
    expect(height).toHaveValue(300)
    await userEvent.click(screen.getByRole('button', { name: 'ray_create' }))
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ size: 'custom', width: 1200, height: 300, lock: false }), { w: 1200, h: 300 })
  })

  it('refuses sides outside 1-4096', async () => {
    open({ ...RAY_DEFAULTS, size: 'custom', lock: false, width: 800, height: 600 })
    const height = screen.getByLabelText('ray_height_label')
    await userEvent.clear(height)
    await userEvent.type(height, '5000')
    expect(screen.getByText('ray_side_invalid {"max":4096}')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ray_create' })).toBeDisabled()
  })

  it('the quality is one switch, 通常品質 ⇄ 高品質, that leaves the size alone; changed details are said and can be put back', async () => {
    const { onCreate } = open()
    const quality = screen.getByRole('switch', { name: 'ray_quality_high' })
    expect(quality).toBeChecked()
    expect(screen.getByText('ray_quality_normal')).toBeInTheDocument()
    expect(quality).toHaveAccessibleDescription('ray_quality_high_note')
    await userEvent.click(radio('ray_size_scale_px {"n":2,"w":1600,"h":1200}'))
    await userEvent.click(quality)
    expect(quality).not.toBeChecked()
    expect(radio('ray_size_scale_px {"n":2,"w":1600,"h":1200}')).toBeChecked()
    // A detail changed: said, and one press puts the quality's own back.
    await userEvent.click(screen.getByText('ray_details'))
    await userEvent.click(screen.getByRole('checkbox', { name: 'ray_shadows_label' }))
    expect(quality).toHaveAccessibleDescription('ray_quality_normal_note ray_quality_adjusted')
    await userEvent.click(screen.getByRole('button', { name: 'ray_quality_reset' }))
    expect(screen.queryByRole('button', { name: 'ray_quality_reset' })).toBeNull()
    // The button went with the change: the focus is on the switch it set back (PT-9552 item 4).
    expect(quality).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'ray_create' }))
    expect(onCreate).toHaveBeenCalledWith(withQuality({ ...RAY_DEFAULTS, size: 2 }, 'normal'), { w: 1600, h: 1200 })
  })

  it('offers only the view’s own size among the multiples before the view is laid out, asked as 0 x 0', async () => {
    const { onCreate } = open(RAY_DEFAULTS, null)
    expect(radio('ray_size_scale {"n":2}')).toBeDisabled()
    expect(radio('ray_size_fhd {"w":1920,"h":1080}')).toBeEnabled()
    expect(screen.getByText('ray_size_unmeasured')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'ray_create' }))
    expect(onCreate).toHaveBeenCalledWith(RAY_DEFAULTS, { w: 0, h: 0 })
  })

  it('cannot create a remembered 2x before the view is laid out', () => {
    open({ ...RAY_DEFAULTS, size: 2 }, null)
    expect(screen.getByRole('button', { name: 'ray_create' })).toBeDisabled()
  })

  it('a width of one’s own stored before takes its height from the view at once', () => {
    open({ ...RAY_DEFAULTS, size: 'custom', width: 1000, height: 1, lock: true })
    expect(screen.getByLabelText('ray_height_label')).toHaveValue(750)
  })

  it('keeps 作成 shut, with the reason, while PyMOL is not ready (PT-8372 item 3)', () => {
    open(RAY_DEFAULTS, { w: 800, h: 600 }, false)
    const create = screen.getByRole('button', { name: 'ray_create' })
    expect(create).toBeDisabled()
    expect(document.getElementById(create.getAttribute('aria-describedby') ?? '')?.textContent).toBe('ray_create_not_ready')
  })

  it('says nothing of time for a small ray, and warns for a huge one (PT-8372 item 1)', async () => {
    open(RAY_DEFAULTS, { w: 800, h: 600 })
    expect(screen.queryByText(/^ray_time_(slow|risky)/)).toBeNull()
    await userEvent.click(radio('ray_size_custom'))
    const width = screen.getByLabelText('ray_width_label')
    await userEvent.clear(width)
    await userEvent.type(width, '4096')
    // 4096 x 3072, antialias 2, shadows: about 238 s.
    expect(screen.getByText('ray_time_slow {"min":4}')).toBeInTheDocument()
  })

  it('closes without creating', async () => {
    const { onCreate, onClose } = open()
    await userEvent.click(screen.getByRole('button', { name: 'ray_cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(onCreate).not.toHaveBeenCalled()
  })
})
