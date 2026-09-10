'use client'

import { type AnyNodeId, emitter, raycastTerrain, terrainFieldOf } from '@pascal-app/core'
import {
  markToolCancelConsumed,
  useInteractionScope,
  useRegistryToolContext,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Raycaster, Vector2 } from 'three'
import { useSceneApiNodes } from '../use-scene-api-nodes'
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
import {
  claimPondGesture,
  ensurePondToolScope,
  ownsPondGesture,
  releasePondGesture,
  ownsPondToolScope,
  retainPondToolScope,
} from './interaction'
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
  const { activeLevelId, isCameraDragging, sceneApi, selectNode } = useRegistryToolContext()
  const nodes = useSceneApiNodes(sceneApi)
  const selection = useViewer((state) => state.selection)
  const mode = useEnvironmentStore((state) => state.pondToolMode)
  const target = useEnvironmentStore((state) => state.pondTarget)
  const activeSite = useMemo(
    () =>
      resolveActivePondSite(nodes, [], {
        ...selection,
        selectedIds: activeLevelId ? [] : selection.selectedIds,
        levelId: activeLevelId ? String(activeLevelId) : selection.levelId,
      }),
    [activeLevelId, nodes, selection],
  )
  const info = useMemo(() => inspectPondTarget(nodes, target), [nodes, target])
  const latest = useRef({ activeSite, isCameraDragging, mode, selection, target })
  latest.current = { activeSite, isCameraDragging, mode, selection, target }
  const pointerStart = useRef<PointerStart | null>(null)
  const gestureOwner = useRef(Symbol('pond-3d-gesture'))
  const raycaster = useRef(new Raycaster())
  const pointer = useRef(new Vector2())
  useEffect(() => {
    const releaseScope = retainPondToolScope()
    const unsubscribeScope = useInteractionScope.subscribe(() => {
      if (ownsPondToolScope()) return
      if (pointerStart.current) {
        pointerStart.current = null
        releasePondGesture(gestureOwner.current)
      }
      ensurePondToolScope()
    })
    return () => {
      pointerStart.current = null
      releasePondGesture(gestureOwner.current)
      unsubscribeScope()
      releaseScope()
      useEnvironmentStore.getState().resetPondTool()
    }
  }, [])

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
      releasePondGesture(gestureOwner.current)
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || pointerStart.current || latest.current.isCameraDragging()) return
      if (!claimPondGesture(gestureOwner.current)) return
      const current = latest.current
      if (!current.activeSite) {
        releasePondGesture(gestureOwner.current)
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
      if (dx * dx + dy * dy > CLICK_TOLERANCE_SQUARED || latest.current.isCameraDragging()) {
        start.moved = true
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      const start = pointerStart.current
      if (!start || start.pointerId !== event.pointerId) return
      pointerStart.current = null
      const ownedGesture = ownsPondGesture(gestureOwner.current)
      releasePondGesture(gestureOwner.current)
      const current = latest.current
      if (
        !ownedGesture ||
        start.moved ||
        current.isCameraDragging() ||
        current.activeSite?.id !== start.siteId ||
        current.mode !== start.mode ||
        targetKey(current.target) !== start.targetKey
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
        const resolved = targetPondAtSeed(sceneApi.nodes(), current.activeSite, point)
        if (!resolved) {
          store.setPondTarget(null)
          store.setPondFeedback('No contained depression here. Sculpt a deeper enclosed basin first.')
          useViewer.getState().setSelection({ selectedIds: [] })
          return
        }
        store.setPondTarget(resolved.target)
        if (resolved.pond) {
          store.setPondQuality(resolved.pond.quality)
          selectNode(resolved.pond.id as AnyNodeId)
          store.setPondFeedback('Existing pond selected.')
        } else {
          useViewer.getState().setSelection({ selectedIds: [] })
          store.setPondFeedback('Depression selected. Raise once or fill it to add water.')
        }
        return
      }

      if (!current.target || current.target.siteId !== current.activeSite.id) {
        store.setPondFeedback('Select a pond on the active Site before editing its props.')
        return
      }
      const result =
        start.mode === 'remove-prop'
          ? commitPondPropRemoval(sceneApi, current.target, point)
          : commitPondPropPlacement(sceneApi, current.target, start.mode, point)
      if (result.target) store.setPondTarget(result.target)
      store.setPondFeedback(result.message)
    }

    const handleToolCancel = () => {
      const store = useEnvironmentStore.getState()
      const hadTarget = Boolean(store.pondTarget)
      if (!pointerStart.current && !store.pondTarget && store.pondToolMode === 'select-basin') return
      cancelPointer()
      store.resetPondTool()
      const viewer = useViewer.getState()
      if (
        hadTarget &&
        viewer.selection.selectedIds.some((id) => pondNodeOf(sceneApi.get(id as AnyNodeId)))
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
  }, [camera, gl, sceneApi, selectNode])

  return activeSite ? (
    <PondContours site={activeSite} levelStep={info?.basin.levelStep ?? POND_LEVEL_STEP} selectedLevel={info?.level} />
  ) : null
}

export default PondTool

