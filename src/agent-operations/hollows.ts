import type { TerrainField } from '@pascal-app/core'
import { analyzePondBasin, buildPondSurface, terrainMeshMinima } from '../pond/basin'
import { refuse } from './refuse'
import { roundFact } from './scene'
import type { PlanPoint } from './types'

const MAX_TERRAIN_CELLS = 1_000_000
/** Basin analyses one read may run; a hollow-rich site reports `hollowsTruncated` past them. */
const MAX_BASIN_TRIES = 32

/**
 * Hollows with their bottom in the region, lowest bottoms first, each analysed from its minimum
 * as `fill_pond` would. Approximate: the persisted heightfield's resolution bounds them.
 */
export function scanHollows(
  terrain: TerrainField | null,
  sitePolygon: PlanPoint[],
  inRegion: (x: number, z: number) => boolean,
  limit: number,
): { hollows: Record<string, unknown>[]; truncated: boolean } {
  if (!terrain || limit === 0) return { hollows: [], truncated: false }
  if (terrain.cols * terrain.rows > MAX_TERRAIN_CELLS) {
    refuse('sampling_limit', 'The terrain field is too large to scan for hollows.', {
      cells: terrain.cols * terrain.rows,
      maxCells: MAX_TERRAIN_CELLS,
    })
  }
  const minima = terrainMeshMinima(terrain, sitePolygon, inRegion)
  const hollows: Record<string, unknown>[] = []
  const seenBasins = new Set<string>()
  let tries = 0
  for (const { point } of minima) {
    if (hollows.length >= limit) break
    if (tries >= MAX_BASIN_TRIES) return { hollows, truncated: true }
    tries += 1
    const basin = analyzePondBasin(terrain, sitePolygon, point)
    if (!basin) continue
    const key = `${roundFact(basin.seed[0])}:${roundFact(basin.seed[1])}`
    if (seenBasins.has(key)) continue
    seenBasins.add(key)
    hollows.push({
      atM: [roundFact(basin.seed[0]), roundFact(basin.seed[1])],
      bottomM: roundFact(basin.bottomLevel),
      spillLevelM: roundFact(basin.spillLevel),
      maxDepthM: roundFact(basin.spillLevel - basin.bottomLevel),
      areaM2: roundFact(buildPondSurface(basin, basin.spillLevel).area),
      approximate: true,
    })
  }
  return { hollows, truncated: false }
}
