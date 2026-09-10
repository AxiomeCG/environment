import {
  createSceneApi,
  createTerrainField,
  encodeTerrainField,
  SiteNode,
  type AnyNode,
  type AnyNodeId,
  type SceneStoreLike,
  type TerrainField,
} from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import {
  commitPondLevelAction,
  commitPondPropPlacement,
  type PondNodeChanges,
  type PondSceneNodes,
} from './actions'
import { POND_KIND, PondNode, type PondProp } from './schema'

const BOUNDARY = [[0, 0], [6, 0], [6, 6], [0, 6]] as const
const BASIN_ROWS = [
  [6, 6, 6, 6, 6, 6, 6],
  [6, 2, 1, 4, 2, 2, 6],
  [6, 1, 0, 4, 2, 7, 6],
  [6, 2, 1, 3, 2, 1, 5],
  [6, 2, 1, 4, 2, 1, 6],
  [6, 3, 2, 4, 3, 2, 6],
  [6, 6, 6, 6, 6, 6, 6],
] as const

function terrainFromRows(rows: readonly (readonly number[])[]): TerrainField {
  const terrain = createTerrainField({
    origin: [0, 0],
    spacing: 1,
    cols: rows[0]?.length ?? 0,
    rows: rows.length,
    step: 1,
  })
  terrain.heights.set(rows.flatMap((row) => row))
  return terrain
}

function pondSite(children: readonly string[] = []) {
  return SiteNode.parse({
    id: 'site_pond_actions',
    children,
    polygon: { type: 'polygon', points: BOUNDARY },
    terrain: encodeTerrainField(terrainFromRows(BASIN_ROWS)),
  })
}

function sceneWith(nodes: readonly unknown[]) {
  const nodeRecord = Object.fromEntries(
    nodes.map((node) => {
      const identified = node as { id: string }
      return [identified.id, node]
    }),
  ) as unknown as PondSceneNodes
  const changes: PondNodeChanges[] = []
  const store: SceneStoreLike = {
    getState: () => ({
      nodes: nodeRecord as Record<AnyNodeId, AnyNode>,
      rootNodeIds: ['site_pond_actions' as AnyNodeId],
      dirtyNodes: new Set<AnyNodeId>(),
      createNode() {},
      updateNode() {},
      deleteNode() {},
      markDirty() {},
      applyNodeChanges: (nextChanges) => changes.push(nextChanges),
    }),
    temporal: { getState: () => ({ pause() {}, resume() {} }) },
  }
  return { scene: createSceneApi(store), changes }
}

function target(pondId: string | null = null, seed: readonly [number, number] = [2, 2]) {
  return {
    siteId: 'site_pond_actions',
    seed,
    pondId,
  }
}

describe('pond scene actions', () => {
  test('does not create a phantom node until water is raised', () => {
    const site = pondSite()
    const { scene, changes } = sceneWith([site])

    const lower = commitPondLevelAction(scene, target(), 'lower', 'clear')
    expect(lower.ok).toBe(false)
    expect(changes).toEqual([])

    const raised = commitPondLevelAction(scene, target(), 'raise', 'deep')
    expect(raised.ok).toBe(true)
    expect(changes).toHaveLength(1)
    const created = changes[0]?.create?.[0]
    expect(created?.parentId).toBe(site.id)
    expect(created?.node).toMatchObject({
      type: POND_KIND,
      parentId: site.id,
      quality: 'deep',
      seed: [2, 2],
      waterLevel: 1,
      props: [],
    })
  })

  test('merges pond records from connected minima without losing their props', () => {
    const first = PondNode.parse({
      id: 'pond_first',
      parentId: 'site_pond_actions',
      seed: [2, 2],
      waterLevel: 1,
      props: [pondProp('lily', 'water-lily')],
    })
    const second = PondNode.parse({
      id: 'pond_second',
      parentId: 'site_pond_actions',
      seed: [5, 3],
      waterLevel: 2,
      props: [pondProp('koi', 'koi')],
    })
    const site = pondSite([first.id, second.id])
    const { scene, changes } = sceneWith([site, first, second])

    const result = commitPondLevelAction(scene, target(first.id), 'fill', 'clear')

    expect(result.ok).toBe(true)
    expect(changes).toHaveLength(1)
    expect(changes[0]?.delete?.map(String)).toEqual([second.id])
    expect(changes[0]?.update?.[0]).toMatchObject({
      id: first.id,
      data: {
        waterLevel: 5,
        props: [
          { id: 'lily', kind: 'water-lily' },
          { id: 'koi', kind: 'koi' },
        ],
      },
    })
  })

  test('keeps below-saddle pond records independently targetable', () => {
    const first = PondNode.parse({
      id: 'pond_shallow_left',
      parentId: 'site_pond_actions',
      seed: [2, 2],
      waterLevel: 2,
    })
    const second = PondNode.parse({
      id: 'pond_shallow_right',
      parentId: 'site_pond_actions',
      seed: [5, 3],
      waterLevel: 1,
    })
    const site = pondSite([first.id, second.id])
    const { scene, changes } = sceneWith([site, first, second])

    const result = commitPondLevelAction(scene, target(second.id, [5, 3]), 'raise', 'clear')

    expect(result.ok).toBe(true)
    expect(changes).toHaveLength(1)
    expect(changes[0]?.delete ?? []).toEqual([])
    expect(changes[0]?.update).toHaveLength(1)
    expect(changes[0]?.update?.[0]).toMatchObject({
      id: second.id,
      data: { waterLevel: 2 },
    })
  })

  test('enforces the koi cap before committing a scene change', () => {
    const props = Array.from({ length: 32 }, (_, index) => pondProp(`koi_${index}`, 'koi'))
    const pond = PondNode.parse({
      id: 'pond_full_of_koi',
      parentId: 'site_pond_actions',
      seed: [2, 2],
      waterLevel: 4,
      props,
    })
    const site = pondSite([pond.id])
    const { scene, changes } = sceneWith([site, pond])

    const result = commitPondPropPlacement(scene, target(pond.id), 'koi', [2, 2])

    expect(result.ok).toBe(false)
    expect(changes).toEqual([])
  })
})

function pondProp(id: string, kind: PondProp['kind']): PondProp {
  return { id, kind, position: [2, 2], yaw: 0, scale: 1 }
}
