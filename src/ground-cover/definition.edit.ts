import type { FloorplanNodeExtension } from '@pascal-app/editor'
import type { EnvironmentEditContribution } from '../edit-contribution'
import { paintTileFloorplanDependencies } from '../paint-tiles/compose'
import { grassFieldParametrics } from './parametrics'
import type { GrassFieldNode } from './schema'

/** Ground cover's edit half: parameters, the 3D and floor-plan paint tools and their hints. */
export const grassFieldEditContribution: EnvironmentEditContribution<typeof GrassFieldNode> & {
  extensions: { 'pascal:editor/floorplan': FloorplanNodeExtension }
} = {
  parametrics: grassFieldParametrics,
  floorplanDependencies: paintTileFloorplanDependencies,
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
}
