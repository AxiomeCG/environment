import {
  createSceneApi,
  createTerrainField,
  decodeTerrainField,
  encodeTerrainField,
  SiteNode,
  useScene,
  type AnyNode,
  type AnyNodeId,
  subscribeSceneCommits,
  type SceneApi,
  type SceneCommit,
  type SiteNode as SiteNodeType,
} from '@pascal-app/core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createRiver, type RiverNodeChanges } from './actions'
import { readEarlierCarveFixtures } from './earlier-carves'
import { RiverNode } from './schema'
import RiverSystem from './system'
import { rebuildRiverTerrain, riverTerrainBaseline, riverTerrainIsApplied } from './terrain'

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

/** Raise the far corner of a saved Site by 1 m, away from any river, as a later sculpt. */
function sculptCorner(site: SiteNodeType): SiteNodeType {
  const field = decodeTerrainField(site.terrain)
  if (!field) throw new Error('expected persisted terrain')
  const heights = new Int16Array(field.heights)
  for (let row = field.rows - 4; row < field.rows; row += 1) {
    for (let col = field.cols - 4; col < field.cols; col += 1) {
      const index = row * field.cols + col
      heights[index] = (heights[index] ?? 0) + Math.round(1 / field.step)
    }
  }
  return SiteNode.parse({ ...site, terrain: encodeTerrainField({ ...field, heights }) })
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

  describe('saves stamped by an earlier carver, loaded and then mounted late', () => {
    // Sites exactly as the 1436490 carver saved them, frozen in
    // fixtures/earlier-carves.json (provenance in earlier-carves.ts).
    const { savedSites } = readEarlierCarveFixtures()
    let commits: SceneCommit[] = []
    let stopCommits = () => {}
    beforeEach(() => {
      commits = []
      stopCommits = subscribeSceneCommits((commit) => commits.push(commit))
    })
    afterEach(() => stopCommits())

    function savedCase(name: string) {
      const saved = savedSites[name]
      if (!saved) throw new Error(`Missing saved-Site fixture ${name}.`)
      const site = SiteNode.parse(saved.site)
      const rivers = saved.rivers.map((river) => RiverNode.parse(river))
      const baseline = riverTerrainBaseline(site)
      if (!baseline) throw new Error('expected the saved stamp to track a baseline')
      return { site, rivers, ground: encodeTerrainField(baseline) }
    }

    /**
     * What the host does on load: hydrate the scene, then make it the undo
     * floor. Commits from the load itself are not the system's.
     */
    function loadScene(nodes: readonly AnyNode[]): void {
      setSceneNodes(nodes)
      useScene.temporal.getState().clear()
      commits = []
    }

    test('an earlier save whose carve still holds is verified with no write', async () => {
      // Review round 4 input: a straight as-drawn river on ground falling 10 %.
      const { site, rivers } = savedCase('asDrawnStraight')
      loadScene([site, ...(rivers as unknown as AnyNode[])])
      const loadedNodes = useScene.getState().nodes
      const { sceneApi, writes } = recordingSceneApi()

      const renderer = await create(<RiverSystem sceneApi={sceneApi} />)
      try {
        expect(writes).toHaveLength(0)
        expect(useScene.getState().nodes).toBe(loadedNodes)
        expect(useScene.temporal.getState().pastStates).toHaveLength(0)
        expect(commits).toHaveLength(0)
      } finally {
        await renderer.unmount()
      }
    })

    test('a downhill crossing carved before refusals existed is restored with no undo step', async () => {
      // Review round 3 input: the crossing on ground falling 10 % toward +x.
      const { site, rivers, ground } = savedCase('downhillCrossing')
      expect(site.terrain).not.toEqual(ground)
      loadScene([site, ...(rivers as unknown as AnyNode[])])
      const { sceneApi, writes } = recordingSceneApi()

      const renderer = await create(<RiverSystem sceneApi={sceneApi} />)
      try {
        expect(writes).toHaveLength(1)
        expect(currentSite().terrain).toEqual(ground)
        expect(useScene.temporal.getState().pastStates).toHaveLength(0)
        expect(commits).toHaveLength(0)
      } finally {
        await renderer.unmount()
      }
    })

    test('undo after that restore never brings the refused carve back', async () => {
      const { site, rivers, ground } = savedCase('downhillCrossing')
      loadScene([site, ...(rivers as unknown as AnyNode[])])
      // A recorded edit made before the system mounts (the lazy chunk loads late).
      createSceneApi(useScene).applyChanges?.({
        update: [{ id: site.id as AnyNodeId, data: { name: 'Renamed lot' } as Partial<AnyNode> }],
      })
      const { sceneApi } = recordingSceneApi()
      const renderer = await create(<RiverSystem sceneApi={sceneApi} />)
      try {
        expect(useScene.temporal.getState().pastStates).toHaveLength(1)

        await act(async () => {
          useScene.temporal.getState().undo()
        })

        expect(currentSite().name).toBe(site.name)
        expect(currentSite().terrain).toEqual(ground)
        expect(useScene.temporal.getState().pastStates).toHaveLength(0)
        expect(useScene.temporal.getState().futureStates).toHaveLength(1)
      } finally {
        await renderer.unmount()
      }
    })

    test('an earlier stamp is re-carved from its own baseline, keeping later sculpts', async () => {
      const { site, rivers } = savedCase('asDrawnStraight')
      const sculpted = sculptCorner(site)
      loadScene([sculpted, ...(rivers as unknown as AnyNode[])])
      const { sceneApi, writes } = recordingSceneApi()

      const renderer = await create(<RiverSystem sceneApi={sceneApi} />)
      try {
        // A sculpt since the save is an edit: re-carved once, as-drawn carve
        // and sculpt both unchanged, and stamped current.
        expect(writes).toHaveLength(1)
        expect(currentSite().terrain).toEqual(sculpted.terrain)
        expect(riverTerrainIsApplied(currentSite(), rivers)).toBe(true)
      } finally {
        await renderer.unmount()
      }
    })
  })
})
