import { generateId, type AnyNode, type AnyNodeId, type SiteNode } from '@pascal-app/core'
import type { PondShoreline, WaterQuality } from '../pond/schema'
import { rebuildRiverTerrain } from './terrain'
import {
  RIVER_KIND,
  RiverNode as RiverNodeSchema,
  type RiverFlowDirection,
  type RiverNode,
  type RiverOutlet,
  type RiverPoint,
  type RiverSource,
} from './schema'

export type RiverNodeChanges = {
  create?: { node: AnyNode; parentId?: AnyNodeId }[]
  update?: { id: AnyNodeId; data: Partial<AnyNode> }[]
  delete?: AnyNodeId[]
}

export type RiverSceneWriter = {
  nodes: Record<AnyNodeId, AnyNode>
  rootNodeIds: AnyNodeId[]
  applyNodeChanges: (changes: RiverNodeChanges) => void
}

export type RiverSelectionContext = {
  buildingId: string | null
  levelId: string | null
  zoneId: string | null
  selectedIds: readonly string[]
}

export type RiverParameters = {
  points: readonly RiverPoint[]
  width: number
  depth: number
  source: RiverSource
  outlet: RiverOutlet
  flowDirection: RiverFlowDirection
  flowSpeed: number
  quality: WaterQuality
  shoreline: PondShoreline
}

export type RiverActionResult = {
  ok: boolean
  message: string
  river?: RiverNode
}

function nodeAt(
  nodes: Readonly<RiverSceneWriter['nodes']>,
  id: string | null,
): AnyNode | undefined {
  return id ? nodes[id as AnyNodeId] : undefined
}

function siteAncestor(
  nodes: Readonly<RiverSceneWriter['nodes']>,
  startId: string | null,
): SiteNode | null {
  let node = nodeAt(nodes, startId)
  const visited = new Set<string>()
  while (node && !visited.has(String(node.id))) {
    if (node.type === 'site') return node as SiteNode
    visited.add(String(node.id))
    node = node.parentId ? nodeAt(nodes, String(node.parentId)) : undefined
  }
  return null
}

export function resolveActiveRiverSite(
  nodes: Readonly<RiverSceneWriter['nodes']>,
  rootNodeIds: readonly AnyNodeId[],
  selection: RiverSelectionContext,
): SiteNode | null {
  for (const selectedId of selection.selectedIds) {
    const site = siteAncestor(nodes, selectedId)
    if (site) return site
  }
  for (const contextId of [selection.zoneId, selection.levelId, selection.buildingId]) {
    const site = siteAncestor(nodes, contextId)
    if (site) return site
  }
  for (const rootId of rootNodeIds) {
    const node = nodes[rootId]
    if (node?.type === 'site') return node as SiteNode
  }
  return null
}

export function riverNodeOf(node: unknown): RiverNode | null {
  const parsed = RiverNodeSchema.safeParse(node)
  return parsed.success ? parsed.data : null
}

export function riversForSite(
  nodes: Readonly<RiverSceneWriter['nodes']>,
  siteId: string,
): RiverNode[] {
  const rivers: RiverNode[] = []
  for (const candidate of Object.values(nodes)) {
    if ((candidate.type as string) !== RIVER_KIND || String(candidate.parentId) !== siteId) {
      continue
    }
    const river = riverNodeOf(candidate)
    if (river) rivers.push(river)
  }
  return rivers
}

function validatePoints(points: readonly RiverPoint[]): string | null {
  if (points.length < 2) return 'Place at least two river points before finishing.'
  if (points.length > 128) return 'A river can contain at most 128 points.'
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!
    const point = points[index]!
    if (Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 0.01) {
      return 'River points must be separated on the terrain.'
    }
  }
  return null
}

function siteForMutation(scene: RiverSceneWriter, siteId: string): SiteNode | null {
  const node = nodeAt(scene.nodes, siteId)
  return node?.type === 'site' ? (node as SiteNode) : null
}

function siteTerrainUpdate(site: SiteNode, rivers: readonly RiverNode[]) {
  const rebuilt = rebuildRiverTerrain(site, rivers)
  return {
    id: site.id as AnyNodeId,
    data: {
      terrain: rebuilt.terrainData,
      metadata: rebuilt.metadata,
    } as unknown as Partial<AnyNode>,
  }
}

export function createRiver(
  scene: RiverSceneWriter,
  siteId: string,
  parameters: RiverParameters,
): RiverActionResult {
  const pointError = validatePoints(parameters.points)
  if (pointError) return { ok: false, message: pointError }
  const site = siteForMutation(scene, siteId)
  if (!site) {
    return { ok: false, message: 'Select a Site before drawing a river.' }
  }
  const parsed = RiverNodeSchema.safeParse({
    id: generateId('river'),
    parentId: site.id,
    name: 'River',
    ...parameters,
    points: parameters.points.map((point) => [point[0], point[1]]),
  })
  if (!parsed.success)
    return { ok: false, message: 'River settings are outside their allowed range.' }
  const river = parsed.data
  const rivers = [...riversForSite(scene.nodes, site.id), river]
  scene.applyNodeChanges({
    create: [
      {
        node: river as unknown as AnyNode,
        parentId: site.id as AnyNodeId,
      },
    ],
    update: [siteTerrainUpdate(site, rivers)],
  })
  return { ok: true, message: 'River created.', river }
}

export function updateRiver(
  scene: RiverSceneWriter,
  riverId: string,
  patch: Partial<RiverParameters>,
): RiverActionResult {
  const current = riverNodeOf(nodeAt(scene.nodes, riverId))
  if (!current || !current.parentId)
    return { ok: false, message: 'The selected river no longer exists.' }
  const site = siteForMutation(scene, String(current.parentId))
  if (!site) return { ok: false, message: 'The river Site no longer exists.' }
  const parsed = RiverNodeSchema.safeParse({
    ...current,
    ...patch,
    points: patch.points?.map((point) => [point[0], point[1]]) ?? current.points,
  })
  if (!parsed.success)
    return { ok: false, message: 'River settings are outside their allowed range.' }
  const river = parsed.data
  const pointError = validatePoints(river.points)
  if (pointError) return { ok: false, message: pointError }
  if (sameRiver(current, river))
    return { ok: false, message: 'The river is already unchanged.', river: current }

  const riverUpdate = {
    id: river.id as AnyNodeId,
    data: river as unknown as Partial<AnyNode>,
  }
  const excavationChanged =
    patch.points !== undefined ||
    patch.width !== undefined ||
    patch.depth !== undefined ||
    patch.source !== undefined ||
    patch.outlet !== undefined
  if (!excavationChanged) {
    scene.applyNodeChanges({ update: [riverUpdate] })
    return { ok: true, message: 'River updated.', river }
  }
  const rivers = riversForSite(scene.nodes, site.id).map((candidate) =>
    candidate.id === river.id ? river : candidate,
  )
  scene.applyNodeChanges({
    update: [riverUpdate, siteTerrainUpdate(site, rivers)],
  })
  return { ok: true, message: 'River updated.', river }
}

export function deleteRiver(scene: RiverSceneWriter, riverId: string): RiverActionResult {
  const river = riverNodeOf(nodeAt(scene.nodes, riverId))
  if (!river || !river.parentId)
    return { ok: false, message: 'The selected river no longer exists.' }
  const site = siteForMutation(scene, String(river.parentId))
  if (!site) return { ok: false, message: 'The river Site no longer exists.' }
  const remaining = riversForSite(scene.nodes, site.id).filter(
    (candidate) => candidate.id !== river.id,
  )
  scene.applyNodeChanges({
    update: [siteTerrainUpdate(site, remaining)],
    delete: [river.id as AnyNodeId],
  })
  return { ok: true, message: 'River deleted and its terrain restored.' }
}

function sameRiver(left: RiverNode, right: RiverNode): boolean {
  return (
    left.width === right.width &&
    left.depth === right.depth &&
    left.source === right.source &&
    left.outlet === right.outlet &&
    left.flowDirection === right.flowDirection &&
    left.flowSpeed === right.flowSpeed &&
    left.quality === right.quality &&
    left.shoreline === right.shoreline &&
    left.points.length === right.points.length &&
    left.points.every(
      (point, index) =>
        point[0] === right.points[index]?.[0] && point[1] === right.points[index]?.[1],
    )
  )
}
