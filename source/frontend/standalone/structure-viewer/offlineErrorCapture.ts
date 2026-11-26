/**
 * The offline file's `src/utils/errorCapture` (aliases.ts): the same entry
 * point, reporting nowhere: errors stay in the page (it has no server, and
 * its CSP allows no connection).
 * The caller has already written the error to the console.
 */
export function reportBoundaryError(_error: unknown, _componentStack?: string): void {
  // Nothing to send to: see the header.
}
