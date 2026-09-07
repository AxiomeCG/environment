import { useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import { Euler, Group, Matrix4, Quaternion, Vector3 } from 'three'
import { houseBodyFrame, houseFacadeFrame, houseGarageOffset } from './neighborhood'
import type { HousePlan } from './neighborhood'
import { disposePrimitiveInstances, PrimitiveInstances } from './primitive-instances'
import type { HousePrimitive } from './primitive-instances'
import type { PresentationSurface } from './presentation-material'
import { windowSurface } from './night-lighting'

export type HouseNeighborhoodProps = Readonly<{ plans: readonly HousePlan[]; heightAt?: (x: number, z: number) => number }>
const FOUNDATION_HEIGHT = 0.18
const FLAT_HEIGHT: (x: number, z: number) => number = () => 0

/** Presentation-only LOD of the existing house plans. No Pascal nodes, CSG,
 * transparent interiors, per-house geometry, BVHs, or shadow casters. */
export function buildPascalHouseInstances(
  plans: readonly HousePlan[],
  heightAt = FLAT_HEIGHT,
  root = new Group(),
): Group {
  const instances = new PrimitiveInstances()
  const matrix = new Matrix4()
  const position = new Vector3()
  const scale = new Vector3()
  const rotation = new Quaternion()
  const euler = new Euler(0, 0, 0, 'YXZ')
  let primitiveCount = 0

  for (const plan of plans) {
    const yaw = Math.atan2(plan.front[0], plan.front[1])
    const body = houseBodyFrame(plan)
    const palette = plan.palette
    let groundLevel = -Infinity, lowestGround = Infinity
    for (let x = -1; x <= 1; x += 1) for (let z = -1; z <= 1; z += 1) {
      const height = heightAt(
        plan.center[0] + plan.right[0] * plan.width / 2 * x + plan.front[0] * plan.depth / 2 * z,
        plan.center[1] + plan.right[1] * plan.width / 2 * x + plan.front[1] * plan.depth / 2 * z,
      )
      groundLevel = Math.max(groundLevel, height)
      lowestGround = Math.min(lowestGround, height)
    }
    const foundationDepth = groundLevel - lowestGround + FOUNDATION_HEIGHT
    const add = (kind: HousePrimitive, surface: PresentationSurface, color: string,
      x: number, y: number, z: number, width: number, height: number, depth: number,
      pitch = 0, localYaw = 0) => {
      position.set(plan.center[0] + plan.right[0] * x + plan.front[0] * z, y + groundLevel,
        plan.center[1] + plan.right[1] * x + plan.front[1] * z)
      rotation.setFromEuler(euler.set(pitch, yaw + localYaw, 0, 'YXZ'))
      scale.set(width, height, depth)
      matrix.compose(position, rotation, scale)
      instances.add(kind, surface, color, matrix)
      primitiveCount += 1
    }
    const wallTop = FOUNDATION_HEIGHT + plan.wallHeight
    add('box', 'paint', palette.foundation, body.offset, FOUNDATION_HEIGHT - foundationDepth / 2, 0,
      body.width + 0.24, foundationDepth, plan.depth + 0.24)
    add('box', 'paint', palette.wall, body.offset, FOUNDATION_HEIGHT + plan.wallHeight / 2, 0,
      body.width, plan.wallHeight, plan.depth)
    // Plinth, fascia and a deep eave give the mass readable contact and shadow lines.
    add('box', 'paint', palette.trim, body.offset, wallTop, 0,
      body.width + plan.roof.overhang * 2, 0.16, plan.depth + plan.roof.overhang * 2)
    const roofHeight = Math.tan(plan.roof.pitchDegrees * Math.PI / 180) * body.width / 2
    add(plan.roof.kind, 'roof', palette.roof, body.offset, wallTop + 0.08, 0,
      body.width + plan.roof.overhang * 2, roofHeight, plan.depth + plan.roof.overhang * 2)
    if (plan.roof.kind !== 'hip') {
      add(plan.roof.kind === 'gambrel' ? 'gambrel-end' : 'gable-end', 'paint', palette.wall,
        body.offset, wallTop, 0, body.width, roofHeight, plan.depth)
    }
    if (plan.storeys === 2) {
      add('box', 'paint', palette.trim, body.offset, FOUNDATION_HEIGHT + 2.65, 0,
        body.width + 0.035, 0.1, plan.depth + 0.035)
    }
    for (const facade of plan.facades) {
      const frame = houseFacadeFrame(plan, facade.side)
      const faceYaw = Math.atan2(frame.outward[0], frame.outward[1])
      for (const [openingIndex, opening] of facade.openings.entries()) {
        const centerX = frame.center[0] + frame.right[0] * opening.offset
        const centerZ = frame.center[1] + frame.right[1] * opening.offset
        const openingBox = (width: number, height: number, offsetY: number, outward: number,
          color: string, surface: PresentationSurface = 'paint') => {
          position.set(centerX + frame.outward[0] * outward,
            groundLevel + FOUNDATION_HEIGHT + opening.bottom + opening.height / 2 + offsetY,
            centerZ + frame.outward[1] * outward)
          rotation.setFromEuler(euler.set(0, faceYaw, 0))
          matrix.compose(position, rotation, scale.set(width, height, 0.045))
          instances.add('box', surface, color, matrix)
          primitiveCount += 1
        }
        openingBox(opening.width + 0.14, opening.height + 0.14, 0, 0.04, palette.trim)
        openingBox(opening.width, opening.height, 0, 0.07,
          opening.kind === 'door' ? palette.door : palette.glass,
          opening.kind === 'window'
            ? windowSurface(plan.id, `${facade.side}:${openingIndex}`)
            : 'paint')
        if (opening.kind === 'window') {
          openingBox(0.045, opening.height, 0, 0.095, palette.trim)
          if (facade.side === 'front') {
            openingBox(opening.width, 0.045, 0, 0.095, palette.trim)
            openingBox(opening.width + 0.22, 0.075, -opening.height / 2 - 0.04, 0.1, palette.trim)
          }
        }
      }
    }
    const door = plan.facades.find(({ side }) => side === 'front')?.openings.find(({ kind }) => kind === 'door')
    if (door) {
      const targetPorchWidth = plan.style === 'farmhouse'
        ? body.width * 0.82
        : plan.style === 'pavilion'
          ? 4.2
          : plan.style === 'bungalow'
            ? body.width * 0.58
            : plan.style === 'townhouse'
              ? 2.1
              : 2.5
      const width = Math.min(body.width - 0.36, targetPorchWidth)
      const depth = plan.style === 'bungalow' ? 1.05 : plan.style === 'townhouse' ? 1.2 : 1.45
      const roofY = Math.min(2.66, wallTop - 0.04)
      const columnHeight = roofY - FOUNDATION_HEIGHT - 0.065
      const x = body.offset + door.offset
      const z = plan.depth / 2 + depth / 2 - 0.12
      add('box', 'paint', palette.foundation, x, 0.18, z, width, 0.18, depth)
      add('box', 'paint', palette.foundation, x, 0.065, z + depth / 2 + 0.18, 1.4, 0.13, 0.45)
      add('box', 'roof', palette.roof, x, roofY, z, Math.min(body.width, width + 0.4), 0.13, depth + 0.35, 0.12)
      for (const side of [-1, 1]) {
        add('box', 'paint', palette.trim, x + side * (width / 2 - 0.18),
          FOUNDATION_HEIGHT + columnHeight / 2, z + depth / 2 - 0.15,
          0.13, columnHeight, 0.13)
      }
    }
    const garage = plan.garage
    const offset = houseGarageOffset(plan)
    if (garage && offset) {
      add('box', 'paint', palette.wall, offset[0], FOUNDATION_HEIGHT + garage.wallHeight / 2, offset[1],
        garage.width, garage.wallHeight, garage.depth)
      add('box', 'paint', palette.foundation, offset[0], FOUNDATION_HEIGHT - foundationDepth / 2, offset[1],
        garage.width + 0.24, foundationDepth, garage.depth + 0.24)
      add('box', 'roof', palette.roof, offset[0], FOUNDATION_HEIGHT + garage.wallHeight + 0.4, offset[1],
        garage.width + 0.6, 0.14, garage.depth + 0.6, 0.1)
      add('box', 'paint', palette.trim, offset[0], FOUNDATION_HEIGHT + garage.door.height / 2, offset[1] + garage.depth / 2 + 0.03,
        garage.door.width + 0.16, garage.door.height + 0.12, 0.065)
      add('box', 'paint', palette.door, offset[0], FOUNDATION_HEIGHT + garage.door.height / 2, offset[1] + garage.depth / 2 + 0.07,
        garage.door.width, garage.door.height, 0.04)
    }
    if (plan.style === 'cottage' || plan.style === 'farmhouse' || plan.style === 'townhouse') {
      add('box', 'paint', palette.accent, body.offset + body.width * 0.22, wallTop + roofHeight * 0.7, -plan.depth * 0.25,
        0.5, roofHeight * 0.9, 0.65)
    }
  }
  instances.build('surroundings-house-neighborhood', root)
  Object.assign(root.userData, { houseCount: plans.length, logicalMeshCount: primitiveCount })
  return root
}

export function updatePascalHouseInstances(root: Group, plans: readonly HousePlan[], heightAt = FLAT_HEIGHT): void {
  buildPascalHouseInstances(plans, heightAt, root)
}

export function HouseNeighborhood({ plans, heightAt = FLAT_HEIGHT }: HouseNeighborhoodProps) {
  const instances = useMemo(() => {
    const root = new Group()
    root.name = 'surroundings-house-neighborhood'
    return root
  }, [])
  const invalidate = useThree((state) => state.invalidate)
  useLayoutEffect(() => {
    updatePascalHouseInstances(instances, plans, heightAt)
    invalidate()
  }, [instances, invalidate, plans, heightAt])
  useEffect(() => () => { disposePrimitiveInstances(instances) }, [instances])
  return <primitive object={instances} dispose={null} />
}
