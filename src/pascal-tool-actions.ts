import { useEditor } from '@pascal-app/editor'
import type { EnvironmentTool } from './environment-selector'
import { POND_KIND } from './pond/schema'
import { RIVER_KIND } from './river/schema'

export type PascalEditorMode = 'build' | 'select' | 'terrain-sculpt'
export type PascalViewMode = '2d' | '3d' | 'split'

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
  viewMode: PascalViewMode
  setMode: (mode: 'build' | 'select') => void
  setTool: (tool: string | null) => void
  setViewMode: (mode: 'split') => void
}

export function activateGroundCoverTool(editor: GroundCoverToolActionTarget): void {
  if (editor.viewMode === '2d') editor.setViewMode('split')
  editor.setTool(GROUND_COVER_TOOL)
  editor.setMode('build')
}

export function activateSurfaceMaterialTool(editor: GroundCoverToolActionTarget): void {
  if (editor.viewMode === '2d') editor.setViewMode('split')
  editor.setTool(SURFACE_MATERIAL_TOOL)
  editor.setMode('build')
}

export function activatePondTool(editor: GroundCoverToolActionTarget): void {
  if (editor.viewMode === '2d') editor.setViewMode('split')
  editor.setTool(POND_TOOL)
  editor.setMode('build')
}

export function activateRiverTool(editor: GroundCoverToolActionTarget): void {
  if (editor.viewMode === '2d') editor.setViewMode('split')
  editor.setTool(RIVER_TOOL)
  editor.setMode('build')
}

export function cancelEnvironmentPaintToolFor2D(
  editor: GroundCoverToolActionTarget,
): boolean {
  if (
    editor.viewMode !== '2d' ||
    editor.mode !== 'build' ||
    (editor.tool !== GROUND_COVER_TOOL &&
      editor.tool !== SURFACE_MATERIAL_TOOL &&
      editor.tool !== POND_TOOL &&
      editor.tool !== RIVER_TOOL)
  ) {
    return false
  }

  editor.setMode('select')
  return true
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
