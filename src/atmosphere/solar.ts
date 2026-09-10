import { Vector3 } from 'three/webgpu'
import { smoothBand } from './settings'
import type { SkySettings } from './settings'

export type SolarState = {
  sunDirection: Vector3
  moonDirection: Vector3
  elevation: number
  daylight: number
  twilight: number
  night: number
  sunVisibility: number
  moonVisibility: number
  exposure: number
}

export function createSolarState(): SolarState {
  return {
    sunDirection: new Vector3(),
    moonDirection: new Vector3(),
    elevation: 0,
    daylight: 0,
    twilight: 0,
    night: 0,
    sunVisibility: 0,
    moonVisibility: 0,
    exposure: 1,
  }
}

/** Artistic equinox orbit at 30° north, not a geolocated solar study. North is world -Z. */
export function updateSolarState(settings: SkySettings, state: SolarState): void {
  const radians = Math.PI / 180
  if (settings.sunMode === 'manual') {
    const elevation = settings.sunElevation * radians
    const azimuth = settings.sunAzimuth * radians
    state.sunDirection.set(
      Math.sin(azimuth) * Math.cos(elevation),
      Math.sin(elevation),
      -Math.cos(azimuth) * Math.cos(elevation),
    )
  } else {
    const angle = ((settings.timeOfDay - 12) * Math.PI) / 12
    const x = -Math.sin(angle)
    const z = Math.cos(angle) * 0.5
    const rotation = settings.northOffset * radians
    state.sunDirection.set(
      x * Math.cos(rotation) - z * Math.sin(rotation),
      Math.cos(angle) * Math.sqrt(0.75),
      z * Math.cos(rotation) + x * Math.sin(rotation),
    )
  }
  state.moonDirection.copy(state.sunDirection).negate()
  state.elevation = Math.asin(Math.max(-1, Math.min(1, state.sunDirection.y))) / radians
  state.daylight = smoothBand(-12, 6, state.elevation)
  state.twilight = Math.exp(-(((state.elevation + 2) / 8) ** 2))
  state.night = 1 - smoothBand(-18, -6, state.elevation)
  state.sunVisibility = smoothBand(-0.833, 1.5, state.elevation)
  state.moonVisibility = state.night * smoothBand(-0.833, 3, -state.elevation)
  state.exposure = (0.95 + state.night * 0.4) * 2 ** settings.exposureCompensation
}
