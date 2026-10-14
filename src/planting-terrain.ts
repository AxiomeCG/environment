import { normalAt, surfaceHeightAt, type TerrainField } from '@pascal-app/core'

export type PlantingCategory = 'grass' | 'flower' | 'tree'
export type PlantingTerrainSample = Readonly<{
  heightM: number
  normal: readonly [number, number, number]
  slopeDeg: number
  /** South-facing component of the normal, not simulated sunlight or shade. */
  southExposure: number
}>

export const PLANTING_MAX_SLOPE_DEG: Readonly<Record<PlantingCategory, number>> = {
  grass: 70,
  flower: 55,
  tree: 40,
}
const FULL_DENSITY_SLOPE_DEG = 15

/** The only host height/normal sampling seam used by planting. Coordinates are site XZ. */
export function samplePlantingTerrain(
  terrain: TerrainField | null,
  x: number,
  z: number,
): PlantingTerrainSample {
  if (!terrain) return { heightM: 0, normal: [0, 1, 0], slopeDeg: 0, southExposure: 0 }
  return plantingTerrainSample(surfaceHeightAt(terrain, x, z), normalAt(terrain, x, z))
}

/** Adapts the existing surroundings sampler without extending or writing the lot's field. */
export function plantingTerrainSample(
  heightM: number,
  normal: readonly [number, number, number],
): PlantingTerrainSample {
  const length = Math.hypot(...normal)
  const unitNormal: readonly [number, number, number] = length > 0
    ? [normal[0] / length || 0, normal[1] / length || 0, normal[2] / length || 0]
    : [0, 1, 0]
  return {
    heightM,
    normal: unitNormal,
    slopeDeg: Math.acos(Math.max(0, Math.min(1, unitNormal[1]))) * 180 / Math.PI,
    southExposure: unitNormal[2],
  }
}

/** These are deterministic rendering limits, not botanical suitability claims. */
export function plantingDensityAt(
  terrain: PlantingTerrainSample,
  category: PlantingCategory,
): number {
  const end = PLANTING_MAX_SLOPE_DEG[category]
  const progress = Math.max(0, Math.min(1,
    (terrain.slopeDeg - FULL_DENSITY_SLOPE_DEG) / (end - FULL_DENSITY_SLOPE_DEG),
  ))
  const slopeDensity = 1 - progress * progress * (3 - 2 * progress)
  return slopeDensity * (1 - Math.max(0, terrain.southExposure) * 0.15)
}
