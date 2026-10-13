'use client'

import { createSceneApi, type AnyNodeId, type SceneApi, type SiteNode, useScene } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { activateRiverTool } from '../pascal-tool-actions'
import { deriveLandscapeRegion } from '../surroundings/landscape-region'
import { useEnvironmentStore } from '../store'
import {
  deleteRiver,
  riverNodeOf,
  resolveActiveRiverSite,
  riversForSite,
  updateRiver,
  type RiverSelectionContext,
} from './actions'
import { RiverButton } from './controls-fields'
import {
  RiverAppearanceSection,
  RiverChannelSection,
  RiverCrossSectionControls,
  RiverFlowSection,
  RiverPathSection,
  RiverPointSizeControls,
  RiverProfileSection,
  type RiverPathActions,
  type RiverPathState,
} from './controls-sections'
import type { RiverNode } from './schema'
import { riverSettingsOf, useRiverStore, type RiverSettings } from './store'
import {
  cancelRiverInteraction,
  draftPreviewNode,
  finishRiverDraft,
  refreshRiverDraftTerrain,
} from './tool'

export function RiverControls() {
  const panel = useRiverPanel()
  const { sceneApi, selectedRiver, values } = panel
  const changeSettings = (patch: Partial<RiverSettings>) =>
    changeRiverSettings(sceneApi, selectedRiver, patch)
  return (
    <div className="flex flex-col gap-5">
      <RiverPathSection actions={riverPathActions(sceneApi, selectedRiver)} state={panel.path} />
      <RiverChannelSection
        onChange={changeSettings}
        seaOutletAvailable={panel.seaOutletAvailable}
        values={values}
      />
      {selectedRiver ? <RiverPointSizeControls river={selectedRiver} sceneApi={sceneApi} /> : null}
      <RiverProfileSection
        onChange={changeSettings}
        river={panel.plannedRiver}
        siblings={panel.siblingRivers}
        site={panel.activeSite}
        values={values}
      />
      <RiverCrossSectionControls
        onChange={(section) => changeSettings({ section })}
        section={values.section}
      />
      <RiverFlowSection onChange={changeSettings} values={values} />
      <RiverAppearanceSection onChange={changeSettings} values={values} />
      {selectedRiver ? (
        <section className="flex flex-col gap-2 border-t border-sidebar-border pt-4">
          <RiverButton
            destructive
            icon={Trash2}
            label="Delete river"
            onClick={() => deleteSelectedRiver(sceneApi, selectedRiver)}
          />
        </section>
      ) : null}
    </div>
  )
}

type RiverPanel = Readonly<{
  sceneApi: SceneApi
  activeSite: SiteNode | null
  selectedRiver: RiverNode | null
  /** The selected river, or the draft being drawn: the one whose plan the panel reports. */
  plannedRiver: RiverNode | null
  /** The active Site's other rivers, which the planned one may meet. */
  siblingRivers: readonly RiverNode[]
  values: RiverSettings
  seaOutletAvailable: boolean
  path: RiverPathState
}>

/** Everything the panel shows, derived from the scene, the selection and the river store. */
function useRiverPanel(): RiverPanel {
  const sceneApi = useMemo(() => createSceneApi(useScene), [])
  const nodes = useScene((state) => state.nodes)
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const selection = useViewer((state) => state.selection)
  const draft = useRiverStore((state) => state.draft)
  const editingRiverId = useRiverStore((state) => state.editingRiverId)
  const feedback = useRiverStore((state) => state.feedback)
  const storedSettings = useRiverStore(useShallow(riverSettingsOf))
  const surroundingsSeed = useEnvironmentStore((state) => state.surroundingsSeed)
  const seaOutletAvailable = useMemo(
    () => deriveLandscapeRegion(surroundingsSeed).coast !== null,
    [surroundingsSeed],
  )
  const activeSite = useMemo(
    () => resolveActiveRiverSite(nodes, rootNodeIds, siteSelectionContext(selection)),
    [nodes, rootNodeIds, selection],
  )
  const selectedRiver = useMemo(() => {
    if (selection.selectedIds.length !== 1) return null
    const river = riverNodeOf(nodes[selection.selectedIds[0] as AnyNodeId])
    return river?.parentId === activeSite?.id ? river : null
  }, [activeSite, nodes, selection.selectedIds])
  const plannedRiver = selectedRiver ?? (draft ? draftPreviewNode() : null)
  const plannedRiverId = plannedRiver?.id ?? null
  const siblingRivers = useMemo(
    () =>
      activeSite
        ? riversForSite(nodes, activeSite.id).filter((river) => river.id !== plannedRiverId)
        : [],
    [activeSite, nodes, plannedRiverId],
  )
  return {
    sceneApi,
    activeSite,
    selectedRiver,
    plannedRiver,
    siblingRivers,
    values: selectedRiver ? riverSettingsOf(selectedRiver) : storedSettings,
    seaOutletAvailable,
    path: {
      draftPointCount: draft ? draft.points.length : null,
      editing: Boolean(editingRiverId),
      canStart: Boolean(activeSite),
      selectedPointCount: selectedRiver ? selectedRiver.points.length : null,
      feedback,
    },
  }
}

/** A selection inside a level, building or zone points at the Site through that context. */
function siteSelectionContext<Selection extends RiverSelectionContext>(
  selection: Selection,
): Selection {
  return {
    ...selection,
    selectedIds:
      selection.levelId || selection.buildingId || selection.zoneId ? [] : selection.selectedIds,
  }
}

function riverPathActions(sceneApi: SceneApi, selectedRiver: RiverNode | null): RiverPathActions {
  return {
    startNewRiver,
    togglePathEditing: () => {
      if (selectedRiver) togglePathEditing(selectedRiver)
    },
    finishPathEditing,
    finishDraft: () => {
      const result = finishRiverDraft(sceneApi)
      if (!result.ok) useRiverStore.getState().setFeedback(result.message)
    },
    removeLastPoint: () => removeLastDraftPoint(sceneApi),
    cancelDraft: () => {
      if (cancelRiverInteraction()) {
        useRiverStore.getState().setFeedback('River draft canceled. Terrain restored.')
      }
    },
  }
}

function startNewRiver(): void {
  cancelRiverInteraction()
  const { nodes, rootNodeIds } = useScene.getState()
  const site = resolveActiveRiverSite(
    nodes,
    rootNodeIds,
    siteSelectionContext(useViewer.getState().selection),
  )
  if (!site) {
    useRiverStore.getState().setFeedback('Select a Site before drawing a river.')
    return
  }
  activateRiverTool(useEditor.getState())
  useViewer.getState().setSelection({ selectedIds: [] })
  useRiverStore.getState().beginDraft(site.id)
}

function finishPathEditing(): void {
  if (cancelRiverInteraction()) useRiverStore.getState().setFeedback('Path editing finished.')
}

function togglePathEditing(river: RiverNode): void {
  if (useRiverStore.getState().editingRiverId === river.id) {
    finishPathEditing()
    return
  }
  cancelRiverInteraction()
  activateRiverTool(useEditor.getState())
  useRiverStore.getState().editPath(river.id)
}

function removeLastDraftPoint(sceneApi: SceneApi): void {
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

function deleteSelectedRiver(sceneApi: SceneApi, river: RiverNode): void {
  cancelRiverInteraction()
  const result = deleteRiver(sceneApi, river.id)
  if (result.ok) useViewer.getState().setSelection({ selectedIds: [] })
  useRiverStore.getState().setFeedback(result.message)
}

/** Settings that change the carved channel, so a draft's preview terrain must follow. */
const GRADING_SETTINGS: readonly (keyof RiverSettings)[] = [
  'width',
  'depth',
  'source',
  'outlet',
  'flow',
  'maxSlopePct',
  'section',
  'ends',
]

/** Apply a panel change to the selected river, or to the defaults for the next draft. */
function changeRiverSettings(
  sceneApi: SceneApi,
  selectedRiver: RiverNode | null,
  patch: Partial<RiverSettings>,
): void {
  const seaUnavailable =
    patch.outlet === 'sea' &&
    !deriveLandscapeRegion(useEnvironmentStore.getState().surroundingsSeed).coast
  if (seaUnavailable) {
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
  if (selectedRiver && !state.draft) {
    const result = updateRiver(sceneApi, selectedRiver.id, patch)
    if (result.river) state.adoptRiverSettings(result.river)
    state.setFeedback(result.ok ? describeSettingChange(patch) : result.message)
    return
  }
  if (GRADING_SETTINGS.some((key) => patch[key] !== undefined)) refreshRiverDraftTerrain(sceneApi)
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
  if (patch.flow)
    return patch.flow === 'downhill'
      ? 'Water now flows downhill only; terrain channel updated.'
      : 'Water now follows the ground as drawn; terrain channel updated.'
  if (patch.maxSlopePct !== undefined) return 'Maximum water slope and terrain channel updated.'
  if (patch.section) return 'Cross-section and terrain channel updated.'
  if (patch.ends) return 'River end caps and terrain channel updated.'
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
