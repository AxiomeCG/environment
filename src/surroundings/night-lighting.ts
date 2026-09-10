import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { uniform } from 'three/tsl'
import type { SkySettings } from '../atmosphere/settings'
import { createSolarState, updateSolarState } from '../atmosphere/solar'
import { useEnvironmentStore } from '../store'
import { seededUnit } from './seeded-random'

const NIGHT_SEED = 'surroundings-night-lighting'
const HOUSEHOLD_OFF_FRACTION = 0.24
const WINDOW_LIT_FRACTION = 0.58
const solarState = createSolarState()

/** Matches the atmosphere's astronomical-to-civil night transition. */
export function nightFactor(settings: SkySettings, skyEnabled: boolean): number {
  if (!skyEnabled) return 0
  updateSolarState(settings, solarState)
  return solarState.night
}

const initialEnvironment = useEnvironmentStore.getState()

/** One shader uniform shared by every surroundings night material. */
export const SURROUNDINGS_NIGHT_FACTOR = uniform(
  nightFactor(initialEnvironment.skySettings, initialEnvironment.skyEnabled),
)

/** Direct runtime control for scene hosts; updates one uniform, never materials. */
export function setSurroundingsNightFactor(value: number): void {
  SURROUNDINGS_NIGHT_FACTOR.value = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

/** Stable household and opening choices; an off household never emits. */
export function windowSurface(
  buildingId: string,
  windowKey: string,
): 'window-lit' | 'paint' {
  if (seededUnit(NIGHT_SEED, `${buildingId}:household`) < HOUSEHOLD_OFF_FRACTION) return 'paint'
  // Prefix the varying pane key so adjacent numbered windows decorrelate.
  return seededUnit(windowKey, `${NIGHT_SEED}:${buildingId}:window`) < WINDOW_LIT_FRACTION
    ? 'window-lit'
    : 'paint'
}

/** Publishes store changes to GPU uniforms without rebuilding neighborhood geometry. */
export function SurroundingsNightLighting(): null {
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    const publish = (settings: SkySettings, skyEnabled: boolean) => {
      const next = nightFactor(settings, skyEnabled)
      if (next === SURROUNDINGS_NIGHT_FACTOR.value) return
      setSurroundingsNightFactor(next)
      invalidate()
    }
    const state = useEnvironmentStore.getState()
    publish(state.skySettings, state.skyEnabled)
    return useEnvironmentStore.subscribe((next) => publish(next.skySettings, next.skyEnabled))
  }, [invalidate])

  return null
}
