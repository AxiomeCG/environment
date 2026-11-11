import type { NodeDefinition } from '@pascal-app/core'
import { buildRiverFloorplan } from './floorplan'
import { buildRiverBakeGeometry, buildRiverBakeGeometryAsync, buildRiverGeometry } from './geometry'
import { RIVER_KIND, RiverNode } from './schema'

type RiverRenderDefinition = Omit<
  NodeDefinition<typeof RiverNode>,
  'capabilities' | 'floorplanScope'
> &
  Record<string, unknown> & {
    bakeGeometry: typeof buildRiverBakeGeometry
    bakeGeometryAsync: typeof buildRiverBakeGeometryAsync
    capabilities: NodeDefinition<typeof RiverNode>['capabilities'] & {
      selectionHighlight?: boolean
    }
    floorplanScope: 'site'
  }

/**
 * The river's render half: schema, defaults, channel/water geometry, the river
 * system, bake replacement and the read-only plan, without
 * `@pascal-app/editor`. Parameters (including the terrain rebuild on delete)
 * and the drawing tools live in `definition.edit.ts`; `definition.ts` composes
 * both.
 */
export const riverRenderDefinition: RiverRenderDefinition = {
  kind: RIVER_KIND,
  schemaVersion: 2,
  schema: RiverNode,
  category: 'furnish',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'River',
    points: [
      [-4, 0],
      [4, 0],
    ],
    width: 4,
    depth: 1,
    source: 'rounded',
    outlet: 'rounded',
    flowDirection: 'forward',
    flowSpeed: 0.6,
    quality: 'clear',
    shoreline: 'soft',
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    selectionHighlight: false,
    duplicable: false,
    deletable: true,
  },

  geometry: buildRiverGeometry,
  bake: 'replace',
  bakeGeometry: buildRiverBakeGeometry,
  bakeGeometryAsync: buildRiverBakeGeometryAsync,
  bakeReplaceRenderer: { module: () => import('./static-renderer') },
  floorplan: buildRiverFloorplan,
  floorplanScope: 'site',
  system: { module: () => import('./system'), priority: 1 },

  presentation: {
    label: 'River',
    description: 'Terrain-carved watercourse with editable channel and reversible flow.',
    icon: { kind: 'iconify', name: 'lucide:route' },
    paletteSection: 'furnish',
    hidden: true,
  },

  mcp: {
    description:
      'A Site-scoped spline river that deterministically carves its channel into terrain.',
  },
}
