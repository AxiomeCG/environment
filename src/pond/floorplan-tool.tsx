'use client'

import {
  snapWorldXZToBuildingLocal,
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
import { useEffect, useMemo, useRef, useState } from 'react'
import { useEnvironmentStore, type PondToolTarget } from '../store'
import { useSceneApiNodes } from '../use-scene-api-nodes'
import {
  commitPondPropPlacement,
  commitPondPropRemoval,
  pondNodeOf,
  targetPondAtSeed,
  type PondPropKind,
} from './actions'
import {
  claimPondGesture,
  ensurePondToolScope,
  ownsPondToolScope,
  ownsPondGesture,
  releasePondGesture,
  retainPondToolScope,
} from './interaction'

const CLICK_TOLERANCE_SQUARED = 25

type ActiveSiteContext = {
  building: BuildingNode
  site: SiteNode
}

type PointerStart = {
  pointerId: number
  clientX: number
  clientY: number
  siteId: string
  mode: 'select-basin' | PondPropKind | 'remove-prop'
  targetKey: string
  moved: boolean
}

function targetKey(target: PondToolTarget | null): string {
  return target
    ? `${target.siteId}:${target.pondId ?? ''}:${target.seed[0]}:${target.seed[1]}`
    : ''
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
): readonly [number, number] {
  const angle = building.rotation?.[1] ?? 0
  const [px, , pz] = building.position ?? [0, 0, 0]
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [px + point[0] * cos + point[1] * sin, pz - point[0] * sin + point[1] * cos]
}

function sitePointToPlan(
  point: readonly [number, number],
  building: BuildingNode,
): readonly [number, number] {
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
): readonly [number, number] | null {
  const matrix = group.getScreenCTM()
  if (!matrix) return null
  const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
  return [point.x, point.y]
}

export default function PondFloorplanTool({
  activeLevelId,
  finishTool,
  sceneApi,
  selectNode,
}: FloorplanToolContext) {
  const nodes = useSceneApiNodes(sceneApi)
  const mode = useEnvironmentStore((state) => state.pondToolMode)
  const target = useEnvironmentStore((state) => state.pondTarget)
  const context = useMemo(
    () => activeSiteContext(nodes, activeLevelId),
    [activeLevelId, nodes],
  )
  const groupRef = useRef<SVGGElement>(null)
  const pointerStart = useRef<PointerStart | null>(null)
  const gestureOwner = useRef(Symbol('pond-floorplan-gesture'))
  const [hoverPoint, setHoverPoint] = useState<readonly [number, number] | null>(null)
  const latest = useRef({ context, mode, target })
  latest.current = { context, mode, target }

  useEffect(() => {
    const releaseScope = retainPondToolScope()
    const unsubscribeScope = useInteractionScope.subscribe(() => {
      if (ownsPondToolScope()) return
      if (pointerStart.current) {
        pointerStart.current = null
        releasePondGesture(gestureOwner.current)
        setHoverPoint(null)
      }
      ensurePondToolScope()
    })
    return () => {
      unsubscribeScope()
      releaseScope()
    }
  }, [])
  useEffect(() => {
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    if (!(group && svg)) return

    const consume = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    const cancelPointer = () => {
      pointerStart.current = null
      releasePondGesture(gestureOwner.current)
      setHoverPoint(null)
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || pointerStart.current) return
      const current = latest.current
      if (!current.context) {
        useEnvironmentStore.getState().setPondFeedback('Add or select a Site before creating water.')
        return
      }
      if (!claimPondGesture(gestureOwner.current)) return
      consume(event)
      pointerStart.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        siteId: current.context.site.id,
        mode: current.mode,
        targetKey: targetKey(current.target),
        moved: false,
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      const point = clientToPlanPoint(group, event.clientX, event.clientY)
      setHoverPoint(point)
      const start = pointerStart.current
      if (!start || start.pointerId !== event.pointerId || start.moved) return
      const dx = event.clientX - start.clientX
      const dy = event.clientY - start.clientY
      if (dx * dx + dy * dy > CLICK_TOLERANCE_SQUARED) start.moved = true
    }

    const handlePointerUp = (event: PointerEvent) => {
      const start = pointerStart.current
      if (!start || start.pointerId !== event.pointerId) return
      pointerStart.current = null
      const ownedGesture = ownsPondGesture(gestureOwner.current)
      releasePondGesture(gestureOwner.current)
      consume(event)
      const current = latest.current
      if (
        !ownedGesture ||
        start.moved ||
        current.context?.site.id !== start.siteId ||
        current.mode !== start.mode ||
        targetKey(current.target) !== start.targetKey
      ) {
        return
      }
      const planPoint = clientToPlanPoint(group, event.clientX, event.clientY)
      if (!(planPoint && current.context)) return
      const point = planPointToSite(planPoint, current.context.building)
      const store = useEnvironmentStore.getState()

      if (start.mode === 'select-basin') {
        const resolved = targetPondAtSeed(sceneApi.nodes(), current.context.site, point)
        if (!resolved) {
          store.setPondTarget(null)
          store.setPondFeedback('No contained depression here. Sculpt a deeper enclosed basin first.')
          useViewer.getState().setSelection({ selectedIds: [] })
          return
        }
        store.setPondTarget(resolved.target)
        if (resolved.pond) {
          store.setPondQuality(resolved.pond.quality)
          selectNode(resolved.pond.id as AnyNodeId)
          store.setPondFeedback('Existing pond selected.')
        } else {
          useViewer.getState().setSelection({ selectedIds: [] })
          store.setPondFeedback('Depression selected. Raise once or fill it to add water.')
        }
        return
      }

      if (!current.target || current.target.siteId !== current.context.site.id) {
        store.setPondFeedback('Select a pond on the active Site before editing its props.')
        return
      }
      const result =
        start.mode === 'remove-prop'
          ? commitPondPropRemoval(sceneApi, current.target, point)
          : commitPondPropPlacement(sceneApi, current.target, start.mode, point)
      if (result.target) store.setPondTarget(result.target)
      store.setPondFeedback(result.message)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape') return
      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLSelectElement)
      ) {
        return
      }
      const store = useEnvironmentStore.getState()
      if (pointerStart.current || store.pondTarget || store.pondToolMode !== 'select-basin') {
        consume(event)
        cancelPointer()
        store.resetPondTool()
        const selection = useViewer.getState().selection.selectedIds
        if (selection.some((id) => pondNodeOf(sceneApi.get(id as AnyNodeId)))) {
          useViewer.getState().setSelection({ selectedIds: [] })
        }
        markToolCancelConsumed()
        return
      }
      consume(event)
      finishTool()
    }

    svg.addEventListener('pointerdown', handlePointerDown, true)
    svg.addEventListener('pointermove', handlePointerMove, true)
    svg.addEventListener('pointerleave', cancelPointer)
    window.addEventListener('pointerup', handlePointerUp, true)
    window.addEventListener('pointercancel', cancelPointer)
    window.addEventListener('blur', cancelPointer)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      svg.removeEventListener('pointerdown', handlePointerDown, true)
      svg.removeEventListener('pointermove', handlePointerMove, true)
      svg.removeEventListener('pointerleave', cancelPointer)
      window.removeEventListener('pointerup', handlePointerUp, true)
      window.removeEventListener('pointercancel', cancelPointer)
      window.removeEventListener('blur', cancelPointer)
      window.removeEventListener('keydown', handleKeyDown)
      cancelPointer()
    }
  }, [finishTool, sceneApi, selectNode])

  const targetPoint = context && target?.siteId === context.site.id
    ? sitePointToPlan(target.seed, context.building)
    : null

  return (
    <g ref={groupRef} data-environment-pond-floorplan-tool>
      {targetPoint ? (
        <circle
          cx={targetPoint[0]}
          cy={targetPoint[1]}
          fill="none"
          pointerEvents="none"
          r={0.35}
          stroke="#38bdf8"
          strokeDasharray="0.12 0.08"
          strokeWidth={0.08}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {hoverPoint ? (
        <circle
          cx={hoverPoint[0]}
          cy={hoverPoint[1]}
          fill="#38bdf8"
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
