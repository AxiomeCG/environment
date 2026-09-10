'use client'

import {
  pointInPolygon2D,
  snapWorldXZToBuildingLocal,
  useLiveTerrain,
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  type SiteNode,
} from '@pascal-app/core'
import {
  markToolCancelConsumed,
  useInteractionScope,
  type FloorplanToolContext,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useSceneApiNodes } from '../use-scene-api-nodes'
import { riverNodeOf, updateRiver } from './actions'
import {
  beginRiverControlPointScope,
  claimRiverGesture,
  endRiverControlPointScope,
  ensureRiverDraftingScope,
  ownsRiverControlPointScope,
  ownsRiverDraftingScope,
  ownsRiverGesture,
  publishRiverNodePreview,
  releaseRiverGesture,
  retainRiverDraftingScope,
  retainRiverNodePreview,
} from './interaction'
import { RiverNode as RiverNodeSchema } from './schema'
import type { RiverNode, RiverPoint } from './schema'
import { useRiverStore } from './store'
import {
  authoringBaseline,
  cancelRiverInteraction,
  draftPreviewNode,
  endRiverLiveTerrain,
  finishRiverDraft,
  previewTerrainForRiver,
} from './tool'

const CLICK_TOLERANCE_SQUARED = 25
const MAX_RIVER_POINTS = 128

type ActiveSiteContext = {
  building: BuildingNode
  site: SiteNode
}

type PointerStart = {
  pointerId: number
  clientX: number
  clientY: number
  siteId: string
  moved: boolean
}

type PointDrag = {
  pointerId: number
  pointIndex: number
  siteId: string
  original: RiverNode
  preview: RiverNode
}

function activeSiteContext(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  activeLevelId: AnyNodeId | null,
): ActiveSiteContext | null {
  if (!activeLevelId) return null
  const level = nodes[activeLevelId]
  const building = level?.parentId ? nodes[level.parentId as AnyNodeId] : null
  if (building?.type !== 'building' || !building.parentId) return null
  const site = nodes[building.parentId as AnyNodeId]
  return site?.type === 'site'
    ? { building: building as BuildingNode, site: site as SiteNode }
    : null
}

function planPointToSite(
  point: readonly [number, number],
  building: BuildingNode,
): RiverPoint {
  const angle = building.rotation?.[1] ?? 0
  const [px, , pz] = building.position ?? [0, 0, 0]
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [px + point[0] * cos + point[1] * sin, pz - point[0] * sin + point[1] * cos]
}

function sitePointToPlan(point: RiverPoint, building: BuildingNode): RiverPoint {
  return snapWorldXZToBuildingLocal(
    point[0],
    point[1],
    building.position,
    building.rotation?.[1] ?? 0,
    0,
  ).local
}

function clientToPlanPoint(
  group: SVGGElement,
  clientX: number,
  clientY: number,
): RiverPoint | null {
  const matrix = group.getScreenCTM()
  if (!matrix) return null
  const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
  return [point.x, point.y]
}

function polylinePoints(points: readonly RiverPoint[]): string {
  return points.map((point) => `${point[0]},${point[1]}`).join(' ')
}

export default function RiverFloorplanTool({
  activeLevelId,
  finishTool,
  sceneApi,
}: FloorplanToolContext) {
  const nodes = useSceneApiNodes(sceneApi)
  const draft = useRiverStore((state) => state.draft)
  const editingRiverId = useRiverStore((state) => state.editingRiverId)
  const previewRiver = useRiverStore((state) => state.previewRiver)
  const context = useMemo(
    () => activeSiteContext(nodes, activeLevelId),
    [activeLevelId, nodes],
  )
  const editedRiver = editingRiverId ? riverNodeOf(nodes[editingRiverId as AnyNodeId]) : null
  const effectiveEditedRiver =
    previewRiver?.id === editedRiver?.id ? previewRiver : editedRiver
  const groupRef = useRef<SVGGElement>(null)
  const pointerStart = useRef<PointerStart | null>(null)
  const pointDrag = useRef<PointDrag | null>(null)
  const gestureOwner = useRef(Symbol('river-floorplan-gesture'))
  const liveSiteId = useRef<string | null>(null)
  const [hoverPoint, setHoverPoint] = useState<RiverPoint | null>(null)
  const latest = useRef({ context, draft })
  latest.current = { context, draft }

  const draftSiteId = draft?.siteId ?? null
  useEffect(() => {
    if (!draftSiteId) return
    return retainRiverDraftingScope()
  }, [draftSiteId])

  const previewRiverId = previewRiver?.id
  useEffect(() => {
    if (!previewRiverId) return
    return retainRiverNodePreview(sceneApi, previewRiverId)
  }, [previewRiverId, sceneApi])

  useEffect(() => {
    if (!previewRiver) return
    publishRiverNodePreview(sceneApi, previewRiver)
  }, [previewRiver, sceneApi])

  const syncDraftPreview = useCallback(
    (site: SiteNode, point: RiverPoint | null) => {
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
    },
    [sceneApi],
  )

  const cancelPointer = useCallback(() => {
    pointerStart.current = null
    releaseRiverGesture(gestureOwner.current)
  }, [])

  const cancelPointDrag = useCallback(() => {
    const drag = pointDrag.current
    if (!drag) return
    pointDrag.current = null
    endRiverControlPointScope(drag.original.id, drag.pointIndex, 'floorplan')
    releaseRiverGesture(gestureOwner.current)
    endRiverLiveTerrain(drag.siteId)
    liveSiteId.current = null
    useRiverStore.getState().setPreviewRiver(null)
    useViewer.getState().setInputDragging(false)
  }, [])
  useEffect(
    () =>
      useInteractionScope.subscribe(() => {
        const drag = pointDrag.current
        if (
          drag &&
          !ownsRiverControlPointScope(drag.original.id, drag.pointIndex, 'floorplan')
        ) {
          cancelPointDrag()
        }
        if (pointerStart.current && !ownsRiverDraftingScope()) {
          cancelPointer()
          const currentDraft = useRiverStore.getState().draft
          if (currentDraft) {
            useRiverStore.getState().setDraftCursor(null)
            endRiverLiveTerrain(currentDraft.siteId)
            liveSiteId.current = null
          }
        }
      }),
    [cancelPointDrag, cancelPointer],
  )

  useEffect(
    () => () => {
      cancelPointer()
      cancelPointDrag()
      endRiverLiveTerrain(liveSiteId.current ?? useRiverStore.getState().draft?.siteId ?? null)
      liveSiteId.current = null
      useRiverStore.getState().setDraftCursor(null)
    },
    [cancelPointDrag, cancelPointer],
  )

  const handlePointDown = useCallback(
    (river: RiverNode, pointIndex: number, event: ReactPointerEvent<SVGCircleElement>) => {
      if (
        event.button !== 0 ||
        pointDrag.current ||
        !river.parentId ||
        !claimRiverGesture(gestureOwner.current)
      ) {
        return
      }
      if (!beginRiverControlPointScope(river.id, pointIndex, 'floorplan')) {
        releaseRiverGesture(gestureOwner.current)
        return
      }
      const currentContext = latest.current.context
      if (!currentContext || String(river.parentId) !== currentContext.site.id) {
        endRiverControlPointScope(river.id, pointIndex, 'floorplan')
        releaseRiverGesture(gestureOwner.current)
        return
      }
      event.preventDefault()
      event.stopPropagation()
      event.nativeEvent.stopImmediatePropagation()
      const svg = event.currentTarget.ownerSVGElement
      svg?.setPointerCapture(event.pointerId)
      pointDrag.current = {
        pointerId: event.pointerId,
        pointIndex,
        siteId: currentContext.site.id,
        original: river,
        preview: river,
      }
      useViewer.getState().setInputDragging(true)
      useRiverStore.getState().setPreviewRiver(river)
      useLiveTerrain.getState().begin(currentContext.site.id, authoringBaseline(currentContext.site))
      liveSiteId.current = currentContext.site.id
    },
    [],
  )

  useEffect(() => {
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    if (!(group && svg)) return

    const consume = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    const sitePointAt = (event: PointerEvent): { context: ActiveSiteContext; point: RiverPoint } | null => {
      const currentContext = latest.current.context
      if (!currentContext) return null
      const planPoint = clientToPlanPoint(group, event.clientX, event.clientY)
      if (!planPoint) return null
      const point = planPointToSite(planPoint, currentContext.building)
      return pointInPolygon2D([point[0], point[1]], currentContext.site.polygon.points)
        ? { context: currentContext, point }
        : null
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || pointerStart.current || pointDrag.current) return
      const currentDraft = useRiverStore.getState().draft
      if (!currentDraft || !ensureRiverDraftingScope()) return
      const positioned = sitePointAt(event)
      if (!positioned || positioned.context.site.id !== currentDraft.siteId) return
      if (!claimRiverGesture(gestureOwner.current)) return
      consume(event)
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
      if (drag?.pointerId === event.pointerId) {
        consume(event)
        if (
          !ownsRiverGesture(gestureOwner.current) ||
          !ownsRiverControlPointScope(drag.original.id, drag.pointIndex, 'floorplan')
        ) {
          cancelPointDrag()
          return
        }
        const positioned = sitePointAt(event)
        if (!positioned || positioned.context.site.id !== drag.siteId) return
        const points = drag.original.points.map(
          (candidate, index): RiverPoint =>
            index === drag.pointIndex
              ? [positioned.point[0], positioned.point[1]]
              : [candidate[0], candidate[1]],
        )
        const parsed = RiverNodeSchema.safeParse({ ...drag.original, points })
        if (!parsed.success) return
        drag.preview = parsed.data
        useRiverStore.getState().setPreviewRiver(parsed.data)
        previewTerrainForRiver(positioned.context.site, parsed.data, sceneApi.nodes())
        liveSiteId.current = drag.siteId
        return
      }

      const positioned = sitePointAt(event)
      setHoverPoint(positioned ? sitePointToPlan(positioned.point, positioned.context.building) : null)
      if (positioned && useRiverStore.getState().draft && ownsRiverDraftingScope()) {
        syncDraftPreview(positioned.context.site, positioned.point)
      }
      const start = pointerStart.current
      if (!start || start.pointerId !== event.pointerId || start.moved) return
      const dx = event.clientX - start.clientX
      const dy = event.clientY - start.clientY
      if (dx * dx + dy * dy > CLICK_TOLERANCE_SQUARED) start.moved = true
    }

    const handlePointerLeave = () => {
      setHoverPoint(null)
      const currentDraft = useRiverStore.getState().draft
      const currentContext = latest.current.context
      if (currentDraft?.cursor && currentContext?.site.id === currentDraft.siteId) {
        syncDraftPreview(currentContext.site, null)
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      const drag = pointDrag.current
      if (drag?.pointerId === event.pointerId) {
        consume(event)
        const preview = drag.preview
        const ownsScope = ownsRiverControlPointScope(
          drag.original.id,
          drag.pointIndex,
          'floorplan',
        )
        pointDrag.current = null
        if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId)
        endRiverControlPointScope(drag.original.id, drag.pointIndex, 'floorplan')
        releaseRiverGesture(gestureOwner.current)
        if (ownsScope) {
          const result = updateRiver(sceneApi, drag.original.id, { points: preview.points })
          useRiverStore
            .getState()
            .setFeedback(result.ok ? 'River path updated.' : result.message)
        }
        endRiverLiveTerrain(drag.siteId)
        liveSiteId.current = null
        useRiverStore.getState().setPreviewRiver(null)
        useViewer.getState().setInputDragging(false)
        return
      }

      const start = pointerStart.current
      if (!start || start.pointerId !== event.pointerId) return
      consume(event)
      pointerStart.current = null
      const ownedGesture = ownsRiverGesture(gestureOwner.current)
      releaseRiverGesture(gestureOwner.current)
      if (!ownedGesture || !ownsRiverDraftingScope() || start.moved) return
      const state = useRiverStore.getState()
      const currentDraft = state.draft
      if (!currentDraft || currentDraft.siteId !== start.siteId) return
      const positioned = sitePointAt(event)
      if (!positioned || positioned.context.site.id !== start.siteId) {
        state.setFeedback('Click inside the editable Site terrain.')
        return
      }
      if (currentDraft.points.length >= MAX_RIVER_POINTS) {
        state.setFeedback('This river already has the maximum of 128 points. Finish or remove a point.')
        return
      }
      const last = currentDraft.points.at(-1)
      if (
        last &&
        Math.hypot(positioned.point[0] - last[0], positioned.point[1] - last[1]) < 0.01
      ) {
        state.setFeedback('Place the next point farther along the terrain.')
        return
      }
      state.setDraftPoints([...currentDraft.points, positioned.point])
      state.setFeedback(
        currentDraft.points.length === 0
          ? 'First point placed. Add at least one more point, then finish.'
          : `${currentDraft.points.length + 1} points placed. Continue, or finish the river.`,
      )
      syncDraftPreview(positioned.context.site, positioned.point)
    }

    const handlePointerCancel = (event: PointerEvent) => {
      if (pointDrag.current?.pointerId === event.pointerId) cancelPointDrag()
      if (pointerStart.current?.pointerId === event.pointerId) cancelPointer()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLSelectElement)
      ) {
        return
      }
      if (event.key === 'Enter' && useRiverStore.getState().draft) {
        consume(event)
        finishRiverDraft(sceneApi)
        return
      }
      if (event.key === 'Backspace' && useRiverStore.getState().draft) {
        consume(event)
        const state = useRiverStore.getState()
        if (!state.removeLastDraftPoint()) {
          state.setFeedback('There are no river points to remove.')
          return
        }
        const next = useRiverStore.getState().draft
        const nextContext = latest.current.context
        if (next && nextContext?.site.id === next.siteId) {
          syncDraftPreview(nextContext.site, next.cursor)
        }
        state.setFeedback('Last river point removed.')
        return
      }
      if (event.key === 'Escape') {
        const hadPointDrag = Boolean(pointDrag.current)
        cancelPointer()
        if (hadPointDrag) cancelPointDrag()
        if (cancelRiverInteraction() || hadPointDrag) {
          consume(event)
          markToolCancelConsumed()
        } else {
          consume(event)
          finishTool()
        }
      }
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


    svg.addEventListener('pointerdown', handlePointerDown, true)
    svg.addEventListener('pointermove', handlePointerMove, true)
    svg.addEventListener('pointerleave', handlePointerLeave)
    window.addEventListener('pointerup', handlePointerUp, true)
    window.addEventListener('pointercancel', handlePointerCancel)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      svg.removeEventListener('pointerdown', handlePointerDown, true)
      svg.removeEventListener('pointermove', handlePointerMove, true)
      svg.removeEventListener('pointerleave', handlePointerLeave)
      window.removeEventListener('pointerup', handlePointerUp, true)
      window.removeEventListener('pointercancel', handlePointerCancel)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('keydown', handleKeyDown)
      cancelPointer()
      cancelPointDrag()
    }
  }, [cancelPointDrag, cancelPointer, finishTool, sceneApi, syncDraftPreview])

  const draftPlanPoints = useMemo(() => {
    if (!(draft && context?.site.id === draft.siteId)) return []
    const points = [...draft.points]
    const last = points.at(-1)
    if (
      draft.cursor &&
      (!last || Math.hypot(draft.cursor[0] - last[0], draft.cursor[1] - last[1]) >= 0.01)
    ) {
      points.push(draft.cursor)
    }
    return points.map((point) => sitePointToPlan(point, context.building))
  }, [context, draft])
  const editedPlanPoints = useMemo(
    () =>
      effectiveEditedRiver && context?.site.id === effectiveEditedRiver.parentId
        ? effectiveEditedRiver.points.map((point) => sitePointToPlan(point, context.building))
        : [],
    [context, effectiveEditedRiver],
  )
  const visiblePoints = editedPlanPoints.length > 0 ? editedPlanPoints : draftPlanPoints

  return (
    <g ref={groupRef} data-environment-river-floorplan-tool>
      {visiblePoints.length >= 2 ? (
        <polyline
          fill="none"
          opacity={0.9}
          pointerEvents="none"
          points={polylinePoints(visiblePoints)}
          stroke="#22d3ee"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={0.12}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {effectiveEditedRiver && editedPlanPoints.length > 0
        ? editedPlanPoints.map((point, index) => (
            <circle
              key={`${effectiveEditedRiver.id}:${index}`}
              aria-label={`River control point ${index + 1}`}
              cx={point[0]}
              cy={point[1]}
              fill="#ffffff"
              onPointerDown={(event) => handlePointDown(effectiveEditedRiver, index, event)}
              r={0.22}
              role="button"
              stroke="#0891b2"
              strokeWidth={0.08}
              tabIndex={-1}
              vectorEffect="non-scaling-stroke"
            />
          ))
        : null}
      {draft && hoverPoint ? (
        <circle
          cx={hoverPoint[0]}
          cy={hoverPoint[1]}
          fill="#22d3ee"
          opacity={0.7}
          pointerEvents="none"
          r={0.12}
          stroke="#ffffff"
          strokeWidth={0.04}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </g>
  )
}
