import type { ViewerPresentationContribution } from '@pascal-app/viewer'
import { environmentPresentationConfiguration } from './presentation-configuration'

export const environmentPresentation: ViewerPresentationContribution = {
  id: 'pascal:environment:presentation',
  pluginId: 'pascal:environment',
  component: () => import('./presentation-runtime'),
  staticExport: {
    label: 'Surroundings',
    build: (context) =>
      import('./presentation-static-export').then(({ buildStaticEnvironmentPresentation }) =>
        buildStaticEnvironmentPresentation(context),
      ),
  },
  configuration: environmentPresentationConfiguration,
}
