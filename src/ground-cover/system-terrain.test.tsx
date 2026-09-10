import {
  type AnyNode,
  type AnyNodeId,
  applyHeightPatch,
  commitTerrainField,
  createSceneApi,
  createTerrainField,
  type HeightPatch,
  normalAt,
  sceneRegistry,
  SiteNode,
  surfaceHeightAt,
  type TerrainField,
  useLiveTerrain,
  useScene,
} from '@pascal-app/core'
import { act, create } from '@react-three/test-renderer'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { createElement } from 'react'
import { type BufferAttribute, Group, InstancedMesh, type Material, Mesh } from 'three'
import { PondNode } from '../pond/schema'
import { buildGrassFieldGeometry } from './geometry'
import * as obstacles from './obstacle-adapter'
import { isGrassAllowedAt } from './obstacle-field'
import { getGrassObstacleRuntime } from './obstacle-texture'
import { getGrassTilesRuntime } from './render/grass-tiles'
import { GrassFieldNode } from './schema'
import GrassFieldSystem from './system'

// Exercise the actual SceneApi and live-store subscriptions, with the viewer's child
// transfer. Heights come from explicit grid samples, not a second implementation of
// the updater. The renderer mounts effects only: no browser, GPU frames or scene IO.
const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
let savedAct: boolean | undefined
let savedScene: ReturnType<typeof useScene.getState>
let savedHistory: ReturnType<typeof useScene.temporal.getState>
let savedLive: ReturnType<typeof useLiveTerrain.getState>
let renderer: Awaited<ReturnType<typeof create>> | undefined
let obstacleSpy: ReturnType<typeof spyOn<typeof obstacles, 'buildGrassObstacleField'>> | undefined
const registered = new Map<string, ReturnType<typeof sceneRegistry.nodes.get>>()
const hosts: Group[] = []

beforeEach(() => {
  savedAct = reactGlobal.IS_REACT_ACT_ENVIRONMENT
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = true
  savedScene = useScene.getState()
  savedHistory = useScene.temporal.getState()
  savedLive = useLiveTerrain.getState()
  useScene.temporal.getState().pause()
  useLiveTerrain.setState({ strokes: new Map(), remoteStrokes: new Map() })
})

afterEach(async () => {
  await renderer?.unmount()
  renderer = undefined
  obstacleSpy?.mockRestore()
  obstacleSpy = undefined
  for (const [id, previous] of registered) {
    if (previous) sceneRegistry.nodes.set(id, previous)
    else sceneRegistry.nodes.delete(id)
  }
  registered.clear()
  for (const host of hosts) {
    const geometries = new Set<Mesh['geometry']>()
    const materials = new Set<Material>()
    host.traverse((object) => {
      if (!(object instanceof Mesh)) return
      geometries.add(object.geometry)
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material)
      }
    })
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
  }
  hosts.length = 0
  useLiveTerrain.setState(savedLive, true)
  useScene.setState(savedScene, true)
  useScene.temporal.setState(savedHistory, true)
  if (savedAct === undefined) delete reactGlobal.IS_REACT_ACT_ENVIRONMENT
  else reactGlobal.IS_REACT_ACT_ENVIRONMENT = savedAct
})

function patch(col0: number, row0: number, height: number): HeightPatch {
  return { col0, row0, cols: 1, rows: 1, heights: new Int16Array([height]) }
}

function makeSite(suffix: string, water: boolean, flowers: boolean) {
  const terrain = createTerrainField({ origin: [0, 0], spacing: 1, cols: 17, rows: 5, step: 1 })
  if (water) {
    terrain.heights[2 * terrain.cols + 2] = -3
    terrain.heights[2 * terrain.cols + 10] = -3
  }
  const field = GrassFieldNode.parse({
    id: `grass-field_subscription_${suffix}`,
    parentId: `site_subscription_${suffix}`,
    density: 100,
    flowerDensity: flowers ? 100 : 0,
  })
  const ponds = water ? [2, 10].map((x) => PondNode.parse({
    id: `pond_subscription_${suffix}_${x}`,
    parentId: field.parentId,
    seed: [x, 2],
    waterLevel: -1,
  })) : []
  const site = SiteNode.parse({
    id: field.parentId,
    children: [field.id, ...ponds.map((pond) => pond.id)],
    polygon: { type: 'polygon', points: [[0, 0], [16, 0], [16, 4], [0, 4]] },
    terrain: commitTerrainField(terrain),
  })
  return { site, field, ponds, terrain }
}

async function fixture(water = false, flowers = false) {
  const primary = makeSite('primary', water, flowers)
  const other = makeSite('other', false, false)
  const nodes = Object.fromEntries([primary, other].flatMap(({ site, field, ponds }) =>
    [site, field, ...ponds].map((node) => [node.id, node]),
  )) as Record<AnyNodeId, AnyNode>
  useScene.setState({ nodes, rootNodeIds: [primary.site.id, other.site.id], dirtyNodes: new Set() })

  function mount(entry: typeof primary) {
    const built = buildGrassFieldGeometry(entry.field, {
      parent: entry.site,
      children: [],
      siblings: [entry.field, ...entry.ponds] as unknown as AnyNode[],
      resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    })
    const host = new Group()
    for (const child of [...built.children]) host.add(child)
    hosts.push(host)
    registered.set(entry.field.id, sceneRegistry.nodes.get(entry.field.id))
    sceneRegistry.nodes.set(entry.field.id, host)
    return { ...entry, host, ground: host.getObjectByName('grass-field-ground') as Mesh }
  }
  const main = mount(primary)
  const untouched = mount(other)
  const dirty: string[] = []
  const api = createSceneApi(useScene)
  const markDirty = api.markDirty
  api.markDirty = (id) => { dirty.push(id); markDirty(id) }
  obstacleSpy = spyOn(obstacles, 'buildGrassObstacleField')
  renderer = await create(createElement(GrassFieldSystem, { sceneApi: api }))
  return { main, untouched, dirty }
}

async function publish(node: SiteNode | PondNode) {
  // Publish the persisted node-identity event without the editor's RAF scheduler.
  await act(async () => {
    useScene.setState((state) => ({ nodes: { ...state.nodes, [node.id]: node as AnyNode } }))
  })
}

async function event(action: () => void) {
  await act(async () => { action() })
}

function groundHeight(ground: Mesh, x: number, z: number): number {
  const positions = ground.geometry.getAttribute('position')
  for (let index = 0; index < positions.count; index++) {
    if (positions.getX(index) === x && positions.getZ(index) === z) return positions.getY(index)
  }
  throw new Error(`Missing ground grid vertex (${x}, ${z})`)
}

function versions(host: Group): number[] {
  const result: number[] = []
  host.traverse((object) => {
    if (!(object instanceof Mesh)) return
    for (const name of ['position', 'normal', 'grassRoot', 'flowerRoot']) {
      const attribute = object.geometry.getAttribute(name) as BufferAttribute | undefined
      if (attribute) result.push(attribute.version)
    }
    if (object instanceof InstancedMesh) result.push(object.instanceMatrix.version)
  })
  return result
}

function farTileVersions(host: Group) {
  const runtime = getGrassTilesRuntime(host)
  if (!runtime) throw new Error('Viewer-mounted grass runtime is missing')
  // Render bounds include blade/wind padding; terrain locality depends on candidate roots.
  const far = runtime.tiles.filter((tile) => tile.candidateCount > 0 &&
    Array.from({ length: tile.candidateCount }, (_, index) => tile.attributes.root.getX(index))
      .every((x) => x >= 8),
  )
  expect(far.length).toBeGreaterThan(0)
  return far.flatMap((tile) => [tile.attributes.root.version, tile.full.instanceMatrix.version])
}

function counted(terrain: TerrainField) {
  const reads: number[] = []
  const heights = new Proxy(terrain.heights, {
    get(target, key) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads.push(Number(key))
      return Reflect.get(target, key, target)
    },
  })
  return { terrain: { ...terrain, heights }, reads }
}

describe('terrain subscriptions acceptance', () => {
  test('two ponds + flowers defer invalidation and obstacles through begin, dabs and commit-before-end', async () => {
    const { main, untouched, dirty } = await fixture(true, true)
    const live = useLiveTerrain.getState()
    const obstacle = getGrassObstacleRuntime(main.field.id)!
    const obstacleField = obstacle.field
    const obstacleVersion = obstacle.texture.version
    const otherVersions = versions(untouched.host)
    const flowerGroup = main.host.getObjectByName('grass-field-flowers')!
    expect(flowerGroup.children.some((child) => child instanceof InstancedMesh && child.count > 0)).toBe(true)
    expect(isGrassAllowedAt(obstacle.field, 2, 2)).toBe(false)
    expect(isGrassAllowedAt(obstacle.field, 10, 2)).toBe(false)

    await event(() => live.begin(main.site.id, main.terrain))
    expect(dirty).toEqual([])
    const farVersions = farTileVersions(main.host)
    const a = patch(1, 1, 4)
    const afterA = applyHeightPatch(main.terrain, a)
    const observed = counted(afterA)
    await event(() => live.advance(main.site.id, observed.terrain, a))
    expect(groundHeight(main.ground, 1, 1)).toBeCloseTo(4.005, 6)
    expect(observed.reads.length).toBeGreaterThan(0)
    expect(observed.reads.every((index) => index % afterA.cols < 7)).toBe(true)
    const b = patch(3, 1, 6)
    const afterB = applyHeightPatch(afterA, b)
    await event(() => live.advance(main.site.id, afterB, b))
    const persisted = { ...main.site, terrain: commitTerrainField(afterB) }
    await publish(persisted)

    expect(dirty).toEqual([])
    expect(obstacleSpy).toHaveBeenCalledTimes(0)
    expect(obstacle.field).toBe(obstacleField)
    expect(obstacle.texture.version).toBe(obstacleVersion)
    expect(farTileVersions(main.host)).toEqual(farVersions)
    expect(versions(untouched.host)).toEqual(otherVersions)
    expect(groundHeight(main.ground, 3, 1)).toBeCloseTo(6.005, 6)

    await event(() => live.end(main.site.id))
    expect(dirty).toEqual([main.field.id])
    expect(groundHeight(main.ground, 1, 1)).toBeCloseTo(4.005, 6)
    expect(groundHeight(main.ground, 3, 1)).toBeCloseTo(6.005, 6)
    await event(() => live.end(main.site.id))
    expect(dirty).toEqual([main.field.id])
    expect(versions(untouched.host)).toEqual(otherVersions)
  })

  test('water + flowers cancel reconciles persisted heights once at effective end', async () => {
    const { main, untouched, dirty } = await fixture(true, true)
    const live = useLiveTerrain.getState()
    const positions = main.ground.geometry.getAttribute('position')
    const expectedPositions = new Float32Array(positions.array)
    const expectedNormals = new Float32Array(positions.count * 3)
    // Reconciliation samples stored Float32 coordinates, not the builder's pre-storage
    // double-precision clipping intersections. Derive the oracle before any live changes.
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index)
      const z = positions.getZ(index)
      expectedPositions[index * 3 + 1] = surfaceHeightAt(main.terrain, x, z) + 0.005
      expectedNormals.set(normalAt(main.terrain, x, z), index * 3)
    }
    const otherVersions = versions(untouched.host)
    const a = patch(1, 1, 4)
    const b = patch(13, 1, 8)
    await event(() => live.begin(main.site.id, main.terrain))
    const afterA = applyHeightPatch(main.terrain, a)
    await event(() => live.advance(main.site.id, afterA, a))
    await event(() => live.advance(main.site.id, applyHeightPatch(afterA, b), b))
    expect(dirty).toEqual([])
    expect(obstacleSpy).toHaveBeenCalledTimes(0)
    expect(groundHeight(main.ground, 1, 1)).toBeCloseTo(4.005, 6)
    expect(groundHeight(main.ground, 13, 1)).toBeCloseTo(8.005, 6)
    await event(() => live.end(main.site.id))
    expect(main.ground.geometry.getAttribute('position').array).toEqual(expectedPositions)
    expect(main.ground.geometry.getAttribute('normal').array).toEqual(expectedNormals)
    expect(dirty).toEqual([main.field.id])
    expect(versions(untouched.host)).toEqual(otherVersions)
  })

  test('no-water dabs stay local; completion and persisted undo reconcile without rebuilding', async () => {
    const { main, untouched, dirty } = await fixture()
    const live = useLiveTerrain.getState()
    const original = new Float32Array(main.ground.geometry.getAttribute('position').array)
    const otherVersions = versions(untouched.host)
    const farVersions = farTileVersions(main.host)
    const a = patch(1, 1, 4)
    const next = applyHeightPatch(main.terrain, a)
    await event(() => live.begin(main.site.id, main.terrain))
    const observed = counted(next)
    await event(() => live.advance(main.site.id, observed.terrain, a))
    expect(observed.reads.length).toBeGreaterThan(0)
    expect(observed.reads.every((index) => index % next.cols < 7)).toBe(true)
    const readsBeforeCommit = observed.reads.length
    await publish({ ...main.site, terrain: commitTerrainField(next) })
    expect(observed.reads).toHaveLength(readsBeforeCommit)
    expect(farTileVersions(main.host)).toEqual(farVersions)
    expect(groundHeight(main.ground, 1, 1)).toBeCloseTo(4.005, 6)
    expect(dirty).toEqual([])
    await event(() => live.end(main.site.id))
    expect(groundHeight(main.ground, 1, 1)).toBeCloseTo(4.005, 6)
    await publish(main.site)
    expect(main.ground.geometry.getAttribute('position').array).toEqual(original)
    expect(dirty).toEqual([])
    expect(versions(untouched.host)).toEqual(otherVersions)
  })

  test('cancel uses current persisted terrain, not the stroke snapshot or only its last patch', async () => {
    const { main, dirty } = await fixture()
    const live = useLiveTerrain.getState()
    const a = patch(1, 1, 4)
    await event(() => live.begin(main.site.id, main.terrain))
    await event(() => live.advance(main.site.id, applyHeightPatch(main.terrain, a), a))
    const persisted = createTerrainField({ origin: [0, 0], spacing: 1, cols: 17, rows: 5, step: 1 })
    persisted.heights.fill(2)
    await publish({ ...main.site, terrain: commitTerrainField(persisted) })
    expect(groundHeight(main.ground, 1, 1)).toBeCloseTo(4.005, 6)
    expect(groundHeight(main.ground, 13, 1)).toBeCloseTo(0.005, 6)
    await event(() => live.end(main.site.id))
    const positions = main.ground.geometry.getAttribute('position')
    expect(Array.from({ length: positions.count }, (_, index) => positions.getY(index)))
      .toEqual(Array(positions.count).fill(Math.fround(2.005)))
    expect(dirty).toEqual([])
  })

  test('local priority and remote/source handoffs reconcile the whole replacement field, deferring water work until no effective stroke', async () => {
    const { main, untouched, dirty } = await fixture(true, true)
    const live = useLiveTerrain.getState()
    const otherVersions = versions(untouched.host)
    const left = patch(1, 1, 7)
    const right = patch(13, 1, 8)
    const remote = applyHeightPatch(applyHeightPatch(main.terrain, left), right)
    await event(() => live.previewRemote(main.site.id, 'peer-a', remote, right))
    expect(groundHeight(main.ground, 1, 1)).toBeCloseTo(7.005, 6)
    expect(groundHeight(main.ground, 13, 1)).toBeCloseTo(8.005, 6)
    await event(() => live.begin(main.site.id, remote))
    const localPatch = patch(1, 1, 4)
    await event(() => live.advance(main.site.id, applyHeightPatch(remote, localPatch), localPatch))
    const localVersions = versions(main.host)
    const maskedPatch = patch(13, 1, 9)
    const masked = applyHeightPatch(applyHeightPatch(remote, patch(1, 1, 6)), maskedPatch)
    await event(() => live.previewRemote(main.site.id, 'peer-a', masked, maskedPatch))
    expect(versions(main.host)).toEqual(localVersions)
    expect(groundHeight(main.ground, 1, 1)).toBeCloseTo(4.005, 6)
    await event(() => live.end(main.site.id))
    expect(groundHeight(main.ground, 1, 1)).toBeCloseTo(6.005, 6)
    expect(groundHeight(main.ground, 13, 1)).toBeCloseTo(9.005, 6)

    const replacementPatch = patch(13, 1, 12)
    const replacement = applyHeightPatch(applyHeightPatch(main.terrain, patch(1, 1, 11)), replacementPatch)
    await event(() => live.previewRemote(main.site.id, 'peer-b', replacement, replacementPatch))
    expect(groundHeight(main.ground, 1, 1)).toBeCloseTo(11.005, 6)
    expect(groundHeight(main.ground, 13, 1)).toBeCloseTo(12.005, 6)
    const replacementVersions = versions(main.host)
    await event(() => live.endRemote(main.site.id, 'peer-a'))
    expect(versions(main.host)).toEqual(replacementVersions)
    expect(dirty).toEqual([])
    expect(obstacleSpy).toHaveBeenCalledTimes(0)
    await event(() => live.endRemote(main.site.id, 'peer-b'))
    expect(groundHeight(main.ground, 1, 1)).toBeCloseTo(0.005, 6)
    expect(groundHeight(main.ground, 13, 1)).toBeCloseTo(0.005, 6)
    expect(dirty).toEqual([main.field.id])
    expect(versions(untouched.host)).toEqual(otherVersions)
  })

  test('pond edits outside strokes still regenerate the obstacle mask; boundary edits still invalidate only that site', async () => {
    const { main, untouched, dirty } = await fixture(true, false)
    const obstacle = getGrassObstacleRuntime(main.field.id)!
    const initialVersion = obstacle.texture.version
    const otherVersions = versions(untouched.host)
    expect(isGrassAllowedAt(obstacle.field, 2, 2)).toBe(false)
    await publish({ ...main.ponds[0]!, waterLevel: -5 })
    expect(obstacleSpy!.mock.calls.length).toBeGreaterThan(0)
    expect(obstacle.texture.version).toBeGreaterThan(initialVersion)
    expect(isGrassAllowedAt(obstacle.field, 2, 2)).toBe(true)
    expect(isGrassAllowedAt(obstacle.field, 10, 2)).toBe(false)
    expect(dirty).toEqual([])
    await publish({ ...main.site, polygon: { type: 'polygon', points: [[0, 0], [15, 0], [15, 4], [0, 4]] } })
    expect(dirty).toContain(main.field.id)
    expect(dirty).not.toContain(untouched.field.id)
    expect(versions(untouched.host)).toEqual(otherVersions)
  })

  test('flower fields still invalidate for pond edits outside strokes', async () => {
    const { main, untouched, dirty } = await fixture(true, true)
    await publish({ ...main.ponds[0]!, waterLevel: -5 })
    expect(dirty).toEqual([main.field.id])
    expect(dirty).not.toContain(untouched.field.id)
  })
})
