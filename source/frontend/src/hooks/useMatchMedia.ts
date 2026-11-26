import { useCallback, useSyncExternalStore } from 'react'

// `typeof`, not `in`: jsdom declares `window.matchMedia` as an accessor that returns
// undefined, so `'matchMedia' in window` is true where the function does not exist.
const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

/** Live `window.matchMedia(query).matches`; false where matchMedia does not exist (and
 *  on the server). Re-renders only when the query's answer flips. */
export function useMatchMedia(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (!hasMatchMedia()) return () => {}
    const mql = window.matchMedia(query)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return useSyncExternalStore(subscribe, () => hasMatchMedia() && window.matchMedia(query).matches, () => false)
}
