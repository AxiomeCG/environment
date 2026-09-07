import { describe, expect, test } from 'bun:test'
import { Group, InstancedMesh, Matrix4, Vector3, type Object3D } from 'three'
import type { PondSurface } from './basin'
import {
  buildPondKoiMotionPlan,
  evaluatePondKoiPose,
  pondKoiPoseFitsSurface,
  updatePondKoiMotion,
  type PondKoiInput,
} from './koi-motion'
import { buildPondPropGeometry } from './props'
import type { PondProp } from './schema'

function gridSurface(
  columns: number,
  rows: number,
  wet: (column: number, row: number) => boolean,
  depth = 1,
): PondSurface {
  const positions: number[] = []
  const depths: number[] = []
  let area = 0
  const append = (x: number, z: number) => {
    positions.push(x, 1, z)
    depths.push(depth)
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (!wet(column, row)) continue
      append(column, row)
      append(column + 1, row)
      append(column + 1, row + 1)
      append(column, row)
      append(column + 1, row + 1)
      append(column, row + 1)
      area += 1
    }
  }
  return {
    level: 1,
    positions: new Float32Array(positions),
    depths: new Float32Array(depths),
    area,
  }
}

function koiInput(id: string, x: number, z: number, scale = 0.7): PondKoiInput {
  return { id, position: [x, z], yaw: 0.37, scale, y: 0.9 }
}

function matrixOf(mesh: InstancedMesh, index = 0): Matrix4 {
  const matrix = new Matrix4()
  mesh.getMatrixAt(index, matrix)
  return matrix
}

function findBatch(root: Object3D, name: string): InstancedMesh {
  let found: InstancedMesh | null = null
  root.traverse((object) => {
    if (!found && object instanceof InstancedMesh && object.name.startsWith(name)) {
      found = object
    }
  })
  if (!found) throw new Error(`Missing pond instance batch: ${name}`)
  return found
}

describe('pond koi motion', () => {
  test('replays seeded routes, follows their tangent, and stays inside concave water around an island', () => {
    const surface = gridSurface(
      8,
      8,
      (column, row) => !(column >= 3 && column <= 4 && row >= 3 && row <= 4)
        && !(column >= 6 && row <= 3),
    )
    const inputs = [
      koiInput('island-koi', 1.5, 4.5),
      koiInput('concave-koi', 4.5, 6.5, 0.55),
    ]
    const first = buildPondKoiMotionPlan(surface, inputs)
    const replay = buildPondKoiMotionPlan(surface, inputs)

    expect(first).toEqual(replay)
    expect(first.fish.some((route) => route.moving)).toBe(true)
    expect(first.fish[0]?.tailPhase).not.toBe(first.fish[1]?.tailPhase)
    expect(first.fish[0]?.bodyPhase).not.toBe(first.fish[1]?.bodyPhase)
    for (const route of first.fish) {
      for (let sample = 0; sample < 192; sample += 1) {
        const time = sample * 0.31
        const pose = evaluatePondKoiPose(route, time)
        expect(pondKoiPoseFitsSurface(surface, route, time)).toBe(true)
        if (!route.moving) continue
        const before = evaluatePondKoiPose(route, time - 0.001)
        const after = evaluatePondKoiPose(route, time + 0.001)
        const velocityX = after.position[0] - before.position[0]
        const velocityZ = after.position[2] - before.position[2]
        const tangentYaw = pose.yaw
          - Math.sin(time * route.bodySwayFrequency + route.bodyPhase)
            * route.bodySwayAmplitude
        const alignment = (
          velocityX * Math.cos(tangentYaw) - velocityZ * Math.sin(tangentYaw)
        ) / Math.hypot(velocityX, velocityZ)
        expect(alignment).toBeGreaterThan(0.99999)
      }
    }
  })

  test('falls back to a bounded stationary beat when a pond cannot hold a swim orbit', () => {
    const surface = gridSurface(1, 1, () => true)
    const route = buildPondKoiMotionPlan(
      surface,
      [{ ...koiInput('small-pond-koi', 0.5, 0.5, 0.9), yaw: 0 }],
    ).fish[0]

    expect(route).toBeDefined()
    if (!route) return
    expect(route.moving).toBe(false)
    expect(route.tailAmplitude).toBeGreaterThan(0)
    for (let sample = 0; sample < 128; sample += 1) {
      const time = sample * 0.17
      const pose = evaluatePondKoiPose(route, time)
      expect(pose.position[0]).toBeCloseTo(0.5, 12)
      expect(pose.position[2]).toBeCloseTo(0.5, 12)
      expect(pondKoiPoseFitsSurface(surface, route, time)).toBe(true)
    }
  })

  test('updates synchronized instance batches without moving lilies and pivots each tail in place', () => {
    const surface = gridSurface(10, 10, () => true, 2)
    const props: PondProp[] = [
      { id: 'animated-koi', kind: 'koi', position: [5, 5], yaw: 0.2, scale: 1 },
      { id: 'static-lily', kind: 'water-lily', position: [2, 2], yaw: 0, scale: 1 },
    ]
    const root = buildPondPropGeometry(props, surface)
    const bodies = findBatch(root, 'Pond koi bodies')
    const tails = findBatch(root, 'Pond koi tails')
    const markings = findBatch(root, 'Pond koi markings')
    const lily = findBatch(root, 'Pond lily pads')
    const lilyBefore = Array.from(lily.instanceMatrix.array)

    updatePondKoiMotion(root, 0)
    const bodyAtZero = matrixOf(bodies)
    const tailAtZero = matrixOf(tails)
    updatePondKoiMotion(root, 3)
    const bodyAtThree = matrixOf(bodies)
    const tailAtThree = matrixOf(tails)
    const markingAtThree = matrixOf(markings)

    expect(bodyAtThree.elements).not.toEqual(bodyAtZero.elements)
    expect(tailAtThree.elements).not.toEqual(tailAtZero.elements)
    expect(markingAtThree.elements).toEqual(bodyAtThree.elements)
    const pivot = new Vector3(-0.25, 0, 0)
    expect(pivot.clone().applyMatrix4(tailAtThree).distanceTo(
      pivot.clone().applyMatrix4(bodyAtThree),
    )).toBeLessThan(1e-6) // Instance matrices are stored as Float32.
    expect(Array.from(lily.instanceMatrix.array)).toEqual(lilyBefore)

    updatePondKoiMotion(root, 3)
    expect(matrixOf(bodies).elements).toEqual(bodyAtThree.elements)
    expect(matrixOf(tails).elements).toEqual(tailAtThree.elements)
  })

  test('re-resolves rebuilt editor children and leaves portable props static', () => {
    const surface = gridSurface(8, 8, () => true, 2)
    const koi: PondProp = {
      id: 'rebuilt-koi',
      kind: 'koi',
      position: [4, 4],
      yaw: 0,
      scale: 1,
    }
    const registeredRoot = new Group()
    const first = buildPondPropGeometry([koi], surface)
    registeredRoot.add(first)
    expect(updatePondKoiMotion(registeredRoot, 1)).toBe(true)

    registeredRoot.remove(first)
    const rebuilt = buildPondPropGeometry([koi], surface)
    registeredRoot.add(rebuilt)
    const rebuiltBodies = findBatch(rebuilt, 'Pond koi bodies')
    const initial = matrixOf(rebuiltBodies)
    expect(updatePondKoiMotion(registeredRoot, 4)).toBe(true)
    expect(matrixOf(rebuiltBodies).elements).not.toEqual(initial.elements)

    const portable = buildPondPropGeometry([koi], surface, true)
    let hasInstances = false
    portable.traverse((object) => {
      if (object instanceof InstancedMesh) hasInstances = true
    })
    expect(hasInstances).toBe(false)
    expect(updatePondKoiMotion(portable, 4)).toBe(false)
  })

  test('keeps the persisted 32-koi cap across all color batches', () => {
    const surface = gridSurface(12, 12, () => true, 2)
    const props: PondProp[] = Array.from({ length: 40 }, (_, index) => ({
      id: `capped-koi-${index}`,
      kind: 'koi',
      position: [6, 6],
      yaw: index * 0.1,
      scale: 0.5,
    }))
    const root = buildPondPropGeometry(props, surface)
    let bodyCount = 0
    root.traverse((object) => {
      if (object instanceof InstancedMesh && object.name.startsWith('Pond koi bodies')) {
        bodyCount += object.count
      }
    })
    expect(bodyCount).toBe(32)
    expect((root.getObjectByName('Pond koi markings') as InstancedMesh).count).toBe(32)
  })
})
