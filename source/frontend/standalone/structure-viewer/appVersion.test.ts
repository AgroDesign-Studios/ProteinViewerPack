/**
 * The app's version in the licence tab (owner 2026-11-16: 「1.0.0 ＋ git の
 * 短い番号」): the version from appLicence.ts, the short commit written in by the
 * structure viewer's build — from AGDB_GIT_SHA (a build without .git passes
 * the commit there), else git — and 「ver <version>」 alone, never a broken
 * build, where neither says it. The repository is named (owner 2026-11-16).
 */
import { describe, expect, it } from 'vitest'

import { buildSha } from './buildSha'
import { APP_BUILD_SHA, APP_GITHUB_URL, APP_VERSION, appVersionText } from './appLicence'
import { latestReleaseApiUrl } from './latestRelease'

describe('the app’s version', () => {
  it('is the app’s own version, with the short commit in brackets when one is known', () => {
    expect(APP_VERSION).toBe('1.0.7')
    expect(appVersionText('58eef57c4a')).toBe('ver 1.0.7 (58eef57c4a)')
    expect(appVersionText('')).toBe('ver 1.0.7')
    // Anything but a short commit id is dropped, not shown.
    expect(appVersionText('not a sha')).toBe('ver 1.0.7')
    expect(appVersionText('<script>')).toBe('ver 1.0.7')
  })

  it('a test runs no structure viewer build: no commit is written in', () => {
    expect(APP_BUILD_SHA).toBe('')
  })

  it('the build takes AGDB_GIT_SHA first, then git, and else nothing — never a failure', () => {
    const git = () => 'abcdef1234\n'
    expect(buildSha({ AGDB_GIT_SHA: ' 1234567 ' }, git)).toBe('1234567')
    expect(buildSha({ AGDB_GIT_SHA: '0123456789ABCDEF0123456789abcdef01234567' }, git)).toBe('0123456789ab')
    expect(buildSha({}, git)).toBe('abcdef1234')
    expect(buildSha({ AGDB_GIT_SHA: 'oops' }, git)).toBe('abcdef1234')
    expect(
      buildSha({}, () => {
        throw new Error('not a git repository')
      }),
    ).toBe('')
    expect(buildSha({}, () => 'fatal: something')).toBe('')
  })

  it('names the app’s repository (owner 2026-11-16), from which the latest-release API address is made', () => {
    expect(APP_GITHUB_URL).toBe('https://github.com/AgroDesign-Studios/ProteinViewerPack')
    expect(latestReleaseApiUrl(APP_GITHUB_URL)).toBe('https://api.github.com/repos/AgroDesign-Studios/ProteinViewerPack/releases/latest')
  })

  it('was 1.0.0 until the public release (owner 2026-11-16, published 2026-11-19); each release since raises it', () => {
    // 1.0.1: React's production build (PT-9858); 1.0.2: HELP 「使い方」's head and the maker's links; 1.0.3: the preset note's ×, the PDB ID link, the first-run guide; 1.0.4: the phone's own PyMOL object list, the computer's one-row 3Dmol.js toolbar and mouse controls card; 1.0.5: the owner's 2026-11-20 requests (open dialog, latest steps, panel marks, pull to zoom, original display, screenshot resolution, 改良点 on GitHub); 1.0.6: the owner's 2026-11-21 requests (Structure_25HN, the mouse box lid, the motion choices, the sequence row, the pen in PyMOL mode, the screenshot's choice of lines, round flags); 1.0.7: the source published with the app. A raise is a deliberate edit of this pin.
    expect(APP_VERSION).toBe('1.0.7')
  })
})
