import { generateId, type AnyNode, type SiteNode, type TerrainField } from '@pascal-app/core'
import { siteBounds } from '../ground-cover/paint-field'
import { analyzePondBasin, buildPondSurface, type PondBasin, type PondSurface } from '../pond/basin'
import { connectedPondsForBasin, mergedProps, preferredPond } from '../pond/connectivity'
import { MAX_POND_PROPS, pondPropFitsSurface, renderablePondProps } from '../pond/prop-fit'
import {
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
  siteTerrainOf,
  terrainReliefOver,
} from './scene'
import type { AgentOperation, PlanPoint, SceneChanges, SceneNodes } from './types'

export type FillPondInput = {
  at: readonly number[]
  level?: number | 'spill' | 'empty'
  quality?: WaterQuality
  bank?: PondShoreline
  koi?: number
  lilies?: number
}

const MIN_KOI_DEPTH = 0.2

/** The pond records one body of water spans, and the one that speaks for it. */
type Water = { primary: PondNodeValue | null; connected: PondNodeValue[]; merged: PondNodeValue[] }

function requirePointOnLot(value: FillPondInput['at'], sitePolygon: PlanPoint[]): PlanPoint {
  const at = asPoint(value)
  if (!at) refuse('invalid_point', '`at` must be an [x, z] point in metres.')
  if (!pointInPolygon(at[0], at[1], sitePolygon)) {
    refuse('outside_property', `The point [${at[0]}, ${at[1]}] is outside the lot.`, {
      atM: [at[0], at[1]],
    })
  }
  return at
}

/**
 * The site's ground, refused when none of it on the lot can hold water. The relief is read on
 * the lot, through the field: tiled ground has no dense buffer to scan, and ground the lot does
 * not own holds no pond.
 */
function requireTerrain(site: SiteNode, nodes: SceneNodes, sitePolygon: PlanPoint[]): TerrainField {
  const terrain = siteTerrainOf(site, nodes)
  if (!terrain) {
    refuse('no_terrain', 'This site has no persisted terrain, so nothing can hold water.')
  }
  const relief = terrainReliefOver(terrain, siteBounds(sitePolygon))
  if (!relief || relief.maxM <= relief.minM) {
    refuse('no_terrain', 'The ground is flat, so nothing can hold water.')
  }
  return terrain
}

function requireBasin(terrain: TerrainField, sitePolygon: PlanPoint[], at: PlanPoint): PondBasin {
  const basin = analyzePondBasin(terrain, sitePolygon, at)
  if (!basin) {
    refuse('no_hollow', 'That point drains off the lot; no hollow there can hold water.', {
      atM: [at[0], at[1]],
    })
  }
  return basin
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

function maxDepthAt(basin: PondBasin, level: number | null): number {
  return level === null ? 0 : Math.max(0, level - basin.bottomLevel)
}

function refuseImpossibleStocking(
  basin: PondBasin,
  level: number | null,
  input: FillPondInput,
): void {
  const maxDepthM = maxDepthAt(basin, level)
  if ((input.koi ?? 0) > 0 && maxDepthM < MIN_KOI_DEPTH) {
    refuse('too_shallow_for_koi', `Koi need at least ${MIN_KOI_DEPTH} m of water depth.`, {
      maxDepthM: roundFact(maxDepthM),
      minKoiDepthM: MIN_KOI_DEPTH,
    })
  }
  if (level === null && (input.lilies ?? 0) > 0) {
    refuse('pond_empty', 'Lilies need water; this call empties the pond.')
  }
}

/**
 * The water this call changes, targeted as the panel targets it: the hollow's pond (the one its
 * water already reaches, highest first), then every pond the new level joins to it.
 */
function targetWater(
  nodes: SceneNodes,
  siteId: string,
  basin: PondBasin,
  level: number | null,
): Water {
  const targeted = preferredPond(connectedPondsForBasin(nodes, siteId, basin, null), null)
  const preferredId = targeted ? String(targeted.id) : null
  const connected = connectedPondsForBasin(nodes, siteId, basin, preferredId, level)
  const primary = preferredPond(connected, preferredId)
  return {
    primary,
    connected,
    merged: primary ? connected.filter((pond) => pond.id !== primary.id) : [],
  }
}

/** New props of one kind, seeded, each accepted only where the renderer would show it. */
function placeProps(
  surface: PondSurface,
  kind: PondProp['kind'],
  wanted: number,
  existing: readonly PondProp[],
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
  for (const { point } of candidates) {
    if (placed.length >= wanted) break
    const [x, z] = point
    if (taken.some((other) => Math.hypot(other[0] - x, other[1] - z) < separation)) continue
    const prop: PondProp = {
      id: generateId('pond-prop'),
      kind,
      position: [x, z],
      yaw: hash01(3, x, z) * Math.PI * 2,
      scale: 1,
    }
    if (!pondPropFitsSurface(surface, prop)) continue
    taken.push(point)
    placed.push(prop)
  }
  return placed
}

/**
 * Props of one kind until the renderer shows `wanted` of them: extra shown ones go, missing ones
 * are placed. Props the water no longer reaches are kept, as the panel keeps them.
 */
function withShownCount(
  props: PondProp[],
  kind: PondProp['kind'],
  wanted: number | undefined,
  surface: PondSurface,
  seed: PlanPoint,
): PondProp[] {
  if (wanted === undefined) return props
  const shown = renderablePondProps(props, surface).filter((prop) => prop.kind === kind)
  if (shown.length > wanted) {
    const dropped = new Set(shown.slice(wanted).map((prop) => prop.id))
    return props.filter((prop) => !dropped.has(prop.id))
  }
  const placed = placeProps(surface, kind, wanted - shown.length, props, seed)
  return [...props, ...placed].slice(0, MAX_POND_PROPS)
}

function stockProps(
  water: Water,
  input: FillPondInput,
  surface: PondSurface,
  seed: PlanPoint,
): PondProp[] {
  let props = water.primary ? mergedProps(water.primary, water.connected) : []
  props = withShownCount(props, 'koi', input.koi, surface, seed)
  return withShownCount(props, 'water-lily', input.lilies, surface, seed)
}

/**
 * The pond write: the primary record updated, seeded in this hollow as the panel seeds it, with
 * the connected ones merged into it; or a new pond. The stored pond is then this basin's water.
 */
function pondChanges(
  site: SiteNode,
  basin: PondBasin,
  water: Water,
  level: number | null,
  props: PondProp[],
  input: FillPondInput,
): { pondId: string; changes: SceneChanges } {
  if (water.primary) {
    const pondId = String(water.primary.id)
    const data = {
      seed: [basin.seed[0], basin.seed[1]],
      waterLevel: level,
      props,
      ...(input.quality ? { quality: input.quality } : {}),
      ...(input.bank ? { shoreline: input.bank } : {}),
    }
    return {
      pondId,
      changes: {
        update: [{ id: pondId, data: data as Partial<AnyNode> }],
        ...(water.merged.length > 0 ? { delete: water.merged.map((pond) => String(pond.id)) } : {}),
      },
    }
  }
  const pond = PondNode.parse({
    parentId: site.id,
    seed: [basin.seed[0], basin.seed[1]],
    waterLevel: level,
    quality: input.quality ?? 'clear',
    shoreline: input.bank ?? 'soft',
    props,
  })
  return {
    pondId: String(pond.id),
    changes: { create: [{ node: pond as unknown as AnyNode, parentId: String(site.id) }] },
  }
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

export const fillPond: AgentOperation<FillPondInput> = (nodes, input) => {
  const site = requireSite(nodes)
  const sitePolygon = requireSitePolygon(site)
  const at = requirePointOnLot(input.at, sitePolygon)
  const basin = requireBasin(requireTerrain(site, nodes, sitePolygon), sitePolygon, at)
  const level = resolveLevel(basin, input.level)
  refuseImpossibleStocking(basin, level, input)
  const water = targetWater(nodes, String(site.id), basin, level)
  if (!water.primary && level === null) {
    refuse('no_pond', 'There is no pond in this hollow to empty.', { atM: [at[0], at[1]] })
  }
  const surface = buildPondSurface(basin, level)
  const props = stockProps(water, input, surface, basin.seed)
  const shown = renderablePondProps(props, surface)
  const shownKoi = shown.filter((prop) => prop.kind === 'koi').length
  if ((input.koi ?? 0) > 0 && shownKoi === 0) {
    refuse('too_shallow_for_koi', 'No spot in this pond is deep and wide enough for a koi.', {
      maxDepthM: roundFact(maxDepthAt(basin, level)),
      minKoiDepthM: MIN_KOI_DEPTH,
    })
  }
  const { pondId, changes } = pondChanges(site, basin, water, level, props, input)
  return {
    result: {
      pondId,
      created: water.primary === null,
      levelM: level === null ? null : roundFact(level),
      spillLevelM: roundFact(basin.spillLevel),
      bottomM: roundFact(basin.bottomLevel),
      maxDepthM: roundFact(maxDepthAt(basin, level)),
      areaM2: roundFact(surface.area),
      perimeterM: roundFact(surfacePerimeterM(surface)),
      koi: shownKoi,
      lilies: shown.length - shownKoi,
      hiddenProps: props.length - shown.length,
      mergedPondIds: water.merged.map((pond) => String(pond.id)),
    },
    changes,
  }
}
