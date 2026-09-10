import {
  ENVIRONMENT_LAB_CASES,
  ENVIRONMENT_LAB_FEATURES,
} from '@pascal-app/plugin-environment/lab/catalog'
import { EnvironmentLabIndex } from '@/components/environment-lab/environment-lab-index'

export default function EnvironmentLabPage() {
  return <EnvironmentLabIndex cases={ENVIRONMENT_LAB_CASES} features={ENVIRONMENT_LAB_FEATURES} />
}
