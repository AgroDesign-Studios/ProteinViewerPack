/**
 * Pages made from a built standalone template, beside it — the structure
 * viewer's blank Protein Viewer Pack pages (protein-viewer-pages.ts
 * `proteinViewerPages`). A plugin that serves and emits a template takes
 * them in this shape.
 *
 * A file of its own so protein-viewer-pages.ts can name the shape without
 * importing the serving plugin, which is not part of the viewer's published
 * source (PT-9911).
 */
export interface DerivedPages {
  /** Says which page an error or a log line is about. */
  label: string
  /** The served paths; `vite build` emits each (without its slash). */
  paths: readonly string[]
  /** One page's body as parts, joined on the wire, made from the template's HTML; `root` is Vite's. */
  render(template: string, servedPath: string, root: string): Promise<string[]>
  /**
   * True for a changed file a page is made from beside the template (Vite's
   * watcher reports it; `root` is Vite's). Every page is then made again,
   * after an `invalidate()`.
   */
  affects?(root: string, file: string): boolean
  /** Forgets what the pages are made from beside the template (called when `affects` said so). */
  invalidate?(): void
}
