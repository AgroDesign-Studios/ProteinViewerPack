import type { MolFormat, RaySettings } from './pymolFrameProtocol'

/**
 * What an export asks of a PyMOL frame: the export request and its stop, as
 * a type of its own.
 *
 * The export dialog, the molecule export and the offline structure file's
 * export hub name this type, never a frame implementation, so each frame
 * that implements it can be passed in (PT-9911).
 */
export interface PymolExportFrame {
  requestExport(kind: 'png', opts: { ray: boolean; w: number; h: number; settings?: RaySettings }): Promise<{ kind: 'png'; bytes: ArrayBuffer; w: number; h: number }>
  requestExport(kind: 'pse', opts?: { signal?: AbortSignal; onSent?: () => void }): Promise<{ kind: 'pse'; bytes: ArrayBuffer }>
  requestExport(kind: 'mol', opts: { format: MolFormat; selection: string; signal?: AbortSignal; onSent?: () => void }): Promise<{ kind: 'mol'; bytes: ArrayBuffer }>
  requestExport(kind: 'look', opts?: { signal?: AbortSignal }): Promise<{ kind: 'look'; bytes: ArrayBuffer }>
  /** Stop the command or export in flight; whether there was one to stop. */
  cancel(): boolean
}
