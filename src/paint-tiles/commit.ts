import type { SceneApi } from '@pascal-app/core'
import type { GrassPaintField } from '../ground-cover/paint-field'
import { onSameLattice, paintTilesOf } from './compose'
import { resolvePaintedMap } from './layers'
import { planPaintTileChanges, type PaintTileTarget } from './plan'

export type PaintWriter = Pick<SceneApi, 'nodes' | 'applyChanges'>

/** `current` with the cells the write changed (from `before` to `after`) taken from `after`. */
function withWrittenCells(
  current: GrassPaintField,
  before: GrassPaintField,
  after: GrassPaintField,
): GrassPaintField {
  const values = new Uint8Array(current.values)
  for (let offset = 0; offset < values.length; offset += 4) {
    if (
      before.values[offset] !== after.values[offset] ||
      before.values[offset + 1] !== after.values[offset + 1] ||
      before.values[offset + 2] !== after.values[offset + 2] ||
      before.values[offset + 3] !== after.values[offset + 3]
    ) {
      values.set(after.values.subarray(offset, offset + 4), offset)
    }
  }
  return { ...current, values }
}

/**
 * Commit a paint write (a stroke, a fill) as the tiles it changed: one atomic step, one undo
 * entry, and nothing sent for the rest of the map. Only the cells the write changed are written
 * over the map as the scene holds it now, so paint that landed since the write began (another
 * person's, the agent's) survives in the tiles they share.
 */
export function commitPaintWrite(
  scene: PaintWriter,
  target: PaintTileTarget,
  before: GrassPaintField,
  after: GrassPaintField,
): void {
  const nodes = scene.nodes()
  const current = resolvePaintedMap(nodes, target)
  const base = current && onSameLattice(current, before) ? current : before
  const written = base === before ? after : withWrittenCells(base, before, after)
  const existing = paintTilesOf(Object.values(nodes), target.targetId, target.map)
  const changes = planPaintTileChanges(target, existing, base, written)
  if (!changes.create && !changes.update && !changes.delete) return
  if (!scene.applyChanges) {
    throw new Error('Paint commits require SceneApi.applyChanges for an atomic commit.')
  }
  scene.applyChanges(changes)
}
