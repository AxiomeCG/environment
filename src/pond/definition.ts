import type { NodeDefinition } from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import { buildPondFloorplan } from './floorplan'
import { buildPondBakeGeometry, buildPondBakeGeometryAsync, buildPondGeometry } from './geometry'
import { POND_KIND, PondNode } from './schema'
import type { PondNode as PondNodeValue } from './schema'

type PondDefinition = Omit<NodeDefinition<typeof PondNode>, 'capabilities' | 'floorplanScope'> &
  Record<string, unknown> & {
    bakeGeometry: typeof buildPondBakeGeometry
    bakeGeometryAsync: typeof buildPondBakeGeometryAsync
    capabilities: NodeDefinition<typeof PondNode>['capabilities'] & {
      selectionHighlight?: boolean
    }
    floorplanScope: 'site'
  }

export const pondDefinition: PondDefinition = {
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
  tool: () => import('./tool'),
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
      availableModes: ['default', 'expert'],
    } satisfies FloorplanNodeExtension,
  },
  toolHints: [
    { key: 'Click', label: 'Select a terrain depression' },
    { key: 'Esc', label: 'Cancel basin / stop tool' },
  ],

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
