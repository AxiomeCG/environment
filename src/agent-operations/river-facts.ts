import {
  persistedTerrainFieldOf,
  surfaceHeightAt,
  type SiteNode,
  type TerrainField,
} from '@pascal-app/core'
import { RIVER_KIND, type RiverNode } from '../river/schema'
import {
  planRiver,
  RIVER_WATER_CLEARANCE,
  riverRunsFromStart,
  riverSourceTerrain,
  riverWaterSourceHeight,
  type RiverPlan,
  type RiverPlanSample,
  type SampledRiverPoint,
} from '../river/terrain'
import { polylineMeetsPolygon, roundFact, siteChildrenOfKind } from './scene'
import type { PlanPoint, SceneNodes } from './types'

/** One station of a planned course: where it is, and what the planner decided there. */
type CourseStation = Readonly<{ point: SampledRiverPoint; sample: RiverPlanSample }>

/** The plan's stations in the order the water runs. */
function downstreamStations(river: RiverNode, plan: RiverPlan): CourseStation[] {
  const stations = plan.path.points.flatMap((point, index) => {
    const sample = plan.samples[index]
    return sample ? [{ point, sample }] : []
  })
  return riverRunsFromStart(river, plan) ? stations : stations.reverse()
}

/** Which way the water runs along the authored points: solved for a downhill river. */
function flowOf(river: RiverNode, plan: RiverPlan | null): 'forward' | 'reverse' {
  if (!plan) return river.flowDirection
  return riverRunsFromStart(river, plan) ? 'forward' : 'reverse'
}

/** The water surface over a station's centreline, exactly as the river renderer lays it. */
function waterHeight(river: RiverNode, station: CourseStation, source: TerrainField): number {
  const [x, , z] = station.point
  return riverWaterSourceHeight(river, station.sample, source, x, z) + RIVER_WATER_CLEARANCE
}

/** Metres of course along which the water climbs, walking downstream. */
function climbingLength(
  stations: readonly CourseStation[],
  water: (station: CourseStation) => number,
): number {
  let climbing = 0
  for (let index = 1; index < stations.length; index += 1) {
    const from = stations[index - 1]
    const to = stations[index]
    if (!from || !to) continue
    if (water(to) > water(from) + 1e-9) {
      climbing += Math.hypot(to.point[0] - from.point[0], to.point[2] - from.point[2])
    }
  }
  return climbing
}

/**
 * One river's course facts from the plan the carver and the renderer share: the course runs past
 * the authored points where a mountain source or a sea outlet extends it to the lot edge. Water
 * elevations are the drawn surface; bed elevations the carved, persisted ground.
 */
function riverCourseFacts(
  river: RiverNode,
  plan: RiverPlan,
  source: TerrainField,
  carved: TerrainField,
): Record<string, unknown> | null {
  const downstream = downstreamStations(river, plan)
  const first = downstream[0]
  const last = downstream.at(-1)
  if (!first || !last) return null
  const water = (station: CourseStation) => waterHeight(river, station, source)
  const endFacts = (station: CourseStation) => ({
    atM: [roundFact(station.point[0]), roundFact(station.point[2])],
    waterM: roundFact(water(station)),
    bedM: roundFact(surfaceHeightAt(carved, station.point[0], station.point[2])),
  })
  return {
    lengthM: roundFact(plan.path.length),
    start: endFacts(first),
    end: endFacts(last),
    dropM: roundFact(water(first) - water(last)),
    risesM: roundFact(climbingLength(downstream, water)),
  }
}

/**
 * The site's rivers whose centreline passes through `area`, each with the facts of its whole
 * course. One the persisted terrain does not carry yet reads `drawn: false`; so does one the
 * planner refuses, with the reason in `notBuilt`.
 */
export function riverFacts(
  nodes: SceneNodes,
  site: SiteNode,
  area: readonly PlanPoint[],
): Record<string, unknown>[] {
  const carved = persistedTerrainFieldOf(site)
  const source = riverSourceTerrain(site)
  return siteChildrenOfKind<RiverNode>(nodes, String(site.id), RIVER_KIND).flatMap((river) => {
    const plan = planRiver(source, river, site.polygon.points)
    const line: PlanPoint[] = plan
      ? plan.path.points.map((point): PlanPoint => [point[0], point[2]])
      : river.points.map((point): PlanPoint => [point[0], point[1]])
    if (!polylineMeetsPolygon(line, area)) return []
    const built = plan && !plan.refusal ? plan : null
    const course = built && carved ? riverCourseFacts(river, built, source, carved) : null
    return [
      {
        id: String(river.id),
        widthM: river.width,
        depthM: river.depth,
        flow: flowOf(river, plan),
        waterProfile: river.flow,
        drawn: course !== null,
        ...(plan?.refusal ? { notBuilt: plan.refusal.message } : {}),
        ...course,
      },
    ]
  })
}
