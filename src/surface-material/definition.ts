import { surfaceMaterialEditContribution } from './definition.edit'
import { surfaceMaterialRenderDefinition } from './definition.render'

/** The full painted-surface definition for editing hosts: render half + edit half. */
export const surfaceMaterialDefinition = {
  ...surfaceMaterialRenderDefinition,
  ...surfaceMaterialEditContribution,
}
