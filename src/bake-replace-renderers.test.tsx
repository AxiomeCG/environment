import {
  type AnyNode,
  type AnyNodeId,
  type GeometryContext,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import { act, create } from '@react-three/test-renderer'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createElement } from 'react'
import type { Object3D } from 'three'
import GroundCoverStaticRenderer from './ground-cover/static-renderer'
import { GrassFieldNode } from './ground-cover/schema'
import SurfaceMaterialStaticRenderer from './surface-material/static-renderer'
import { SurfaceMaterialNode } from './surface-material/schema'

// The baked viewer mounts each kind's `bakeReplaceRenderer` with an empty
// `useScene`: the graph the artifact was baked from reaches it only through
// `resolve`. Without its parent site a renderer draws nothing.

const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
let savedAct: boolean | undefined
let savedScene: ReturnType<typeof useScene.getState>
let renderer: Awaited<ReturnType<typeof create>> | undefined

beforeEach(() => {
  savedAct = reactGlobal.IS_REACT_ACT_ENVIRONMENT
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = true
  savedScene = useScene.getState()
  useScene.setState({ nodes: {}, rootNodeIds: [], dirtyNodes: new Set() })
})

afterEach(async () => {
  await renderer?.unmount()
  renderer = undefined
  useScene.setState(savedScene, true)
  if (savedAct === undefined) delete reactGlobal.IS_REACT_ACT_ENVIRONMENT
  else reactGlobal.IS_REACT_ACT_ENVIRONMENT = savedAct
})

function publishedGraph(child: AnyNode) {
  const site = SiteNode.parse({
    id: 'site_baked',
    children: [child.id],
    polygon: {
      type: 'polygon',
      points: [
        [-4, -4],
        [4, -4],
        [4, 4],
        [-4, 4],
      ],
    },
  })
  const nodes = { [site.id]: site, [child.id]: child } as Record<string, AnyNode>
  const resolve: GeometryContext['resolve'] = <N = AnyNode>(id: AnyNodeId) =>
    nodes[id] as N | undefined
  return resolve
}

async function mounted(element: ReturnType<typeof createElement>): Promise<Object3D> {
  await act(async () => {
    renderer = await create(element)
  })
  return renderer!.scene.instance as Object3D
}

test('the surface renderer builds from the published graph', async () => {
  // The material's texture loaders create <img> elements; none ever loads here.
  const originalDocument = globalThis.document
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: {
      createElementNS: () => ({
        addEventListener() {},
        removeEventListener() {},
        set src(_value: string) {},
      }),
    } as unknown as Document,
  })
  try {
    const surface = SurfaceMaterialNode.parse({
      id: 'surface-material_baked',
      parentId: 'site_baked',
    })
    const scene = await mounted(
      createElement(SurfaceMaterialStaticRenderer, {
        nodes: [surface],
        resolve: publishedGraph(surface as unknown as AnyNode),
      }),
    )
    expect(scene.getObjectByName('environment-surface-material')).toBeDefined()
  } finally {
    if (originalDocument === undefined) Reflect.deleteProperty(globalThis, 'document')
    else Object.defineProperty(globalThis, 'document', {
      configurable: true,
      writable: true,
      value: originalDocument,
    })
  }
})

test('the ground cover renderer builds from the published graph', async () => {
  const field = GrassFieldNode.parse({ id: 'grass-field_baked', parentId: 'site_baked' })
  const scene = await mounted(
    createElement(GroundCoverStaticRenderer, {
      nodes: [field],
      resolve: publishedGraph(field as unknown as AnyNode),
    }),
  )
  expect(scene.getObjectByName('grass-field-ground')).toBeDefined()
})
