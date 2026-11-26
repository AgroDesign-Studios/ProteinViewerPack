import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // The `pymol:` prefix is dropped so the expectations read as the bare keys.
    t: (k: string, vars?: Record<string, unknown>) => {
      const key = k.replace(/^pymol:/, '')
      return vars ? `${key} ${JSON.stringify(vars)}` : key
    },
  }),
}))

import { CHROME_RESERVED_SHORTCUTS } from './pymolKeys'
import { PYMOL_SETTINGS } from './pymolSettingsData'
import { PymolKeysDialog, PymolSettingsDialog, settingCommand } from './PymolSettingsDialog'

describe('settingCommand', () => {
  it('is one cmd.set call with the value as a string literal', () => {
    expect(settingCommand('sphere_scale', ' 0.3 ')).toBe('/cmd.set("sphere_scale", "0.3", quiet=0)')
    // A `;` or a quote stays inside the literal: it cannot start a second command.
    expect(settingCommand('label_font_id', '5; system("x")')).toBe('/cmd.set("label_font_id", "5; system(\\"x\\")", quiet=0)')
  })

  it('escapes the line breaks JSON leaves raw, so the literal stays on one line (PT-3291 item 10)', () => {
    const cmd = settingCommand('label_font_id', 'a\u2028b\u2029c\u0085d')
    expect(cmd).toBe('/cmd.set("label_font_id", "a\\u2028b\\u2029c\\u0085d", quiet=0)')
    expect(cmd).not.toMatch(/[\u0085\u2028\u2029]/)
    // Python reads each escape back as the character typed.
    expect(JSON.parse(cmd?.slice('/cmd.set("label_font_id", '.length, -', quiet=0)'.length) ?? '""')).toBe('a\u2028b\u2029c\u0085d')
  })

  it('refuses a name PyMOL could not have, an empty or multi-line value', () => {
    expect(settingCommand('Sphere-Scale', '1')).toBeNull()
    expect(settingCommand('x"); evil(', '1')).toBeNull()
    expect(settingCommand('sphere_scale', '  ')).toBeNull()
    expect(settingCommand('sphere_scale', '1\nload x.pse')).toBeNull()
    expect(settingCommand('sphere_scale', 'x'.repeat(1001))).toBeNull()
  })
})

describe('the settings data', () => {
  it('lists PyMOL’s documented settings, each once', () => {
    expect(PYMOL_SETTINGS.length).toBeGreaterThan(600)
    const names = PYMOL_SETTINGS.map(r => r[0])
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]{0,63}$/)
  })
})

function renderSettings() {
  const onCommand = vi.fn(() => Promise.resolve())
  const onScale = vi.fn()
  const onClose = vi.fn()
  render(<PymolSettingsDialog onClose={onClose} onCommand={onCommand} scale="auto" autoScale={2} onScale={onScale} />)
  return { onCommand, onScale, onClose }
}

describe('PymolSettingsDialog', () => {
  it('writes a setting through onCommand only, and shows PyMOL’s help for a known one', async () => {
    const { onCommand } = renderSettings()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('settings_name'), 'all_states')
    expect(await screen.findByText('controls whether or not all molecular states are visible.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('settings_value'), 'on')
    await user.click(screen.getByRole('button', { name: 'settings_apply' }))
    expect(onCommand).toHaveBeenCalledTimes(1)
    expect(onCommand).toHaveBeenCalledWith('/cmd.set("all_states", "on", quiet=0)')
    expect(await screen.findByText('settings_applied {"name":"all_states"}')).toBeInTheDocument()
  })

  it('cannot apply without a valid name and value', async () => {
    const { onCommand } = renderSettings()
    const user = userEvent.setup()
    const apply = screen.getByRole('button', { name: 'settings_apply' })
    expect(apply).toBeDisabled()
    await user.type(screen.getByLabelText('settings_name'), 'Bad Name')
    await user.type(screen.getByLabelText('settings_value'), '1{Enter}')
    expect(apply).toBeDisabled()
    expect(onCommand).not.toHaveBeenCalled()
  })

  it('applies nothing on an Enter the IME took (keyCode 229), as the command line does (PT-3291 item 20)', async () => {
    const { onCommand } = renderSettings()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('settings_name'), 'all_states')
    await user.type(screen.getByLabelText('settings_value'), 'on')
    fireEvent.keyDown(screen.getByLabelText('settings_value'), { key: 'Enter', keyCode: 229 })
    expect(onCommand).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByLabelText('settings_value'), { key: 'Enter' })
    expect(onCommand).toHaveBeenCalledTimes(1)
  })

  it('says a failure PyMOL answered as PyMOL’s, never as this page’s own words (PT-3291 item 11)', async () => {
    const { onCommand } = renderSettings()
    onCommand.mockRejectedValueOnce(new Error('Setting-Error: invalid value'))
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('settings_name'), 'all_states')
    await user.type(screen.getByLabelText('settings_value'), 'on')
    await user.click(screen.getByRole('button', { name: 'settings_apply' }))
    expect(
      await screen.findByText(`cmd_failed ${JSON.stringify({ detail: `detail_pymol_said ${JSON.stringify({ text: 'Setting-Error: invalid value' })}` })}`),
    ).toBeInTheDocument()
  })

  it('puts the scale in a form group, as the other inputs: the design system’s look and focus ring (PT-3291 item 20)', () => {
    renderSettings()
    expect(screen.getByLabelText('settings_scale_label').closest('.form-group')).not.toBeNull()
  })

  it('offers the display scale, naming what automatic means on this screen', async () => {
    const { onScale } = renderSettings()
    const user = userEvent.setup()
    const select = screen.getByLabelText('settings_scale_label')
    expect(screen.getByRole('option', { name: 'settings_scale_auto {"n":2}' })).toBeInTheDocument()
    await user.selectOptions(select, '1')
    expect(onScale).toHaveBeenCalledWith(1)
  })

  it('closes only from its own × (or Escape), never from a click outside', async () => {
    const { onClose } = renderSettings()
    const user = userEvent.setup()
    await user.click(document.querySelector('.modal-overlay') as HTMLElement)
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'dialog_close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('PymolKeysDialog', () => {
  it('lists every remapped chord', () => {
    render(<PymolKeysDialog onClose={vi.fn()} />)
    expect(screen.getAllByRole('row')).toHaveLength(CHROME_RESERVED_SHORTCUTS.length + 1)
    expect(screen.getByText('Ctrl+Alt+Shift+N')).toBeInTheDocument()
    expect(screen.getByText('keys_tab')).toBeInTheDocument()
  })
})
