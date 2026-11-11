import { grassFieldEditContribution } from './definition.edit'
import { grassFieldRenderDefinition } from './definition.render'

/** The full ground-cover definition for editing hosts: render half + edit half. */
export const grassFieldDefinition = {
  ...grassFieldRenderDefinition,
  ...grassFieldEditContribution,
}
