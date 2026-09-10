'use client'

import {
  type BuildingNode,
  pointInPolygon2D,
  raycastTerrain,
  type SiteNode,
  surfaceHeightAt,
  terrainFieldOf,
} from '@pascal-app/core'
import { EDITOR_LAYER } from '@pascal-app/editor'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  Float32BufferAttribute,
  type Group,
  type Line,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import { DEFAULT_PAINT_STROKE_SETTINGS, type PaintStrokeSettings } from './paint-stroke'

const RING_SEGMENTS = 64
const RING_LIFT = 0.02
const NO_RAYCAST = () => null

export type GrassFieldBrushCursorProps = {
  building: BuildingNode
  settings: Partial<PaintStrokeSettings>
  site: SiteNode
}

function cursorColor(settings: Partial<PaintStrokeSettings>): string {
  if (settings.mode === 'erase') return '#ef4444'
  if (settings.mode === 'smooth') return '#38bdf8'
  return settings.color ?? DEFAULT_PAINT_STROKE_SETTINGS.color
}

export function GrassFieldBrushCursor({
  building,
  settings,
  site,
}: GrassFieldBrushCursorProps) {
  const { camera, gl } = useThree()
  const lineRef = useRef<Line>(null)
  const centerRef = useRef<Group>(null)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const raycaster = useRef(new Raycaster())
  const ndc = useRef(new Vector2())
  const flatGround = useRef(new Plane(new Vector3(0, 1, 0), 0))
  const flatHit = useRef(new Vector3())

  const radius =
    Number.isFinite(settings.radius) && (settings.radius ?? 0) > 0
      ? (settings.radius as number)
      : DEFAULT_PAINT_STROKE_SETTINGS.radius
  const shape = settings.shape === 'square' ? 'square' : 'round'
  const color = cursorColor(settings)

  const geometry = useMemo(() => {
    const positions = new Float32Array((RING_SEGMENTS + 1) * 3)
    const ring = new BufferGeometry()
    ring.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return ring
  }, [])

  useEffect(() => () => geometry.dispose(), [geometry])

  useEffect(() => {
    const canvas = gl.domElement
    const trackPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      pointerRef.current = {
        x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
      }
    }
    const hide = () => {
      pointerRef.current = null
    }

    canvas.addEventListener('pointermove', trackPointer)
    canvas.addEventListener('pointerleave', hide)
    return () => {
      canvas.removeEventListener('pointermove', trackPointer)
      canvas.removeEventListener('pointerleave', hide)
    }
  }, [gl])

  useFrame(() => {
    const line = lineRef.current
    const center = centerRef.current
    const pointer = pointerRef.current
    if (!(line && center)) return
    if (!pointer) {
      line.visible = false
      center.visible = false
      return
    }

    ndc.current.set(pointer.x, pointer.y)
    raycaster.current.setFromCamera(ndc.current, camera)
    const terrain = terrainFieldOf(site)

    let x: number
    let z: number
    if (terrain) {
      const { origin, direction } = raycaster.current.ray
      const hit = raycastTerrain(
        terrain,
        [origin.x, origin.y, origin.z],
        [direction.x, direction.y, direction.z],
      )
      if (!hit) {
        line.visible = false
        center.visible = false
        return
      }
      x = hit.x
      z = hit.z
    } else {
      const hit = raycaster.current.ray.intersectPlane(flatGround.current, flatHit.current)
      if (!hit) {
        line.visible = false
        center.visible = false
        return
      }
      x = hit.x
      z = hit.z
    }

    if (!pointInPolygon2D([x, z], site.polygon.points, { includeBoundary: true })) {
      line.visible = false
      center.visible = false
      return
    }

    line.visible = true
    center.visible = true
    const position = line.geometry.getAttribute('position')
    const values = position.array as Float32Array

    const cosBuilding = Math.cos(building.rotation[1])
    const sinBuilding = Math.sin(building.rotation[1])
    const buildingX = building.position[0]
    const buildingY = building.position[1]
    const buildingZ = building.position[2]
    for (let index = 0; index <= RING_SEGMENTS; index += 1) {
      const angle = (index / RING_SEGMENTS) * Math.PI * 2
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const shapeScale =
        shape === 'square' ? 1 / Math.max(Math.abs(cos), Math.abs(sin), Number.EPSILON) : 1
      const ringX = x + cos * radius * shapeScale
      const ringZ = z + sin * radius * shapeScale
      const deltaX = ringX - buildingX
      const deltaZ = ringZ - buildingZ
      values[index * 3] = deltaX * cosBuilding - deltaZ * sinBuilding
      values[index * 3 + 1] =
        (terrain ? surfaceHeightAt(terrain, ringX, ringZ) : 0) - buildingY + RING_LIFT
      values[index * 3 + 2] = deltaX * sinBuilding + deltaZ * cosBuilding
    }

    position.needsUpdate = true
    line.geometry.computeBoundingSphere()
    const centerDeltaX = x - buildingX
    const centerDeltaZ = z - buildingZ
    center.position.set(
      centerDeltaX * cosBuilding - centerDeltaZ * sinBuilding,
      (terrain ? surfaceHeightAt(terrain, x, z) : 0) - buildingY + RING_LIFT,
      centerDeltaX * sinBuilding + centerDeltaZ * cosBuilding,
    )
  })

  return (
    <>
      <line
        frustumCulled={false}
        geometry={geometry}
        layers={EDITOR_LAYER}
        raycast={NO_RAYCAST}
        // @ts-expect-error R3F <line> conflicts with the SVG intrinsic type.
        ref={lineRef}
        renderOrder={13}
        visible={false}
      >
        <lineBasicNodeMaterial color={color} depthTest={false} depthWrite={false} linewidth={2} />
      </line>
      <group ref={centerRef} visible={false}>
        <mesh
          layers={EDITOR_LAYER}
          raycast={NO_RAYCAST}
          renderOrder={14}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[0.055, 24]} />
          <meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
        </mesh>
      </group>
    </>
  )
}

export default GrassFieldBrushCursor
