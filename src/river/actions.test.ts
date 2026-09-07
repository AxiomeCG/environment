import {
  createTerrainField,
  encodeTerrainField,
  persistedTerrainFieldOf,
  SiteNode,
  surfaceHeightAt,
  type AnyNode,
  type AnyNodeId,
  type SiteNode as SiteNodeValue,
} from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import {
  createRiver,
  deleteRiver,
  updateRiver,
  type RiverNodeChanges,
  type RiverSceneWriter,
} from './actions'
import { RiverNode } from './schema'

const SITE_ID = 'site_river_actions'
const BOUNDARY = [
  [0, 0],
  [16, 0],
  [16, 16],
  [0, 16],
] as const

function flatSite() {
  const terrain = createTerrainField({
    origin: [0, 0],
    spacing: 1,
    cols: 17,
    rows: 17,
    step: 0.01,
  })
  terrain.heights.fill(200)
  return SiteNode.parse({
    id: SITE_ID,
    children: [],
    polygon: { type: 'polygon', points: BOUNDARY },
    terrain: encodeTerrainField(terrain),
    metadata: { retained: 'site metadata' },
  })
}

function mutableScene(site: SiteNodeValue) {
  const nodes = { [site.id]: site } as unknown as Record<AnyNodeId, AnyNode>
  const commits: RiverNodeChanges[] = []
  const scene: RiverSceneWriter = {
    nodes,
    rootNodeIds: [site.id as AnyNodeId],
    applyNodeChanges: (changes) => {
      commits.push(changes)
      for (const update of changes.update ?? []) {
        const current = nodes[update.id]
        if (current) nodes[update.id] = { ...current, ...update.data } as AnyNode
      }
      for (const creation of changes.create ?? []) {
        nodes[creation.node.id] = creation.node
        if (creation.parentId) {
          const parent = nodes[creation.parentId]
          if (parent?.type === 'site') {
            nodes[creation.parentId] = {
              ...parent,
              children: [...parent.children, creation.node.id],
            } as AnyNode
          }
        }
      }
      for (const id of changes.delete ?? []) {
        const deleted = nodes[id]
        if (deleted?.parentId) {
          const parentId = deleted.parentId as AnyNodeId
          const parent = nodes[parentId]
          if (parent?.type === 'site') {
            nodes[parentId] = {
              ...parent,
              children: parent.children.filter((childId) => childId !== id),
            } as AnyNode
          }
        }
        delete nodes[id]
      }
    },
  }
  return { commits, nodes, scene }
}

const DEFAULTS = {
  width: 4,
  depth: 1,
  source: 'rounded' as const,
  outlet: 'rounded' as const,
  flowDirection: 'forward' as const,
  flowSpeed: 0.6,
  quality: 'clear' as const,
  shoreline: 'soft' as const,
}

describe('river authoring scene actions', () => {
  test('creates, revises without compounding, and deletes with terrain restoration', () => {
    const originalSite = flatSite()
    const originalTerrain = persistedTerrainFieldOf(originalSite)!
    const { commits, nodes, scene } = mutableScene(originalSite)

    const created = createRiver(scene, SITE_ID, {
      ...DEFAULTS,
      points: [
        [2, 8],
        [14, 8],
      ],
    })

    expect(created.ok).toBe(true)
    expect(commits).toHaveLength(1)
    expect(created.river).toBeDefined()
    const createdSite = nodes[SITE_ID as AnyNodeId]
    expect(createdSite?.type).toBe('site')
    const firstTerrain = persistedTerrainFieldOf(createdSite as typeof originalSite)!
    const firstBed = surfaceHeightAt(firstTerrain, 8, 8)
    expect(firstBed).toBeLessThan(surfaceHeightAt(originalTerrain, 8, 8))
    expect((createdSite?.metadata as Record<string, unknown>).retained).toBe('site metadata')

    const widened = updateRiver(scene, created.river!.id, { width: 8 })

    expect(widened.ok).toBe(true)
    expect(commits).toHaveLength(2)
    const widenedTerrain = persistedTerrainFieldOf(
      nodes[SITE_ID as AnyNodeId] as typeof originalSite,
    )!
    expect(surfaceHeightAt(widenedTerrain, 8, 8)).toBeCloseTo(firstBed, 5)
    expect(surfaceHeightAt(widenedTerrain, 8, 11)).toBeLessThan(
      surfaceHeightAt(originalTerrain, 8, 11),
    )

    const siteBeforeFlowEdit = nodes[SITE_ID as AnyNodeId]
    const reversed = updateRiver(scene, created.river!.id, {
      flowDirection: 'reverse',
      flowSpeed: 1.4,
    })

    expect(reversed.ok).toBe(true)
    expect(commits).toHaveLength(3)
    expect(RiverNode.parse(nodes[created.river!.id as AnyNodeId]).flowDirection).toBe('reverse')
    expect(nodes[SITE_ID as AnyNodeId]).toBe(siteBeforeFlowEdit)

    const removed = deleteRiver(scene, created.river!.id)

    expect(removed.ok).toBe(true)
    expect(commits).toHaveLength(4)
    expect(nodes[created.river!.id as AnyNodeId]).toBeUndefined()
    const restoredSite = nodes[SITE_ID as AnyNodeId]
    const restoredTerrain = persistedTerrainFieldOf(restoredSite as typeof originalSite)!
    expect([...restoredTerrain.heights]).toEqual([...originalTerrain.heights])
    expect(
      (restoredSite?.metadata as Record<string, unknown>).environmentRiverTerrain,
    ).toBeUndefined()
    expect((restoredSite?.metadata as Record<string, unknown>).retained).toBe('site metadata')
  })

  test('creates editable terrain when a Site starts flat and unencoded', () => {
    const site: SiteNodeValue = { ...flatSite(), terrain: undefined }
    const { commits, nodes, scene } = mutableScene(site)

    const result = createRiver(scene, SITE_ID, {
      ...DEFAULTS,
      points: [
        [2, 8],
        [14, 8],
      ],
    })

    expect(result.ok).toBe(true)
    expect(commits).toHaveLength(1)
    const updatedSite = nodes[SITE_ID as AnyNodeId]
    expect(updatedSite?.type).toBe('site')
    expect(persistedTerrainFieldOf(updatedSite as SiteNodeValue)).not.toBeNull()
  })

  test('rebuilds the Site cut when a rounded endpoint becomes boundary-connected', () => {
    const originalSite = flatSite()
    const { nodes, scene } = mutableScene(originalSite)
    const created = createRiver(scene, SITE_ID, {
      ...DEFAULTS,
      points: [
        [4, 8],
        [12, 8],
      ],
      width: 4,
    })
    const roundedTerrain = persistedTerrainFieldOf(
      nodes[SITE_ID as AnyNodeId] as typeof originalSite,
    )!

    expect(surfaceHeightAt(roundedTerrain, 0, 8)).toBeCloseTo(2, 6)
    const connected = updateRiver(scene, created.river!.id, { source: 'mountain' })
    const connectedTerrain = persistedTerrainFieldOf(
      nodes[SITE_ID as AnyNodeId] as typeof originalSite,
    )!

    expect(connected.ok).toBe(true)
    expect(surfaceHeightAt(connectedTerrain, 0, 8)).toBeLessThan(1.9)
  })
  test('rejects a 129-point draft without creating scene history', () => {
    const { commits, scene } = mutableScene(flatSite())
    const points = Array.from({ length: 129 }, (_, index) => [index, 8] as const)

    const result = createRiver(scene, SITE_ID, { ...DEFAULTS, points })

    expect(result.ok).toBe(false)
    expect(result.message).toBe('A river can contain at most 128 points.')
    expect(commits).toEqual([])
  })
})
