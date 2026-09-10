'use client'

import {
  type AnyNode,
  type BuildingNode,
  type AnyNodeId,
  emitter,
  pointInPolygon2D,
  raycastTerrain,
  type SiteNode,
  terrainFieldOf,
  type TerrainField,
} from '@pascal-app/core'
import { markToolCancelConsumed, useRegistryToolContext } from '@pascal-app/editor'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import { useEnvironmentStore } from '../store'
import { useSceneApiNodes } from '../use-scene-api-nodes'
import GrassFieldBrushCursor from './brush-cursor'
import { resolveGrassHeightField } from './height-field'
import {
  getGrassHeightRuntime,
  updateGrassHeightTexture,
} from './height-texture'
import {
  DEFAULT_GRASS_PAINT_COLOR,
  encodeGrassPaintField,
  resolveGrassPaintField,
  siteBounds,
  type GrassPaintField,
} from './paint-field'
import { groundCoverPaintSettings } from './paint-settings'
import {
  advancePaintStroke,
  beginPaintStroke,
  currentPaintField,
  detachPaintStrokeAnchor,
  type PaintStroke,
} from './paint-stroke'
import { resolveActivePaintSite } from './paint-target'
import { getGrassPaintRuntime, updateGrassPaintTexture } from './paint-texture'
import { getGrassObstacleRuntime } from './obstacle-texture'
import {
  claimEnvironmentPaintStroke,
  isEnvironmentPaintScopeActive,
  mountEnvironmentPaintBody,
  releaseEnvironmentPaintStroke,
  subscribeEnvironmentPaintScopeLoss,
} from './paint-tool-lifecycle'
import type { GrassFieldNode } from './schema'

type PaintableGrassFieldNode = GrassFieldNode & {
  paintMap?: unknown
  heightMap?: unknown
}

type PaintTarget = {
  building: BuildingNode
  grassField: PaintableGrassFieldNode
  site: SiteNode
}

type ActivePaintStroke = {
  grassFieldId: string
  kind: 'density' | 'height'
  pointerId: number
  stroke: PaintStroke
  terrain: TerrainField | null
}

function resolvePaintTarget(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  activeLevelId: AnyNodeId | null,
): PaintTarget | null {
  const activeSite = resolveActivePaintSite(nodes, activeLevelId)
  if (!activeSite) return null
  const grassFields = (Object.values(nodes) as unknown as PaintableGrassFieldNode[]).filter(
    (node) => node.type === 'environment:ground-cover' && node.parentId === activeSite.site.id,
  )
  return grassFields.length === 1
    ? {
        building: activeSite.building,
        grassField: grassFields[0]!,
        site: activeSite.site,
      }
    : null
}

function pointInsideSite(site: SiteNode, x: number, z: number): boolean {
  return pointInPolygon2D([x, z], site.polygon.points, { includeBoundary: true })
}

export function GrassFieldPaintTool() {
  const { activeLevelId, isCameraDragging, sceneApi } = useRegistryToolContext()
  const { camera, gl } = useThree()
  const nodes = useSceneApiNodes(sceneApi)
  const settings = useEnvironmentStore((state) => state.groundCoverBrush)
  const brushTool = useEnvironmentStore((state) => state.groundCoverTool)
  const heightAmount = useEnvironmentStore(
    (state) => state.groundCoverHeightAmount,
  )
  const target = useMemo(() => resolvePaintTarget(nodes, activeLevelId), [activeLevelId, nodes])

  const latest = useRef({ target, settings, brushTool, heightAmount })
  latest.current = { target, settings, brushTool, heightAmount }

  const activeStrokeRef = useRef<ActivePaintStroke | null>(null)
  const ownerRef = useRef(Symbol('environment-ground-cover-paint'))
  const raycaster = useRef(new Raycaster())
  const pointer = useRef(new Vector2())
  const flatGround = useRef(new Plane(new Vector3(0, 1, 0), 0))
  const flatHit = useRef(new Vector3())

  useEffect(() => mountEnvironmentPaintBody(), [])

  useEffect(() => {
    const canvas = gl.domElement

    const groundPoint = (
      event: PointerEvent,
      site: SiteNode,
      terrain: TerrainField | null,
    ): [number, number] | null => {
      const rect = canvas.getBoundingClientRect()
      pointer.current.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.current.setFromCamera(pointer.current, camera)

      let x: number
      let z: number
      if (terrain) {
        const { origin, direction } = raycaster.current.ray
        const hit = raycastTerrain(
          terrain,
          [origin.x, origin.y, origin.z],
          [direction.x, direction.y, direction.z],
        )
        if (!hit) return null
        x = hit.x
        z = hit.z
      } else {
        const hit = raycaster.current.ray.intersectPlane(flatGround.current, flatHit.current)
        if (!hit) return null
        x = hit.x
        z = hit.z
      }

      return pointInsideSite(site, x, z) ? [x, z] : null
    }

    const releasePointer = (pointerId: number) => {
      if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId)
    }

    const abandonStroke = () => {
      const active = activeStrokeRef.current
      if (!active) return false
      activeStrokeRef.current = null
      releaseEnvironmentPaintStroke(ownerRef.current)
      releasePointer(active.pointerId)
      if (active.kind === 'height') {
        updateGrassHeightTexture(active.grassFieldId, active.stroke.snapshot)
      } else {
        updateGrassPaintTexture(active.grassFieldId, active.stroke.snapshot)
      }
      return true
    }
    const unsubscribeScope = subscribeEnvironmentPaintScopeLoss(() => {
      abandonStroke()
    })

    const applyDab = (event: PointerEvent) => {
      const active = activeStrokeRef.current
      if (!active || event.pointerId !== active.pointerId) return
      if (!isEnvironmentPaintScopeActive()) {
        abandonStroke()
        return
      }
      if (isCameraDragging()) {
        detachPaintStrokeAnchor(active.stroke)
        return
      }

      const currentTarget = latest.current.target
      if (!currentTarget || currentTarget.grassField.id !== active.grassFieldId) {
        abandonStroke()
        return
      }
      const point = groundPoint(event, currentTarget.site, active.terrain)
      if (!point) {
        detachPaintStrokeAnchor(active.stroke)
        return
      }
      const field = advancePaintStroke(active.stroke, point[0], point[1])
      if (!field) return
      if (active.kind === 'height') {
        updateGrassHeightTexture(active.grassFieldId, field)
      } else {
        updateGrassPaintTexture(active.grassFieldId, field)
      }
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      if (!isEnvironmentPaintScopeActive()) return

      const active = activeStrokeRef.current
      if (active) {
        if (event.pointerId !== active.pointerId) abandonStroke()
        return
      }
      if (isCameraDragging()) return

      const currentTarget = latest.current.target
      if (!currentTarget) return
      const { grassField, site } = currentTarget
      const terrain = terrainFieldOf(site)
      const point = groundPoint(event, site, terrain)
      if (!point) return
      if (!claimEnvironmentPaintStroke(ownerRef.current)) return

      const kind = latest.current.brushTool.endsWith('-height')
        ? 'height'
        : 'density'
      const field: GrassPaintField =
        kind === 'height'
          ? (getGrassHeightRuntime(grassField.id)?.field ??
            resolveGrassHeightField(
              grassField.heightMap,
              siteBounds(site.polygon.points),
            ))
          : (getGrassPaintRuntime(grassField.id)?.field ??
            resolveGrassPaintField(
              grassField.paintMap,
              siteBounds(site.polygon.points),
              DEFAULT_GRASS_PAINT_COLOR,
            ))
      const stroke = beginPaintStroke({
        field,
        boundary: site.polygon.points,
        settings: groundCoverPaintSettings(
          latest.current.brushTool,
          latest.current.settings,
          latest.current.heightAmount,
        ),
        obstacleField:
          kind === 'density'
            ? (getGrassObstacleRuntime(grassField.id)?.field ?? null)
            : null,
      })
      activeStrokeRef.current = {
        grassFieldId: grassField.id,
        kind,
        pointerId: event.pointerId,
        stroke,
        terrain,
      }
      canvas.setPointerCapture(event.pointerId)
      applyDab(event)
    }

    const handlePointerMove = (event: PointerEvent) => {
      applyDab(event)
    }

    const handlePointerUp = (event: PointerEvent) => {
      const active = activeStrokeRef.current
      if (!active || event.pointerId !== active.pointerId) return
      if (
        !isEnvironmentPaintScopeActive() ||
        latest.current.target?.grassField.id !== active.grassFieldId
      ) {
        abandonStroke()
        return
      }
      activeStrokeRef.current = null
      releaseEnvironmentPaintStroke(ownerRef.current)
      releasePointer(event.pointerId)

      const field = currentPaintField(active.stroke)
      sceneApi.update(
        active.grassFieldId as AnyNodeId,
        (active.kind === 'height'
          ? { heightMap: encodeGrassPaintField(field) }
          : { paintMap: encodeGrassPaintField(field) }) as unknown as Partial<AnyNode>,
      )
    }

    const handlePointerCancel = (event: PointerEvent) => {
      if (activeStrokeRef.current?.pointerId === event.pointerId) abandonStroke()
    }
    const handlePointerLeave = () => {
      const active = activeStrokeRef.current
      if (active) detachPaintStrokeAnchor(active.stroke)
    }

    const handleLostPointerCapture = (event: PointerEvent) => {
      if (activeStrokeRef.current?.pointerId === event.pointerId) abandonStroke()
    }

    const handleWindowBlur = () => {
      abandonStroke()
    }


    const handleToolCancel = () => {
      if (abandonStroke()) markToolCancelConsumed()
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', handlePointerUp)
    canvas.addEventListener('pointercancel', handlePointerCancel)
    canvas.addEventListener('pointerleave', handlePointerLeave)
    canvas.addEventListener('lostpointercapture', handleLostPointerCapture)
    window.addEventListener('blur', handleWindowBlur)
    emitter.on('tool:cancel', handleToolCancel)

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', handlePointerUp)
      canvas.removeEventListener('pointercancel', handlePointerCancel)
      canvas.removeEventListener('pointerleave', handlePointerLeave)
      canvas.removeEventListener('lostpointercapture', handleLostPointerCapture)
      window.removeEventListener('blur', handleWindowBlur)
      emitter.off('tool:cancel', handleToolCancel)
      unsubscribeScope()
      abandonStroke()
    }
  }, [camera, gl, isCameraDragging, sceneApi])

  if (!target) return null
  return (
    <GrassFieldBrushCursor
      building={target.building}
      settings={groundCoverPaintSettings(brushTool, settings, heightAmount)}
      site={target.site}
    />
  )
}

export default GrassFieldPaintTool
