import { create } from 'zustand'
import { DEFAULT_SKY_SETTINGS, patchSkySettings, type SkySettings } from './atmosphere/settings'
import { rgbToHex } from './ground-cover/paint-field'
import {
  DEFAULT_PAINT_STROKE_SETTINGS,
  type PaintStrokeSettings,
} from './ground-cover/paint-stroke'
import type { EnvironmentTool } from './environment-selector'
import {
  type FrontageContexts,
  type FrontageSeparator,
  withFrontageSeparator,
} from './surroundings/frontages'
import {
  DEFAULT_SURFACE_MATERIAL,
  SURFACE_MATERIAL_PAINT_COLOR,
  type SurfaceMaterialId,
} from './surface-material/material-types'
import type { PondProp, WaterQuality } from './pond/schema'

export type GroundCoverBrushTool =
  | 'paint-density'
  | 'erase-density'
  | 'smooth-density'
  | 'raise-height'
  | 'lower-height'
  | 'smooth-height'
type SurfaceBrushPatch = Partial<Omit<PaintStrokeSettings, 'color' | 'targetDensity'>>

export type PondToolMode = 'select-basin' | PondProp['kind'] | 'remove-prop'

export type PondToolTarget = {
  siteId: string
  seed: readonly [number, number]
  pondId: string | null
}

type EnvironmentStore = {
  activeSection?: EnvironmentTool
  catalogueView: 'catalogue' | 'site'
  waterTab: 'pond' | 'river'
  frontageContexts: FrontageContexts
  ambientMotion: boolean
  birdsEnabled: boolean
  groundCoverBrush: PaintStrokeSettings
  groundCoverTool: GroundCoverBrushTool
  groundCoverHeightAmount: number
  surfaceBrush: PaintStrokeSettings
  surfaceMaterial: SurfaceMaterialId
  surroundingsEnabled: boolean
  surroundingsSeed: string
  skyEnabled: boolean
  skySettings: SkySettings
  skyPlaying: boolean
  skyMotion: boolean
  pondToolMode: PondToolMode
  pondTarget: PondToolTarget | null
  pondQuality: WaterQuality
  pondFeedback: string
  setAmbientMotion: (motion: boolean) => void
  setBirdsEnabled: (enabled: boolean) => void
  setSkyEnabled: (enabled: boolean) => void
  setSkySettings: (patch: Partial<SkySettings>) => void
  setSkyPlaying: (playing: boolean) => void
  setSkyMotion: (motion: boolean) => void
  setActiveSection: (section?: EnvironmentTool) => void
  setCatalogueView: (view: EnvironmentStore['catalogueView']) => void
  setWaterTab: (tab: EnvironmentStore['waterTab']) => void
  setFrontageSeparator: (index: number, separator: FrontageSeparator) => void
  setGroundCoverBrush: (patch: Partial<PaintStrokeSettings>) => void
  setGroundCoverTool: (tool: GroundCoverBrushTool) => void
  setGroundCoverHeightAmount: (amount: number) => void
  setSurfaceBrush: (patch: SurfaceBrushPatch) => void
  setSurfaceMaterial: (material: SurfaceMaterialId) => void
  setSurroundingsEnabled: (enabled: boolean) => void
  setSurroundingsSeed: (seed: string) => void
  setPondToolMode: (mode: PondToolMode) => void
  setPondTarget: (target: PondToolTarget | null) => void
  setPondQuality: (quality: WaterQuality) => void
  setPondFeedback: (feedback: string) => void
  resetPondTool: () => void
}

export const useEnvironmentStore = create<EnvironmentStore>((set) => ({
  activeSection: undefined,
  catalogueView: 'site',
  waterTab: 'pond',
  frontageContexts: {},
  ambientMotion: false,
  birdsEnabled: true,
  groundCoverBrush: {
    ...DEFAULT_PAINT_STROKE_SETTINGS,
    falloff: 0.5,
  },
  groundCoverTool: 'paint-density',
  groundCoverHeightAmount: 50,
  surfaceBrush: {
    ...DEFAULT_PAINT_STROKE_SETTINGS,
    falloff: 0.5,
    color: rgbToHex(SURFACE_MATERIAL_PAINT_COLOR[DEFAULT_SURFACE_MATERIAL]),
    mode: 'paint',
    targetDensity: 1,
  },
  surfaceMaterial: DEFAULT_SURFACE_MATERIAL,
  surroundingsEnabled: true,
  surroundingsSeed: 'pascal-suburbs',
  skyEnabled: false,
  skySettings: { ...DEFAULT_SKY_SETTINGS },
  skyPlaying: false,
  skyMotion: false,
  pondToolMode: 'select-basin',
  pondTarget: null,
  pondQuality: 'clear',
  pondFeedback: '',
  setSkyEnabled: (skyEnabled) =>
    set((state) => ({ skyEnabled, skyPlaying: skyEnabled && state.skyPlaying })),
  setSkySettings: (patch) =>
    set((state) => ({
      skySettings: patchSkySettings(state.skySettings, patch),
      skyPlaying: false,
    })),
  setSkyPlaying: (skyPlaying) =>
    set((state) => ({
      skyPlaying: skyPlaying && state.skyEnabled && state.skySettings.sunMode === 'time',
    })),
  setSkyMotion: (skyMotion) => set({ skyMotion }),
  setAmbientMotion: (ambientMotion) => set({ ambientMotion }),
  setBirdsEnabled: (birdsEnabled) => set({ birdsEnabled }),
  setActiveSection: (activeSection) => set({ activeSection }),
  setCatalogueView: (catalogueView) => set({ catalogueView }),
  setWaterTab: (waterTab) => set({ waterTab }),
  setFrontageSeparator: (index, separator) =>
    set((state) => ({
      frontageContexts: withFrontageSeparator(state.frontageContexts, index, separator),
    })),
  setGroundCoverBrush: (patch) =>
    set((state) => ({ groundCoverBrush: { ...state.groundCoverBrush, ...patch } })),
  setGroundCoverTool: (groundCoverTool) => set({ groundCoverTool }),
  setGroundCoverHeightAmount: (groundCoverHeightAmount) => set({ groundCoverHeightAmount }),
  setSurfaceBrush: (patch) =>
    set((state) => ({ surfaceBrush: { ...state.surfaceBrush, ...patch } })),
  setSurfaceMaterial: (surfaceMaterial) =>
    set((state) => ({
      surfaceMaterial,
      surfaceBrush: {
        ...state.surfaceBrush,
        color: rgbToHex(SURFACE_MATERIAL_PAINT_COLOR[surfaceMaterial]),
        targetDensity: 1,
      },
    })),
  setPondToolMode: (pondToolMode) => set({ pondToolMode, pondFeedback: '' }),
  setPondTarget: (pondTarget) => set({ pondTarget }),
  setPondQuality: (pondQuality) => set({ pondQuality }),
  setPondFeedback: (pondFeedback) => set({ pondFeedback }),
  resetPondTool: () =>
    set({
      pondToolMode: 'select-basin',
      pondTarget: null,
      pondFeedback: '',
    }),
  setSurroundingsEnabled: (surroundingsEnabled) => set({ surroundingsEnabled }),
  setSurroundingsSeed: (surroundingsSeed) => set({ surroundingsSeed }),
}))
