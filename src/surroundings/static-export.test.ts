import { describe, expect, test } from 'bun:test'
import { exportEnvironmentConfiguration } from '../presentation'
import {
  buildDistantBirdFlightPlan,
  createDistantBirdGeometry,
  DISTANT_BIRD_COUNT,
  DISTANT_BIRD_TRIANGLES,
  evaluateDistantBirdFlight,
} from './distant-birds'
import { buildStaticSurroundings } from './static-export'

const BOUNDARY = [
  [0, 0],
  [20, 0],
  [20, 20],
  [0, 20],
] as const
const SEED = 'acceptance-frozen-birds'

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
