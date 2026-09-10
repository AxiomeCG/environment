import type {
  AnyNode,
  AnyNodeId,
  BuildingNode,
  LevelNode,
  SiteNode,
} from '@pascal-app/core'

export type ActivePaintSite = {
  building: BuildingNode
  level: LevelNode
  site: SiteNode
}

export function resolveActivePaintSite(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  activeLevelId: AnyNodeId | null,
): ActivePaintSite | null {
  if (!activeLevelId) return null
  const level = nodes[activeLevelId]
  if (level?.type !== 'level' || !level.parentId) return null
  const building = nodes[level.parentId as AnyNodeId]
  if (building?.type !== 'building' || !building.parentId) return null
  const site = nodes[building.parentId as AnyNodeId]
  return site?.type === 'site' ? { building, level, site } : null
}
