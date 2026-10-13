import type { NodeDefinition } from '@pascal-app/core'
import { PAINT_TILE_KIND, PaintTileNode } from './schema'

type PaintTileDefinition = NodeDefinition<typeof PaintTileNode> & Record<string, unknown>

/**
 * Paint tiles have no look of their own: the Ground cover or Surface they paint draws them. They
 * are written only through paint commits, never placed, picked, listed or dirtied.
 */
export const paintTileDefinition: PaintTileDefinition = {
  kind: PAINT_TILE_KIND,
  schemaVersion: 1,
  schema: PaintTileNode,
  category: 'furnish',

  // Never created from a palette; a placeholder 1x1 transparent tile keeps the defaults valid.
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    targetId: 'unassigned',
    map: 'paintMap',
    tile: { type: 'paint-tile', origin: [0, 0], spacing: 1, cols: 1, rows: 1, runs: 'AAAAAAA=' },
  }),

  capabilities: {
    selectable: { hitVolume: 'none' },
    duplicable: false,
    deletable: false,
  },
  dirtyTracking: false,
  // Nothing of its own to bake: its Ground cover or Surface bakes it.
  bake: 'strip',
  tree: { hidden: () => true },

  presentation: {
    label: 'Paint tile',
    description: 'A block of a Ground cover or Surface paint map.',
    icon: { kind: 'iconify', name: 'lucide:grid-2x2' },
    paletteSection: 'furnish',
    hidden: true,
  },

  mcp: {
    description:
      'A 64-cell block of a Ground cover or Surface paint map (targetId, map), run-length coded.',
  },
}
