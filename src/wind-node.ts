import * as TSL from 'three/tsl'

export const GLOBAL_WIND_STRENGTH = TSL.uniform(1)

export function setGlobalWindStrength(strength: number): void {
  GLOBAL_WIND_STRENGTH.value = Math.max(0, strength)
}

export const PLANT_WIND_FREQUENCY = 1.3
export const PLANT_WIND_STRENGTH = 0.05
