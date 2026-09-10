import {
  createSceneApi,
  SiteNode,
  useScene,
  type AnyNode,
  type AnyNodeId,
  type SceneApi,
  type SceneStoreLike,
} from '@pascal-app/core'
import { act, create, type ReactThreeTest } from '@react-three/test-renderer'
import { expect, test } from 'bun:test'
import { useEffect } from 'react'
import { createStore } from 'zustand/vanilla'
import { useSceneApiNodes } from './use-scene-api-nodes'

type TestSceneState = {
  nodes: Record<AnyNodeId, AnyNode>
  rootNodeIds: AnyNodeId[]
  dirtyNodes: Set<AnyNodeId>
  createNode: (node: AnyNode, parentId?: AnyNodeId) => void
  updateNode: (id: AnyNodeId, data: Partial<AnyNode>) => void
  deleteNode: (id: AnyNodeId) => void
  markDirty: (id: AnyNodeId) => void
}

function createTestSceneStore(initialNodes: Record<AnyNodeId, AnyNode>): SceneStoreLike {
  const store = createStore<TestSceneState>((set) => ({
    nodes: initialNodes,
    rootNodeIds: Object.keys(initialNodes) as AnyNodeId[],
    dirtyNodes: new Set<AnyNodeId>(),
    createNode: (node) =>
      set((state) => ({
        nodes: { ...state.nodes, [node.id]: node },
        rootNodeIds: state.rootNodeIds.includes(node.id)
          ? state.rootNodeIds
          : [...state.rootNodeIds, node.id],
      })),
    updateNode: (id, data) =>
      set((state) => {
        const node = state.nodes[id]
        return node ? { nodes: { ...state.nodes, [id]: { ...node, ...data } as AnyNode } } : state
      }),
    deleteNode: (id) =>
      set((state) => ({
        nodes: Object.fromEntries(
          Object.entries(state.nodes).filter(([nodeId]) => nodeId !== id),
        ) as Record<AnyNodeId, AnyNode>,
        rootNodeIds: state.rootNodeIds.filter((nodeId) => nodeId !== id),
      })),
    markDirty: (id) =>
      set((state) => ({ dirtyNodes: new Set([...state.dirtyNodes, id]) })),
  }))
  return Object.assign(store, {
    temporal: { getState: () => ({ pause() {}, resume() {} }) },
  })
}

function SceneNodesProbe({
  sceneApi,
  observe,
}: {
  sceneApi: SceneApi
  observe: (nodes: Readonly<Record<AnyNodeId, AnyNode>>) => void
}) {
  const nodes = useSceneApiNodes(sceneApi)
  useEffect(() => {
    observe(nodes)
  }, [nodes, observe])
  return null
}

test('observes initial and subscribed nodes from the injected SceneApi instead of the global scene', async () => {
  const previousScene = useScene.getState()
  const previousHistory = useScene.temporal.getState()
  const globalSite = SiteNode.parse({ id: 'site_global_decoy' })
  const injectedSite = SiteNode.parse({ id: 'site_injected' })
  const injectedStore = createTestSceneStore({ [injectedSite.id]: injectedSite as AnyNode })
  const sceneApi = createSceneApi(injectedStore)
  const observations: Readonly<Record<AnyNodeId, AnyNode>>[] = []
  const observe = (nodes: Readonly<Record<AnyNodeId, AnyNode>>) => observations.push(nodes)
  let renderer: ReactThreeTest.Renderer | undefined

  try {
    useScene.getState().setScene(
      { [globalSite.id]: globalSite as AnyNode },
      [globalSite.id],
    )
    renderer = await create(<SceneNodesProbe sceneApi={sceneApi} observe={observe} />)

    expect(Object.keys(observations.at(-1) ?? {})).toEqual([injectedSite.id])

    const secondInjectedSite = SiteNode.parse({ id: 'site_injected_subscription' })
    await act(async () => {
      sceneApi.upsert(secondInjectedSite as AnyNode)
    })
    expect(Object.keys(observations.at(-1) ?? {}).sort()).toEqual(
      [injectedSite.id, secondInjectedSite.id].sort(),
    )

    const beforeGlobalMutation = observations.length
    const otherGlobalSite = SiteNode.parse({ id: 'site_global_other' })
    await act(async () => {
      useScene.getState().setScene(
        { [otherGlobalSite.id]: otherGlobalSite as AnyNode },
        [otherGlobalSite.id],
      )
    })
    expect(observations).toHaveLength(beforeGlobalMutation)

  } finally {
    if (renderer) await renderer.unmount()
    useScene.setState(previousScene, true)
    useScene.temporal.setState(previousHistory, true)
  }
})
