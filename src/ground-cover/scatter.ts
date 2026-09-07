import {
  pointInPolygon2D,
  surfaceHeightAt,
  type TerrainField,
} from '@pascal-app/core'
import { mulberry32 } from '../variant-utils'
import type { SiteBounds } from './paint-field'
import type { GrassFieldNode } from './schema'

export const GRASS_CANDIDATE_CELL_SIZE = 0.08

export type GrassBladeDimensions = Pick<
  GrassFieldNode,
  'bladeWidth' | 'bladeHeight' | 'bladeWidthVariation' | 'bladeHeightVariation'
>

export type GrassCandidateVisitor = (
  x: number,
  y: number,
  z: number,
  yaw: number,
  widthFactor: number,
  heightFactor: number,
  densityThreshold: number,
  tint: number,
) => void

export function grassCandidateCapacity(bounds: SiteBounds): number {
  const columns = Math.ceil(
    Math.max(0, bounds.maxX - bounds.minX) / GRASS_CANDIDATE_CELL_SIZE,
  )
  const rows = Math.ceil(
    Math.max(0, bounds.maxZ - bounds.minZ) / GRASS_CANDIDATE_CELL_SIZE,
  )
  return columns * rows
}

export function visitGrassCandidates(
  node: GrassBladeDimensions,
  boundary: ReadonlyArray<readonly [number, number]>,
  bounds: SiteBounds,
  terrain: TerrainField | null,
  visitor: GrassCandidateVisitor,
): void {
  const columns = Math.ceil(
    Math.max(0, bounds.maxX - bounds.minX) / GRASS_CANDIDATE_CELL_SIZE,
  )
  const rows = Math.ceil(
    Math.max(0, bounds.maxZ - bounds.minZ) / GRASS_CANDIDATE_CELL_SIZE,
  )
  const widthVariation = (node.bladeWidthVariation ?? 20) / 100
  const heightVariation = (node.bladeHeightVariation ?? 20) / 100
  const random = mulberry32(1)
  const tintRandom = mulberry32(2)

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const cellX = bounds.minX + column * GRASS_CANDIDATE_CELL_SIZE
      const cellZ = bounds.minZ + row * GRASS_CANDIDATE_CELL_SIZE
      const cellWidth = Math.min(GRASS_CANDIDATE_CELL_SIZE, bounds.maxX - cellX)
      const cellDepth = Math.min(GRASS_CANDIDATE_CELL_SIZE, bounds.maxZ - cellZ)
      const x = cellX + random() * cellWidth
      const z = cellZ + random() * cellDepth
      const yaw = random() * Math.PI * 2
      const widthFactor = 1 + (random() * 2 - 1) * widthVariation
      const heightFactor = 1 + (random() * 2 - 1) * heightVariation
      const densityThreshold = random()
      const tint = tintRandom() * 2 - 1

      if (!pointInPolygon2D([x, z], boundary as [number, number][])) continue
      visitor(
        x,
        terrain ? surfaceHeightAt(terrain, x, z) : 0,
        z,
        yaw,
        widthFactor,
        heightFactor,
        densityThreshold,
        tint,
      )
    }
  }
}
