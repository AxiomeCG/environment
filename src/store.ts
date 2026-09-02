import { create } from 'zustand'
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


export type GroundCoverBrushTool =
  | 'paint-density'
  | 'erase-density'
  | 'smooth-density'
  | 'raise-height'
  | 'lower-height'
  | 'smooth-height'
type SurfaceBrushPatch = Partial<Omit<PaintStrokeSettings, 'color' | 'targetDensity'>>

type EnvironmentStore = {
  activeSection?: EnvironmentTool
  frontageContexts: FrontageContexts
  groundCoverBrush: PaintStrokeSettings
  groundCoverTool: GroundCoverBrushTool
  groundCoverHeightAmount: number
  surfaceBrush: PaintStrokeSettings
  surfaceMaterial: SurfaceMaterialId
  setActiveSection: (section?: EnvironmentTool) => void
  setFrontageSeparator: (index: number, separator: FrontageSeparator) => void
  setGroundCoverBrush: (patch: Partial<PaintStrokeSettings>) => void
  setGroundCoverTool: (tool: GroundCoverBrushTool) => void
  setGroundCoverHeightAmount: (amount: number) => void
  setSurfaceBrush: (patch: SurfaceBrushPatch) => void
  setSurfaceMaterial: (material: SurfaceMaterialId) => void
}

export const useEnvironmentStore = create<EnvironmentStore>((set) => ({
  activeSection: undefined,
  frontageContexts: {},
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
  setActiveSection: (activeSection) => set({ activeSection }),
  setFrontageSeparator: (index, separator) =>
    set((state) => ({
      frontageContexts: withFrontageSeparator(state.frontageContexts, index, separator),
    })),
  setGroundCoverBrush: (patch) =>
    set((state) => ({ groundCoverBrush: { ...state.groundCoverBrush, ...patch } })),
  setGroundCoverTool: (groundCoverTool) => set({ groundCoverTool }),
  setGroundCoverHeightAmount: (groundCoverHeightAmount) =>
    set({ groundCoverHeightAmount }),
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
}))
