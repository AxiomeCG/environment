import type { ViewerPresentationExportContext } from '@pascal-app/viewer'
import { EnvironmentConfigurationSchema } from './presentation-configuration'
import type { EnvironmentConfiguration } from './presentation-configuration'
import { useEnvironmentStore } from './store'
import { buildStaticSurroundings } from './surroundings/static-export'

export function buildStaticEnvironmentPresentation(context: ViewerPresentationExportContext) {
  const birdsEnabled = useEnvironmentStore.getState().birdsEnabled
  return buildStaticSurroundings(
    context,
    EnvironmentConfigurationSchema.parse(context.configuration) as EnvironmentConfiguration,
    birdsEnabled,
  )
}
