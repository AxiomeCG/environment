import {
  SiteNode,
  type AnyNode,
  type AnyNodeId,
  type ParametricDescriptor,
} from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import type { EnvironmentEditContribution } from '../edit-contribution'
import { RIVER_KIND, RiverNode, type RiverNode as RiverNodeType } from './schema'
import { rebuildRiverTerrain, riverTerrainRiverIds } from './terrain'

const riverParametrics: ParametricDescriptor<RiverNodeType> = {
  groups: [
    {
      label: 'Channel',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 1, max: 24, step: 0.1 },
        { key: 'depth', kind: 'number', unit: 'm', min: 0.1, max: 8, step: 0.1 },
        {
          key: 'source',
          kind: 'enum',
          options: ['rounded', 'mountain'],
          display: 'segmented',
        },
        {
          key: 'outlet',
          kind: 'enum',
          options: ['rounded', 'sea'],
          display: 'segmented',
        },
      ],
    },
    {
      label: 'Flow',
      fields: [
        {
          key: 'flowDirection',
          kind: 'enum',
          options: ['forward', 'reverse'],
          display: 'segmented',
        },
        { key: 'flowSpeed', kind: 'number', unit: 'm/s', min: 0, max: 3, step: 0.05 },
      ],
    },
    {
      label: 'Appearance',
      fields: [
        {
          key: 'quality',
          kind: 'enum',
          options: ['pure', 'clear', 'deep', 'swampy'],
          display: 'segmented',
        },
        {
          key: 'shoreline',
          kind: 'enum',
          options: ['soft', 'rocky'],
          display: 'segmented',
        },
      ],
    },
  ],
  onDelete: (node, nodes) => riverDeleteTerrainUpdates(node, nodes),
}

export function riverDeleteTerrainUpdates(
  node: RiverNodeType,
  nodes: Record<AnyNodeId, AnyNode>,
): Array<{ id: AnyNodeId; data: Partial<AnyNode> }> {
  if (!node.parentId) return []
  const parsedSite = SiteNode.safeParse(nodes[node.parentId as AnyNodeId])
  if (!parsedSite.success) return []
  const representedRiverIds = riverTerrainRiverIds(parsedSite.data)
  const represented = representedRiverIds ? new Set(representedRiverIds) : null
  const rivers = Object.values(nodes)
    .filter(
      (candidate) =>
        String(candidate.id) !== String(node.id) &&
        candidate.parentId === node.parentId &&
        (candidate.type as string) === RIVER_KIND &&
        (!represented || represented.has(String(candidate.id))),
    )
    .map((candidate) => RiverNode.safeParse(candidate))
    .filter((parsed): parsed is { success: true; data: RiverNodeType } => parsed.success)
    .map((parsed) => parsed.data)
  const rebuilt = rebuildRiverTerrain(parsedSite.data, rivers)
  return [
    {
      id: parsedSite.data.id as AnyNodeId,
      data: {
        terrain: rebuilt.terrainData,
        metadata: rebuilt.metadata,
      } as Partial<AnyNode>,
    },
  ]
}

/**
 * The river's edit half: parameters (deleting a river rebuilds the carved
 * terrain), the 3D and floor-plan drawing tools and their hints.
 */
export const riverEditContribution: EnvironmentEditContribution<typeof RiverNode> = {
  parametrics: riverParametrics,
  tool: () => import('./tool'),
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
      availableModes: ['default', 'expert'],
    } satisfies FloorplanNodeExtension,
  },
  toolHints: [
    { key: 'Click', label: 'Add river point' },
    { key: 'Enter', label: 'Finish river', minDraftVertices: 2 },
    { key: 'Backspace', label: 'Remove last point', minDraftVertices: 2 },
    { key: 'R', label: 'Reverse flow' },
    { key: 'Esc', label: 'Cancel river / stop tool' },
  ],
}
