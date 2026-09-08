import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js'
import type { Point2 } from './frontages'
import { seededRange } from './seeded-random'
import { deriveLandscapeRegion, riverOffsetAt, type LandscapeRegion } from './landscape-region'

export const SEA_LEVEL = -4
export const LANDSCAPE_EXTENT = 512
const smooth = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** One continuous, deterministic field shared by terrain, streets and planting. */
export function createLandscapeHeight(
  center: Point2,
  protectedRadius: number,
  seed = 'pascal-suburbs',
  region: LandscapeRegion = deriveLandscapeRegion(seed),
) {
  const noise = new ImprovedNoise()
  const offset = seededRange(seed, 'noise-domain', 0, 256)
  const coastCos = Math.cos(region.coast?.angle ?? 0),
    coastSin = Math.sin(region.coast?.angle ?? 0)
  const riverCos = Math.cos(region.river?.angle ?? 0),
    riverSin = Math.sin(region.river?.angle ?? 0)
  let ridgeX = 0,
    ridgeZ = 0
  for (const peak of region.peaks) {
    ridgeX += Math.cos(peak.angle)
    ridgeZ += Math.sin(peak.angle)
  }
  const ridgeAngle = Math.atan2(ridgeZ, ridgeX)
  const ridgeCos = Math.cos(ridgeAngle),
    ridgeSin = Math.sin(ridgeAngle)
  const peaks = region.peaks.map((peak) => ({
    ...peak,
    x: Math.cos(peak.angle) * (protectedRadius + peak.distance),
    z: Math.sin(peak.angle) * (protectedRadius + peak.distance),
  }))
  const fbm = (x: number, z: number) => {
    let value = 0,
      amplitude = 0.5,
      frequency = 1
    for (let octave = 0; octave < 4; octave += 1) {
      value += noise.noise(x * frequency + offset, z * frequency - offset, 17.31) * amplitude
      amplitude *= 0.5
      frequency *= 2
    }
    return value / 0.9375
  }
  return (worldX: number, worldZ: number) => {
    const x = worldX - center[0],
      z = worldZ - center[1]
    const radius = Math.hypot(x, z) - protectedRadius
    let coastalShelf = 0,
      offshore = 0
    if (region.coast) {
      const along = x * coastCos + z * coastSin - protectedRadius
      const across = -x * coastSin + z * coastCos
      const shoreline =
        region.coast.distance +
        Math.sin(across / region.coast.wavelength + region.coast.phase) * region.coast.bays +
        fbm(x * 0.008, z * 0.008) * 24
      const shoreDistance = along - shoreline
      const coastReveal = smooth(90, 125, radius)
      // Shape a dry, low shelf before easing into the seabed. The deep-water
      // edge remains at +65 m for the fixed offshore apron.
      coastalShelf = smooth(-32, 18, shoreDistance) * coastReveal
      offshore = smooth(18, 65, shoreDistance) * coastReveal
      if (offshore === 1) return -18
    }
    let riverDistance = Infinity
    if (region.river) {
      const along = x * riverCos + z * riverSin
      riverDistance = Math.abs(
        -x * riverSin + z * riverCos - riverOffsetAt(region.river, along, protectedRadius),
      )
    }
    const rolling = 4 + fbm(x * 0.009, z * 0.009) * 9
    let mountains = 0
    for (const peak of peaks) {
      const dx = x - peak.x,
        dz = z - peak.z
      const acrossRidge = -dx * ridgeSin + dz * ridgeCos
      const throughRidge = dx * ridgeCos + dz * ridgeSin
      const distanceSquared = (acrossRidge / peak.width) ** 2 + (throughRidge / peak.depth) ** 2
      // Every broad peak follows the same regional ridge frame. Neighboring
      // envelopes overlap into one silhouette without stacking heights.
      if (distanceSquared < 4)
        mountains = Math.max(mountains, Math.exp(-distanceSquared * 1.7) * peak.height)
    }
    if (mountains > 0)
      mountains *=
        smooth(130, 225, radius) *
        (0.7 + (1 - Math.abs(fbm(x * 0.013, z * 0.013))) * 0.6) *
        smooth(
          (region.river?.halfWidth ?? 0) + 35,
          (region.river?.halfWidth ?? 0) + 135,
          riverDistance,
        )
    let land = rolling + Math.min(165, mountains)
    if (region.river) {
      // Hold a low channel, pass through a buildable terrace, then restore
      // regional relief across a much broader outer shoulder.
      const channelBank = smooth(region.river.halfWidth, region.river.halfWidth + 22, riverDistance)
      const valleyShoulder = smooth(
        region.river.halfWidth + 22,
        region.river.halfWidth + 112,
        riverDistance,
      )
      const terrace = Math.min(land, SEA_LEVEL + 6)
      const valley = (SEA_LEVEL - 3) * (1 - channelBank) + terrace * channelBank
      land = valley * (1 - valleyShoulder) + land * valleyShoulder
    }
    if (coastalShelf > 0) {
      const shelfHeight = Math.min(land, SEA_LEVEL + 1.5)
      land = land * (1 - coastalShelf) + shelfHeight * coastalShelf
    }
    return land * (1 - offshore) - 18 * offshore
  }
}
