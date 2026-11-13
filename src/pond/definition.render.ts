import type { NodeDefinition } from '@pascal-app/core'
import { buildPondFloorplan } from './floorplan'
import { buildPondBakeGeometry, buildPondBakeGeometryAsync, buildPondGeometry } from './geometry'
import { POND_KIND, PondNode } from './schema'

type PondRenderDefinition = Omit<
  NodeDefinition<typeof PondNode>,
  'capabilities' | 'floorplanScope'
> &
  Record<string, unknown> & {
    bakeGeometry: typeof buildPondBakeGeometry
    bakeGeometryAsync: typeof buildPondBakeGeometryAsync
    capabilities: NodeDefinition<typeof PondNode>['capabilities'] & {
      selectionHighlight?: boolean
    }
    floorplanScope: 'site'
  }

/**
 * The pond's render half: schema, defaults, water/basin geometry, the pond
 * system, bake replacement and the read-only plan, without
 * `@pascal-app/editor`. The basin tool lives in `definition.edit.ts`;
 * `definition.ts` composes both.
 */
export const pondRenderDefinition: PondRenderDefinition = {
  kind: POND_KIND,
  schemaVersion: 1,
  schema: PondNode,
  category: 'furnish',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Pond',
    seed: [0, 0],
    waterLevel: null,
    quality: 'clear',
    shoreline: 'soft',
    props: [],
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    selectionHighlight: false,
    duplicable: false,
    deletable: true,
  },

  geometry: buildPondGeometry,
  bake: 'replace',
  bakeGeometry: buildPondBakeGeometry,
  bakeGeometryAsync: buildPondBakeGeometryAsync,
  bakeReplaceRenderer: { module: () => import('./static-renderer') },
  floorplan: buildPondFloorplan,
  floorplanScope: 'site',
  system: { module: () => import('./system'), priority: 1 },

  presentation: {
    label: 'Pond',
    description: 'Terrain-filled pond with editable level, water character, lilies, and koi.',
    icon: { kind: 'iconify', name: 'lucide:waves' },
    paletteSection: 'furnish',
    hidden: true,
  },

  mcp: {
    description: 'A Site-scoped water body solved from terrain depression and spill elevation.',
  },
}
