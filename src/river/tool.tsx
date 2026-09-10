'use client'

import {
  diffToPatches,
  emitter,
  raycastTerrain,
  surfaceHeightAt,
  persistedTerrainFieldOf,
  terrainFieldOf,
  useLiveTerrain,
  type AnyNode,
  type AnyNodeId,
  type SceneApi,
  type SiteNode,
  type TerrainField,
} from '@pascal-app/core'
import {
  EDITOR_LAYER,
  markToolCancelConsumed,
  NO_RAYCAST,
  useInteractionScope,
  useRegistryToolContext,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Group,
  InstancedMesh,
  Mesh,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
  type Material,
  type Object3D,
} from 'three'
import { useSceneApiNodes } from '../use-scene-api-nodes'
import { sampleRoadAlignmentPoints } from '../surroundings/streetscape/road-network-geometry'
import {
  createRiver,
  riverNodeOf,
  resolveActiveRiverSite,
  riversForSite,
  updateRiver,
  type RiverActionResult,
} from './actions'
import {
  beginRiverControlPointScope,
  claimRiverGesture,
  endRiverControlPointScope,
  endRiverControlPointScopeForNode,
  endRiverDraftingScope,
  ensureRiverDraftingScope,
  ownsRiverControlPointScope,
  ownsRiverDraftingScope,
  ownsRiverGesture,
  publishRiverNodePreview,
  retainRiverNodePreview,
  releaseRiverGesture,
  retainRiverToolBody,
  retainRiverDraftingScope,
} from './interaction'
import { buildRiverPreviewGeometry } from './geometry'
import { RiverNode as RiverNodeSchema } from './schema'
import type { RiverNode, RiverPoint } from './schema'
import { useRiverStore } from './store'
import { rebuildRiverTerrain, riverTerrainBaseline, sampleRiverPath } from './terrain'

const CLICK_TOLERANCE_SQUARED = 25
const MAX_RIVER_POINTS = 128
const PREVIEW_PATCH_BYTES = Number.MAX_SAFE_INTEGER

type PointerStart = {
  pointerId: number
  clientX: number
  clientY: number
  siteId: string
  moved: boolean
}

type PointDrag = {
  pointerId: number
  siteId: string
  pointIndex: number
  original: RiverNode
  preview: RiverNode
}

export function draftPreviewNode(): RiverNode | null {
  const state = useRiverStore.getState()
  const draft = state.draft
  if (!draft) return null
  const points = [...draft.points]
  const cursor = draft.cursor
  const last = points.at(-1)
  if (cursor && (!last || Math.hypot(cursor[0] - last[0], cursor[1] - last[1]) >= 0.01)) {
    points.push(cursor)
  }
  if (points.length < 2) return null
  const parsed = RiverNodeSchema.safeParse({
    id: 'river_preview',
    parentId: draft.siteId,
    name: 'River preview',
    points,
    width: state.width,
    depth: state.depth,
    source: state.source,
    outlet: state.outlet,
    flowDirection: state.flowDirection,
    flowSpeed: state.flowSpeed,
    quality: state.quality,
    shoreline: state.shoreline,
  })
  return parsed.success ? parsed.data : null
}

export function endRiverLiveTerrain(siteId: string | null): void {
  if (siteId) useLiveTerrain.getState().end(siteId)
}

export function authoringBaseline(site: SiteNode): TerrainField {
  return persistedTerrainFieldOf(site) ?? rebuildRiverTerrain(site, []).terrain
}

export function previewTerrainForRiver(
  site: SiteNode,
  river: RiverNode,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): void {
  const persisted = authoringBaseline(site)
  const riverSiblings = riversForSite(nodes, site.id)
  const hasPersistedRiver = riverSiblings.some((candidate) => candidate.id === river.id)
  const rivers = hasPersistedRiver
    ? riverSiblings.map((candidate) => (candidate.id === river.id ? river : candidate))
    : [...riverSiblings, river]
  const rebuilt = rebuildRiverTerrain(site, rivers)
  const liveTerrain = useLiveTerrain.getState()
  const current = liveTerrain.strokeOf(site.id)
  const before = current?.field ?? persisted
  const patches = diffToPatches(before, rebuilt.terrain, PREVIEW_PATCH_BYTES)
  if (patches.length === 0) return
  if (!current) liveTerrain.begin(site.id, persisted)
  for (const patch of patches) liveTerrain.advance(site.id, rebuilt.terrain, patch)
}

export function refreshRiverDraftTerrain(sceneApi: SceneApi): boolean {
  const preview = draftPreviewNode()
  const draft = useRiverStore.getState().draft
  if (!draft) return false
  const nodes = sceneApi.nodes()
  const site = nodes[draft.siteId as AnyNodeId]
  if (site?.type !== 'site') {
    endRiverLiveTerrain(draft.siteId)
    return false
  }
  if (!preview) {
    endRiverLiveTerrain(draft.siteId)
    return false
  }
  previewTerrainForRiver(site as SiteNode, preview, nodes)
  return true
}

export function finishRiverDraft(sceneApi: SceneApi): RiverActionResult {
  const state = useRiverStore.getState()
  const draft = state.draft
  if (!draft) return { ok: false, message: 'Start a new river before finishing.' }
  const result = createRiver(sceneApi, draft.siteId, {
    points: draft.points,
    width: state.width,
    depth: state.depth,
    source: state.source,
    outlet: state.outlet,
    flowDirection: state.flowDirection,
    flowSpeed: state.flowSpeed,
    quality: state.quality,
    shoreline: state.shoreline,
  })
  if (!result.ok) {
    state.setFeedback(result.message)
    return result
  }
  endRiverLiveTerrain(draft.siteId)
  endRiverDraftingScope()
  state.cancelRiverInteraction()
  if (result.river) {
    useViewer.getState().setSelection({ selectedIds: [result.river.id as AnyNodeId] })
    useRiverStore.getState().adoptRiverSettings(result.river)
    useRiverStore.getState().setFeedback(result.message)
  }
  return result
}

export function cancelRiverInteraction(): boolean {
  const state = useRiverStore.getState()
  const editingRiverId = state.editingRiverId
  const siteId = state.draft?.siteId ?? state.previewRiver?.parentId ?? null
  const hadInteraction = Boolean(state.draft || editingRiverId || state.previewRiver)
  endRiverLiveTerrain(siteId ? String(siteId) : null)
  endRiverDraftingScope()
  if (editingRiverId) endRiverControlPointScopeForNode(editingRiverId)
  state.cancelRiverInteraction()
  useViewer.getState().setInputDragging(false)
  return hadInteraction
}

export function RiverTool() {
  const { camera, gl, scene } = useThree()
  const { activeLevelId, isCameraDragging, sceneApi } = useRegistryToolContext()
  const nodes = useSceneApiNodes(sceneApi)
  const selection = useViewer((state) => state.selection)
  const draft = useRiverStore((state) => state.draft)
  const editingRiverId = useRiverStore((state) => state.editingRiverId)
  const previewRiver = useRiverStore((state) => state.previewRiver)
  const width = useRiverStore((state) => state.width)
  const depth = useRiverStore((state) => state.depth)
  const source = useRiverStore((state) => state.source)
  const outlet = useRiverStore((state) => state.outlet)
  const flowDirection = useRiverStore((state) => state.flowDirection)
  const flowSpeed = useRiverStore((state) => state.flowSpeed)
  const quality = useRiverStore((state) => state.quality)
  const shoreline = useRiverStore((state) => state.shoreline)
  const activeSite = useMemo(
    () =>
      resolveActiveRiverSite(nodes, [], {
        ...selection,
        selectedIds: activeLevelId ? [] : selection.selectedIds,
        levelId: activeLevelId ? String(activeLevelId) : selection.levelId,
      }),
    [activeLevelId, nodes, selection],
  )
  const selectedRiver = useMemo(() => {
    if (selection.selectedIds.length !== 1) return null
    const river = riverNodeOf(nodes[selection.selectedIds[0] as AnyNodeId])
    return river?.parentId === activeSite?.id ? river : null
  }, [activeSite, nodes, selection.selectedIds])
  const pointerStart = useRef<PointerStart | null>(null)
  const pointDrag = useRef<PointDrag | null>(null)
  const gestureOwner = useRef(Symbol('river-3d-gesture'))
  const liveSiteId = useRef<string | null>(null)
  const raycaster = useRef(new Raycaster())
  const pointer = useRef(new Vector2())
  const previewRiverId = previewRiver?.id

  useEffect(() => {
    if (!previewRiverId) return
    return retainRiverNodePreview(sceneApi, previewRiverId)
  }, [previewRiverId, sceneApi])

  useEffect(() => {
    if (!previewRiver) return
    publishRiverNodePreview(sceneApi, previewRiver)
  }, [previewRiver, sceneApi])

  const terrainPoint = useCallback(
    (event: PointerEvent, site: SiteNode): RiverPoint | null => {
      // Match the control points' original surface, not the excavated bed.
      const terrain = riverTerrainBaseline(site) ?? authoringBaseline(site)
      const rect = gl.domElement.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      pointer.current.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.current.setFromCamera(pointer.current, camera)
      const ray = raycaster.current.ray
      const hit = raycastTerrain(
        terrain,
        [ray.origin.x, ray.origin.y, ray.origin.z],
        [ray.direction.x, ray.direction.y, ray.direction.z],
      )
      return hit ? [hit.x, hit.z] : null
    },
    [camera, gl],
  )

  const cancelPointDrag = useCallback(() => {
    const active = pointDrag.current
    if (!active) return
    pointDrag.current = null
    if (gl.domElement.hasPointerCapture(active.pointerId)) {
      gl.domElement.releasePointerCapture(active.pointerId)
    }
    endRiverControlPointScope(active.original.id, active.pointIndex, 'tool')
    releaseRiverGesture(gestureOwner.current)
    endRiverLiveTerrain(active.siteId)
    liveSiteId.current = null
    useRiverStore.getState().setPreviewRiver(null)
    useViewer.getState().setInputDragging(false)
    gl.domElement.style.cursor = ''
  }, [gl])
  useEffect(
    () =>
      useInteractionScope.subscribe(() => {
        const drag = pointDrag.current
        if (drag && !ownsRiverControlPointScope(drag.original.id, drag.pointIndex, 'tool')) {
          cancelPointDrag()
        }
        if (pointerStart.current && !ownsRiverDraftingScope()) {
          pointerStart.current = null
          releaseRiverGesture(gestureOwner.current)
          const currentDraft = useRiverStore.getState().draft
          if (currentDraft) {
            useRiverStore.getState().setDraftCursor(null)
            endRiverLiveTerrain(currentDraft.siteId)
            liveSiteId.current = null
          }
        }
      }),
    [cancelPointDrag],
  )

  const beginPointDrag = useCallback(
    (river: RiverNode, pointIndex: number, event: ThreeEvent<PointerEvent>) => {
      if (
        event.button !== 0 ||
        pointDrag.current ||
        isCameraDragging() ||
        !river.parentId ||
        !claimRiverGesture(gestureOwner.current)
      ) {
        return
      }
      if (!beginRiverControlPointScope(river.id, pointIndex, 'tool')) {
        releaseRiverGesture(gestureOwner.current)
        return
      }
      const site = nodes[river.parentId as AnyNodeId]
      if (site?.type !== 'site') {
        endRiverControlPointScope(river.id, pointIndex, 'tool')
        releaseRiverGesture(gestureOwner.current)
        return
      }
      event.stopPropagation()
      event.nativeEvent.preventDefault()
      event.nativeEvent.stopImmediatePropagation()
      pointDrag.current = {
        pointerId: event.pointerId,
        siteId: String(river.parentId),
        pointIndex,
        original: river,
        preview: river,
      }
      gl.domElement.setPointerCapture(event.pointerId)
      useViewer.getState().setInputDragging(true)
      gl.domElement.style.cursor = 'grabbing'
      useRiverStore.getState().setPreviewRiver(river)
      useLiveTerrain.getState().begin(String(river.parentId), authoringBaseline(site as SiteNode))
      liveSiteId.current = String(river.parentId)
    },
    [gl, isCameraDragging, nodes],
  )

  const draftSiteId = draft?.siteId ?? null
  useEffect(() => {
    if (!draftSiteId) return
    const releaseScope = retainRiverDraftingScope()
    refreshRiverDraftTerrain(sceneApi)
    return releaseScope
  }, [draftSiteId, sceneApi])

  useEffect(() => {
    const releaseToolBody = retainRiverToolBody(cancelRiverInteraction)
    return () => {
      pointerStart.current = null
      releaseRiverGesture(gestureOwner.current)
      cancelPointDrag()
      endRiverLiveTerrain(liveSiteId.current ?? useRiverStore.getState().draft?.siteId ?? null)
      liveSiteId.current = null
      releaseToolBody()
    }
  }, [cancelPointDrag])

  const isDrafting = Boolean(draft)
  useEffect(() => {
    const canvas = gl.domElement
    const previous = canvas.style.cursor
    canvas.style.cursor = isDrafting ? 'crosshair' : ''
    return () => {
      canvas.style.cursor = previous
    }
  }, [gl, isDrafting, editingRiverId])


  useEffect(() => {
    if (!selectedRiver || draft) return
    const state = useRiverStore.getState()
    state.adoptRiverSettings(selectedRiver)
    if (state.editingRiverId && state.editingRiverId !== selectedRiver.id) {
      state.editPath(null)
    }
  }, [draft, selectedRiver])

  useEffect(() => {
    if (!editingRiverId) return
    const edited = riverNodeOf(nodes[editingRiverId as AnyNodeId])
    if (
      !edited ||
      selection.selectedIds.length !== 1 ||
      selection.selectedIds[0] !== editingRiverId
    ) {
      cancelPointDrag()
      useRiverStore.getState().editPath(null)
    }
  }, [cancelPointDrag, editingRiverId, nodes, selection.selectedIds])

  useEffect(() => {
    const canvas = gl.domElement

    const syncDraftPreview = (site: SiteNode, point: RiverPoint | null) => {
      const state = useRiverStore.getState()
      state.setDraftCursor(point)
      const preview = draftPreviewNode()
      if (!preview) {
        endRiverLiveTerrain(site.id)
        liveSiteId.current = null
        return
      }
      previewTerrainForRiver(site, preview, sceneApi.nodes())
      liveSiteId.current = site.id
    }

    const handlePointerLeave = () => {
      const currentDraft = useRiverStore.getState().draft
      if (!currentDraft?.cursor) return
      const site = sceneApi.get(currentDraft.siteId as AnyNodeId)
      if (site?.type === 'site') syncDraftPreview(site as SiteNode, null)
    }

    const cancelPointer = () => {
      pointerStart.current = null
      releaseRiverGesture(gestureOwner.current)
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.button !== 0 ||
        pointerStart.current ||
        pointDrag.current ||
        isCameraDragging() ||
        !ensureRiverDraftingScope() ||
        !claimRiverGesture(gestureOwner.current)
      ) {
        return
      }
      const currentDraft = useRiverStore.getState().draft
      if (!currentDraft) {
        releaseRiverGesture(gestureOwner.current)
        return
      }
      const site = sceneApi.get(currentDraft.siteId as AnyNodeId)
      if (site?.type !== 'site') {
        releaseRiverGesture(gestureOwner.current)
        useRiverStore.getState().setFeedback('The active Site is no longer available.')
        cancelRiverInteraction()
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      pointerStart.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        siteId: currentDraft.siteId,
        moved: false,
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      const drag = pointDrag.current
      if (drag && drag.pointerId === event.pointerId) {
        if (
          !ownsRiverGesture(gestureOwner.current) ||
          !ownsRiverControlPointScope(drag.original.id, drag.pointIndex, 'tool')
        ) {
          cancelPointDrag()
          return
        }
        const site = sceneApi.get(drag.siteId as AnyNodeId)
        if (site?.type !== 'site') {
          cancelPointDrag()
          return
        }
        const point = terrainPoint(event, site as SiteNode)
        if (!point) return
        const points = drag.original.points.map(
          (candidate, index): RiverPoint =>
            index === drag.pointIndex ? [point[0], point[1]] : [candidate[0], candidate[1]],
        )
        const parsed = RiverNodeSchema.safeParse({ ...drag.original, points })
        if (!parsed.success) return
        drag.preview = parsed.data
        useRiverStore.getState().setPreviewRiver(parsed.data)
        previewTerrainForRiver(site as SiteNode, parsed.data, sceneApi.nodes())
        liveSiteId.current = drag.siteId
        return
      }

      const start = pointerStart.current
      if (start && start.pointerId === event.pointerId && !start.moved) {
        const dx = event.clientX - start.clientX
        const dy = event.clientY - start.clientY
        if (dx * dx + dy * dy > CLICK_TOLERANCE_SQUARED || isCameraDragging()) {
          start.moved = true
        }
      }
      if (event.target !== canvas || !ownsRiverDraftingScope()) return
      const currentDraft = useRiverStore.getState().draft
      if (!currentDraft || isCameraDragging()) return
      const site = sceneApi.get(currentDraft.siteId as AnyNodeId)
      if (site?.type !== 'site') return
      syncDraftPreview(site as SiteNode, terrainPoint(event, site as SiteNode))
    }

    const handlePointerUp = (event: PointerEvent) => {
      const drag = pointDrag.current
      if (drag && drag.pointerId === event.pointerId) {
        const preview = drag.preview
        const ownsScope = ownsRiverControlPointScope(
          drag.original.id,
          drag.pointIndex,
          'tool',
        )
        pointDrag.current = null
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
        endRiverControlPointScope(drag.original.id, drag.pointIndex, 'tool')
        releaseRiverGesture(gestureOwner.current)
        if (ownsScope) {
          const result = updateRiver(sceneApi, drag.original.id, {
            points: preview.points,
          })
          useRiverStore
            .getState()
            .setFeedback(result.ok ? 'River path updated.' : result.message)
        }
        endRiverLiveTerrain(drag.siteId)
        liveSiteId.current = null
        useRiverStore.getState().setPreviewRiver(null)
        useViewer.getState().setInputDragging(false)
        canvas.style.cursor = ''
        return
      }

      const start = pointerStart.current
      if (!start || start.pointerId !== event.pointerId) return
      pointerStart.current = null
      const ownedGesture = ownsRiverGesture(gestureOwner.current)
      releaseRiverGesture(gestureOwner.current)
      if (!ownedGesture || !ownsRiverDraftingScope() || start.moved || isCameraDragging()) return
      const state = useRiverStore.getState()
      const currentDraft = state.draft
      if (!currentDraft || currentDraft.siteId !== start.siteId) return
      const site = sceneApi.get(start.siteId as AnyNodeId)
      if (site?.type !== 'site') return
      const point = terrainPoint(event, site as SiteNode)
      if (!point) {
        state.setFeedback('Click inside the editable Site terrain.')
        return
      }
      if (currentDraft.points.length >= MAX_RIVER_POINTS) {
        state.setFeedback(
          'This river already has the maximum of 128 points. Finish or remove a point.',
        )
        return
      }
      const last = currentDraft.points.at(-1)
      if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < 0.01) {
        state.setFeedback('Place the next point farther along the terrain.')
        return
      }
      state.setDraftPoints([...currentDraft.points, point])
      state.setFeedback(
        currentDraft.points.length === 0
          ? 'First point placed. Add at least one more point, then finish.'
          : `${currentDraft.points.length + 1} points placed. Continue, or finish the river.`,
      )
      syncDraftPreview(site as SiteNode, point)
    }

    const handlePointerCancel = (event: PointerEvent) => {
      if (pointDrag.current?.pointerId === event.pointerId) cancelPointDrag()
      if (pointerStart.current?.pointerId === event.pointerId) cancelPointer()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return
      if (event.key === 'Enter' && useRiverStore.getState().draft) {
        event.preventDefault()
        finishRiverDraft(sceneApi)
        return
      }
      if (event.key === 'Backspace' && useRiverStore.getState().draft) {
        event.preventDefault()
        const state = useRiverStore.getState()
        if (!state.removeLastDraftPoint()) {
          state.setFeedback('There are no river points to remove.')
          return
        }
        const next = useRiverStore.getState().draft
        const site = next ? sceneApi.get(next.siteId as AnyNodeId) : null
        if (site?.type === 'site') syncDraftPreview(site as SiteNode, next?.cursor ?? null)
        state.setFeedback('Last river point removed.')
        return
      }
      if (event.key.toLowerCase() === 'r') {
        const state = useRiverStore.getState()
        const direction = state.flowDirection === 'forward' ? 'reverse' : 'forward'
        if (state.draft) {
          state.setSettings({ flowDirection: direction })
          state.setFeedback(`River flow changed to ${direction}.`)
          event.preventDefault()
          return
        }
        const ids = useViewer.getState().selection.selectedIds
        const selected =
          ids.length === 1 ? riverNodeOf(sceneApi.get(ids[0] as AnyNodeId)) : null
        if (selected) {
          const result = updateRiver(sceneApi, selected.id, {
            flowDirection: selected.flowDirection === 'forward' ? 'reverse' : 'forward',
          })
          if (result.river) state.adoptRiverSettings(result.river)
          state.setFeedback(result.ok ? 'River flow reversed.' : result.message)
          event.preventDefault()
          return
        }
      }
      if (event.key === 'Escape') {
        cancelPointer()
        const hadPointDrag = Boolean(pointDrag.current)
        if (hadPointDrag) cancelPointDrag()
        if (cancelRiverInteraction() || hadPointDrag) {
          event.preventDefault()
          markToolCancelConsumed()
        }
      }
    }

    const handleToolCancel = () => {
      cancelPointer()
      if (pointDrag.current) cancelPointDrag()
      if (cancelRiverInteraction()) markToolCancelConsumed()
    }

    const handleBlur = () => {
      cancelPointer()
      cancelPointDrag()
      const currentDraft = useRiverStore.getState().draft
      if (currentDraft) {
        useRiverStore.getState().setDraftCursor(null)
        endRiverLiveTerrain(currentDraft.siteId)
        liveSiteId.current = null
      }
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointerleave', handlePointerLeave)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('keydown', handleKeyDown)
    emitter.on('tool:cancel', handleToolCancel)
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointerleave', handlePointerLeave)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('keydown', handleKeyDown)
      emitter.off('tool:cancel', handleToolCancel)
      cancelPointer()
    }
  }, [cancelPointDrag, gl, isCameraDragging, sceneApi, terrainPoint])

  const effectivePreview = useMemo(() => {
    if (previewRiver) return previewRiver
    if (!draft) return null
    const points = [...draft.points]
    const last = points.at(-1)
    if (
      draft.cursor &&
      (!last || Math.hypot(draft.cursor[0] - last[0], draft.cursor[1] - last[1]) >= 0.01)
    ) {
      points.push(draft.cursor)
    }
    if (points.length < 2) return null
    const parsed = RiverNodeSchema.safeParse({
      id: 'river_preview',
      parentId: draft.siteId,
      name: 'River preview',
      points,
      width,
      depth,
      source,
      outlet,
      flowDirection,
      flowSpeed,
      quality,
      shoreline,
    })
    return parsed.success ? parsed.data : null
  }, [
    depth,
    draft,
    flowDirection,
    flowSpeed,
    outlet,
    previewRiver,
    quality,
    shoreline,
    source,
    width,
  ])
  const previewSite = effectivePreview?.parentId
    ? nodes[effectivePreview.parentId as AnyNodeId]
    : null
  const editedRiver = editingRiverId ? riverNodeOf(nodes[editingRiverId as AnyNodeId]) : null
  const editedSite = editedRiver?.parentId ? nodes[editedRiver.parentId as AnyNodeId] : null
  const draftSite = draft ? nodes[draft.siteId as AnyNodeId] : null

  // Sites use world coordinates; ToolManager mounts registry tools under the
  // selected building's transform. Keep terrain affordances outside that group.
  return createPortal(
    <>
      {effectivePreview && !previewRiver && previewSite?.type === 'site' ? (
        <RiverSurfacePreview node={effectivePreview} site={previewSite as SiteNode} />
      ) : null}
      {draft && draftSite?.type === 'site' ? (
        <RiverPathAffordance
          points={draft.points}
          cursor={draft.cursor}
          site={draftSite as SiteNode}
          river={effectivePreview ?? undefined}
        />
      ) : null}
      {editedRiver && editedSite?.type === 'site' ? (
        <RiverPathAffordance
          points={(previewRiver?.id === editedRiver.id ? previewRiver : editedRiver).points}
          river={previewRiver?.id === editedRiver.id ? previewRiver : editedRiver}
          site={editedSite as SiteNode}
          onPointerDown={beginPointDrag}
        />
      ) : null}
    </>,
    scene,
  )
}
function RiverSurfacePreview({ node, site }: { node: RiverNode; site: SiteNode }) {
  const baselineTerrain = useMemo(
    () => riverTerrainBaseline(site) ?? authoringBaseline(site),
    [site],
  )
  const carvedTerrain = terrainFieldOf(site) ?? baselineTerrain
  const object = useMemo(() => {
    const group = buildRiverPreviewGeometry(node, site, carvedTerrain, baselineTerrain)
    group.traverse((child) => {
      child.raycast = NO_RAYCAST
    })
    return group
  }, [baselineTerrain, carvedTerrain, node, site])
  useEffect(() => () => disposeObjectResources(object), [object])
  return <primitive object={object} dispose={null} />
}

function buildCurveGuide(
  points: readonly RiverPoint[],
  terrain: TerrainField | null,
  boundary: readonly (readonly [number, number])[],
  river?: RiverNode,
): Line {
  const authored = points.map((point): [number, number, number] => [
    point[0],
    (terrain ? surfaceHeightAt(terrain, point[0], point[1]) : 0) + 0.08,
    point[1],
  ])
  const sharedPath = terrain && river ? sampleRiverPath(terrain, river, boundary) : null
  const sampled =
    sharedPath?.points ??
    sampleRoadAlignmentPoints(
      authored[0]!,
      authored.slice(1, -1),
      authored.at(-1)!,
      Math.max(24, (authored.length - 1) * 12),
    )
  const geometry = new BufferGeometry().setFromPoints(
    sampled.map((point) => new Vector3(point[0], point[1] + (sharedPath ? 0.08 : 0), point[2])),
  )
  const material = new LineBasicMaterial({
    color: '#55d8ff',
    depthTest: false,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  })
  const line = new Line(geometry, material)
  line.name = 'environment-river-authoring-guide'
  line.renderOrder = 1000
  line.raycast = NO_RAYCAST
  line.layers.set(EDITOR_LAYER)
  return line
}

function RiverPathAffordance({
  points,
  cursor,
  river,
  site,
  onPointerDown,
}: {
  points: readonly RiverPoint[]
  cursor?: RiverPoint | null
  river?: RiverNode
  site: SiteNode
  onPointerDown?: (river: RiverNode, pointIndex: number, event: ThreeEvent<PointerEvent>) => void
}) {
  const markers = useRef<Group>(null)
  const terrain = useMemo(() => riverTerrainBaseline(site) ?? authoringBaseline(site), [site])
  const guide = useMemo(() => {
    const path = cursor ? [...points, cursor] : points
    return path.length >= 2 ? buildCurveGuide(path, terrain, site.polygon.points, river) : null
  }, [cursor, points, river, site.polygon.points, terrain])
  useEffect(
    () => () => {
      if (guide) disposeObjectResources(guide)
    },
    [guide],
  )
  const scratch = useMemo(
    () => ({
      cameraPosition: new Vector3(),
      cameraDirection: new Vector3(),
      offset: new Vector3(),
      rotation: new Quaternion(),
    }),
    [],
  )

  // Screen-sized targets stay usable at architectural zoom levels. The visual
  // disk is 18 px across; its separate hit target is 32 px.
  useFrame(({ camera, size }) => {
    if (!markers.current || size.height === 0) return
    camera.getWorldPosition(scratch.cameraPosition)
    camera.getWorldDirection(scratch.cameraDirection)
    camera.getWorldQuaternion(scratch.rotation)
    const pixelScale = 18 / (size.height * camera.projectionMatrix.elements[5]!)
    for (const marker of markers.current.children) {
      const distance =
        camera instanceof PerspectiveCamera
          ? Math.max(
              0,
              scratch.offset
                .copy(marker.position)
                .sub(scratch.cameraPosition)
                .dot(scratch.cameraDirection),
            )
          : 1
      marker.scale.setScalar(pixelScale * distance)
      marker.quaternion.copy(scratch.rotation)
    }
  })

  const positionOf = (point: RiverPoint): [number, number, number] => [
    point[0],
    surfaceHeightAt(terrain, point[0], point[1]) + 0.12,
    point[1],
  ]
  return (
    <group name="environment-river-authoring">
      {guide ? <primitive object={guide} dispose={null} /> : null}
      <group ref={markers}>
        {points.map((point, index) => (
          <RiverPointMarker
            key={index}
            name={`environment-river-point:${index + 1}`}
            position={positionOf(point)}
            onPointerDown={
              river && onPointerDown ? (event) => onPointerDown(river, index, event) : undefined
            }
          />
        ))}
        {cursor ? (
          <RiverPointMarker name="environment-river-cursor" position={positionOf(cursor)} ghost />
        ) : null}
      </group>
    </group>
  )
}

function RiverPointMarker({
  name,
  position,
  ghost = false,
  onPointerDown,
}: {
  name: string
  position: [number, number, number]
  ghost?: boolean
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void
}) {
  const { gl } = useThree()
  const [hovered, setHovered] = useState(false)
  return (
    <group name={name} position={position}>
      <mesh layers={EDITOR_LAYER} renderOrder={1001} raycast={NO_RAYCAST}>
        <circleGeometry args={[1, 24]} />
        <meshBasicMaterial
          color={hovered ? '#ffffff' : '#55d8ff'}
          transparent
          opacity={ghost ? 0.55 : 1}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh layers={EDITOR_LAYER} renderOrder={1002} raycast={NO_RAYCAST}>
        <ringGeometry args={[0.72, 1, 24]} />
        <meshBasicMaterial
          color="#123b48"
          transparent
          opacity={ghost ? 0.55 : 1}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* Pascal's main raycaster picks layer 0; only the visuals use the overlay layer. */}
      {onPointerDown ? (
        <mesh
          onPointerDown={onPointerDown}
          onPointerOver={(event) => {
            event.stopPropagation()
            setHovered(true)
            if (!useViewer.getState().inputDragging) gl.domElement.style.cursor = 'grab'
          }}
          onPointerOut={() => {
            setHovered(false)
            if (!useViewer.getState().inputDragging) gl.domElement.style.cursor = ''
          }}
        >
          <circleGeometry args={[1.8, 16]} />
          <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  )
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    Boolean(target.closest('[contenteditable="true"]'))
  )
}

function disposeObjectResources(root: Object3D): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  root.traverse((object) => {
    if (object instanceof Mesh || object instanceof Line) {
      geometries.add(object.geometry)
      const assigned = object.material
      if (Array.isArray(assigned)) {
        for (const material of assigned) materials.add(material)
      } else {
        materials.add(assigned)
      }
      if (object instanceof InstancedMesh) object.dispose()
    }
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
}

export default RiverTool
