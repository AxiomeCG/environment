import type { GroundCoverBrushTool } from '../store'
import { grassHeightTargetColor } from './height-field'
import type { PaintStrokeSettings } from './paint-stroke'

export function groundCoverPaintSettings(
  tool: GroundCoverBrushTool,
  brush: PaintStrokeSettings,
  heightAmount: number,
): PaintStrokeSettings {
  if (tool === 'paint-density') return { ...brush, mode: 'paint' }
  if (tool === 'erase-density') return { ...brush, mode: 'erase' }
  if (tool === 'smooth-density' || tool === 'smooth-height') {
    return { ...brush, mode: 'smooth' }
  }
  const direction = tool === 'raise-height' ? 'raise' : 'lower'
  return {
    ...brush,
    color: grassHeightTargetColor(direction, heightAmount),
    mode: 'paint',
    premultiplyColorByDensity: false,
    targetDensity: 1,
  }
}

export function groundCoverCursorColor(
  tool: GroundCoverBrushTool,
  settings: PaintStrokeSettings,
): string {
  if (tool === 'erase-density') return '#ef4444'
  if (tool === 'smooth-density' || tool === 'smooth-height') return '#38bdf8'
  return settings.color
}
