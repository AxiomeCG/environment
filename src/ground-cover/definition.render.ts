import type { NodeDefinition } from '@pascal-app/core'
import { buildGrassFieldBakeGeometry, buildGrassFieldBakeGeometryAsync } from './bake-geometry'
import { buildGrassFieldFloorplan } from './floorplan'
import { buildGrassFieldGeometry } from './geometry'
import { GrassFieldNode } from './schema'
import { groundCoverStyleDefaults } from './style'

type GrassFieldDefaults = ReturnType<NodeDefinition<typeof GrassFieldNode>['defaults']>

type GrassFieldRenderDefinition = Omit<
  NodeDefinition<typeof GrassFieldNode>,
  'capabilities' | 'floorplanScope' | 'defaults'
> &
  Record<string, unknown> & {
    /** Without a pose: the schema supplies the origin, and the kind is not placed at a point. */
    defaults: () => Omit<GrassFieldDefaults, 'position' | 'rotation'>
    bakeGeometry: typeof buildGrassFieldBakeGeometry
    bakeGeometryAsync: typeof buildGrassFieldBakeGeometryAsync
    capabilities: NodeDefinition<typeof GrassFieldNode>['capabilities'] & {
      selectionHighlight?: boolean
    }
    floorplanScope: 'site'
  }

/**
 * Ground cover's render half: everything a read-only viewer needs to load and
 * draw `environment:ground-cover` without `@pascal-app/editor` (schema,
 * defaults, geometry, the GPU grass system, bake replacement and the read-only
 * plan). The paint tools and parameters live in `definition.edit.ts`;
 * `definition.ts` composes both.
 */
export const grassFieldRenderDefinition: GrassFieldRenderDefinition = {
  kind: 'environment:ground-cover',
  schemaVersion: 4,
  schema: GrassFieldNode,
  category: 'furnish',

  // No position: the lot's one ground cover is laid, not placed at a point. A host's generic
  // placement reads a position here as "placed at a point" and makes an empty node under a level.
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    ...groundCoverStyleDefaults,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    selectionHighlight: false,
    duplicable: false,
    deletable: false,
  },

  geometry: buildGrassFieldGeometry,
  bake: 'replace',
  bakeGeometry: buildGrassFieldBakeGeometry,
  bakeGeometryAsync: buildGrassFieldBakeGeometryAsync,
  bakeReplaceRenderer: { module: () => import('./static-renderer') },
  floorplan: buildGrassFieldFloorplan,
  floorplanScope: 'site',
  system: { module: () => import('./system'), priority: 1 },

  presentation: {
    label: 'Ground Cover',
    description: 'Prototype GPU ground cover transferred from the Pascal Nature plugin.',
    icon: { kind: 'iconify', name: 'lucide:wheat' },
    paletteSection: 'furnish',
    hidden: true,
  },

  mcp: {
    description:
      'The lot\'s one ground cover: GPU grass drawn from a painted density field, under the Site. It is not placed at a point: lay_ground lays it (grass, earth, path or paving over the lot or an area), set_ground_cover_style sets its blades, read_environment reads it.',
  },
}
