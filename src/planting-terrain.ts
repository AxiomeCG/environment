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
  if (!terrain) return FLAT_AT_DATUM
  // The host may refuse a read (beside a terrain break it cannot resolve, it throws). This is
  // read for every blade and every paint cell, where the lawn is drawn and where an agent lays
  // it: one point the host will not answer must not take the lawn away. Such a point reads as
  // its height with an upright normal, or as the datum when even the height is refused.
  let heightM: number
  try {
    heightM = surfaceHeightAt(terrain, x, z)
  } catch {
    return FLAT_AT_DATUM
  }
  if (!Number.isFinite(heightM)) return FLAT_AT_DATUM
  try {
    return plantingTerrainSample(heightM, normalAt(terrain, x, z))
  } catch {
    return plantingTerrainSample(heightM, UP)
  }
}

const UP: readonly [number, number, number] = [0, 1, 0]
const FLAT_AT_DATUM: PlantingTerrainSample = { heightM: 0, normal: UP, slopeDeg: 0, southExposure: 0 }

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
