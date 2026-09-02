'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  pointInPolygon2D,
  raycastTerrain,
  type SiteNode,
  terrainFieldOf,
  type TerrainField,
  useScene,
} from '@pascal-app/core'
import { markToolCancelConsumed, useEditor, useInteractionScope } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import { cancelEnvironmentPaintToolFor2D, type GroundCoverToolActionTarget } from '../pascal-tool-actions'
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
import { useEnvironmentStore } from '../store'
import { encodeSurfaceMaterialField, resolveSurfaceMaterialField, type SurfaceMaterialField } from './field'
import { SURFACE_MATERIAL_PAINT_COLOR } from './material-types'
import { SURFACE_MATERIAL_KIND, type SurfaceMaterialNode } from './schema'
import { updateSurfacePaintTextures } from './texture'

type PaintTarget = { surface: SurfaceMaterialNode; site: SiteNode }
type ActiveStroke = {
  surfaceId: string
  pointerId: number
  stroke: PaintStroke
  terrain: TerrainField | null
}

function resolvePaintTarget(nodes: Record<AnyNodeId, AnyNode>): PaintTarget | null {
  const surface = Object.values(nodes).find(
    (node) => (node.type as string) === SURFACE_MATERIAL_KIND,
  ) as unknown as SurfaceMaterialNode | undefined
  if (!surface?.parentId) return null
  const site = nodes[surface.parentId as AnyNodeId]
  return site?.type === 'site' ? { surface, site } : null
}

export default function SurfaceMaterialPaintTool() {
  const { camera, gl } = useThree()
  const nodes = useScene((state) => state.nodes)
  const settings = useEnvironmentStore((state) => state.surfaceBrush)
  const selectedMaterial = useEnvironmentStore((state) => state.surfaceMaterial)
  const target = useMemo(() => resolvePaintTarget(nodes), [nodes])
  const latest = useRef({ target, settings, selectedMaterial })
  latest.current = { target, settings, selectedMaterial }
  const activeStroke = useRef<ActiveStroke | null>(null)
  const raycaster = useRef(new Raycaster())
  const pointer = useRef(new Vector2())
  const flatGround = useRef(new Plane(new Vector3(0, 1, 0), 0))
  const flatHit = useRef(new Vector3())

  useEffect(() => {
    useInteractionScope.getState().begin({ kind: 'painting' })
    return () => {
      if (useInteractionScope.getState().scope.kind === 'painting') useInteractionScope.getState().end()
    }
  }, [])
  useEffect(
    () =>
      useEditor.subscribe((editor) => {
        cancelEnvironmentPaintToolFor2D(editor as unknown as GroundCoverToolActionTarget)
      }),
    [],
  )

  useEffect(() => {
    const canvas = gl.domElement
    const release = (pointerId: number) => {
      if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId)
    }
    const abandon = () => {
      const active = activeStroke.current
      if (!active) return false
      activeStroke.current = null
      release(active.pointerId)
      updateSurfacePaintTextures(active.surfaceId, active.stroke.snapshot)
      return true
    }
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
      if (useInteractionScope.getState().scope.kind !== 'painting' || useViewer.getState().cameraDragging) {
        detachPaintStrokeAnchor(active.stroke)
        return
      }
      const current = latest.current.target
      if (!current || current.surface.id !== active.surfaceId) return abandon()
      const point = groundPoint(event, current.site, active.terrain)
      if (!point) return
      const field = advancePaintStroke(active.stroke, point[0], point[1])
      if (field) updateSurfacePaintTextures(active.surfaceId, field)
    }
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || activeStroke.current || useViewer.getState().cameraDragging) return
      const current = latest.current.target
      if (!current || useInteractionScope.getState().scope.kind !== 'painting') return
      const terrain = terrainFieldOf(current.site)
      const point = groundPoint(event, current.site, terrain)
      if (!point) return
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
      activeStroke.current = null
      release(event.pointerId)
      useScene.getState().updateNode(
        active.surfaceId as AnyNodeId,
        { paintMap: encodeSurfaceMaterialField(currentPaintField(active.stroke)) } as Partial<AnyNode>,
      )
    }
    const cancel = () => {
      if (abandon()) markToolCancelConsumed()
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', dab)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', abandon)
    emitter.on('tool:cancel', cancel)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', dab)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', abandon)
      emitter.off('tool:cancel', cancel)
      abandon()
    }
  }, [camera, gl])

  return target ? <GrassFieldBrushCursor settings={settings} site={target.site} /> : null
}
