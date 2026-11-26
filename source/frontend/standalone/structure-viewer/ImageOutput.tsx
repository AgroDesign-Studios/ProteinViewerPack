import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { BLOCK, EngineTag } from './ExportDialog'
import type { ExportItem, ImageItemId } from './exportItems'
import { HeadDetails } from './HeadDetails'
import { CameraIcon } from './pageIcons'

/** Each entry's name and the line under it. */
const LABEL: Readonly<Record<ImageItemId, { label: string; note: string }>> = {
  png: { label: 'htmlExport:sa_export_png', note: 'htmlExport:sa_export_png_note' },
  ray: { label: 'htmlExport:sa_export_ray', note: 'htmlExport:sa_export_ray_note' },
}

/**
 * The header's 「画像出力」 (owner 2026-11-16: the export dialog's screenshot
 * and ray trace moved here, under a camera): a small panel like 「詳細」's
 * (`HeadDetails`), no menu — the button opens it, and in it one button per
 * picture. The screenshot opens its resolution form (owner 2026-11-20), the
 * ray trace PyMOL's own form, each once the panel has shut, so no dialog
 * stands over another. Either picture, made, is saved from the page's save
 * step (`SaveDialog`, owner 2026-11-17). While 3Dmol.js is shown the ray trace asks first, as
 * the export dialog's PyMOL entries do (UI consult, Claude Opus): a second
 * press switches to PyMOL and opens the form, which waits for it. An entry
 * that cannot be used now stays in the Tab order (`aria-disabled`, its
 * reason its description) and a press does nothing.
 *
 * `iconOnly` (the phone's header): the camera alone, the name its label.
 * `noDoc` (nothing open): the button stays reachable, its reason its
 * description, and a press says it (`onNoDoc`) instead of opening.
 */
export function ImageOutput(props: {
  items: readonly ExportItem<ImageItemId>[]
  /** Why nothing can be saved: nothing is open. */
  noDoc: string | null
  onNoDoc: () => void
  iconOnly: boolean
  /** `switchFirst`: the person agreed to switch to PyMOL for it. */
  onPick: (id: ImageItemId, switchFirst: boolean) => void
}) {
  const { items, noDoc, onNoDoc, iconOnly, onPick } = props
  const { t } = useTranslation('htmlExport')
  const base = useId()
  const noDocId = `${base}-nodoc`
  const [asking, setAsking] = useState<ImageItemId | null>(null)
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  // The question appears under the entry; the answer button takes focus.
  useEffect(() => {
    if (asking !== null) confirmRef.current?.focus()
  }, [asking])
  const name = t('htmlExport:sa_image_button')
  const refuse = (e: MouseEvent<HTMLElement>) => {
    if (noDoc === null) return
    e.preventDefault()
    onNoDoc()
  }
  return (
    <>
      <HeadDetails
        className="sav-image"
        summary={
          <>
            <CameraIcon />
            {!iconOnly && <span className="sav-btn-text">{name}</span>}
          </>
        }
        summaryProps={{
          'aria-label': name,
          title: name,
          'aria-disabled': noDoc !== null ? true : undefined,
          'aria-describedby': noDoc !== null ? noDocId : undefined,
          onClick: refuse,
        }}
        // A question left open is not there the next time.
        onOpenChange={open => {
          if (!open) setAsking(null)
        }}
      >
        {close => (
          <ul className="sav-image-list">
            {items.map(item => {
              const noteId = `${base}-${item.id}-note`
              const askId = `${base}-${item.id}-ask`
              const press = () => {
                if (item.blocked !== null) return
                if (item.switchTo !== null) {
                  setAsking(cur => (cur === item.id ? null : item.id))
                  return
                }
                close()
                onPick(item.id, false)
              }
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className="sav-image-item"
                    aria-disabled={item.blocked !== null ? true : undefined}
                    aria-describedby={noteId}
                    aria-expanded={item.switchTo !== null ? asking === item.id : undefined}
                    onClick={press}
                  >
                    <span className="sav-export-label">{t(LABEL[item.id].label)}</span>
                    {/* The ray trace is PyMOL's; the screenshot is the engine on screen's, so no tag. */}
                    {item.id === 'ray' && (
                      <span className="sav-tags">
                        {item.tags.map(e => (
                          <EngineTag key={e} engine={e} />
                        ))}
                      </span>
                    )}
                  </button>
                  <p id={noteId} className="sav-image-note">
                    {item.blocked !== null ? t(BLOCK[item.blocked]) : t(LABEL[item.id].note)}
                  </p>
                  {asking === item.id && item.switchTo !== null && (
                    <div className="sav-export-ask" role="group" aria-labelledby={askId}>
                      <p id={askId}>{t('htmlExport:sa_export_switch_why')}</p>
                      <button
                        ref={confirmRef}
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          close()
                          onPick(item.id, true)
                        }}
                      >
                        {t('htmlExport:sa_export_switch')}
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </HeadDetails>
      {noDoc !== null && (
        <span id={noDocId} className="sr-only">
          {noDoc}
        </span>
      )}
    </>
  )
}
