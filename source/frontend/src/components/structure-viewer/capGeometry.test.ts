/**
 * capGeometry — the cut face of a cross-section, on shapes whose answer is
 * known by hand.
 *
 * This is the half of the filled cross-section that a screenshot cannot check.
 * A cap can be visibly wrong in ways that all look like "a grey shape roughly
 * where the cut is": a hole triangulated as material, a nested island lost, a
 * ring dropped because the mesh had a seam, a plane derived one step too early
 * so the face is inset the wrong way. Every case below has an area computed
 * from the geometry rather than from the code under test.
 */
import { describe, it, expect } from 'vitest'
import {
  CAP_INSET_A,
  buildCapMesh,
  weldSurfaceMesh,
  type SurfaceGeometryGroup,
} from './capGeometry'

/** The plane every test cuts on unless it says otherwise: z = 0, keeping z <= 0. */
const UP = { x: 0, y: 0, z: 1 }

function group(positions: number[], faces: number[]): SurfaceGeometryGroup {
  return {
    vertexArray: Float32Array.from(positions),
    faceArray: Uint16Array.from(faces),
    vertices: positions.length / 3,
    faceidx: faces.length,
  }
}

/**
 * The four side walls of an axis-aligned rectangular prism.
 *
 * `outward` false reverses every triangle, which is what the INNER wall of a
 * tube looks like: the material is outside it, so its surface normal points into
 * the hole.
 *
 * The z ends are left open on purpose. Only triangles that straddle the plane
 * take part in a cut, and at z = 0 those are exactly the side walls — closing
 * the ends would add vertices no assertion here could distinguish.
 */
function prismWalls(
  hx: number,
  hy: number,
  z0: number,
  z1: number,
  outward = true,
): { positions: number[]; faces: number[] } {
  const corners: [number, number][] = [
    [-hx, -hy],
    [hx, -hy],
    [hx, hy],
    [-hx, hy],
  ]
  const positions: number[] = []
  const faces: number[] = []
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = corners[i]
    const [x1, y1] = corners[(i + 1) % 4]
    const b = positions.length / 3
    positions.push(x0, y0, z0, x1, y1, z0, x1, y1, z1, x0, y0, z1)
    faces.push(
      ...(outward ? [b, b + 1, b + 2, b, b + 2, b + 3] : [b, b + 2, b + 1, b, b + 3, b + 2]),
    )
  }
  return { positions, faces }
}

/** One end of a prism, wound so its normal points away from the solid. */
function prismEnd(hx: number, hy: number, z: number, up: boolean): {
  positions: number[]
  faces: number[]
} {
  return {
    positions: [-hx, -hy, z, hx, -hy, z, hx, hy, z, -hx, hy, z],
    faces: up ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2],
  }
}

/**
 * The same prism, but with the last wall's shared corner nudged aside.
 *
 * This is what a carve seam actually looks like: the two walls no longer weld,
 * so the boundary breaks there by `seamA` angstroms — about one step of the
 * marching grid, not a hole. GroEL's widest measured seam was 1.011 A, on the
 * h = 1.0 A grid its size earns, against a 4.0 A tolerance.
 */
function prismWallsWithSeam(
  hx: number,
  hy: number,
  z0: number,
  z1: number,
  seamA: number,
): { positions: number[]; faces: number[] } {
  const wall = prismWalls(hx, hy, z0, z1)
  // Wall 3 runs (-hx, hy) -> (-hx, -hy); its second corner is wall 0's first.
  // Nudging only that corner leaves exactly one break.
  for (let i = 0; i < wall.positions.length; i += 3) {
    if (wall.positions[i] === -hx && wall.positions[i + 1] === -hy && i >= 36) {
      wall.positions[i] = -hx + seamA
    }
  }
  return wall
}

/** Total area of a cap's triangles, measured from the emitted vertices. */
function capArea(cap: { positions: Float32Array; indices: number[] }): number {
  let area = 0
  for (let i = 0; i + 2 < cap.indices.length; i += 3) {
    const [a, b, c] = [cap.indices[i], cap.indices[i + 1], cap.indices[i + 2]]
    const ax = cap.positions[a * 3]
    const ay = cap.positions[a * 3 + 1]
    const az = cap.positions[a * 3 + 2]
    const ux = cap.positions[b * 3] - ax
    const uy = cap.positions[b * 3 + 1] - ay
    const uz = cap.positions[b * 3 + 2] - az
    const vx = cap.positions[c * 3] - ax
    const vy = cap.positions[c * 3 + 1] - ay
    const vz = cap.positions[c * 3 + 2] - az
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
  }
  return area
}

describe('weldSurfaceMesh', () => {
  it('joins vertices that two geometry groups both carry', () => {
    // 3Dmol duplicates seam vertices twice over — `splitMesh` at the 16-bit
    // index limit and `carveUpExtent` for anything over 64000 A^3 — and a
    // boundary loop that crosses one of those seams cannot be followed through
    // unmerged indices.
    const wall = prismWalls(1, 1, -1, 1)
    const half = { positions: wall.positions, faces: wall.faces.slice(0, 12) }
    const rest = { positions: wall.positions, faces: wall.faces.slice(12) }
    const mesh = weldSurfaceMesh([group(half.positions, half.faces), group(rest.positions, rest.faces)])

    // 32 raw slots collapse to the prism's 8 real corners: each wall carries its
    // own copy of the two it shares with its neighbour, and both groups here
    // carry the whole position array.
    expect(mesh.rawVertices).toBe(32)
    expect(mesh.x.length).toBe(8)
    expect(mesh.triangles).toBe(8)
  })

  it('drops a triangle whose index is past its own group', () => {
    // Only reachable if the two arrays disagree, but reading a neighbouring
    // vertex would invent a boundary edge that does not exist.
    const mesh = weldSurfaceMesh([group([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2, 0, 1, 9])])
    expect(mesh.triangles).toBe(1)
  })

  it('ignores a group with no arrays', () => {
    const mesh = weldSurfaceMesh([
      { vertexArray: null, faceArray: null, vertices: 0, faceidx: 0 },
    ])
    expect(mesh.triangles).toBe(0)
  })
})

describe('buildCapMesh', () => {
  it('fills the cut face of a closed box, and gets its area exactly right', () => {
    const walls = prismWalls(2, 3, -1, 1)
    const top = prismEnd(2, 3, 1, true)
    const bottom = prismEnd(2, 3, -1, false)
    const mesh = weldSurfaceMesh([
      group(walls.positions, walls.faces),
      group(top.positions, top.faces),
      group(bottom.positions, bottom.faces),
    ])
    const cap = buildCapMesh(mesh, UP, 0)

    expect(cap).not.toBeNull()
    expect(cap!.stats.loops).toBe(1)
    expect(cap!.stats.outers).toBe(1)
    expect(cap!.stats.holes).toBe(0)
    expect(cap!.stats.openChains).toBe(0)
    expect(cap!.stats.conflicts).toBe(0)
    // 4 x 6 — the actual cross-section, not a number the module reported.
    expect(capArea(cap!)).toBeCloseTo(24, 6)
    expect(cap!.stats.areaErrorPct).toBeCloseTo(0, 6)
  })

  it('leaves a hole where the plane crosses a tunnel', () => {
    // A square tube: outer wall plus an inner wall wound the other way. The cut
    // is an annulus, and getting this wrong is the failure that would look most
    // like success — a filled square reads as a perfectly good cut face.
    const outer = prismWalls(3, 3, -1, 1, true)
    const inner = prismWalls(1, 1, -1, 1, false)
    const mesh = weldSurfaceMesh([
      group(outer.positions, outer.faces),
      group(inner.positions, inner.faces),
    ])
    const cap = buildCapMesh(mesh, UP, 0)

    expect(cap!.stats.loops).toBe(2)
    expect(cap!.stats.outers).toBe(1)
    expect(cap!.stats.holes).toBe(1)
    // 6x6 minus 2x2.
    expect(capArea(cap!)).toBeCloseTo(32, 6)
  })

  it('reads an island inside a hole as material again', () => {
    // Three levels of nesting. Parity, not "the second ring is a hole": a rod
    // running down the middle of a tunnel is material, and a rule that alternated
    // by rank alone would punch it out.
    const outer = prismWalls(4, 4, -1, 1, true)
    const tunnel = prismWalls(3, 3, -1, 1, false)
    const rod = prismWalls(1, 1, -1, 1, true)
    const mesh = weldSurfaceMesh([
      group(outer.positions, outer.faces),
      group(tunnel.positions, tunnel.faces),
      group(rod.positions, rod.faces),
    ])
    const cap = buildCapMesh(mesh, UP, 0)

    expect(cap!.stats.loops).toBe(3)
    expect(cap!.stats.outers).toBe(2)
    expect(cap!.stats.holes).toBe(1)
    // (8x8 - 6x6) for the shell, plus 2x2 for the rod.
    expect(capArea(cap!)).toBeCloseTo(64 - 36 + 4, 6)
  })

  it('caps two separate solids as two faces', () => {
    const left = prismWalls(1, 1, -1, 1)
    const right = prismWalls(1, 1, -1, 1)
    for (let i = 0; i < right.positions.length; i += 3) right.positions[i] += 10
    const mesh = weldSurfaceMesh([
      group(left.positions, left.faces),
      group(right.positions, right.faces),
    ])
    const cap = buildCapMesh(mesh, UP, 0)

    expect(cap!.stats.outers).toBe(2)
    expect(cap!.stats.holes).toBe(0)
    expect(capArea(cap!)).toBeCloseTo(8, 6)
  })

  it('closes a seam-sized break, because that is what a real surface leaves', () => {
    // 3Dmol marches large structures as separate boxes on independent grids, so
    // the delivered surface really does have seams. Dropping the loop would lose
    // a whole island of the cut face; joining across a hundredth of an angstrom
    // is invisible.
    const walls = prismWallsWithSeam(2, 2, -1, 1, 0.03)
    const mesh = weldSurfaceMesh([group(walls.positions, walls.faces)])
    const cap = buildCapMesh(mesh, UP, 0)!

    expect(cap.stats.openChains).toBe(1)
    expect(cap.stats.loops).toBe(1)
    expect(cap.stats.droppedLoops).toBe(0)
    expect(cap.stats.refused).toBe(false)
    expect(cap.stats.maxStitchA).toBeLessThanOrEqual(0.05)
    // The nudge itself removes a sliver, so this is the 4x4 square less a hair —
    // not the ~37% a chord across a missing wall would have cost.
    expect(capArea(cap)).toBeGreaterThan(15.8)
    expect(capArea(cap)).toBeLessThanOrEqual(16)
  })

  it('refuses to bridge a gap too wide to be a seam', () => {
    // A whole missing wall is not a seam, and a chord across it would ADD
    // geometry the mesh never supported — drawn at the same opacity and colour
    // as the parts that are right. The honest answer is the hollow cut.
    const walls = prismWalls(2, 2, -1, 1)
    const gapped = {
      positions: walls.positions,
      faces: walls.faces.slice(0, walls.faces.length - 6),
    }
    const mesh = weldSurfaceMesh([group(gapped.positions, gapped.faces)])
    const cap = buildCapMesh(mesh, UP, 0)!

    expect(cap.stats.droppedLoops).toBe(1)
    expect(cap.stats.refused).toBe(true)
    expect(cap.indices).toHaveLength(0)
    expect(cap.stats.capTriangles).toBe(0)
  })

  it('refuses when a dropped ring lies INSIDE the cut face', () => {
    // The worst shape this failure takes. A dropped ring never reaches `rings`,
    // so it is never classified as a hole and never assigned an owner — earcut
    // then fills the outer ring straight across it, drawing material over a
    // cavity the mesh does not support. Every other check misses it:
    // `areaErrorPct` excludes the dropped ring from BOTH sides and reports a
    // perfect cap, and the area share here is under 4%, well inside the 10%
    // gate. So an interior drop refuses the cap whatever its area.
    const outer = prismWalls(6, 6, -1, 1, true)
    const tunnel = prismWalls(1.2, 1.2, -1, 1, false)
    // One tunnel wall missing: a 2.4 A break, over the 2.0 A tolerance.
    const broken = { positions: tunnel.positions, faces: tunnel.faces.slice(0, tunnel.faces.length - 6) }
    const mesh = weldSurfaceMesh([
      group(outer.positions, outer.faces),
      group(broken.positions, broken.faces),
    ])
    const cap = buildCapMesh(mesh, UP, 0)!

    expect(cap.stats.droppedLoops).toBe(1)
    expect(cap.stats.refused).toBe(true)
    expect(cap.stats.refusedReason).toBe('cavity')
    expect(cap.indices).toHaveLength(0)
  })

  it('still draws when the dropped ring sits inside a KEPT hole', () => {
    // The rule above is a PARITY rule, not "inside any outer". Earcut draws an
    // outer minus its holes, recursively, so a ring dropped inside a kept hole
    // lands in a region the cap already leaves empty: nothing is drawn over it,
    // so there is nothing to lie about. Probing the outers alone called this a
    // cavity and threw away a cut face that was entirely honest.
    //
    // A 20x20 shell, a 12x12 tunnel through it (a hole), and a broken 2.4x2.4
    // ring inside THAT — depth 2, so the fill never reaches it.
    const shell = prismWalls(10, 10, -1, 1, true)
    const tunnel = prismWalls(6, 6, -1, 1, false)
    const inner = prismWalls(1.2, 1.2, -1, 1, false)
    const broken = { positions: inner.positions, faces: inner.faces.slice(0, inner.faces.length - 6) }
    const mesh = weldSurfaceMesh([
      group(shell.positions, shell.faces),
      group(tunnel.positions, tunnel.faces),
      group(broken.positions, broken.faces),
    ])
    const cap = buildCapMesh(mesh, UP, 0)!

    expect(cap.stats.droppedLoops).toBe(1)
    expect(cap.stats.refusedReason).not.toBe('cavity')
    expect(cap.stats.refused).toBe(false)
    expect(cap.stats.outers).toBe(1)
    expect(cap.stats.holes).toBe(1)
    // The annulus, and only the annulus: 400 - 144.
    expect(capArea(cap)).toBeCloseTo(256, 6)
  })

  it('still draws when the dropped ring is nowhere near the cut face', () => {
    // The complement, so the rule above is not simply "any drop refuses": a
    // broken boundary on a SEPARATE solid costs that solid its face and no more.
    const kept = prismWalls(2, 2, -1, 1)
    const far = prismWalls(2, 2, -1, 1)
    for (let i = 0; i < far.positions.length; i += 3) far.positions[i] += 40
    const broken = { positions: far.positions, faces: far.faces.slice(0, far.faces.length - 6) }
    const mesh = weldSurfaceMesh([
      group(kept.positions, kept.faces),
      group(broken.positions, broken.faces),
    ])
    const cap = buildCapMesh(mesh, UP, 0)!

    expect(cap.stats.droppedLoops).toBe(1)
    expect(cap.stats.refusedReason).not.toBe('cavity')
    expect(cap.stats.outers).toBe(1)
  })

  it('honours a tolerance wide enough to accept that gap', () => {
    // The tolerance is the caller's, derived from the marching grid; nothing in
    // the geometry is special about 2 A.
    const walls = prismWalls(2, 2, -1, 1)
    const gapped = {
      positions: walls.positions,
      faces: walls.faces.slice(0, walls.faces.length - 6),
    }
    const mesh = weldSurfaceMesh([group(gapped.positions, gapped.faces)])
    const cap = buildCapMesh(mesh, UP, 0, { maxStitchA: 10 })!

    expect(cap.stats.refused).toBe(false)
    expect(cap.stats.droppedLoops).toBe(0)
    expect(cap.stats.loops).toBe(1)
    expect(capArea(cap)).toBeGreaterThan(10)
  })

  it('returns null when the plane misses the molecule', () => {
    const walls = prismWalls(1, 1, -1, 1)
    const mesh = weldSurfaceMesh([group(walls.positions, walls.faces)])
    expect(buildCapMesh(mesh, UP, 50)).toBeNull()
    expect(buildCapMesh(mesh, UP, -50)).toBeNull()
  })

  it('places the face behind its own plane, facing the camera', () => {
    // Not a nicety. Geometry exactly ON the near clipping plane is the one thing
    // the clip may or may not keep, and at inset 0 the cap was measured to render
    // nothing at all — ChimeraX ships the same knob for the same reason.
    const walls = prismWalls(1, 1, -1, 1)
    const mesh = weldSurfaceMesh([group(walls.positions, walls.faces)])
    const cap = buildCapMesh(mesh, UP, 0)!

    for (let i = 0; i < cap.positions.length / 3; i++) {
      expect(cap.positions[i * 3 + 2]).toBeCloseTo(-CAP_INSET_A, 9)
      expect(cap.normals[i * 3]).toBeCloseTo(0, 9)
      expect(cap.normals[i * 3 + 1]).toBeCloseTo(0, 9)
      expect(cap.normals[i * 3 + 2]).toBeCloseTo(1, 9)
    }
  })

  it('follows an oblique plane, not just an axis-aligned one', () => {
    // The cut plane is the CAMERA's, so it is oblique to the molecule at every
    // orientation but one. A basis that silently assumed an axis would pass every
    // test above and fail the moment anyone rotated the view.
    const walls = prismWalls(1, 1, -4, 4)
    const ends = [prismEnd(1, 1, 4, true), prismEnd(1, 1, -4, false)]
    const mesh = weldSurfaceMesh([
      group(walls.positions, walls.faces),
      group(ends[0].positions, ends[0].faces),
      group(ends[1].positions, ends[1].faces),
    ])
    // 45 degrees about x: the 2x2 square section becomes a 2 x 2*sqrt(2) slice.
    const s = Math.SQRT1_2
    const cap = buildCapMesh(mesh, { x: 0, y: s, z: s }, 0)

    expect(cap!.stats.outers).toBe(1)
    expect(cap!.stats.holes).toBe(0)
    expect(capArea(cap!)).toBeCloseTo(2 * 2 * Math.SQRT2, 5)
  })
})
