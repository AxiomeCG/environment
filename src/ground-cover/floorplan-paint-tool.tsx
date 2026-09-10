'use client'

import {
  emitter,
  pointInPolygon2D,
  type BuildingNode,
  type SiteNode,
} from '@pascal-app/core'
import {
  type FloorplanToolContext,
  markToolCancelConsumed,
  useFloorplanRender,
} from '@pascal-app/editor'
import { useEffect, useRef, useState } from 'react'
import {
  advancePaintStroke,
  currentPaintField,
  detachPaintStrokeAnchor,
  type PaintStroke,
  type PaintStrokeSettings,
} from './paint-stroke'
import type { GrassPaintField } from './paint-field'
import {
  claimEnvironmentPaintStroke,
  isEnvironmentPaintScopeActive,
  mountEnvironmentPaintBody,
  releaseEnvironmentPaintStroke,
  subscribeEnvironmentPaintScopeLoss,
} from './paint-tool-lifecycle'

export type FloorplanPaintSession = {
  stroke: PaintStroke
  preview: (field: GrassPaintField) => void
  commit: (field: GrassPaintField) => void
  cancel: () => void
}

type PlanPoint = [x: number, z: number]

type FloorplanPaintToolLayerProps = Pick<FloorplanToolContext, 'finishTool'> & {
  building: BuildingNode
  cursorColor: string
  settings: PaintStrokeSettings
  targetKey: string
  site: SiteNode
  start: (sitePoint: PlanPoint) => FloorplanPaintSession
}

type ActiveSession = FloorplanPaintSession & {
  pointerId: number
  targetKey: string
}

function clientToPlanPoint(
  group: SVGGElement,
  clientX: number,
  clientY: number,
): PlanPoint | null {
  const matrix = group.getScreenCTM()
  if (!matrix) return null
  const local = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
  return [local.x, local.y]
}

function consume(event: Event): void {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}
function floorplanToSitePoint(point: PlanPoint, building: BuildingNode): PlanPoint {
  const cos = Math.cos(building.rotation[1])
  const sin = Math.sin(building.rotation[1])
  return [
    building.position[0] + point[0] * cos + point[1] * sin,
    building.position[2] - point[0] * sin + point[1] * cos,
  ]
}


export function FloorplanPaintToolLayer({
  building,
  cursorColor,
  finishTool,
  settings,
  site,
  start,
  targetKey,
}: FloorplanPaintToolLayerProps) {
  const groupRef = useRef<SVGGElement>(null)
  const ownerRef = useRef(Symbol('environment-floorplan-paint'))
  const activeRef = useRef<ActiveSession | null>(null)
  const latest = useRef({ building, site, start, targetKey })
  latest.current = { building, site, start, targetKey }
  const [hover, setHover] = useState<PlanPoint | null>(null)
  const [previewPath, setPreviewPath] = useState('')
  const renderContext = useFloorplanRender()

  useEffect(() => mountEnvironmentPaintBody(), [])

  useEffect(() => {
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    if (!(group && svg)) return

    const releasePointer = (pointerId: number) => {
      if (svg.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId)
    }
    const releaseSession = (active: ActiveSession) => {
      releaseEnvironmentPaintStroke(ownerRef.current)
      releasePointer(active.pointerId)
      setPreviewPath('')
    }
    const abandon = () => {
      const active = activeRef.current
      if (!active) return false
      activeRef.current = null
      active.cancel()
      releaseSession(active)
      return true
    }
    const unsubscribeScope = subscribeEnvironmentPaintScopeLoss(() => {
      abandon()
    })
    const resolvePoint = (event: MouseEvent | PointerEvent) => {
      const planPoint = clientToPlanPoint(group, event.clientX, event.clientY)
      if (!planPoint) return null
      const current = latest.current
      const sitePoint = floorplanToSitePoint(planPoint, current.building)
      return { planPoint, sitePoint }
    }
    const pointInsideSite = (sitePoint: PlanPoint) =>
      pointInPolygon2D(sitePoint, latest.current.site.polygon.points, {
        includeBoundary: true,
      })
    const applyDab = (event: PointerEvent) => {
      const active = activeRef.current
      if (!active || active.pointerId !== event.pointerId) return
      if (active.targetKey !== latest.current.targetKey) {
        abandon()
        return
      }
      consume(event)
      if (
        (event.buttons & 0b110) !== 0 ||
        !isEnvironmentPaintScopeActive()
      ) {
        detachPaintStrokeAnchor(active.stroke)
        return
      }
      const point = resolvePoint(event)
      if (!point || !pointInsideSite(point.sitePoint)) {
        detachPaintStrokeAnchor(active.stroke)
        setHover(null)
        return
      }
      setHover(point.planPoint)
      const field = advancePaintStroke(active.stroke, point.sitePoint[0], point.sitePoint[1])
      if (!field) return
      active.preview(field)
      setPreviewPath((path) =>
        path
          ? `${path} L ${point.planPoint[0]} ${point.planPoint[1]}`
          : `M ${point.planPoint[0]} ${point.planPoint[1]}`,
      )
    }
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.button !== 0 ||
        activeRef.current ||
        !isEnvironmentPaintScopeActive()
      ) {
        return
      }
      const point = resolvePoint(event)
      if (!point || !pointInsideSite(point.sitePoint)) return
      if (!claimEnvironmentPaintStroke(ownerRef.current)) return
      consume(event)
      activeRef.current = {
        ...latest.current.start(point.sitePoint),
        pointerId: event.pointerId,
        targetKey: latest.current.targetKey,
      }
      svg.setPointerCapture(event.pointerId)
      setPreviewPath(`M ${point.planPoint[0]} ${point.planPoint[1]}`)
      applyDab(event)
    }
    const onPointerMove = (event: PointerEvent) => {
      if (activeRef.current) {
        applyDab(event)
        return
      }
      if ((event.buttons & 0b110) !== 0) {
        setHover(null)
        return
      }
      const point = resolvePoint(event)
      setHover(point && pointInsideSite(point.sitePoint) ? point.planPoint : null)
    }
    const onPointerUp = (event: PointerEvent) => {
      const active = activeRef.current
      if (!active || active.pointerId !== event.pointerId) return
      if (
        !isEnvironmentPaintScopeActive() ||
        active.targetKey !== latest.current.targetKey
      ) {
        abandon()
        return
      }
      consume(event)
      activeRef.current = null
      active.commit(currentPaintField(active.stroke))
      releaseSession(active)
    }
    const onPointerCancel = (event: PointerEvent) => {
      if (activeRef.current?.pointerId === event.pointerId) abandon()
    }
    const onPointerLeave = () => {
      setHover(null)
      const active = activeRef.current
      if (active) detachPaintStrokeAnchor(active.stroke)
    }
    const onLostPointerCapture = (event: PointerEvent) => {
      if (activeRef.current?.pointerId === event.pointerId) abandon()
    }
    const onClick = (event: MouseEvent) => {
      if (event.button === 0) consume(event)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      markToolCancelConsumed()
      if (!abandon()) finishTool()
    }
    const onBlur = () => abandon()
    const onToolCancel = () => {
      if (abandon()) markToolCancelConsumed()
    }


    svg.addEventListener('pointerdown', onPointerDown, true)
    svg.addEventListener('pointermove', onPointerMove, true)
    svg.addEventListener('pointerup', onPointerUp, true)
    svg.addEventListener('pointercancel', onPointerCancel, true)
    svg.addEventListener('pointerleave', onPointerLeave, true)
    svg.addEventListener('lostpointercapture', onLostPointerCapture, true)
    svg.addEventListener('click', onClick, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onBlur)
    emitter.on('tool:cancel', onToolCancel)
    return () => {
      svg.removeEventListener('pointerdown', onPointerDown, true)
      svg.removeEventListener('pointermove', onPointerMove, true)
      svg.removeEventListener('pointerup', onPointerUp, true)
      svg.removeEventListener('pointercancel', onPointerCancel, true)
      svg.removeEventListener('pointerleave', onPointerLeave, true)
      svg.removeEventListener('lostpointercapture', onLostPointerCapture, true)
      svg.removeEventListener('click', onClick, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onBlur)
      emitter.off('tool:cancel', onToolCancel)
      unsubscribeScope()
      abandon()
    }
  }, [finishTool])

  const unitsPerPixel = renderContext?.unitsPerPixel ?? 0.01
  const radius = settings.radius
  const square = settings.shape === 'square'
  const previewOpacity = settings.mode === 'erase' ? 0.18 : 0.3

  return (
    <g ref={groupRef}>
      {previewPath ? (
        <path
          d={previewPath}
          fill="none"
          opacity={previewOpacity}
          pointerEvents="none"
          stroke={cursorColor}
          strokeLinecap={square ? 'square' : 'round'}
          strokeLinejoin={square ? 'miter' : 'round'}
          strokeWidth={radius * 2}
        />
      ) : null}
      {hover ? (
        <g pointerEvents="none">
          {square ? (
            <rect
              fill="none"
              height={radius * 2}
              stroke={cursorColor}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              width={radius * 2}
              x={hover[0] - radius}
              y={hover[1] - radius}
            />
          ) : (
            <circle
              cx={hover[0]}
              cy={hover[1]}
              fill="none"
              r={radius}
              stroke={cursorColor}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          )}
          <circle
            cx={hover[0]}
            cy={hover[1]}
            fill={cursorColor}
            r={Math.max(3 * unitsPerPixel, 0.035)}
          />
        </g>
      ) : null}
    </g>
  )
}
