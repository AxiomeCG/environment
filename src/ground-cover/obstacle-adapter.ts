import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  type FloorPlacedConfig,
  getFloorPlacedFootprints,
  getLevelElevations,
  getWallThickness,
  type GeometryContext,
  nodeRegistry,
  sampleWallCenterline,
  type LevelNode,
  type SiteNode,
  type SlabNode,
  type TerrainField,
  type WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import { resolvePond } from '../pond/geometry'
import { POND_KIND, type PondNode } from '../pond/schema'
import { resolveRiver } from '../river/geometry'
import { RIVER_KIND, type RiverNode } from '../river/schema'
import { sitesWithChangedTerrainNodes } from '../terrain-nodes'
import type { GrassPaintField } from './paint-field'
import {
  createGrassObstacleField,
  type GrassObstacleField,
  type GrassObstacleShape,
} from './obstacle-field'

const CURVED_WALL_SEGMENTS = 24
/** The words core's usage field files foliage under (`spatial/usage-field/pieces.ts`). */
const FOLIAGE_WORDS = /plant|palm|foliage|tree|shrub|hedge|grass|fern|flower|bouquet|vase of|landscape/i
/** From this height (m) a plant's box is its crown, not what it has on the ground. */
const TALL_FOLIAGE_HEIGHT = 2
/** Grass stands in the lowest half metre: only what an object has there clears it. */
const GRASS_REACH = 0.5
/** A pose turned about a horizontal axis has no plan outline to read (core reads its box too). */
const TILT_EPSILON = 1e-9
/**
 * Core kinds that are built on the ground yet leave floor collision off (it is about furniture
 * placement): steps declare a footprint, a rock and a ramp carry their outline in the Site's frame.
 */
const STEPS_KIND = 'stair'
const ROCK_KIND = 'rock'
const RAMP_KIND = 'ramp'
const RAMP_ARC_STEP = Math.PI / 18

type SiteTransform = {
  readonly x: number
  readonly z: number
  readonly rotation: number
}

const IDENTITY_TRANSFORM: SiteTransform = { x: 0, z: 0, rotation: 0 }

/**
 * `ground` is the terrain the site's water stands on, for a caller that reads a node snapshot
 * (an agent operation); omitted, water is resolved on the Site's live field, as it is drawn.
 */
export function buildGrassObstacleField(
  site: SiteNode,
  nodes: Readonly<Record<string, AnyNode>>,
  topology: Pick<GrassPaintField, 'origin' | 'spacing' | 'cols' | 'rows'>,
  ground?: TerrainField | null,
): GrassObstacleField {
  return createGrassObstacleField(topology, collectGrassObstacleShapes(site, nodes, ground))
}

/**
 * The ground other nodes own, without Environment's own water: where the painted Surface is not
 * drawn either (it would lie as a lid over a pool cut into the lot), while a pond keeps its bed.
 */
export function buildGroundOwnerField(
  site: SiteNode,
  nodes: Readonly<Record<string, AnyNode>>,
  topology: Pick<GrassPaintField, 'origin' | 'spacing' | 'cols' | 'rows'>,
): GrassObstacleField {
  return createGrassObstacleField(topology, collectGroundOwnerShapes(site, nodes))
}

export function collectGrassObstacleShapes(
  site: SiteNode,
  nodes: Readonly<Record<string, AnyNode>>,
  ground?: TerrainField | null,
): GrassObstacleShape[] {
  const shapes = collectGroundOwnerShapes(site, nodes)
  const context: GeometryContext = {
    parent: site,
    children: [],
    siblings: directChildren(site, nodes),
    resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
  }
  for (const child of context.siblings) {
    if (child.parentId !== site.id) continue
    const surface =
      (child.type as string) === POND_KIND
        ? resolvePond(child as unknown as PondNode, context, ground)?.surface
        : (child.type as string) === RIVER_KIND
          ? resolveRiver(child as unknown as RiverNode, context, ground)?.surface
          : null
    if (surface?.positions.length) {
      shapes.push({ kind: 'triangles', positions: surface.positions })
    }
  }
  return shapes
}

/** Everything built or standing on the Site's ground: slabs, rooms, walls and ground owners. */
export function collectGroundOwnerShapes(
  site: SiteNode,
  nodes: Readonly<Record<string, AnyNode>>,
): GrassObstacleShape[] {
  const shapes: GrassObstacleShape[] = []
  // Core uses branded ID keys; the runtime scene map is the same complete record.
  const coreNodes = nodes as Record<AnyNodeId, AnyNode>
  const elevations = getLevelElevations(coreNodes)
  const buildings = Object.values(nodes).filter(
    (node): node is BuildingNode =>
      node.type === 'building' && nodeBelongsToSite(node, site.id, nodes),
  )
  const claimedLevelIds = new Set<string>()

  for (const building of buildings) {
    const levels = Object.values(nodes).filter(
      (node): node is LevelNode =>
        node.type === 'level' &&
        (node.parentId === building.id || building.children.some((childId) => childId === node.id)),
    )
    const gradeLevel = levels.reduce<LevelNode | null>((best, level) => {
      if (!best) return level
      const levelDistance = Math.abs(elevations.get(level.id)?.baseY ?? level.level)
      const bestDistance = Math.abs(elevations.get(best.id)?.baseY ?? best.level)
      return levelDistance < bestDistance ? level : best
    }, null)
    if (!gradeLevel) continue

    claimedLevelIds.add(gradeLevel.id)
    collectLevelShapes(
      gradeLevel,
      coreNodes,
      {
        x: building.position[0],
        z: building.position[2],
        rotation: building.rotation[1],
      },
      shapes,
    )
  }

  for (const node of Object.values(nodes)) {
    if (
      node.type !== 'level' ||
      claimedLevelIds.has(node.id) ||
      !nodeBelongsToSite(node, site.id, nodes)
    ) {
      continue
    }
    const parent = node.parentId ? nodes[node.parentId] : undefined
    if (parent?.type === 'building') continue
    collectLevelShapes(node, coreNodes, IDENTITY_TRANSFORM, shapes)
  }

  collectFloorPlacedShapes(directChildren(site, nodes), coreNodes, IDENTITY_TRANSFORM, shapes)
  return shapes
}

export function collectSiteNodes(
  site: SiteNode,
  resolve: (id: AnyNodeId) => AnyNode | undefined,
): Record<string, AnyNode> {
  const collected: Record<string, AnyNode> = { [site.id]: site }
  const pending = [...site.children]
  while (pending.length > 0) {
    const id = pending.pop()
    if (!id || collected[id]) continue
    const node = resolve(id as AnyNodeId)
    if (!node) continue
    collected[node.id] = node
    const children = nodeChildren(node)
    for (const childId of children) pending.push(childId)
  }
  return collected
}

export function siteHasWaterObstacles(
  siteId: string,
  nodes: Readonly<Record<string, AnyNode>>,
): boolean {
  for (const id in nodes) {
    const node = nodes[id]
    if (node?.parentId === siteId && isWaterObstacleNode(node)) return true
  }
  return false
}

function isWaterObstacleNode(node: AnyNode): boolean {
  return (node.type as string) === POND_KIND || (node.type as string) === RIVER_KIND
}

function collectLevelShapes(
  level: AnyNode & { type: 'level' },
  nodes: Record<AnyNodeId, AnyNode>,
  transform: SiteTransform,
  output: GrassObstacleShape[],
): void {
  const children = directChildren(level, nodes)

  for (const child of children) {
    if (child.type === 'slab') {
      const slab = child
      output.push({
        kind: 'polygon',
        points: slab.polygon.map((point) => transformPoint(point, transform)),
        holes: slab.holes.map((hole) => hole.map((point) => transformPoint(point, transform))),
      })
      continue
    }
    if (child.type === 'zone') {
      const zone = child
      if (zone.spaceRole === 'room' && zone.enclosureStatus !== 'open') {
        output.push({
          kind: 'polygon',
          points: zone.polygon.map((point) => transformPoint(point, transform)),
        })
      }
      continue
    }
    if (child.type === 'wall') {
      addWallShapes(child, transform, output)
    }
  }

  collectFloorPlacedShapes(children, nodes, transform, output)
}

function addWallShapes(
  wall: WallNode,
  transform: SiteTransform,
  output: GrassObstacleShape[],
): void {
  const points = sampleWallCenterline(wall, CURVED_WALL_SEGMENTS)
  const radius = getWallThickness(wall) / 2
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    if (!start || !end) continue
    output.push({
      kind: 'capsule',
      start: transformPoint([start.x, start.y], transform),
      end: transformPoint([end.x, end.y], transform),
      radius,
    })
  }
}

/**
 * What stands on the ground among `children` (a grade level's or the Site's), other than slabs,
 * rooms and walls: the lawn's paint, blades and flowers keep off it.
 *
 * A node owns the ground under it when its kind opts into floor collision (solid furniture,
 * columns, a block resting on the floor), when it is built steps, or when it is a node of another
 * plugin that declares a footprint (a pool, a street fixture): floor collision is about placing
 * furniture, and a pool declares none. A rock and a ramp carry their own outline. A plant is not an
 * owner: a tall one clears its trunk, a low one that does not collide (a flower, a tuft) stands in
 * the lawn. Markers of the core with a footprint (a spawn point) own nothing.
 */
function collectFloorPlacedShapes(
  children: readonly AnyNode[],
  nodes: Record<AnyNodeId, AnyNode>,
  transform: SiteTransform,
  output: GrassObstacleShape[],
): void {
  for (const node of children) {
    if (node.type === 'slab' || node.type === 'zone' || node.type === 'wall') continue
    const outline = ownOutline(node, transform)
    if (outline) {
      output.push(...outline)
      continue
    }
    const floorPlaced = nodeRegistry.get(node.type)?.capabilities?.floorPlaced
    if (!floorPlaced || floorPlaced.applies?.(node) === false) continue
    const collides = floorPlacedCollides(floorPlaced, node)
    if (!collides && !isBuiltWithoutCollision(node)) continue

    const footprints = getFloorPlacedFootprints(floorPlaced, node, { nodes })
    const foliage = hasFoliageHint(node)
    if (!foliage) {
      // What the object really has on the ground, when it says so: no name is read.
      const standing =
        footprints.length > 0
          ? (standingOutline(node, transform) ?? footprintOutline(node, footprints, transform))
          : null
      if (standing) {
        output.push(...standing)
        continue
      }
    } else {
      const standing = footprints.length > 0 ? standingOutline(node, transform) : null
      if (standing) {
        output.push(...standing)
        continue
      }
    }
    for (const footprint of footprints) {
      const position = footprint.position ?? nodePosition(node)
      if (!position) continue
      const halfX = Math.abs(footprint.dimensions[0]) / 2
      const halfZ = Math.abs(footprint.dimensions[2]) / 2
      if (halfX <= 0 || halfZ <= 0) continue
      const center = transformPoint([position[0], position[2]], transform)
      const height = footprint.dimensions[1]
      if (foliage && height >= TALL_FOLIAGE_HEIGHT) {
        // A tall plant stands on a trunk: its box is the crown overhead, a square in the lawn.
        output.push({
          kind: 'capsule',
          start: center,
          end: center,
          radius: Math.min(halfX, halfZ, Math.max(0.15, Math.min(0.5, height * 0.04))),
        })
        continue
      }
      // A low plant that blocks no placement stands in the lawn, not on a bare patch.
      if (foliage && !collides) continue
      output.push({
        kind: 'box',
        center,
        halfSize: [halfX, halfZ],
        rotation: transform.rotation + (footprint.rotation[1] ?? 0),
      })
    }
  }
}

/** Core's `floorPlacedCollides`: the flag, or the kind's own predicate for this node. */
function floorPlacedCollides(floorPlaced: FloorPlacedConfig, node: AnyNode): boolean {
  const collides: unknown = floorPlaced.collides
  return typeof collides === 'function' ? collides(node) === true : collides === true
}

/**
 * Built on the ground though its kind leaves floor collision off: steps, and any node of another
 * plugin that declares a footprint. A plugin kind is namespaced (`pool:pool`); the core's are not.
 */
function isBuiltWithoutCollision(node: AnyNode): boolean {
  const kind = String(node.type)
  return kind === STEPS_KIND || (kind.includes(':') && !kind.startsWith('environment:'))
}

function isGroundOwnerKind(node: AnyNode): boolean {
  const kind = String(node.type)
  if (kind === ROCK_KIND || kind === RAMP_KIND) return true
  const floorPlaced = nodeRegistry.get(node.type)?.capabilities?.floorPlaced
  if (!floorPlaced) return false
  // A kind that can collide can own ground, whichever of its nodes do just now.
  const collides: unknown = floorPlaced.collides
  return collides === true || typeof collides === 'function' || isBuiltWithoutCollision(node)
}

type PlanPoint = readonly [number, number]

function planPoints(value: unknown): [number, number][] | null {
  if (!Array.isArray(value) || value.length < 3) return null
  const points: [number, number][] = []
  for (const point of value) {
    if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null
    points.push([Number(point[0]), Number(point[1])])
  }
  return points
}

/**
 * The outline of a kind that stands on the ground without declaring a footprint: a rock's plan
 * polygon, a ramp's centreline at its width, each in its parent's frame. Null for any other kind.
 */
function ownOutline(node: AnyNode, transform: SiteTransform): GrassObstacleShape[] | null {
  const kind = String(node.type)
  if (kind === ROCK_KIND) {
    const polygon = planPoints((node as { polygon?: unknown }).polygon)
    return polygon
      ? [{ kind: 'polygon', points: polygon.map((point) => transformPoint(point, transform)) }]
      : []
  }
  if (kind !== RAMP_KIND) return null
  const ramp = node as { start?: unknown; segments?: unknown; width?: unknown }
  const start = Array.isArray(ramp.start) ? ramp.start : null
  const radius = typeof ramp.width === 'number' && ramp.width > 0 ? ramp.width / 2 : 0
  if (!start || !Number.isFinite(start[0]) || !Number.isFinite(start[1]) || radius <= 0) return []
  const line: [number, number][] = [[Number(start[0]), Number(start[1])]]
  for (const segment of Array.isArray(ramp.segments) ? ramp.segments : []) {
    const from = line[line.length - 1] as [number, number]
    if (segment?.type === 'line' && Array.isArray(segment.end)) {
      line.push([Number(segment.end[0]), Number(segment.end[1])])
    } else if (segment?.type === 'arc' && Array.isArray(segment.center)) {
      // As core walks it: about the centre, from where the last segment ended, through `sweep`.
      const [cx, cz] = [Number(segment.center[0]), Number(segment.center[1])]
      const arcRadius = Math.hypot(from[0] - cx, from[1] - cz)
      const angle = Math.atan2(from[1] - cz, from[0] - cx)
      const sweep = Number(segment.sweep)
      const steps = Math.max(1, Math.ceil(Math.abs(sweep) / RAMP_ARC_STEP))
      for (let step = 1; step <= steps; step += 1) {
        const at = angle + (sweep * step) / steps
        line.push([cx + arcRadius * Math.cos(at), cz + arcRadius * Math.sin(at)])
      }
    }
  }
  if (line.some(([x, z]) => !Number.isFinite(x) || !Number.isFinite(z))) return []
  const shapes: GrassObstacleShape[] = []
  for (let index = 0; index + 1 < line.length; index += 1) {
    shapes.push({
      kind: 'capsule',
      start: transformPoint(line[index] as PlanPoint, transform),
      end: transformPoint(line[index + 1] as PlanPoint, transform),
      radius,
    })
  }
  return shapes
}

/**
 * The outline of a node that carries its own plan polygon about its position (a pool), grown to
 * the footprint its kind declares: the box of a pool is its outline plus its coping, so the margin
 * between the two is the coping, cleared along every edge. A kidney pool then clears a kidney, not
 * the square round it. Null when the node has no such polygon: the caller uses its box.
 */
function footprintOutline(
  node: AnyNode,
  footprints: ReturnType<typeof getFloorPlacedFootprints>,
  transform: SiteTransform,
): GrassObstacleShape[] | null {
  const polygon = planPoints((node as { polygon?: unknown }).polygon)
  const position = nodePosition(node)
  const footprint = footprints[0]
  if (!polygon || !position || footprints.length !== 1 || !footprint || footprint.position) return null
  const yaw = footprint.rotation[1] ?? 0
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const place = ([x, z]: PlanPoint): [number, number] =>
    transformPoint([position[0] + x * cos + z * sin, position[2] - x * sin + z * cos], transform)
  const xs = polygon.map(([x]) => x)
  const zs = polygon.map(([, z]) => z)
  const margin =
    Math.min(
      Math.abs(footprint.dimensions[0]) - (Math.max(...xs) - Math.min(...xs)),
      Math.abs(footprint.dimensions[2]) - (Math.max(...zs) - Math.min(...zs)),
    ) / 2
  const points = polygon.map(place)
  const shapes: GrassObstacleShape[] = [{ kind: 'polygon', points }]
  if (margin > 1e-6) {
    for (let index = 0; index < points.length; index += 1) {
      shapes.push({
        kind: 'capsule',
        start: points[index] as PlanPoint,
        end: points[(index + 1) % points.length] as PlanPoint,
        radius: margin,
      })
    }
  }
  return shapes
}

/**
 * Whether a node is a plant, where nothing better than words says so: an item by its name,
 * category and tags (the catalogue's models carry no outline here), another plugin's kind by its
 * kind name and label. The plugin's own id is not read: a plugin of plants also ships its pots.
 */
function hasFoliageHint(node: AnyNode): boolean {
  if (node.type === 'item') {
    return FOLIAGE_WORDS.test(
      [node.name, node.asset.name, node.asset.category, ...(node.asset.tags ?? [])].join(' '),
    )
  }
  const kind = String(node.type)
  const label = nodeRegistry.get(node.type)?.presentation?.label
  return FOLIAGE_WORDS.test(`${kind.slice(kind.indexOf(':') + 1)} ${label ?? ''} ${node.name ?? ''}`)
}

type PlanRing = [number, number][]
type ShapeBand = {
  y0: number
  polygons: { outer: PlanRing; holes?: PlanRing[] }[]
}
/** The outline a scripted object's compiler traced from its meshes, height band by height band. */
type ScriptedShape = { source?: { manifest?: { shape?: { bands?: ShapeBand[] } } } }

/**
 * What a scripted object has standing in the grass: the outlines of its height bands that start
 * within the grass's reach of its base, mapped as core maps them (the corrective asset pose, then
 * the node's). A palm clears its trunk and a clipped ball its foot, whatever they are called.
 * Null when the object carries no outline or is tilted, so the caller falls back to its box.
 */
function standingOutline(node: AnyNode, transform: SiteTransform): GrassObstacleShape[] | null {
  if (node.type !== 'item') return null
  const bands = (node as ScriptedShape).source?.manifest?.shape?.bands
  if (!bands?.length) return null
  const tilted = (rotation: readonly number[]) =>
    Math.abs(rotation[0] ?? 0) > TILT_EPSILON || Math.abs(rotation[2] ?? 0) > TILT_EPSILON
  if (tilted(node.rotation) || tilted(node.asset.rotation)) return null
  const metresPerUnit = Math.abs(node.asset.scale[1] * node.scale[1])
  if (!(metresPerUnit > 0)) return null
  const base = Math.min(...bands.map((band) => band.y0))
  const turn = (x: number, z: number, angle: number): [number, number] => [
    x * Math.cos(angle) + z * Math.sin(angle),
    -x * Math.sin(angle) + z * Math.cos(angle),
  ]
  const point = ([x, z]: [number, number]): [number, number] => {
    const [ax, az] = turn(x * node.asset.scale[0], z * node.asset.scale[2], node.asset.rotation[1])
    const [px, pz] = turn(
      (ax + node.asset.offset[0]) * node.scale[0],
      (az + node.asset.offset[2]) * node.scale[2],
      node.rotation[1],
    )
    return transformPoint([px + node.position[0], pz + node.position[2]], transform)
  }
  const shapes = bands
    .filter((band) => (band.y0 - base) * metresPerUnit < GRASS_REACH)
    .flatMap((band) =>
      band.polygons
        .filter((polygon) => polygon.outer.length >= 3)
        .map((polygon) => ({
          kind: 'polygon' as const,
          points: polygon.outer.map(point),
          holes: (polygon.holes ?? []).map((hole) => hole.map(point)),
        })),
    )
  return shapes.length > 0 ? shapes : null
}

function directChildren(parent: AnyNode, nodes: Readonly<Record<string, AnyNode>>): AnyNode[] {
  const children = nodeChildren(parent)
    .map((id) => nodes[id])
    .filter((node): node is AnyNode => Boolean(node))
  const known = new Set(children.map((node) => node.id))
  for (const node of Object.values(nodes)) {
    if (node.parentId === parent.id && !known.has(node.id)) children.push(node)
  }
  return children
}
export function changedGrassObstacleSiteIds(
  currentNodes: Readonly<Record<string, AnyNode>>,
  previousNodes: Readonly<Record<string, AnyNode>>,
): Set<string> {
  const changedSiteIds = new Set<string>()
  const ids = new Set([...Object.keys(currentNodes), ...Object.keys(previousNodes)])
  // A water's edge moves with the ground, and the host keeps ground in nodes under the Site too.
  for (const siteId of sitesWithChangedTerrainNodes(currentNodes, previousNodes)) {
    if (siteHasWaterObstacles(siteId, currentNodes)) changedSiteIds.add(siteId)
  }

  for (const id of ids) {
    const current = currentNodes[id]
    const previous = previousNodes[id]
    if (current === previous) continue
    if (
      current?.type === 'site' &&
      (previous?.type !== 'site' || !sameIds(current.children, previous.children))
    ) {
      changedSiteIds.add(current.id)
    }
    if (
      previous?.type === 'site' &&
      (current?.type !== 'site' || !sameIds(previous.children, current.children))
    ) {
      changedSiteIds.add(previous.id)
    }
    if (
      current?.type === 'site' &&
      previous?.type === 'site' &&
      (current.terrain !== previous.terrain || current.polygon !== previous.polygon) &&
      siteHasWaterObstacles(current.id, currentNodes)
    ) {
      changedSiteIds.add(current.id)
    }
    if (!isGrassObstacleNode(current) && !isGrassObstacleNode(previous)) continue

    const currentSiteId = current ? siteAncestorId(current, currentNodes) : null
    const previousSiteId = previous ? siteAncestorId(previous, previousNodes) : null
    if (currentSiteId) changedSiteIds.add(currentSiteId)
    if (previousSiteId) changedSiteIds.add(previousSiteId)
  }
  return changedSiteIds
}
function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function isGrassObstacleNode(node: AnyNode | undefined): boolean {
  if (!node) return false
  if (
    node.type === 'building' ||
    node.type === 'level' ||
    node.type === 'slab' ||
    node.type === 'zone' ||
    node.type === 'wall' ||
    isWaterObstacleNode(node)
  ) {
    return true
  }
  return isGroundOwnerKind(node)
}

function siteAncestorId(node: AnyNode, nodes: Readonly<Record<string, AnyNode>>): string | null {
  let current: AnyNode | undefined = node
  const visited = new Set<string>()
  while (current && !visited.has(current.id)) {
    if (current.type === 'site') return current.id
    visited.add(current.id)
    current = current.parentId ? nodes[current.parentId] : undefined
  }
  return null
}

function nodeBelongsToSite(
  node: AnyNode,
  siteId: string,
  nodes: Readonly<Record<string, AnyNode>>,
): boolean {
  let current: AnyNode | undefined = node
  const visited = new Set<string>()
  while (current && !visited.has(current.id)) {
    if (current.id === siteId) return true
    visited.add(current.id)
    current = current.parentId ? nodes[current.parentId] : undefined
  }
  return false
}

function nodeChildren(node: AnyNode): string[] {
  if (!('children' in node) || !Array.isArray(node.children)) return []
  return node.children.filter((id): id is string => typeof id === 'string')
}

function nodePosition(node: AnyNode): [number, number, number] | null {
  if (!('position' in node) || !Array.isArray(node.position)) return null
  const position = node.position
  return position.length >= 3 && position.every(Number.isFinite)
    ? [Number(position[0]), Number(position[1]), Number(position[2])]
    : null
}

function transformPoint(
  point: readonly [number, number],
  transform: SiteTransform,
): [number, number] {
  const cos = Math.cos(transform.rotation)
  const sin = Math.sin(transform.rotation)
  return [
    transform.x + point[0] * cos + point[1] * sin,
    transform.z - point[0] * sin + point[1] * cos,
  ]
}
