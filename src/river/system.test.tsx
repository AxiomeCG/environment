import {
  createSceneApi,
  createTerrainField,
  decodeTerrainField,
  encodeTerrainField,
  SiteNode,
  useScene,
  type AnyNode,
  type AnyNodeId,
  type SceneApi,
} from '@pascal-app/core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createRiver, type RiverNodeChanges } from './actions'
import { RiverNode } from './schema'
import RiverSystem from './system'
import { rebuildRiverTerrain } from './terrain'

// The renderer's CommonJS build requires three. Loading it only after this
// file's ES imports have evaluated three keeps the test independent of which
// test files ran before it (alone, Bun refuses that require mid-evaluation).
const { act, create } = await import('@react-three/test-renderer')

const SITE_ID = 'site_river_system'

/** The 20 m test lot; `heightAt` sets its ground (flat by default). */
function siteWith(heightAt: (x: number) => number = () => 0) {
  const terrain = createTerrainField({ origin: [-10, -10], spacing: 0.5, cols: 41, rows: 41, step: 0.01 })
  for (let row = 0; row < terrain.rows; row += 1) {
    for (let col = 0; col < terrain.cols; col += 1) {
      const x = terrain.origin[0] + col * terrain.spacing
      terrain.heights[row * terrain.cols + col] = Math.round(heightAt(x) / terrain.step)
    }
  }
  return SiteNode.parse({
    id: SITE_ID,
    children: [],
    polygon: {
      type: 'polygon',
      points: [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ],
    },
    terrain: encodeTerrainField(terrain),
  })
}

/** The scene API RiverSystem sees, recording every write it is asked to commit. */
function recordingSceneApi(): { sceneApi: SceneApi; writes: RiverNodeChanges[] } {
  const scene = createSceneApi(useScene)
  const writes: RiverNodeChanges[] = []
  const sceneApi: SceneApi = {
    ...scene,
    applyChanges(changes) {
      writes.push(changes)
      scene.applyChanges?.(changes)
    },
  }
  return { sceneApi, writes }
}

function currentSite() {
  return SiteNode.parse(useScene.getState().nodes[SITE_ID as AnyNodeId])
}

/** Raise terrain columns 0-7 by 2 m (the review's sculpt), keeping the grid. */
function sculptWestEdge(): void {
  const field = decodeTerrainField(currentSite().terrain)
  if (!field) throw new Error('expected persisted terrain')
  const heights = new Int16Array(field.heights)
  for (let row = 0; row < field.rows; row += 1) {
    for (let col = 0; col <= 7; col += 1) {
      const index = row * field.cols + col
      heights[index] = (heights[index] ?? 0) + Math.round(2 / field.step)
    }
  }
  // Written straight to the store, as the terrain sculpt tool does, so it is
  // not counted among RiverSystem's writes.
  createSceneApi(useScene).applyChanges?.({
    update: [
      {
        id: SITE_ID as AnyNodeId,
        data: { terrain: encodeTerrainField({ ...field, heights }) } as Partial<AnyNode>,
      },
    ],
  })
}

const DOWNHILL_RIVER = {
  points: [
    [-8, 0],
    [8, 0],
  ] as const,
  width: 4,
  depth: 1,
  pointWidths: [],
  pointDepths: [],
  source: 'rounded' as const,
  outlet: 'rounded' as const,
  flowDirection: 'forward' as const,
  flowSpeed: 0.6,
  quality: 'clear' as const,
  shoreline: 'soft' as const,
  flow: 'downhill' as const,
  maxSlopePct: 2,
  section: { shape: 'curved' as const, bankSlope: 2, bendAsymmetry: 0, bermM: 0, blendM: 2 },
  ends: { start: 'rounded' as const, end: 'rounded' as const },
}

describe('RiverSystem reconciliation', () => {
  let previousScene = useScene.getState()
  let previousHistory = useScene.temporal.getState()
  beforeEach(() => {
    previousScene = useScene.getState()
    previousHistory = useScene.temporal.getState()
    const site = siteWith()
    useScene.getState().setScene({ [site.id]: site } as Record<AnyNodeId, AnyNode>, [
      site.id as AnyNodeId,
    ])
  })
  afterEach(() => {
    useScene.setState(previousScene, true)
    useScene.temporal.setState(previousHistory, true)
  })

  test('an apply is the only write: reconciliation adds no second one', async () => {
    const { sceneApi, writes } = recordingSceneApi()
    const renderer = await create(<RiverSystem sceneApi={sceneApi} />)
    try {
      await act(async () => {
        expect(createRiver(sceneApi, SITE_ID, DOWNHILL_RIVER).ok).toBe(true)
      })
      expect(writes).toHaveLength(1)
    } finally {
      await renderer.unmount()
    }
  })

  test('sculpting under an applied river re-carves it from the sculpted ground', async () => {
    const { sceneApi, writes } = recordingSceneApi()
    const renderer = await create(<RiverSystem sceneApi={sceneApi} />)
    try {
      await act(async () => {
        createRiver(sceneApi, SITE_ID, DOWNHILL_RIVER)
      })
      const river = RiverNode.parse(
        Object.values(useScene.getState().nodes).find((node) => node.parentId === SITE_ID),
      )
      await act(async () => {
        sculptWestEdge()
      })
      const sculptedThenReconciled = currentSite()
      expect(writes).toHaveLength(2)
      // The reconciled terrain is what a rebuild from the sculpted ground
      // gives: rebuilding it again changes nothing.
      expect(sculptedThenReconciled.terrain).toEqual(
        rebuildRiverTerrain(sculptedThenReconciled, [river]).terrainData,
      )
    } finally {
      await renderer.unmount()
    }
  })

  // Review round 2 input: a path crossing itself at the origin, on ground
  // falling 10 % toward +x, so its two reaches meet at different levels.
  const fallingGround = (x: number) => 2 - 0.1 * x
  const crossingRiver = {
    ...DOWNHILL_RIVER,
    points: [
      [-8, -8],
      [8, 8],
      [-8, 8],
      [8, -8],
    ] as const,
  }

  function setSceneNodes(nodes: readonly AnyNode[]): void {
    useScene.getState().setScene(
      Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>,
      [SITE_ID as AnyNodeId],
    )
  }

  test('a generic edit making a river meet itself at two levels removes its carve', async () => {
    const ground = siteWith(fallingGround)
    setSceneNodes([ground])
    const { sceneApi, writes } = recordingSceneApi()
    const renderer = await create(<RiverSystem sceneApi={sceneApi} />)
    try {
      await act(async () => {
        createRiver(sceneApi, SITE_ID, { ...crossingRiver, flow: 'as_drawn' })
      })
      const river = RiverNode.parse(
        Object.values(useScene.getState().nodes).find((node) => node.parentId === SITE_ID),
      )
      expect(currentSite().terrain).not.toEqual(ground.terrain)

      await act(async () => {
        // A parametric edit goes straight to the scene, past the river actions.
        createSceneApi(useScene).applyChanges?.({
          update: [{ id: river.id as AnyNodeId, data: { flow: 'downhill' } as Partial<AnyNode> }],
        })
      })

      expect(writes).toHaveLength(2)
      expect(currentSite().terrain).toEqual(ground.terrain)
    } finally {
      await renderer.unmount()
    }
  })

  test('loading a saved river that meets itself at two levels removes its carve', async () => {
    const ground = siteWith(fallingGround)
    const asDrawn = RiverNode.parse({ id: 'river_saved_crossing', parentId: SITE_ID, ...crossingRiver, flow: 'as_drawn' })
    const carved = rebuildRiverTerrain(ground, [asDrawn])
    const savedSite = SiteNode.parse({ ...ground, terrain: carved.terrainData, metadata: carved.metadata })
    setSceneNodes([savedSite, { ...asDrawn, flow: 'downhill' } as unknown as AnyNode])
    const { sceneApi, writes } = recordingSceneApi()

    const renderer = await create(<RiverSystem sceneApi={sceneApi} />)
    try {
      expect(writes).toHaveLength(1)
      expect(currentSite().terrain).toEqual(ground.terrain)
    } finally {
      await renderer.unmount()
    }
  })
})
