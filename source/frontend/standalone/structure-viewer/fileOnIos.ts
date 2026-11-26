/**
 * Is this page a file opened directly on an iPhone or iPad (PT-9781)?
 *
 * Some iOS browsers refuse network requests from a page opened from a file.
 * No opening path on iOS is documented to give such a page the network, so
 * the words this feeds say "may not be able to", never "cannot".
 *
 * Only the context is read — no request is made to find out, because the
 * app connects only when a button asks it to (HELP's 「オフラインで動く」).
 * A page not served over http(s) counts as opened from a file: `file:` as
 * WebKit loads it, or another scheme an iOS browser may show it under. Every
 * iOS browser is WebKit, so the device decides, not the browser: an
 * iPhone/iPad/iPod user agent, or iPadOS's desktop one (a Mac's, with more
 * than one touch point — a Mac has none). `isTouchDevice` is not this: a
 * touch-screen PC is no iPad.
 */
export function isFileOnIos(
  loc: Pick<Location, 'protocol'> | undefined = typeof location === 'undefined' ? undefined : location,
  nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): boolean {
  if (loc === undefined || nav === undefined) return false
  if (loc.protocol === 'http:' || loc.protocol === 'https:') return false
  const ua = nav.userAgent ?? ''
  return /\b(iPhone|iPad|iPod)\b/.test(ua) || (/\bMacintosh\b/.test(ua) && (nav.maxTouchPoints ?? 0) > 1)
}
