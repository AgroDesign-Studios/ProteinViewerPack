/**
 * What the structure file holds, in words, for a browser that cannot draw
 * (no WebGL): each chain's residue count and the ligands' names, read from
 * the mmCIF `_atom_site` loop of model 1. Text only — the page shows it with
 * React, never as markup.
 */
const WATER = new Set(['HOH', 'WAT', 'DOD'])

export interface CifSummary {
  chains: { chain: string; residues: number }[]
  ligands: string[]
}

export function cifSummary(text: string): CifSummary {
  const lines = text.split(/\r?\n/)
  const cols: string[] = []
  const rows: string[][] = []
  let inLoop = false
  let started = false
  for (const line of lines) {
    if (line.startsWith('_atom_site.')) {
      cols.push(line.slice(11).trim())
      inLoop = true
      continue
    }
    if (!inLoop) continue
    if (/^(ATOM|HETATM)\s/.test(line)) {
      rows.push(line.match(/'[^']*'|"[^"]*"|\S+/g) ?? [])
      started = true
    } else if (started && (line.startsWith('#') || line.startsWith('_') || line.startsWith('loop_'))) break
  }
  // A Map, never an object keyed by column names from the file.
  const ix = new Map<string, number>()
  cols.forEach((c, k) => ix.set(c, k))
  const col = (r: string[], a: string, b?: string): string => {
    const k = ix.get(a) ?? (b === undefined ? undefined : ix.get(b))
    return k === undefined ? '' : String(r[k] ?? '').replace(/^['"]|['"]$/g, '')
  }
  const chains = new Map<string, Set<string>>()
  const ligands = new Set<string>()
  const groupAt = ix.get('group_PDB')
  for (const r of rows) {
    const model = col(r, 'pdbx_PDB_model_num')
    if (model && model !== '1' && model !== '?') continue
    const ch = col(r, 'auth_asym_id', 'label_asym_id')
    const seq = col(r, 'auth_seq_id', 'label_seq_id')
    const resn = col(r, 'auth_comp_id', 'label_comp_id')
    if (groupAt !== undefined && r[groupAt] === 'HETATM') {
      if (!WATER.has(resn)) ligands.add(resn)
    } else {
      let set = chains.get(ch)
      if (set === undefined) chains.set(ch, (set = new Set()))
      set.add(seq + col(r, 'pdbx_PDB_ins_code').replace(/^[?.]$/, ''))
    }
  }
  return { chains: [...chains].map(([chain, set]) => ({ chain, residues: set.size })), ligands: [...ligands] }
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

/**
 * Why PyMOL cannot run in this browser, or null when it can. The phone
 * mode's engine choice says it before PyMOL is chosen (owner 2026-11-14):
 * PyMOL draws with WebGL2 into a canvas its worker owns
 * (`transferControlToOffscreen`), and an older phone browser has neither.
 * `no-worker-gl`: the canvas can be handed over, but a worker gets no WebGL
 * for it (Safari before 17 has OffscreenCanvas with 2D only) — found by
 * `workerGlAvailable`, after the page's own checks.
 */
export type PymolBlocker = 'no-webgl2' | 'no-offscreen' | 'no-worker-gl'

/** The probe worker's script: WebGL2, else WebGL 1, as worker.js's `makeGL` asks for it. */
const WORKER_GL_PROBE =
  'var ok = false;\n' +
  'try {\n' +
  '  var c = new OffscreenCanvas(1, 1), gl = c.getContext("webgl2") || c.getContext("webgl");\n' +
  '  if (gl) { ok = true; var x = gl.getExtension("WEBGL_lose_context"); if (x) x.loseContext(); }\n' +
  '} catch (e) {}\n' +
  'postMessage(ok);\n'
/** A probe that has not answered by then says nothing either way. */
export const WORKER_GL_PROBE_MS = 10_000

let workerGl: Promise<boolean | null> | null = null

/**
 * Whether a worker can draw with WebGL into an OffscreenCanvas, as PyMOL's
 * worker does: true or false, or null when the probe could not tell (no
 * Worker, no answer) — PyMOL then starts and says what it meets. Only a
 * `true` is kept for the page: the probe makes a WebGL context, and one more
 * beside running viewers can fail (PT-9194 item 4); but a `false` or `null`
 * may be passing (the GPU process busy or restarting, memory short), so the
 * next ask — PyMOL's Retry, the phone's engine choice opened again — probes
 * afresh (PT-9307 item 2). Calls while a probe runs share it. The callers
 * ask only before PyMOL makes a context of its own: the bridge before its
 * worker starts, the phone's engine choice while PyMOL is off or failed.
 */
export function workerGlAvailable(): Promise<boolean | null> {
  workerGl ??= probeWorkerGl().then(v => {
    if (v !== true) workerGl = null
    return v
  })
  return workerGl
}

function probeWorkerGl(): Promise<boolean | null> {
  return new Promise<boolean | null>(resolve => {
    let url: string | null = null
    let w: Worker | null = null
    const done = (v: boolean | null) => {
      clearTimeout(timer)
      try {
        w?.terminate()
      } catch {
        // Already gone.
      }
      if (url !== null) URL.revokeObjectURL(url)
      resolve(v)
    }
    // A main thread blocked past the deadline may run this before an answer
    // that had already come (PT-9309 item 6): null is the safe side (PyMOL
    // starts and says what it meets) and is not kept, so the next ask probes.
    const timer = setTimeout(() => done(null), WORKER_GL_PROBE_MS)
    try {
      url = URL.createObjectURL(new Blob([WORKER_GL_PROBE], { type: 'text/javascript' }))
      w = new Worker(url)
      w.onmessage = e => done(e.data === true)
      w.onerror = () => done(null)
    } catch {
      done(null)
    }
  })
}

/** Forgets the probe's answer (tests only). */
export function resetWorkerGlProbe(): void {
  workerGl = null
}

export function pymolBlocker(): PymolBlocker | null {
  if (typeof Worker === 'undefined' || typeof HTMLCanvasElement === 'undefined' || !('transferControlToOffscreen' in HTMLCanvasElement.prototype)) {
    return 'no-offscreen'
  }
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return 'no-webgl2'
    // The probe's context is let go at once; PyMOL makes its own.
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return null
  } catch {
    return 'no-webgl2'
  }
}
