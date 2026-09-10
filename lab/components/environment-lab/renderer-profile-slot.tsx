'use client'

import { emitter, useScene } from '@pascal-app/core'
import type { SceneGraph } from '@pascal-app/editor'
import type { EnvironmentLabCamera } from '@pascal-app/plugin-environment/lab/catalog'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Vector2, Vector3 } from 'three'
import type { EnvironmentLabRendererProfile } from '@/lib/environment-lab/review'

type RendererProfileReader = () => EnvironmentLabRendererProfile

type RendererProfileSlotProps = {
  camera: EnvironmentLabCamera
  expectedRootNodeIds: SceneGraph['rootNodeIds']
  onProfileChange: (profile: EnvironmentLabRendererProfile) => void
  onProfileReaderChange: (reader: RendererProfileReader | null) => void
  onSceneMounted: () => void
}

type BackendLike = {
  constructor?: { name?: string }
  device?: {
    label?: string
    features?: Iterable<string>
  }
  isWebGLBackend?: boolean
  isWebGPUBackend?: boolean
}

type CameraLike = {
  fov?: number
  isOrthographicCamera?: boolean
  isPerspectiveCamera?: boolean
  left?: number
  position: { x: number; y: number; z: number }
  right?: number
  zoom?: number
}

type ControlsLike = {
  getTarget?: (target: Vector3) => Vector3
}

export function EnvironmentLabRendererProfileSlot({
  camera: initialCamera,
  expectedRootNodeIds,
  onProfileChange,
  onProfileReaderChange,
  onSceneMounted,
}: RendererProfileSlotProps) {
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera) as CameraLike
  const controls = useThree((state) => state.controls) as ControlsLike | null
  const size = useThree((state) => state.size)
  const clock = useThree((state) => state.clock)
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const sceneNodes = useScene((state) => state.nodes)
  const hasAppliedInitialCamera = useRef(false)
  const drawingBufferSize = useMemo(() => new Vector2(), [])
  const cameraTarget = useMemo(() => new Vector3(), [])

  const readProfile = useCallback((): EnvironmentLabRendererProfile => {
    const renderer = gl as typeof gl & {
      backend?: BackendLike
      constructor?: { name?: string }
      getDrawingBufferSize: (target: Vector2) => Vector2
      getPixelRatio: () => number
    }
    const backend = renderer.backend
    const backendClass = backend?.constructor?.name ?? 'unknown'
    const rendererClass = renderer.constructor?.name ?? 'unknown'
    const isWebGpu =
      Boolean(backend?.device) ||
      backend?.isWebGPUBackend === true ||
      backendClass === 'WebGPUBackend'
    const isWebGl = backend?.isWebGLBackend === true || backendClass === 'WebGLBackend'
    const backendName = isWebGpu ? 'webgpu' : isWebGl ? 'webgl' : 'unknown'
    const target = controls?.getTarget ? controls.getTarget(cameraTarget) : null
    const projection = camera.isPerspectiveCamera
      ? 'perspective'
      : camera.isOrthographicCamera
        ? 'orthographic'
        : 'unknown'
    const viewWidth =
      camera.isOrthographicCamera &&
      typeof camera.left === 'number' &&
      typeof camera.right === 'number' &&
      typeof camera.zoom === 'number' &&
      camera.zoom > 0
        ? (camera.right - camera.left) / camera.zoom
        : undefined
    renderer.getDrawingBufferSize(drawingBufferSize)

    return {
      status: backendName === 'unknown' ? 'unknown' : 'ready',
      backend: backendName,
      backendClass,
      rendererClass,
      gpu: {
        label: backend?.device?.label ?? null,
        features: Array.from(backend?.device?.features ?? []),
      },
      viewport: {
        cssWidth: size.width,
        cssHeight: size.height,
        drawingBufferWidth: drawingBufferSize.x,
        drawingBufferHeight: drawingBufferSize.y,
        dpr: renderer.getPixelRatio(),
      },
      camera: {
        projection,
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: target ? [target.x, target.y, target.z] : null,
        ...(typeof camera.fov === 'number' ? { fov: camera.fov } : {}),
        ...(viewWidth === undefined ? {} : { viewWidth }),
      },
      time: {
        sampledAt: new Date().toISOString(),
        performanceTimeOriginMs: performance.timeOrigin,
        performanceNowMs: performance.now(),
        sceneElapsedSeconds: clock.elapsedTime,
      },
    }
  }, [camera, cameraTarget, clock, controls, drawingBufferSize, gl, size.height, size.width])

  useEffect(() => {
    onProfileReaderChange(readProfile)
    onProfileChange(readProfile())
    return () => onProfileReaderChange(null)
  }, [onProfileChange, onProfileReaderChange, readProfile])

  useEffect(() => {
    if (!controls || hasAppliedInitialCamera.current) return
    if (expectedRootNodeIds.length === 0) return
    if (rootNodeIds.length !== expectedRootNodeIds.length) return
    if (!rootNodeIds.every((id) => expectedRootNodeIds.includes(id) && sceneNodes[id])) return

    const level = Object.values(sceneNodes).find((node) => node.type === 'level')
    const building = level?.parentId ? sceneNodes[level.parentId as keyof typeof sceneNodes] : null
    if (!level || building?.type !== 'building') return
    useViewer.getState().setSelection({
      buildingId: building.id,
      levelId: level.id,
      zoneId: null,
      selectedIds: [],
    })

    hasAppliedInitialCamera.current = true
    emitter.emit('camera-controls:apply-pose', {
      position: [...initialCamera.position],
      target: [...initialCamera.target],
      projection: 'perspective',
    })
    onProfileChange(readProfile())
    onSceneMounted()
  }, [
    controls,
    expectedRootNodeIds,
    initialCamera,
    onProfileChange,
    onSceneMounted,
    readProfile,
    rootNodeIds,
    sceneNodes,
  ])

  return null
}
