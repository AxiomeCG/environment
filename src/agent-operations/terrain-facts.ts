import type { PlantingTerrainSample } from '../planting-terrain'
import { roundFact } from './scene'

export type TerrainSamples = {
  count: number
  minHeightM: number
  maxHeightM: number
  minSlopeDeg: number
  maxSlopeDeg: number
}

export function createTerrainSamples(): TerrainSamples {
  return { count: 0, minHeightM: Infinity, maxHeightM: -Infinity, minSlopeDeg: Infinity, maxSlopeDeg: -Infinity }
}

export function includeTerrainSample(samples: TerrainSamples, sample: PlantingTerrainSample): void {
  samples.count += 1
  samples.minHeightM = Math.min(samples.minHeightM, sample.heightM)
  samples.maxHeightM = Math.max(samples.maxHeightM, sample.heightM)
  samples.minSlopeDeg = Math.min(samples.minSlopeDeg, sample.slopeDeg)
  samples.maxSlopeDeg = Math.max(samples.maxSlopeDeg, sample.slopeDeg)
}

/** Extrema of sampled terrain, not plant counts, botanical suitability or sunlight. */
export function terrainSampleFacts(samples: TerrainSamples, cellM: number | null, sampleAt: string) {
  return {
    sampleCount: samples.count,
    cellM,
    sampleAt,
    heightRangeM: samples.count === 0 ? null : [roundFact(samples.minHeightM), roundFact(samples.maxHeightM)],
    slopeRangeDeg: samples.count === 0 ? null : [roundFact(samples.minSlopeDeg), roundFact(samples.maxSlopeDeg)],
  }
}
