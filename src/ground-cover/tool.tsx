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
import {
  type GroundCoverBrushTool,
  useEnvironmentStore,
} from '../store'
import {
  cancelEnvironmentPaintToolFor2D,
  type GroundCoverToolActionTarget,
} from '../pascal-tool-actions'
import GrassFieldBrushCursor from './brush-cursor'
import {
  grassHeightTargetColor,
  resolveGrassHeightField,
} from './height-field'
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
import {
  advancePaintStroke,
  beginPaintStroke,
  currentPaintField,
  detachPaintStrokeAnchor,
  type PaintStroke,
  type PaintStrokeSettings,
} from './paint-stroke'
import { getGrassPaintRuntime, updateGrassPaintTexture } from './paint-texture'
import { getGrassObstacleRuntime } from './obstacle-texture'
import type { GrassFieldNode } from './schema'

type PaintableGrassFieldNode = GrassFieldNode & {
  paintMap?: unknown
  heightMap?: unknown
}

type PaintTarget = {
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

function isGrassFieldNode(node: unknown): node is PaintableGrassFieldNode {
  return (
    typeof node === 'object' &&
    node !== null &&
    'type' in node &&
    node.type === 'environment:ground-cover'
  )
}

function resolvePaintTarget(nodes: Record<AnyNodeId, AnyNode>): PaintTarget | null {
  const grassFields = (Object.values(nodes) as unknown[]).filter(isGrassFieldNode)
  if (grassFields.length !== 1) return null

  const grassField = grassFields[0]
  if (!grassField?.parentId) return null
  const parent = nodes[grassField.parentId as AnyNodeId]
  if (parent?.type !== 'site') return null
  return { grassField, site: parent }
}

function pointInsideSite(site: SiteNode, x: number, z: number): boolean {
  return pointInPolygon2D([x, z], site.polygon.points, { includeBoundary: true })
}

export function GrassFieldPaintTool() {
  const { camera, gl } = useThree()
  const nodes = useScene((state) => state.nodes)
  const settings = useEnvironmentStore((state) => state.groundCoverBrush)
  const brushTool = useEnvironmentStore((state) => state.groundCoverTool)
  const heightAmount = useEnvironmentStore(
    (state) => state.groundCoverHeightAmount,
  )
  const target = useMemo(() => resolvePaintTarget(nodes), [nodes])

  const latest = useRef({ target, settings, brushTool, heightAmount })
  latest.current = { target, settings, brushTool, heightAmount }

  const activeStrokeRef = useRef<ActivePaintStroke | null>(null)
  const raycaster = useRef(new Raycaster())
  const pointer = useRef(new Vector2())
  const flatGround = useRef(new Plane(new Vector3(0, 1, 0), 0))
  const flatHit = useRef(new Vector3())

  useEffect(() => {
    useInteractionScope.getState().begin({ kind: 'painting' })
    return () => {
      const scope = useInteractionScope.getState()
      if (scope.scope.kind === 'painting') scope.end()
    }
  }, [])

  useEffect(
    () =>
      useEditor.subscribe((editor) => {
        cancelEnvironmentPaintToolFor2D(
          editor as unknown as GroundCoverToolActionTarget,
        )
      }),
    [],
  )

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
      releasePointer(active.pointerId)
      if (active.kind === 'height') {
        updateGrassHeightTexture(active.grassFieldId, active.stroke.snapshot)
      } else {
        updateGrassPaintTexture(active.grassFieldId, active.stroke.snapshot)
      }
      return true
    }

    const applyDab = (event: PointerEvent) => {
      const active = activeStrokeRef.current
      if (!active || event.pointerId !== active.pointerId) return
      if (useInteractionScope.getState().scope.kind !== 'painting') {
        abandonStroke()
        return
      }
      if (useViewer.getState().cameraDragging) {
        detachPaintStrokeAnchor(active.stroke)
        return
      }

      const currentTarget = latest.current.target
      if (!currentTarget || currentTarget.grassField.id !== active.grassFieldId) {
        abandonStroke()
        return
      }
      const point = groundPoint(event, currentTarget.site, active.terrain)
      if (!point) return
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
      if (useInteractionScope.getState().scope.kind !== 'painting') return

      const active = activeStrokeRef.current
      if (active) {
        if (event.pointerId !== active.pointerId) abandonStroke()
        return
      }
      if (useViewer.getState().cameraDragging) return

      const currentTarget = latest.current.target
      if (!currentTarget) return
      const { grassField, site } = currentTarget
      const terrain = terrainFieldOf(site)
      const point = groundPoint(event, site, terrain)
      if (!point) return

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
        settings: settingsForGroundCoverTool(
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
      activeStrokeRef.current = null
      releasePointer(event.pointerId)

      const field = currentPaintField(active.stroke)
      useScene.getState().updateNode(
        active.grassFieldId as AnyNodeId,
        (active.kind === 'height'
          ? { heightMap: encodeGrassPaintField(field) }
          : { paintMap: encodeGrassPaintField(field) }) as unknown as Partial<AnyNode>,
      )
    }

    const handlePointerCancel = (event: PointerEvent) => {
      if (activeStrokeRef.current?.pointerId === event.pointerId) abandonStroke()
    }

    const handleToolCancel = () => {
      if (abandonStroke()) markToolCancelConsumed()
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', handlePointerUp)
    canvas.addEventListener('pointercancel', handlePointerCancel)
    emitter.on('tool:cancel', handleToolCancel)

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', handlePointerUp)
      canvas.removeEventListener('pointercancel', handlePointerCancel)
      emitter.off('tool:cancel', handleToolCancel)
      abandonStroke()
    }
  }, [camera, gl])

  if (!target) return null
  return (
    <GrassFieldBrushCursor
      settings={settingsForGroundCoverTool(brushTool, settings, heightAmount)}
      site={target.site}
    />
  )
}

function settingsForGroundCoverTool(
  tool: GroundCoverBrushTool,
  brush: PaintStrokeSettings,
  heightAmount: number,
): PaintStrokeSettings {
  if (tool === 'paint-density') return { ...brush, mode: 'paint' }
  if (tool === 'erase-density') return { ...brush, mode: 'erase' }
  if (tool === 'smooth-density') return { ...brush, mode: 'smooth' }
  if (tool === 'smooth-height') return { ...brush, mode: 'smooth' }

  const direction = tool === 'raise-height' ? 'raise' : 'lower'
  return {
    ...brush,
    mode: 'paint',
    color: grassHeightTargetColor(direction, heightAmount),
    targetDensity: 1,
    premultiplyColorByDensity: false,
  }
}

export default GrassFieldPaintTool
