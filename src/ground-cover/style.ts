import { z } from 'zod'

/** Shared inspector limits and creation defaults; persisted legacy nodes retain their schema. */
export const GROUND_COVER_STYLE = {
  density: { min: 0, max: 100, step: 1, unit: '%', default: 100 },
  flowerDensity: { min: 0, max: 100, step: 1, unit: '%', default: 0 },
  bladeHeight: { min: 0.05, max: 1, step: 0.01, unit: 'm', default: 0.3 },
  bladeRestBend: { min: 0, max: 1, step: 0.01, unit: 'rad', default: 0.22 },
  bladeWidth: { min: 0.005, max: 0.2, step: 0.005, unit: 'm', default: 0.035 },
  bladeTipBrightness: { min: 0, max: 500, step: 5, unit: '%', default: 130 },
  bladeHeightVariation: { min: 0, max: 100, step: 1, unit: '%', default: 20 },
  bladeWidthVariation: { min: 0, max: 100, step: 1, unit: '%', default: 20 },
  bladeTintVariation: { min: 0, max: 100, step: 1, unit: '%', default: 20 },
  windStrength: { min: 0, max: 200, step: 5, unit: '%', default: 100 },
  grassWindInfluence: { min: 0, max: 300, step: 5, unit: '%', default: 100 },
  obstacleBendRadius: { min: 0, max: 3, step: 0.05, unit: 'm', default: 0.75 },
  obstacleBendStrength: { min: 0, max: 0.5, step: 0.01, unit: 'm', default: 0.12 },
  obstacleFlattening: { min: 0, max: 100, step: 5, unit: '%', default: 60 },
} as const

export type GroundCoverStyleKey = keyof typeof GROUND_COVER_STYLE
export type GroundCoverStyle = Record<GroundCoverStyleKey, number>

export const groundCoverStyleKeys = Object.keys(GROUND_COVER_STYLE) as GroundCoverStyleKey[]

export const groundCoverStyleDefaults = Object.fromEntries(
  groundCoverStyleKeys.map((key) => [key, GROUND_COVER_STYLE[key].default]),
) as GroundCoverStyle

function styleInput(key: GroundCoverStyleKey) {
  const field = GROUND_COVER_STYLE[key]
  return z.number().finite().min(field.min).max(field.max).optional().describe(
    `${key} in ${field.unit}; inspector range ${field.min}-${field.max}, new-node default ${field.default}. Omitted: keep current value.`,
  )
}

const styleInputs = Object.fromEntries(
  groundCoverStyleKeys.map((key) => [key, styleInput(key)]),
) as Record<GroundCoverStyleKey, ReturnType<typeof styleInput>>

export const groundCoverStylePatch = z.object(styleInputs).strict()
