import { isIsolationActive, SceneAtmosphere, SceneGroundReplacement } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useState } from 'react'
import AtmosphereLayer from './atmosphere/layer'
import SurroundingsLayer from './surroundings/layer'
import { useEnvironmentStore } from './store'

export default function EnvironmentPresentation() {
  const enabled = useEnvironmentStore((state) => state.environmentEnabled)
  const [isolated, setIsolated] = useState(isIsolationActive)
  // The public isolation API exposes a getter, not a subscription.
  useFrame(() => {
    const next = isIsolationActive()
    if (next !== isolated) setIsolated(next)
  })
  if (!enabled || isolated) return null

  return (
    <>
      <AtmosphereLayer atmosphereComponent={SceneAtmosphere} />
      <SurroundingsLayer groundReplacementComponent={SceneGroundReplacement} />
    </>
  )
}
