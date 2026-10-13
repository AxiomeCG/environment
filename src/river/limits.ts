import type { RiverNode } from './schema'
import { channelsMeetGapM } from './self-overlap'
import { channelStations, SELF_OVERLAP_LEVEL_TOLERANCE_M, type RiverPlan } from './terrain'

/**
 * What the river tool knowingly does not solve yet, measured on a plan so the
 * panel can say so plainly instead of building something that looks solved.
 * Each is deferred work, not a refusal: the river is still built.
 */
export type RiverLimit = Readonly<{
  code: 'unsolved_junction' | 'unembanked_continuation'
  message: string
}>

/** Embankments lower than this are within the water's own inset. */
const EMBANKMENT_NOTICE_M = 0.05

export function riverPlanLimits(
  river: RiverNode,
  plan: RiverPlan,
  siblingPlans: readonly RiverPlan[],
): RiverLimit[] {
  const limits: RiverLimit[] = []
  const junctionGapM = unsolvedJunctionGapM(plan, siblingPlans)
  if (junctionGapM > SELF_OVERLAP_LEVEL_TOLERANCE_M) {
    limits.push({
      code: 'unsolved_junction',
      message: `meets another river at a different water level (${junctionGapM.toFixed(2)} m apart); junctions between rivers are not solved yet.`,
    })
  }
  for (const end of unembankedContinuations(river, plan)) {
    limits.push({
      code: 'unembanked_continuation',
      message: `outside the Site the ${end.name} is not embanked; at the boundary its banks stand ${end.embankmentM.toFixed(2)} m above the ground.`,
    })
  }
  return limits
}

/** Largest water-level difference where this river's channel touches another's. */
function unsolvedJunctionGapM(plan: RiverPlan, siblingPlans: readonly RiverPlan[]): number {
  const own = channelStations(plan.path, plan.samples)
  let gapM = 0
  for (const sibling of siblingPlans) {
    if (sibling.refusal) continue
    gapM = Math.max(gapM, channelsMeetGapM(own, channelStations(sibling.path, sibling.samples)))
  }
  return gapM
}

/**
 * Connected ends whose downhill water reaches the boundary on an embankment.
 * The continuation outside the Site follows its own ground and only digs, so
 * nothing holds that water up out there.
 */
function unembankedContinuations(
  river: RiverNode,
  plan: RiverPlan,
): Array<Readonly<{ name: string; embankmentM: number }>> {
  if (river.flow !== 'downhill') return []
  const ends = [
    { name: 'mountain source', connected: river.source === 'mountain', sample: plan.samples[0] },
    { name: 'sea outlet', connected: river.outlet === 'sea', sample: plan.samples.at(-1) },
  ]
  return ends.flatMap(({ name, connected, sample }) =>
    connected && sample && sample.embankmentM > EMBANKMENT_NOTICE_M
      ? [{ name, embankmentM: sample.embankmentM }]
      : [],
  )
}
