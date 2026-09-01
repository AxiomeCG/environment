import { useEditor } from '@pascal-app/editor'
import type { EnvironmentTool } from './environment-selector'

export type PascalToolActionTarget = Pick<
  ReturnType<typeof useEditor.getState>,
  'setActiveSidebarPanel' | 'setMode'
>

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
