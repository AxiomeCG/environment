import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import type { EditorHostPanel } from '@pascal-app/editor'
import { ENVIRONMENT_PLUGIN_LOGO } from './art'
import { grassFieldDefinition } from './ground-cover/definition'
import { pondDefinition } from './pond/definition'
import { riverDefinition } from './river/definition'
import { surfaceMaterialDefinition } from './surface-material/definition'

export const groundCoverDefinition = grassFieldDefinition
export { pondDefinition, riverDefinition, surfaceMaterialDefinition }

export const environmentPlugin: Plugin = {
  id: 'pascal:environment',
  apiVersion: 1,
  nodes: [
    groundCoverDefinition as unknown as AnyNodeDefinition,
    surfaceMaterialDefinition as unknown as AnyNodeDefinition,
    pondDefinition as unknown as AnyNodeDefinition,
    riverDefinition as unknown as AnyNodeDefinition,
  ],
}

export const environmentHostPanel: EditorHostPanel = {
  id: 'pascal:environment:catalog',
  label: 'Environment',
  icon: { kind: 'url', src: ENVIRONMENT_PLUGIN_LOGO },
  component: () => import('./panel'),
  kinds: [
    'environment:ground-cover',
    'environment:surface-material',
    'environment:pond',
    'environment:river',
  ],
  pluginId: environmentPlugin.id,
  description: 'Terrain surfaces, ground cover, ponds, and terrain-carved rivers.',
  creator: {
    name: 'Pascal',
    url: 'https://github.com/pascalorg',
  },
  pluginUrl: 'https://github.com/pascalorg/plugin-environment',
  defaultInstalled: true,
}

export { grassFieldDefinition } from './ground-cover/definition'
export { GrassFieldNode, GrassFieldNode as GroundCoverNode } from './ground-cover/schema'
export {
  POND_KIND,
  POND_LEVEL_STEP,
  PondNode,
  type PondProp,
  type PondShoreline,
  type WaterQuality,
} from './pond/schema'
export {
  RIVER_KIND,
  RiverNode,
  type RiverFlowDirection,
  type RiverOutlet,
  type RiverPoint,
  type RiverSource,
} from './river/schema'
export { SurfaceMaterialNode } from './surface-material/schema'
export { default as SurroundingsLayer } from './surroundings/layer'
export { default as AtmosphereLayer } from './atmosphere/layer'
export {
  createSkyProvider,
  createCubemapSkyProvider,
  type SkyProvider,
} from './atmosphere/sky-provider'
export { DEFAULT_SKY_SETTINGS, SKY_PRESETS, type SkySettings } from './atmosphere/settings'
