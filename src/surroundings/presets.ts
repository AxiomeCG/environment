export const SURROUNDINGS_PRESET_IDS = ['regional', 'open-meadow', 'woodland-edge'] as const

export type SurroundingsPresetId = (typeof SURROUNDINGS_PRESET_IDS)[number]
export type NaturalSurroundingsPresetId = Exclude<SurroundingsPresetId, 'regional'>

export type NaturalVegetationPolicy = Readonly<{
  lowCoverage: number
  flowerCoverage: number
  treeCoverage: number
  forestThreshold: number
  maximumDistance: number
}>

export type SurroundingsPresetPolicy = Readonly<{
  id: SurroundingsPresetId
  label: string
  description: string
  natural: boolean
  suppressBuiltContext: boolean
  regionalFeatures: 'seeded' | 'inland'
  reliefAmplitudeScale: number
  levelTerrainDistance: number | null
  horizonDistance: number | null
  vegetation: NaturalVegetationPolicy | null
}>

export const SURROUNDINGS_PRESET_POLICIES: Readonly<
  Record<SurroundingsPresetId, SurroundingsPresetPolicy>
> = Object.freeze({
  regional: Object.freeze({
    id: 'regional',
    label: 'Regional',
    description: 'Roads, homes and landscape generated from the current regional setting.',
    natural: false,
    suppressBuiltContext: false,
    regionalFeatures: 'seeded',
    reliefAmplitudeScale: 1,
    levelTerrainDistance: null,
    horizonDistance: null,
    vegetation: null,
  }),
  'open-meadow': Object.freeze({
    id: 'open-meadow',
    label: 'Open Meadow',
    description: 'A broad flowered meadow with occasional copses and a long open horizon.',
    natural: true,
    suppressBuiltContext: true,
    regionalFeatures: 'inland',
    reliefAmplitudeScale: 0.52,
    levelTerrainDistance: 58,
    horizonDistance: 320,
    vegetation: Object.freeze({
      lowCoverage: 0.9,
      flowerCoverage: 0.38,
      treeCoverage: 0.07,
      forestThreshold: 0.8,
      maximumDistance: 300,
    }),
  }),
  'woodland-edge': Object.freeze({
    id: 'woodland-edge',
    label: 'Woodland Edge',
    description: 'A dense, layered woodland with shaded understory and irregular clearings.',
    natural: true,
    suppressBuiltContext: true,
    regionalFeatures: 'inland',
    reliefAmplitudeScale: 0.88,
    levelTerrainDistance: 42,
    horizonDistance: 260,
    vegetation: Object.freeze({
      lowCoverage: 0.9,
      flowerCoverage: 0.12,
      treeCoverage: 0.92,
      forestThreshold: 0.4,
      maximumDistance: 260,
    }),
  }),
})

export function isNaturalSurroundingsPreset(
  presetId: SurroundingsPresetId,
): presetId is NaturalSurroundingsPresetId {
  return presetId !== 'regional'
}

export function getSurroundingsPresetPolicy(
  presetId: SurroundingsPresetId,
): SurroundingsPresetPolicy {
  return SURROUNDINGS_PRESET_POLICIES[presetId]
}
