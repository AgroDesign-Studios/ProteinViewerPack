/**
 * `isFileOnIos` (PT-9781): a page opened from a file on an iPhone or iPad,
 * told by the context alone — the scheme and the device, never a request.
 */
import { describe, expect, it } from 'vitest'

import { isFileOnIos } from './fileOnIos'

const EDGE_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/142.0.3595.66 Mobile/15E148 Safari/604.1'
const SAFARI_IPAD_OLD = 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1'
/** iPadOS 13+ asks for the desktop site: a Mac's user agent. */
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const WINDOWS_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36'

const nav = (userAgent: string, maxTouchPoints = 0) => ({ userAgent, maxTouchPoints })

describe('isFileOnIos', () => {
  it.each([
    ['an iPhone, file:', 'file:', nav(EDGE_IPHONE, 5)],
    ['an old iPad, file:', 'file:', nav(SAFARI_IPAD_OLD, 5)],
    ['iPadOS with the desktop user agent, file:', 'file:', nav(MAC, 5)],
    // A browser may show the file under a scheme of its own.
    ['an iPhone, another non-http scheme', 'chrome:', nav(EDGE_IPHONE, 5)],
  ])('is true for %s', (_name, protocol, n) => {
    expect(isFileOnIos({ protocol }, n)).toBe(true)
  })

  it.each([
    ['an iPhone, served over https', 'https:', nav(EDGE_IPHONE, 5)],
    ['an iPhone, served over http', 'http:', nav(EDGE_IPHONE, 5)],
    ['a Mac (no touch points), file:', 'file:', nav(MAC, 0)],
    ['a Windows touch-screen PC, file:', 'file:', nav(WINDOWS_CHROME, 10)],
    ['an Android phone, file:', 'file:', nav(ANDROID, 5)],
  ])('is false for %s', (_name, protocol, n) => {
    expect(isFileOnIos({ protocol }, n)).toBe(false)
  })

  it('is false where there is no location or navigator', () => {
    expect(isFileOnIos(undefined, nav(EDGE_IPHONE, 5))).toBe(false)
    expect(isFileOnIos({ protocol: 'file:' }, undefined)).toBe(false)
  })

  it("reads this page's own context by default (jsdom: http, not an iPhone)", () => {
    expect(isFileOnIos()).toBe(false)
  })
})
