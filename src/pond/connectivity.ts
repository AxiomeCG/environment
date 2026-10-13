import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { buildPondSurface, pondSurfaceDepthAt, type PondBasin } from './basin'
import { MAX_KOI, MAX_POND_PROPS } from './prop-fit'
import { POND_KIND, type PondNode, type PondProp } from './schema'

// Which pond records share one body of water, and which of them speaks for it: the targeting the
// panel and the agent both use, so a pond tool and `fill_pond` change the same records.

const WET_EPSILON = 1e-4

type SceneNodes = Readonly<Record<AnyNodeId, AnyNode>>

function sitePonds(nodes: SceneNodes, siteId: string): PondNode[] {
  const ponds: PondNode[] = []
  for (const node of Object.values(nodes)) {
    if ((node?.type as string) === POND_KIND && String(node.parentId) === siteId) {
      ponds.push(node as unknown as PondNode)
    }
  }
  return ponds
}

/**
 * The ponds of the basin's body of water: each candidate joins when the water, at the highest of
 * the levels joined so far and its own, reaches its seed. `startingLevel` is a level about to be
 * set, which can join ponds the current water does not reach.
 */
export function connectedPondsForBasin(
  nodes: SceneNodes,
  siteId: string,
  basin: PondBasin,
  preferredId: string | null,
  startingLevel: number | null = null,
): PondNode[] {
  const candidates = sitePonds(nodes, siteId)
  const preferred = preferredId
    ? candidates.find((pond) => String(pond.id) === preferredId)
    : undefined
  const connected = preferred ? [preferred] : []
  const connectedIds = new Set(connected.map((pond) => String(pond.id)))
  let connectedLevel = startingLevel
  if (
    preferred?.waterLevel !== null &&
    preferred?.waterLevel !== undefined &&
    (connectedLevel === null || preferred.waterLevel > connectedLevel)
  ) {
    connectedLevel = preferred.waterLevel
  }

  let added = true
  while (added) {
    added = false
    for (const pond of candidates) {
      if (connectedIds.has(String(pond.id))) continue
      let connectionLevel = connectedLevel
      if (
        pond.waterLevel !== null &&
        (connectionLevel === null || pond.waterLevel > connectionLevel)
      ) {
        connectionLevel = pond.waterLevel
      }
      if (connectionLevel === null && connected.length === 0) {
        connectionLevel = basin.levels[0] ?? null
      }
      if (connectionLevel === null) continue
      const surface = buildPondSurface(basin, connectionLevel)
      if (pondSurfaceDepthAt(surface, pond.seed[0], pond.seed[1]) <= WET_EPSILON) continue
      connected.push(pond)
      connectedIds.add(String(pond.id))
      connectedLevel = connectionLevel
      added = true
    }
  }
  return connected
}

/** The record that speaks for connected ponds: the preferred one, else the highest water. */
export function preferredPond(
  ponds: readonly PondNode[],
  preferredId: string | null,
): PondNode | null {
  const preferred = preferredId ? ponds.find((pond) => pond.id === preferredId) : undefined
  if (preferred) return preferred
  let result: PondNode | null = null
  let resultLevel = Number.NEGATIVE_INFINITY
  for (const pond of ponds) {
    const level = pond.waterLevel ?? Number.NEGATIVE_INFINITY
    if (!result || level > resultLevel) {
      result = pond
      resultLevel = level
    }
  }
  return result
}

export function effectiveLevel(ponds: readonly PondNode[]): number | null {
  let level: number | null = null
  for (const pond of ponds) {
    if (pond.waterLevel !== null && (level === null || pond.waterLevel > level)) {
      level = pond.waterLevel
    }
  }
  return level
}

/** Every prop of the connected ponds, the primary's first, without repeats or excess koi. */
export function mergedProps(primary: PondNode, ponds: readonly PondNode[]): PondProp[] {
  const result: PondProp[] = []
  const ids = new Set<string>()
  let koi = 0
  const ordered = [primary, ...ponds.filter((pond) => pond.id !== primary.id)]
  for (const pond of ordered) {
    for (const prop of pond.props) {
      if (result.length >= MAX_POND_PROPS || ids.has(prop.id)) continue
      if (prop.kind === 'koi' && koi >= MAX_KOI) continue
      ids.add(prop.id)
      result.push(prop)
      if (prop.kind === 'koi') koi += 1
    }
  }
  return result
}
