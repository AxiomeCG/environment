import type { FloorplanNodeExtension } from '@pascal-app/editor'
import type { EnvironmentEditContribution } from '../edit-contribution'
import { paintTileFloorplanDependencies, paintTilesDeletedWith } from '../paint-tiles/compose'
import type { SurfaceMaterialNode } from './schema'

/** The painted surface's edit half: the 3D and floor-plan paint tools and their hints. */
export const surfaceMaterialEditContribution: EnvironmentEditContribution<
  typeof SurfaceMaterialNode
> & {
  extensions: { 'pascal:editor/floorplan': FloorplanNodeExtension }
} = {
  // Deleting a Surface takes its paint tiles along; it still shows no inspector.
  parametrics: {
    groups: [],
    customPanel: () => import('./no-inspector'),
    onDeleteCascade: paintTilesDeletedWith,
  },
  floorplanDependencies: paintTileFloorplanDependencies,
  tool: () => import('./tool'),
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
      availableModes: ['default', 'expert'],
    },
  },
  toolHints: [
    { key: 'Drag', label: 'Paint surface material' },
    { key: 'Esc', label: 'Cancel stroke or stop' },
  ],
}
