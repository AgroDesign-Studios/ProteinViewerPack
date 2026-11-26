/**
 * What the page says when PyMOL failed (`pymolFailureMessage`, PT-9194 item
 * 3): a failed start or a stop after it ran, the phone's wording, the `.pse`
 * sentence only while a `.pse` is open, and no doubled full stop.
 */
import { describe, expect, it } from 'vitest'

import { pymolFailureMessage } from './StandaloneApp'

describe('pymolFailureMessage', () => {
  it('says "could not start" before PyMOL ran, and "stopped" after', () => {
    expect(pymolFailureMessage({ mobile: false, ranBefore: false, pse: false, failure: 'no WebGL2' })).toEqual({
      key: 'htmlExport:sa_status_pymol_failed',
      vars: { reason: 'no WebGL2' },
      error: true,
    })
    expect(pymolFailureMessage({ mobile: false, ranBefore: true, pse: false, failure: 'worker fatal' }).key).toBe('htmlExport:sa_status_pymol_stopped')
  })

  it('on a phone, adds the .pse sentence only while a .pse is open', () => {
    expect(pymolFailureMessage({ mobile: true, ranBefore: false, pse: false, failure: 'x' }).key).toBe('htmlExport:sa_m_engine_failed')
    expect(pymolFailureMessage({ mobile: true, ranBefore: false, pse: true, failure: 'x' }).key).toBe('htmlExport:sa_m_engine_failed_pse')
    expect(pymolFailureMessage({ mobile: true, ranBefore: true, pse: false, failure: 'x' }).key).toBe('htmlExport:sa_m_engine_stopped')
    expect(pymolFailureMessage({ mobile: true, ranBefore: true, pse: true, failure: 'x' }).key).toBe('htmlExport:sa_m_engine_stopped_pse')
  })

  it('drops a reason’s own full stop, so the sentence has one', () => {
    expect(pymolFailureMessage({ mobile: true, ranBefore: false, pse: false, failure: 'PyMOL did not start in 60 s.' }).vars).toEqual({ reason: 'PyMOL did not start in 60 s' })
    expect(pymolFailureMessage({ mobile: false, ranBefore: false, pse: false, failure: null }).vars).toEqual({ reason: '' })
  })
})
