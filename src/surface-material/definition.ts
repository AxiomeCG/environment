import type { NodeDefinition } from '@pascal-app/core'
import {
  buildSurfaceMaterialBakeGeometry,
  buildSurfaceMaterialBakeGeometryAsync,
} from './bake-geometry'
import { buildSurfaceMaterialFloorplan } from './floorplan'
import { buildSurfaceMaterialGeometry } from './geometry'
import { SurfaceMaterialNode, SURFACE_MATERIAL_KIND } from './schema'

type SurfaceMaterialDefinition = Omit<
  NodeDefinition<typeof SurfaceMaterialNode>,
  'capabilities' | 'floorplanScope'
> &
  Record<string, unknown> & {
    bakeGeometry: typeof buildSurfaceMaterialBakeGeometry
    bakeGeometryAsync: typeof buildSurfaceMaterialBakeGeometryAsync
    capabilities: NodeDefinition<typeof SurfaceMaterialNode>['capabilities'] & {
      selectionHighlight?: boolean
    }
    floorplanScope: 'site'
  }

export const surfaceMaterialDefinition: SurfaceMaterialDefinition = {
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
    position: [0, 0, 0],
    rotation: [0, 0, 0],
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
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Drag', label: 'Paint surface material' },
    { key: 'Esc', label: 'Cancel stroke or stop' },
  ],

  presentation: {
    label: 'Surface',
    description: 'Terrain-conforming painted PBR surface materials.',
    icon: { kind: 'iconify', name: 'lucide:paintbrush' },
    paletteSection: 'furnish',
    hidden: true,
  },

  mcp: {
    description: 'Persistent terrain surface painted as a four-material blend.',
  },
}
