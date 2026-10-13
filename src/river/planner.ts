/**
 * Pure river-planning math: the longitudinal water profile, per-point
 * width/depth resolution, and the channel cross-section. Everything here is
 * deterministic and free of terrain/scene types so it can be unit-tested (and
 * reused by a future `draw_river` tool) without a Site. `planRiver` in
 * `./terrain` binds these functions to a sampled path on real terrain and is
 * the single planner used by the panel, the carve, and the water surface.
 */
import type { RiverSection, RiverSectionShape } from './schema'

/** Keeps river water consistently below its uncarved centerline. */
export function riverSurfaceInset(depth: number): number {
  return Math.min(0.14, Math.max(0.025, depth * 0.12))
}

export type RiverProfileStation = Readonly<{
  distanceM: number
  groundY: number
  depthM: number
}>

export type RiverProfileSample = Readonly<{
  distanceM: number
  groundY: number
  /** Solved water-surface height. Never rises toward downstream in downhill mode. */
  waterY: number
  /** Water slope from the previous station, in percent (positive = descending). */
  slopePct: number
  /** How far the bank top (water + inset) sits above the centerline ground. */
  embankmentM: number
  /**
   * True where the solved water runs at the maximum slope: down steeper
   * ground, and on through its catch-up below a cliff, where the ground is
   * already flat but the water is still falling at the cap.
   */
  rapid: boolean
}>

/**
 * Solve a downhill-only water profile from the upstream end. Walking
 * downstream, the water level is the lower of the ground-following level and
 * the previous level (so it never rises: ground rises are cut through), but it
 * may fall no faster than `maxSlopePct` (so steep ground drops leave the water
 * held up on an embankment). Stations must be ordered upstream → downstream.
 *
 * The water is set at `sourceIndex`, the authored upstream end. Stations
 * before it lie in an upstream cap: water there may not sit lower than the
 * source it flows into, so the cap holds the source level.
 */
export function solveDownhillProfile(
  stations: readonly RiverProfileStation[],
  maxSlopePct: number,
  sourceIndex = 0,
): RiverProfileSample[] {
  const solved = solveFromSource(stations.slice(sourceIndex), maxSlopePct)
  const sourceWaterY = solved[0]?.waterY
  if (sourceWaterY === undefined) return solved
  const heldCap = stations
    .slice(0, sourceIndex)
    .map((station) => profileSample(station, sourceWaterY, 0, false))
  return [...heldCap, ...solved]
}

function solveFromSource(
  stations: readonly RiverProfileStation[],
  maxSlopePct: number,
): RiverProfileSample[] {
  const samples: RiverProfileSample[] = []
  for (let index = 0; index < stations.length; index += 1) {
    const station = stations[index]!
    const groundWaterY = station.groundY - riverSurfaceInset(station.depthM)
    const previous = samples[index - 1]
    if (!previous) {
      samples.push(profileSample(station, groundWaterY, 0, false))
      continue
    }
    const runM = Math.max(0, station.distanceM - stations[index - 1]!.distanceM)
    const maxDropM = (maxSlopePct / 100) * runM
    const waterY = Math.max(previous.waterY - maxDropM, Math.min(groundWaterY, previous.waterY))
    const slopePct = runM > 1e-9 ? ((previous.waterY - waterY) / runM) * 100 : 0
    const rapid = maxSlopePct > 0 && slopePct >= maxSlopePct - 1e-6
    samples.push(profileSample(station, waterY, slopePct, rapid))
  }
  return samples
}

/** The pre-v3 profile: water follows the ground, inset by depth. It can rise. */
export function asDrawnProfile(stations: readonly RiverProfileStation[]): RiverProfileSample[] {
  return stations.map((station, index) => {
    const waterY = station.groundY - riverSurfaceInset(station.depthM)
    const previous = stations[index - 1]
    const runM = previous ? station.distanceM - previous.distanceM : 0
    const slopePct =
      previous && runM > 1e-9
        ? ((previous.groundY - riverSurfaceInset(previous.depthM) - waterY) / runM) * 100
        : 0
    return profileSample(station, waterY, slopePct, false)
  })
}

function profileSample(
  station: RiverProfileStation,
  waterY: number,
  slopePct: number,
  rapid: boolean,
): RiverProfileSample {
  return {
    distanceM: station.distanceM,
    groundY: station.groundY,
    waterY,
    slopePct,
    embankmentM: Math.max(0, waterY + riverSurfaceInset(station.depthM) - station.groundY),
    rapid,
  }
}

/**
 * Resolve one numeric value per authored point from sparse overrides. A null
 * or missing override interpolates linearly between the nearest set
 * neighbours; with no set neighbour on a side it takes the closest set value,
 * and with no overrides at all every point takes `fallback`.
 */
export function resolvePointValues(
  pointCount: number,
  overrides: readonly (number | null)[],
  fallback: number,
): number[] {
  const setIndexes: number[] = []
  for (let index = 0; index < pointCount; index += 1) {
    if (overrides[index] !== null && overrides[index] !== undefined) setIndexes.push(index)
  }
  if (setIndexes.length === 0) return new Array(pointCount).fill(fallback)
  return Array.from({ length: pointCount }, (_, index) => {
    const own = overrides[index]
    if (own !== null && own !== undefined) return own
    let before: number | undefined
    let after: number | undefined
    for (const setIndex of setIndexes) {
      if (setIndex < index) before = setIndex
      if (setIndex > index && after === undefined) after = setIndex
    }
    if (before === undefined) return overrides[after!]!
    if (after === undefined) return overrides[before]!
    const amount = (index - before) / (after - before)
    return overrides[before]! + (overrides[after]! - overrides[before]!) * amount
  })
}

/**
 * Channel cross-section as a 0..1 multiplier of depth at a lateral offset.
 * `curved` is the original rounded bed; `trapezoid` is a flat bed whose side
 * slopes run at the section's bank slope. A trapezoid too narrow for its depth
 * (side run longer than the half-width) keeps that slope and becomes a V
 * reaching only half-width / slope: the shape stays continuous to the rim and
 * the planner reports the shortfall in its facts.
 */
export function riverSectionShape(
  shape: RiverSectionShape,
  lateralM: number,
  halfWidthM: number,
  depthM: number,
  bankSlope: number,
): number {
  const distance = Math.abs(lateralM)
  if (halfWidthM <= 1e-9 || distance >= halfWidthM) return 0
  if (shape === 'trapezoid') {
    const sideRunM = Math.max(1e-6, depthM * bankSlope)
    if (sideRunM > halfWidthM) return (halfWidthM - distance) / sideRunM
    const bedHalfM = halfWidthM - sideRunM
    if (distance <= bedHalfM) return 1
    return Math.max(0, 1 - (distance - bedHalfM) / sideRunM)
  }
  const normalized = distance / halfWidthM
  if (normalized <= 0.42) {
    const normalizedBed = normalized / 0.42
    return 1 - 0.06 * normalizedBed * normalizedBed
  }
  return 0.94 * (1 - smoothstep(0.42, 1, normalized))
}

export type RiverSectionTargetInput = Readonly<{
  /** Signed lateral offset from the centerline, metres (sign picks the bank). */
  lateralM: number
  /** Existing ground height at this offset, metres. */
  groundY: number
  /** Ground height on the centerline at this station, metres. */
  centerGroundY: number
  /** Bank-top height: solved water level plus its surface inset. */
  channelTopY: number
  depthM: number
  halfWidthM: number
  /** Lateral shift of the deepest line toward the outside of a bend, metres. */
  bendShiftM: number
  section: RiverSection
}>

/**
 * Target terrain height for one point beside a downhill-mode station, or null
 * where the river leaves the ground untouched. Inside the channel the bed is
 * set outright (cut through rises, filled across dips); outside it a berm
 * bench, then a bank at the section slope that feathers into the ground over
 * the blend distance.
 */
export function riverSectionTargetHeight(input: RiverSectionTargetInput): number | null {
  const { section } = input
  const fromDeepLine = Math.abs(input.lateralM - input.bendShiftM)
  if (fromDeepLine <= input.halfWidthM) {
    const shape = riverSectionShape(
      section.shape,
      fromDeepLine,
      input.halfWidthM,
      input.depthM,
      section.bankSlope,
    )
    return input.channelTopY - input.depthM * shape
  }
  const beyondChannelM = Math.abs(input.lateralM) - input.halfWidthM
  if (beyondChannelM <= section.bermM) return input.channelTopY
  const bankRunM = beyondChannelM - section.bermM
  // Bound the bank so a hillside steeper than the bank slope cannot cut forever.
  const maxBankRunM =
    section.bankSlope * Math.max(0, input.centerGroundY - input.channelTopY + input.depthM) +
    section.blendM
  if (bankRunM > maxBankRunM) return null
  if (input.groundY >= input.channelTopY) {
    const bankLineY = input.channelTopY + bankRunM / section.bankSlope
    let target = Math.min(input.groundY, bankLineY)
    const blendStartM = maxBankRunM - section.blendM
    if (section.blendM > 0 && bankRunM > blendStartM) {
      target = lerp(target, input.groundY, smoothstep(blendStartM, maxBankRunM, bankRunM))
    }
    return target === input.groundY ? null : target
  }
  if (section.blendM <= 0 || bankRunM >= section.blendM) return null
  return lerp(input.channelTopY, input.groundY, smoothstep(0, section.blendM, bankRunM))
}

/** Facts reported for a planned river: what it is, and what it costs in earthworks. */
export type RiverFacts = Readonly<{
  lengthM: number
  /** Water-surface fall from the upstream to the downstream authored end. */
  dropM: number
  meanSlopePct: number
  /** Planner estimates from sampled cross-sections, in cubic metres. */
  cutVolumeM3: number
  fillVolumeM3: number
  /** Length whose banks sit above the centerline ground (on an embankment). */
  embankedLengthM: number
  maxEmbankmentM: number
  /** Length where the water runs at the maximum slope (see `RiverProfileSample.rapid`). */
  rapidLengthM: number
  /**
   * Most the channel had to be made shallower than authored to keep its banks
   * at the authored slope (a trapezoid too narrow for its depth); 0 otherwise.
   */
  depthShortfallM: number
}>

export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0
  const amount = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return amount * amount * (3 - 2 * amount)
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount
}
