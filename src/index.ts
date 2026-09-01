import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import type { EditorHostPanel } from '@pascal-app/editor'
import { grassFieldDefinition } from './ground-cover/definition'

export const groundCoverDefinition = grassFieldDefinition

export const environmentPlugin: Plugin = {
  id: 'pascal:environment',
  apiVersion: 1,
  nodes: [groundCoverDefinition as unknown as AnyNodeDefinition],
}

export const environmentHostPanel: EditorHostPanel = {
  id: 'pascal:environment:catalog',
  label: 'Environment',
  icon: { kind: 'iconify', name: 'lucide:mountain-snow' },
  component: () => import('./panel'),
  kinds: ['environment:ground-cover'],
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
