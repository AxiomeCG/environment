'use client'

import { useFrame, useThree } from '@react-three/fiber'
import { SceneSunScattering, type SceneSunScatteringSource, useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Color } from 'three/webgpu'
import { useEnvironmentStore } from '../store'
import type { SkyProvider } from './sky-provider'
import { usePageVisible } from './weather-preferences'

const SCATTERING_WHITE = new Color(1, 0.97, 0.86)

function smoothStep(low: number, high: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}

function cloudBreakStrength(coverage: number, opticalDensity: number): number {
  const cloudEdge = smoothStep(0.08, 0.3, coverage)
  const overcast = smoothStep(0.68, 0.96, coverage)
  const denseCloud = smoothStep(1.15, 2.8, opticalDensity)
  return cloudEdge * (1 - overcast) * (1 - denseCloud)
}

function ActiveGodRays({
  source,
  amount,
  rain,
  snow,
  storm,
}: {
  source: SkyProvider
  amount: number
  rain: number
  snow: number
  storm: boolean
}) {
  const invalidate = useThree((state) => state.invalidate)
  const renderPaused = useViewer((state) => state.renderPaused)
  const pageVisible = usePageVisible()
  const scattering = useMemo<SceneSunScatteringSource>(
    () => ({ color: new Color(), strength: 0 }),
    [],
  )
  const enabledRef = useRef(false)
  const [enabled, setEnabled] = useState(false)
  const active = pageVisible && !renderPaused

  useEffect(() => {
    if (!active && enabledRef.current) {
      enabledRef.current = false
      scattering.strength = 0
      setEnabled(false)
    }
    invalidate()
  }, [active, amount, invalidate, rain, scattering, snow, storm])

  useFrame(() => {
    const sunHeight = smoothStep(0.015, 0.18, source.sunDirection.y)
    const directLight = source.sunVisibility * Math.max(0, Math.min(1, source.sunIntensity / 1.8))
    const precipitation = (1 - rain * 0.72) * (1 - snow * 0.4)
    const weather = precipitation * (storm ? 0.22 : 1)
    const visibility =
      amount *
      sunHeight *
      directLight *
      cloudBreakStrength(source.cloudCoverage, source.cloudOpticalDensity) *
      weather
    const nextEnabled = active && visibility > 0.002

    scattering.strength = Math.max(0, Math.min(1, visibility))
    scattering.color.copy(source.sunColor).lerp(SCATTERING_WHITE, 0.15)

    if (enabledRef.current !== nextEnabled) {
      enabledRef.current = nextEnabled
      setEnabled(nextEnabled)
      invalidate()
    }
  })

  return enabled ? <SceneSunScattering source={scattering} /> : null
}

export function GodRaysLayer({ source }: { source: SkyProvider }) {
  const amount = useEnvironmentStore((state) => state.skySettings.godRays)
  const rain = useEnvironmentStore((state) => state.weatherSettings.rain)
  const snow = useEnvironmentStore((state) => state.weatherSettings.snow)
  const storm = useEnvironmentStore((state) => state.weatherSettings.storm)

  if (amount <= 0) return null
  return <ActiveGodRays source={source} amount={amount} rain={rain} snow={snow} storm={storm} />
}
