/**
 * The geometry behind a filled cross-section — the "cap" that closes the cut
 * face so a sliced molecular surface reads as solid instead of hollow.
 *
 * WHY THIS EXISTS AT ALL. `viewer.setSlab()` moves the camera's near/far
 * clipping planes (`GLViewer.setSlabAndFog`), so the GPU discards whole
 * triangles before rasterisation and no fragment ever survives at the cut. The
 * molecular surface is a zero-thickness closed shell, so what remains on screen
 * is its lit inner wall. No 3Dmol style option changes that: the surface
 * material is already `MeshDoubleLambertMaterial`, i.e. back faces are lit
 * today. There is also no stencil buffer (3Dmol requests a context without one)
 * and no model-space clip plane anywhere in its shaders. The only way to fill
 * the cut is to compute the cap as ordinary geometry and hand it back — which is
 * exactly what UCSF ChimeraX does (`surface/capper.cpp`: `calculate_border()`
 * then `triangulate_polygon()`). This module follows that approach; it is
 * written for AgDB, not translated from ChimeraX's code (compared with
 * border.cpp / capper.cpp on 2026-11-18: no structure, helper, data type or
 * comment carried over; only the name `calculateBorder` and the drop of an
 * unclosed trace, credited below — `buildCapMesh` also names ChimeraX's like
 * setting for the cap's inset), and triangulates with `earcut`. HELP's
 * 「改良点」's document says the same (CODE-CHANGES.md at the repository root).
 *
 * This file is PURE: no 3Dmol import, no DOM, no React. It takes vertex/face
 * arrays and a plane and returns vertex/face arrays. The 3Dmol side —
 * where the plane comes from, and how the result becomes a shape — is
 * `sectionCap.ts`. Splitting them is what lets the hard part be tested against
 * shapes whose answer is known by hand (`capGeometry.test.ts`).
 */

import earcut from 'earcut'

/** A point or direction in model space. */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/**
 * One 3Dmol `GeometryGroup`, narrowed to what capping reads.
 *
 * Structural rather than `any` so a 3Dmol upgrade that renames one of these
 * four fields fails at `tsc` instead of silently producing an empty cap.
 */
export interface SurfaceGeometryGroup {
  vertexArray: Float32Array | null
  faceArray: Uint16Array | null
  /** Vertex COUNT, not a length — `vertexArray` is over-allocated. */
  vertices: number
  /** Index count, likewise: `faceArray` has slack past this. */
  faceidx: number
}

/** A surface mesh with its duplicate vertices merged and one index space. */
export interface WeldedMesh {
  x: Float64Array
  y: Float64Array
  z: Float64Array
  /** Flat triples of indices into x/y/z. */
  tri: Int32Array
  /** Vertices before welding — the sum of the groups' own counts. */
  rawVertices: number
  triangles: number
}

/** What a cap build produced, and how confident it is. */
export interface CapStats {
  /** Closed boundary loops found on the plane. */
  loops: number
  /** Of those, the ones that bound material (the rest are holes). */
  outers: number
  holes: number
  capTriangles: number
  /**
   * Boundary chains that did not close on their own.
   *
   * Not a defect on our side: 3Dmol splits any bounding box over
   * `maxVolume = 64000 A^3` into sub-boxes marched by separate workers on
   * independent grids (`GLViewer.carveUpExtent`), so a large protein's surface
   * is several meshes whose seam vertices do not coincide. Ubiquitin is one box
   * and yields 0; GroEL (58,870 atoms, 488,850 triangles) is many and yields 45,
   * closed by 40 joins whose longest is 1.011 A.
   */
  openChains: number
  /** Joins made between open chains, and the longest one, in angstroms. */
  stitches: number
  maxStitchA: number
  /**
   * Boundary points that more than one triangle claims, in either direction.
   *
   * Counted BOTH ways on purpose. An earlier version counted only points two
   * triangles leave FROM while its docstring described the other case, so the
   * anomaly that actually truncates a walk — two triangles arriving at one
   * point — was the one nothing counted. Either means the boundary is locally
   * ambiguous and an island may be missing from the cut face.
   */
  conflicts: number
  /**
   * Rings that could not be closed within the stitch tolerance, and their area.
   *
   * A dropped ring leaves a real hole in the cut face. That is the lesser evil:
   * the alternative is a chord across whatever gap remained, which ADDS geometry
   * the mesh never supported and draws it at the same opacity and colour as the
   * parts that are correct. ChimeraX takes the same view — `border.cpp` erases a
   * trace that does not close, and the Chimera docs say a surface with a boundary
   * "may form a non-closed curve, which will not be capped".
   */
  droppedLoops: number
  droppedAreaA2: number
  /**
   * The cut face was abandoned: it could not be built honestly.
   *
   * Three reasons, and `refusedReason` says which. Either way `indices` is
   * empty and the caller leaves the cut hollow — a picture the user already
   * knows how to read. A partial cap is its own lie: a hole in a filled
   * cross-section reads as "solvent here" exactly as confidently as a chord
   * reads as "protein here".
   */
  refused: boolean
  refusedReason: 'none' | 'area' | 'cavity' | 'corrupt'
  /**
   * Triangulated area against the loops' own analytic area, as a percentage.
   *
   * The one end-to-end check on the whole pipeline: it is 0 when the cut face
   * has neither a gap nor an overlap, and it catches a wrong hole assignment,
   * a dropped ring and a self-intersecting ear in a single number.
   *
   * It is also a GATE, not only a report — see `MAX_AREA_ERROR_PCT`. Computing
   * an integrity signal and then drawing the geometry anyway is worse than not
   * computing it: the number goes into `stats`, reads as a certificate, and
   * nothing is stopped by it.
   */
  areaErrorPct: number
}

/** A cap ready to be handed to a renderer, in model coordinates. */
export interface CapMesh {
  positions: Float32Array
  normals: Float32Array
  /** Flat triples of indices into positions/normals. */
  indices: number[]
  stats: CapStats
}

/**
 * Merge one surface's geometry groups into a single indexed mesh.
 *
 * The weld is not an optimisation — it is what makes the boundary walk possible.
 * 3Dmol duplicates vertices twice over: `splitMesh` divides a mesh at the 16-bit
 * index limit, and `carveUpExtent` marches large structures as separate boxes.
 * Both leave coincident vertices in different groups, and a boundary loop that
 * crosses one of those seams cannot be followed through unmerged indices.
 *
 * Keys are EXACT coordinates, not rounded ones: the duplicates are copies of the
 * same float, so exact matching joins every one of them, while a rounded key
 * would also merge genuinely distinct vertices that happen to fall in the same
 * bucket. Cost is one pass and one map entry per vertex — about 50 ms for a
 * typical single-domain protein and 340 ms for GroEL, which is why callers build this
 * lazily and cache it per surface rather than on every surface build.
 */
export function weldSurfaceMesh(groups: readonly SurfaceGeometryGroup[]): WeldedMesh {
  const index = new Map<string, number>()
  const xs: number[] = []
  const ys: number[] = []
  const zs: number[] = []
  const tris: number[] = []
  let rawVertices = 0

  for (const group of groups) {
    const va = group.vertexArray
    const fa = group.faceArray
    if (!va || !fa) continue
    let vertexCount = group.vertices | 0
    const indexCount = group.faceidx | 0
    if (vertexCount <= 0 || indexCount <= 0) continue
    // `vertices` is a COUNT the group carries, not the array's length. Trusting
    // it past the array's end reads `undefined`, which becomes NaN coordinates
    // and then a cut face at no describable position.
    vertexCount = Math.min(vertexCount, Math.floor(va.length / 3))
    if (vertexCount <= 0) continue
    rawVertices += vertexCount

    const localToGlobal = new Int32Array(vertexCount)
    for (let i = 0; i < vertexCount; i++) {
      const x = va[i * 3]
      const y = va[i * 3 + 1]
      const z = va[i * 3 + 2]
      const key = `${x},${y},${z}`
      let at = index.get(key)
      if (at === undefined) {
        at = xs.length
        index.set(key, at)
        xs.push(x)
        ys.push(y)
        zs.push(z)
      }
      localToGlobal[i] = at
    }
    for (let i = 0; i + 2 < indexCount; i += 3) {
      const a = fa[i]
      const b = fa[i + 1]
      const c = fa[i + 2]
      // A group can carry indices past its own vertex count only if the arrays
      // disagree; dropping such a triangle is strictly better than reading a
      // neighbouring vertex and drawing a boundary edge that does not exist.
      if (a >= vertexCount || b >= vertexCount || c >= vertexCount) continue
      tris.push(localToGlobal[a], localToGlobal[b], localToGlobal[c])
    }
  }

  return {
    x: Float64Array.from(xs),
    y: Float64Array.from(ys),
    z: Float64Array.from(zs),
    tri: Int32Array.from(tris),
    rawVertices,
    triangles: tris.length / 3,
  }
}

/** A boundary walk's raw output: the points on the plane and the loops they form. */
interface Border {
  px: number[]
  py: number[]
  pz: number[]
  loops: number[][]
  /** Rings the stitch tolerance refused to close; the caller measures their area. */
  dropped: number[][]
  openChains: number
  stitches: number
  maxStitchA: number
  conflicts: number
}

/**
 * Intersect the mesh with `dot(p, n) = offset` and chain the pieces into loops.
 *
 * The half-space kept is `dot(p, n) <= offset` — the side away from the camera,
 * i.e. what survives the near clipping plane. Fixing the kept side is what gives
 * each boundary segment a direction, and therefore what makes a loop bounding
 * material come out counter-clockwise seen from the cap's own normal.
 *
 * Two details decide whether this works at all on a real protein:
 *
 * 1. **An intersection point is keyed by the EDGE it lies on**, so the two
 *    triangles sharing that edge always land on the same point and chaining is
 *    exact integer matching. When the crossing falls exactly ON a vertex the key
 *    becomes that vertex instead — the neighbouring triangle reaches the same
 *    place through a DIFFERENT edge, and edge keys alone would split the loop
 *    there.
 * 2. **The walk starts at points nothing points to.** Starting mid-chain instead
 *    turns each genuine seam into several apparent breaks: it was measured to
 *    turn GroEL's 2 real seams into 45, and drew a straight chord across the cut
 *    face for each one.
 */
function calculateBorder(
  mesh: WeldedMesh,
  normal: Vec3,
  offset: number,
  maxStitchA: number,
): Border {
  const { x, y, z, tri } = mesh
  const vertexCount = x.length
  const distance = new Float64Array(vertexCount)
  for (let i = 0; i < vertexCount; i++) {
    distance[i] = x[i] * normal.x + y[i] * normal.y + z[i] * normal.z - offset
  }

  // A vertex exactly on the plane is nudged to the KEPT side. Left at zero it
  // makes its triangle both crossing and not crossing depending on which edge is
  // asked, which is how a loop acquires a dangling end.
  const EPSILON = 1e-9
  const side = new Int8Array(vertexCount)
  for (let i = 0; i < vertexCount; i++) {
    side[i] = distance[i] > EPSILON ? 1 : -1
  }

  const pointOf = new Map<string, number>()
  const px: number[] = []
  const py: number[] = []
  const pz: number[] = []
  const crossingPoint = (a: number, b: number): number => {
    const da = distance[a]
    const db = distance[b]
    let t = da / (da - db)
    if (!(t >= 0)) t = 0
    else if (!(t <= 1)) t = 1
    const key = t === 0 ? `v${a}` : t === 1 ? `v${b}` : a < b ? `${a}:${b}` : `${b}:${a}`
    const known = pointOf.get(key)
    if (known !== undefined) return known
    const at = px.length
    px.push(x[a] + (x[b] - x[a]) * t)
    py.push(y[a] + (y[b] - y[a]) * t)
    pz.push(z[a] + (z[b] - z[a]) * t)
    pointOf.set(key, at)
    return at
  }

  // next[from] = to: the cap boundary runs from -> to.
  const next = new Map<number, number>()
  const arrivals = new Map<number, number>()
  let conflicts = 0
  const corners = [0, 0, 0]
  for (let i = 0; i + 2 < tri.length; i += 3) {
    const a = tri[i]
    const b = tri[i + 1]
    const c = tri[i + 2]
    if (side[a] === side[b] && side[b] === side[c]) continue
    // Walk the triangle in its own winding order (counter-clockwise seen from
    // OUTSIDE the solid) and note where it leaves and re-enters the kept
    // half-space. The shell's own cut edge runs exit -> entry, so the cap, which
    // shares that edge from the other side, runs entry -> exit.
    corners[0] = a
    corners[1] = b
    corners[2] = c
    let exitAt = -1
    let entryAt = -1
    for (let k = 0; k < 3; k++) {
      const from = corners[k]
      const to = corners[(k + 1) % 3]
      if (side[from] === side[to]) continue
      if (side[from] === -1) exitAt = crossingPoint(from, to)
      else entryAt = crossingPoint(from, to)
    }
    if (exitAt < 0 || entryAt < 0 || exitAt === entryAt) continue
    // Two triangles leaving one point, and two arriving at one point, are both
    // anomalies; the second is the one that truncates a walk.
    if (next.has(entryAt)) conflicts++
    next.set(entryAt, exitAt)
    const arrived = (arrivals.get(exitAt) ?? 0) + 1
    arrivals.set(exitAt, arrived)
    if (arrived === 2) conflicts++
  }

  const seen = new Set<number>()
  const walk = (from: number): { chain: number[]; closed: boolean } => {
    const chain: number[] = []
    let at: number | undefined = from
    let guard = 0
    while (at !== undefined && !seen.has(at) && guard++ <= next.size) {
      seen.add(at)
      chain.push(at)
      at = next.get(at)
    }
    return { chain, closed: at === from }
  }

  const closedLoops: number[][] = []
  const open: number[][] = []
  // Start at the points nothing arrives at. Starting mid-chain instead turns
  // each genuine seam into several apparent breaks: it was measured to turn
  // GroEL's 2 real seams into 45, and drew a straight chord across the cut face
  // for each one.
  for (const from of next.keys()) {
    if (seen.has(from) || arrivals.has(from)) continue
    const walked = walk(from)
    if (walked.chain.length > 0) open.push(walked.chain)
  }
  for (const from of next.keys()) {
    if (seen.has(from)) continue
    const walked = walk(from)
    if (walked.chain.length === 0) continue
    // A walk that did not return to its start is OPEN, however it was reached.
    // An earlier version computed this flag and discarded it, so a walk that ran
    // into an already-visited point — reachable whenever two triangles arrive at
    // one boundary point — was pushed into the ring list carrying an implicit
    // closing chord of any length, incrementing none of the counters below.
    if (walked.closed) {
      if (walked.chain.length >= 3) closedLoops.push(walked.chain)
    } else {
      open.push(walked.chain)
    }
  }
  const openChains = open.length

  // Join what is left end-to-nearest-start, BUT ONLY within `maxStitchA`. The
  // gaps a real 3Dmol surface leaves are about one voxel step (GroEL measured
  // 1.011 A against the 4.0 A tolerance its grid earns), so the tolerance is
  // inert in the regime this was validated in and fires only on the
  // pathological one. Beyond it the ring is dropped: a chord long enough to
  // need refusing is a claim that material exists where solvent does, drawn at
  // the same opacity and colour as the parts that are right.
  const loops: number[][] = closedLoops.slice()
  const dropped: number[][] = []
  let stitches = 0
  let maxStitch = 0
  const gap = (a: number, b: number): number =>
    (px[a] - px[b]) ** 2 + (py[a] - py[b]) ** 2 + (pz[a] - pz[b]) ** 2
  const used = new Array<boolean>(open.length).fill(false)
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue
    used[i] = true
    let loop = open[i].slice()
    const first = loop[0]
    for (let step = 0; step < open.length; step++) {
      const end = loop[loop.length - 1]
      let best = -1
      let bestGap = gap(end, first)
      for (let j = 0; j < open.length; j++) {
        if (used[j]) continue
        const candidate = gap(end, open[j][0])
        if (candidate < bestGap) {
          bestGap = candidate
          best = j
        }
      }
      if (best < 0) break // closing on itself is already the nearest join
      const distance = Math.sqrt(bestGap)
      if (distance > maxStitchA) break // nothing near enough to be a seam
      used[best] = true
      stitches++
      maxStitch = Math.max(maxStitch, distance)
      loop = loop.concat(open[best])
    }
    // A stub of one or two points is not a ring and never was one — it carries
    // no area and was skipped before this tolerance existed. Only a chain that
    // COULD have been a ring, and was refused because its ends are too far
    // apart to be a seam, counts as dropped.
    if (loop.length < 3) continue
    const closingGap = Math.sqrt(gap(loop[loop.length - 1], loop[0]))
    if (closingGap > maxStitchA) {
      dropped.push(loop)
      continue
    }
    maxStitch = Math.max(maxStitch, closingGap)
    loops.push(loop)
  }

  return {
    px,
    py,
    pz,
    loops,
    dropped,
    openChains,
    stitches,
    // The longest gap actually closed, by a join or by a ring's own closure.
    maxStitchA: +maxStitch.toFixed(3),
    conflicts,
  }
}

/** Two unit vectors spanning the plane, right-handed with `n`. */
function planeBasis(n: Vec3): { u: Vec3; v: Vec3 } {
  const ax = Math.abs(n.x)
  const ay = Math.abs(n.y)
  const az = Math.abs(n.z)
  // Cross with whichever axis `n` leans on least, so the result is never near
  // zero-length.
  let ux: number
  let uy: number
  let uz: number
  if (ax <= ay && ax <= az) {
    ux = 0
    uy = -n.z
    uz = n.y
  } else if (ay <= az) {
    ux = -n.z
    uy = 0
    uz = n.x
  } else {
    ux = -n.y
    uy = n.x
    uz = 0
  }
  const length = Math.hypot(ux, uy, uz) || 1
  ux /= length
  uy /= length
  uz /= length
  // v = n x u makes (u, v, n) right-handed, so a loop that is counter-clockwise
  // seen from +n has POSITIVE signed area in (u, v).
  return {
    u: { x: ux, y: uy, z: uz },
    v: {
      x: n.y * uz - n.z * uy,
      y: n.z * ux - n.x * uz,
      z: n.x * uy - n.y * ux,
    },
  }
}

/** Signed area of a flat `[u0, v0, u1, v1, ...]` ring. */
function signedArea(ring: Float64Array): number {
  let sum = 0
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    sum += (ring[j] - ring[i]) * (ring[j + 1] + ring[i + 1])
  }
  return sum / 2
}

function pointInRing(u: number, v: number, ring: Float64Array): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ui = ring[i]
    const vi = ring[i + 1]
    const uj = ring[j]
    const vj = ring[j + 1]
    if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) inside = !inside
  }
  return inside
}

interface Ring {
  points: number[]
  flat: Float64Array
  area: number
  hole: boolean
  holes?: number[][]
}

/** How far behind its own plane a cap is placed, in angstroms. */
export const CAP_INSET_A = 0.02

/**
 * How far apart two ends of a boundary may be and still be treated as ONE seam.
 *
 * Derived from the marching grid rather than guessed. `ProteinSurface4`
 * reconstructs on a lattice of step `h` — 0.5 A normally, 1.0 A once the extent
 * volume passes 1e6 A^3 — and the same lattice is used for every sub-box of one
 * surface. Two reconstructions that disagree at a single lattice point can put
 * their corresponding boundary points at opposite corners of one cube (<= sqrt(3)
 * h) and `laplacianSmooth` can then move each by about one more edge (+h), so a
 * genuine seam cannot exceed roughly 2.73 h. Rounded to 4 h for margin: 2.0 A at
 * h = 0.5, 4.0 A at h = 1.0. Measured against a real structure at h = 1.0
 * (GroEL): 45 open chains, longest genuine seam 1.011 A — almost exactly one
 * voxel step, and a quarter of the tolerance it is judged against. So the gate
 * is inert in the regime this was validated in and fires only on a gap no
 * reconstruction of the same lattice could have produced.
 */
export const DEFAULT_MAX_STITCH_A = 2.0

/**
 * Atom-extent volume above which the coarser grid (h = 1.0 A) must be assumed.
 *
 * 3Dmol's own literal, and it is judged on 3Dmol's own quantity: `initparm`
 * runs `if (volume > 1000000) scaleFactor = defaultScaleFactor / 2` BEFORE it
 * computes `margin` or adds the probe radius, and the `volume` it is handed is
 * `GLViewer.volume(getExtent(atomsToShow, true))` — the bounding box of atom
 * CENTRES, with no radii and no padding at all.
 *
 * ⚠️ This read 7.7e5 between #1673's round-2 and round-3 reviews, on the
 * premise that 3Dmol judged a PADDED extent and therefore crossed 1e6 at a
 * smaller mesh box. The premise is backwards — the padding is applied after the
 * decision, and the mesh box is LARGER than the atom-centre box it is inferred
 * from, never smaller. Lowering the threshold made the cap assume a 4.0 A
 * stitch tolerance for meshes 3Dmol had marched at h = 0.5, where no genuine
 * seam reaches 1.37 A. The caller shrinks the mesh box back per axis before
 * comparing (see `stitchToleranceFor`); this constant stays 3Dmol's.
 */
export const COARSE_GRID_VOLUME_A3 = 1e6

/**
 * Share of the cut face that may be dropped before the whole cap is refused.
 *
 * Below it, a missing island is the honest report of a mesh that could not be
 * closed there. Above it, the remaining cap is its own lie — a hole in a filled
 * cross-section reads as "solvent here" exactly as confidently as a chord reads
 * as "protein here" — so the honest fallback is the hollow cut the user already
 * knows how to read.
 */
const MAX_DROPPED_AREA_SHARE = 0.1

/**
 * How far the triangulated area may sit from the rings' own analytic area, in
 * percent, before the whole cut face is refused.
 *
 * The backstop for a failure mode no other check can see: earcut returning a
 * triangulation that does not tile its input. Every other gate here reasons
 * about the BOUNDARY (a chord too long, a ring dropped inside a filled region);
 * this one compares the finished surface against the outline it was built from,
 * so a self-intersecting ring, a mis-assigned hole or a partial ear shows up
 * whatever caused it.
 *
 * 1% is enormous next to what a healthy cap produces — measured at 7.2e-14 on
 * 4hhb and 1.8e-13 on GroEL, i.e. machine precision — and that slack is
 * deliberate. The check exists to catch corruption, not to police rounding, and
 * a false refusal costs the user a correct cut face.
 *
 * ⚠️ It is a BACKSTOP, not a proof. Equal total area does not prove a tiling:
 * an overlap that exactly compensates a gap passes. Catching that needs
 * per-triangle containment and winding checks against every ring — a real
 * mechanism, and one aimed at a failure mode earcut does not have (its
 * documented failure is dropping ears on degenerate input, which changes the
 * total). Accepted deliberately rather than left unsaid: the gate is here to
 * stop a triangulation that is visibly wrong from being drawn as if it were
 * right, not to certify one that is correct.
 */
const MAX_AREA_ERROR_PCT = 1

/** Options for `buildCapMesh`. */
export interface CapOptions {
  /** How far behind its own plane the cap sits, in angstroms. */
  inset?: number
  /** Longest gap the stitch may close; see `DEFAULT_MAX_STITCH_A`. */
  maxStitchA?: number
}

/**
 * Build the cap that fills `dot(p, n) <= offset` where the mesh is cut.
 *
 * Returns null when the plane misses the mesh — a cut in front of or behind the
 * whole molecule has no cut face, and that is not an error.
 *
 * Only the NEAR plane is capped. The far one is left open deliberately: these
 * viewers always apply fog, whose far limit sits at the far clipping plane, so a
 * far cap was measured to render literally zero pixels. Building it would double
 * the per-frame cost for nothing.
 *
 * The cap is placed `CAP_INSET_A` BEHIND its own plane. This is not a nicety:
 * geometry exactly on the near clipping plane is the one thing the clip may or
 * may not keep, and at inset 0 the cap was measured to render nothing at all.
 * ChimeraX ships the same knob (`clipping_cap_offset`, default 0.01 A).
 */
export function buildCapMesh(
  mesh: WeldedMesh,
  normal: Vec3,
  offset: number,
  opts: CapOptions = {},
): CapMesh | null {
  const inset = opts.inset ?? CAP_INSET_A
  const maxStitchA = opts.maxStitchA ?? DEFAULT_MAX_STITCH_A
  const border = calculateBorder(mesh, normal, offset, maxStitchA)
  if (border.loops.length === 0 && border.dropped.length === 0) return null

  const { u, v } = planeBasis(normal)
  const pointCount = border.px.length
  const U = new Float64Array(pointCount)
  const V = new Float64Array(pointCount)
  for (let i = 0; i < pointCount; i++) {
    U[i] = border.px[i] * u.x + border.py[i] * u.y + border.pz[i] * u.z
    V[i] = border.px[i] * v.x + border.py[i] * v.y + border.pz[i] * v.z
  }

  // Measured in the same basis as the kept rings, so the refusal threshold below
  // compares like with like.
  const droppedArea = border.dropped.reduce((sum, points) => {
    if (points.length < 3) return sum
    const flat = new Float64Array(points.length * 2)
    for (let i = 0; i < points.length; i++) {
      flat[i * 2] = U[points[i]]
      flat[i * 2 + 1] = V[points[i]]
    }
    return sum + Math.abs(signedArea(flat))
  }, 0)

  const rings: Ring[] = border.loops.map(points => {
    const flat = new Float64Array(points.length * 2)
    for (let i = 0; i < points.length; i++) {
      flat[i * 2] = U[points[i]]
      flat[i * 2 + 1] = V[points[i]]
    }
    return { points, flat, area: signedArea(flat), hole: false }
  })

  // A ring nested inside an odd number of others is a hole. Containment is
  // tested against rings LARGER than it only, which is what makes one
  // point-in-ring probe per pair enough: a smaller ring cannot contain a bigger
  // one, so a single interior point decides the relationship.
  for (const ring of rings) {
    let depth = 0
    for (const other of rings) {
      if (other === ring || Math.abs(other.area) <= Math.abs(ring.area)) continue
      if (pointInRing(ring.flat[0], ring.flat[1], other.flat)) depth++
    }
    ring.hole = depth % 2 === 1
  }
  // One winding convention for earcut: outers counter-clockwise, holes clockwise.
  for (const ring of rings) {
    if (ring.area > 0 !== !ring.hole) {
      ring.points = ring.points.slice().reverse()
      ring.area = -ring.area
    }
  }

  const outers = rings.filter(ring => !ring.hole)
  for (const hole of rings.filter(ring => ring.hole)) {
    let owner: Ring | null = null
    for (const outer of outers) {
      if (Math.abs(outer.area) <= Math.abs(hole.area)) continue
      if (!pointInRing(U[hole.points[0]], V[hole.points[0]], outer.flat)) continue
      if (!owner || Math.abs(outer.area) < Math.abs(owner.area)) owner = outer
    }
    if (owner) (owner.holes ??= []).push(hole.points)
  }

  const indices: number[] = []
  for (const outer of outers) {
    const ringPoints = [outer.points, ...(outer.holes ?? [])]
    const flat: number[] = []
    const holeStarts: number[] = []
    const toBorderPoint: number[] = []
    for (let r = 0; r < ringPoints.length; r++) {
      if (r > 0) holeStarts.push(flat.length / 2)
      for (const point of ringPoints[r]) {
        flat.push(U[point], V[point])
        toBorderPoint.push(point)
      }
    }
    for (const local of earcut(flat, holeStarts, 2)) indices.push(toBorderPoint[local])
  }
  const positions = new Float32Array(pointCount * 3)
  const normals = new Float32Array(pointCount * 3)
  for (let i = 0; i < pointCount; i++) {
    positions[i * 3] = border.px[i] - normal.x * inset
    positions[i * 3 + 1] = border.py[i] - normal.y * inset
    positions[i * 3 + 2] = border.pz[i] - normal.z * inset
    normals[i * 3] = normal.x
    normals[i * 3 + 1] = normal.y
    normals[i * 3 + 2] = normal.z
  }

  let triangulatedArea = 0
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i]
    const b = indices[i + 1]
    const c = indices[i + 2]
    triangulatedArea +=
      Math.abs((U[b] - U[a]) * (V[c] - V[a]) - (V[b] - V[a]) * (U[c] - U[a])) / 2
  }
  const ringArea = rings.reduce(
    (sum, ring) => sum + (ring.hole ? -Math.abs(ring.area) : Math.abs(ring.area)),
    0,
  )
  // Refuse rather than show a cut face most of which is missing. Judged on AREA,
  // not on a count: one dropped ring can be the whole outline or a pinhole, and
  // only the first is worth abandoning the cap over.
  //
  // ⚠️ But a dropped ring INSIDE a kept outer is a different failure and has no
  // safe threshold at all. It never reaches `rings`, so it is never classified
  // as a hole and never assigned an owner — earcut then fills the outer ring
  // straight across it, drawing material over a cavity the mesh does not
  // support. That is the exact lie this module refuses to tell, and it is
  // invisible to every other check: `areaErrorPct` excludes the dropped ring
  // from BOTH sides of its comparison and reports a perfect cap. Any interior
  // drop refuses the whole cut face, whatever its area.
  const filledCavity = border.dropped.some(points => {
    if (points.length < 3) return false
    // The SAME parity rule the fill itself obeys: earcut draws an outer minus
    // its holes, recursively, so a point is covered exactly when it lies inside
    // an ODD number of kept rings. Probing `outers` alone over-refused — a ring
    // dropped inside a kept HOLE sits in a region the cap leaves empty anyway,
    // so nothing is drawn over it and nothing is claimed about it, yet the whole
    // cut face was being abandoned for it.
    let depth = 0
    for (const ring of rings) {
      if (pointInRing(U[points[0]], V[points[0]], ring.flat)) depth++
    }
    return depth % 2 === 1
  })
  const areaErrorPct = ringArea === 0 ? 0 : (100 * (triangulatedArea - ringArea)) / ringArea
  // Only against a cap that actually has triangles. With none, the comparison
  // is 0 against the whole ring area — a guaranteed -100% that would turn every
  // "nothing to draw" into a refusal and mask the two real reasons below.
  const corrupt = indices.length > 0 && !(Math.abs(areaErrorPct) <= MAX_AREA_ERROR_PCT)
  const refused =
    filledCavity ||
    corrupt ||
    (border.dropped.length > 0 &&
      droppedArea > MAX_DROPPED_AREA_SHARE * (Math.abs(ringArea) + droppedArea))

  const stats: CapStats = {
    loops: rings.length,
    outers: outers.length,
    holes: rings.length - outers.length,
    capTriangles: refused ? 0 : indices.length / 3,
    openChains: border.openChains,
    stitches: border.stitches,
    maxStitchA: border.maxStitchA,
    conflicts: border.conflicts,
    droppedLoops: border.dropped.length,
    droppedAreaA2: +droppedArea.toFixed(2),
    refused,
    refusedReason: filledCavity ? 'cavity' : corrupt ? 'corrupt' : refused ? 'area' : 'none',
    areaErrorPct,
  }
  if (refused) return { positions, normals, indices: [], stats }
  if (indices.length === 0) return null
  return { positions, normals, indices, stats }
}
