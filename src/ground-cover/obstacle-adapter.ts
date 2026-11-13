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
/** A footprint no wider than this is a trunk already; a blade keeps this far from it. */
const MAX_TRUNK_HALF_WIDTH = 0.5
const TRUNK_MARGIN = 0.05
/** Water shallower than this (m) is a film the lawn stands in, not water that owns the ground. */
const WATER_EDGE_DEPTH = 0.03
/**
 * Core kinds that are built on the ground yet leave floor collision off (it is about furniture
 * placement): steps declare a footprint, a rock and a ramp carry their outline in the Site's frame.
 */
const STEPS_KIND = 'stair'
const ROCK_KIND = 'rock'
const RAMP_KIND = 'ramp'
const RAMP_ARC_STEP = Math.PI / 18

/**
 * A scene is data: stored, pasted or written by an agent. Nothing a node holds may make this mask
 * loop or allocate without limit, or throw, in the renderer of everyone who opens the scene. A
 * value that is not finite or is out of these bounds drops the shape it would make (the lawn then
 * grows there); it never stretches one.
 */
const MAX_COORDINATE = 1e6
const MAX_RADIUS = 100
/** Points in one ring: an outline read from a node or a hole; a slab's or a room's own outline. */
const MAX_OUTLINE_POINTS = 512
const MAX_SLAB_POINTS = 2048
const MAX_HOLES = 64
/** What one node may add, and what a whole mask may hold: past either, shapes are left out. */
const MAX_SHAPES_PER_NODE = 256
const MAX_VERTICES_PER_NODE = 4096
const MAX_SHAPES_PER_MASK = 16_384
const MAX_VERTICES_PER_MASK = 131_072
const MAX_FOOTPRINTS = 64
const MAX_BANDS = 64
const MAX_BAND_POLYGONS = 64
/** Core caps a ramp at 128 segments and refuses a full turn; an arc is walked in 10 degree steps. */
const MAX_RAMP_SEGMENTS = 128
const MAX_RAMP_ARC_STEPS = 36
const MAX_RAMP_POINTS = 1024

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

export function collectGrassObstacleShapes(
  site: SiteNode,
  nodes: Readonly<Record<string, AnyNode>>,
  ground?: TerrainField | null,
): GrassObstacleShape[] {
  const shapes = collectGroundShapes(site, nodes, 'all')
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
    if (!surface?.positions.length) continue
    // The lawn stops where the water is deep enough to see, not at the last wet terrain cell:
    // a pond filled to the brim of a hollow in level ground is a film of nothing on its rim.
    const deep = waterDeeperThan(surface.positions, surface.depths, WATER_EDGE_DEPTH)
    if (deep.length > 0) shapes.push({ kind: 'triangles', positions: deep })
  }
  return shapes
}

/**
 * Where another node opens the ground under the lot's sheets: a pool, the outline it carries
 * grown to its footprint. The painted Surface is cut out there (it would lie over the pool's
 * water as a lid); elsewhere what stands on the lot hides the sheet or stands on it.
 */
export function collectGroundOpeningShapes(
  site: SiteNode,
  nodes: Readonly<Record<string, AnyNode>>,
): GrassObstacleShape[] {
  return collectGroundShapes(site, nodes, 'openings')
}

/** Whether a node change can open or close the ground: only then is the Surface's cut redrawn. */
export function isGroundOpeningNode(node: AnyNode | undefined): boolean {
  if (!node || !isBuiltWithoutCollision(node) || hasFoliageHint(node)) return false
  return (
    Boolean(nodeRegistry.get(node.type)?.capabilities?.floorPlaced) &&
    Array.isArray((node as { polygon?: unknown }).polygon)
  )
}

type ShapePick = 'all' | 'openings'

/** Everything built or standing on the Site's ground: slabs, rooms, walls and what stands on it. */
function collectGroundShapes(
  site: SiteNode,
  nodes: Readonly<Record<string, AnyNode>>,
  pick: ShapePick,
): GrassObstacleShape[] {
  const shapes: ShapeSink = { list: [], vertices: 0, pick }
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
  return shapes.list
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
  output: ShapeSink,
): void {
  const children = directChildren(level, nodes)

  for (const child of output.pick === 'all' ? children : []) {
    if (child.type === 'slab') {
      const slab = child
      admitNodeShapes(output, () =>
        slab.polygon.length > MAX_SLAB_POINTS || slab.holes.length > MAX_HOLES
          ? null
          : [
              {
                kind: 'polygon',
                points: slab.polygon.map((point) => transformPoint(point, transform)),
                holes: slab.holes.map((hole) =>
                  hole.slice(0, MAX_OUTLINE_POINTS + 1).map((point) => transformPoint(point, transform)),
                ),
              },
            ],
      )
      continue
    }
    if (child.type === 'zone') {
      const zone = child
      if (zone.spaceRole === 'room' && zone.enclosureStatus !== 'open') {
        admitNodeShapes(output, () =>
          zone.polygon.length > MAX_SLAB_POINTS
            ? null
            : [
                {
                  kind: 'polygon',
                  points: zone.polygon.map((point) => transformPoint(point, transform)),
                },
              ],
        )
      }
      continue
    }
    if (child.type === 'wall') {
      admitNodeShapes(output, () => {
        const shapes: GrassObstacleShape[] = []
        addWallShapes(child, transform, shapes)
        return shapes
      })
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
  output: ShapeSink,
): void {
  for (const node of children) {
    if (node.type === 'slab' || node.type === 'zone' || node.type === 'wall') continue
    // The footprint is another kind's code and the node is scene data: neither may stop the lawn.
    admitNodeShapes(output, () => groundOwnerShapes(node, nodes, transform, output.pick))
  }
}

function groundOwnerShapes(
  node: AnyNode,
  nodes: Record<AnyNodeId, AnyNode>,
  transform: SiteTransform,
  pick: ShapePick,
): GrassObstacleShape[] | null {
  const outline = ownOutline(node, transform)
  if (outline) return pick === 'all' ? outline : null
  const floorPlaced = nodeRegistry.get(node.type)?.capabilities?.floorPlaced
  if (!floorPlaced || floorPlaced.applies?.(node) === false) return null
  const collides = floorPlacedCollides(floorPlaced, node)
  if (!collides && !isBuiltWithoutCollision(node)) return null

  const footprints = getFloorPlacedFootprints(floorPlaced, node, { nodes }).slice(0, MAX_FOOTPRINTS)
  if (footprints.length === 0) return null
  const foliage = hasFoliageHint(node)
  // A node that carries its own outline about its position (a pool) owns that ground outright.
  const opening = foliage ? null : footprintOutline(node, footprints, transform)
  if (pick === 'openings') return opening
  // What an object really has on the ground, when it says so (no name is read). It stands in the
  // lawn: blades keep off it, the lawn's ground stays drawn under it.
  const standing = standingOutline(node, transform)
  if (standing) return standing
  if (opening) return opening

  const shapes: GrassObstacleShape[] = []
  for (const footprint of footprints) {
    const position = footprint.position ?? nodePosition(node)
    if (!position) continue
    const halfX = Math.abs(footprint.dimensions[0]) / 2
    const halfZ = Math.abs(footprint.dimensions[2]) / 2
    if (!(halfX > 0) || !(halfZ > 0)) continue
    const center = transformPoint([position[0], position[2]], transform)
    const height = footprint.dimensions[1]
    if (foliage && height >= TALL_FOLIAGE_HEIGHT) {
      // A tall plant stands on a trunk: its box is the crown overhead, a square in the lawn.
      shapes.push({ kind: 'capsule', keepsGround: true, start: center, end: center, radius: trunkRadius(halfX, halfZ, height) })
      continue
    }
    // A low plant that blocks no placement stands in the lawn, not on a bare patch.
    if (foliage && !collides) continue
    shapes.push({
      kind: 'box',
      keepsGround: true,
      center,
      halfSize: [halfX, halfZ],
      rotation: transform.rotation + (footprint.rotation[1] ?? 0),
    })
  }
  return shapes
}

/**
 * The disc a tall plant clears. A footprint that is already a trunk (another plugin's tree
 * declares one) is cleared with a hand's width round it, so no blade stands in the bark; the box
 * of a catalogue tree is its crown, so its trunk is taken from its height: 0.15 to 0.5 m.
 */
function trunkRadius(halfX: number, halfZ: number, height: number): number {
  const widest = Math.max(halfX, halfZ)
  if (widest <= MAX_TRUNK_HALF_WIDTH) return widest + TRUNK_MARGIN
  return Math.min(halfX, halfZ, Math.max(0.15, Math.min(0.5, height * 0.04)))
}

/** The shapes of one mask, the vertices they hold so far, and which of a scene's shapes it takes. */
type ShapeSink = { list: GrassObstacleShape[]; vertices: number; pick: ShapePick }

/** What a shape costs to keep: its outline and hole points; a capsule is two, a box four. */
function vertexCount(shape: GrassObstacleShape): number {
  if (shape.kind === 'capsule') return 2
  if (shape.kind === 'box') return 4
  if (shape.kind === 'triangles') return 0
  let count = shape.points.length
  for (const hole of shape.holes ?? []) count += hole.length
  return count
}

/**
 * One node's shapes into the mask: derived inside a guard, so a kind's footprint that throws or a
 * malformed node leaves the lawn drawn, then kept only where every number is finite and bounded,
 * within what a node may add and what the mask may hold. The mask's cost follows its vertices
 * and its shapes, so both are counted across the node and across the mask, holes included.
 */
function admitNodeShapes(
  output: ShapeSink,
  derive: () => readonly GrassObstacleShape[] | null,
): void {
  if (output.list.length >= MAX_SHAPES_PER_MASK) return
  let shapes: readonly GrassObstacleShape[] | null
  try {
    shapes = derive()
  } catch {
    return
  }
  if (!shapes) return
  let admitted = 0
  let vertices = 0
  for (const shape of shapes) {
    if (admitted >= MAX_SHAPES_PER_NODE || output.list.length >= MAX_SHAPES_PER_MASK) return
    if (!isBoundedShape(shape)) continue
    const count = vertexCount(shape)
    if (vertices + count > MAX_VERTICES_PER_NODE) continue
    if (output.vertices + count > MAX_VERTICES_PER_MASK) continue
    output.list.push(shape)
    output.vertices += count
    vertices += count
    admitted += 1
  }
}

const bounded = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE

const boundedPoint = (point: unknown): boolean =>
  Array.isArray(point) && bounded(point[0]) && bounded(point[1])

const boundedRing = (ring: unknown, most: number): boolean =>
  Array.isArray(ring) && ring.length >= 3 && ring.length <= most && ring.every(boundedPoint)

function isBoundedShape(shape: GrassObstacleShape): boolean {
  if (shape.kind === 'triangles') return true
  if (shape.kind === 'polygon') {
    const holes = shape.holes ?? []
    return (
      boundedRing(shape.points, MAX_SLAB_POINTS) &&
      holes.length <= MAX_HOLES &&
      holes.every((hole) => boundedRing(hole, MAX_OUTLINE_POINTS))
    )
  }
  if (shape.kind === 'capsule') {
    return (
      boundedPoint(shape.start) &&
      boundedPoint(shape.end) &&
      bounded(shape.radius) &&
      shape.radius >= 0 &&
      shape.radius <= MAX_RADIUS
    )
  }
  return (
    boundedPoint(shape.center) &&
    bounded(shape.halfSize[0]) &&
    bounded(shape.halfSize[1]) &&
    shape.halfSize[0] > 0 &&
    shape.halfSize[1] > 0 &&
    Number.isFinite(shape.rotation)
  )
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

/** A plan outline read from a node: 3 to `MAX_OUTLINE_POINTS` finite, bounded points, or null. */
function planPoints(value: unknown): [number, number][] | null {
  if (!boundedRing(value, MAX_OUTLINE_POINTS)) return null
  return (value as [number, number][]).map(([x, z]) => [x, z])
}

/**
 * The outline of a kind that stands on the ground without declaring a footprint: a rock's plan
 * polygon, a ramp's centreline at its width, each in its parent's frame. Null for any other kind.
 */
function ownOutline(node: AnyNode, transform: SiteTransform): GrassObstacleShape[] | null {
  const kind = String(node.type)
  if (kind === ROCK_KIND) {
    const polygon = planPoints((node as { polygon?: unknown }).polygon)
    // A rock stands on the lawn's ground: no blade in it, the ground drawn up to it.
    return polygon
      ? [{ kind: 'polygon', keepsGround: true, points: polygon.map((point) => transformPoint(point, transform)) }]
      : []
  }
  if (kind !== RAMP_KIND) return null
  const ramp = node as { start?: unknown; segments?: unknown; width?: unknown }
  const radius = bounded(ramp.width) ? ramp.width / 2 : 0
  if (!boundedPoint(ramp.start) || !(radius > 0) || radius > MAX_RADIUS) return []
  const start = ramp.start as [number, number]
  const line: [number, number][] = [[start[0], start[1]]]
  const segments = Array.isArray(ramp.segments) ? ramp.segments.slice(0, MAX_RAMP_SEGMENTS) : []
  for (const segment of segments as { type?: unknown; end?: unknown; center?: unknown; sweep?: unknown }[]) {
    const from = line[line.length - 1] as [number, number]
    if (segment?.type === 'line') {
      if (!boundedPoint(segment.end)) return []
      const end = segment.end as [number, number]
      line.push([end[0], end[1]])
    } else if (segment?.type === 'arc') {
      // As core walks it: about the centre, from where the last segment ended, through `sweep`.
      // Core refuses a full turn; a sweep that is not a finite part of one is no ramp.
      const sweep = segment.sweep
      if (!boundedPoint(segment.center) || !bounded(sweep) || Math.abs(sweep) > Math.PI * 2) return []
      const [cx, cz] = segment.center as [number, number]
      const arcRadius = Math.hypot(from[0] - cx, from[1] - cz)
      const angle = Math.atan2(from[1] - cz, from[0] - cx)
      const steps = Math.min(MAX_RAMP_ARC_STEPS, Math.max(1, Math.ceil(Math.abs(sweep) / RAMP_ARC_STEP)))
      for (let step = 1; step <= steps; step += 1) {
        const at = angle + (sweep * step) / steps
        line.push([cx + arcRadius * Math.cos(at), cz + arcRadius * Math.sin(at)])
      }
    }
    if (line.length > MAX_RAMP_POINTS) return []
  }
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
  // A margin that is no finite, plausible coping leaves the outline alone.
  if (margin > 1e-6 && margin <= MAX_RADIUS) {
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
  const allBands = (node as ScriptedShape).source?.manifest?.shape?.bands
  if (!Array.isArray(allBands) || allBands.length === 0) return null
  const bands = allBands.slice(0, MAX_BANDS)
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
  if (!Number.isFinite(base)) return null
  const shapes: GrassObstacleShape[] = []
  for (const band of bands) {
    if (!((band.y0 - base) * metresPerUnit < GRASS_REACH) || !Array.isArray(band.polygons)) continue
    for (const polygon of band.polygons.slice(0, MAX_BAND_POLYGONS)) {
      // An outline this mask cannot bound is no outline: the caller falls back to the box.
      if (!boundedRing(polygon?.outer, MAX_OUTLINE_POINTS)) return null
      const holes = (Array.isArray(polygon.holes) ? polygon.holes : []).slice(0, MAX_HOLES)
      if (!holes.every((hole) => boundedRing(hole, MAX_OUTLINE_POINTS))) return null
      shapes.push({
        kind: 'polygon',
        keepsGround: true,
        points: polygon.outer.map(point),
        holes: holes.map((hole) => hole.map(point)),
      })
    }
  }
  return shapes.length > 0 ? shapes : null
}

/**
 * The part of a water surface (triangles, three positions each, with the depth under each vertex)
 * that is at least `depth` deep, as triangles. Depth is linear across a triangle, so the edge
 * follows the bed's contour instead of the terrain's cells.
 */
function waterDeeperThan(
  positions: ArrayLike<number>,
  depths: ArrayLike<number>,
  depth: number,
): Float32Array {
  const kept: number[] = []
  type Wet = [x: number, y: number, z: number, d: number]
  for (let offset = 0; offset + 8 < positions.length; offset += 9) {
    const corners: Wet[] = []
    for (let vertex = 0; vertex < 3; vertex += 1) {
      corners.push([
        positions[offset + vertex * 3] ?? 0,
        positions[offset + vertex * 3 + 1] ?? 0,
        positions[offset + vertex * 3 + 2] ?? 0,
        depths[offset / 3 + vertex] ?? 0,
      ])
    }
    if (!corners.every((corner) => corner.every(Number.isFinite))) continue
    // Clip the triangle to the half where depth >= `depth`: three or four corners remain.
    const deep: Wet[] = []
    for (let index = 0; index < 3; index += 1) {
      const from = corners[index] as Wet
      const to = corners[(index + 1) % 3] as Wet
      if (from[3] >= depth) deep.push(from)
      if (from[3] >= depth !== to[3] >= depth) {
        const t = (depth - from[3]) / (to[3] - from[3])
        deep.push([
          from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t,
          from[2] + (to[2] - from[2]) * t,
          depth,
        ])
      }
    }
    for (let index = 1; index + 1 < deep.length; index += 1) {
      for (const corner of [deep[0] as Wet, deep[index] as Wet, deep[index + 1] as Wet]) {
        kept.push(corner[0], corner[1], corner[2])
      }
    }
  }
  return new Float32Array(kept)
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
