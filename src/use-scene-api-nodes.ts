'use client'

import type { AnyNode, AnyNodeId, SceneApi } from '@pascal-app/core'
import { useCallback, useSyncExternalStore } from 'react'

const subscribeToNothing = () => () => {}

export function useSceneApiNodes(
  sceneApi: SceneApi,
): Readonly<Record<AnyNodeId, AnyNode>> {
  const subscribe = useCallback(
    (listener: () => void) =>
      sceneApi.subscribeNodes
        ? sceneApi.subscribeNodes(() => listener())
        : subscribeToNothing(),
    [sceneApi],
  )

  return useSyncExternalStore(subscribe, sceneApi.nodes, sceneApi.nodes)
}
