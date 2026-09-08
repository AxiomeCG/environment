import type { Point2 } from './frontages'

function pointToSegmentDistance(x: number, z: number, start: Point2, end: Point2): number {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared <= 1e-9) return Math.hypot(x - start[0], z - start[1])
  const amount = Math.max(
    0,
    Math.min(1, ((x - start[0]) * dx + (z - start[1]) * dz) / lengthSquared),
  )
  return Math.hypot(x - start[0] - dx * amount, z - start[1] - dz * amount)
}

export function signedBoundaryDistance(boundary: readonly Point2[], x: number, z: number): number {
  let inside = false
  let distance = Number.POSITIVE_INFINITY
  for (
    let current = 0, previous = boundary.length - 1;
    current < boundary.length;
    previous = current, current += 1
  ) {
    const start = boundary[previous]!
    const end = boundary[current]!
    distance = Math.min(distance, pointToSegmentDistance(x, z, start, end))
    if (
      start[1] > z !== end[1] > z &&
      x < ((end[0] - start[0]) * (z - start[1])) / (end[1] - start[1]) + start[0]
    ) {
      inside = !inside
    }
  }
  return inside ? -distance : distance
}

export function dryNaturalHeightAt(
  x: number,
  z: number,
  heightAt: (x: number, z: number) => number,
  waterLevelAt: ((x: number, z: number) => number | null) | undefined,
): number | null {
  const height = heightAt(x, z)
  if (!Number.isFinite(height)) return null
  const waterLevel = waterLevelAt?.(x, z)
  if (waterLevel !== null && waterLevel !== undefined && waterLevel >= height - 0.03) {
    return null
  }
  return height
}
