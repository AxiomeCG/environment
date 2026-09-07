import type { Point2 } from './frontages'
import { seededRange, seededUnit } from './seeded-random'

export type LandscapeRegion = Readonly<{
  kind: 'coastal-lowland' | 'coastal-highland' | 'river-valley' | 'foothills'
  coast: Readonly<{ angle: number; distance: number; bays: number; wavelength: number; phase: number }> | null
  river: Readonly<{ angle: number; offset: number; meander: number; phase: number; halfWidth: number }> | null
  peaks: readonly Readonly<{ angle: number; distance: number; width: number; depth: number; height: number }>[]
  cityAngle: number
  cityDistance: number
  cityDistricts: number
  forestRotation: number
  forestDensity: number
  forestHeight: number
  screenCount: number
  screenDistance: number
  openAngle: number
  openHalfAngle: number
  palette: Readonly<{ grass: string; stone: string; sand: string; water: string; foliage: readonly string[] }>
}>

const PALETTES = [
  { grass: '#899b68', stone: '#99978a', sand: '#c5b78e', water: '#638f98', foliage: ['#52734b', '#648152', '#436b4e', '#758c5d'] },
  { grass: '#72916c', stone: '#8b9390', sand: '#b8b5a0', water: '#5d8592', foliage: ['#45694f', '#577855', '#385e4c', '#67855b'] },
  { grass: '#a0a077', stone: '#a29680', sand: '#cabc97', water: '#729691', foliage: ['#6e7950', '#7f895b', '#556a46', '#8b9162'] },
] as const

/** Regional choices precede placement. No feature gets an unrelated random orientation. */
export function deriveLandscapeRegion(seed = 'pascal-suburbs'): LandscapeRegion {
  const kinds = ['coastal-lowland', 'coastal-highland', 'river-valley', 'foothills'] as const
  const kind = kinds[Math.floor(seededUnit(seed, 'region:kind') * kinds.length)]!
  const angle = seededRange(seed, 'region:orientation', -Math.PI, Math.PI)
  const coastal = kind.startsWith('coastal')
  const mountainous = kind === 'coastal-highland'
  const coast = coastal ? {
    angle,
    distance: seededRange(seed, 'region:shore-distance', 115, 165),
    bays: seededRange(seed, 'region:bays', 24, mountainous ? 80 : 52),
    wavelength: seededRange(seed, 'region:shore-wavelength', 100, 190),
    phase: seededRange(seed, 'region:shore-phase', -Math.PI, Math.PI),
  } : null
  const river = kind === 'river-valley' || (coastal && seededUnit(seed, 'region:river') < 0.55) ? {
    angle,
    offset: seededRange(seed, 'region:river-side', 0, 1) < 0.5 ? -160 : 160,
    meander: seededRange(seed, 'region:river-meander', 20, 42),
    phase: seededRange(seed, 'region:river-phase', -Math.PI, Math.PI),
    halfWidth: seededRange(seed, 'region:river-width', 12, 22),
  } : null
  const peakCount = mountainous ? 4 : 3
  const ridgeSpacing = mountainous ? 0.34 : 0.42
  const peaks = Array.from({ length: peakCount }, (_, index) => {
    const width = seededRange(seed, `region:peak:${index}:width`, 85, 155)
    const depth = seededRange(seed, `region:peak:${index}:depth`, 100, 190)
    const height = seededRange(seed, `region:peak:${index}:height`, mountainous ? 65 : 20, mountainous ? 145 : kind === 'foothills' ? 90 : 58)
    // Place peaks as one regional arc opposite the open side. Seeded jitter
    // keeps identities distinct without scattering unrelated hill blobs.
    const ridgeSlot = index - (peakCount - 1) / 2
    const peakAngle = angle + Math.PI + ridgeSlot * ridgeSpacing
      + seededRange(seed, `region:peak:${index}:angle`, -0.1, 0.1)
    // Tall, broad peaks need room for their near-facing slopes. Preserve their
    // heights and leave already-distant peaks and low hills in place.
    const minimumDistance = height * 2.4 + Math.max(width, depth) * 0.6
    return {
      angle: peakAngle,
      distance: Math.max(seededRange(seed, `region:peak:${index}:distance`, 285, 445), minimumDistance),
      width, depth, height,
    }
  })
  const cityAngle = angle + (seededUnit(seed, 'region:city-side') < 0.5 ? 1 : -1) * seededRange(seed, 'region:city-angle', 1.1, 1.85)
  return {
    kind, coast, river, peaks, cityAngle,
    cityDistance: seededRange(seed, 'region:city-distance', 330, 390),
    cityDistricts: seededUnit(seed, 'region:city-districts') < 0.45 ? 1 : 2,
    forestRotation: seededRange(seed, 'region:forest-rotation', -Math.PI, Math.PI),
    forestDensity: seededRange(seed, 'region:forest-density', 0.6, 1),
    forestHeight: seededRange(seed, 'region:forest-height', 0.8, 1.25),
    screenCount: Math.floor(seededRange(seed, 'region:screens', 3, 6)),
    screenDistance: seededRange(seed, 'region:screen-distance', 105, 155),
    openAngle: coastal ? angle : cityAngle,
    openHalfAngle: seededRange(seed, 'region:open-view', 0.35, 0.8),
    palette: PALETTES[Math.floor(seededUnit(seed, 'region:palette') * PALETTES.length)]!,
  }
}

export function regionPoint(center: Point2, angle: number, along: number, across = 0): Point2 {
  return [center[0] + Math.cos(angle) * along - Math.sin(angle) * across,
    center[1] + Math.sin(angle) * along + Math.cos(angle) * across]
}

/** Signed lateral coordinate of a lowland river; a broad valley surrounds the channel. */
export function riverOffsetAt(river: NonNullable<LandscapeRegion['river']>, along: number, protectedRadius: number): number {
  return river.offset + Math.sign(river.offset) * protectedRadius
    + Math.sin(along * 0.009 + river.phase) * river.meander
    + Math.sin(along * 0.023 + river.phase * 0.7) * 7
}
