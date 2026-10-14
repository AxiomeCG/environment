import { describe, expect, test } from 'bun:test'
import { Mesh, Vector3 } from 'three'
import { exportEnvironmentConfiguration } from '../presentation-configuration'
import {
  buildDistantBirdFlightPlan,
  createDistantBirdGeometry,
  DISTANT_BIRD_COUNT,
  DISTANT_BIRD_TRIANGLES,
  evaluateDistantBirdFlight,
} from './distant-birds'
import { visitNaturalGrassCandidates } from './natural-grass'
import { deriveNaturalVegetationPlan } from './natural-vegetation'
import { buildPortableNaturalGrass, buildStaticSurroundings } from './static-export'

const BOUNDARY = [
  [0, 0],
  [20, 0],
  [20, 20],
  [0, 20],
] as const
const SEED = 'acceptance-frozen-birds'

function float32CoordinateRoundingBound(value: number): number {
  // Round-to-nearest error is half an ULP: binary32 has 23 stored fraction
  // bits. The subnormal spacing is fixed at 2^-149, including at zero.
  if (value === 0) return 2 ** -150
  return Math.max(2 ** -150, 2 ** (Math.floor(Math.log2(Math.abs(value))) - 24))
}

function tangentRoundoffBound(first: Vector3, second: Vector3, normal: Vector3): number {
  let bound = 0
  for (const axis of ['x', 'y', 'z'] as const) {
    const weight = Math.abs(normal[axis])
    bound += weight * (
      float32CoordinateRoundingBound(first[axis]) +
      float32CoordinateRoundingBound(second[axis]) +
      8 * Number.EPSILON * (Math.abs(first[axis]) + Math.abs(second[axis]))
    )
  }
  return bound
}

test('portable natural grass keeps flat geometry identical with an explicit up sampler', () => {
  const heightAt = () => 3
  const plan = deriveNaturalVegetationPlan({
    boundary: BOUNDARY,
    seed: SEED,
    presetId: 'open-meadow',
    heightAt,
  })
  const legacy = buildPortableNaturalGrass(plan, BOUNDARY, heightAt, () => null)
  const flat = buildPortableNaturalGrass(plan, BOUNDARY, heightAt, () => null, () => [0, 1, 0])
  expect(flat.userData).toEqual(legacy.userData)
  const legacyMesh = legacy.children[0]
  const flatMesh = flat.children[0]
  if (!(legacyMesh instanceof Mesh) || !(flatMesh instanceof Mesh)) {
    throw new Error('Expected nonempty flat natural grass')
  }
  for (const attribute of ['position', 'normal', 'color']) {
    expect(flatMesh.geometry.getAttribute(attribute).array)
      .toEqual(legacyMesh.geometry.getAttribute(attribute).array)
  }
  expect(flatMesh.geometry.getIndex()?.array).toEqual(legacyMesh.geometry.getIndex()?.array)
})

test('portable natural grass shares slope acceptance and lays its roots in the sampled tangent plane', () => {
  const normal = [0, Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)] as const
  const heightAt = (_x: number, z: number) => 2 - z * Math.tan(Math.PI / 6)
  const context = {
    boundary: BOUNDARY,
    seed: SEED,
    presetId: 'open-meadow' as const,
    heightAt,
    normalAt: () => normal,
    waterLevelAt: () => null,
  }
  const plan = deriveNaturalVegetationPlan(context)
  const patches = plan.tiles.flatMap((tile) => tile.lowVegetation)
  let visible = 0
  visitNaturalGrassCandidates({ ...context, patches }, (_x, _y, _z, _yaw, _width, _height, density) => {
    if (density <= 0.92) visible += 1
  })
  const root = buildPortableNaturalGrass(plan, BOUNDARY, heightAt, context.waterLevelAt, context.normalAt)
  expect(visible).toBeGreaterThan(0)
  expect(root.userData.bladeCount).toBe(visible)
  const mesh = root.children[0]
  if (!(mesh instanceof Mesh)) throw new Error('Missing portable grass mesh')
  const positions = mesh.geometry.getAttribute('position')
  // Each crossed blade starts with two root vertices. Their difference must
  // lie in the terrain tangent plane, rather than remain world-horizontal.
  for (let blade = 0; blade < visible; blade += 1) {
    for (const start of [0, 7]) {
      const first = new Vector3().fromBufferAttribute(positions, blade * 14 + start)
      const second = new Vector3().fromBufferAttribute(positions, blade * 14 + start + 1)
      const terrainNormal = new Vector3(...normal)
      const roundoffBound = tangentRoundoffBound(first, second, terrainNormal)
      expect(Math.abs(second.sub(first).dot(terrainNormal))).toBeLessThanOrEqual(roundoffBound)
    }
  }
  const steep = buildPortableNaturalGrass(plan, BOUNDARY, heightAt, context.waterLevelAt, () => [0, 0, 1])
  expect(steep.userData.bladeCount).toBe(0)
  expect(steep.children).toHaveLength(0)
})

test('portable sloped grass bends along the projected runtime yaw seed', () => {
  const normal = new Vector3(0, Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)).normalize()
  const context = {
    boundary: BOUNDARY,
    seed: SEED,
    presetId: 'open-meadow' as const,
    heightAt: () => 3,
    normalAt: () => [normal.x, normal.y, normal.z] as const,
    waterLevelAt: () => null,
  }
  const plan = deriveNaturalVegetationPlan(context)
  const candidates: { root: Vector3; yaw: number; width: number; height: number }[] = []
  visitNaturalGrassCandidates({
    ...context,
    patches: plan.tiles.flatMap((tile) => tile.lowVegetation),
  }, (x, y, z, yaw, width, height, density) => {
    if (density <= 0.92 && candidates.length === 0) {
      candidates.push({ root: new Vector3(x, y, z), yaw, width: 0.042 * width, height: 0.3 * height })
    }
  })
  const candidate = candidates[0]
  if (!candidate) throw new Error('Missing visible sloped grass candidate')
  const rest = new Vector3(
    Math.sin(candidate.yaw) * candidate.width + 1e-6,
    0,
    Math.cos(candidate.yaw) * candidate.width,
  )
  rest.addScaledVector(normal, -rest.dot(normal)).normalize()
  const expected = candidate.root.clone()
    .addScaledVector(normal, candidate.height * Math.sin(0.22) / 0.22)
    .addScaledVector(rest, candidate.height * (1 - Math.cos(0.22)) / 0.22)
  const root = buildPortableNaturalGrass(
    plan, BOUNDARY, context.heightAt, context.waterLevelAt, context.normalAt,
  )
  const mesh = root.children[0]
  if (!(mesh instanceof Mesh)) throw new Error('Missing portable sloped grass')
  const tip = new Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), 6)
  for (const axis of ['x', 'y', 'z'] as const) {
    const bound = float32CoordinateRoundingBound(tip[axis]) +
      8 * Number.EPSILON * (Math.abs(expected[axis]) + candidate.height)
    expect(Math.abs(tip[axis] - expected[axis])).toBeLessThanOrEqual(bound)
  }
})

describe('static surroundings distant birds', () => {
  test('defines a deterministic finite phase-zero flock oracle', () => {
    const plan = buildDistantBirdFlightPlan({ boundary: BOUNDARY, heightAt: () => 0, seed: SEED })
    const repeated = buildDistantBirdFlightPlan({
      boundary: BOUNDARY,
      heightAt: () => 0,
      seed: SEED,
    })
    const template = createDistantBirdGeometry()
    const raised = template.morphAttributes.position?.[0]
    if (!raised) throw new Error('Baseline distant bird geometry has no wing morph')

    expect(plan).toEqual(repeated)
    expect(plan.birds).toHaveLength(DISTANT_BIRD_COUNT)
    expect(template.getAttribute('position').count / 3).toBe(DISTANT_BIRD_TRIANGLES)
    expect(
      Array.from({ length: raised.count }, (_, index) => raised.getY(index)).some(Boolean),
    ).toBe(true)
    for (const bird of plan.birds) {
      const pose = evaluateDistantBirdFlight(bird, 0)
      expect(pose.position.every(Number.isFinite)).toBe(true)
      expect(pose.rotation.every(Number.isFinite)).toBe(true)
      expect(Number.isFinite(pose.wingLift)).toBe(true)
      expect(pose.scale).toBeGreaterThan(0)
    }
    template.dispose()
  })

  test('does not emit birds without distant Site context', async () => {
    const configuration = {
      ...exportEnvironmentConfiguration(),
      preset: 'open-meadow' as const,
      seed: SEED,
      visibility: {
        ...exportEnvironmentConfiguration().visibility,
        surroundings: true,
      },
    }
    for (const birdsEnabled of [false, true]) {
      const root = await buildStaticSurroundings(
        {
          nodes: {},
          configuration: null,
          onlyVisible: true,
          excludedNodeTypes: [],
        },
        configuration,
        birdsEnabled,
      )
      expect(root?.getObjectByName('environment-static-distant-birds')).toBeUndefined()
    }
  })
})
