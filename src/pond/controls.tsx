'use client'

import { terrainFieldOf, type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  type LucideIcon,
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleOff,
  Eraser,
  FishSymbol,
  Flower2,
  Mountain,
  MousePointer2,
  PaintBucket,
  Trash2,
} from 'lucide-react'
import { useId, useMemo } from 'react'
import { useEnvironmentStore, type PondToolMode, type PondToolTarget } from '../store'
import {
  commitClearPondProps,
  commitPondLevelAction,
  commitPondQuality,
  commitPondShoreline,
  formatMetres,
  inspectPondTarget,
  pondNodeOf,
  resolveActivePondSite,
  type PondLevelAction,
  type PondSceneNodes,
} from './actions'
import { POND_LEVEL_STEP, type PondShoreline, type WaterQuality } from './schema'

const QUALITY_OPTIONS: readonly {
  value: WaterQuality
  label: string
  description: string
}[] = [
  { value: 'pure', label: 'Pure', description: 'Bright, pale blue water.' },
  { value: 'clear', label: 'Clear', description: 'Natural transparent blue-green water.' },
  { value: 'deep', label: 'Deep', description: 'Darker blue water with stronger depth.' },
  { value: 'swampy', label: 'Swampy', description: 'Muted green-brown pond water.' },
]

const PROP_MODE_OPTIONS: readonly {
  value: PondToolMode
  label: string
  icon: LucideIcon
}[] = [
  { value: 'select-basin', label: 'Select', icon: MousePointer2 },
  { value: 'water-lily', label: 'Lilies', icon: Flower2 },
  { value: 'koi', label: 'Koi', icon: FishSymbol },
  { value: 'remove-prop', label: 'Remove', icon: Eraser },
]


const INSTRUCTION_BY_MODE: Record<PondToolMode, string> = {
  'select-basin': 'Click terrain inside a depression to select its whole basin.',
  'water-lily': 'Click the selected pond water to place a lily.',
  koi: 'Click water at least 0.20 m deep to place a koi.',
  'remove-prop': 'Click close to a lily or koi to remove it.',
}
function selectedPondTarget(
  nodes: PondSceneNodes,
  selectedIds: readonly string[],
): PondToolTarget | null {
  if (selectedIds.length !== 1) return null
  const pond = pondNodeOf(nodes[selectedIds[0] as AnyNodeId])
  if (!pond?.parentId) return null
  return {
    siteId: String(pond.parentId),
    seed: [pond.seed[0], pond.seed[1]],
    pondId: pond.id,
  }
}

function PondButton({
  label,
  icon: Icon,
  disabled = false,
  disabledReason,
  onClick,
}: {
  label: string
  icon: LucideIcon
  disabled?: boolean
  disabledReason?: string
  onClick: () => void
}) {
  return (
    <button
      className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2 font-medium text-sidebar-foreground text-xs enabled:hover:bg-sidebar-accent disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-ring"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? disabledReason : undefined}
      type="button"
    >
      <Icon aria-hidden size={15} />
      {label}
    </button>
  )
}

export function PondControls({ onSculptTerrain }: { onSculptTerrain: () => void }) {
  const nodes = useScene((state) => state.nodes)
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const selection = useViewer((state) => state.selection)
  const storedTarget = useEnvironmentStore((state) => state.pondTarget)
  const quality = useEnvironmentStore((state) => state.pondQuality)
  const mode = useEnvironmentStore((state) => state.pondToolMode)
  const feedback = useEnvironmentStore((state) => state.pondFeedback)
  const setTarget = useEnvironmentStore((state) => state.setPondTarget)
  const setQuality = useEnvironmentStore((state) => state.setPondQuality)
  const setMode = useEnvironmentStore((state) => state.setPondToolMode)
  const setFeedback = useEnvironmentStore((state) => state.setPondFeedback)
  const selectedTarget = useMemo(
    () => selectedPondTarget(nodes, selection.selectedIds),
    [nodes, selection.selectedIds],
  )
  const target =
    selectedTarget ?? (selection.selectedIds.length === 0 ? storedTarget : null)
  const info = useMemo(() => inspectPondTarget(nodes, target), [nodes, target])
  const levelStep = info?.basin.levelStep ?? POND_LEVEL_STEP
  const site = useMemo(
    () => resolveActivePondSite(nodes, rootNodeIds, selection),
    [nodes, rootNodeIds, selection],
  )
  const hasTerrain = Boolean(site && terrainFieldOf(site))
  const selectedQuality = info?.pond?.quality ?? quality
  const props = info?.pond?.props ?? []
  let koiCount = 0
  for (const prop of props) {
    if (prop.kind === 'koi') koiCount += 1
  }
  const lilyCount = props.length - koiCount

  const commitLevel = (action: PondLevelAction) => {
    const store = useEnvironmentStore.getState()
    const result = commitPondLevelAction(useScene.getState(), target, action, store.pondQuality)
    if (result.target) setTarget(result.target)
    if (result.ok && result.target?.pondId) {
      useViewer.getState().setSelection({
        selectedIds: [result.target.pondId as AnyNodeId],
      })
    }
    setFeedback(result.message)
  }

  const changeQuality = (nextQuality: WaterQuality) => {
    setQuality(nextQuality)
    const result = commitPondQuality(useScene.getState(), target, nextQuality)
    if (result.target) setTarget(result.target)
    setFeedback(result.message)
  }

  const changeShoreline = (shoreline: PondShoreline) => {
    const result = commitPondShoreline(useScene.getState(), target, shoreline)
    if (result.target) setTarget(result.target)
    setFeedback(result.message)
  }

  const changeMode = (nextMode: PondToolMode) => {
    setMode(nextMode)
    setFeedback(INSTRUCTION_BY_MODE[nextMode])
  }

  const clearProps = () => {
    const result = commitClearPondProps(useScene.getState(), target)
    if (result.target) setTarget(result.target)
    setFeedback(result.message)
  }

  const noBasinReason = 'Select a contained terrain depression first.'
  const noWaterReason = info?.pond ? 'The selected pond is empty.' : 'Add water to this basin first.'

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold">Basin</h3>
        {info ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-sidebar-border bg-sidebar-accent/30 p-3 text-xs">
            <dt className="text-sidebar-foreground/60">Water level</dt>
            <dd className="text-right font-mono">
              {info.level === null ? 'Empty' : formatMetres(info.level)}
            </dd>
            <dt className="text-sidebar-foreground/60">Spill level</dt>
            <dd className="text-right font-mono">{formatMetres(info.basin.spillLevel)}</dd>
            <dt className="text-sidebar-foreground/60">Max depth</dt>
            <dd className="text-right font-mono">{formatMetres(info.maxDepth)}</dd>
          </dl>
        ) : (
          <p className="rounded-lg border border-sidebar-border p-3 text-xs leading-relaxed text-sidebar-foreground/70">
            {hasTerrain
              ? 'Click inside an enclosed low point. A click on its slope selects the connected depression below.'
              : 'Water needs editable terrain with a contained depression.'}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <PondButton
            disabled={!info}
            disabledReason={noBasinReason}
            icon={ArrowUpFromLine}
            label={`Raise ${levelStep.toFixed(2)} m`}
            onClick={() => commitLevel('raise')}
          />
          <PondButton
            disabled={!info?.pond || info.level === null}
            disabledReason={noWaterReason}
            icon={ArrowDownToLine}
            label={`Lower ${levelStep.toFixed(2)} m`}
            onClick={() => commitLevel('lower')}
          />
          <PondButton
            disabled={!info}
            disabledReason={noBasinReason}
            icon={PaintBucket}
            label="Fill to spill"
            onClick={() => commitLevel('fill')}
          />
          <PondButton
            disabled={!info?.pond || info.level === null}
            disabledReason={noWaterReason}
            icon={CircleOff}
            label="Empty"
            onClick={() => commitLevel('empty')}
          />
        </div>
        <p className="text-[11px] leading-relaxed text-sidebar-foreground/60">
          Contours are {levelStep.toFixed(2)} m apart. Water cannot rise above the spill level.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <label className="flex min-h-10 items-center justify-between gap-3 text-xs">
          <span className="font-semibold">Water quality</span>
          <select
            aria-describedby="pond-quality-description"
            className="h-9 rounded-md border border-sidebar-border bg-transparent px-3 text-sidebar-foreground text-xs focus-visible:outline-2 focus-visible:outline-ring"
            onChange={(event) => changeQuality(event.target.value as WaterQuality)}
            value={selectedQuality}
          >
            {QUALITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p id="pond-quality-description" className="text-[11px] leading-relaxed text-sidebar-foreground/60">
          {QUALITY_OPTIONS.find((option) => option.value === selectedQuality)?.description}
          {!info?.pond ? ' This preset will be used when the basin first receives water.' : ''}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <label className="flex min-h-10 items-center justify-between gap-3 text-xs">
          <span className="font-semibold">Shoreline</span>
          <select
            aria-describedby="pond-shoreline-description"
            className="h-9 rounded-md border border-sidebar-border bg-transparent px-3 text-sidebar-foreground text-xs disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-ring"
            disabled={!info?.pond}
            onChange={(event) => changeShoreline(event.target.value as PondShoreline)}
            value={info?.pond?.shoreline ?? 'soft'}
          >
            <option value="soft">Soft bank</option>
            <option value="rocky">Rocky bank</option>
          </select>
        </label>
        <p id="pond-shoreline-description" className="text-[11px] leading-relaxed text-sidebar-foreground/60">
          {!info?.pond
            ? 'Add water to choose a shoreline treatment.'
            : info.pond.shoreline === 'rocky'
              ? 'Natural stones follow the waterline and the sculpted terrain.'
              : 'A gentle shallow-water transition blends into the bank.'}
        </p>
      </section>

      <PondPropMode value={mode} onChange={changeMode} />

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold">Water props</h3>
          <span className="font-mono text-[11px] text-sidebar-foreground/60">
            {lilyCount} lilies · {koiCount}/32 koi
          </span>
        </div>
        <PondButton
          disabled={props.length === 0}
          disabledReason="This pond has no props to clear."
          icon={Trash2}
          label="Clear props"
          onClick={clearProps}
        />
        <p className="text-[11px] leading-relaxed text-sidebar-foreground/60">
          Up to 128 props per pond. Dry props are retained and reappear when water returns.
        </p>
      </section>

      {!info ? (
        <section className="flex flex-col gap-2 border-t border-sidebar-border pt-4">
          <h3 className="text-xs font-semibold">Need a deeper basin?</h3>
          <p className="text-xs leading-relaxed text-sidebar-foreground/60">
            Use Pascal Terrain to lower the centre and keep a higher rim around it.
          </p>
          <PondButton icon={Mountain} label="Sculpt Terrain" onClick={onSculptTerrain} />
        </section>
      ) : null}

      <p
        aria-live="polite"
        className="min-h-8 rounded-md bg-sidebar-accent/35 px-3 py-2 text-xs leading-relaxed text-sidebar-foreground/70"
        role="status"
      >
        {feedback || 'Select a depression, then raise one contour interval or fill it to the spill level.'}
      </p>
    </div>
  )
}

function PondPropMode({
  value,
  onChange,
}: {
  value: PondToolMode
  onChange: (mode: PondToolMode) => void
}) {
  const name = useId()
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-xs font-semibold">Canvas action</legend>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-sidebar-accent/50 p-1">
        {PROP_MODE_OPTIONS.map((option) => {
          const Icon = option.icon
          return (
            <label className="relative min-w-0 cursor-pointer" key={option.value}>
              <input
                checked={value === option.value}
                className="peer sr-only"
                name={name}
                onChange={() => onChange(option.value)}
                type="radio"
                value={option.value}
              />
              <span className="flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent peer-checked:bg-sidebar-accent peer-checked:text-primary peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-ring">
                <Icon aria-hidden size={14} />
                {option.label}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export default PondControls
