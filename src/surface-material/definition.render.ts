import type { NodeDefinition } from '@pascal-app/core'
import {
  buildSurfaceMaterialBakeGeometry,
  buildSurfaceMaterialBakeGeometryAsync,
} from './bake-geometry'
import { buildSurfaceMaterialFloorplan } from './floorplan'
import { buildSurfaceMaterialGeometry } from './geometry'
import { SurfaceMaterialNode, SURFACE_MATERIAL_KIND } from './schema'

type SurfaceMaterialDefaults = ReturnType<NodeDefinition<typeof SurfaceMaterialNode>['defaults']>

type SurfaceMaterialRenderDefinition = Omit<
  NodeDefinition<typeof SurfaceMaterialNode>,
  'capabilities' | 'floorplanScope' | 'defaults'
> &
  Record<string, unknown> & {
    /** Without a pose: the schema supplies the origin, and the kind is not placed at a point. */
    defaults: () => Omit<SurfaceMaterialDefaults, 'position' | 'rotation'>
    bakeGeometry: typeof buildSurfaceMaterialBakeGeometry
    bakeGeometryAsync: typeof buildSurfaceMaterialBakeGeometryAsync
    capabilities: NodeDefinition<typeof SurfaceMaterialNode>['capabilities'] & {
      selectionHighlight?: boolean
    }
    floorplanScope: 'site'
  }

/**
 * The painted surface's render half: schema, defaults, terrain-conforming PBR
 * geometry/materials, the surface system, bake replacement and the read-only
 * plan, without `@pascal-app/editor`. The paint tools live in
 * `definition.edit.ts`; `definition.ts` composes both.
 */
export const surfaceMaterialRenderDefinition: SurfaceMaterialRenderDefinition = {
  kind: SURFACE_MATERIAL_KIND,
  schemaVersion: 1,
  schema: SurfaceMaterialNode,
  category: 'furnish',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Surface',
    // No position: the lot's one surface is laid, not placed at a point (see the ground cover).
    textureSize: 100,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    selectionHighlight: false,
    duplicable: false,
    deletable: false,
  },

  geometry: buildSurfaceMaterialGeometry,
  bake: 'replace',
  bakeGeometry: buildSurfaceMaterialBakeGeometry,
  bakeGeometryAsync: buildSurfaceMaterialBakeGeometryAsync,
  bakeReplaceRenderer: { module: () => import('./static-renderer') },
  floorplan: buildSurfaceMaterialFloorplan,
  floorplanScope: 'site',
  system: { module: () => import('./system'), priority: 1 },

  presentation: {
    label: 'Surface',
    description: 'Terrain-conforming painted PBR surface materials.',
    icon: { kind: 'iconify', name: 'lucide:paintbrush' },
    paletteSection: 'furnish',
    hidden: true,
  },

  mcp: {
    description:
      'The lot\'s one ground surface: a four-material blend painted over the terrain, under the Site. It is not placed at a point: lay_ground paints it with the ground it lays; read_environment reads it.',
  },
}
