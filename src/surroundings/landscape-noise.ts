import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js'
import type { Point2 } from './frontages'
import { seededRange } from './seeded-random'
import { deriveLandscapeRegion, riverOffsetAt } from './landscape-region'

export const SEA_LEVEL = -4
export const LANDSCAPE_EXTENT = 512
const smooth = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** One continuous, deterministic field shared by terrain, streets and planting. */
export function createLandscapeHeight(center: Point2, protectedRadius: number, seed = 'pascal-suburbs') {
  const noise = new ImprovedNoise()
  const offset = seededRange(seed, 'noise-domain', 0, 256)
  const region = deriveLandscapeRegion(seed)
  const coastCos = Math.cos(region.coast?.angle ?? 0), coastSin = Math.sin(region.coast?.angle ?? 0)
  const riverCos = Math.cos(region.river?.angle ?? 0), riverSin = Math.sin(region.river?.angle ?? 0)
  const peaks = region.peaks.map((peak) => ({
    ...peak, x: Math.cos(peak.angle) * (protectedRadius + peak.distance),
    z: Math.sin(peak.angle) * (protectedRadius + peak.distance),
  }))
  const fbm = (x: number, z: number) => {
    let value = 0, amplitude = 0.5, frequency = 1
    for (let octave = 0; octave < 4; octave += 1) {
      value += noise.noise(x * frequency + offset, z * frequency - offset, 17.31) * amplitude
      amplitude *= 0.5
      frequency *= 2
    }
    return value / 0.9375
  }
  return (worldX: number, worldZ: number) => {
    const x = worldX - center[0], z = worldZ - center[1]
    const radius = Math.hypot(x, z) - protectedRadius
    let sea = 0
    if (region.coast) {
      const along = x * coastCos + z * coastSin - protectedRadius
      const across = -x * coastSin + z * coastCos
      const shoreline = region.coast.distance
        + Math.sin(across / region.coast.wavelength + region.coast.phase) * region.coast.bays
        + fbm(x * 0.008, z * 0.008) * 24
      sea = smooth(shoreline, shoreline + 65, along) * smooth(90, 125, radius)
      if (sea === 1) return -18
    }
    let riverDistance = Infinity
    if (region.river) {
      const along = x * riverCos + z * riverSin
      riverDistance = Math.abs(-x * riverSin + z * riverCos
        - riverOffsetAt(region.river, along, protectedRadius))
    }
    const rolling = 4 + fbm(x * 0.009, z * 0.009) * 9
    let mountains = 0
    for (const peak of peaks) {
      const distanceSquared = ((x - peak.x) / peak.width) ** 2 + ((z - peak.z) / peak.depth) ** 2
      // Merge mountain silhouettes instead of stacking overlapping elevations
      // into a much taller wall beside the neighborhood.
      if (distanceSquared < 4) mountains = Math.max(mountains, Math.exp(-distanceSquared * 1.7) * peak.height)
    }
    if (mountains > 0) mountains *= smooth(130, 225, radius)
      * (0.7 + (1 - Math.abs(fbm(x * 0.013, z * 0.013))) * 0.6)
      * smooth(38, 135, riverDistance)
    let land = rolling + Math.min(165, mountains)
    if (region.river) {
      const bank = smooth(region.river.halfWidth, region.river.halfWidth + 24, riverDistance)
      land = (SEA_LEVEL - 3) * (1 - bank) + land * bank
    }
    return land * (1 - sea) - 18 * sea
  }
}
