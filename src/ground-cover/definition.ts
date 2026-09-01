import type { NodeDefinition } from '@pascal-app/core'
import { buildGrassFieldGeometry } from './geometry'
import { grassFieldParametrics } from './parametrics'
import { GrassFieldNode } from './schema'

type GrassFieldDefinition = NodeDefinition<typeof GrassFieldNode> & Record<string, unknown>

export const grassFieldDefinition: GrassFieldDefinition = {
  kind: 'environment:ground-cover',
  schemaVersion: 1,
  schema: GrassFieldNode,
  category: 'furnish',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    bladeWidth: 0.06,
    bladeWidthVariation: 20,
    bladeHeight: 0.25,
    bladeHeightVariation: 20,
    bladeTintVariation: 20,
    bladeTipBrightness: 300,
    density: 100,
    windStrength: 100,
    grassWindInfluence: 100,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: false,
    deletable: false,
  },

  parametrics: grassFieldParametrics,
  geometry: buildGrassFieldGeometry,
  system: { module: () => import('./system'), priority: 1 },
  tool: () => import('./tool'),
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
