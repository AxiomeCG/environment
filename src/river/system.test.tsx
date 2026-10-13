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
import { act, create } from '@react-three/test-renderer'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createRiver, type RiverNodeChanges } from './actions'
import { RiverNode } from './schema'
import RiverSystem from './system'
import { rebuildRiverTerrain } from './terrain'

const SITE_ID = 'site_river_system'

function flatSite() {
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
    terrain: encodeTerrainField(
      createTerrainField({ origin: [-10, -10], spacing: 0.5, cols: 41, rows: 41, step: 0.01 }),
    ),
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
  beforeEach(() => {
    previousScene = useScene.getState()
    const site = flatSite()
    useScene.getState().setScene({ [site.id]: site } as Record<AnyNodeId, AnyNode>, [
      site.id as AnyNodeId,
    ])
  })
  afterEach(() => {
    useScene.setState(previousScene, true)
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
})
