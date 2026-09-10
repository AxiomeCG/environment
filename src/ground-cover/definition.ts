import type { NodeDefinition } from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import { buildGrassFieldBakeGeometry, buildGrassFieldBakeGeometryAsync } from './bake-geometry'
import { buildGrassFieldFloorplan } from './floorplan'
import { buildGrassFieldGeometry } from './geometry'
import { grassFieldParametrics } from './parametrics'
import {
  DEFAULT_GRASS_BLADE_HEIGHT,
  DEFAULT_GRASS_BLADE_REST_BEND,
  DEFAULT_GRASS_BLADE_WIDTH,
  GrassFieldNode,
} from './schema'

type GrassFieldDefinition = Omit<
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
    extensions: {
      'pascal:editor/floorplan': FloorplanNodeExtension
    }
  }

export const grassFieldDefinition: GrassFieldDefinition = {
  kind: 'environment:ground-cover',
  schemaVersion: 3,
  schema: GrassFieldNode,
  category: 'furnish',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    bladeWidth: DEFAULT_GRASS_BLADE_WIDTH,
    bladeWidthVariation: 20,
    bladeHeight: DEFAULT_GRASS_BLADE_HEIGHT,
    bladeHeightVariation: 20,
    bladeRestBend: DEFAULT_GRASS_BLADE_REST_BEND,
    bladeTintVariation: 20,
    bladeTipBrightness: 300,
    density: 100,
    flowerDensity: 0,
    windStrength: 100,
    grassWindInfluence: 100,
    obstacleBendRadius: 0.75,
    obstacleBendStrength: 0.12,
    obstacleFlattening: 60,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    selectionHighlight: false,
    duplicable: false,
    deletable: false,
  },

  parametrics: grassFieldParametrics,
  geometry: buildGrassFieldGeometry,
  bake: 'replace',
  bakeGeometry: buildGrassFieldBakeGeometry,
  bakeGeometryAsync: buildGrassFieldBakeGeometryAsync,
  bakeReplaceRenderer: { module: () => import('./static-renderer') },
  floorplan: buildGrassFieldFloorplan,
  floorplanScope: 'site',
  system: { module: () => import('./system'), priority: 1 },
  tool: () => import('./tool'),
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
      availableModes: ['default', 'expert'],
    },
  },
  toolHints: [
    { key: 'Drag', label: 'Paint grass' },
    { key: 'Esc', label: 'Cancel stroke or stop' },
  ],

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
