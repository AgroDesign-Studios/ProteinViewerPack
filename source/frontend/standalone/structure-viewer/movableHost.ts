import { useEffect, useState } from 'react'

/**
 * One element for content whose state must outlive where it is shown: the
 * caller renders into it once (`createPortal`), and this hook moves the
 * element into `slot` — or out of the document while there is no slot —
 * without React unmounting what is inside.
 *
 * The phone mode's PyMOL command line is the case (PT-9192 item 6, PT-9193
 * item 3, PT-9194 item 1): its slot is the 「表示」 sheet, which closes, or
 * the pane's foot wider than a phone. Unmounted with the sheet, it dropped
 * the pasted lines still queued without a word and lost its history and the
 * line being typed; moved, it keeps them all, and goes on sending while the
 * sheet is closed. `display: contents` (standalone.css `.sav-movable`): the
 * element itself takes no part in the slot's layout.
 */
export function useMovableHost(slot: HTMLElement | null): HTMLDivElement {
  const [host] = useState(() => {
    const el = document.createElement('div')
    el.className = 'sav-movable'
    return el
  })
  useEffect(() => {
    if (slot === null) {
      host.remove()
      return
    }
    slot.appendChild(host)
    return () => host.remove()
  }, [host, slot])
  return host
}
