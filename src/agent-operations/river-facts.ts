import {
  persistedTerrainFieldOf,
  surfaceHeightAt,
  type SiteNode,
  type TerrainField,
} from '@pascal-app/core'
import { RIVER_KIND, type RiverNode } from '../river/schema'
import {
  RIVER_WATER_CLEARANCE,
  riverTerrainBaseline,
  riverWaterSourceHeight,
  sampleRiverPath,
  type SampledRiverPath,
  type SampledRiverPoint,
} from '../river/terrain'
import { polylineMeetsPolygon, roundFact, siteChildrenOfKind } from './scene'
import type { PlanPoint, SceneNodes } from './types'

/** The water surface over a centreline sample, as the river renderer lays it. */
function waterHeight(point: SampledRiverPoint, river: RiverNode, baseline: TerrainField): number {
  return riverWaterSourceHeight(point, river, baseline, point[0], point[2]) + RIVER_WATER_CLEARANCE
}

/** Metres of course along which the water climbs, walking downstream. */
function climbingLength(
  points: readonly SampledRiverPoint[],
  river: RiverNode,
  baseline: TerrainField,
): number {
  let climbing = 0
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]
    const to = points[index]
    if (!from || !to) continue
    if (waterHeight(to, river, baseline) > waterHeight(from, river, baseline) + 1e-9) {
      climbing += Math.hypot(to[0] - from[0], to[2] - from[2])
    }
  }
  return climbing
}

/**
 * One river's course facts from the samples the carver and the renderer share: the course runs
 * past the authored points where a mountain source or a sea outlet extends it to the lot edge.
 * Water elevations are the drawn surface; bed elevations the carved, persisted ground.
 */
function riverCourseFacts(
  river: RiverNode,
  path: SampledRiverPath,
  baseline: TerrainField,
  carved: TerrainField,
): Record<string, unknown> | null {
  const downstream =
    river.flowDirection === 'reverse' ? [...path.points].reverse() : [...path.points]
  const first = downstream[0]
  const last = downstream[downstream.length - 1]
  if (!first || !last) return null
  const endFacts = (point: SampledRiverPoint) => ({
    atM: [roundFact(point[0]), roundFact(point[2])],
    waterM: roundFact(waterHeight(point, river, baseline)),
    bedM: roundFact(surfaceHeightAt(carved, point[0], point[2])),
  })
  return {
    lengthM: roundFact(path.length),
    start: endFacts(first),
    end: endFacts(last),
    dropM: roundFact(waterHeight(first, river, baseline) - waterHeight(last, river, baseline)),
    risesM: roundFact(climbingLength(downstream, river, baseline)),
  }
}

/**
 * The site's rivers whose centreline passes through `area`, each with the facts of its whole
 * course. One the persisted terrain does not carry yet reads `drawn: false`, by its authored line.
 */
export function riverFacts(
  nodes: SceneNodes,
  site: SiteNode,
  area: readonly PlanPoint[],
): Record<string, unknown>[] {
  const carved = persistedTerrainFieldOf(site)
  const baseline = riverTerrainBaseline(site) ?? carved
  return siteChildrenOfKind<RiverNode>(nodes, String(site.id), RIVER_KIND).flatMap((river) => {
    const path = baseline ? sampleRiverPath(baseline, river, site.polygon.points) : null
    const line: PlanPoint[] = path
      ? path.points.map((point): PlanPoint => [point[0], point[2]])
      : river.points.map((point): PlanPoint => [point[0], point[1]])
    if (!polylineMeetsPolygon(line, area)) return []
    const course =
      path && baseline && carved ? riverCourseFacts(river, path, baseline, carved) : null
    return [
      {
        id: String(river.id),
        widthM: river.width,
        depthM: river.depth,
        flow: river.flowDirection,
        drawn: course !== null,
        ...course,
      },
    ]
  })
}
