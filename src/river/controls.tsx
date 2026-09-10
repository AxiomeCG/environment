'use client'

import { createSceneApi, type AnyNodeId, useScene } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { ArrowLeftRight, Check, MousePointer2, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { useMemo } from 'react'
import { ParameterRange } from '../parameter-range'
import { activateRiverTool } from '../pascal-tool-actions'
import type { PondShoreline, WaterQuality } from '../pond/schema'
import { deriveLandscapeRegion } from '../surroundings/landscape-region'
import { useEnvironmentStore } from '../store'
import { deleteRiver, riverNodeOf, resolveActiveRiverSite, updateRiver } from './actions'
import type { RiverFlowDirection, RiverOutlet, RiverSource } from './schema'
import { cancelRiverInteraction, finishRiverDraft, refreshRiverDraftTerrain } from './tool'
import { useRiverStore, type RiverSettings } from './store'

const QUALITY_OPTIONS: readonly { value: WaterQuality; label: string }[] = [
  { value: 'pure', label: 'Pure' },
  { value: 'clear', label: 'Clear' },
  { value: 'deep', label: 'Deep' },
  { value: 'swampy', label: 'Swampy' },
]

function RiverButton({
  label,
  icon: Icon,
  disabled = false,
  disabledReason,
  destructive = false,
  emphasized = false,
  onClick,
}: {
  label: string
  icon: typeof Plus
  disabled?: boolean
  disabledReason?: string
  destructive?: boolean
  emphasized?: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-md border px-2 font-medium text-xs disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-ring ${
        destructive
          ? 'border-sidebar-border bg-destructive/10 text-destructive enabled:hover:bg-destructive/20'
          : emphasized
            ? 'border-primary bg-primary/15 text-primary enabled:hover:bg-primary/20'
            : 'border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground enabled:hover:bg-sidebar-accent'
      }`}
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

export function RiverControls() {
  const sceneApi = useMemo(() => createSceneApi(useScene), [])
  const nodes = useScene((state) => state.nodes)
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const selection = useViewer((state) => state.selection)
  const draft = useRiverStore((state) => state.draft)
  const editingRiverId = useRiverStore((state) => state.editingRiverId)
  const feedback = useRiverStore((state) => state.feedback)
  const defaultWidth = useRiverStore((state) => state.width)
  const defaultDepth = useRiverStore((state) => state.depth)
  const defaultSource = useRiverStore((state) => state.source)
  const defaultOutlet = useRiverStore((state) => state.outlet)
  const defaultFlowDirection = useRiverStore((state) => state.flowDirection)
  const defaultFlowSpeed = useRiverStore((state) => state.flowSpeed)
  const defaultQuality = useRiverStore((state) => state.quality)
  const defaultShoreline = useRiverStore((state) => state.shoreline)
  const surroundingsSeed = useEnvironmentStore((state) => state.surroundingsSeed)
  const seaOutletAvailable = useMemo(
    () => deriveLandscapeRegion(surroundingsSeed).coast !== null,
    [surroundingsSeed],
  )
  const activeSite = useMemo(
    () =>
      resolveActiveRiverSite(nodes, rootNodeIds, {
        ...selection,
        selectedIds:
          selection.levelId || selection.buildingId || selection.zoneId
            ? []
            : selection.selectedIds,
      }),
    [nodes, rootNodeIds, selection],
  )
  const selectedRiver = useMemo(() => {
    if (selection.selectedIds.length !== 1) return null
    const river = riverNodeOf(nodes[selection.selectedIds[0] as AnyNodeId])
    return river?.parentId === activeSite?.id ? river : null
  }, [activeSite, nodes, selection.selectedIds])
  const values: RiverSettings = selectedRiver
    ? {
        width: selectedRiver.width,
        depth: selectedRiver.depth,
        source: selectedRiver.source,
        outlet: selectedRiver.outlet,
        flowDirection: selectedRiver.flowDirection,
        flowSpeed: selectedRiver.flowSpeed,
        quality: selectedRiver.quality,
        shoreline: selectedRiver.shoreline,
      }
    : {
        width: defaultWidth,
        depth: defaultDepth,
        source: defaultSource,
        outlet: defaultOutlet,
        flowDirection: defaultFlowDirection,
        flowSpeed: defaultFlowSpeed,
        quality: defaultQuality,
        shoreline: defaultShoreline,
      }
  const canStart = Boolean(activeSite)
  const pointCount = draft?.points.length ?? 0
  const pointSummary = draft
    ? `${pointCount} / 128 points`
    : selectedRiver
      ? `${selectedRiver.points.length} points`
      : editingRiverId
        ? 'Editing points'
        : '2-point minimum'
  let pathInstruction: string
  let pathStatus: string
  if (draft) {
    if (pointCount === 0) {
      pathInstruction = 'Click terrain to place the first point. This sets where the river begins.'
      pathStatus = 'Waiting for the first point.'
    } else if (pointCount === 1) {
      pathInstruction =
        'First point set. Click farther along the terrain to create the first channel segment.'
      pathStatus = '1 point registered. Place one more to finish.'
    } else if (pointCount === 2) {
      pathInstruction =
        'Two points set—the minimum. Finish a simple channel now, or keep clicking to shape bends.'
      pathStatus = '2 points registered. The river is ready to finish.'
    } else {
      pathInstruction =
        'Keep clicking to extend the channel, or finish when its course has the shape you want.'
      pathStatus = `${pointCount} points registered. The river is ready to finish.`
    }
  } else if (editingRiverId) {
    pathInstruction =
      'Drag any visible control point to reshape the selected river. Release to apply each change.'
    pathStatus = 'Path editing is active.'
  } else if (!canStart) {
    pathInstruction =
      'River drawing needs an editable Site. Add or select a Site before starting a path.'
    pathStatus = 'River drawing is unavailable because no Site is active.'
  } else if (selectedRiver) {
    pathInstruction =
      'Choose Edit path, then drag its visible control points to reshape the channel.'
    pathStatus = 'River selected and ready to edit.'
  } else {
    pathInstruction =
      'Choose Draw new river, then click along the terrain. Each point bends the channel through it.'
    pathStatus = 'Ready to draw a river.'
  }

  const startNewRiver = () => {
    cancelRiverInteraction()
    const currentSelection = useViewer.getState().selection
    const site = resolveActiveRiverSite(
      useScene.getState().nodes,
      useScene.getState().rootNodeIds,
      {
        ...currentSelection,
        selectedIds:
          currentSelection.levelId ||
          currentSelection.buildingId ||
          currentSelection.zoneId
            ? []
            : currentSelection.selectedIds,
      },
    )
    if (!site) {
      useRiverStore.getState().setFeedback('Select a Site before drawing a river.')
      return
    }
    activateRiverTool(useEditor.getState())
    useViewer.getState().setSelection({ selectedIds: [] })
    useRiverStore.getState().beginDraft(site.id)
  }

  const changeSettings = (patch: Partial<RiverSettings>) => {
    if (
      patch.outlet === 'sea' &&
      !deriveLandscapeRegion(useEnvironmentStore.getState().surroundingsSeed).coast
    ) {
      useRiverStore
        .getState()
        .setFeedback(
          'This Surroundings seed has no coast. Choose a coastal seed before connecting to the sea.',
        )
      return
    }
    if (patch.source === 'mountain' || patch.outlet === 'sea') {
      useEnvironmentStore.getState().setSurroundingsEnabled(true)
    }
    const state = useRiverStore.getState()
    state.setSettings(patch)
    const selected = selectedRiver
    if (selected && !state.draft) {
      const result = updateRiver(sceneApi, selected.id, patch)
      if (result.river) state.adoptRiverSettings(result.river)
      state.setFeedback(result.ok ? describeSettingChange(patch) : result.message)
      return
    }
    if (
      patch.width !== undefined ||
      patch.depth !== undefined ||
      patch.source !== undefined ||
      patch.outlet !== undefined
    ) {
      refreshRiverDraftTerrain(sceneApi)
    }
  }

  const removeLastPoint = () => {
    const state = useRiverStore.getState()
    if (!state.removeLastDraftPoint()) {
      state.setFeedback('There are no river points to remove.')
      return
    }
    refreshRiverDraftTerrain(sceneApi)
    const remaining = useRiverStore.getState().draft?.points.length ?? 0
    state.setFeedback(
      remaining === 0
        ? 'Last point removed. Click terrain to place the first river point.'
        : `Last point removed. ${remaining} ${remaining === 1 ? 'point remains' : 'points remain'}.`,
    )
  }

  const removeSelectedRiver = () => {
    if (!selectedRiver) return
    cancelRiverInteraction()
    const result = deleteRiver(sceneApi, selectedRiver.id)
    if (result.ok) useViewer.getState().setSelection({ selectedIds: [] })
    useRiverStore.getState().setFeedback(result.message)
  }

  const finishPathEditing = () => {
    if (cancelRiverInteraction()) {
      useRiverStore.getState().setFeedback('Path editing finished.')
    }
  }

  const togglePathEditing = () => {
    if (!selectedRiver) return
    const alreadyEditing = editingRiverId === selectedRiver.id
    if (alreadyEditing) {
      finishPathEditing()
      return
    }
    cancelRiverInteraction()
    activateRiverTool(useEditor.getState())
    useRiverStore.getState().editPath(selectedRiver.id)
  }

  const finish = () => {
    const result = finishRiverDraft(sceneApi)
    if (!result.ok) useRiverStore.getState().setFeedback(result.message)
  }

  const cancelDraft = () => {
    if (cancelRiverInteraction()) {
      useRiverStore.getState().setFeedback('River draft canceled. Terrain restored.')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="river-path-heading" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold" id="river-path-heading">
            Path
          </h3>
          <span className="rounded-full bg-sidebar-accent px-2 py-1 font-medium text-[11px] text-sidebar-foreground/70 tabular-nums">
            {pointSummary}
          </span>
        </div>
        <figure className="overflow-hidden rounded-lg border border-sidebar-border bg-sidebar-accent/25 px-3 py-2.5">
          <svg aria-hidden="true" className="h-12 w-full text-primary" viewBox="0 0 240 48">
            <path
              className="stroke-current opacity-20"
              d="M16 35 C58 35 66 12 108 15 S164 43 224 17"
              fill="none"
              strokeLinecap="round"
              strokeWidth="14"
            />
            <path
              className="stroke-current"
              d="M16 35 C58 35 66 12 108 15 S164 43 224 17"
              fill="none"
              strokeLinecap="round"
              strokeWidth="2"
            />
            <circle className="fill-sidebar stroke-current" cx="16" cy="35" r="4" strokeWidth="2" />
            <circle
              className="fill-sidebar stroke-current"
              cx="108"
              cy="15"
              r="4"
              strokeWidth="2"
            />
            <circle
              className="fill-sidebar stroke-current"
              cx="224"
              cy="17"
              r="4"
              strokeWidth="2"
            />
          </svg>
          <figcaption className="text-[11px] leading-relaxed text-sidebar-foreground/65">
            Points set the river centerline; width and depth turn that path into a carved channel.
          </figcaption>
        </figure>
        <p className="text-xs leading-relaxed text-sidebar-foreground/80">{pathInstruction}</p>
        <p
          aria-live="polite"
          className="min-h-8 rounded-md bg-sidebar-accent/40 px-3 py-2 text-xs leading-relaxed text-sidebar-foreground/75"
          role="status"
        >
          {feedback || pathStatus}
        </p>
        {draft ? (
          <>
            <RiverButton
              disabled={pointCount < 2}
              disabledReason="Place at least two river points."
              emphasized
              icon={Check}
              label="Finish river"
              onClick={finish}
            />
            <div className="grid grid-cols-2 gap-2">
              <RiverButton
                disabled={pointCount === 0}
                disabledReason="Place a river point before removing one."
                icon={RotateCcw}
                label="Remove last point"
                onClick={removeLastPoint}
              />
              <RiverButton icon={X} label="Cancel" onClick={cancelDraft} />
            </div>
          </>
        ) : editingRiverId ? (
          <RiverButton
            emphasized
            icon={Check}
            label="Done editing path"
            onClick={finishPathEditing}
          />
        ) : (
          <>
            {selectedRiver ? (
              <RiverButton
                emphasized
                icon={MousePointer2}
                label="Edit path"
                onClick={togglePathEditing}
              />
            ) : null}
            <RiverButton
              disabled={!canStart}
              disabledReason="Add or select an editable Site first."
              emphasized={!selectedRiver}
              icon={Plus}
              label="Draw new river"
              onClick={startNewRiver}
            />
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold">Channel</h3>
        <ParameterRange
          commitOnRelease
          label="Width"
          max={24}
          min={1}
          onChange={(width) => changeSettings({ width })}
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
          onChange={(depth) => changeSettings({ depth })}
          precision={1}
          step={0.1}
          unit="m"
          value={values.depth}
        />
        <label className="flex min-h-10 items-center justify-between gap-3 text-xs">
          <span>First endpoint</span>
          <select
            className="h-9 rounded-md border border-sidebar-border bg-transparent px-3 text-sidebar-foreground text-xs focus-visible:outline-2 focus-visible:outline-ring"
            onChange={(event) => changeSettings({ source: event.target.value as RiverSource })}
            value={values.source}
          >
            <option value="rounded">Rounded</option>
            <option value="mountain">Mountain source</option>
          </select>
        </label>
        <label className="flex min-h-10 items-center justify-between gap-3 text-xs">
          <span>Last endpoint</span>
          <select
            className="h-9 rounded-md border border-sidebar-border bg-transparent px-3 text-sidebar-foreground text-xs focus-visible:outline-2 focus-visible:outline-ring"
            onChange={(event) => changeSettings({ outlet: event.target.value as RiverOutlet })}
            value={values.outlet}
          >
            <option value="rounded">Rounded</option>
            <option disabled={!seaOutletAvailable} value="sea">
              Sea outlet
            </option>
          </select>
        </label>
        <p className="text-[11px] leading-relaxed text-sidebar-foreground/60">
          Mountain and sea connections continue procedurally beyond the Site; the authored river and
          its exports stay inside the Site.
        </p>
        {!seaOutletAvailable ? (
          <p className="text-[11px] leading-relaxed text-sidebar-foreground/60">
            Sea outlet is unavailable because the current Surroundings seed has no coast.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold">Flow</h3>
        <label className="flex min-h-10 items-center justify-between gap-3 text-xs">
          <span>Direction</span>
          <select
            className="h-9 rounded-md border border-sidebar-border bg-transparent px-3 text-sidebar-foreground text-xs focus-visible:outline-2 focus-visible:outline-ring"
            onChange={(event) =>
              changeSettings({ flowDirection: event.target.value as RiverFlowDirection })
            }
            value={values.flowDirection}
          >
            <option value="forward">Forward</option>
            <option value="reverse">Reverse</option>
          </select>
        </label>
        <ParameterRange
          commitOnRelease
          label="Speed"
          max={3}
          min={0}
          onChange={(flowSpeed) => changeSettings({ flowSpeed })}
          precision={1}
          step={0.1}
          unit="m/s"
          value={values.flowSpeed}
        />
        <p className="flex items-center gap-1.5 text-[11px] leading-relaxed text-sidebar-foreground/60">
          <ArrowLeftRight aria-hidden size={13} />
          Direction follows the first point toward the last; reverse flips the visible current.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold">Appearance</h3>
        <label className="flex min-h-10 items-center justify-between gap-3 text-xs">
          <span>Water quality</span>
          <select
            className="h-9 rounded-md border border-sidebar-border bg-transparent px-3 text-sidebar-foreground text-xs focus-visible:outline-2 focus-visible:outline-ring"
            onChange={(event) => changeSettings({ quality: event.target.value as WaterQuality })}
            value={values.quality}
          >
            {QUALITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-10 items-center justify-between gap-3 text-xs">
          <span>Shoreline</span>
          <select
            className="h-9 rounded-md border border-sidebar-border bg-transparent px-3 text-sidebar-foreground text-xs focus-visible:outline-2 focus-visible:outline-ring"
            onChange={(event) => changeSettings({ shoreline: event.target.value as PondShoreline })}
            value={values.shoreline}
          >
            <option value="soft">Soft bank</option>
            <option value="rocky">Rocky bank</option>
          </select>
        </label>
      </section>

      {selectedRiver ? (
        <section className="flex flex-col gap-2 border-t border-sidebar-border pt-4">
          <RiverButton
            destructive
            icon={Trash2}
            label="Delete river"
            onClick={removeSelectedRiver}
          />
        </section>
      ) : null}
    </div>
  )
}

function describeSettingChange(patch: Partial<RiverSettings>): string {
  if (patch.source) {
    return patch.source === 'mountain'
      ? 'First endpoint connected to a procedural mountain source.'
      : 'First endpoint changed to a rounded cap.'
  }
  if (patch.outlet) {
    return patch.outlet === 'sea'
      ? 'Last endpoint connected to the procedural sea.'
      : 'Last endpoint changed to a rounded cap.'
  }
  if (patch.flowDirection) return `River flow changed to ${patch.flowDirection}.`
  if (patch.flowSpeed !== undefined) return 'River flow speed updated.'
  if (patch.width !== undefined) return 'River width and terrain channel updated.'
  if (patch.depth !== undefined) return 'River depth and terrain channel updated.'
  if (patch.quality) return `River water changed to ${patch.quality}.`
  if (patch.shoreline)
    return patch.shoreline === 'rocky' ? 'Rocky riverbank added.' : 'Soft riverbank selected.'
  return 'River updated.'
}

export default RiverControls
