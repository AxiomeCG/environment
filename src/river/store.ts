'use client'

import { create } from 'zustand'
import type { PondShoreline, WaterQuality } from '../pond/schema'
import type { RiverFlowDirection, RiverNode, RiverOutlet, RiverPoint, RiverSource } from './schema'

export type RiverSettings = {
  width: number
  depth: number
  source: RiverSource
  outlet: RiverOutlet
  flowDirection: RiverFlowDirection
  flowSpeed: number
  quality: WaterQuality
  shoreline: PondShoreline
}

export type RiverDraft = {
  siteId: string
  points: RiverPoint[]
  cursor: RiverPoint | null
}

type RiverStore = RiverSettings & {
  draft: RiverDraft | null
  editingRiverId: string | null
  previewRiver: RiverNode | null
  feedback: string
  setSettings: (patch: Partial<RiverSettings>) => void
  beginDraft: (siteId: string) => void
  setDraftPoints: (points: readonly RiverPoint[]) => void
  setDraftCursor: (cursor: RiverPoint | null) => void
  removeLastDraftPoint: () => boolean
  editPath: (riverId: string | null) => void
  setPreviewRiver: (river: RiverNode | null) => void
  setFeedback: (feedback: string) => void
  adoptRiverSettings: (river: RiverNode) => void
  cancelRiverInteraction: () => void
  clearRiverAuthoring: () => void
}

export const DEFAULT_RIVER_SETTINGS: Readonly<RiverSettings> = {
  width: 4,
  depth: 1,
  source: 'rounded',
  outlet: 'rounded',
  flowDirection: 'forward',
  flowSpeed: 0.6,
  quality: 'clear',
  shoreline: 'soft',
}

export const useRiverStore = create<RiverStore>((set, get) => ({
  ...DEFAULT_RIVER_SETTINGS,
  draft: null,
  editingRiverId: null,
  previewRiver: null,
  feedback: '',
  setSettings: (patch) => set(patch),
  beginDraft: (siteId) =>
    set({
      draft: { siteId, points: [], cursor: null },
      editingRiverId: null,
      previewRiver: null,
      feedback: 'Click terrain to place the first river point.',
    }),
  setDraftPoints: (points) =>
    set((state) =>
      state.draft
        ? { draft: { ...state.draft, points: points.map((point) => [point[0], point[1]]) } }
        : state,
    ),
  setDraftCursor: (cursor) =>
    set((state) =>
      state.draft
        ? {
            draft: {
              ...state.draft,
              cursor: cursor ? [cursor[0], cursor[1]] : null,
            },
          }
        : state,
    ),
  removeLastDraftPoint: () => {
    const draft = get().draft
    if (!draft || draft.points.length === 0) return false
    set({ draft: { ...draft, points: draft.points.slice(0, -1) } })
    return true
  },
  editPath: (editingRiverId) =>
    set({
      draft: null,
      editingRiverId,
      previewRiver: null,
      feedback: editingRiverId
        ? 'Drag a control point to reshape the river. Each drag is one undo step.'
        : '',
    }),
  setPreviewRiver: (previewRiver) => set({ previewRiver }),
  setFeedback: (feedback) => set({ feedback }),
  adoptRiverSettings: (river) =>
    set({
      width: river.width,
      depth: river.depth,
      source: river.source,
      outlet: river.outlet,
      flowDirection: river.flowDirection,
      flowSpeed: river.flowSpeed,
      quality: river.quality,
      shoreline: river.shoreline,
    }),
  cancelRiverInteraction: () =>
    set({
      draft: null,
      editingRiverId: null,
      previewRiver: null,
      feedback: '',
    }),
  clearRiverAuthoring: () =>
    set({
      ...DEFAULT_RIVER_SETTINGS,
      draft: null,
      editingRiverId: null,
      previewRiver: null,
      feedback: '',
    }),
}))

export function cancelRiverAuthoring(): void {
  useRiverStore.getState().cancelRiverInteraction()
}

export function clearRiverAuthoring(): void {
  useRiverStore.getState().clearRiverAuthoring()
}
