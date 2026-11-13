import { riverEditContribution } from './definition.edit'
import { riverRenderDefinition } from './definition.render'

export { riverDeleteTerrainUpdates } from './definition.edit'

/** The full river definition for editing hosts: render half + edit half. */
export const riverDefinition = {
  ...riverRenderDefinition,
  ...riverEditContribution,
}
