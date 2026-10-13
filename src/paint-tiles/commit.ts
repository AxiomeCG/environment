import type { SceneApi } from '@pascal-app/core'
import type { GrassPaintField } from '../ground-cover/paint-field'
import { paintTilesOf } from './compose'
import { planPaintTileChanges, type PaintTileTarget } from './plan'

export type PaintWriter = Pick<SceneApi, 'nodes' | 'applyChanges'>

/**
 * Commit a paint write (a stroke, a fill) as the tiles it changed: one atomic step, one undo
 * entry, and nothing sent for the rest of the map.
 */
export function commitPaintWrite(
  scene: PaintWriter,
  target: PaintTileTarget,
  before: GrassPaintField,
  after: GrassPaintField,
): void {
  const existing = paintTilesOf(Object.values(scene.nodes()), target.targetId, target.map)
  const changes = planPaintTileChanges(target, existing, before, after)
  if (!changes.create && !changes.update && !changes.delete) return
  if (!scene.applyChanges) {
    throw new Error('Paint commits require SceneApi.applyChanges for an atomic commit.')
  }
  scene.applyChanges(changes)
}
