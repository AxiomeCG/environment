import type { HeightPatch, TerrainField } from '@pascal-app/core'
import type { BufferAttribute } from 'three'

export type TerrainPatchBounds = {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

export function terrainPatchBounds(
  field: TerrainField,
  patch: HeightPatch,
  paddingCells = 1,
): TerrainPatchBounds | null {
  if (patch.cols <= 0 || patch.rows <= 0 || field.cols <= 0 || field.rows <= 0) return null

  const col0 = Math.max(0, patch.col0)
  const row0 = Math.max(0, patch.row0)
  const col1 = Math.min(field.cols - 1, patch.col0 + patch.cols - 1)
  const row1 = Math.min(field.rows - 1, patch.row0 + patch.rows - 1)
  if (col1 < col0 || row1 < row0) return null

  // Core samples only [0, 0] everywhere when either dimension has fewer than two samples.
  if (field.cols < 2 || field.rows < 2) {
    return col0 === 0 && row0 === 0
      ? { minX: -Infinity, minZ: -Infinity, maxX: Infinity, maxZ: Infinity }
      : null
  }

  const padding = Math.max(0, paddingCells)
  const minCol = col0 - padding
  const minRow = row0 - padding
  const maxCol = col1 + padding
  const maxRow = row1 + padding

  // Clamped sampling carries affected borders beyond the finite terrain grid.
  return {
    minX: minCol <= 0 ? -Infinity : field.origin[0] + minCol * field.spacing,
    minZ: minRow <= 0 ? -Infinity : field.origin[1] + minRow * field.spacing,
    maxX: maxCol >= field.cols - 1 ? Infinity : field.origin[0] + maxCol * field.spacing,
    maxZ: maxRow >= field.rows - 1 ? Infinity : field.origin[1] + maxRow * field.spacing,
  }
}

export function queueTerrainAttributeUpdate(
  attribute: BufferAttribute,
  start: number,
  count: number,
): void {
  if (count <= 0) return

  let end = start + count
  // Earlier dabs may not have reached the GPU yet; keep their component ranges pending.
  for (const range of attribute.updateRanges) {
    start = Math.min(start, range.start)
    end = Math.max(end, range.start + range.count)
  }
  attribute.clearUpdateRanges()
  attribute.addUpdateRange(start, end - start)
  attribute.needsUpdate = true
}
