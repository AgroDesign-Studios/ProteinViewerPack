import { describe, expect, it } from 'vitest'
import {
  SEARCH_TIME_BUDGET_MS, copyAtoms, findSymmetryMates, sanitizeMateCutoff, type CrystalFrame, type SymmetryCopy,
} from './symmetryMates'

const IDENTITY = { triplet: 'x,y,z', rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [0, 0, 0] }

function cubicP1(edge: number): CrystalFrame {
  return { lattice: [[edge, 0, 0], [0, edge, 0], [0, 0, edge]], operators: [IDENTITY] }
}

/** P 2₁2₁2₁ on an orthorhombic a × b × c cell, written out in Cartesian Å. */
function p212121(a: number, b: number, c: number): CrystalFrame {
  return {
    lattice: [[a, 0, 0], [0, b, 0], [0, 0, c]],
    operators: [
      IDENTITY,
      { triplet: '-x+1/2,-y,z+1/2', rotation: [[-1, 0, 0], [0, -1, 0], [0, 0, 1]], translation: [a / 2, 0, c / 2] },
      { triplet: 'x+1/2,-y+1/2,-z', rotation: [[1, 0, 0], [0, -1, 0], [0, 0, -1]], translation: [a / 2, b / 2, 0] },
      { triplet: '-x,y+1/2,-z+1/2', rotation: [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], translation: [0, b / 2, c / 2] },
    ],
  }
}

/** Every (operator, shift) within ±range cells whose closest atom pair is within cutoff — O(n²), for small n. */
function bruteForce(coords: number[], frame: CrystalFrame, cutoff: number, range: number): string[] {
  const n = coords.length / 3
  const keys: string[] = []
  frame.operators.forEach((op, k) => {
    for (let na = -range; na <= range; na++) {
      for (let nb = -range; nb <= range; nb++) {
        for (let nc = -range; nc <= range; nc++) {
          const shift = [0, 1, 2].map(i => op.translation[i] + na * frame.lattice[0][i] + nb * frame.lattice[1][i] + nc * frame.lattice[2][i])
          const isSelf = k === 0 && na === 0 && nb === 0 && nc === 0
          if (isSelf) continue
          let hit = false
          for (let i = 0; i < n && !hit; i++) {
            const p = coords.slice(3 * i, 3 * i + 3)
            const q = [0, 1, 2].map(r => op.rotation[r][0] * p[0] + op.rotation[r][1] * p[1] + op.rotation[r][2] * p[2] + shift[r])
            for (let j = 0; j < n && !hit; j++) {
              const d = Math.hypot(q[0] - coords[3 * j], q[1] - coords[3 * j + 1], q[2] - coords[3 * j + 2])
              if (d <= cutoff) hit = true
            }
          }
          if (hit) keys.push(`${k}:${na},${nb},${nc}`)
        }
      }
    }
  })
  return keys.sort()
}

const keyOf = (c: SymmetryCopy) => `${c.operator}:${c.shift.join(',')}`

// A small, deliberately lopsided "molecule" placed OUTSIDE the [0, 1) cell,
// which is where deposited coordinates often are.
const CLUSTER = [
  41.0, -12.0, 7.0,
  44.5, -10.0, 9.5,
  46.0, -14.5, 12.0,
  39.0, -9.0, 15.5,
  43.0, -6.5, 4.0,
]

describe('findSymmetryMates', () => {
  it('finds the six face neighbours of a lone atom in a cubic P 1 cell', () => {
    const { copies, truncated } = findSymmetryMates([1, 2, 3], cubicP1(10), { cutoff: 12, maxCopies: 64 })
    expect(truncated).toBe(false)
    expect(copies.map(keyOf).sort()).toEqual(['0:-1,0,0', '0:0,-1,0', '0:0,0,-1', '0:0,0,1', '0:0,1,0', '0:1,0,0'])
    expect(copies.every(c => Math.abs(c.centroidDistance - 10) < 1e-9)).toBe(true)
  })

  it('finds nothing when the cutoff is shorter than the cell', () => {
    expect(findSymmetryMates([1, 2, 3], cubicP1(10), { cutoff: 4, maxCopies: 64 }).copies).toEqual([])
  })

  it('never returns the reference itself', () => {
    const { copies } = findSymmetryMates(CLUSTER, p212121(20, 24, 28), { cutoff: 12, maxCopies: 500 })
    expect(copies.length).toBeGreaterThan(0)
    expect(copies.map(keyOf)).not.toContain('0:0,0,0')
  })

  // ±7 cells, not ±4: CLUSTER sits two cells from the origin, so an operator
  // that mirrors x puts its copy four or five cells away before the shift back.
  it.each([4, 8, 12])('matches a brute-force search over ±7 cells at %i Å (P 2₁2₁2₁)', cutoff => {
    const frame = p212121(20, 24, 28)
    const { copies } = findSymmetryMates(CLUSTER, frame, { cutoff, maxCopies: 500 })
    expect(copies.map(keyOf).sort()).toEqual(bruteForce(CLUSTER, frame, cutoff, 7))
  })

  it('reaches copies more than one cell away when the molecule is longer than its cell', () => {
    // A 30 Å rod in a 10 Å cell: the rod overlaps its images out to ±3 cells.
    const rod = Array.from({ length: 16 }, (_, i) => [i * 2, 0.5, 0.5]).flat()
    const frame = cubicP1(10)
    const { copies } = findSymmetryMates(rod, frame, { cutoff: 4, maxCopies: 500 })
    expect(copies.map(keyOf).sort()).toEqual(bruteForce(rod, frame, 4, 5))
    expect(copies.map(keyOf)).toContain('0:3,0,0')
  })

  it('handles an oblique (monoclinic) lattice exactly', () => {
    const beta = (107 * Math.PI) / 180
    const frame: CrystalFrame = {
      lattice: [[18, 0, 0], [0, 22, 0], [26 * Math.cos(beta), 0, 26 * Math.sin(beta)]],
      operators: [
        IDENTITY,
        // 2₁ along b: -x, y+1/2, -z
        { triplet: '-x,y+1/2,-z', rotation: [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], translation: [0, 11, 0] },
      ],
    }
    const { copies } = findSymmetryMates(CLUSTER, frame, { cutoff: 8, maxCopies: 500 })
    expect(copies.map(keyOf).sort()).toEqual(bruteForce(CLUSTER, frame, 8, 7))
  })

  it('keeps the nearest copies when capped, and says it capped', () => {
    const all = findSymmetryMates([1, 2, 3], cubicP1(10), { cutoff: 15, maxCopies: 500 }).copies
    const capped = findSymmetryMates([1, 2, 3], cubicP1(10), { cutoff: 15, maxCopies: 6 })
    expect(all.length).toBe(18)
    expect(capped.truncated).toBe(true)
    expect(capped.copies.map(keyOf)).toEqual(all.slice(0, 6).map(keyOf))
    expect(capped.copies.every(c => Math.abs(c.centroidDistance - 10) < 1e-9)).toBe(true)
  })

  // A degenerate frame is refused before the synchronous enumeration starts
  // (PR #2305 round 1).
  it('refuses a flat cell before enumerating, instead of walking ~1e23 shifts', () => {
    const flat: CrystalFrame = {
      lattice: [[50, 0, 0], [-25, 43.30127, 0], [-25, -43.30127, 2e-6]],
      operators: [IDENTITY],
    }
    const started = performance.now()
    const result = findSymmetryMates(CLUSTER, flat, { cutoff: 8, maxCopies: 64 })
    expect(result).toEqual({ copies: [], truncated: false, refused: 'frame' })
    expect(performance.now() - started).toBeLessThan(100)
  })

  /** A clock that advances `step` ms per read, so the budget runs out deterministically. */
  function steppingClock(step: number) {
    let t = 0
    return () => (t += step)
  }

  // The search is bounded by a clock, whatever the shape: a valid small cell
  // or a sparse lattice also stops within the budget (PR #2305 rounds 2 and 3).
  it.each([
    ['a two-cluster reference in a 2.5 Å cell', () => {
      const c: number[] = []
      for (let i = 0; i < 4000; i++) {
        const s = i % 2 ? 23 : -23
        c.push(s + (i % 7) * 0.1, s + (i % 5) * 0.1, s + (i % 3) * 0.1)
      }
      return { coords: c, cell: 2.5, cutoff: 8 }
    }],
    ['a sparse lattice whose copies land in empty grid cells', () => {
      const c: number[] = []
      for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) for (let k = 0; k < 12; k++) c.push(i * 19 + 0.37, j * 19 + 0.71, k * 19 + 0.13)
      return { coords: c, cell: 12, cutoff: 4 }
    }],
  ])('stops %s once the time budget is spent', (_label, build) => {
    const { coords, cell, cutoff } = build()
    const frame: CrystalFrame = { lattice: [[cell, 0, 0], [0, cell, 0], [0, 0, cell]], operators: [IDENTITY] }
    const started = performance.now()
    const result = findSymmetryMates(coords, frame, { cutoff, maxCopies: 64, timeBudgetMs: 50 })
    expect(result.refused).toBe('time')
    // 50 ms budget + one CLOCK_EVERY chunk of overshoot + the bounded prefilter;
    // generous so a loaded CI box cannot flake it.
    expect(performance.now() - started).toBeLessThan(1500)
  })

  it('refuses the WHOLE search once the budget is spent, not just one operator', () => {
    // The clock passes the deadline on its second read, inside the first
    // operator's shifts; a refusal that only ended that operator would carry
    // on through the other three and report refused: null.
    const result = findSymmetryMates(CLUSTER, p212121(20, 24, 28), {
      cutoff: 12, maxCopies: 500, timeBudgetMs: 1, now: steppingClock(1),
    })
    expect(result).toEqual({ copies: [], truncated: false, refused: 'time' })
  })

  it.each([NaN, Infinity])('treats a budget of %s as the default rather than as no bound', budget => {
    // A NaN budget would make `now() > deadline` always false and disable the
    // bound; with the default, a clock that jumps a whole default budget per
    // read still refuses.
    const result = findSymmetryMates(CLUSTER, p212121(20, 24, 28), {
      cutoff: 12, maxCopies: 500, timeBudgetMs: budget, now: steppingClock(SEARCH_TIME_BUDGET_MS),
    })
    expect(result.refused).toBe('time')
  })

  it.each([0, -5])('treats a budget of %s as the default rather than as already spent', budget => {
    // PT-1070 item 16: the stepping clock above refuses under a budget of 0
    // or -5 as well, so it passed with the default branch deleted. This clock
    // stands 1 ms past the deadline's start for good: the default budget
    // never runs out, while 0 or -5 taken literally would refuse at once.
    let reads = 0
    const result = findSymmetryMates(CLUSTER, p212121(20, 24, 28), {
      cutoff: 12, maxCopies: 500, timeBudgetMs: budget, now: () => (reads++ === 0 ? 0 : 1),
    })
    expect(result.refused).toBeNull()
    expect(result.copies.length).toBeGreaterThan(0)
  })

  it('reads the clock on the reference atoms near() checks, not only on the copy atoms', () => {
    // PT-1070 item 3: the clock was read once per CLOCK_EVERY copy atoms, and
    // one near() over a crowded cell scans its whole bucket. Here every copy
    // atom of the shift by one cell lands next to a 1000-atom pile it does not
    // touch, so that shift alone is a million distance checks between the
    // copy's first atom and its last: one clock read before, ~1000 now.
    const coords: number[] = []
    for (let i = 0; i < 1000; i++) coords.push(0.1, 0.1, 0.1)
    coords.push(20, 0.1, 0.1)
    const frame: CrystalFrame = { lattice: [[7, 0, 0], [0, 100, 0], [0, 0, 100]], operators: [IDENTITY] }
    let reads = 0
    const result = findSymmetryMates(coords, frame, { cutoff: 4, maxCopies: 64, now: () => { reads++; return 0 } })
    expect(result.refused).toBeNull()
    expect(reads).toBeGreaterThan(500)
  })

  it('refuses a reference that piles more atoms into one cell than any molecule holds', () => {
    const pile: number[] = []
    for (let i = 0; i < 5000; i++) pile.push(1, 2, 3)
    const started = performance.now()
    expect(findSymmetryMates(pile, cubicP1(10), { cutoff: 4, maxCopies: 64 })).toEqual({ copies: [], truncated: false, refused: 'crowded' })
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('keeps only the cutoffs the toolbar offers from a stored view', () => {
    expect(sanitizeMateCutoff(12)).toBe(12)
    expect(sanitizeMateCutoff(5)).toBeNull()
    expect(sanitizeMateCutoff('8')).toBeNull()
    expect(sanitizeMateCutoff(undefined)).toBeNull()
  })

  it('refuses more operators than any space group has', () => {
    const flood: CrystalFrame = { lattice: cubicP1(10).lattice, operators: Array.from({ length: 193 }, () => IDENTITY) }
    expect(findSymmetryMates([1, 2, 3], flood, { cutoff: 8, maxCopies: 64 }).refused).toBe('frame')
  })

  it('refuses non-finite numbers in the frame', () => {
    const nan: CrystalFrame = { lattice: [[10, 0, 0], [0, NaN, 0], [0, 0, 10]], operators: [IDENTITY] }
    const shortOp: CrystalFrame = { lattice: cubicP1(10).lattice, operators: [{ ...IDENTITY, translation: [0, 0] }] }
    expect(findSymmetryMates([1, 2, 3], nan, { cutoff: 8, maxCopies: 64 }).refused).toBe('frame')
    expect(findSymmetryMates([1, 2, 3], shortOp, { cutoff: 8, maxCopies: 64 }).refused).toBe('frame')
  })

  it('does not refuse a real crystal', () => {
    expect(findSymmetryMates(CLUSTER, p212121(20, 24, 28), { cutoff: 12, maxCopies: 64 }).refused).toBeNull()
  })

  it('returns nothing for empty coordinates or a degenerate lattice', () => {
    expect(findSymmetryMates([], cubicP1(10), { cutoff: 8, maxCopies: 64 }).copies).toEqual([])
    const flat: CrystalFrame = { lattice: [[10, 0, 0], [0, 10, 0], [0, 0, 0]], operators: [IDENTITY] }
    expect(findSymmetryMates([1, 2, 3], flat, { cutoff: 8, maxCopies: 64 }).copies).toEqual([])
  })
})

describe('copyAtoms', () => {
  const copy: SymmetryCopy = {
    operator: 1,
    triplet: '-x+1/2,-y,z+1/2',
    shift: [0, 0, 0],
    rotation: [[-1, 0, 0], [0, -1, 0], [0, 0, 1]],
    translation: [10, 0, 14],
    centroidDistance: 0,
  }

  it('moves every atom by the copy transform', () => {
    const [a] = copyAtoms([{ x: 1, y: 2, z: 3 }], copy)
    expect([a.x, a.y, a.z]).toEqual([9, -2, 17])
  })

  it('keeps residue, chain, secondary structure and bond indices', () => {
    const atom = { x: 0, y: 0, z: 0, elem: 'C', resn: 'ALA', resi: 5, chain: 'A', ss: 'h', index: 7, bonds: [6, 8], hetflag: false }
    const [a] = copyAtoms([atom], copy)
    expect(a).toMatchObject({ elem: 'C', resn: 'ALA', resi: 5, chain: 'A', ss: 'h', index: 7, bonds: [6, 8], hetflag: false })
  })

  it('drops the per-atom viewer state and leaves the reference untouched', () => {
    const style = { cartoon: {} }
    const atom = { x: 1, y: 1, z: 1, style, model: 0, clickable: true, callback: () => {}, intersectionShape: {} }
    const [a] = copyAtoms([atom], copy) as Record<string, unknown>[]
    for (const key of ['style', 'model', 'clickable', 'callback', 'intersectionShape']) expect(a).not.toHaveProperty(key)
    expect(atom.style).toBe(style)
    expect([atom.x, atom.y, atom.z]).toEqual([1, 1, 1])
  })
})
