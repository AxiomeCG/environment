import { pondEditContribution } from './definition.edit'
import { pondRenderDefinition } from './definition.render'

/** The full pond definition for editing hosts: render half + edit half. */
export const pondDefinition = {
  ...pondRenderDefinition,
  ...pondEditContribution,
}
