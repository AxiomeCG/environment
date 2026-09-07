'use client'

import {
  type AnyNodeId,
  emitter,
  raycastTerrain,
  terrainFieldOf,
  useScene,
} from '@pascal-app/core'
import {
  markToolCancelConsumed,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Raycaster, Vector2 } from 'three'
import { cancelEnvironmentPaintToolFor2D, type GroundCoverToolActionTarget } from '../pascal-tool-actions'
import { useEnvironmentStore, type PondToolTarget } from '../store'
import {
  commitPondPropPlacement,
  commitPondPropRemoval,
  inspectPondTarget,
  pondNodeOf,
  resolveActivePondSite,
  targetPondAtSeed,
  type PondPropKind,
} from './actions'
import { PondContours } from './contours'
import { POND_LEVEL_STEP } from './schema'

const CLICK_TOLERANCE_SQUARED = 25

type PointerStart = {
  pointerId: number
  clientX: number
  clientY: number
  siteId: string
  mode: 'select-basin' | PondPropKind | 'remove-prop'
  targetKey: string
  moved: boolean
}

function targetKey(target: PondToolTarget | null): string {
  return target
    ? `${target.siteId}:${target.pondId ?? ''}:${target.seed[0]}:${target.seed[1]}`
    : ''
}

export function PondTool() {
  const { camera, gl } = useThree()
  const nodes = useScene((state) => state.nodes)
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const selection = useViewer((state) => state.selection)
  const mode = useEnvironmentStore((state) => state.pondToolMode)
  const target = useEnvironmentStore((state) => state.pondTarget)
  const activeSite = useMemo(
    () => resolveActivePondSite(nodes, rootNodeIds, selection),
    [nodes, rootNodeIds, selection],
  )
  const info = useMemo(() => inspectPondTarget(nodes, target), [nodes, target])
  const latest = useRef({ activeSite, mode, selection, target })
  latest.current = { activeSite, mode, selection, target }
  const pointerStart = useRef<PointerStart | null>(null)
  const raycaster = useRef(new Raycaster())
  const pointer = useRef(new Vector2())

  useEffect(() => {
    useInteractionScope.getState().begin({ kind: 'painting' })
    return () => {
      pointerStart.current = null
      const scope = useInteractionScope.getState()
      if (scope.scope.kind === 'painting') scope.end()
      useEnvironmentStore.getState().resetPondTool()
    }
  }, [])

  useEffect(
    () =>
      useEditor.subscribe((editor) => {
        cancelEnvironmentPaintToolFor2D(editor as unknown as GroundCoverToolActionTarget)
      }),
    [],
  )

  useEffect(() => {
    const selected =
      selection.selectedIds.length === 1
        ? pondNodeOf(nodes[selection.selectedIds[0] as AnyNodeId])
        : null
    const store = useEnvironmentStore.getState()
    if (selected?.parentId) {
      const nextTarget: PondToolTarget = {
        siteId: String(selected.parentId),
        seed: [selected.seed[0], selected.seed[1]],
        pondId: selected.id,
      }
      if (targetKey(store.pondTarget) !== targetKey(nextTarget)) store.setPondTarget(nextTarget)
      if (store.pondQuality !== selected.quality) store.setPondQuality(selected.quality)
      return
    }
    if (selection.selectedIds.length > 0 && store.pondTarget) {
      store.setPondTarget(null)
      store.setPondFeedback('Select a terrain depression to edit its water.')
    }
  }, [nodes, selection.selectedIds])

  useEffect(() => {
    const store = useEnvironmentStore.getState()
    const current = store.pondTarget
    if (!current) return
    const siteStillExists = nodes[current.siteId as AnyNodeId]?.type === 'site'
    const pondStillExists = !current.pondId || pondNodeOf(nodes[current.pondId as AnyNodeId])
    if (!siteStillExists || !pondStillExists) {
      store.setPondTarget(null)
      store.setPondFeedback('The selected pond is no longer available.')
      pointerStart.current = null
      return
    }
    if (activeSite && activeSite.id !== current.siteId) {
      store.setPondTarget(null)
      store.setPondFeedback('Select a depression on the active Site.')
      pointerStart.current = null
    }
  }, [activeSite, nodes])

  useEffect(() => {
    const canvas = gl.domElement

    const terrainPoint = (event: PointerEvent): readonly [number, number] | null => {
      const site = latest.current.activeSite
      if (!site) return null
      const terrain = terrainFieldOf(site)
      if (!terrain) return null
      const rect = canvas.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      pointer.current.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.current.setFromCamera(pointer.current, camera)
      const ray = raycaster.current.ray
      const hit = raycastTerrain(
        terrain,
        [ray.origin.x, ray.origin.y, ray.origin.z],
        [ray.direction.x, ray.direction.y, ray.direction.z],
      )
      return hit ? [hit.x, hit.z] : null
    }

    const cancelPointer = () => {
      pointerStart.current = null
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || pointerStart.current || useViewer.getState().cameraDragging) return
      if (useInteractionScope.getState().scope.kind !== 'painting') return
      const current = latest.current
      if (!current.activeSite) {
        useEnvironmentStore.getState().setPondFeedback('Add or select a Site before creating water.')
        return
      }
      pointerStart.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        siteId: current.activeSite.id,
        mode: current.mode,
        targetKey: targetKey(current.target),
        moved: false,
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      const start = pointerStart.current
      if (!start || start.pointerId !== event.pointerId || start.moved) return
      const dx = event.clientX - start.clientX
      const dy = event.clientY - start.clientY
      if (dx * dx + dy * dy > CLICK_TOLERANCE_SQUARED || useViewer.getState().cameraDragging) {
        start.moved = true
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      const start = pointerStart.current
      if (!start || start.pointerId !== event.pointerId) return
      pointerStart.current = null
      const current = latest.current
      if (
        start.moved ||
        useViewer.getState().cameraDragging ||
        current.activeSite?.id !== start.siteId ||
        current.mode !== start.mode ||
        targetKey(current.target) !== start.targetKey ||
        useInteractionScope.getState().scope.kind !== 'painting'
      ) {
        return
      }
      const point = terrainPoint(event)
      const store = useEnvironmentStore.getState()
      if (!point) {
        store.setPondFeedback(
          current.activeSite && !terrainFieldOf(current.activeSite)
            ? 'This Site has no editable terrain. Sculpt a depression first.'
            : 'Click inside the editable terrain.',
        )
        return
      }

      if (start.mode === 'select-basin') {
        const resolved = targetPondAtSeed(useScene.getState().nodes, current.activeSite, point)
        if (!resolved) {
          store.setPondTarget(null)
          store.setPondFeedback('No contained depression here. Sculpt a deeper enclosed basin first.')
          useViewer.getState().setSelection({ selectedIds: [] })
          return
        }
        store.setPondTarget(resolved.target)
        if (resolved.pond) {
          store.setPondQuality(resolved.pond.quality)
          useViewer.getState().setSelection({ selectedIds: [resolved.pond.id as AnyNodeId] })
          store.setPondFeedback('Existing pond selected.')
        } else {
          useViewer.getState().setSelection({ selectedIds: [] })
          store.setPondFeedback('Depression selected. Raise once or fill it to add water.')
        }
        return
      }

      const scene = useScene.getState()
      const result =
        start.mode === 'remove-prop'
          ? commitPondPropRemoval(scene, current.target, point)
          : commitPondPropPlacement(scene, current.target, start.mode, point)
      if (result.target) store.setPondTarget(result.target)
      store.setPondFeedback(result.message)
    }

    const handleToolCancel = () => {
      const store = useEnvironmentStore.getState()
      const hadTarget = Boolean(store.pondTarget)
      if (!pointerStart.current && !store.pondTarget && store.pondToolMode === 'select-basin') return
      pointerStart.current = null
      store.resetPondTool()
      const viewer = useViewer.getState()
      if (
        hadTarget &&
        viewer.selection.selectedIds.some((id) => pondNodeOf(useScene.getState().nodes[id as AnyNodeId]))
      ) {
        viewer.setSelection({ selectedIds: [] })
      }
      markToolCancelConsumed()
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', cancelPointer)
    window.addEventListener('blur', cancelPointer)
    emitter.on('tool:cancel', handleToolCancel)
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', cancelPointer)
      window.removeEventListener('blur', cancelPointer)
      emitter.off('tool:cancel', handleToolCancel)
      cancelPointer()
    }
  }, [camera, gl])

  return activeSite ? (
    <PondContours site={activeSite} levelStep={info?.basin.levelStep ?? POND_LEVEL_STEP} selectedLevel={info?.level} />
  ) : null
}

export default PondTool

