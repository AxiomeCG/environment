import { useEditor } from '@pascal-app/editor'
import type { EnvironmentTool } from './environment-selector'
import { POND_KIND } from './pond/schema'
import { RIVER_KIND } from './river/schema'

export type PascalEditorMode = 'build' | 'select' | 'terrain-sculpt'

export interface PascalToolActionTarget {
  setActiveSidebarPanel: (panel: 'build') => void
  setMode: (mode: PascalEditorMode) => void
}

export const GROUND_COVER_TOOL = 'environment:ground-cover'
export const SURFACE_MATERIAL_TOOL = 'environment:surface-material'
export const POND_TOOL = POND_KIND
export const RIVER_TOOL = RIVER_KIND

export interface GroundCoverToolActionTarget {
  mode: string
  tool: string | null
  setMode: (mode: 'build' | 'select') => void
  setTool: (tool: string | null) => void
}

export function activateGroundCoverTool(editor: GroundCoverToolActionTarget): void {
  editor.setTool(GROUND_COVER_TOOL)
  editor.setMode('build')
}

export function activateSurfaceMaterialTool(editor: GroundCoverToolActionTarget): void {
  editor.setTool(SURFACE_MATERIAL_TOOL)
  editor.setMode('build')
}

export function activatePondTool(editor: GroundCoverToolActionTarget): void {
  editor.setTool(POND_TOOL)
  editor.setMode('build')
}

export function activateRiverTool(editor: GroundCoverToolActionTarget): void {
  editor.setTool(RIVER_TOOL)
  editor.setMode('build')
}

export function applyPascalShortcut(
  tool: EnvironmentTool,
  editor: PascalToolActionTarget,
): boolean {
  if (tool === 'build') {
    editor.setMode('build')
    editor.setActiveSidebarPanel('build')
    return true
  }

  if (tool === 'terrain') {
    editor.setMode('terrain-sculpt')
    editor.setActiveSidebarPanel('build')
    return true
  }

  return false
}

export function activatePascalShortcut(tool: EnvironmentTool): boolean {
  return applyPascalShortcut(tool, useEditor.getState())
}
