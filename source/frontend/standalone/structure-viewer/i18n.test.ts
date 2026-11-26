/**
 * The offline file's own i18next (`initStandaloneI18n`): it starts in the
 * exporter's language with this file's namespace as the default, reads the
 * bundled namespaces with no server to ask, switches language in place, and a
 * key it does not have reads as the key, never as an empty string.
 */
import { describe, expect, it } from 'vitest'
import { initStandaloneI18n, STANDALONE_NAMESPACES } from './i18n'

describe('initStandaloneI18n', () => {
  it('starts in the given language, reads every bundled namespace, and switches in place', async () => {
    const i18n = initStandaloneI18n('ja')
    expect(i18n.language).toBe('ja')
    // htmlExport is the default namespace: no prefix needed.
    expect(i18n.t('sa_view_exported')).toBe('初期表示')
    expect(i18n.hasResourceBundle('ja', 'pymol')).toBe(true)
    for (const ns of STANDALONE_NAMESPACES) {
      expect(i18n.hasResourceBundle('ja', ns)).toBe(true)
      expect(i18n.hasResourceBundle('en', ns)).toBe(true)
    }

    await i18n.changeLanguage('en')
    expect(i18n.t('htmlExport:sa_view_exported')).toBe('Initial view')
    expect(i18n.t('pymol:measure')).toBe('Measure')
    expect(i18n.t('htmlExport:sa_meta_id', { id: 42 })).toBe('Database ID 42')
  })

  it('a key it does not have reads as the key', () => {
    const i18n = initStandaloneI18n('en')
    expect(i18n.t('htmlExport:no_such_key_anywhere')).toBe('no_such_key_anywhere')
  })
})
