import type { ExteriorTerrainSampler } from './exterior-terrain'
import type { Point2 } from './frontages'
import { buildRoadCrossSection } from './streetscape/road-cross-section'
import { sampleRoadEdgePoints } from './streetscape/road-network-geometry'
import type { RoadNetworkNode } from './streetscape/schema'

const SAMPLE_SPACING = 6
const SHOULDER_BLEND = 10
const BUCKET_SIZE = 32
const TARGET_GRADE = 0.08

type Roadbed = {
  x: number
  z: number
  dx: number
  dz: number
  lengthSquared: number
  height: number
  rise: number
  halfWidth: number
}

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

/** Presentation earthworks only. Streets, shoulders and ground sample one surface;
 * the authored Site is never modified. Profiles are built once, not per vertex. */
export function createRoadGradedTerrain(
  network: RoadNetworkNode,
  terrain: ExteriorTerrainSampler,
  boundary: readonly Point2[],
  waterLevelAt?: (x: number, z: number) => number | null,
): ExteriorTerrainSampler {
  const buckets = new Map<number, Map<number, Roadbed[]>>()
  for (const edge of Object.values(network.edges)) {
    const path = sampleRoadEdgePoints(network, edge)
    const style = network.stylePresets[edge.styleId]
    if (path.length < 2 || !style) continue
    const section = buildRoadCrossSection(style)
    const halfWidth = Math.max(section.sides.left.outerOffset, section.sides.right.outerOffset)
    const points: { x: number; z: number; station: number; height: number }[] = []
    let station = 0
    for (let index = 1; index < path.length; index += 1) {
      const a = path[index - 1]!,
        b = path[index]!
      const length = Math.hypot(b[0] - a[0], b[2] - a[2])
      if (length < 1e-6) continue
      const divisions = Math.ceil(length / SAMPLE_SPACING)
      for (let part = 0; part < divisions; part += 1) {
        const t = part / divisions
        const x = a[0] + (b[0] - a[0]) * t,
          z = a[2] + (b[2] - a[2]) * t
        points.push({ x, z, station: station + length * t, height: terrain.heightAt(x, z) })
      }
      station += length
    }
    if (station < 1e-6) continue
    const end = path.at(-1)!
    points.push({ x: end[0], z: end[2], station, height: terrain.heightAt(end[0], end[2]) })
    const firstHeight = points[0]!.height,
      lastHeight = points.at(-1)!.height
    // Preserve common graph-node elevations. A five-sample low-pass removes
    // bumps; the grade envelope cannot move an existing Site connection.
    const heights = points.map((point, index) => {
      let total = 0,
        weight = 0
      for (let offset = -2; offset <= 2; offset += 1) {
        const neighbor = points[Math.max(0, Math.min(points.length - 1, index + offset))]!
        const w = 3 - Math.abs(offset)
        total += neighbor.height * w
        weight += w
      }
      const junctionBlend = smooth(Math.min(point.station, station - point.station) / 14)
      return point.height + (total / weight - point.height) * junctionBlend
    })
    const grade = Math.max(TARGET_GRADE, Math.abs(lastHeight - firstHeight) / station)
    // Both endpoint feasibility cones, followed by forward/backward slope limits.
    for (let index = 1; index < points.length - 1; index += 1) {
      const s = points[index]!.station
      const low = Math.max(firstHeight - grade * s, lastHeight - grade * (station - s))
      const high = Math.min(firstHeight + grade * s, lastHeight + grade * (station - s))
      heights[index] = Math.max(low, Math.min(high, heights[index]!))
    }
    for (let index = 1; index < points.length; index += 1) {
      const rise = grade * (points[index]!.station - points[index - 1]!.station)
      heights[index] = Math.max(
        heights[index - 1]! - rise,
        Math.min(heights[index - 1]! + rise, heights[index]!),
      )
    }
    for (let index = points.length - 2; index >= 0; index -= 1) {
      const rise = grade * (points[index + 1]!.station - points[index]!.station)
      heights[index] = Math.max(
        heights[index + 1]! - rise,
        Math.min(heights[index + 1]! + rise, heights[index]!),
      )
    }
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1]!,
        b = points[index]!
      const dx = b.x - a.x,
        dz = b.z - a.z
      const bed: Roadbed = {
        x: a.x,
        z: a.z,
        dx,
        dz,
        lengthSquared: dx * dx + dz * dz,
        height: heights[index - 1]!,
        rise: heights[index]! - heights[index - 1]!,
        halfWidth,
      }
      const reach = halfWidth + SHOULDER_BLEND
      for (
        let x = Math.floor((Math.min(a.x, b.x) - reach) / BUCKET_SIZE);
        x <= Math.floor((Math.max(a.x, b.x) + reach) / BUCKET_SIZE);
        x += 1
      ) {
        let column = buckets.get(x)
        if (!column) {
          column = new Map()
          buckets.set(x, column)
        }
        for (
          let z = Math.floor((Math.min(a.z, b.z) - reach) / BUCKET_SIZE);
          z <= Math.floor((Math.max(a.z, b.z) + reach) / BUCKET_SIZE);
          z += 1
        ) {
          const bucket = column.get(z)
          if (bucket) bucket.push(bed)
          else column.set(z, [bed])
        }
      }
    }
  }
  if (buckets.size === 0) return terrain

  const heightAt = (x: number, z: number): number => {
    const ground = terrain.heightAt(x, z)
    const waterLevel = waterLevelAt?.(x, z)
    if (waterLevel !== null && waterLevel !== undefined && Number.isFinite(waterLevel))
      return ground
    const beds = buckets.get(Math.floor(x / BUCKET_SIZE))?.get(Math.floor(z / BUCKET_SIZE))
    if (!beds) return ground
    let inside = false,
      boundaryDistanceSquared = Infinity
    for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
      const a = boundary[j]!,
        b = boundary[i]!
      if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0])
        inside = !inside
      const dx = b[0] - a[0],
        dz = b[1] - a[1],
        lengthSquared = dx * dx + dz * dz
      const t =
        lengthSquared > 0
          ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSquared))
          : 0
      boundaryDistanceSquared = Math.min(
        boundaryDistanceSquared,
        (x - a[0] - dx * t) ** 2 + (z - a[1] - dz * t) ** 2,
      )
    }
    if (inside || boundaryDistanceSquared < 1e-12) return ground
    let weightedHeight = 0,
      weight = 0,
      influence = 0
    for (const bed of beds) {
      const t = Math.max(
        0,
        Math.min(1, ((x - bed.x) * bed.dx + (z - bed.z) * bed.dz) / bed.lengthSquared),
      )
      const distanceSquared = (x - bed.x - bed.dx * t) ** 2 + (z - bed.z - bed.dz * t) ** 2
      if (distanceSquared >= (bed.halfWidth + SHOULDER_BLEND) ** 2) continue
      const blend = smooth(
        (bed.halfWidth + SHOULDER_BLEND - Math.sqrt(distanceSquared)) / SHOULDER_BLEND,
      )
      const w = blend / (0.25 + distanceSquared)
      weightedHeight += (bed.height + bed.rise * t) * w
      weight += w
      influence = Math.max(influence, blend)
    }
    return weight > 0
      ? ground +
          (weightedHeight / weight - ground) *
            influence *
            smooth(Math.sqrt(boundaryDistanceSquared) / 3)
      : ground
  }
  return {
    ...terrain,
    heightAt,
    normalAt(x, z) {
      const dx = (heightAt(x + 1, z) - heightAt(x - 1, z)) / 2
      const dz = (heightAt(x, z + 1) - heightAt(x, z - 1)) / 2
      const length = Math.hypot(dx, 1, dz)
      return [-dx / length, 1 / length, -dz / length]
    },
  }
}
