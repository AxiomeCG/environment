import type { FloorplanNodeExtension } from '@pascal-app/editor'
import type { EnvironmentEditContribution } from '../edit-contribution'
import type { PondNode } from './schema'

/** The pond's edit half: the 3D and floor-plan basin tools and their hints. */
export const pondEditContribution: EnvironmentEditContribution<typeof PondNode> = {
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
}
