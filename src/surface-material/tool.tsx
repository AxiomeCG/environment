'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
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
import {
  claimEnvironmentPaintStroke,
  isEnvironmentPaintScopeActive,
  mountEnvironmentPaintBody,
  releaseEnvironmentPaintStroke,
  subscribeEnvironmentPaintScopeLoss,
} from '../ground-cover/paint-tool-lifecycle'
import GrassFieldBrushCursor from '../ground-cover/brush-cursor'
import { rgbToHex } from '../ground-cover/paint-field'
import {
  advancePaintStroke,
  beginPaintStroke,
  currentPaintField,
  detachPaintStrokeAnchor,
  type PaintStroke,
} from '../ground-cover/paint-stroke'
import { siteBounds } from '../ground-cover/paint-field'
import { resolveActivePaintSite } from '../ground-cover/paint-target'
import { useEnvironmentStore } from '../store'
import { useSceneApiNodes } from '../use-scene-api-nodes'
import { encodeSurfaceMaterialField, resolveSurfaceMaterialField, type SurfaceMaterialField } from './field'
import { SURFACE_MATERIAL_PAINT_COLOR } from './material-types'
import { SURFACE_MATERIAL_KIND, type SurfaceMaterialNode } from './schema'
import { updateSurfacePaintTextures } from './texture'

type PaintTarget = {
  building: BuildingNode
  site: SiteNode
  surface: SurfaceMaterialNode
}
type ActiveStroke = {
  surfaceId: string
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
  const surfaces = (Object.values(nodes) as unknown as SurfaceMaterialNode[]).filter(
    (node) => node.type === SURFACE_MATERIAL_KIND && node.parentId === activeSite.site.id,
  )
  return surfaces.length === 1
    ? { building: activeSite.building, site: activeSite.site, surface: surfaces[0]! }
    : null
}

export default function SurfaceMaterialPaintTool() {
  const { activeLevelId, isCameraDragging, sceneApi } = useRegistryToolContext()
  const { camera, gl } = useThree()
  const nodes = useSceneApiNodes(sceneApi)
  const settings = useEnvironmentStore((state) => state.surfaceBrush)
  const selectedMaterial = useEnvironmentStore((state) => state.surfaceMaterial)
  const target = useMemo(() => resolvePaintTarget(nodes, activeLevelId), [activeLevelId, nodes])
  const latest = useRef({ target, settings, selectedMaterial })
  latest.current = { target, settings, selectedMaterial }
  const activeStroke = useRef<ActiveStroke | null>(null)
  const ownerRef = useRef(Symbol('environment-surface-paint'))
  const raycaster = useRef(new Raycaster())
  const pointer = useRef(new Vector2())
  const flatGround = useRef(new Plane(new Vector3(0, 1, 0), 0))
  const flatHit = useRef(new Vector3())

  useEffect(() => mountEnvironmentPaintBody(), [])

  useEffect(() => {
    const canvas = gl.domElement
    const release = (pointerId: number) => {
      if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId)
    }
    const abandon = () => {
      const active = activeStroke.current
      if (!active) return false
      activeStroke.current = null
      releaseEnvironmentPaintStroke(ownerRef.current)
      release(active.pointerId)
      updateSurfacePaintTextures(active.surfaceId, active.stroke.snapshot)
      return true
    }
    const unsubscribeScope = subscribeEnvironmentPaintScopeLoss(() => {
      abandon()
    })
    const groundPoint = (event: PointerEvent, site: SiteNode, terrain: TerrainField | null) => {
      const rect = canvas.getBoundingClientRect()
      pointer.current.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.current.setFromCamera(pointer.current, camera)
      const hit = terrain
        ? raycastTerrain(
            terrain,
            [raycaster.current.ray.origin.x, raycaster.current.ray.origin.y, raycaster.current.ray.origin.z],
            [raycaster.current.ray.direction.x, raycaster.current.ray.direction.y, raycaster.current.ray.direction.z],
          )
        : raycaster.current.ray.intersectPlane(flatGround.current, flatHit.current)
      if (!hit || !pointInPolygon2D([hit.x, hit.z], site.polygon.points, { includeBoundary: true })) return null
      return [hit.x, hit.z] as const
    }
    const dab = (event: PointerEvent) => {
      const active = activeStroke.current
      if (!active || event.pointerId !== active.pointerId) return
      if (!isEnvironmentPaintScopeActive() || isCameraDragging()) {
        detachPaintStrokeAnchor(active.stroke)
        return
      }
      const current = latest.current.target
      if (!current || current.surface.id !== active.surfaceId) return abandon()
      const point = groundPoint(event, current.site, active.terrain)
      if (!point) {
        detachPaintStrokeAnchor(active.stroke)
        return
      }
      const field = advancePaintStroke(active.stroke, point[0], point[1])
      if (field) updateSurfacePaintTextures(active.surfaceId, field)
    }
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || activeStroke.current || isCameraDragging()) return
      const current = latest.current.target
      if (!current || !isEnvironmentPaintScopeActive()) return
      const terrain = terrainFieldOf(current.site)
      const point = groundPoint(event, current.site, terrain)
      if (!point) return
      if (!claimEnvironmentPaintStroke(ownerRef.current)) return
      const field: SurfaceMaterialField = resolveSurfaceMaterialField(
        current.surface.paintMap,
        siteBounds(current.site.polygon.points),
      )
      activeStroke.current = {
        surfaceId: current.surface.id,
        pointerId: event.pointerId,
        terrain,
        stroke: beginPaintStroke({
          field,
          boundary: current.site.polygon.points,
          settings: {
            ...latest.current.settings,
            color: rgbToHex(SURFACE_MATERIAL_PAINT_COLOR[latest.current.selectedMaterial]),
            premultiplyColorByDensity: true,
            clipToBoundary: false,
            targetDensity: 1,
          },
        }),
      }
      canvas.setPointerCapture(event.pointerId)
      dab(event)
    }
    const up = (event: PointerEvent) => {
      const active = activeStroke.current
      if (!active || active.pointerId !== event.pointerId) return
      if (
        !isEnvironmentPaintScopeActive() ||
        latest.current.target?.surface.id !== active.surfaceId
      ) {
        abandon()
        return
      }
      activeStroke.current = null
      releaseEnvironmentPaintStroke(ownerRef.current)
      release(event.pointerId)
      sceneApi.update(
        active.surfaceId as AnyNodeId,
        {
          paintMap: encodeSurfaceMaterialField(currentPaintField(active.stroke)),
        } as unknown as Partial<AnyNode>,
      )
    }
    const handlePointerCancel = (event: PointerEvent) => {
      if (activeStroke.current?.pointerId === event.pointerId) abandon()
    }
    const handlePointerLeave = () => {
      const active = activeStroke.current
      if (active) detachPaintStrokeAnchor(active.stroke)
    }
    const handleLostPointerCapture = (event: PointerEvent) => {
      if (activeStroke.current?.pointerId === event.pointerId) abandon()
    }
    const handleWindowBlur = () => {
      abandon()
    }
    const cancel = () => {
      if (abandon()) markToolCancelConsumed()
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', dab)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', handlePointerCancel)
    canvas.addEventListener('pointerleave', handlePointerLeave)
    canvas.addEventListener('lostpointercapture', handleLostPointerCapture)
    window.addEventListener('blur', handleWindowBlur)
    emitter.on('tool:cancel', cancel)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', dab)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', handlePointerCancel)
      canvas.removeEventListener('pointerleave', handlePointerLeave)
      canvas.removeEventListener('lostpointercapture', handleLostPointerCapture)
      window.removeEventListener('blur', handleWindowBlur)
      emitter.off('tool:cancel', cancel)
      unsubscribeScope()
      abandon()
    }
  }, [camera, gl, isCameraDragging, sceneApi])

  return target ? (
    <GrassFieldBrushCursor building={target.building} settings={settings} site={target.site} />
  ) : null
}
