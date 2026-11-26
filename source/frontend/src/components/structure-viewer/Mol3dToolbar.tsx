import { useId, useState, type ComponentProps, type CSSProperties, type ReactNode, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import DepthCueBar from './DepthCueBar'
import SurfaceTypeChips from './SurfaceTypeChips'
import ToolbarPopover from './ToolbarPopover'
import ViewerToolChips from './ViewerToolChips'
import { VIEW_STYLE_KEYS, type ViewStyle } from './sceneStyles'
import { MATE_CUTOFFS_A, type MateCutoff } from './symmetryMates'
import type { SurfaceTypeKey } from './surfaceType'
import { colorSchemeAvailable, FALLBACK_COLOR_SCHEME, type ColorScheme } from './viewerColorScheme'
import type { ViewerAnnotation } from './useViewerAnnotation'

/**
 * Whether a control the toolbar draws can be used here.
 *
 * Owner rule: a control the user cannot use is shown LOCKED — greyed, a 🔒 and
 * the reason in words beside it — never hidden. The reason is the host's to
 * give, because only the host knows why (a permission, data not there
 * yet). The one exception (owner 2026-11-14): a control that cannot
 * work in a build at all is left out (the optional `ai`, `mates`, `dyna1`),
 * not locked.
 *
 * A locked switch that is ON (crystal neighbours drawn)
 * stays a live control that turns it OFF, with the reason beside it: the
 * toolbar shows what the viewer does, and the user is never left with
 * something on that they cannot end (PT-9104, PT-9105 item 8).
 */
export type ControlAvailability = { state: 'available' } | { state: 'locked'; reason: string }

/** The common case, one shared object so a host does not allocate it per render. */
export const CONTROL_AVAILABLE: ControlAvailability = { state: 'available' }

/** The four show/hide switches, in toolbar order. */
export type VisibilityKey = 'protein' | 'ligands' | 'water' | 'spin'

type DepthCueBarProps = ComponentProps<typeof DepthCueBar>

/** What both toolbars draw: the state each control shows and the call it makes. */
interface Mol3dToolbarShared {
  viewStyles: readonly ViewStyle[]
  onToggleViewStyle: (style: ViewStyle) => void
  colorScheme: ColorScheme
  onColorScheme: (scheme: ColorScheme) => void
  /**
   * Dyna-1 colouring. Locked: listed as a disabled option that says why
   * ("Dyna-1 (🔒 Not computed yet)"), never hidden (PT-9105 item 1, PT-9106
   * item 1). Left out where it cannot exist at all: never offered. A scheme the viewer cannot paint (it degrades to
   * Spectrum, `getColorOption`) is shown as Spectrum, so the select always
   * names what is drawn (PT-9112 item 2).
   */
  dyna1?: ControlAvailability
  visibility: Readonly<Record<VisibilityKey, boolean>>
  onToggleVisibility: (key: VisibilityKey) => void
  surface: {
    shown: boolean
    opaque: boolean
    /** Opaque is asked for but a focused ligand keeps the surface see-through. */
    opaqueSuppressed: boolean
    type: SurfaceTypeKey
  }
  onToggleSurface: () => void
  onToggleSurfaceOpaque: () => void
  onSurfaceType: (type: SurfaceTypeKey) => void
  annotation: ViewerAnnotation
  /** Everything `DepthCueBar` takes but its id prefix, which the variant picks. */
  depthCue: Omit<DepthCueBarProps, 'idPrefix'>
  measureMode: boolean
  onToggleMeasure: () => void
  screenshot: ControlAvailability
  onScreenshot: () => void
  bgColor: string
  onBgColor: (color: 'white' | 'black') => void
}

/** The card layout: five light rows. */
export interface Mol3dToolbarCardProps extends Mol3dToolbarShared {
  variant: 'card'
  savingScreenshot: boolean
  /** The ligand the view is focused on, if any; shows "Showing: …" and Reset View. */
  activeLigand: { ligandName?: string | null; chainId?: string | null } | null
  onResetLigandView: () => void
  /**
   * Drawn first on the Style row, before a vertical rule (such as
   * 「初期表示」, owner 2026-11-15). Without it the row starts with Style.
   */
  leading?: ReactNode
  /**
   * The 「Includes 3Dmol.js」 link at the end of the Style row (owner
   * 2026-11-19: 「Includes」, as the app says "Includes PyMOL™"; it said
   * 「Powered by」 before). Default
   * true; false leaves it out where a licence dialog names 3Dmol.js and links
   * to it instead (owner 2026-11-16).
   */
  includes3dmol?: boolean
  /**
   * Leaves out the 「📷 Screenshot」 button. Default false; true where a
   * header's 「画像出力」 saves the picture of either engine (owner
   * 2026-11-16). The background swatches then take the end of
   * the row the button held.
   */
  hideScreenshot?: boolean
  /**
   * A visible word before the background swatches, naming them as a group
   * (`role="group"`, labelled by it), such as 「背景」 (owner 2026-11-16).
   * Without it the swatches are drawn alone.
   */
  bgLabel?: string
  /**
   * The `ai` switch and the symmetry mates, both optional. Left out where
   * they cannot work at all (owner 2026-11-14: such a control is not drawn).
   */
  ai?: { availability: ControlAvailability; open: boolean; onToggle: () => void }
  mates?: {
    availability: ControlAvailability
    shown: boolean
    onToggle: () => void
    cutoff: MateCutoff
    onCutoff: (cutoff: MateCutoff) => void
    /** The status line, already worded by the host (empty while off). */
    statusText: string
  }
}

/** The `fullscreen` layout: one dark, wrapping toolbar. */
export interface Mol3dToolbarFullscreenProps extends Mol3dToolbarShared {
  variant: 'fullscreen'
  /** The host observes this element's size to resize the viewer. */
  toolbarRef?: Ref<HTMLDivElement>
  /** Drawn first. */
  leading?: ReactNode
  selectedResidue: { chain: string; resi: number } | null
  onClearSelectedResidue: () => void
  /** Drawn at the head of the action group. */
  pymolEntry?: ReactNode
}

/**
 * The one-row computer layout (owner 2026-11-19: 「分子ビューワー部分を最大限確保できる
 * ようなメニュー」): one row instead of the card's four. 「初期表示」 (`leading`), the colour scheme,
 * 📏 Measure and the background stay one click away; Style, the show/hide switches, the surface,
 * depth and the drawing tools are drop-downs laid over the view (`ToolbarPopover`).
 */
export interface Mol3dToolbarBarProps extends Mol3dToolbarShared {
  variant: 'bar'
  leading?: ReactNode
  /** The background swatches' visible name (the card's `bgLabel`). */
  bgLabel?: string
}

export type Mol3dToolbarProps = Mol3dToolbarCardProps | Mol3dToolbarFullscreenProps | Mol3dToolbarBarProps
/** The variants the shared pieces (colour options, surface, swatches) are drawn for: the bar uses the card's. */
type Variant = 'card' | 'fullscreen'

/**
 * The card's Style labels. English literals per the `DESIGN.md` §6.2.2
 * carve-out; module scope so the tuples are allocated once (a host may
 * re-render on every mouse move).
 */
const CARD_VIEW_STYLES: readonly (readonly [ViewStyle, string])[] = [
  ['cartoon', 'Ribbon'],
  ['stick', 'Stick'],
  ['ballstick', 'Ball&Stick'],
  ['line', 'Line'],
  ['trace', 'Trace'],
  ['cross', 'Cross'],
]

/** One spelling of a card checkbox label (inline hex: the §10 backlog, not converted here). */
const CARD_TOGGLE_LABEL = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  cursor: 'pointer',
  color: '#718096',
  fontSize: 11,
} as const
const CARD_STYLE_LABEL = { ...CARD_TOGGLE_LABEL, fontWeight: 600 } as const

/** The `fullscreen` layout's checkbox label. */
const FS_TOGGLE_LABEL = {
  display: 'flex',
  alignItems: 'center',
  gap: 3,
  cursor: 'pointer',
  color: '#90D3DB',
  fontSize: 11,
} as const

const VISIBILITY: readonly (readonly [VisibilityKey, string])[] = [
  ['protein', 'Protein'],
  ['ligands', 'Ligands'],
  ['water', 'Water'],
  ['spin', 'Spin'],
]

/** The reason a control is locked, or null while it is usable. */
const lockReason = (a: ControlAvailability): string | null => (a.state === 'locked' ? a.reason : null)

/**
 * A locked control keeps its size and shape; its colours, fill, border and
 * cursor come from `.sv3d-locked` (token colours, a dashed edge — not an
 * opacity, which took the card's labels to about 2:1, PT-9106 item 3). An
 * inline value would win over the class, so those go.
 */
function lockedStyle(style: CSSProperties): CSSProperties {
  return { ...style, cursor: undefined, color: undefined, background: undefined, border: undefined }
}

/** The padlock and the reason beside a locked control. */
function LockReason({ id, reason }: { id: string; reason: string }) {
  return (
    <span id={id} className="sv3d-chip-label">
      <span aria-hidden="true">🔒 </span>
      {reason}
    </span>
  )
}

/**
 * The 3Dmol.js toolbar both structure viewers draw — Style, Color, the
 * show/hide switches, the surface, the ink/pointer chips, depth cue, measure,
 * screenshot (the card may leave it out, `hideScreenshot`) and background —
 * as one presentational component.
 *
 * It holds no state of its own and imports nothing that reaches the server,
 * the session or the router: the host passes the values and callbacks, and a
 * control that needs the server arrives as a `ControlAvailability` (or a slot
 * the host fills). That keeps it bundleable into a standalone build.
 *
 * `variant` selects each page's existing layout and wording exactly; the two
 * were not harmonised when this was extracted.
 */
export default function Mol3dToolbar(props: Mol3dToolbarProps) {
  if (props.variant === 'bar') return <BarToolbar {...props} />
  return props.variant === 'card' ? <CardToolbar {...props} /> : <FullscreenToolbar {...props} />
}

type BarGroup = 'style' | 'show' | 'surface' | 'depth' | 'draw'

/** The bar's Style summary: the first representation chosen, and how many more. */
function styleSummary(viewStyles: readonly ViewStyle[]): string {
  const names = CARD_VIEW_STYLES.filter(([s]) => viewStyles.includes(s)).map(([, label]) => label)
  if (names.length === 0) return ''
  return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`
}

function BarToolbar(props: Mol3dToolbarBarProps) {
  const { t } = useTranslation('proteindb')
  const baseId = useId()
  const bgLabelId = useId()
  const [open, setOpen] = useState<BarGroup | null>(null)
  const pop = (group: BarGroup) => ({
    id: `${baseId}-${group}`,
    open: open === group,
    onOpen: (o: boolean) => setOpen(o ? group : cur => (cur === group ? null : cur)),
  })
  const { tool, setTool } = props.annotation
  const toolName = tool === 'pen' ? t('proteindb:viewer_pen') : tool === 'eraser' ? t('proteindb:viewer_eraser') : ''
  return (
    <div className="sv3d sv3d-bar" role="group" aria-label={t('proteindb:viewer_bar_label')}>
      {props.leading !== undefined && props.leading !== null && (
        <>
          {props.leading}
          <span className="sv3d-bar-sep" aria-hidden="true" />
        </>
      )}
      <ToolbarPopover {...pop('style')} label={t('proteindb:viewer_bar_style')} summary={styleSummary(props.viewStyles)}>
        {/* Several representations draw at once (owner 2026-08-29). */}
        {CARD_VIEW_STYLES.map(([s, label]) => (
          <label key={s} className="sv3d-bar-check">
            <input type="checkbox" checked={props.viewStyles.includes(s)} onChange={() => props.onToggleViewStyle(s)} /> {label}
          </label>
        ))}
      </ToolbarPopover>
      <label className="sv3d-bar-color">
        <span>{t('proteindb:viewer_bar_color')}</span>
        <select value={shownScheme(props.colorScheme, props.dyna1)} onChange={e => props.onColorScheme(e.target.value as ColorScheme)}>
          <ColorOptions variant="card" dyna1={props.dyna1} />
        </select>
      </label>
      <ToolbarPopover {...pop('show')} label={t('proteindb:viewer_bar_show')}>
        {VISIBILITY.map(([key, label]) => (
          <label key={key} className="sv3d-bar-check">
            <input type="checkbox" checked={props.visibility[key]} onChange={() => props.onToggleVisibility(key)} /> {label}
          </label>
        ))}
      </ToolbarPopover>
      <ToolbarPopover {...pop('surface')} label={t('proteindb:viewer_bar_surface')} summary={props.surface.shown ? t('proteindb:viewer_bar_on') : ''}>
        <SurfaceControls props={props} variant="card" />
      </ToolbarPopover>
      <ToolbarPopover {...pop('depth')} label={t('proteindb:viewer_bar_depth')}>
        <DepthCueBar {...props.depthCue} idPrefix="bar-depth" />
      </ToolbarPopover>
      <ToolbarPopover {...pop('draw')} label={t('proteindb:viewer_bar_draw')} summary={toolName}>
        <ViewerToolChips annotation={props.annotation} />
      </ToolbarPopover>
      {/* A pen or eraser armed: the way back to turning the view, on the bar itself. */}
      {tool !== 'none' && (
        <button type="button" className="sv3d-chip" onClick={() => setTool('none')}>
          {t('proteindb:viewer_navigate')}
        </button>
      )}
      <button
        type="button"
        className={`sv3d-bar-btn${props.measureMode ? ' is-on' : ''}`}
        aria-pressed={props.measureMode}
        onClick={props.onToggleMeasure}
        title="Click 2 atoms to measure distance"
      >
        📏 {props.measureMode ? 'Measuring...' : 'Measure'}
      </button>
      <div className="sv3d-bar-bg" role={props.bgLabel !== undefined ? 'group' : undefined} aria-labelledby={props.bgLabel !== undefined ? bgLabelId : undefined}>
        {props.bgLabel !== undefined && <span id={bgLabelId}>{props.bgLabel}</span>}
        <BgSwatches variant="card" bgColor={props.bgColor} onBgColor={props.onBgColor} />
      </div>
    </div>
  )
}

/**
 * The scheme the select shows. Dyna-1 chosen while it is locked (its data
 * not there yet) stays shown, as its locked option
 * with the reason: the viewer paints Spectrum meanwhile and Dyna-1 again once
 * the data is back, so showing Spectrum hid the choice, and picking Spectrum
 * then changed nothing (PT-9219 item 3). Only a scheme the toolbar does not
 * list at all (Dyna-1 where the host offers none) shows as
 * Spectrum, which is what is painted (PT-9112 item 2).
 */
function shownScheme(colorScheme: ColorScheme, dyna1: ControlAvailability | undefined): ColorScheme {
  if (colorScheme === 'dyna1' && dyna1 !== undefined) return colorScheme
  return colorSchemeAvailable(colorScheme, dyna1?.state === 'available') ? colorScheme : FALLBACK_COLOR_SCHEME
}

function ColorOptions({ variant, dyna1 }: { variant: Variant; dyna1: ControlAvailability | undefined }) {
  const card = variant === 'card'
  const locked = dyna1 === undefined ? null : lockReason(dyna1)
  return (
    <>
      <option value="spectrum">Spectrum</option>
      <option value="chain">Chain</option>
      <option value="ss">{card ? 'Secondary Structure' : 'Sec. Structure'}</option>
      <option value="element">{card ? 'Element (CPK)' : 'Element'}</option>
      <option value="bfactor">B-factor</option>
      {/* A product name, so it is not translated. Locked: listed, disabled, with the reason. */}
      {dyna1 !== undefined && (
        <option value="dyna1" disabled={locked !== null}>
          {locked === null ? 'Dyna-1' : `Dyna-1 (🔒 ${locked})`}
        </option>
      )}
    </>
  )
}

function SurfaceControls({ props, variant }: { props: Mol3dToolbarShared; variant: Variant }) {
  const { t } = useTranslation('proteindb')
  const { surface } = props
  const input = <input type="checkbox" checked={surface.shown} onChange={props.onToggleSurface} />
  return (
    <>
      {variant === 'card' ? (
        <label style={CARD_TOGGLE_LABEL}>{input} Surface</label>
      ) : (
        <label style={FS_TOGGLE_LABEL}>{input}Surface</label>
      )}
      <button
        type="button"
        className="sv3d-chip"
        aria-pressed={surface.opaque}
        disabled={!surface.shown}
        onClick={props.onToggleSurfaceOpaque}
        title={surface.opaqueSuppressed ? t('proteindb:viewer_surface_opaque_suppressed') : t('proteindb:viewer_surface_opaque_hint')}
      >
        {t('proteindb:viewer_surface_opaque')}
      </button>
      {surface.opaqueSuppressed && (
        <span className="sv3d-chip-label">{t('proteindb:viewer_surface_opaque_suppressed')}</span>
      )}
      {/* Revealed only while the surface is on: with no surface there is no
          type to choose, and an empty group is the honest picture. */}
      {surface.shown && (
        <SurfaceTypeChips value={surface.type} onChange={props.onSurfaceType} idPrefix={variant === 'card' ? 'detail-surface' : 'fs-surface'} />
      )}
    </>
  )
}

function CardToolbar(props: Mol3dToolbarCardProps) {
  const { t } = useTranslation('proteindb')
  const mateCutoffLabelId = useId()
  const screenshotReasonId = useId()
  const bgLabelId = useId()
  const aiReasonId = useId()
  const matesReasonId = useId()
  const screenshotLock = lockReason(props.screenshot)
  const { ai, mates } = props
  const aiLock = ai === undefined ? null : lockReason(ai.availability)
  const matesLock = mates === undefined ? null : lockReason(mates.availability)
  const aiOpen = ai?.open === true
  // Locked but on: still drawn, so the row reads as on and can be turned off.
  const matesLive = mates !== undefined && (matesLock === null || mates.shown)
  const screenshotLabel = props.savingScreenshot ? 'Saving...' : '📷 Screenshot'
  const screenshotStyle: CSSProperties = { padding: '2px 10px', fontSize: 11, border: '1px solid #E2E8F0', borderRadius: 6, background: 'white', cursor: 'pointer', color: '#718096', fontWeight: 600, marginLeft: props.activeLigand ? '0' : 'auto' }
  const aiStyle: CSSProperties = { padding: '2px 10px', fontSize: 11, border: aiOpen ? '2px solid #C08DAF' : '1px solid #E2E8F0', borderRadius: 6, background: aiOpen ? '#FBF5F9' : 'white', cursor: 'pointer', color: aiOpen ? '#C08DAF' : '#718096', fontWeight: 600 }
  return (
    <>
      {/* Toolbar Row 1: Style + Color */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 16px', borderBottom: '1px solid #EDF2F7', background: '#FAFBFC', flexWrap: 'wrap', alignItems: 'center' }}>
        {props.leading !== undefined && props.leading !== null && (
          <>
            {props.leading}
            <span aria-hidden="true" style={{ alignSelf: 'stretch', width: 1, background: '#E2E8F0', margin: '0 4px' }} />
          </>
        )}
        <span style={{ fontSize: 11, color: '#718096', fontWeight: 600, marginRight: 2 }}>{t('proteindb:viewer_style_label')}</span>
        {/* Checkboxes since the row became a multi-select (owner request
            2026-08-29): several representations draw at once. */}
        {CARD_VIEW_STYLES.map(([s, label]) => (
          <label key={s} style={CARD_STYLE_LABEL}>
            <input type="checkbox" checked={props.viewStyles.includes(s)} onChange={() => props.onToggleViewStyle(s)} /> {label}
          </label>
        ))}
        <span style={{ fontSize: 11, color: '#718096', fontWeight: 600, marginLeft: 10, marginRight: 2 }}>{t('proteindb:viewer_color_label')}</span>
        <select value={shownScheme(props.colorScheme, props.dyna1)} onChange={e => props.onColorScheme(e.target.value as ColorScheme)} style={{ padding: '2px 8px', fontSize: 11, border: '1px solid #E2E8F0', borderRadius: 6 }}>
          <ColorOptions variant="card" dyna1={props.dyna1} />
        </select>
        {props.includes3dmol !== false && (
          <a
            href="https://3dmol.csb.pitt.edu/"
            target="_blank"
            rel="noopener noreferrer"
            title="3Dmol.js — molecular visualization library"
            style={{ marginLeft: 'auto', fontSize: 11, color: '#A0AEC0', textDecoration: 'none', fontWeight: 500 }}
          >Includes 3Dmol.js ↗</a>
        )}
      </div>
      {/* Toolbar Row 2: Toggles + Actions. `sv3d` supplies the --sv3d-*
          custom properties the chips read. */}
      <div className="sv3d" style={{ display: 'flex', gap: 10, padding: '6px 16px', borderBottom: '1px solid #EDF2F7', background: '#FAFBFC', alignItems: 'center', fontSize: 11, flexWrap: 'wrap' }}>
        {VISIBILITY.map(([key, label]) => (
          <label key={key} style={CARD_TOGGLE_LABEL}>
            <input type="checkbox" checked={props.visibility[key]} onChange={() => props.onToggleVisibility(key)} /> {label}
          </label>
        ))}
        <ViewerToolChips annotation={props.annotation} />
        {props.activeLigand && (
          <>
            <span style={{ fontSize: 11, color: '#D69E2E', fontWeight: 600, marginLeft: 'auto' }}>Showing: {props.activeLigand.ligandName} (Chain {props.activeLigand.chainId})</span>
            <button onClick={props.onResetLigandView} style={{ padding: '2px 10px', fontSize: 11, border: '1px solid #D69E2E', borderRadius: 6, background: '#FEFCF3', cursor: 'pointer', color: '#D69E2E', fontWeight: 600 }}>Reset View</button>
          </>
        )}
        <button
          onClick={props.onToggleMeasure}
          style={{ padding: '2px 10px', fontSize: 11, border: props.measureMode ? '2px solid #D69E2E' : '1px solid #E2E8F0', borderRadius: 6, background: props.measureMode ? '#FEFCF3' : 'white', cursor: 'pointer', color: props.measureMode ? '#D69E2E' : '#718096', fontWeight: 600 }}
          title="Click 2 atoms to measure distance"
        >📏 {props.measureMode ? 'Measuring...' : 'Measure'}</button>
        {props.hideScreenshot === true ? null : screenshotLock !== null ? (
          <>
            {/* A save already running still says so (PT-9105 item 8). */}
            <button type="button" className="sv3d-locked" aria-disabled="true" aria-describedby={screenshotReasonId} style={lockedStyle(screenshotStyle)}>{screenshotLabel}</button>
            <LockReason id={screenshotReasonId} reason={screenshotLock} />
          </>
        ) : (
          <button onClick={props.onScreenshot} disabled={props.savingScreenshot} style={screenshotStyle}>{screenshotLabel}</button>
        )}
        {ai !== undefined && (aiLock !== null && !aiOpen ? (
          <>
            <button type="button" className="sv3d-locked" aria-disabled="true" aria-pressed={false} aria-describedby={aiReasonId} style={lockedStyle(aiStyle)}>&#129302; AI</button>
            <LockReason id={aiReasonId} reason={aiLock} />
          </>
        ) : (
          <>
            {/* Open: always able to close, locked or not (PT-9105 item 8). */}
            <button onClick={ai.onToggle} aria-pressed={aiOpen} aria-describedby={aiLock !== null ? aiReasonId : undefined} style={aiStyle}>&#129302; AI</button>
            {aiLock !== null && <LockReason id={aiReasonId} reason={aiLock} />}
          </>
        ))}
        {/* With a label: one named group, the word in sight before the swatches. */}
        <div
          role={props.bgLabel !== undefined ? 'group' : undefined}
          aria-labelledby={props.bgLabel !== undefined ? bgLabelId : undefined}
          style={{ display: 'flex', gap: 3, alignItems: 'center', ...(props.hideScreenshot === true && !props.activeLigand ? { marginLeft: 'auto' } : {}) }}
        >
          {props.bgLabel !== undefined && (
            <span id={bgLabelId} style={{ fontSize: 11, color: '#718096', fontWeight: 600, marginRight: 2 }}>{props.bgLabel}</span>
          )}
          <BgSwatches variant="card" bgColor={props.bgColor} onBgColor={props.onBgColor} />
          {props.bgColor !== 'white' && props.bgColor !== 'black' && (
            <div
              role="img"
              aria-label={t('proteindb:viewer_bg_ai', { color: props.bgColor })}
              style={{ width: 20, height: 20, borderRadius: 10, border: '2px solid #5FBCC8', background: props.bgColor }}
              title={t('proteindb:viewer_bg_ai', { color: props.bgColor })}
            />
          )}
        </div>
      </div>
      {/* Toolbar Row 3: the surface, its own row (owner request 2026-08-29):
          switching it on reveals chips, and a group that changes width would
          reflow every control after it on Row 2. */}
      <div className="sv3d" style={{ display: 'flex', gap: 10, padding: '6px 16px', borderBottom: '1px solid #EDF2F7', background: '#FAFBFC', alignItems: 'center', fontSize: 11, flexWrap: 'wrap' }}>
        <SurfaceControls props={props} variant="card" />
      </div>
      {/* Toolbar Row: symmetry mates, its own row for the same reason. */}
      {mates !== undefined && (
      <div className="sv3d sv3d-mates-row">
        {matesLive ? (
          <label style={CARD_TOGGLE_LABEL} title={t('proteindb:viewer_mates_hint')}>
            <input type="checkbox" checked={mates.shown} onChange={mates.onToggle} aria-describedby={matesLock !== null ? matesReasonId : undefined} /> {t('proteindb:viewer_mates')}
          </label>
        ) : (
          <label className="sv3d-locked" style={lockedStyle(CARD_TOGGLE_LABEL)} title={t('proteindb:viewer_mates_hint')}>
            <input type="checkbox" checked={false} aria-disabled="true" aria-describedby={matesReasonId} onChange={() => {}} /> {t('proteindb:viewer_mates')}
          </label>
        )}
        {matesLock !== null && <LockReason id={matesReasonId} reason={matesLock} />}
        {mates.shown && (
          <>
            {/* A named group (PT-1070 item 10): a screen reader announces
                "Within, group" before "4 Å, toggle button". `display:
                contents` keeps the chips in the row's own flex flow. The
                cutoff and status follow what is drawn, locked or not (PT-9104). */}
            <span role="group" aria-labelledby={mateCutoffLabelId} style={{ display: 'contents' }}>
            <span id={mateCutoffLabelId} className="sv3d-chip-label" title={t('proteindb:viewer_mates_cutoff_hint')}>{t('proteindb:viewer_mates_cutoff')}</span>
            {MATE_CUTOFFS_A.map(c => (
              <button
                key={c}
                type="button"
                className="sv3d-chip"
                aria-pressed={mates.cutoff === c}
                onClick={() => mates.onCutoff(c)}
                title={t('proteindb:viewer_mates_cutoff_hint')}
              >
                {c} Å
              </button>
            ))}
            </span>
            <span className="sv3d-chip-label" role="status">{mates.statusText}</span>
          </>
        )}
      </div>
      )}
      {/* Toolbar Row 4: depth cue + cross-section, its own row because the
          sliders appear and disappear with their switches. */}
      <div className="sv3d sv3d-depth-row">
        <DepthCueBar {...props.depthCue} idPrefix="sd-depth" />
      </div>
    </>
  )
}

/**
 * The white / black background swatches. They have no text, so each is
 * named (and titled) from the bundle and says which is chosen
 * (`aria-pressed`) — PT-9106 item 4.
 */
function BgSwatches({ variant, bgColor, onBgColor }: { variant: Variant; bgColor: string; onBgColor: (color: 'white' | 'black') => void }) {
  const { t } = useTranslation('proteindb')
  const card = variant === 'card'
  const size = card ? 20 : 18
  // The dark toolbar's black swatch keeps a 2 px edge: #1a1a2e on the
  // toolbar's navy is nearly invisible without it.
  const idle = card ? '1px solid #E2E8F0' : '2px solid #3d4e7e'
  const swatch = (color: 'white' | 'black', fill: string, name: string) => (
    <button
      type="button"
      aria-label={name}
      aria-pressed={bgColor === color}
      title={name}
      onClick={() => onBgColor(color)}
      style={{ width: size, height: size, borderRadius: size / 2, border: bgColor === color ? '2px solid #5FBCC8' : idle, background: fill, cursor: 'pointer' }}
    />
  )
  return (
    <>
      {swatch('white', 'white', t('proteindb:viewer_bg_white'))}
      {swatch('black', card ? 'black' : '#1a1a2e', t('proteindb:viewer_bg_black'))}
    </>
  )
}

function FullscreenToolbar(props: Mol3dToolbarFullscreenProps) {
  const { t } = useTranslation('proteindb')
  const screenshotReasonId = useId()
  const screenshotLock = lockReason(props.screenshot)
  const screenshotStyle: CSSProperties = { padding: '2px 8px', fontSize: 11, background: '#2d3561', color: '#90D3DB', border: 'none', borderRadius: 4, cursor: 'pointer' }
  // The button shows only the emoji, so its name comes from the bundle (PT-9106 item 4).
  const screenshotName = t('proteindb:viewer_screenshot')
  return (
    <div ref={props.toolbarRef} className="sv3d sv3d--dark" style={{ position: 'relative', zIndex: 10, padding: '6px 16px', background: 'var(--sv3d-toolbar-bg)', borderBottom: '1px solid #2d3561', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', flexShrink: 0 }}>
      {props.leading}
      <span style={{ fontSize: 11, color: '#90D3DB', marginRight: 4 }}>{t('proteindb:viewer_style_label')}</span>
      {/* Checkboxes: several representations draw at once. The list comes
          from `VIEW_STYLE_KEYS`, so a representation added there cannot reach
          one viewer and miss another. */}
      {VIEW_STYLE_KEYS.map(s => (
        <label key={s} style={FS_TOGGLE_LABEL}>
          <input
            type="checkbox"
            checked={props.viewStyles.includes(s)}
            onChange={() => props.onToggleViewStyle(s)}
          />{s}
        </label>
      ))}
      <span style={{ fontSize: 11, color: '#90D3DB', marginLeft: 8, marginRight: 4 }}>{t('proteindb:viewer_color_label')}</span>
      <select value={shownScheme(props.colorScheme, props.dyna1)} onChange={e => props.onColorScheme(e.target.value as ColorScheme)} style={{ padding: '2px 6px', fontSize: 11, background: '#2d3561', color: '#90D3DB', border: '1px solid #3d4e7e', borderRadius: 4 }}>
        <ColorOptions variant="fullscreen" dyna1={props.dyna1} />
      </select>
      <div style={{ width: 1, height: 20, background: '#2d3561', margin: '0 6px' }} />
      {VISIBILITY.map(([key, label]) => (
        <label key={label} style={FS_TOGGLE_LABEL}>
          <input type="checkbox" checked={props.visibility[key]} onChange={() => props.onToggleVisibility(key)} />{label}
        </label>
      ))}
      {/*
        The surface, on a line of its own: a full-width flex ITEM (`flex: 0 0
        100%`) rather than a second toolbar element, so the controls before it
        finish their line and everything after it starts a new one. No new CSS,
        and no second toolbar container.

        ⛔ That is the whole reason. Do not add a runtime one. Two attempts were
        made and both were false: "the stage height is derived from the
        measured toolbar height" (nothing reads the measurement — the stage is
        `flex: 1` under a `flexShrink: 0` toolbar) and "`toolbarRef`'s observer
        is the only thing that tells 3Dmol to resize" (`GLViewer` installs its
        own on the container, `build/3Dmol.js:21849-21853`).
      */}
      <div style={{ flex: '0 0 100%', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <SurfaceControls props={props} variant="fullscreen" />
      </div>
      <ViewerToolChips annotation={props.annotation} />
      <DepthCueBar {...props.depthCue} idPrefix="fs-depth" />
      {props.selectedResidue && (
        <span className="sv3d-residue-readout">
          {/* String(): i18next runs numeric interpolations through
              Intl.NumberFormat, which would render residue 1234 as "1,234". */}
          {t('proteindb:viewer_selected_residue', { chain: props.selectedResidue.chain, resi: String(props.selectedResidue.resi) })}
          <button
            type="button"
            className="sv3d-chip"
            aria-label={t('proteindb:viewer_clear_selection')}
            onClick={props.onClearSelectedResidue}
          >×</button>
        </span>
      )}
      <span className="sv3d-sep" aria-hidden="true" />
      {props.pymolEntry}
      <button onClick={props.onToggleMeasure} style={{ padding: '2px 8px', fontSize: 11, background: props.measureMode ? '#D69E2E' : '#2d3561', color: props.measureMode ? 'white' : '#90D3DB', border: 'none', borderRadius: 4, cursor: 'pointer' }}>📏 {props.measureMode ? 'Measuring...' : 'Measure'}</button>
      {screenshotLock !== null ? (
        <>
          <button type="button" className="sv3d-locked" aria-disabled="true" aria-label={screenshotName} title={screenshotName} aria-describedby={screenshotReasonId} style={lockedStyle(screenshotStyle)}>📷</button>
          <LockReason id={screenshotReasonId} reason={screenshotLock} />
        </>
      ) : (
        <button onClick={props.onScreenshot} aria-label={screenshotName} title={screenshotName} style={screenshotStyle}>📷</button>
      )}
      <div style={{ display: 'flex', gap: 3, marginLeft: 4 }}>
        <BgSwatches variant="fullscreen" bgColor={props.bgColor} onBgColor={props.onBgColor} />
      </div>
    </div>
  )
}
