import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import { grassFieldRenderDefinition } from './ground-cover/definition.render'
import { paintTileDefinition } from './paint-tiles/definition'
import { pondRenderDefinition } from './pond/definition.render'
import { riverRenderDefinition } from './river/definition.render'
import { surfaceMaterialRenderDefinition } from './surface-material/definition.render'

export const groundCoverRenderDefinition = grassFieldRenderDefinition
export { grassFieldRenderDefinition, pondRenderDefinition, riverRenderDefinition }
export { surfaceMaterialRenderDefinition }

/**
 * Render-only entry (`@pascal-app/plugin-environment/render`) for read-only
 * viewers. Same plugin id, contract version, kinds, schemas, defaults and bake
 * policy as `environmentPlugin`, with geometry, materials, systems, bake
 * replacement renderers and read-only plans, but without the paint/drawing
 * tools, parameters, floor-plan editing extensions, the Environment panel or
 * anything that imports `@pascal-app/editor`. Load one or the other, not both.
 * `bun run check:render` holds that boundary.
 */
export const environmentRenderPlugin: Plugin = {
  id: 'pascal:environment',
  apiVersion: 1,
  nodes: [
    groundCoverRenderDefinition as unknown as AnyNodeDefinition,
    surfaceMaterialRenderDefinition as unknown as AnyNodeDefinition,
    pondRenderDefinition as unknown as AnyNodeDefinition,
    riverRenderDefinition as unknown as AnyNodeDefinition,
    paintTileDefinition as unknown as AnyNodeDefinition,
  ],
}

// Atmosphere and surroundings: register with the viewer's `registerViewerPresentation`.
export { environmentPresentation } from './presentation'
export {
  ENVIRONMENT_CONFIGURATION_VERSION,
  EnvironmentConfigurationSchema,
  type EnvironmentConfiguration,
  type EnvironmentConfigurationV2,
  exportEnvironmentConfiguration,
  importEnvironmentConfiguration,
} from './presentation-configuration'
export { DEFAULT_SKY_SETTINGS, SKY_PRESETS, type SkySettings } from './atmosphere/settings'
export type { SkyProvider } from './atmosphere/sky-provider'

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
