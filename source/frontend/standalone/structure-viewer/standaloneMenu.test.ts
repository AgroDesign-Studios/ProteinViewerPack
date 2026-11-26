/**
 * The offline file's PyMOL menu is the shared menu data (owner-approved
 * design, 2026-11-13): the same tree `appMenu` builds, without the entries
 * the file cannot carry out (`SERVER_ACTIONS`) — and nothing else changed
 * (owner 2026-11-14: what the file cannot do is not shown at all). A menu
 * entry added to the shared tree reaches the file by itself; one the file
 * cannot carry out must be left out here, which this test makes someone decide.
 */
import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'ja' } }) }))

import { ABSENT_MENU_PATHS, appMenu, pageMenuLabels, type MenuNode } from '../../src/pages/pymol-viewer/pymolMenuData'
import { presetMenuLabels } from '../../src/pages/pymol-viewer/pymolPresets'
import { standaloneMenu } from './PymolPane'

const t = ((k: string) => k) as unknown as TFunction
/** The shared tree's entries the file leaves out. */
const SERVER_ACTIONS = new Set(['open-agdb', 'export-html'])

/** Every node with its path, depth first. */
function walk(nodes: readonly MenuNode[], path: string[] = []): { path: string; node: MenuNode }[] {
  return nodes.flatMap((node, i) => {
    const here = [...path, node.kind === 'sep' ? `sep${i}` : node.label]
    const self = { path: here.join(' › '), node }
    return node.kind === 'menu' ? [self, ...walk(node.items, here)] : [self]
  })
}

/** The tree without the local entries named. */
function without(nodes: readonly MenuNode[], actions: ReadonlySet<string>): MenuNode[] {
  return nodes
    .filter(n => !(n.kind === 'local' && actions.has(n.action)))
    .map(n => (n.kind === 'menu' ? { ...n, items: without(n.items, actions) } : n))
}
/** The file's own entry: a structure file from this computer, added to PyMOL. */
const FILE_ACTIONS = new Set(['open-file'])

describe('the offline file’s PyMOL menu', () => {
  for (const column of ['bfactor', 'plddt'] as const) {
    it(`is AgDB's appMenu tree without the server entries, plus the file's own Open (${column})`, () => {
      const agdb = appMenu(pageMenuLabels(t, { exportHtml: true }), presetMenuLabels(t, column))
      const file = standaloneMenu(t, column)
      expect(without(file, FILE_ACTIONS)).toEqual(without(agdb, SERVER_ACTIONS))
      const fileMenu = file.find(n => n.kind === 'menu' && n.label === 'File')
      expect(fileMenu?.kind === 'menu' && fileMenu.items[0]).toMatchObject({ kind: 'local', action: 'open-file', label: 'htmlExport:sa_open_menu' })
      // The shared tree has both entries, so the comparison above is not empty-handed.
      const agdbActions = walk(agdb).flatMap(({ node }) => (node.kind === 'local' ? [node.action] : []))
      expect(agdbActions).toEqual(expect.arrayContaining(['open-agdb', 'export-html']))
      const fileActions = walk(file).flatMap(({ node }) => (node.kind === 'local' ? [node.action] : []))
      for (const a of SERVER_ACTIONS) expect(fileActions).not.toContain(a)
      // The file's menu locks exactly the entries the shared tree locks.
      const agdbLocked = walk(agdb).filter(({ node }) => node.kind === 'local' && node.locked !== undefined)
      const fileLocked = walk(file).filter(({ node }) => node.kind === 'local' && node.locked !== undefined)
      expect(fileLocked).toEqual(agdbLocked)
    })
  }

  it('keeps every PyMOL command entry, the presets, the settings, keys, About and the session save usable', () => {
    const file = walk(standaloneMenu(t, 'bfactor'))
    const commands = file.filter(({ node }) => node.kind === 'item')
    expect(commands.length).toBe(616 - ABSENT_MENU_PATHS.size)
    const local = file.filter(({ node }) => node.kind === 'local' && node.locked === undefined).map(({ node }) => (node.kind === 'local' ? node.action : ''))
    expect(local).toEqual(expect.arrayContaining(['settings', 'keys', 'about', 'export-mol', 'export-pse', 'preset:ligand-site', 'preset:publication', 'preset:reset']))
  })
})
