import type { SkySettings } from './settings'

export type SkyWeatherInput = Readonly<{
  rain?: number
  snow?: number
  storm?: boolean
  flash?: number
}>

export type EffectiveSkyWeather = {
  rain: number
  snow: number
  storm: number
  flash: number
  cloudCoverage: number
  cloudOpticalDensity: number
  overcast: number
  cooling: number
  sunlightScale: number
  hemisphereScale: number
  ambientScale: number
  fogDistanceScale: number
}

export function createEffectiveSkyWeather(): EffectiveSkyWeather {
  return {
    rain: 0,
    snow: 0,
    storm: 0,
    flash: 0,
    cloudCoverage: 0,
    cloudOpticalDensity: 1,
    overcast: 0,
    cooling: 0,
    sunlightScale: 1,
    hemisphereScale: 1,
    ambientScale: 1,
    fogDistanceScale: 1,
  }
}

function saturate(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value ?? 0)) : 0
}

/** Derives transient weather without mutating or replacing the authored sky settings. */
export function updateEffectiveSkyWeather(
  base: Readonly<SkySettings>,
  weather: SkyWeatherInput | undefined,
  output: EffectiveSkyWeather,
): EffectiveSkyWeather {
  const rain = saturate(weather?.rain)
  const snow = saturate(weather?.snow)
  const storm = weather?.storm === true ? 1 : 0
  const flash = saturate(weather?.flash)
  const baseCoverage = saturate(base.cloudCoverage)
  const rainCloud = rain * 0.82
  const snowCloud = snow * 0.62
  const stormCloud = storm * (0.88 + rain * 0.12)
  const cloudDrive = 1 - (1 - rainCloud) * (1 - snowCloud) * (1 - stormCloud)

  output.rain = rain
  output.snow = snow
  output.storm = storm
  output.flash = flash
  output.cloudCoverage = baseCoverage + (1 - baseCoverage) * cloudDrive
  output.cloudOpticalDensity = 1 + rain * 1.5 + snow * 0.65 + storm * (1.15 + rain * 0.35)
  output.overcast = Math.min(1, rain * 0.62 + snow * 0.36 + storm * 0.58)
  output.cooling = Math.min(1, rain * 0.42 + snow * 0.72 + storm * 0.55)
  output.sunlightScale = Math.max(0.08, 1 - rain * 0.38 - snow * 0.2 - storm * 0.48)
  output.hemisphereScale = Math.max(0.28, 1 - rain * 0.25 - snow * 0.12 - storm * 0.3)
  output.ambientScale = Math.max(0.34, 1 - rain * 0.2 - snow * 0.08 - storm * 0.28)
  output.fogDistanceScale = Math.max(0.2, 1 - rain * 0.4 - snow * 0.2 - storm * 0.32)
  return output
}

export function weatherRequiresSky(weather: SkyWeatherInput): boolean {
  return saturate(weather.rain) > 0 || saturate(weather.snow) > 0 || weather.storm === true
}
