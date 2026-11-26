/**
 * The error a PyMOL frame's request rejects with. A module of its own, as
 * `WITHDRAWN` has in `pymolBusy.ts`: the export dialog's tests make one
 * without loading a frame controller (PT-9911).
 */
export class PymolFrameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PymolFrameError'
  }
}
