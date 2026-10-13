/**
 * Where a river's channel meets itself: a crossing, a loop closing on itself,
 * or hairpin legs whose banks touch. Measured between the channel's segments,
 * not its sample points, so a narrow crossing that falls between two samples
 * is found however coarsely the river is sampled.
 */

/** One centreline station of a planned channel, in plan coordinates. */
export type ChannelStation = Readonly<{
  x: number
  z: number
  /** Distance along the river's course, metres. */
  courseM: number
  halfWidthM: number
  waterY: number
}>

type ChannelSegment = Readonly<{
  start: ChannelStation
  end: ChannelStation
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}>

/**
 * Largest water-level difference where two parts of one channel overlap in
 * plan although the course between them is longer than their separation plus
 * both half-widths. Bends within one reach never qualify. Zero when the
 * channel never meets itself.
 */
export function channelSelfOverlapGapM(stations: readonly ChannelStation[]): number {
  const segments = channelSegments(stations)
  let gapM = 0
  for (let first = 0; first < segments.length; first += 1) {
    for (let second = first + 1; second < segments.length; second += 1) {
      const firstSegment = segments[first]
      const secondSegment = segments[second]
      if (firstSegment && secondSegment) {
        gapM = Math.max(gapM, contactLevelGapM(firstSegment, secondSegment))
      }
    }
  }
  return gapM
}

function channelSegments(stations: readonly ChannelStation[]): ChannelSegment[] {
  const segments: ChannelSegment[] = []
  for (let index = 1; index < stations.length; index += 1) {
    const start = stations[index - 1]
    const end = stations[index]
    if (!start || !end) continue
    const reachM = Math.max(start.halfWidthM, end.halfWidthM)
    segments.push({
      start,
      end,
      minX: Math.min(start.x, end.x) - reachM,
      minZ: Math.min(start.z, end.z) - reachM,
      maxX: Math.max(start.x, end.x) + reachM,
      maxZ: Math.max(start.z, end.z) + reachM,
    })
  }
  return segments
}

/** Water-level difference where two segments' channels touch, or 0 if they do not. */
function contactLevelGapM(first: ChannelSegment, second: ChannelSegment): number {
  if (
    first.maxX < second.minX ||
    second.maxX < first.minX ||
    first.maxZ < second.minZ ||
    second.maxZ < first.minZ
  ) {
    return 0
  }
  const { firstAmount, secondAmount } = closestSegmentParameters(first, second)
  const onFirst = stationAlong(first, firstAmount)
  const onSecond = stationAlong(second, secondAmount)
  const apartM = Math.hypot(onSecond.x - onFirst.x, onSecond.z - onFirst.z)
  const contactM = onFirst.halfWidthM + onSecond.halfWidthM
  if (apartM >= contactM) return 0
  if (Math.abs(onSecond.courseM - onFirst.courseM) <= apartM + contactM) return 0
  return Math.abs(onFirst.waterY - onSecond.waterY)
}

function stationAlong(segment: ChannelSegment, amount: number): ChannelStation {
  const { start, end } = segment
  return {
    x: lerp(start.x, end.x, amount),
    z: lerp(start.z, end.z, amount),
    courseM: lerp(start.courseM, end.courseM, amount),
    halfWidthM: lerp(start.halfWidthM, end.halfWidthM, amount),
    waterY: lerp(start.waterY, end.waterY, amount),
  }
}

/**
 * Parameters of the closest points of two segments, each in 0..1 along its
 * segment (Ericson, Real-Time Collision Detection, 5.1.9). Crossing segments
 * give their intersection.
 */
function closestSegmentParameters(
  first: ChannelSegment,
  second: ChannelSegment,
): Readonly<{ firstAmount: number; secondAmount: number }> {
  const firstX = first.end.x - first.start.x
  const firstZ = first.end.z - first.start.z
  const secondX = second.end.x - second.start.x
  const secondZ = second.end.z - second.start.z
  const offsetX = first.start.x - second.start.x
  const offsetZ = first.start.z - second.start.z
  const firstLengthSquared = firstX * firstX + firstZ * firstZ
  const secondLengthSquared = secondX * secondX + secondZ * secondZ
  const secondAlongOffset = secondX * offsetX + secondZ * offsetZ
  if (firstLengthSquared <= DEGENERATE_LENGTH_SQUARED) {
    return {
      firstAmount: 0,
      secondAmount:
        secondLengthSquared <= DEGENERATE_LENGTH_SQUARED
          ? 0
          : clamp01(secondAlongOffset / secondLengthSquared),
    }
  }
  const firstAlongOffset = firstX * offsetX + firstZ * offsetZ
  if (secondLengthSquared <= DEGENERATE_LENGTH_SQUARED) {
    return { firstAmount: clamp01(-firstAlongOffset / firstLengthSquared), secondAmount: 0 }
  }
  const alignment = firstX * secondX + firstZ * secondZ
  const denominator = firstLengthSquared * secondLengthSquared - alignment * alignment
  // Parallel segments have no single closest pair; any point of the first will do.
  const parallel = denominator <= PARALLEL_TOLERANCE * firstLengthSquared * secondLengthSquared
  const firstAmount = !parallel
      ? clamp01(
          (alignment * secondAlongOffset - firstAlongOffset * secondLengthSquared) / denominator,
        )
      : 0
  const secondAmount = (alignment * firstAmount + secondAlongOffset) / secondLengthSquared
  if (secondAmount < 0) {
    return { firstAmount: clamp01(-firstAlongOffset / firstLengthSquared), secondAmount: 0 }
  }
  if (secondAmount > 1) {
    return {
      firstAmount: clamp01((alignment - firstAlongOffset) / firstLengthSquared),
      secondAmount: 1,
    }
  }
  return { firstAmount, secondAmount }
}

/** Sampled river segments are at least 1e-6 m long; anything shorter is a point. */
const DEGENERATE_LENGTH_SQUARED = 1e-14
/** Squared sine of the angle below which two segments count as parallel. */
const PARALLEL_TOLERANCE = 1e-12

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
