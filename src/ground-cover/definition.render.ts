import type { NodeDefinition } from '@pascal-app/core'
import { buildGrassFieldBakeGeometry, buildGrassFieldBakeGeometryAsync } from './bake-geometry'
import { buildGrassFieldFloorplan } from './floorplan'
import { buildGrassFieldGeometry } from './geometry'
import { GrassFieldNode } from './schema'
import { groundCoverStyleDefaults } from './style'

type GrassFieldRenderDefinition = Omit<
  NodeDefinition<typeof GrassFieldNode>,
  'capabilities' | 'floorplanScope'
> &
  Record<string, unknown> & {
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

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
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
    description: 'Prototype GPU ground cover painted as a persistent RGBA density field.',
  },
}
