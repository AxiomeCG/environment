import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  getFloorPlacedFootprints,
  getLevelElevations,
  getWallThickness,
  type GeometryContext,
  nodeRegistry,
  sampleWallCenterline,
  type LevelNode,
  type SiteNode,
  type SlabNode,
  type WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import { resolvePond } from '../pond/geometry'
import { POND_KIND, type PondNode } from '../pond/schema'
import { resolveRiver } from '../river/geometry'
import { RIVER_KIND, type RiverNode } from '../river/schema'
import type { GrassPaintField } from './paint-field'
import {
  createGrassObstacleField,
  type GrassObstacleField,
  type GrassObstacleShape,
} from './obstacle-field'

const CURVED_WALL_SEGMENTS = 24

type SiteTransform = {
  readonly x: number
  readonly z: number
  readonly rotation: number
}

const IDENTITY_TRANSFORM: SiteTransform = { x: 0, z: 0, rotation: 0 }

export function buildGrassObstacleField(
  site: SiteNode,
  nodes: Readonly<Record<string, AnyNode>>,
  topology: Pick<GrassPaintField, 'origin' | 'spacing' | 'cols' | 'rows'>,
): GrassObstacleField {
  return createGrassObstacleField(topology, collectGrassObstacleShapes(site, nodes))
}

export function collectGrassObstacleShapes(
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

  const children = directChildren(site, nodes)
  collectFloorPlacedShapes(children, coreNodes, IDENTITY_TRANSFORM, shapes)
  const context: GeometryContext = {
    parent: site,
    children: [],
    siblings: children,
    resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
  }
  for (const child of children) {
    if (child.parentId !== site.id) continue
    const surface =
      (child.type as string) === POND_KIND
        ? resolvePond(child as unknown as PondNode, context)?.surface
        : (child.type as string) === RIVER_KIND
          ? resolveRiver(child as unknown as RiverNode, context)?.surface
          : null
    if (surface?.positions.length) {
      shapes.push({ kind: 'triangles', positions: surface.positions })
    }
  }
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

function collectFloorPlacedShapes(
  children: readonly AnyNode[],
  nodes: Record<AnyNodeId, AnyNode>,
  transform: SiteTransform,
  output: GrassObstacleShape[],
): void {
  for (const node of children) {
    if (node.type === 'slab' || node.type === 'zone' || node.type === 'wall') continue
    const floorPlaced = nodeRegistry.get(node.type)?.capabilities?.floorPlaced
    if (!floorPlaced?.collides || floorPlaced.applies?.(node) === false) continue

    const footprints = getFloorPlacedFootprints(floorPlaced, node, { nodes })
    for (const footprint of footprints) {
      const position = footprint.position ?? nodePosition(node)
      if (!position) continue
      const halfX = Math.abs(footprint.dimensions[0]) / 2
      const halfZ = Math.abs(footprint.dimensions[2]) / 2
      if (halfX <= 0 || halfZ <= 0) continue
      output.push({
        kind: 'box',
        center: transformPoint([position[0], position[2]], transform),
        halfSize: [halfX, halfZ],
        rotation: transform.rotation + (footprint.rotation[1] ?? 0),
      })
    }
  }
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
  return nodeRegistry.get(node.type)?.capabilities?.floorPlaced?.collides === true
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
