import { SceneAtmosphere, SceneGroundReplacement } from '@pascal-app/viewer'
import AtmosphereLayer from './atmosphere/layer'
import SurroundingsLayer from './surroundings/layer'

export default function EnvironmentPresentation() {
  return (
    <>
      <AtmosphereLayer atmosphereComponent={SceneAtmosphere} />
      <SurroundingsLayer groundReplacementComponent={SceneGroundReplacement} />
    </>
  )
}
