export type SkyDebug =
  | 'none'
  | 'direction'
  | 'rayleigh'
  | 'mie'
  | 'haze'
  | 'sun'
  | 'clouds'
  | 'luminance'
export type SkySettings = {
  provider: 'procedural' | 'gradient'
  sunMode: 'time' | 'manual'
  timeOfDay: number
  northOffset: number
  sunElevation: number
  sunAzimuth: number
  rayleigh: number
  mie: number
  mieG: number
  turbidity: number
  sunRadius: number
  sunRadiance: number
  cloudCoverage: number
  cloudSoftness: number
  cloudScale: number
  cloudSpeed: number
  moonPhase: number
  exposureCompensation: number
  fogStart: number
  fogEnd: number
  debug: SkyDebug
}

export const DEFAULT_SKY_SETTINGS: Readonly<SkySettings> = {
  provider: 'procedural',
  sunMode: 'time',
  timeOfDay: 14,
  northOffset: 0,
  sunElevation: 40,
  sunAzimuth: 225,
  rayleigh: 1,
  mie: 0.005,
  mieG: 0.76,
  turbidity: 2,
  sunRadius: 0.01,
  sunRadiance: 40,
  cloudCoverage: 0.45,
  cloudSoftness: 0.16,
  cloudScale: 1,
  cloudSpeed: 0.008,
  moonPhase: 1,
  exposureCompensation: 0,
  fogStart: 180,
  fogEnd: 1200,
  debug: 'none',
}

export const SKY_PRESETS = [
  {
    id: 'clear',
    label: 'Clear day',
    settings: { timeOfDay: 14, cloudCoverage: 0.28, turbidity: 2 },
  },
  { id: 'cloudy', label: 'Cloudy', settings: { timeOfDay: 12, cloudCoverage: 0.85, turbidity: 5 } },
  {
    id: 'golden',
    label: 'Golden hour',
    settings: { timeOfDay: 17.5, cloudCoverage: 0.35, turbidity: 3.5 },
  },
  {
    id: 'dusk',
    label: 'Blue hour',
    settings: { timeOfDay: 18.65, cloudCoverage: 0.25, turbidity: 2.5 },
  },
  { id: 'night', label: 'Moonlit', settings: { timeOfDay: 0, cloudCoverage: 0.2, turbidity: 1.5 } },
] as const satisfies readonly { id: string; label: string; settings: Partial<SkySettings> }[]

const BOUNDS: Partial<Record<keyof SkySettings, readonly [number, number]>> = {
  sunElevation: [-90, 90],
  rayleigh: [0, 2],
  mie: [0, 0.02],
  mieG: [0, 0.9],
  turbidity: [1, 10],
  sunRadius: [0.00465, 0.03],
  sunRadiance: [1, 100],
  cloudCoverage: [0, 1],
  cloudSoftness: [0.02, 0.4],
  cloudScale: [0.25, 4],
  cloudSpeed: [0, 0.04],
  moonPhase: [0, 1],
  exposureCompensation: [-3, 3],
  fogStart: [0, 2000],
  fogEnd: [20, 5000],
}

export function patchSkySettings(settings: SkySettings, patch: Partial<SkySettings>): SkySettings {
  const next = { ...settings, ...patch }
  for (const key of Object.keys(patch) as (keyof SkySettings)[]) {
    const value = next[key]
    if (typeof value !== 'number') continue
    const finite = Number.isFinite(value) ? value : (settings[key] as number)
    const bounds = BOUNDS[key]
    Object.assign(next, {
      [key]: bounds ? Math.max(bounds[0], Math.min(bounds[1], finite)) : finite,
    })
  }
  next.timeOfDay = wrap(next.timeOfDay, 24)
  next.northOffset = wrap(next.northOffset, 360)
  next.sunAzimuth = wrap(next.sunAzimuth, 360)
  next.fogEnd = Math.max(next.fogStart + 20, next.fogEnd)
  return next
}

export function wrap(value: number, period: number): number {
  return ((value % period) + period) % period
}

export function smoothBand(low: number, high: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}

export function skyPeriod(elevation: number): string {
  if (elevation > 0) return 'Daylight'
  if (elevation > -6) return 'Civil twilight'
  if (elevation > -12) return 'Nautical twilight'
  if (elevation > -18) return 'Astronomical twilight'
  return 'Night'
}

export function formatSkyTime(hours: number): string {
  const minutes = Math.round(wrap(hours, 24) * 60) % 1440
  return `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`
}
