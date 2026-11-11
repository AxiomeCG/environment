import type { FloorplanNodeExtension } from '@pascal-app/editor'
import type { EnvironmentEditContribution } from '../edit-contribution'
import type { SurfaceMaterialNode } from './schema'

/** The painted surface's edit half: the 3D and floor-plan paint tools and their hints. */
export const surfaceMaterialEditContribution: EnvironmentEditContribution<
  typeof SurfaceMaterialNode
> & {
  extensions: { 'pascal:editor/floorplan': FloorplanNodeExtension }
} = {
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
