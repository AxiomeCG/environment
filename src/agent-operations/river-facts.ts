import {
  persistedTerrainFieldOf,
  surfaceHeightAt,
  type SiteNode,
  type TerrainField,
} from '@pascal-app/core'
import { RIVER_KIND, type RiverNode } from '../river/schema'
import {
  riverSurfaceInset,
  riverTerrainBaseline,
  sampleRiverPath,
  type SampledRiverPoint,
} from '../river/terrain'
import { roundFact, siteChildrenOfKind } from './scene'
import type { SceneNodes } from './types'

/** The water surface along the course's centreline, as the renderer lays it. */
function waterHeight(point: SampledRiverPoint, river: RiverNode): number {
  return point[1] - riverSurfaceInset(river.depth)
}

/** Metres of course along which the water climbs, walking downstream. */
function climbingLength(points: readonly SampledRiverPoint[], river: RiverNode): number {
  let climbing = 0
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]
    const to = points[index]
    if (!from || !to) continue
    if (waterHeight(to, river) > waterHeight(from, river) + 1e-9) {
      climbing += Math.hypot(to[0] - from[0], to[2] - from[2])
    }
  }
  return climbing
}

/**
 * One river's course facts from the samples the carver and the renderer share: the course runs
 * past the authored points where a mountain source or a sea outlet extends it to the lot edge.
 * Water elevations are the centreline surface; bed elevations the carved, persisted ground.
 */
function riverCourseFacts(
  river: RiverNode,
  site: SiteNode,
  baseline: TerrainField,
  carved: TerrainField,
): Record<string, unknown> | null {
  const path = sampleRiverPath(baseline, river, site.polygon.points)
  if (!path) return null
  const downstream = river.flowDirection === 'reverse' ? [...path.points].reverse() : [...path.points]
  const first = downstream[0]
  const last = downstream[downstream.length - 1]
  if (!first || !last) return null
  const endFacts = (point: SampledRiverPoint) => ({
    atM: [roundFact(point[0]), roundFact(point[2])],
    waterM: roundFact(waterHeight(point, river)),
    bedM: roundFact(surfaceHeightAt(carved, point[0], point[2])),
  })
  return {
    lengthM: roundFact(path.length),
    start: endFacts(first),
    end: endFacts(last),
    dropM: roundFact(waterHeight(first, river) - waterHeight(last, river)),
    risesM: roundFact(climbingLength(downstream, river)),
  }
}

/** Every river of the site; one the persisted terrain does not carry yet reads `drawn: false`. */
export function riverFacts(nodes: SceneNodes, site: SiteNode): Record<string, unknown>[] {
  const carved = persistedTerrainFieldOf(site)
  const baseline = riverTerrainBaseline(site) ?? carved
  return siteChildrenOfKind<RiverNode>(nodes, String(site.id), RIVER_KIND).map((river) => {
    const course = baseline && carved ? riverCourseFacts(river, site, baseline, carved) : null
    return {
      id: String(river.id),
      widthM: river.width,
      depthM: river.depth,
      flow: river.flowDirection,
      drawn: course !== null,
      ...course,
    }
  })
}
