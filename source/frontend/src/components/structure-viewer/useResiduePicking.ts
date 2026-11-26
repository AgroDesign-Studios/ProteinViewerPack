import { useEffect, useRef } from 'react'

export type PickMode = 'residue' | 'measure'

/**
 * Colour of the picked-residue overlay in the 3D scene.
 *
 * This is a WebGL material colour handed to 3Dmol, not a CSS property, so it
 * cannot come from a custom property — DESIGN.md §1.4 governs inline `style`
 * props, not scene colours. Kept here so both viewer pages paint the same
 * yellow, matching the value the sequence viewer has always used.
 */
export const RESIDUE_HIGHLIGHT_COLOR = '#FBBF24'

interface Options {
  /** Ref holding the live 3Dmol viewer instance. */
  viewerRef: React.MutableRefObject<any>
  /**
   * Incremented by the page every time a NEW viewer instance is created.
   * Registration cannot key on the structure data alone: the viewer is assigned
   * inside `load3Dmol().then(...)`, so any effect keyed on `[pdbData]` runs
   * while the ref is still null and silently registers nothing; this counter
   * re-runs the registration once the viewer exists.
   */
  viewerEpoch: number
  /**
   * Changes whenever a model is ADDED to or removed from the scene. 3Dmol's
   * setClickable flips a flag on the atoms that exist when it is called, so a model added later is not pickable until it is re-run.
   */
  modelsKey?: string | number | null
  /**
   * A model whose atoms residue mode ignores — such as symmetry
   * mates. A copy carries the reference's chain ids and residue numbers, so a
   * click on it would select the REFERENCE's residue: a highlight appearing on
   * a different molecule from the one clicked. Measure mode still takes them,
   * because a distance across a crystal contact is exactly what it is for.
   */
  ignoreResidueModel?: number | null
  mode: PickMode
  /** Called for a protein atom pick while `mode === 'residue'`. */
  onPickResidue: (chain: string, resi: number) => void
  /** Called for any atom pick while `mode === 'measure'`. */
  onPickAtom: (atom: any) => void
}

/**
 * Single owner of 3Dmol's click handler for one viewer.
 *
 * 3Dmol keeps exactly one clickable callback per selection, last registration
 * wins, so residue picking and distance measurement cannot each install their
 * own — previously the measure toggle overwrote residue picking and, on exit,
 * called `setClickable({}, false, ...)`, disabling clicking entirely until the
 * viewer was rebuilt. Here both modes share one registration and the mode is
 * read through a ref, so switching modes never re-registers and exiting measure
 * mode restores picking instead of killing it.
 */
export function useResiduePicking({ viewerRef, viewerEpoch, modelsKey = null, ignoreResidueModel = null, mode, onPickResidue, onPickAtom }: Options): void {
  // Held in refs so the registration effect depends only on the viewer identity;
  // re-registering on every render would thrash 3Dmol's per-atom flags.
  const modeRef = useRef(mode)
  const onPickResidueRef = useRef(onPickResidue)
  const onPickAtomRef = useRef(onPickAtom)
  const ignoreResidueModelRef = useRef(ignoreResidueModel)

  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { ignoreResidueModelRef.current = ignoreResidueModel }, [ignoreResidueModel])
  useEffect(() => { onPickResidueRef.current = onPickResidue }, [onPickResidue])
  useEffect(() => { onPickAtomRef.current = onPickAtom }, [onPickAtom])

  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    try {
      v.setClickable({}, true, (atom: any) => {
        if (!atom) return
        if (modeRef.current === 'measure') {
          onPickAtomRef.current(atom)
          return
        }
        // Residue mode: only protein atoms have a counterpart in the sequence
        // data. The sequence data skips non-standard residues, so a
        // click on a ligand or water would select something the sequence viewer
        // cannot render and the highlight selector (hetflag:false) cannot paint.
        if (atom.hetflag) return
        if (ignoreResidueModelRef.current !== null && atom.model === ignoreResidueModelRef.current) return
        if (typeof atom.resi !== 'number' || !Number.isFinite(atom.resi)) return
        if (!atom.chain) return
        onPickResidueRef.current(String(atom.chain), atom.resi)
      })
      // 3Dmol only rebuilds its raycast targets inside render(); without this
      // the registration takes effect on some later unrelated redraw, or never.
      v.render()
    } catch (e) {
      console.warn('setClickable failed', e)
    }
  }, [viewerRef, viewerEpoch, modelsKey])
}
