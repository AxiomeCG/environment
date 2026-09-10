import { useScene } from '@pascal-app/core'
import type { SceneGraph } from '@pascal-app/editor'
import type { EnvironmentConfiguration } from '@pascal-app/plugin-environment'
import type { EnvironmentLabCase } from '@pascal-app/plugin-environment/lab/catalog'

export type EnvironmentLabRendererProfile = {
  status: 'ready' | 'unknown'
  backend: 'webgpu' | 'webgl' | 'unknown'
  backendClass: string
  rendererClass: string
  gpu: {
    label: string | null
    features: string[]
  }
  viewport: {
    cssWidth: number
    cssHeight: number
    drawingBufferWidth: number
    drawingBufferHeight: number
    dpr: number
  }
  camera: {
    projection: 'perspective' | 'orthographic' | 'unknown'
    position: [number, number, number]
    target: [number, number, number] | null
    fov?: number
    viewWidth?: number
  }
  time: {
    sampledAt: string
    performanceTimeOriginMs: number
    performanceNowMs: number
    sceneElapsedSeconds: number
  }
}

export type EnvironmentLabReviewRecord = {
  schema: 'pascal-environment-lab-review'
  schemaVersion: 1
  generatedAt: string
  case: {
    id: string
    version: number
    variantId: string
    kind: EnvironmentLabCase['kind']
    featureIds: readonly string[]
  }
  review: {
    checks: Record<string, boolean>
    notes: string
  }
  scene: SceneGraph
  environment: EnvironmentConfiguration
  renderer: EnvironmentLabRendererProfile | { status: 'loading' }
  reproductionCopy: {
    executionClass: 'live-observation'
    fixtureInputs: 'fixed by the case and variant descriptor'
    animation: string
    acceptance: 'NOT-RUN — this local review record is an observation, not a normative baseline'
  }
}

export function readLiveEnvironmentLabScene(): SceneGraph {
  const { nodes, rootNodeIds, collections, materials, installedPlugins } = useScene.getState()
  return structuredClone({
    nodes,
    rootNodeIds,
    collections,
    materials,
    installedPlugins,
  }) as SceneGraph
}

export function downloadEnvironmentLabReview(
  record: EnvironmentLabReviewRecord,
  filename: string,
): void {
  const blob = new Blob([JSON.stringify(record, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.download = filename
  anchor.href = url
  anchor.click()
  URL.revokeObjectURL(url)
}
