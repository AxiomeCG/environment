import {
  generateId,
  persistedTerrainFieldOf,
  type AnyNode,
  type SiteNode,
  type TerrainField,
} from '@pascal-app/core'
import {
  analyzePondBasin,
  buildPondSurface,
  pondSurfaceDepthAt,
  type PondBasin,
  type PondSurface,
} from '../pond/basin'
import {
  POND_KIND,
  PondNode,
  type PondNode as PondNodeValue,
  type PondProp,
  type PondShoreline,
  type WaterQuality,
} from '../pond/schema'
import { refuse } from './refuse'
import {
  asPoint,
  hash01,
  pointInPolygon,
  requireSite,
  requireSitePolygon,
  roundFact,
  siteChildrenOfKind,
} from './scene'
import type { AgentOperation, PlanPoint, SceneChanges } from './types'

export type FillPondInput = {
  at: readonly number[]
  level?: number | 'spill' | 'empty'
  quality?: WaterQuality
  bank?: PondShoreline
  koi?: number
  lilies?: number
}

const MAX_POND_PROPS = 128
const MAX_KOI = 32
const MIN_KOI_DEPTH = 0.2
const MIN_LILY_DEPTH = 0.015
const WET_EPSILON = 1e-4

function requireTerrain(site: SiteNode): TerrainField {
  const terrain = persistedTerrainFieldOf(site)
  if (!terrain) {
    refuse('no_terrain', 'This site has no persisted terrain, so nothing can hold water.')
  }
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const height of terrain.heights) {
    if (height < min) min = height
    if (height > max) max = height
  }
  if (max <= min) refuse('no_terrain', 'The ground is flat, so nothing can hold water.')
  return terrain
}

function resolveLevel(basin: PondBasin, level: FillPondInput['level']): number | null {
  if (level === 'empty') return null
  if (level === undefined || level === 'spill') return basin.spillLevel
  if (level > basin.spillLevel + 1e-9) {
    refuse('level_above_spill', `Water at ${level} m would spill out of this hollow.`, {
      spillLevelM: roundFact(basin.spillLevel),
      bottomM: roundFact(basin.bottomLevel),
    })
  }
  if (level <= basin.bottomLevel + 1e-9) {
    refuse('level_below_bottom', `Water at ${level} m is at or below the hollow's bottom.`, {
      bottomM: roundFact(basin.bottomLevel),
      spillLevelM: roundFact(basin.spillLevel),
    })
  }
  let nearest = basin.spillLevel
  for (const candidate of basin.levels) {
    if (Math.abs(candidate - level) < Math.abs(nearest - level)) nearest = candidate
  }
  return nearest
}

/** Ponds whose seed is wet once this basin holds water, widening as higher ponds join (as the panel merges). */
function connectedPonds(
  candidates: PondNodeValue[],
  basin: PondBasin,
  targetLevel: number | null,
): PondNodeValue[] {
  const connected: PondNodeValue[] = []
  const connectedIds = new Set<string>()
  let connectionLevel =
    targetLevel ??
    candidates.reduce<number | null>(
      (best, pond) =>
        pond.waterLevel !== null && (best === null || pond.waterLevel > best)
          ? pond.waterLevel
          : best,
      null,
    ) ??
    basin.levels[0] ??
    null
  let added = true
  while (added && connectionLevel !== null) {
    added = false
    const surface = buildPondSurface(basin, connectionLevel)
    for (const pond of candidates) {
      if (connectedIds.has(String(pond.id))) continue
      if (pondSurfaceDepthAt(surface, pond.seed[0], pond.seed[1]) <= WET_EPSILON) continue
      connected.push(pond)
      connectedIds.add(String(pond.id))
      if (pond.waterLevel !== null && pond.waterLevel > connectionLevel) {
        connectionLevel = pond.waterLevel
      }
      added = true
    }
  }
  return connected
}

function preferredPond(ponds: PondNodeValue[]): PondNodeValue | null {
  let best: PondNodeValue | null = null
  for (const pond of ponds) {
    if (!best) {
      best = pond
      continue
    }
    const level = pond.waterLevel ?? Number.NEGATIVE_INFINITY
    const bestLevel = best.waterLevel ?? Number.NEGATIVE_INFINITY
    if (level > bestLevel || (level === bestLevel && String(pond.id) < String(best.id))) {
      best = pond
    }
  }
  return best
}

function mergedProps(primary: PondNodeValue, ponds: PondNodeValue[]): PondProp[] {
  const result: PondProp[] = []
  const seen = new Set<string>()
  let koi = 0
  const ordered = [primary, ...ponds.filter((pond) => pond.id !== primary.id)]
  for (const pond of ordered) {
    for (const prop of pond.props) {
      if (result.length >= MAX_POND_PROPS || seen.has(prop.id)) continue
      if (prop.kind === 'koi' && koi >= MAX_KOI) continue
      seen.add(prop.id)
      result.push(prop)
      if (prop.kind === 'koi') koi += 1
    }
  }
  return result
}

/** Boundary length of the wet triangles: edges bordering exactly one triangle. */
function surfacePerimeterM(surface: PondSurface): number {
  const edges = new Map<string, { count: number; length: number }>()
  const pointKey = (x: number, z: number) => `${Math.round(x * 1e6)}:${Math.round(z * 1e6)}`
  for (let offset = 0; offset + 8 < surface.positions.length; offset += 9) {
    const points: [number, number][] = []
    for (let vertex = 0; vertex < 3; vertex += 1) {
      points.push([
        surface.positions[offset + vertex * 3] ?? 0,
        surface.positions[offset + vertex * 3 + 2] ?? 0,
      ])
    }
    for (let edge = 0; edge < 3; edge += 1) {
      const first = points[edge]
      const second = points[(edge + 1) % 3]
      if (!first || !second) continue
      const key = [pointKey(first[0], first[1]), pointKey(second[0], second[1])].sort().join('|')
      const entry = edges.get(key) ?? {
        count: 0,
        length: Math.hypot(second[0] - first[0], second[1] - first[1]),
      }
      entry.count += 1
      edges.set(key, entry)
    }
  }
  let perimeter = 0
  for (const entry of edges.values()) if (entry.count === 1) perimeter += entry.length
  return perimeter
}

function propFits(surface: PondSurface, kind: PondProp['kind'], x: number, z: number): boolean {
  const depth = pondSurfaceDepthAt(surface, x, z)
  if (depth < (kind === 'koi' ? MIN_KOI_DEPTH : MIN_LILY_DEPTH)) return false
  const radius = kind === 'koi' ? 0.3 : 0.25
  for (let step = 0; step < 8; step += 1) {
    const angle = (step / 8) * Math.PI * 2
    if (pondSurfaceDepthAt(surface, x + Math.cos(angle) * radius, z + Math.sin(angle) * radius) <= 0) {
      return false
    }
  }
  return true
}

/** Seeded placements inside the wet surface: shuffled triangle centroids, kept apart. */
function placeProps(
  surface: PondSurface,
  kind: PondProp['kind'],
  wanted: number,
  existing: PondProp[],
  seed: PlanPoint,
): PondProp[] {
  if (wanted <= 0) return []
  const separation = kind === 'koi' ? 0.8 : 0.5
  const taken: PlanPoint[] = existing.map((prop) => prop.position)
  const candidates: { point: PlanPoint; rank: number }[] = []
  for (let offset = 0; offset + 8 < surface.positions.length; offset += 9) {
    let x = 0
    let z = 0
    for (let vertex = 0; vertex < 3; vertex += 1) {
      x += (surface.positions[offset + vertex * 3] ?? 0) / 3
      z += (surface.positions[offset + vertex * 3 + 2] ?? 0) / 3
    }
    candidates.push({
      point: [x, z],
      rank: hash01(kind === 'koi' ? 1 : 2, x + seed[0], z + seed[1]),
    })
  }
  candidates.sort((a, b) => a.rank - b.rank)
  const placed: PondProp[] = []
  for (const candidate of candidates) {
    if (placed.length >= wanted) break
    const [x, z] = candidate.point
    if (taken.some((point) => Math.hypot(point[0] - x, point[1] - z) < separation)) continue
    if (!propFits(surface, kind, x, z)) continue
    taken.push(candidate.point)
    placed.push({
      id: generateId('pond-prop'),
      kind,
      position: [x, z],
      yaw: hash01(3, x, z) * Math.PI * 2,
      scale: 1,
    })
  }
  return placed
}

function withPropCounts(
  props: PondProp[],
  kind: PondProp['kind'],
  wanted: number | undefined,
  surface: PondSurface,
  seed: PlanPoint,
): PondProp[] {
  if (wanted === undefined) return props
  const ofKind = props.filter((prop) => prop.kind === kind)
  const others = props.filter((prop) => prop.kind !== kind)
  if (ofKind.length > wanted) return [...others, ...ofKind.slice(0, wanted)]
  if (ofKind.length === wanted) return props
  const placed = placeProps(surface, kind, wanted - ofKind.length, props, seed)
  return [...props, ...placed].slice(0, MAX_POND_PROPS)
}

export const fillPond: AgentOperation<FillPondInput> = (nodes, input) => {
  const site = requireSite(nodes)
  const sitePolygon = requireSitePolygon(site)
  const at = asPoint(input.at)
  if (!at) refuse('invalid_point', '`at` must be an [x, z] point in metres.')
  if (!pointInPolygon(at[0], at[1], sitePolygon)) {
    refuse('outside_property', `The point [${at[0]}, ${at[1]}] is outside the lot.`, {
      atM: [at[0], at[1]],
    })
  }
  const terrain = requireTerrain(site)
  const basin = analyzePondBasin(terrain, sitePolygon, at)
  if (!basin) {
    refuse('no_hollow', 'That point drains off the lot; no hollow there can hold water.', {
      atM: [at[0], at[1]],
    })
  }
  const level = resolveLevel(basin, input.level)
  const maxDepthM = level === null ? 0 : Math.max(0, level - basin.bottomLevel)
  if ((input.koi ?? 0) > 0 && maxDepthM < MIN_KOI_DEPTH) {
    refuse('too_shallow_for_koi', `Koi need at least ${MIN_KOI_DEPTH} m of water depth.`, {
      maxDepthM: roundFact(maxDepthM),
      minKoiDepthM: MIN_KOI_DEPTH,
    })
  }
  if (level === null && (input.lilies ?? 0) > 0) {
    refuse('pond_empty', 'Lilies need water; this call empties the pond.')
  }

  const candidates = siteChildrenOfKind<PondNodeValue>(nodes, String(site.id), POND_KIND)
  const connected = connectedPonds(candidates, basin, level)
  const primary = preferredPond(connected)
  if (!primary && level === null) {
    refuse('no_pond', 'There is no pond in this hollow to empty.', { atM: [at[0], at[1]] })
  }

  const surface = buildPondSurface(basin, level)
  let props: PondProp[] = primary ? mergedProps(primary, connected) : []
  props = withPropCounts(props, 'koi', input.koi, surface, basin.seed)
  props = withPropCounts(props, 'water-lily', input.lilies, surface, basin.seed)
  if (
    input.koi !== undefined &&
    input.koi > 0 &&
    props.filter((prop) => prop.kind === 'koi').length === 0
  ) {
    refuse('too_shallow_for_koi', 'No spot in this pond is deep and wide enough for a koi.', {
      maxDepthM: roundFact(maxDepthM),
      minKoiDepthM: MIN_KOI_DEPTH,
    })
  }

  const merged = primary ? connected.filter((pond) => pond.id !== primary.id) : []
  const changes: SceneChanges = {}
  let pondId: string
  if (primary) {
    pondId = String(primary.id)
    changes.update = [
      {
        id: pondId,
        data: {
          waterLevel: level,
          props,
          ...(input.quality ? { quality: input.quality } : {}),
          ...(input.bank ? { shoreline: input.bank } : {}),
        } as Partial<AnyNode>,
      },
    ]
    if (merged.length > 0) changes.delete = merged.map((pond) => String(pond.id))
  } else {
    const pond = PondNode.parse({
      parentId: site.id,
      seed: [basin.seed[0], basin.seed[1]],
      waterLevel: level,
      quality: input.quality ?? 'clear',
      shoreline: input.bank ?? 'soft',
      props,
    })
    pondId = String(pond.id)
    changes.create = [{ node: pond as unknown as AnyNode, parentId: String(site.id) }]
  }

  return {
    result: {
      pondId,
      created: primary === null,
      levelM: level === null ? null : roundFact(level),
      spillLevelM: roundFact(basin.spillLevel),
      bottomM: roundFact(basin.bottomLevel),
      maxDepthM: roundFact(maxDepthM),
      areaM2: roundFact(surface.area),
      perimeterM: roundFact(surfacePerimeterM(surface)),
      koi: props.filter((prop) => prop.kind === 'koi').length,
      lilies: props.filter((prop) => prop.kind === 'water-lily').length,
      mergedPondIds: merged.map((pond) => String(pond.id)),
    },
    changes,
  }
}
