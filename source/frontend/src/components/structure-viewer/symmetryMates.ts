/**
 * Symmetry mates: the copies of the deposited molecule that pack against it in
 * the crystal.
 *
 * A crystal is the asymmetric unit (what the file holds) repeated by the space
 * group's operators inside one unit cell, and that cell repeated by whole
 * lattice translations. The copies a crystallographer looks at are the ones in
 * CONTACT with the reference — in the same cell or across the periodic boundary
 * into a neighbouring one. So this module does not draw a fixed block of cells:
 * it visits every operator at every lattice translation that could possibly
 * reach the reference, and keeps the copies with at least one atom within
 * `cutoff` Å of it. A fixed 3×3×3 block would be both too much (up to 27 × Z
 * whole copies — 108 for P 2₁2₁2₁) and not reliably enough: the deposited
 * coordinates are often outside the [0, 1) cell, so the copies that touch the
 * molecule are not the ones "in the next cell over" by index.
 *
 * The operators arrive CARTESIAN (already converted, by whatever supplies
 * them, with the space-group table and the file's own fractionalisation
 * matrix), so everything here is
 * `R x + t + n_a a + n_b b + n_c c` in Å.
 *
 * Pure: no 3Dmol, no React. `useSymmetryMates` does the viewer side.
 */

export type Vec3 = [number, number, number]
type Mat3 = [Vec3, Vec3, Vec3]

/** The shape of an operator list, structurally — not the generated type. */
export interface CartesianOperator {
  triplet: string
  rotation: readonly (readonly number[])[]
  translation: readonly number[]
}

export interface CrystalFrame {
  /** Rows are the lattice vectors a, b, c in Cartesian Å. */
  lattice: readonly (readonly number[])[]
  operators: readonly CartesianOperator[]
}

export interface SymmetryCopy {
  /** Index into `CrystalFrame.operators`. */
  operator: number
  triplet: string
  /** Whole-cell translation along a, b, c. */
  shift: Vec3
  rotation: Mat3
  /** The operator's own translation plus the lattice shift, in Å. */
  translation: Vec3
  /** Centroid-to-centroid distance to the reference, in Å. */
  centroidDistance: number
}

export interface FindOptions {
  /** Contact distance in Å: a copy is kept if any of its atoms is this close. */
  cutoff: number
  /** Upper bound on copies returned; the nearest (by centroid) are kept. */
  maxCopies: number
  /** Wall-clock budget for the search, in ms; defaults to `SEARCH_TIME_BUDGET_MS`. */
  timeBudgetMs?: number
  /** Clock the budget is measured on; injectable so tests are deterministic. */
  now?: () => number
}

export interface FindResult {
  copies: SymmetryCopy[]
  /** More copies were in contact than `maxCopies` allowed. */
  truncated: boolean
  /**
   * Why no search result is given, or null when it is:
   * - `'frame'` — refused before searching: non-finite numbers, more operators
   *   than any space group has, or more lattice shifts than `MAX_CANDIDATES`.
   *   Only a degenerate or hostile frame gets here.
   * - `'time'` — the search ran out of its time budget. A hostile frame, or a
   *   real structure too large for this cutoff on this machine.
   * - `'crowded'` — refused before searching: more reference atoms in one
   *   contact cell than matter can pack there (`MAX_ATOMS_PER_CELL`). The
   *   coordinates are broken, not the cell, so this is neither of the above.
   */
  refused: 'frame' | 'time' | 'crowded' | null
}

/**
 * Cutoffs the toolbar offers. 4 Å is a direct contact (hydrogen bond / salt
 * bridge range), 8 Å the usual "packing neighbours" view, 12 Å the wider shell.
 */
export const MATE_CUTOFFS_A = [4, 8, 12] as const
export type MateCutoff = typeof MATE_CUTOFFS_A[number]
export const MATE_CUTOFF_DEFAULT: MateCutoff = 8

/** A persisted cutoff if it is one the toolbar offers, else null. */
export function sanitizeMateCutoff(value: unknown): MateCutoff | null {
  return (MATE_CUTOFFS_A as readonly unknown[]).includes(value) ? value as MateCutoff : null
}

// A lattice translation or operator this close to zero is the reference itself.
const IDENTITY_EPS = 1e-3

// The largest operator count of any space group. The viewer does not rely on
// the caller to keep to it: the frame comes from a structure file, and the
// search runs synchronously in the page.
const MAX_OPERATORS = 192

/**
 * Upper bound on (operators × lattice shifts) visited. Real crystals need far
 * fewer: the densest protein case, 96 operators at ±4 cells, is ~70 000. A
 * flat cell (angles 120/120/120) drives the per-axis span to ~10⁷ and the
 * product past 10²³, which is the freeze this bound exists to refuse.
 */
const MAX_CANDIDATES = 500_000

/**
 * Wall-clock budget for the synchronous contact search.
 *
 * A TIME budget, not a count of operations: the time one unit of work takes
 * depends on the reference's shape (PR #2305 review, round 3), so only a
 * deadline bounds the freeze itself, whatever the shape. The real structures
 * measured for this PR finish in at most 18 ms, so a real structure needs
 * ~25x its heaviest case before it is refused.
 */
export const SEARCH_TIME_BUDGET_MS = 500

// How much work the contact loop does between two clock reads: atoms of the
// copy visited plus reference atoms distance-checked inside `near()`. Counting
// only the copy's atoms (PT-1070 item 3) let one `near()` over a crowded
// bucket run for seconds between two reads.
const CLOCK_EVERY = 1024

/**
 * Most reference atoms one contact cell (an edge of `cutoff` Å, at least
 * 4 Å) may hold. Bonded atoms are about 1 Å apart, so a 64 Å³ cell holds a
 * few dozen at most; 4096 leaves room for hash collisions and alternate
 * conformations, and bounds one `near()` to 27 × 4096 distance checks.
 */
const MAX_ATOMS_PER_CELL = 4096

const refused = (why: 'frame' | 'time' | 'crowded'): FindResult => ({ copies: [], truncated: false, refused: why })

function frameIsFinite(frame: CrystalFrame): boolean {
  const finite = (values: readonly number[]) => values.length === 3 && values.every(Number.isFinite)
  return frame.lattice.every(finite)
    && frame.operators.every(op => op.rotation.length === 3 && op.rotation.every(finite) && finite(op.translation))
}

function toMat3(m: readonly (readonly number[])[]): Mat3 {
  return [
    [m[0][0], m[0][1], m[0][2]],
    [m[1][0], m[1][1], m[1][2]],
    [m[2][0], m[2][1], m[2][2]],
  ]
}

function apply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ]
}

function invert(m: Mat3): Mat3 | null {
  const [[a, b, c], [d, e, f], [g, h, i]] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null
  const s = 1 / det
  return [
    [A * s, -(b * i - c * h) * s, (b * f - c * e) * s],
    [B * s, (a * i - c * g) * s, -(a * f - c * d) * s],
    [C * s, -(a * h - b * g) * s, (a * e - b * d) * s],
  ]
}

function isIdentity(m: Mat3): boolean {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (Math.abs(m[r][c] - (r === c ? 1 : 0)) > IDENTITY_EPS) return false
    }
  }
  return true
}

/**
 * A uniform grid over the reference atoms, cell edge = cutoff, so a contact
 * query only ever looks at the 27 cells around a point.
 *
 * The key is a hash, not a unique id: a collision only puts extra candidates
 * in a bucket, and every candidate is distance-checked, so it can cost time
 * but never a wrong answer.
 */
class ContactGrid {
  private readonly buckets = new Map<number, number[]>()
  /** Atoms in the fullest bucket. */
  readonly largest: number
  /** Reference atoms distance-checked so far, over every query: work for the clock. */
  scanned = 0

  constructor(private readonly coords: ArrayLike<number>, private readonly cell: number) {
    for (let i = 0; i < coords.length / 3; i++) {
      const key = this.key(this.index(coords[3 * i]), this.index(coords[3 * i + 1]), this.index(coords[3 * i + 2]))
      const bucket = this.buckets.get(key)
      if (bucket) bucket.push(i)
      else this.buckets.set(key, [i])
    }
    let largest = 0
    for (const bucket of this.buckets.values()) largest = Math.max(largest, bucket.length)
    this.largest = largest
  }

  private index(v: number): number {
    return Math.floor(v / this.cell)
  }

  private key(ix: number, iy: number, iz: number): number {
    return ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) | 0
  }

  /** Is any reference atom within `cell` Å of (x, y, z)? */
  near(x: number, y: number, z: number): boolean {
    const r2 = this.cell * this.cell
    const ix = this.index(x)
    const iy = this.index(y)
    const iz = this.index(z)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = this.buckets.get(this.key(ix + dx, iy + dy, iz + dz))
          if (!bucket) continue
          for (const j of bucket) {
            this.scanned++
            const ex = this.coords[3 * j] - x
            const ey = this.coords[3 * j + 1] - y
            const ez = this.coords[3 * j + 2] - z
            if (ex * ex + ey * ey + ez * ez <= r2) return true
          }
        }
      }
    }
    return false
  }
}

/**
 * The symmetry copies in contact with the reference.
 *
 * `coords` is the reference's atoms as a flat `[x0, y0, z0, x1, …]` array —
 * the atoms that will also be copied, so "in contact" is decided on exactly
 * what is drawn.
 *
 * Candidate translations per operator: the copy's centroid is first brought
 * to the nearest lattice image of the reference centroid, then every shift
 * whose centroid lies within `2 r + cutoff` of the reference is visited, `r`
 * being the reference's radius about its centroid. Two copies of one molecule
 * cannot touch unless their centroids are that close, so this is exhaustive,
 * and the per-axis range comes from the same bound, so a molecule larger than
 * its cell still reaches every copy it touches.
 */
export function findSymmetryMates(
  coords: ArrayLike<number>,
  frame: CrystalFrame,
  options: FindOptions,
): FindResult {
  const n = Math.floor(coords.length / 3)
  const { cutoff, maxCopies } = options
  const now = options.now ?? (() => performance.now())
  // A non-finite or non-positive budget would disable the bound (x > NaN is
  // always false), so anything but a real positive number means the default.
  const budget = options.timeBudgetMs !== undefined && Number.isFinite(options.timeBudgetMs) && options.timeBudgetMs > 0
    ? options.timeBudgetMs
    : SEARCH_TIME_BUDGET_MS
  if (n === 0 || !(cutoff > 0) || maxCopies <= 0) {
    return { copies: [], truncated: false, refused: null }
  }
  if (frame.lattice.length !== 3 || frame.operators.length > MAX_OPERATORS || !frameIsFinite(frame)) {
    return refused('frame')
  }

  // Lattice vectors as COLUMNS: cart = L @ frac.
  const rows = toMat3(frame.lattice)
  const L: Mat3 = [
    [rows[0][0], rows[1][0], rows[2][0]],
    [rows[0][1], rows[1][1], rows[2][1]],
    [rows[0][2], rows[1][2], rows[2][2]],
  ]
  const Linv = invert(L)
  if (!Linv) return refused('frame')

  const centroid: Vec3 = [0, 0, 0]
  const lo: Vec3 = [Infinity, Infinity, Infinity]
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = coords[3 * i + k]
      centroid[k] += v
      if (v < lo[k]) lo[k] = v
      if (v > hi[k]) hi[k] = v
    }
  }
  for (let k = 0; k < 3; k++) centroid[k] /= n
  let radius = 0
  for (let i = 0; i < n; i++) {
    const dx = coords[3 * i] - centroid[0]
    const dy = coords[3 * i + 1] - centroid[1]
    const dz = coords[3 * i + 2] - centroid[2]
    radius = Math.max(radius, Math.hypot(dx, dy, dz))
  }
  const reach = 2 * radius + cutoff
  const halfExtent: Vec3 = [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2]
  const boxCentre: Vec3 = [(hi[0] + lo[0]) / 2, (hi[1] + lo[1]) / 2, (hi[2] + lo[2]) / 2]
  // |f_i| <= ||row_i(L^-1)|| * |x|, so this many cells along axis i cover `reach`.
  const span: Vec3 = [0, 1, 2].map(i => Math.ceil(reach * Math.hypot(...Linv[i]))) as Vec3
  // Decided BEFORE the loops: the enumeration below is synchronous, so a
  // bound checked inside it would already have frozen the tab.
  const candidates = frame.operators.length * span.reduce((product, s) => product * (2 * s + 1), 1)
  if (!Number.isFinite(candidates) || candidates > MAX_CANDIDATES) return refused('frame')

  const grid = new ContactGrid(coords, cutoff)
  if (grid.largest > MAX_ATOMS_PER_CELL) return refused('crowded')
  // Started after the O(n) grid build, which is bounded by the atom count.
  const deadline = now() + budget
  const found: SymmetryCopy[] = []

  // A plain loop, not forEach: the budget check below must be able to
  // return from the whole search, and a return inside a forEach callback
  // only ends that one operator.
  for (let opIndex = 0; opIndex < frame.operators.length; opIndex++) {
    const op = frame.operators[opIndex]
    const R = toMat3(op.rotation)
    const t: Vec3 = [op.translation[0], op.translation[1], op.translation[2]]
    const opCentroid = apply(R, centroid).map((v, k) => v + t[k]) as Vec3
    const toRef = apply(Linv, [centroid[0] - opCentroid[0], centroid[1] - opCentroid[1], centroid[2] - opCentroid[2]])
    const base = toRef.map(Math.round) as Vec3
    const identityRotation = isIdentity(R)
    // Where the reference's bounding box lands under R (before translation):
    // an axis-aligned box around a rotated box has half-extent |R| · h.
    const rotatedCentre = apply(R, boxCentre)
    const rotatedHalf = [0, 1, 2].map(r =>
      Math.abs(R[r][0]) * halfExtent[0] + Math.abs(R[r][1]) * halfExtent[1] + Math.abs(R[r][2]) * halfExtent[2],
    )

    for (let na = base[0] - span[0]; na <= base[0] + span[0]; na++) {
      for (let nb = base[1] - span[1]; nb <= base[1] + span[1]; nb++) {
        for (let nc = base[2] - span[2]; nc <= base[2] + span[2]; nc++) {
          const shift = apply(L, [na, nb, nc])
          const T: Vec3 = [t[0] + shift[0], t[1] + shift[1], t[2] + shift[2]]
          if (identityRotation && Math.hypot(...T) < IDENTITY_EPS) continue // the reference itself
          const cd = Math.hypot(opCentroid[0] + shift[0] - centroid[0], opCentroid[1] + shift[1] - centroid[1], opCentroid[2] + shift[2] - centroid[2])
          if (cd > reach) continue
          // Boxes that are more than `cutoff` apart on any axis cannot touch.
          let separated = false
          for (let k = 0; k < 3 && !separated; k++) {
            const gap = Math.abs(rotatedCentre[k] + T[k] - boxCentre[k]) - rotatedHalf[k] - halfExtent[k]
            if (gap > cutoff) separated = true
          }
          if (separated) continue
          const contact = touches(coords, n, R, T, lo, hi, cutoff, grid, deadline, now)
          if (contact === 'timeout') return refused('time')
          if (contact === 'miss') continue
          found.push({ operator: opIndex, triplet: op.triplet, shift: [na, nb, nc], rotation: R, translation: T, centroidDistance: cd })
        }
      }
    }
  }

  // Nearest first, so a cap drops the most distant copies; the tie-breaks only
  // make the order deterministic.
  found.sort((p, q) =>
    p.centroidDistance - q.centroidDistance
    || p.operator - q.operator
    || p.shift[0] - q.shift[0] || p.shift[1] - q.shift[1] || p.shift[2] - q.shift[2],
  )
  return { copies: found.slice(0, maxCopies), truncated: found.length > maxCopies, refused: null }
}

function touches(
  coords: ArrayLike<number>,
  n: number,
  R: Mat3,
  T: Vec3,
  lo: Vec3,
  hi: Vec3,
  cutoff: number,
  grid: ContactGrid,
  deadline: number,
  now: () => number,
): 'hit' | 'miss' | 'timeout' {
  // The clock is read at the start of every shift and again whenever
  // CLOCK_EVERY units of work have passed — copy atoms visited plus reference
  // atoms checked inside near() — so the overshoot is at most that much work
  // plus one near() call, which MAX_ATOMS_PER_CELL bounds; the caller then
  // refuses the whole search.
  const scannedBefore = grid.scanned
  let readAt = 0
  for (let i = 0; i < n; i++) {
    const work = i + grid.scanned - scannedBefore
    if (work >= readAt) {
      if (now() > deadline) return 'timeout'
      readAt = work + CLOCK_EVERY
    }
    const x = coords[3 * i]
    const y = coords[3 * i + 1]
    const z = coords[3 * i + 2]
    const qx = R[0][0] * x + R[0][1] * y + R[0][2] * z + T[0]
    if (qx < lo[0] - cutoff || qx > hi[0] + cutoff) continue
    const qy = R[1][0] * x + R[1][1] * y + R[1][2] * z + T[1]
    if (qy < lo[1] - cutoff || qy > hi[1] + cutoff) continue
    const qz = R[2][0] * x + R[2][1] * y + R[2][2] * z + T[2]
    if (qz < lo[2] - cutoff || qz > hi[2] + cutoff) continue
    if (grid.near(qx, qy, qz)) return 'hit'
  }
  return 'miss'
}

/**
 * Per-atom viewer state that must NOT follow an atom into a copy.
 *
 * 3Dmol's `addAtoms` copies every enumerable property, so a spread would hand
 * the copy the reference atom's style OBJECT (the two would then restyle each
 * other), its click registration and its model id.
 */
const VIEWER_STATE_KEYS = [
  'style', 'model', 'clickable', 'callback', 'hoverable', 'hover_callback', 'unhover_callback', 'intersectionShape',
] as const

/**
 * One copy's atoms: positions moved, everything else — element, residue,
 * chain, secondary structure, bond indices — kept, so 3Dmol draws the copy's
 * cartoon and bonds exactly as it draws the reference's.
 *
 * Bond indices stay valid because `addAtoms` maps them within ONE call; the
 * caller must therefore add each copy with its own `addAtoms`.
 */
export function copyAtoms<T extends { x: number; y: number; z: number }>(atoms: readonly T[], copy: SymmetryCopy): T[] {
  const R = copy.rotation
  const [tx, ty, tz] = copy.translation
  return atoms.map(atom => {
    const out: Record<string, unknown> = { ...atom }
    for (const key of VIEWER_STATE_KEYS) delete out[key]
    out.x = R[0][0] * atom.x + R[0][1] * atom.y + R[0][2] * atom.z + tx
    out.y = R[1][0] * atom.x + R[1][1] * atom.y + R[1][2] * atom.z + ty
    out.z = R[2][0] * atom.x + R[2][1] * atom.y + R[2][2] * atom.z + tz
    return out as T
  })
}
