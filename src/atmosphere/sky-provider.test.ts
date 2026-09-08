import { describe, expect, test } from 'bun:test'
import { DEFAULT_SKY_SETTINGS, type SkySettings } from './settings'
import { createSkyProvider, type SkyProvider } from './sky-provider'
import {
  createEffectiveSkyWeather,
  updateEffectiveSkyWeather,
  weatherRequiresSky,
} from './weather-sky'

function luminance(values: readonly number[]): number {
  const red = values[0] ?? 0
  const green = values[1] ?? 0
  const blue = values[2] ?? 0
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}

function lightingSnapshot(provider: SkyProvider) {
  return {
    sunDirection: provider.sunDirection.toArray(),
    sunColor: provider.sunColor.toArray(),
    sunIntensity: provider.sunIntensity,
    moonDirection: provider.moonDirection.toArray(),
    moonColor: provider.moonColor.toArray(),
    moonIntensity: provider.moonIntensity,
    skyColor: provider.skyColor.toArray(),
    groundColor: provider.groundColor.toArray(),
    hemisphereIntensity: provider.hemisphereIntensity,
    ambientIntensity: provider.ambientIntensity,
    exposure: provider.exposure,
    fogStart: provider.fogStart,
    fogEnd: provider.fogEnd,
    cloudCoverage: provider.cloudCoverage,
    cloudOpticalDensity: provider.cloudOpticalDensity,
    cloudColor: provider.cloudColor.toArray(),
  }
}

describe('weather-derived sky', () => {
  test('rain increases cloud coverage and optical density monotonically without mutating the base sky', () => {
    const base = Object.freeze({ ...DEFAULT_SKY_SETTINGS, cloudCoverage: 0.27 })
    const output = createEffectiveSkyWeather()
    const clear = { ...updateEffectiveSkyWeather(base, { rain: 0 }, output) }
    const medium = { ...updateEffectiveSkyWeather(base, { rain: 0.5 }, output) }
    const heavy = { ...updateEffectiveSkyWeather(base, { rain: 1 }, output) }

    expect(clear.cloudCoverage).toBe(base.cloudCoverage)
    expect(clear.cloudOpticalDensity).toBe(1)
    expect(medium.cloudCoverage).toBeGreaterThan(clear.cloudCoverage)
    expect(heavy.cloudCoverage).toBeGreaterThan(medium.cloudCoverage)
    expect(medium.cloudOpticalDensity).toBeGreaterThan(clear.cloudOpticalDensity)
    expect(heavy.cloudOpticalDensity).toBeGreaterThan(medium.cloudOpticalDensity)
    expect(heavy.sunlightScale).toBeLessThan(medium.sunlightScale)

    expect(base).toEqual({ ...DEFAULT_SKY_SETTINGS, cloudCoverage: 0.27 })
  })

  test('requires transient sky ownership for rain, snow, or storm and releases it when clear', () => {
    expect(weatherRequiresSky({ rain: 0, snow: 0, storm: false })).toBe(false)
    expect(weatherRequiresSky({ rain: 0.01 })).toBe(true)
    expect(weatherRequiresSky({ snow: 0.01 })).toBe(true)
    expect(weatherRequiresSky({ storm: true })).toBe(true)
  })

  for (const model of ['procedural', 'gradient'] as const) {
    test(`${model} provider darkens for storms, cools for snow, flashes, and restores clear exactly`, () => {
      const base: SkySettings = {
        ...DEFAULT_SKY_SETTINGS,
        provider: model,
        sunMode: 'manual',
        sunElevation: 38,
        sunAzimuth: 127,
        cloudCoverage: 0.31,
      }
      const provider = createSkyProvider(base)
      const clear = lightingSnapshot(provider)

      provider.update(base, 0, { rain: 0.5 })
      const mediumRain = lightingSnapshot(provider)
      provider.update(base, 0, { rain: 1 })
      const heavyRain = lightingSnapshot(provider)
      expect(mediumRain.cloudCoverage).toBeGreaterThan(clear.cloudCoverage)
      expect(heavyRain.cloudCoverage).toBeGreaterThan(mediumRain.cloudCoverage)
      expect(heavyRain.cloudOpticalDensity).toBeGreaterThan(mediumRain.cloudOpticalDensity)
      expect(heavyRain.sunIntensity).toBeLessThan(mediumRain.sunIntensity)
      expect(luminance(heavyRain.cloudColor)).toBeLessThan(luminance(mediumRain.cloudColor))

      provider.update(base, 0, { rain: 0.7, storm: true })
      const storm = lightingSnapshot(provider)
      expect(storm.cloudCoverage).toBeGreaterThan(clear.cloudCoverage)
      expect(storm.cloudOpticalDensity).toBeGreaterThan(1)
      expect(storm.sunIntensity).toBeLessThan(clear.sunIntensity)
      expect(luminance(storm.skyColor)).toBeLessThan(luminance(clear.skyColor))
      expect(storm.fogEnd).toBeLessThan(clear.fogEnd)
      expect(storm.sunDirection).toEqual(clear.sunDirection)

      provider.update(base, 0, { snow: 1 })
      const snow = lightingSnapshot(provider)
      expect(snow.cloudCoverage).toBeGreaterThan(clear.cloudCoverage)
      expect(snow.sunColor[2]! - snow.sunColor[0]!).toBeGreaterThan(
        clear.sunColor[2]! - clear.sunColor[0]!,
      )
      expect(snow.groundColor[2]! - snow.groundColor[0]!).toBeGreaterThan(
        clear.groundColor[2]! - clear.groundColor[0]!,
      )

      provider.update(base, 0, { rain: 0.7, storm: true, flash: 1 })
      const flash = lightingSnapshot(provider)
      expect(flash.ambientIntensity).toBeGreaterThan(storm.ambientIntensity)
      expect(luminance(flash.cloudColor)).toBeGreaterThan(luminance(storm.cloudColor))

      provider.update(base, 0, { rain: 0, snow: 0, storm: false, flash: 0 })
      expect(lightingSnapshot(provider)).toEqual(clear)
    })
  }
})
