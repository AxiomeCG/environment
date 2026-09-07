import type { WaterQuality } from './schema'

export type PondWaterAppearance = {
  shallowColor: string
  deepColor: string
  foamColor: string
  foamStrength: number
  roughness: number
  shoreRoughness: number
  rippleStrength: number
  waveScale: number
  speedScale: number
  opacity: readonly [shallow: number, deep: number]
  depthRange: readonly [shallow: number, deep: number]
  shoreAbsorptionDepth: number
  floorplanColor: string
}

export const POND_WATER_APPEARANCE: Readonly<Record<WaterQuality, PondWaterAppearance>> = {
  pure: {
    shallowColor: '#bdeee8',
    deepColor: '#58a7ad',
    foamColor: '#e7f7f1',
    foamStrength: 0.08,
    roughness: 0.14,
    shoreRoughness: 0.3,
    rippleStrength: 0.24,
    waveScale: 1.35,
    speedScale: 0.34,
    opacity: [0.36, 0.56],
    depthRange: [0.05, 1.25],
    shoreAbsorptionDepth: 0.18,
    floorplanColor: '#8bd5cf',
  },
  clear: {
    shallowColor: '#71c6c6',
    deepColor: '#1f6577',
    foamColor: '#c5e4d8',
    foamStrength: 0.18,
    roughness: 0.22,
    shoreRoughness: 0.45,
    rippleStrength: 0.36,
    waveScale: 1.15,
    speedScale: 0.4,
    opacity: [0.44, 0.7],
    depthRange: [0.06, 1.5],
    shoreAbsorptionDepth: 0.12,
    floorplanColor: '#58aeb7',
  },
  deep: {
    shallowColor: '#347d8f',
    deepColor: '#102f48',
    foamColor: '#8fb8b6',
    foamStrength: 0.14,
    roughness: 0.29,
    shoreRoughness: 0.56,
    rippleStrength: 0.44,
    waveScale: 0.88,
    speedScale: 0.32,
    opacity: [0.64, 0.88],
    depthRange: [0.04, 1.1],
    shoreAbsorptionDepth: 0.08,
    floorplanColor: '#286779',
  },
  swampy: {
    shallowColor: '#7f8652',
    deepColor: '#34432a',
    foamColor: '#aaa779',
    foamStrength: 0.04,
    roughness: 0.54,
    shoreRoughness: 0.82,
    rippleStrength: 0.16,
    waveScale: 0.72,
    speedScale: 0.2,
    opacity: [0.72, 0.92],
    depthRange: [0.03, 0.72],
    shoreAbsorptionDepth: 0.055,
    floorplanColor: '#697348',
  },
}
