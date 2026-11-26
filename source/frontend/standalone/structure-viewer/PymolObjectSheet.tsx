import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  PYMOL_LABELS,
  PYMOL_REPS,
  PYMOL_SCHEMES,
  PYMOL_SWATCHES,
  type ObjectAction,
  type PymolObject,
  type PymolObjectKind,
  type PymolObjects,
} from './pymolObjects'

/** Each kind's word in the list (htmlExport namespace). */
const KIND_TEXT: Readonly<Record<PymolObjectKind, string>> = {
  molecule: 'htmlExport:sa_objs_kind_molecule',
  selection: 'htmlExport:sa_objs_kind_selection',
  group: 'htmlExport:sa_objs_kind_group',
  distance: 'htmlExport:sa_objs_kind_distance',
  map: 'htmlExport:sa_objs_kind_map',
  other: 'htmlExport:sa_objs_kind_other',
}

const REP_TEXT: Readonly<Record<(typeof PYMOL_REPS)[number], string>> = {
  cartoon: 'htmlExport:sa_objs_rep_cartoon',
  sticks: 'htmlExport:sa_objs_rep_sticks',
  lines: 'htmlExport:sa_objs_rep_lines',
  spheres: 'htmlExport:sa_objs_rep_spheres',
  surface: 'htmlExport:sa_objs_rep_surface',
  mesh: 'htmlExport:sa_objs_rep_mesh',
}

const SCHEME_TEXT: Readonly<Record<(typeof PYMOL_SCHEMES)[number], string>> = {
  element: 'htmlExport:sa_objs_color_element',
  chain: 'htmlExport:sa_objs_color_chain',
  rainbow: 'htmlExport:sa_objs_color_rainbow',
  ss: 'htmlExport:sa_objs_color_ss',
  b: 'htmlExport:sa_objs_color_b',
}

const SWATCH_TEXT: Readonly<Record<(typeof PYMOL_SWATCHES)[number][0], string>> = {
  red: 'htmlExport:sa_objs_swatch_red',
  orange: 'htmlExport:sa_objs_swatch_orange',
  yellow: 'htmlExport:sa_objs_swatch_yellow',
  green: 'htmlExport:sa_objs_swatch_green',
  cyan: 'htmlExport:sa_objs_swatch_cyan',
  blue: 'htmlExport:sa_objs_swatch_blue',
  magenta: 'htmlExport:sa_objs_swatch_magenta',
  white: 'htmlExport:sa_objs_swatch_white',
  grey70: 'htmlExport:sa_objs_swatch_grey',
}

const LABEL_TEXT: Readonly<Record<(typeof PYMOL_LABELS)[number], string>> = {
  residue: 'htmlExport:sa_objs_label_residue',
  atom: 'htmlExport:sa_objs_label_atom',
  clear: 'htmlExport:sa_objs_label_clear',
}

/** Kinds made of atoms: they have representations, colour schemes and labels. */
const ATOMIC: ReadonlySet<PymolObjectKind> = new Set(['molecule', 'selection', 'group'])

/** The entry the detail shows: an object's name, or null for 「すべて」 (every object). */
type Open = { name: string | null }

/**
 * The phone's object list (owner 2026-11-19: PyMOL's own object panel is not
 * used on a phone): drawn in the 表示ツール sheet's 「オブジェクト」 tab.
 * One row per object and selection as PyMOL lists them, 「すべて」 first: a
 * switch (an object drawn, a selection's marks shown) and the entry's name,
 * which opens what can be done to it in the same place — representations,
 * colour, labels, the view, delete — with 「‹ 一覧」 back. Only what applies:
 * a map or a distance has no representations or labels. Every target is
 * named by its index in the list the worker sent (`pymolObjects.ts`);
 * names are shown only as text. The entry open is followed by name, so a
 * list that changes under it keeps it, or goes back when it is gone.
 */
export function PymolObjectSheet(props: { objects: PymolObjects | undefined; ready: boolean; act: (index: number, action: ObjectAction) => Promise<void> }) {
  const { objects, ready, act } = props
  const { t } = useTranslation(['htmlExport'])
  const [open, setOpen] = useState<Open | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [pending, setPending] = useState(0)
  // A switch pressed again before PyMOL's report: what the user last asked for, by name ('' = 「すべて」).
  // A Map, not an object: a PyMOL name like constructor or __proto__ must not read an inherited value (PT-9937).
  const [wanted, setWanted] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  useEffect(() => setWanted(w => (w.size === 0 ? w : new Map())), [objects])
  const headRef = useRef<HTMLHeadingElement | null>(null)
  // The delete question: the focus goes to 「やめる」 when it opens, back to 「削除」 when it is cancelled.
  const deleteRef = useRef<HTMLButtonElement | null>(null)
  const keepRef = useRef<HTMLButtonElement | null>(null)
  const asked = useRef(false)
  useEffect(() => {
    if (confirm) {
      asked.current = true
      keepRef.current?.focus()
    } else if (asked.current) {
      asked.current = false
      deleteRef.current?.focus()
    }
  }, [confirm])
  const backTo = useRef<string | null | undefined>(undefined)
  const listRef = useRef<HTMLUListElement | null>(null)
  const ids = {
    reps: useId(),
    color: useId(),
    label: useId(),
    view: useId(),
    del: useId(),
  }
  const items = objects?.items ?? []
  const indexOf = (o: Open): number => (o.name === null ? -1 : items.findIndex(it => it.name === o.name))
  const openIndex = open === null ? null : indexOf(open)
  // The entry left the list (deleted, a new structure): back to the list.
  useEffect(() => {
    if (open !== null && openIndex === -1 && open.name !== null) setOpen(null)
  }, [open, openIndex])

  const run = (index: number, action: ObjectAction) => {
    setPending(n => n + 1)
    void act(index, action).finally(() => setPending(n => n - 1))
  }

  // The detail's representations are read for the entry open (`focus`), and stop being read when it closes.
  const focusSent = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (!ready || objects === undefined) {
      // A restarted PyMOL has no entry open: ask again when its list comes.
      focusSent.current = undefined
      return
    }
    const want = open === null ? undefined : open.name
    if (want === focusSent.current) return
    if (want === undefined) {
      focusSent.current = undefined
      run(-1, { op: 'unfocus' })
      return
    }
    const i = indexOf({ name: want })
    if (want !== null && i < 0) return
    focusSent.current = want
    run(i, { op: 'focus' })
    // `run` and `indexOf` read the latest list; the entry open and the list's version decide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready, objects?.v])

  // The sheet closed (or the tab left) with an entry open: the worker stops reading it.
  useEffect(
    () => () => {
      if (focusSent.current !== undefined) void act(-1, { op: 'unfocus' })
    },
    // The bridge's own action, the same for the pane's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Focus: the detail's heading when it opens, the row it came from when it closes.
  useEffect(() => {
    if (open !== null) {
      headRef.current?.focus()
      return
    }
    if (backTo.current === undefined) return
    const name = backTo.current
    backTo.current = undefined
    const rows = listRef.current?.querySelectorAll<HTMLButtonElement>('.sav-obj-open') ?? []
    const i = name === null ? 0 : items.findIndex(it => it.name === name) + 1
    rows[i]?.focus()
    // Only on opening and closing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!ready || objects === undefined) return <p className="sav-objs-empty">{ready ? t('htmlExport:sa_objs_reading') : t('htmlExport:sa_objs_not_ready')}</p>

  const objectsOnly = items.filter(it => it.kind !== 'selection')
  // Past the names the worker sends, whether every object is on is not known: mixed.
  const allOn: boolean | 'mixed' = objects.more ? 'mixed' : objectsOnly.length > 0 && objectsOnly.every(it => it.on)
  const kindText = (k: PymolObjectKind) => t(KIND_TEXT[k])

  // The entry open is gone and the effect above is about to close it: the list meanwhile.
  const gone = open !== null && open.name !== null && openIndex === -1
  if (open === null || openIndex === null || gone) {
    const row = (it: PymolObject | null, i: number) => {
      const name = it === null ? t('htmlExport:sa_objs_all') : it.name
      const key = it === null ? '' : it.name
      const on = wanted.get(key) ?? (it === null ? allOn : it.on)
      const switchLabel = it !== null && it.kind === 'selection' ? 'htmlExport:sa_objs_switch_selection' : 'htmlExport:sa_objs_switch'
      return (
        <li key={it === null ? '\u0000all' : `${i}\u0000${it.name}`} className={`sav-obj-row${on === true ? ' is-on' : ''}`}>
          <button
            type="button"
            className="sav-obj-switch"
            aria-pressed={on}
            aria-label={t(switchLabel, { name })}
            onClick={() => {
              const next = on !== true
              setWanted(w => new Map(w).set(key, next))
              run(i, { op: next ? 'on' : 'off' })
            }}
          >
            <span className="sav-obj-switch-track" aria-hidden="true">
              <span className="sav-obj-switch-thumb" />
            </span>
          </button>
          <button
            type="button"
            className="sav-obj-open"
            onClick={() => {
              setConfirm(false)
              setOpen({ name: it === null ? null : it.name })
            }}
          >
            <span className="sav-obj-name">{name}</span>
            <span className="sav-obj-kind">{it === null ? t('htmlExport:sa_objs_kind_all') : kindText(it.kind)}</span>
            <span className="sav-obj-chev" aria-hidden="true">
              ›
            </span>
          </button>
        </li>
      )
    }
    return (
      <div className="sav-objs" aria-busy={pending > 0 || undefined}>
        <ul ref={listRef} className="sav-objs-list" aria-label={t('htmlExport:sa_objs_list')}>
          {row(null, -1)}
          {items.map((it, i) => row(it, i))}
        </ul>
        {objects.more && <p className="sav-objs-more">{t('htmlExport:sa_objs_more', { count: items.length })}</p>}
        {items.length === 0 && <p className="sav-objs-empty">{t('htmlExport:sa_objs_none')}</p>}
      </div>
    )
  }

  const it = openIndex === -1 ? null : items[openIndex]
  const i = openIndex
  const atomic = it === null || ATOMIC.has(it.kind)
  const reps = objects.focus === i ? objects.reps : null
  const close = () => {
    backTo.current = it === null ? null : it.name
    setConfirm(false)
    setOpen(null)
  }
  return (
    <div className="sav-obj-detail" aria-busy={pending > 0 || undefined}>
      <div className="sav-obj-head">
        <button type="button" className="btn btn-secondary" onClick={close}>
          <span aria-hidden="true">‹ </span>
          {t('htmlExport:sa_objs_back')}
        </button>
        <h3 ref={headRef} tabIndex={-1} className="sav-obj-title">
          {it === null ? t('htmlExport:sa_objs_all') : it.name}
          <span className="sav-obj-kind">{it === null ? t('htmlExport:sa_objs_kind_all') : kindText(it.kind)}</span>
        </h3>
      </div>
      {atomic && (
        <section className="sav-obj-sec" aria-labelledby={ids.reps}>
          <h4 id={ids.reps}>{t('htmlExport:sa_objs_sec_reps')}</h4>
          <div className="sav-obj-chips">
            {PYMOL_REPS.map(r => {
              const shown = reps?.includes(r) ?? false
              return (
                <button
                  key={r}
                  type="button"
                  className="btn btn-secondary"
                  aria-pressed={reps === null ? undefined : shown}
                  onClick={() => run(i, { op: shown ? 'hide' : 'show', arg: r })}
                >
                  {t(REP_TEXT[r])}
                </button>
              )
            })}
            <button type="button" className="btn btn-secondary" onClick={() => run(i, { op: 'hideall' })}>
              {t('htmlExport:sa_objs_hide_all')}
            </button>
          </div>
        </section>
      )}
      <section className="sav-obj-sec" aria-labelledby={ids.color}>
        <h4 id={ids.color}>{t('htmlExport:sa_objs_sec_color')}</h4>
        {atomic && (
          <div className="sav-obj-chips">
            {PYMOL_SCHEMES.map(s => (
              <button key={s} type="button" className="btn btn-secondary" onClick={() => run(i, { op: 'color', arg: s })}>
                {t(SCHEME_TEXT[s])}
              </button>
            ))}
          </div>
        )}
        <div className="sav-obj-swatches">
          {PYMOL_SWATCHES.map(([name, hex]) => (
            <button
              key={name}
              type="button"
              className="sav-obj-swatch"
              aria-label={t(SWATCH_TEXT[name])}
              title={t(SWATCH_TEXT[name])}
              style={{ background: hex }}
              onClick={() => run(i, { op: 'color', arg: name })}
            />
          ))}
        </div>
      </section>
      {atomic && (
        <section className="sav-obj-sec" aria-labelledby={ids.label}>
          <h4 id={ids.label}>{t('htmlExport:sa_objs_sec_label')}</h4>
          <div className="sav-obj-chips">
            {PYMOL_LABELS.map(l => (
              <button key={l} type="button" className="btn btn-secondary" onClick={() => run(i, { op: 'label', arg: l })}>
                {t(LABEL_TEXT[l])}
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="sav-obj-sec" aria-labelledby={ids.view}>
        <h4 id={ids.view}>{t('htmlExport:sa_objs_sec_view')}</h4>
        <div className="sav-obj-chips">
          <button type="button" className="btn btn-secondary" onClick={() => run(i, { op: 'zoom' })}>
            {t('htmlExport:sa_objs_zoom')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => run(i, { op: 'center' })}>
            {t('htmlExport:sa_objs_center')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => run(i, { op: 'orient' })}>
            {t('htmlExport:sa_objs_orient')}
          </button>
        </div>
      </section>
      {it !== null && (
        <section className="sav-obj-sec" aria-labelledby={ids.del}>
          <h4 id={ids.del}>{t('htmlExport:sa_objs_sec_delete')}</h4>
          {confirm ? (
            <div
              className="sav-obj-confirm"
              role="group"
              aria-label={t('htmlExport:sa_objs_delete_confirm', {
                name: it.name,
              })}
            >
              <p>{t('htmlExport:sa_objs_delete_confirm', { name: it.name })}</p>
              <div className="sav-obj-chips">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    setConfirm(false)
                    // The list comes back without it: the focus goes to its first row.
                    backTo.current = null
                    run(i, { op: 'delete' })
                  }}
                >
                  {t('htmlExport:sa_objs_delete_yes')}
                </button>
                <button ref={keepRef} type="button" className="btn btn-secondary" onClick={() => setConfirm(false)}>
                  {t('htmlExport:sa_objs_delete_no')}
                </button>
              </div>
            </div>
          ) : (
            <button ref={deleteRef} type="button" className="btn btn-secondary" onClick={() => setConfirm(true)}>
              {it.kind === 'selection' ? t('htmlExport:sa_objs_delete_selection') : t('htmlExport:sa_objs_delete')}
            </button>
          )}
        </section>
      )}
    </div>
  )
}
