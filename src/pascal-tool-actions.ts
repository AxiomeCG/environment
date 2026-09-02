import { useEditor } from '@pascal-app/editor'
import type { EnvironmentTool } from './environment-selector'

export type PascalToolActionTarget = Pick<
  ReturnType<typeof useEditor.getState>,
  'setActiveSidebarPanel' | 'setMode'
>

export const GROUND_COVER_TOOL = 'environment:ground-cover'
export const SURFACE_MATERIAL_TOOL = 'environment:surface-material'

export type GroundCoverToolActionTarget = Pick<
  ReturnType<typeof useEditor.getState>,
  'mode' | 'setMode' | 'setViewMode' | 'tool' | 'viewMode'
> & {
  setTool: (tool: string | null) => void
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

export function cancelEnvironmentPaintToolFor2D(
  editor: GroundCoverToolActionTarget,
): boolean {
  if (
    editor.viewMode !== '2d' ||
    editor.mode !== 'build' ||
    (editor.tool !== GROUND_COVER_TOOL && editor.tool !== SURFACE_MATERIAL_TOOL)
  ) {
    return false
  }

  editor.setMode('select')
  return true
}

export const cancelGroundCoverToolFor2D = cancelEnvironmentPaintToolFor2D

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
