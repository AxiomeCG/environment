import { create } from 'zustand'
import type { EnvironmentTool } from './environment-selector'
import {
  DEFAULT_PAINT_STROKE_SETTINGS,
  type PaintStrokeSettings,
} from './ground-cover/paint-stroke'

type EnvironmentStore = {
  activeSection?: EnvironmentTool
  groundCoverBrush: PaintStrokeSettings
  setActiveSection: (section?: EnvironmentTool) => void
  setGroundCoverBrush: (patch: Partial<PaintStrokeSettings>) => void
}

export const useEnvironmentStore = create<EnvironmentStore>((set) => ({
  activeSection: undefined,
  groundCoverBrush: { ...DEFAULT_PAINT_STROKE_SETTINGS },
  setActiveSection: (activeSection) => set({ activeSection }),
  setGroundCoverBrush: (patch) =>
    set((state) => ({ groundCoverBrush: { ...state.groundCoverBrush, ...patch } })),
}))
