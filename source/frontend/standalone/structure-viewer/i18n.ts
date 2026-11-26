/**
 * i18next for the offline structure file (the HTML export), with no HTTP
 * backend: a page with no server cannot load translations over the network.
 * The namespaces the bundled components use
 * are imported statically, and the build keeps only the keys this file uses
 * (`stringFilters.ts`, through vite-plugins/gantt-strings-only.ts): the rest
 * of each namespace is left out.
 *
 *   common      — Modal and the dialogs' shared words
 *   proteindb   — the 3Dmol.js toolbar (`Mol3dToolbar` and its chips)
 *   pymol       — the PyMOL menu bar, command line and dialogs, with this
 *                 file's own words over the ones that name PyMOL bare
 *                 (`PYMOL_WORDS`)
 *   pymolNotice — the PyMOL™ trademark notice
 *   htmlExport  — this file's own words (`sa_*`)
 *
 * The language starts as the exporter's (the config block) and the header's
 * toggle switches it without a reload.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { numberFormatter } from '../../src/i18n/numberFormatter'
import commonEn from '../../src/i18n/locales/en/common.json'
import commonJa from '../../src/i18n/locales/ja/common.json'
import htmlExportEn from '../../src/i18n/locales/en/htmlExport.json'
import htmlExportJa from '../../src/i18n/locales/ja/htmlExport.json'
import proteindbEn from '../../src/i18n/locales/en/proteindb.json'
import proteindbJa from '../../src/i18n/locales/ja/proteindb.json'
import pymolEn from '../../src/i18n/locales/en/pymol.json'
import pymolJa from '../../src/i18n/locales/ja/pymol.json'
import pymolNoticeEn from '../../src/i18n/locales/en/pymolNotice.json'
import pymolNoticeJa from '../../src/i18n/locales/ja/pymolNotice.json'
import pymolWordsEn from './pymolWords.en.json'
import pymolWordsJa from './pymolWords.ja.json'

/**
 * The `pymol` strings of AgDB's shared PyMOL components (dialogs, menu bar,
 * presets, command line, busy bar) that name PyMOL bare, reworded for this
 * file: owner 2026-11-17, PyMOL's name only as its licence allows, and the
 * engine is "Includes PyMOL™" mode here (owner 2026-11-18). Laid over the
 * namespace here, so the shared components keep their own words elsewhere
 * and need no new props (PT-9630). These JSON files sit outside
 * `src/i18n/locales`, so the strings-only filter leaves them whole: every
 * key is one the filter ships (`strings.test.ts`).
 */
export const PYMOL_WORDS: Readonly<Record<'en' | 'ja', Readonly<Record<string, string>>>> = { en: pymolWordsEn, ja: pymolWordsJa }

export const STANDALONE_NAMESPACES = ['common', 'htmlExport', 'proteindb', 'pymol', 'pymolNotice'] as const

export function initStandaloneI18n(lng: 'ja' | 'en'): typeof i18n {
  void i18n
    .use(numberFormatter)
    .use(initReactI18next)
    .init({
      resources: {
        en: { common: commonEn, htmlExport: htmlExportEn, proteindb: proteindbEn, pymol: { ...pymolEn, ...pymolWordsEn }, pymolNotice: pymolNoticeEn },
        ja: { common: commonJa, htmlExport: htmlExportJa, proteindb: proteindbJa, pymol: { ...pymolJa, ...pymolWordsJa }, pymolNotice: pymolNoticeJa },
      },
      ns: [...STANDALONE_NAMESPACES],
      lng,
      fallbackLng: 'en',
      defaultNS: 'htmlExport',
      interpolation: { escapeValue: false, alwaysFormat: true },
      parseMissingKeyHandler: key => key,
    })
  return i18n
}
