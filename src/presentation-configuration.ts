import type { ViewerPresentationConfiguration } from '@pascal-app/viewer'
import { z } from 'zod'
import type { SkySettings } from './atmosphere/settings'
import { useEnvironmentStore } from './store'
import type { EnvironmentStore } from './store'
import type { FrontageContexts } from './surroundings/frontages'
import type { SurroundingsPresetId } from './surroundings/presets'

export const ENVIRONMENT_CONFIGURATION_VERSION = 2 as const

export type EnvironmentConfigurationV2 = Readonly<{
  version: typeof ENVIRONMENT_CONFIGURATION_VERSION
  preset: SurroundingsPresetId
  seed: string
  frontages: FrontageContexts
  sky: SkySettings
  visibility: Readonly<{
    surroundings: boolean
    sky: boolean
  }>
  weather: Readonly<{
    rain: number
    snow: number
    wind: number
    storm: boolean
  }>
}>

export type EnvironmentConfiguration = EnvironmentConfigurationV2

const frontageKey = /^(0|[1-9]\d*)$/
const frontagesSchema = z
  .record(
    z.string(),
    z
      .object({
        separator: z.enum(['none', 'secondary-road', 'primary-road']),
        access: z.enum(['none', 'driveway', 'pedestrian-path']),
        roadStyleId: z.string().optional(),
      })
      .strict(),
  )
  .superRefine((frontages, context) => {
    for (const key of Object.keys(frontages)) {
      if (!frontageKey.test(key)) {
        context.addIssue({
          code: 'custom',
          message: 'frontage keys must be non-negative integer segment indexes',
          path: [key],
        })
      }
    }
  })

const skySettingsShape = {
  provider: z.enum(['procedural', 'gradient']),
  sunMode: z.enum(['time', 'manual']),
  timeOfDay: z.number().finite().min(0).lt(24),
  northOffset: z.number().finite().min(0).lt(360),
  sunElevation: z.number().finite().min(-90).max(90),
  sunAzimuth: z.number().finite().min(0).lt(360),
  rayleigh: z.number().finite().min(0).max(2),
  mie: z.number().finite().min(0).max(0.02),
  mieG: z.number().finite().min(0).max(0.9),
  turbidity: z.number().finite().min(1).max(10),
  sunRadius: z.number().finite().min(0.00465).max(0.03),
  sunRadiance: z.number().finite().min(1).max(100),
  cloudCoverage: z.number().finite().min(0).max(1),
  cloudSoftness: z.number().finite().min(0.02).max(0.4),
  cloudScale: z.number().finite().min(0.25).max(4),
  cloudSpeed: z.number().finite().min(0).max(0.04),
  moonPhase: z.number().finite().min(0).max(1),
  exposureCompensation: z.number().finite().min(-3).max(3),
  fogStart: z.number().finite().min(0).max(2000),
  fogEnd: z.number().finite().min(20).max(5000),
  debug: z.enum(['none', 'direction', 'rayleigh', 'mie', 'haze', 'sun', 'clouds', 'luminance']),
}

function validateFogRange(
  settings: { fogStart: number; fogEnd: number },
  context: z.RefinementCtx,
): void {
  if (settings.fogEnd < settings.fogStart + 20) {
    context.addIssue({
      code: 'custom',
      message: 'fogEnd must be at least 20 greater than fogStart',
      path: ['fogEnd'],
    })
  }
}

const skySettingsSchema = z.object(skySettingsShape).strict().superRefine(validateFogRange)
const legacySkySettingsSchema = z
  .object({
    ...skySettingsShape,
    godRays: z.number().finite().min(0).max(1),
  })
  .strict()
  .superRefine(validateFogRange)
const visibilitySchema = z
  .object({
    surroundings: z.boolean(),
    sky: z.boolean(),
  })
  .strict()
const weatherSchema = z
  .object({
    rain: z.number().finite().min(0).max(1),
    snow: z.number().finite().min(0).max(1),
    wind: z.number().finite().min(0).max(1),
    storm: z.boolean(),
  })
  .strict()
const configurationShape = {
  preset: z.enum(['regional', 'open-meadow', 'woodland-edge']),
  seed: z.string().trim().min(1),
  frontages: frontagesSchema,
  visibility: visibilitySchema,
  weather: weatherSchema,
}

const EnvironmentConfigurationV1Schema = z
  .object({
    ...configurationShape,
    version: z.literal(1),
    sky: legacySkySettingsSchema,
  })
  .strict()

export const EnvironmentConfigurationSchema = z
  .object({
    ...configurationShape,
    version: z.literal(ENVIRONMENT_CONFIGURATION_VERSION),
    sky: skySettingsSchema,
  })
  .strict()

const persistedConfigurationSchema = z.discriminatedUnion('version', [
  EnvironmentConfigurationV1Schema,
  EnvironmentConfigurationSchema,
])

function snapshotEnvironmentConfiguration(state: EnvironmentStore): EnvironmentConfiguration {
  return {
    version: ENVIRONMENT_CONFIGURATION_VERSION,
    preset: state.surroundingsPreset,
    seed: state.surroundingsSeed,
    frontages: Object.fromEntries(
      Object.entries(state.frontageContexts).flatMap(([index, context]) =>
        context ? [[index, { ...context }]] : [],
      ),
    ),
    sky: { ...state.skySettings },
    visibility: {
      surroundings: state.surroundingsEnabled,
      sky: state.skyEnabled,
    },
    weather: {
      rain: state.weatherSettings.rain,
      snow: state.weatherSettings.snow,
      wind: state.weatherSettings.wind,
      storm: state.weatherSettings.storm,
    },
  }
}

/** Returns a detached, versioned snapshot for a host-owned project sidecar. */
export function exportEnvironmentConfiguration(): EnvironmentConfiguration {
  return snapshotEnvironmentConfiguration(useEnvironmentStore.getState())
}

/**
 * Validates and applies a host-supplied sidecar through Environment store actions.
 * Session-only playback and motion return to their defaults; audio consent is never imported.
 */
export function importEnvironmentConfiguration(input: unknown): EnvironmentConfiguration {
  const parsed = persistedConfigurationSchema.parse(input)
  let configuration: EnvironmentConfiguration
  if (parsed.version === 1) {
    const { godRays: _godRays, ...sky } = parsed.sky
    configuration = { ...parsed, version: ENVIRONMENT_CONFIGURATION_VERSION, sky }
  } else {
    configuration = parsed
  }
  const environment = useEnvironmentStore.getState()
  environment.setSurroundingsPreset(configuration.preset)
  environment.setSurroundingsSeed(configuration.seed)
  environment.setFrontageContexts(configuration.frontages)
  environment.setSkySettings(configuration.sky)
  environment.setSurroundingsEnabled(configuration.visibility.surroundings)
  environment.setSkyEnabled(configuration.visibility.sky)
  environment.setWeatherSettings({ ...configuration.weather, thunderAudio: false })
  environment.setSkyPlaying(false)
  environment.setSkyMotion(useEnvironmentStore.getInitialState().skyMotion)
  return configuration
}

function resetEnvironmentConfiguration(): void {
  importEnvironmentConfiguration(
    snapshotEnvironmentConfiguration(useEnvironmentStore.getInitialState()),
  )
}

function subscribeEnvironmentConfiguration(onChange: () => void): () => void {
  return useEnvironmentStore.subscribe((state, previous) => {
    const weather = state.weatherSettings
    const previousWeather = previous.weatherSettings
    if (
      state.surroundingsPreset !== previous.surroundingsPreset ||
      state.surroundingsSeed !== previous.surroundingsSeed ||
      state.frontageContexts !== previous.frontageContexts ||
      state.skySettings !== previous.skySettings ||
      state.surroundingsEnabled !== previous.surroundingsEnabled ||
      state.skyEnabled !== previous.skyEnabled ||
      weather.rain !== previousWeather.rain ||
      weather.snow !== previousWeather.snow ||
      weather.wind !== previousWeather.wind ||
      weather.storm !== previousWeather.storm
    ) {
      onChange()
    }
  })
}

export const environmentPresentationConfiguration = {
  getSnapshot: exportEnvironmentConfiguration,
  restore: importEnvironmentConfiguration,
  reset: resetEnvironmentConfiguration,
  subscribe: subscribeEnvironmentConfiguration,
} satisfies ViewerPresentationConfiguration
