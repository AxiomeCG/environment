import { type GeometryContext, type SiteNode, terrainFieldOf } from '@pascal-app/core'
import { resolveSurfaceMaterialField, type SurfaceMaterialField } from './field'
import { SURFACE_MATERIAL_KIND, type SurfaceMaterialNode } from './schema'
import { siteBounds } from '../ground-cover/paint-field'

export type ResolvedSurfaceMaterial = {
  node: SurfaceMaterialNode
  site: SiteNode
  boundary: SiteNode['polygon']['points']
  field: SurfaceMaterialField
  terrain: ReturnType<typeof terrainFieldOf>
}

export function resolveSurfaceMaterial(
  node: SurfaceMaterialNode,
  context: GeometryContext,
): ResolvedSurfaceMaterial | null {
  const site = context.parent
  if (site?.type !== 'site' || site.polygon.points.length < 3) return null
  return {
    node,
    site,
    boundary: site.polygon.points,
    field: resolveSurfaceMaterialField(node.paintMap, siteBounds(site.polygon.points)),
    terrain: terrainFieldOf(site),
  }
}

export function surfaceMaterialNodeOfSite(
  site: SiteNode,
  context: GeometryContext,
): SurfaceMaterialNode | null {
  for (const childId of site.children) {
    const candidate = context.resolve(childId as never)
    if ((candidate?.type as string | undefined) === SURFACE_MATERIAL_KIND) {
      return candidate as unknown as SurfaceMaterialNode
    }
  }
  return null
}
