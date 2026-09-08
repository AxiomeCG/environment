import { pointInPolygon2D, surfaceHeightAt } from '@pascal-app/core'
import type { GroundCoverFields } from './field-context'
import { localGrassHeightScaleAt } from './height-field'
import { sampleGrassObstacle } from './obstacle-field'
import { paintAt } from './paint-field'
import { shapeGrassCoverageValue } from './render/blade-shape'
import type { GrassFieldNode } from './schema'

export const FLOWER_CANDIDATE_CELL_SIZE = 0.45

export const FLOWER_KINDS = ['daisy', 'cup', 'spike'] as const
export type FlowerKind = (typeof FLOWER_KINDS)[number]

export type FlowerPlacement = Readonly<{
  kind: FlowerKind
  position: readonly [number, number, number]
  rotationY: number
  scale: number
}>

export function collectFlowerPlacements(
  node: GrassFieldNode,
  fields: GroundCoverFields,
): FlowerPlacement[] {
  const flowerDensity = clamp01((node.flowerDensity ?? 0) / 100)
  const grassDensity = clamp01((node.density ?? 100) / 100)
  if (flowerDensity === 0 || grassDensity === 0) return []

  const { bounds } = fields
  const columns = Math.ceil(Math.max(0, bounds.maxX - bounds.minX) / FLOWER_CANDIDATE_CELL_SIZE)
  const rows = Math.ceil(Math.max(0, bounds.maxZ - bounds.minZ) / FLOWER_CANDIDATE_CELL_SIZE)
  const placements: FlowerPlacement[] = []

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const cellX = bounds.minX + column * FLOWER_CANDIDATE_CELL_SIZE
      const cellZ = bounds.minZ + row * FLOWER_CANDIDATE_CELL_SIZE
      const cellWidth = Math.min(FLOWER_CANDIDATE_CELL_SIZE, bounds.maxX - cellX)
      const cellDepth = Math.min(FLOWER_CANDIDATE_CELL_SIZE, bounds.maxZ - cellZ)
      const x = cellX + hash01(column, row, 0x243f6a88) * cellWidth
      const z = cellZ + hash01(column, row, 0x85a308d3) * cellDepth
      if (!pointInPolygon2D([x, z], fields.boundary as [number, number][])) {
        continue
      }

      const paintedDensity = paintAt(fields.paint, x, z).a
      const effectiveGrassDensity = shapeGrassCoverageValue(paintedDensity * grassDensity)
      if (hash01(column, row, 0x13198a2e) > effectiveGrassDensity) continue
      if (hash01(column, row, 0x03707344) > flowerDensity) continue
      if (sampleGrassObstacle(fields.obstacles, x, z).allowed < 0.5) continue

      const localHeightScale = localGrassHeightScaleAt(fields.height, x, z)
      if (localHeightScale <= 0) continue
      const speciesValue = mix(
        coherentValueNoise(x, z, 2.4, 0xa4093822),
        hash01(column, row, 0x299f31d0),
        0.22,
      )
      const kind = speciesValue < 1 / 3 ? 'daisy' : speciesValue < 2 / 3 ? 'cup' : 'spike'
      const y = fields.terrain ? surfaceHeightAt(fields.terrain, x, z) : 0
      placements.push({
        kind,
        position: [x, y, z],
        rotationY: hash01(column, row, 0x082efa98) * Math.PI * 2,
        scale: (0.78 + hash01(column, row, 0xec4e6c89) * 0.44) * clamp(localHeightScale, 0.5, 1.5),
      })
    }
  }

  return placements
}

function coherentValueNoise(x: number, z: number, scale: number, seed: number): number {
  const sampleX = x / scale
  const sampleZ = z / scale
  const x0 = Math.floor(sampleX)
  const z0 = Math.floor(sampleZ)
  const tx = smoothstep(sampleX - x0)
  const tz = smoothstep(sampleZ - z0)
  const top = mix(hash01(x0, z0, seed), hash01(x0 + 1, z0, seed), tx)
  const bottom = mix(hash01(x0, z0 + 1, seed), hash01(x0 + 1, z0 + 1, seed), tx)
  return mix(top, bottom, tz)
}

function hash01(x: number, z: number, seed: number): number {
  let value = Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495) ^ seed
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  value ^= value >>> 16
  return (value >>> 0) / 0x1_0000_0000
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value)
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount
}

function clamp01(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
