/**
 * A yes kept in this browser's localStorage ('1'), for the app's own "done
 * once" marks: the notice turned off for good, the first-run guide seen.
 * Storage may be refused (a private window, file:// in some browsers): then
 * the mark reads no and is not kept, and the app asks again at the next visit.
 */
export function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

/** Keep the mark; refused storage keeps nothing (see `readFlag`). */
export function writeFlag(key: string): void {
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    // Not kept: asked again at the next visit.
  }
}
