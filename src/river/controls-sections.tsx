'use client'

import type { SceneApi, SiteNode } from '@pascal-app/core'
import { ArrowLeftRight, Check, MousePointer2, Plus, RotateCcw, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ParameterRange } from '../parameter-range'
import type { PondShoreline, WaterQuality } from '../pond/schema'
import { updateRiver, type RiverParameters } from './actions'
import {
  RiverButton,
  RiverHint,
  RiverPanelGroup,
  RiverSelectField,
  type RiverSelectOption,
} from './controls-fields'
import { riverPlanLimits, type RiverLimit } from './limits'
import { resolvePointValues } from './planner'
import type {
  RiverEndEnd,
  RiverFlowDirection,
  RiverFlowMode,
  RiverNode,
  RiverOutlet,
  RiverSection,
  RiverSectionShape,
  RiverSource,
  RiverStartEnd,
} from './schema'
import { useRiverStore, type RiverSettings } from './store'
import { planRiver, riverSourceTerrain, type RiverFacts } from './terrain'

type SettingsProps = Readonly<{
  values: RiverSettings
  onChange: (patch: Partial<RiverSettings>) => void
}>

export type RiverPathActions = Readonly<{
  startNewRiver: () => void
  togglePathEditing: () => void
  finishPathEditing: () => void
  finishDraft: () => void
  removeLastPoint: () => void
  cancelDraft: () => void
}>

export type RiverPathState = Readonly<{
  /** Points placed so far while drafting, or null when not drafting. */
  draftPointCount: number | null
  editing: boolean
  canStart: boolean
  /** Point count of the selected river, or null when none is selected. */
  selectedPointCount: number | null
  feedback: string
}>

export function RiverPathSection({
  state,
  actions,
}: {
  state: RiverPathState
  actions: RiverPathActions
}) {
  const guidance = riverPathGuidance(state)
  return (
    <section aria-labelledby="river-path-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold" id="river-path-heading">
          Path
        </h3>
        <span className="rounded-full bg-sidebar-accent px-2 py-1 font-medium text-[11px] text-sidebar-foreground/70 tabular-nums">
          {riverPointSummary(state)}
        </span>
      </div>
      <RiverPathFigure />
      <p className="text-xs leading-relaxed text-sidebar-foreground/80">{guidance.instruction}</p>
      <p
        aria-live="polite"
        className="min-h-8 rounded-md bg-sidebar-accent/40 px-3 py-2 text-xs leading-relaxed text-sidebar-foreground/75"
        role="status"
      >
        {state.feedback || guidance.status}
      </p>
      <RiverPathButtons state={state} actions={actions} />
    </section>
  )
}

function riverPointSummary(state: RiverPathState): string {
  if (state.draftPointCount !== null) return `${state.draftPointCount} / 128 points`
  if (state.selectedPointCount !== null) return `${state.selectedPointCount} points`
  return state.editing ? 'Editing points' : '2-point minimum'
}

function RiverPathFigure() {
  const course = 'M16 35 C58 35 66 12 108 15 S164 43 224 17'
  return (
    <figure className="overflow-hidden rounded-lg border border-sidebar-border bg-sidebar-accent/25 px-3 py-2.5">
      <svg aria-hidden="true" className="h-12 w-full text-primary" viewBox="0 0 240 48">
        <path
          className="stroke-current opacity-20"
          d={course}
          fill="none"
          strokeLinecap="round"
          strokeWidth="14"
        />
        <path className="stroke-current" d={course} fill="none" strokeLinecap="round" strokeWidth="2" />
        {[
          [16, 35],
          [108, 15],
          [224, 17],
        ].map(([cx, cy]) => (
          <circle
            className="fill-sidebar stroke-current"
            cx={String(cx)}
            cy={String(cy)}
            key={cx}
            r="4"
            strokeWidth="2"
          />
        ))}
      </svg>
      <figcaption className="text-[11px] leading-relaxed text-sidebar-foreground/65">
        Points set the river centerline; width and depth turn that path into a carved channel.
      </figcaption>
    </figure>
  )
}

function RiverPathButtons({
  state,
  actions,
}: {
  state: RiverPathState
  actions: RiverPathActions
}) {
  if (state.draftPointCount !== null) {
    return <RiverDraftButtons actions={actions} pointCount={state.draftPointCount} />
  }
  if (state.editing) {
    return (
      <RiverButton
        emphasized
        icon={Check}
        label="Done editing path"
        onClick={actions.finishPathEditing}
      />
    )
  }
  const selected = state.selectedPointCount !== null
  return (
    <>
      {selected ? (
        <RiverButton
          emphasized
          icon={MousePointer2}
          label="Edit path"
          onClick={actions.togglePathEditing}
        />
      ) : null}
      <RiverButton
        disabled={!state.canStart}
        disabledReason="Add or select an editable Site first."
        emphasized={!selected}
        icon={Plus}
        label="Draw new river"
        onClick={actions.startNewRiver}
      />
    </>
  )
}

function RiverDraftButtons({
  pointCount,
  actions,
}: {
  pointCount: number
  actions: RiverPathActions
}) {
  return (
    <>
      <RiverButton
        disabled={pointCount < 2}
        disabledReason="Place at least two river points."
        emphasized
        icon={Check}
        label="Finish river"
        onClick={actions.finishDraft}
      />
      <div className="grid grid-cols-2 gap-2">
        <RiverButton
          disabled={pointCount === 0}
          disabledReason="Place a river point before removing one."
          icon={RotateCcw}
          label="Remove last point"
          onClick={actions.removeLastPoint}
        />
        <RiverButton icon={X} label="Cancel" onClick={actions.cancelDraft} />
      </div>
    </>
  )
}

type RiverPathGuidance = Readonly<{ instruction: string; status: string }>

/** What the Path section asks for next, and what has been registered so far. */
function riverPathGuidance(state: RiverPathState): RiverPathGuidance {
  if (state.draftPointCount !== null) return draftGuidance(state.draftPointCount)
  if (state.editing) {
    return {
      instruction:
        'Drag any visible control point to reshape the selected river. Release to apply each change.',
      status: 'Path editing is active.',
    }
  }
  if (!state.canStart) {
    return {
      instruction:
        'River drawing needs an editable Site. Add or select a Site before starting a path.',
      status: 'River drawing is unavailable because no Site is active.',
    }
  }
  if (state.selectedPointCount !== null) {
    return {
      instruction: 'Choose Edit path, then drag its visible control points to reshape the channel.',
      status: 'River selected and ready to edit.',
    }
  }
  return {
    instruction:
      'Choose Draw new river, then click along the terrain. Each point bends the channel through it.',
    status: 'Ready to draw a river.',
  }
}

function draftGuidance(pointCount: number): RiverPathGuidance {
  if (pointCount === 0) {
    return {
      instruction: 'Click terrain to place the first point. This sets where the river begins.',
      status: 'Waiting for the first point.',
    }
  }
  if (pointCount === 1) {
    return {
      instruction:
        'First point set. Click farther along the terrain to create the first channel segment.',
      status: '1 point registered. Place one more to finish.',
    }
  }
  return {
    instruction:
      pointCount === 2
        ? 'Two points set—the minimum. Finish a simple channel now, or keep clicking to shape bends.'
        : 'Keep clicking to extend the channel, or finish when its course has the shape you want.',
    status: `${pointCount} points registered. The river is ready to finish.`,
  }
}

export function RiverChannelSection({
  values,
  onChange,
  seaOutletAvailable,
}: SettingsProps & { seaOutletAvailable: boolean }) {
  return (
    <RiverPanelGroup title="Channel">
      <ParameterRange
        commitOnRelease
        label="Width"
        max={24}
        min={1}
        onChange={(width) => onChange({ width })}
        precision={1}
        step={0.25}
        unit="m"
        value={values.width}
      />
      <ParameterRange
        commitOnRelease
        label="Depth"
        max={8}
        min={0.1}
        onChange={(depth) => onChange({ depth })}
        precision={1}
        step={0.1}
        unit="m"
        value={values.depth}
      />
      <RiverEndpointFields
        onChange={onChange}
        seaOutletAvailable={seaOutletAvailable}
        values={values}
      />
      <RiverCapFields onChange={onChange} values={values} />
    </RiverPanelGroup>
  )
}

const SOURCE_OPTIONS: readonly RiverSelectOption<RiverSource>[] = [
  { value: 'rounded', label: 'Rounded' },
  { value: 'mountain', label: 'Mountain source' },
]

/** Where each end goes: a rounded cap, or a connection continuing beyond the Site. */
function RiverEndpointFields({
  values,
  onChange,
  seaOutletAvailable,
}: SettingsProps & { seaOutletAvailable: boolean }) {
  return (
    <>
      <RiverSelectField
        label="First endpoint"
        onChange={(source) => onChange({ source })}
        options={SOURCE_OPTIONS}
        value={values.source}
      />
      <RiverSelectField<RiverOutlet>
        label="Last endpoint"
        onChange={(outlet) => onChange({ outlet })}
        options={[
          { value: 'rounded', label: 'Rounded' },
          { value: 'sea', label: 'Sea outlet', disabled: !seaOutletAvailable },
        ]}
        value={values.outlet}
      />
      <RiverHint>
        Mountain and sea connections continue procedurally beyond the Site; the authored river and
        its exports stay inside the Site.
      </RiverHint>
      {!seaOutletAvailable ? (
        <RiverHint>Sea outlet is unavailable because the current Surroundings seed has no coast.</RiverHint>
      ) : null}
    </>
  )
}

const START_CAP_OPTIONS: readonly RiverSelectOption<RiverStartEnd>[] = [
  { value: 'rounded', label: 'Rounded' },
  { value: 'taper', label: 'Taper' },
  { value: 'spring', label: 'Spring' },
]

const END_CAP_OPTIONS: readonly RiverSelectOption<RiverEndEnd>[] = [
  { value: 'rounded', label: 'Rounded' },
  { value: 'taper', label: 'Taper' },
  { value: 'fan', label: 'Fan' },
]

/** Cap shapes where the authored path ends inside the Site. */
function RiverCapFields({ values, onChange }: SettingsProps) {
  return (
    <>
      <RiverSelectField
        label="Start cap"
        onChange={(start) => onChange({ ends: { ...values.ends, start } })}
        options={START_CAP_OPTIONS}
        value={values.ends.start}
      />
      <RiverSelectField
        label="End cap"
        onChange={(end) => onChange({ ends: { ...values.ends, end } })}
        options={END_CAP_OPTIONS}
        value={values.ends.end}
      />
    </>
  )
}

type PointSizes = Pick<Partial<RiverParameters>, 'pointWidths' | 'pointDepths'>

/** Width and depth at one authored point; points left unset follow their neighbours. */
export function RiverPointSizeControls({
  river,
  sceneApi,
}: {
  river: RiverNode
  sceneApi: SceneApi
}) {
  const [pointIndex, setPointIndex] = useState(0)
  const point = Math.min(pointIndex, river.points.length - 1)
  const widths = resolvePointValues(river.points.length, river.pointWidths, river.width)
  const depths = resolvePointValues(river.points.length, river.pointDepths, river.depth)
  const atPoint = (current: readonly (number | null)[], value: number | null) =>
    withPointValue(current, river.points.length, point, value)
  const apply = (patch: PointSizes, change: string) =>
    applyPointSizes(sceneApi, river, patch, `Point ${point + 1} ${change}.`)
  const followNeighbours = () =>
    apply(
      { pointWidths: atPoint(river.pointWidths, null), pointDepths: atPoint(river.pointDepths, null) },
      'now follows its neighbours',
    )

  return (
    <RiverPanelGroup title="Selected point">
      <RiverSelectField
        label="Point"
        onChange={(index) => setPointIndex(Number(index))}
        options={river.points.map((_, index) => ({ value: String(index), label: `Point ${index + 1}` }))}
        value={String(point)}
      />
      <ParameterRange
        commitOnRelease
        label="Width at point"
        max={24}
        min={1}
        onChange={(width) => apply({ pointWidths: atPoint(river.pointWidths, width) }, 'width updated')}
        precision={1}
        step={0.25}
        unit="m"
        value={widths[point] ?? river.width}
      />
      <ParameterRange
        commitOnRelease
        label="Depth at point"
        max={8}
        min={0.1}
        onChange={(depth) => apply({ pointDepths: atPoint(river.pointDepths, depth) }, 'depth updated')}
        precision={1}
        step={0.1}
        unit="m"
        value={depths[point] ?? river.depth}
      />
      <RiverButton icon={RotateCcw} label="Point follows neighbours" onClick={followNeighbours} />
      <RiverHint>
        Width and depth interpolate between the points you set; unset points follow their
        neighbours.
      </RiverHint>
    </RiverPanelGroup>
  )
}

/** Sparse per-point overrides with one point's value replaced (null = follow neighbours). */
function withPointValue(
  current: readonly (number | null)[],
  pointCount: number,
  point: number,
  value: number | null,
): (number | null)[] {
  return Array.from({ length: pointCount }, (_, index) =>
    index === point ? value : (current[index] ?? null),
  )
}

function applyPointSizes(sceneApi: SceneApi, river: RiverNode, patch: PointSizes, success: string) {
  const result = updateRiver(sceneApi, river.id, patch)
  if (result.river) useRiverStore.getState().adoptRiverSettings(result.river)
  useRiverStore.getState().setFeedback(result.ok ? success : result.message)
}

const FLOW_MODE_OPTIONS: readonly RiverSelectOption<RiverFlowMode>[] = [
  { value: 'downhill', label: 'Downhill only' },
  { value: 'as_drawn', label: 'As drawn' },
]

export function RiverProfileSection({
  values,
  onChange,
  river,
  site,
  siblings,
}: SettingsProps & ReadoutProps) {
  return (
    <RiverPanelGroup title="Water profile">
      <RiverSelectField
        label="Mode"
        onChange={(flow) => onChange({ flow })}
        options={FLOW_MODE_OPTIONS}
        value={values.flow}
      />
      <ParameterRange
        commitOnRelease
        label="Max slope"
        max={20}
        min={0}
        onChange={(maxSlopePct) => onChange({ maxSlopePct })}
        precision={1}
        step={0.1}
        unit="%"
        value={values.maxSlopePct}
      />
      <RiverHint>
        Downhill water never rises: it cuts through high ground and crosses dips on an
        embankment. As drawn follows the terrain exactly as placed.
      </RiverHint>
      <RiverPlanReadout river={river} siblings={siblings} site={site} />
    </RiverPanelGroup>
  )
}

type ReadoutProps = Readonly<{
  river: RiverNode | null
  site: SiteNode | null
  /** The Site's other rivers, which this one may meet. */
  siblings: readonly RiverNode[]
}>

/**
 * What the selected or drafted river's plan says: why it is not built, or its
 * facts and anything about it the river tool does not solve yet.
 */
export function RiverPlanReadout({ river, site, siblings }: ReadoutProps) {
  const readout = useMemo(() => planReadout({ river, site, siblings }), [river, site, siblings])
  if (!readout) return null
  if (readout.plan.refusal) {
    return (
      <p
        className="rounded-md bg-destructive/10 px-3 py-2 text-[11px] leading-relaxed text-destructive"
        role="alert"
      >
        {`Not built: ${readout.plan.refusal.message}`}
      </p>
    )
  }
  return (
    <>
      <RiverFactsList facts={readout.plan.facts} />
      {readout.limits.length > 0 ? <RiverLimitsList limits={readout.limits} /> : null}
    </>
  )
}

/**
 * Plans on the river-free ground the carve starts from, never a live
 * preview's excavation: what is reported is what an apply would build.
 */
function planReadout({ river, site, siblings }: ReadoutProps) {
  if (!river || !site || river.parentId !== site.id) return null
  const terrain = riverSourceTerrain(site)
  const plan = planRiver(terrain, river, site.polygon.points)
  if (!plan) return null
  const siblingPlans = siblings.flatMap((sibling) => {
    if (sibling.id === river.id) return []
    const siblingPlan = planRiver(terrain, sibling, site.polygon.points)
    return siblingPlan ? [siblingPlan] : []
  })
  return { plan, limits: riverPlanLimits(river, plan, siblingPlans) }
}

function RiverLimitsList({ limits }: { limits: readonly RiverLimit[] }) {
  return (
    <ul
      className="flex flex-col gap-1 rounded-md bg-sidebar-accent/40 px-3 py-2 text-[11px] leading-relaxed text-sidebar-foreground/80"
      role="note"
    >
      {limits.map((limit) => (
        <li key={limit.code}>{`Not supported: ${limit.message}`}</li>
      ))}
    </ul>
  )
}

/** What a buildable river is, and what it costs in earthworks. */
function RiverFactsList({ facts }: { facts: RiverFacts }) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-sidebar-accent/40 px-3 py-2 text-[11px] leading-relaxed text-sidebar-foreground/80 tabular-nums">
      <div>Length</div>
      <div className="text-right">{`${facts.lengthM.toFixed(1)} m`}</div>
      <div>Drop</div>
      <div className="text-right">{`${facts.dropM.toFixed(2)} m`}</div>
      <div>Mean slope</div>
      <div className="text-right">{`${facts.meanSlopePct.toFixed(1)} %`}</div>
      <div>Cut ≈</div>
      <div className="text-right">{`${facts.cutVolumeM3.toFixed(0)} m³`}</div>
      <div>Fill ≈</div>
      <div className="text-right">{`${facts.fillVolumeM3.toFixed(0)} m³`}</div>
      <div>Embanked</div>
      <div className="text-right">
        {facts.embankedLengthM > 0
          ? `${facts.embankedLengthM.toFixed(1)} m (≤ ${facts.maxEmbankmentM.toFixed(2)} m)`
          : '—'}
      </div>
      <div>Rapids</div>
      <div className="text-right">
        {facts.rapidLengthM > 0 ? `${facts.rapidLengthM.toFixed(1)} m` : '—'}
      </div>
      {facts.depthShortfallM > 0.005 ? (
        <>
          <div>Depth limited</div>
          <div className="text-right">
            {`${facts.depthShortfallM.toFixed(2)} m short (bank slope)`}
          </div>
        </>
      ) : null}
    </dl>
  )
}

const SECTION_SHAPE_OPTIONS: readonly RiverSelectOption<RiverSectionShape>[] = [
  { value: 'curved', label: 'Curved bed' },
  { value: 'trapezoid', label: 'Trapezoid' },
]

type SectionRange = Readonly<{
  key: 'bankSlope' | 'bendAsymmetry' | 'bermM' | 'blendM'
  label: string
  min: number
  max: number
  step: number
  precision: number
  unit: string
}>

const SECTION_RANGES: readonly SectionRange[] = [
  { key: 'bankSlope', label: 'Bank slope (run : 1)', min: 0.5, max: 6, step: 0.1, precision: 1, unit: ':1' },
  { key: 'bendAsymmetry', label: 'Bend asymmetry', min: 0, max: 1, step: 0.05, precision: 2, unit: '' },
  { key: 'bermM', label: 'Berm', min: 0, max: 5, step: 0.1, precision: 1, unit: 'm' },
  { key: 'blendM', label: 'Bank blend', min: 0, max: 10, step: 0.1, precision: 1, unit: 'm' },
]

/** Shape of the carved channel, shared by every station along the river. */
export function RiverCrossSectionControls({
  section,
  onChange,
}: {
  section: RiverSection
  onChange: (section: RiverSection) => void
}) {
  return (
    <RiverPanelGroup title="Cross-section">
      <RiverSelectField
        label="Shape"
        onChange={(shape) => onChange({ ...section, shape })}
        options={SECTION_SHAPE_OPTIONS}
        value={section.shape}
      />
      {SECTION_RANGES.map((range) => (
        <ParameterRange
          commitOnRelease
          key={range.key}
          label={range.label}
          max={range.max}
          min={range.min}
          onChange={(value) => onChange({ ...section, [range.key]: value })}
          precision={range.precision}
          step={range.step}
          unit={range.unit}
          value={section[range.key]}
        />
      ))}
    </RiverPanelGroup>
  )
}

const FLOW_DIRECTION_OPTIONS: readonly RiverSelectOption<RiverFlowDirection>[] = [
  { value: 'forward', label: 'Forward' },
  { value: 'reverse', label: 'Reverse' },
]

export function RiverFlowSection({ values, onChange }: SettingsProps) {
  return (
    <RiverPanelGroup title="Flow">
      <RiverSelectField
        disabled={values.flow === 'downhill'}
        label="Direction"
        onChange={(flowDirection) => onChange({ flowDirection })}
        options={FLOW_DIRECTION_OPTIONS}
        value={values.flowDirection}
      />
      <ParameterRange
        commitOnRelease
        label="Speed"
        max={3}
        min={0}
        onChange={(flowSpeed) => onChange({ flowSpeed })}
        precision={1}
        step={0.1}
        unit="m/s"
        value={values.flowSpeed}
      />
      <p className="flex items-center gap-1.5 text-[11px] leading-relaxed text-sidebar-foreground/60">
        <ArrowLeftRight aria-hidden size={13} />
        {values.flow === 'downhill'
          ? 'Direction comes from the solved profile: from the higher end to the lower.'
          : 'Direction follows the first point toward the last; reverse flips the visible current.'}
      </p>
    </RiverPanelGroup>
  )
}

const QUALITY_OPTIONS: readonly RiverSelectOption<WaterQuality>[] = [
  { value: 'pure', label: 'Pure' },
  { value: 'clear', label: 'Clear' },
  { value: 'deep', label: 'Deep' },
  { value: 'swampy', label: 'Swampy' },
]

const SHORELINE_OPTIONS: readonly RiverSelectOption<PondShoreline>[] = [
  { value: 'soft', label: 'Soft bank' },
  { value: 'rocky', label: 'Rocky bank' },
]

export function RiverAppearanceSection({ values, onChange }: SettingsProps) {
  return (
    <RiverPanelGroup title="Appearance">
      <RiverSelectField
        label="Water quality"
        onChange={(quality) => onChange({ quality })}
        options={QUALITY_OPTIONS}
        value={values.quality}
      />
      <RiverSelectField
        label="Shoreline"
        onChange={(shoreline) => onChange({ shoreline })}
        options={SHORELINE_OPTIONS}
        value={values.shoreline}
      />
    </RiverPanelGroup>
  )
}
