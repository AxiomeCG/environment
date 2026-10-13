import type { TerrainField } from '@pascal-app/core'
import { analyzePondBasin, buildPondSurface } from '../pond/basin'
import { refuse } from './refuse'
import { roundFact } from './scene'
import type { PlanPoint } from './types'

const MAX_TERRAIN_CELLS = 1_000_000
/** Basin analyses one read may run; a hollow-rich site reports `hollowsTruncated` past them. */
const MAX_BASIN_TRIES = 32

type Minimum = { point: PlanPoint; height: number }

/**
 * One flat patch of equal heights (eight-connected) from `start`: its cells, and whether any
 * neighbour of the patch is lower or higher.
 */
function floodPlateau(terrain: TerrainField, start: number, seen: Uint8Array) {
  const { cols, rows, heights } = terrain
  const height = heights[start] ?? 0
  const cells = [start]
  let lower = false
  let higher = false
  seen[start] = 1
  for (let next = 0; next < cells.length; next += 1) {
    const cell = cells[next] ?? 0
    const col = cell % cols
    const row = Math.floor(cell / cols)
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const ncol = col + dc
        const nrow = row + dr
        if ((dr === 0 && dc === 0) || ncol < 0 || nrow < 0 || ncol >= cols || nrow >= rows) continue
        const neighbour = nrow * cols + ncol
        const neighbourHeight = heights[neighbour] ?? 0
        if (neighbourHeight < height) lower = true
        else if (neighbourHeight > height) higher = true
        else if (!seen[neighbour]) {
          seen[neighbour] = 1
          cells.push(neighbour)
        }
      }
    }
  }
  return { cells, height, lower, higher }
}

/**
 * The terrain's local minima in the region, lowest first: one seed per flat bottom (a plateau
 * with nothing lower around it and something higher), however many cells it spans.
 */
function minimumPlateaus(
  terrain: TerrainField,
  inRegion: (x: number, z: number) => boolean,
): Minimum[] {
  const seen = new Uint8Array(terrain.cols * terrain.rows)
  const minima: Minimum[] = []
  for (let start = 0; start < seen.length; start += 1) {
    if (seen[start]) continue
    const plateau = floodPlateau(terrain, start, seen)
    if (plateau.lower || !plateau.higher) continue
    const seed = plateau.cells
      .map(
        (cell): PlanPoint => [
          terrain.origin[0] + (cell % terrain.cols) * terrain.spacing,
          terrain.origin[1] + Math.floor(cell / terrain.cols) * terrain.spacing,
        ],
      )
      .find((point) => inRegion(point[0], point[1]))
    if (seed) minima.push({ point: seed, height: plateau.height * terrain.step })
  }
  return minima.sort((a, b) => a.height - b.height)
}

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
  const minima = minimumPlateaus(terrain, inRegion)
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
