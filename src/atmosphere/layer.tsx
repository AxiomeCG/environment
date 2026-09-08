'use client'

import { useScene } from '@pascal-app/core'
import { useFrame, useThree } from '@react-three/fiber'
import { type ComponentType, useEffect, useMemo, useRef } from 'react'
import { useEnvironmentStore } from '../store'
import { GodRaysLayer } from './god-rays'
import { registerActiveSolar, type ActiveSolarRegistration } from './active-solar'
import { wrap } from './settings'
import { createSkyProvider, type SkyProvider } from './sky-provider'
import { getSceneWeatherSignal } from './weather-signal'
import { weatherRequiresSky } from './weather-sky'
import { WeatherLayer } from './weather'
import { WeatherSurfaces } from './weather-surfaces'

type AtmosphereLayerProps = {
  /** The host supplies its public viewer atmosphere seam; beta.5 does not publish it yet. */
  atmosphereComponent: ComponentType<{ source: SkyProvider }>
}

export default function AtmosphereLayer(props: AtmosphereLayerProps) {
  const enabled = useEnvironmentStore((state) => state.skyEnabled)
  const weatherSettings = useEnvironmentStore((state) => state.weatherSettings)
  const installed = useScene(
    (state) =>
      !state.hasExplicitPluginInstallState || state.installedPlugins.includes('pascal:environment'),
  )
  const model = useEnvironmentStore((state) => state.skySettings.provider)
  const weatherActive = weatherRequiresSky(weatherSettings)
  if (!installed) return null
  return (
    <>
      {enabled || weatherActive ? <ActiveAtmosphere key={model} {...props} /> : null}
      {weatherActive ? <WeatherLayer settings={weatherSettings} /> : null}
      {weatherSettings.rain > 0 || weatherSettings.snow > 0 ? (
        <WeatherSurfaces rain={weatherSettings.rain} snow={weatherSettings.snow} />
      ) : null}
    </>
  )
}

function ActiveAtmosphere({ atmosphereComponent: SceneAtmosphere }: AtmosphereLayerProps) {
  const scene = useThree((state) => state.scene)
  const runtime = useMemo(() => ({ ...useEnvironmentStore.getState().skySettings }), [])
  const weatherSignal = useMemo(() => getSceneWeatherSignal(scene), [scene])
  const weatherRuntime = useMemo(
    () => ({ ...useEnvironmentStore.getState().weatherSettings, flash: weatherSignal.flash }),
    [weatherSignal],
  )
  const source = useMemo(
    () => createSkyProvider(runtime, weatherRuntime),
    [runtime, weatherRuntime],
  )
  const lastSettings = useRef(useEnvironmentStore.getState().skySettings)
  const lastWeatherSettings = useRef(useEnvironmentStore.getState().weatherSettings)
  const lastFlash = useRef(weatherSignal.flash)
  const cloudTime = useRef(0)
  const solarRegistration = useRef<ActiveSolarRegistration | null>(null)
  const lastPublished = useRef(0)

  const wasPlaying = useRef(false)
  useEffect(() => () => source.dispose?.(), [source])
  useEffect(() => {
    const registration = registerActiveSolar(scene, source)
    solarRegistration.current = registration
    return () => {
      if (solarRegistration.current === registration) solarRegistration.current = null
      registration.dispose()
    }
  }, [scene, source])

  useFrame((_, delta) => {
    const state = useEnvironmentStore.getState()
    const settingsChanged = state.skySettings !== lastSettings.current
    const weatherChanged = state.weatherSettings !== lastWeatherSettings.current
    if (settingsChanged) {
      Object.assign(runtime, state.skySettings)
      lastSettings.current = state.skySettings
    }
    if (weatherChanged) {
      Object.assign(weatherRuntime, state.weatherSettings)
      lastWeatherSettings.current = state.weatherSettings
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
    const flashChanged = weatherSignal.flash !== lastFlash.current
    if (settingsChanged || weatherChanged || flashChanged || state.skyMotion || state.skyPlaying) {
      weatherRuntime.flash = weatherSignal.flash
      source.update(runtime, cloudTime.current, weatherRuntime)
      lastFlash.current = weatherSignal.flash
    }
    solarRegistration.current?.publish()
    wasPlaying.current = state.skyPlaying
  }, -2)

  return (
    <>
      <SceneAtmosphere source={source} />
      <GodRaysLayer source={source} />
    </>
  )
}
