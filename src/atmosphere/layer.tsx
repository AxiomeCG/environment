'use client'

import { useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { type ComponentType, useEffect, useMemo, useRef } from 'react'
import { useEnvironmentStore } from '../store'
import { wrap } from './settings'
import { createSkyProvider, type SkyProvider } from './sky-provider'

type AtmosphereLayerProps = {
  /** The host supplies its public viewer atmosphere seam; beta.5 does not publish it yet. */
  atmosphereComponent: ComponentType<{ source: SkyProvider }>
}

export default function AtmosphereLayer(props: AtmosphereLayerProps) {
  const enabled = useEnvironmentStore((state) => state.skyEnabled)
  const installed = useScene(
    (state) =>
      !state.hasExplicitPluginInstallState || state.installedPlugins.includes('pascal:environment'),
  )
  const model = useEnvironmentStore((state) => state.skySettings.provider)
  return enabled && installed ? <ActiveAtmosphere key={model} {...props} /> : null
}

function ActiveAtmosphere({ atmosphereComponent: SceneAtmosphere }: AtmosphereLayerProps) {
  const runtime = useMemo(() => ({ ...useEnvironmentStore.getState().skySettings }), [])
  const source = useMemo(() => createSkyProvider(runtime), [runtime])
  const lastSettings = useRef(useEnvironmentStore.getState().skySettings)
  const cloudTime = useRef(0)
  const lastPublished = useRef(0)

  const wasPlaying = useRef(false)
  useEffect(() => () => source.dispose?.(), [source])

  useFrame((_, delta) => {
    const state = useEnvironmentStore.getState()
    const settingsChanged = state.skySettings !== lastSettings.current
    if (settingsChanged) {
      Object.assign(runtime, state.skySettings)
      lastSettings.current = state.skySettings
    }
    const dt = Math.min(delta, 0.1)
    if (state.skyMotion) cloudTime.current += dt
    if (state.skyPlaying) {
      runtime.timeOfDay = wrap(runtime.timeOfDay + (dt * 24) / 120, 24)
      lastPublished.current += dt
      // Shader/light updates run every frame; only the clock readout enters React, at 4 Hz.
      if (lastPublished.current >= 0.25) {
        lastPublished.current = 0
        const settings = { ...state.skySettings, timeOfDay: runtime.timeOfDay }
        lastSettings.current = settings
        useEnvironmentStore.setState({ skySettings: settings })
      }
    } else if (wasPlaying.current && !settingsChanged) {
      const settings = { ...state.skySettings, timeOfDay: runtime.timeOfDay }
      lastSettings.current = settings
      useEnvironmentStore.setState({ skySettings: settings })
    }
    if (settingsChanged || state.skyMotion || state.skyPlaying)
      source.update(runtime, cloudTime.current)
    wasPlaying.current = state.skyPlaying
  }, -2)

  return <SceneAtmosphere source={source} />
}
