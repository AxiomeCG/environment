import {
  type AnyNode,
  type AnyNodeId,
  generateId,
  type SceneApi,
  type SiteNode,
  terrainFieldOf,
  type TerrainField,
} from '@pascal-app/core'
import {
  analyzePondBasin,
  buildPondSurface,
  nextPondLevel,
  type PondBasin,
  type PondSurface,
  pondSurfaceDepthAt,
} from './basin'
import { pondPropFitsSurface } from './props'
import {
  POND_KIND,
  PondNode,
  type PondNode as PondNodeValue,
  type PondProp,
  type PondShoreline,
  type WaterQuality,
} from './schema'
import type { PondToolTarget } from '../store'

const MAX_POND_PROPS = 128
const MAX_KOI = 32
const MIN_KOI_DEPTH = 0.2
const WET_EPSILON = 1e-4

export type PondLevelAction = 'raise' | 'lower' | 'fill' | 'empty'
export type PondPropKind = PondProp['kind']

export type PondSelectionContext = {
  buildingId: string | null
  levelId: string | null
  zoneId: string | null
  selectedIds: readonly string[]
}

export type PondSceneNodes = Readonly<Record<AnyNodeId, AnyNode>>

export type PondNodeChanges = {
  create?: { node: AnyNode; parentId?: AnyNodeId }[]
  update?: { id: AnyNodeId; data: Partial<AnyNode> }[]
  delete?: AnyNodeId[]
}

export type PondSceneWriter = SceneApi

export type PondTargetInfo = {
  site: SiteNode
  terrain: TerrainField
  basin: PondBasin
  pond: PondNodeValue | null
  connectedPonds: readonly PondNodeValue[]
  surface: PondSurface
  level: number | null
  maxDepth: number
}

export type PondActionResult = {
  ok: boolean
  message: string
  target?: PondToolTarget
}
function applyPondChanges(sceneApi: PondSceneWriter, changes: PondNodeChanges): void {
  if (!sceneApi.applyChanges) {
    throw new Error('Pond edits require SceneApi.applyChanges for an atomic commit.')
  }
  sceneApi.applyChanges(changes)
}

function nodeAt(nodes: PondSceneNodes, id: string | null): AnyNode | undefined {
  return id ? nodes[id as AnyNodeId] : undefined
}

function siteAncestor(nodes: PondSceneNodes, startId: string | null): SiteNode | null {
  let node = nodeAt(nodes, startId)
  const visited = new Set<string>()
  while (node && !visited.has(String(node.id))) {
    if (node.type === 'site') return node as SiteNode
    visited.add(String(node.id))
    node = node.parentId ? nodeAt(nodes, String(node.parentId)) : undefined
  }
  return null
}

export function resolveActivePondSite(
  nodes: PondSceneNodes,
  rootNodeIds: readonly AnyNodeId[],
  selection: PondSelectionContext,
): SiteNode | null {
  for (const selectedId of selection.selectedIds) {
    const site = siteAncestor(nodes, selectedId)
    if (site) return site
  }
  for (const contextualId of [selection.zoneId, selection.levelId, selection.buildingId]) {
    const site = siteAncestor(nodes, contextualId)
    if (site) return site
  }
  for (const rootId of rootNodeIds) {
    const root = nodes[rootId]
    if (root?.type === 'site') return root as SiteNode
  }
  return null
}

export function pondNodeOf(node: unknown): PondNodeValue | null {
  if (!node || typeof node !== 'object' || !('type' in node)) return null
  return node.type === POND_KIND ? (node as PondNodeValue) : null
}

function sitePonds(nodes: PondSceneNodes, siteId: string): PondNodeValue[] {
  const ponds: PondNodeValue[] = []
  for (const node of Object.values(nodes)) {
    const pond = pondNodeOf(node)
    if (!pond || String(pond.parentId) !== siteId) continue
    ponds.push(pond)
  }
  return ponds
}

function connectedPondsForBasin(
  nodes: PondSceneNodes,
  siteId: string,
  basin: PondBasin,
): PondNodeValue[] {
  const spillSurface = buildPondSurface(basin, basin.spillLevel)
  return sitePonds(nodes, siteId).filter(
    (pond) => pondSurfaceDepthAt(spillSurface, pond.seed[0], pond.seed[1]) > WET_EPSILON,
  )
}

function preferredPond(
  ponds: readonly PondNodeValue[],
  preferredId: string | null,
): PondNodeValue | null {
  const preferred = preferredId ? ponds.find((pond) => pond.id === preferredId) : undefined
  if (preferred) return preferred
  let result: PondNodeValue | null = null
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

function effectiveLevel(ponds: readonly PondNodeValue[]): number | null {
  let level: number | null = null
  for (const pond of ponds) {
    if (pond.waterLevel !== null && (level === null || pond.waterLevel > level)) {
      level = pond.waterLevel
    }
  }
  return level
}

function mergedProps(primary: PondNodeValue, ponds: readonly PondNodeValue[]): PondProp[] {
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

export function inspectPondTarget(
  nodes: PondSceneNodes,
  target: PondToolTarget | null,
): PondTargetInfo | null {
  if (!target) return null
  const siteNode = nodeAt(nodes, target.siteId)
  if (siteNode?.type !== 'site') return null
  const site = siteNode as SiteNode
  const terrain = terrainFieldOf(site)
  if (!terrain) return null
  const basin = analyzePondBasin(terrain, site.polygon.points, target.seed)
  if (!basin) return null
  const connectedPonds = connectedPondsForBasin(nodes, target.siteId, basin)
  const pond = preferredPond(connectedPonds, target.pondId)
  const level = effectiveLevel(connectedPonds)
  const surface = buildPondSurface(basin, level)
  return {
    site,
    terrain,
    basin,
    pond,
    connectedPonds,
    surface,
    level: surface.level,
    maxDepth: surface.level === null ? 0 : Math.max(0, surface.level - basin.bottomLevel),
  }
}

export function targetPondAtSeed(
  nodes: PondSceneNodes,
  site: SiteNode,
  seed: readonly [number, number],
): { basin: PondBasin; pond: PondNodeValue | null; target: PondToolTarget } | null {
  const terrain = terrainFieldOf(site)
  if (!terrain) return null
  const basin = analyzePondBasin(terrain, site.polygon.points, seed)
  if (!basin) return null
  const pond = preferredPond(connectedPondsForBasin(nodes, site.id, basin), null)
  return {
    basin,
    pond,
    target: {
      siteId: site.id,
      seed: [basin.seed[0], basin.seed[1]],
      pondId: pond?.id ?? null,
    },
  }
}

function duplicateIds(info: PondTargetInfo): AnyNodeId[] {
  if (!info.pond) return []
  return info.connectedPonds
    .filter((pond) => pond.id !== info.pond?.id)
    .map((pond) => pond.id as AnyNodeId)
}

function updatePrimary(
  scene: PondSceneWriter,
  info: PondTargetInfo,
  patch: Partial<PondNodeValue>,
): void {
  if (!info.pond) return
  const duplicates = duplicateIds(info)
  applyPondChanges(scene, {
    update: [
      {
        id: info.pond.id as AnyNodeId,
        data: patch as unknown as Partial<AnyNode>,
      },
    ],
    ...(duplicates.length > 0 ? { delete: duplicates } : {}),
  })
}

function targetFor(siteId: string, pond: PondNodeValue): PondToolTarget {
  return { siteId, seed: [pond.seed[0], pond.seed[1]], pondId: pond.id }
}

export function commitPondLevelAction(
  scene: PondSceneWriter,
  target: PondToolTarget | null,
  action: PondLevelAction,
  creationQuality: WaterQuality,
): PondActionResult {
  const nodes = scene.nodes()
  const info = inspectPondTarget(nodes, target)
  if (!target) return { ok: false, message: 'Select a terrain depression first.' }
  if (!info) {
    const site = nodeAt(nodes, target.siteId)
    return {
      ok: false,
      message:
        site?.type === 'site' && !terrainFieldOf(site as SiteNode)
          ? 'This Site has no editable terrain. Sculpt a depression first.'
          : 'That depression no longer exists. Select it again.',
    }
  }
  if (!info.pond && (action === 'lower' || action === 'empty')) {
    return { ok: false, message: 'There is no pond water to lower here.' }
  }

  const nextLevel = nextPondLevel(info.basin, info.level, action)
  if (!info.pond) {
    if (nextLevel === null) return { ok: false, message: 'There is no pond water to change.' }
    const pond = PondNode.parse({
      parentId: info.site.id,
      seed: [info.basin.seed[0], info.basin.seed[1]],
      waterLevel: nextLevel,
      quality: creationQuality,
      props: [],
    })
    applyPondChanges(scene, {
      create: [
        {
          node: pond as unknown as AnyNode,
          parentId: info.site.id as AnyNodeId,
        },
      ],
    })
    return {
      ok: true,
      message: `Pond level set to ${formatMetres(nextLevel)}.`,
      target: targetFor(info.site.id, pond),
    }
  }

  const props = mergedProps(info.pond, info.connectedPonds)
  const alreadyAtLevel = nextLevel === info.level
  const duplicates = duplicateIds(info)
  if (alreadyAtLevel && duplicates.length === 0) {
    return {
      ok: false,
      message:
        action === 'raise' || action === 'fill'
          ? 'The pond is already at its spill level.'
          : 'The pond is already empty.',
      target: targetFor(info.site.id, info.pond),
    }
  }
  updatePrimary(scene, info, { waterLevel: nextLevel, props })
  return {
    ok: true,
    message:
      nextLevel === null
        ? 'Pond emptied. Its basin and props are retained.'
        : `Pond level set to ${formatMetres(nextLevel)}.`,
    target: targetFor(info.site.id, info.pond),
  }
}

export function commitPondQuality(
  scene: PondSceneWriter,
  target: PondToolTarget | null,
  quality: WaterQuality,
): PondActionResult {
  const info = inspectPondTarget(scene.nodes(), target)
  if (!info?.pond) {
    return { ok: false, message: 'Quality saved for the next pond you fill.' }
  }
  if (info.pond.quality === quality && info.connectedPonds.length === 1) {
    return { ok: false, message: `Water quality is already ${quality}.` }
  }
  updatePrimary(scene, info, {
    quality,
    waterLevel: info.level,
    props: mergedProps(info.pond, info.connectedPonds),
  })
  return {
    ok: true,
    message: `Water quality changed to ${quality}.`,
    target: targetFor(info.site.id, info.pond),
  }
}

export function commitPondShoreline(
  scene: PondSceneWriter,
  target: PondToolTarget | null,
  shoreline: PondShoreline,
): PondActionResult {
  const info = inspectPondTarget(scene.nodes(), target)
  if (!info?.pond) return { ok: false, message: 'Add water before choosing its bank treatment.' }
  if ((info.pond.shoreline ?? 'soft') === shoreline && info.connectedPonds.length === 1) {
    return { ok: false, message: 'This bank treatment is already selected.' }
  }
  updatePrimary(scene, info, {
    shoreline,
    waterLevel: info.level,
    props: mergedProps(info.pond, info.connectedPonds),
  })
  return {
    ok: true,
    message: shoreline === 'rocky' ? 'Rocky bank added.' : 'Soft bank selected.',
    target: targetFor(info.site.id, info.pond),
  }
}

export function commitPondPropPlacement(
  scene: PondSceneWriter,
  target: PondToolTarget | null,
  kind: PondPropKind,
  position: readonly [number, number],
): PondActionResult {
  const info = inspectPondTarget(scene.nodes(), target)
  if (!info?.pond || info.surface.level === null) {
    return { ok: false, message: 'Fill a selected pond before placing water props.' }
  }
  const depth = pondSurfaceDepthAt(info.surface, position[0], position[1])
  if (depth <= WET_EPSILON) {
    return { ok: false, message: 'Place props on the pond water, inside the shoreline.' }
  }
  if (kind === 'koi' && depth < MIN_KOI_DEPTH) {
    return { ok: false, message: 'Koi need at least 0.20 m of water depth.' }
  }
  const props = mergedProps(info.pond, info.connectedPonds)
  if (props.length >= MAX_POND_PROPS) {
    return { ok: false, message: `This pond has the maximum of ${MAX_POND_PROPS} props.` }
  }
  if (kind === 'koi' && props.filter((prop) => prop.kind === 'koi').length >= MAX_KOI) {
    return { ok: false, message: `This pond has the maximum of ${MAX_KOI} koi.` }
  }
  const prop: PondProp = {
    id: generateId('pond-prop'),
    kind,
    position: [position[0], position[1]],
    yaw: deterministicYaw(position),
    scale: 1,
  }
  if (!pondPropFitsSurface(info.surface, prop)) {
    return {
      ok: false,
      message:
        kind === 'koi'
          ? 'The whole koi must fit inside sufficiently deep pond water.'
          : 'The whole lily must fit inside the shoreline.',
    }
  }
  props.push(prop)
  updatePrimary(scene, info, { waterLevel: info.level, props })
  return {
    ok: true,
    message: kind === 'koi' ? 'Koi placed in the pond.' : 'Water lily placed on the pond.',
    target: targetFor(info.site.id, info.pond),
  }
}

export function commitPondPropRemoval(
  scene: PondSceneWriter,
  target: PondToolTarget | null,
  position: readonly [number, number],
): PondActionResult {
  const info = inspectPondTarget(scene.nodes(), target)
  if (!info?.pond) return { ok: false, message: 'Select a pond with props first.' }
  const props = mergedProps(info.pond, info.connectedPonds)
  let nearest = -1
  let nearestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < props.length; index += 1) {
    const prop = props[index]
    if (!prop) continue
    const dx = prop.position[0] - position[0]
    const dz = prop.position[1] - position[1]
    const distance = dx * dx + dz * dz
    const pickRadius = Math.max(0.45, prop.scale * 0.65)
    if (distance <= pickRadius * pickRadius && distance < nearestDistance) {
      nearest = index
      nearestDistance = distance
    }
  }
  if (nearest < 0) return { ok: false, message: 'No pond prop is close enough to remove.' }
  props.splice(nearest, 1)
  updatePrimary(scene, info, { waterLevel: info.level, props })
  return {
    ok: true,
    message: 'Pond prop removed.',
    target: targetFor(info.site.id, info.pond),
  }
}

export function commitClearPondProps(
  scene: PondSceneWriter,
  target: PondToolTarget | null,
): PondActionResult {
  const info = inspectPondTarget(scene.nodes(), target)
  if (!info?.pond || mergedProps(info.pond, info.connectedPonds).length === 0) {
    return { ok: false, message: 'This pond has no props to clear.' }
  }
  updatePrimary(scene, info, { waterLevel: info.level, props: [] })
  return {
    ok: true,
    message: 'All pond props cleared.',
    target: targetFor(info.site.id, info.pond),
  }
}

export function formatMetres(value: number): string {
  return `${value.toFixed(2)} m`
}

function deterministicYaw(position: readonly [number, number]): number {
  const phase = Math.sin(position[0] * 12.9898 + position[1] * 78.233) * 43758.5453
  return (phase - Math.floor(phase)) * Math.PI * 2
}
