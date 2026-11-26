/**
 * gantt-strings-only: a single-file standalone build loads `tools.json` with
 * the gantt_* keys alone (PT-2200) and `common.json` with the listed keys
 * alone (PT-2204), so the file carries no other text. Any other namespace
 * stops the build.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { COMMON_KEYS, ganttStringsOnly, pickStandaloneStrings } from './gantt-strings-only'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true })))
})

async function localeFile(name: string, body: object, lng = 'ja'): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'gantt-strings-'))
  dirs.push(root)
  const dir = path.join(root, 'src', 'i18n', 'locales', lng)
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, name)
  await writeFile(file, JSON.stringify(body))
  return file
}

function load(id: string): Promise<string | null> {
  const plugin = ganttStringsOnly()
  return (plugin.load as (id: string) => Promise<string | null>).call({}, id)
}

describe('pickStandaloneStrings', () => {
  it('keeps the gantt_ keys of tools and nothing else', () => {
    expect(
      pickStandaloneStrings('tools', {
        gantt_name: 'ガントチャート',
        gantt_zoom_day: '日',
        other_name: 'other screen',
        ig_desc: 'x',
        gantt: 'no',
      }),
    ).toEqual({ gantt_name: 'ガントチャート', gantt_zoom_day: '日' })
  })

  it('keeps only the ConfirmDialog keys and the dialogs\' close of common', () => {
    expect([...COMMON_KEYS].sort()).toEqual(['cancel', 'close', 'confirm', 'ok'])
    expect(
      pickStandaloneStrings('common', {
        ok: 'OK',
        cancel: 'キャンセル',
        confirm: '確認',
        other_key: 'other screen',
        okay: 'no',
      }),
    ).toEqual({ ok: 'OK', cancel: 'キャンセル', confirm: '確認' })
  })

  it('refuses a namespace it has no filter for', () => {
    expect(() => pickStandaloneStrings('other', { a: 'b' })).toThrow(/namespace "other" is not allowed/)
    expect(() => pickStandaloneStrings('constructor', {})).toThrow(/not allowed/)
  })
})

describe('ganttStringsOnly', () => {
  it('loads a locale tools.json with the gantt_ keys only', async () => {
    const file = await localeFile('tools.json', { gantt_name: 'G', other_key: 'SOME_SETTING is unset' })
    const loaded = await load(file)
    expect(JSON.parse(loaded ?? 'null')).toEqual({ gantt_name: 'G' })
    expect(loaded).not.toContain('SOME_SETTING')
  })

  it('also matches an id carrying a query string', async () => {
    const file = await localeFile('tools.json', { gantt_name: 'G', other: 'x' })
    expect(JSON.parse((await load(`${file}?import`)) ?? 'null')).toEqual({ gantt_name: 'G' })
  })

  it('loads a locale common.json with the ConfirmDialog keys only', async () => {
    const file = await localeFile('common.json', { ok: 'OK', other_key: 'other screen' })
    expect(JSON.parse((await load(file)) ?? 'null')).toEqual({ ok: 'OK' })
  })

  // PT-2204: the locale directory used to be matched as [A-Za-z-]+, so a
  // pt_BR/tools.json was not filtered and shipped whole.
  it.each(['pt_BR', 'zh.Hant', 'sr@latin'])('filters a %s locale directory too', async lng => {
    const file = await localeFile('tools.json', { gantt_name: 'G', other: 'x' }, lng)
    expect(JSON.parse((await load(file)) ?? 'null')).toEqual({ gantt_name: 'G' })
  })

  it('stops the build on any other locale namespace', async () => {
    const file = await localeFile('other.json', { a: 'b' })
    await expect(load(file)).rejects.toThrow(/namespace "other" is not allowed/)
  })

  it('leaves every other file to Vite', async () => {
    expect(await load('/repo/frontend/src/pages/tools/gantt/GanttTool.tsx')).toBeNull()
    expect(await load('/repo/frontend/src/tools.json')).toBeNull()
    expect(await load('/repo/frontend/src/i18n/tools.json')).toBeNull()
  })
})
