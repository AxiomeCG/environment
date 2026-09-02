import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import type { EditorHostPanel } from '@pascal-app/editor'
import { ENVIRONMENT_PLUGIN_LOGO } from './art'
import { grassFieldDefinition } from './ground-cover/definition'
import { surfaceMaterialDefinition } from './surface-material/definition'

export const groundCoverDefinition = grassFieldDefinition
export { surfaceMaterialDefinition }

export const environmentPlugin: Plugin = {
  id: 'pascal:environment',
  apiVersion: 1,
  nodes: [
    groundCoverDefinition as unknown as AnyNodeDefinition,
    surfaceMaterialDefinition as unknown as AnyNodeDefinition,
  ],
}

export const environmentHostPanel: EditorHostPanel = {
  id: 'pascal:environment:catalog',
  label: 'Environment',
  icon: { kind: 'url', src: ENVIRONMENT_PLUGIN_LOGO },
  component: () => import('./panel'),
  kinds: ['environment:ground-cover', 'environment:surface-material'],
  pluginId: environmentPlugin.id,
  description: 'Ground cover and future terrain-dependent environment tools.',
  creator: {
    name: 'Pascal',
    url: 'https://github.com/pascalorg',
  },
  pluginUrl: 'https://github.com/pascalorg/plugin-environment',
  defaultInstalled: true,
}

export { grassFieldDefinition } from './ground-cover/definition'
export { GrassFieldNode, GrassFieldNode as GroundCoverNode } from './ground-cover/schema'
export { SurfaceMaterialNode } from './surface-material/schema'
export { default as SurroundingsLayer } from './surroundings/layer'
