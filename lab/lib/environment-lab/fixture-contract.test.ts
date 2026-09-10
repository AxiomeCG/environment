import { expect, test } from 'bun:test'
import { createEnvironmentLabFixture } from '@pascal-app/plugin-environment/lab'
import { getEnvironmentLabCase } from '@pascal-app/plugin-environment/lab/catalog'

const FIXED_CASE_IDS = [
  'surface-materials',
  'ground-cover-brushes',
  'grass-obstacles',
  'pond-basins',
  'pond-life',
  'river-authoring',
  'river-endpoints',
  'regional-surroundings',
  'natural-presets',
  'night-landmarks',
  'sky-and-sun',
  'weather',
  'portability',
  'living-landscape',
] as const

test('creates detached canonical fixtures for every fixed case', () => {
  for (const caseId of FIXED_CASE_IDS) {
    const catalogCase = getEnvironmentLabCase(caseId)
    expect(catalogCase).toBeDefined()

    const variantId = catalogCase?.variants[0]?.id
    expect(variantId).toBeDefined()

    const first = createEnvironmentLabFixture(caseId, variantId)
    const second = createEnvironmentLabFixture(caseId, variantId)
    const canonical = structuredClone(second)
    const rootId = first.scene.rootNodeIds[0]
    if (!rootId) {
      throw new Error(`${caseId} fixture has no root node`)
    }
    const root = first.scene.nodes[rootId]
    if (!root) {
      throw new Error(`${caseId} fixture is missing root node ${rootId}`)
    }
    const mutatedName = `acceptance-mutated-${caseId}`
    const mutatedRain = first.configuration.weather.rain === 0 ? 0.25 : 0
    const mutatedCameraX = first.camera.position[0] + 137
    const frontage = Object.values(first.configuration.frontages)[0]
    const mutatedSeparator = frontage?.separator === 'none' ? 'secondary-road' : 'none'

    expect(Reflect.set(root, 'name', mutatedName)).toBe(true)
    expect(Reflect.set(first.configuration.weather, 'rain', mutatedRain)).toBe(true)
    first.camera.position[0] = mutatedCameraX
    if (frontage) {
      expect(Reflect.set(frontage, 'separator', mutatedSeparator)).toBe(true)
    }

    expect(Reflect.get(root, 'name')).toBe(mutatedName)
    expect(first.configuration.weather.rain).toBe(mutatedRain)
    expect(first.camera.position[0]).toBe(mutatedCameraX)
    if (frontage) {
      expect(frontage.separator).toBe(mutatedSeparator)
    }

    const third = createEnvironmentLabFixture(caseId, variantId)
    expect(second).toEqual(canonical)
    expect(third).toEqual(canonical)
  }
}, 30_000)

test('rejects invalid fixture identifiers without a fallback', () => {
  expect(() => createEnvironmentLabFixture('__acceptance-invalid-case__')).toThrow()

  expect(() =>
    createEnvironmentLabFixture(FIXED_CASE_IDS[0], '__acceptance-invalid-variant__'),
  ).toThrow()
})
