import {
  type AnyNode,
  type AnyNodeId,
  createTerrainField,
  encodeTerrainField,
  type GeometryContext,
  SiteNode,
  surfaceHeightAt,
} from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { Box3, Color, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { buildGrassFieldBakeGeometry } from './bake-geometry'
import {
  createGrassPaintField,
  encodeGrassPaintField,
} from './paint-field'
import { GrassFieldNode } from './schema'

describe('Ground Cover static bake geometry', () => {
  test('builds one portable standard-material blade mesh', async () => {
    const site = smallSite()
    const node = GrassFieldNode.parse({
      id: 'grass-field_bake',
      parentId: site.id,
      bladeWidthVariation: 0,
      bladeHeightVariation: 0,
    })

    const root = buildGrassFieldBakeGeometry(node, contextFor(site, [site]))
    expect(root.children).toHaveLength(1)
    const blades = root.getObjectByName('grass-field-static-blades')
    expect(blades).toBeInstanceOf(Mesh)
    if (!(blades instanceof Mesh)) return

    expect(blades.material).toBeInstanceOf(MeshStandardMaterial)
    expect(blades.geometry.getAttribute('position').count).toBe(126)
    expect(blades.geometry.getIndex()?.array).toBeInstanceOf(Uint16Array)
    const normals = blades.geometry.getAttribute('normal')
    const normalLengths = Array.from({ length: normals.count }, (_, index) =>
      Math.hypot(normals.getX(index), normals.getY(index), normals.getZ(index)),
    )
    expect(Math.min(...normalLengths)).toBeGreaterThanOrEqual(0.9995)
    expect(Math.max(...normalLengths)).toBeLessThanOrEqual(1.0005)
    expect(blades.geometry.getAttribute('color').count).toBe(
      blades.geometry.getAttribute('position').count,
    )
    expect(
      Array.from(
        blades.geometry.getAttribute('color').array as ArrayLike<number>,
      ).every((component) => component >= 0 && component <= 1),
    ).toBe(true)

    const exported = await exportGltf(root)
    expect(exported.extensionsUsed ?? []).not.toContain('EXT_mesh_gpu_instancing')
    const positionAccessor =
      exported.meshes?.[0]?.primitives[0]?.attributes.POSITION
    expect(typeof positionAccessor).toBe('number')
    expect(exported.accessors?.[positionAccessor ?? -1]?.count).toBe(126)
    expect(exported.materials).toHaveLength(1)
    expect(exported.meshes).toHaveLength(1)
  })

  test('bakes the independent local height texture', () => {
    const site = smallSite()
    const baseline = GrassFieldNode.parse({
      id: 'grass-field_height_baseline',
      parentId: site.id,
      bladeHeightVariation: 0,
      bladeWidthVariation: 0,
    })
    const raised = GrassFieldNode.parse({
      ...baseline,
      id: 'grass-field_height_raised',
      heightMap: encodeGrassPaintField(
        createGrassPaintField(
          { minX: 0, maxX: 0.2, minZ: 0, maxZ: 0.2 },
          '#ffffff',
        ),
      ),
    })

    const baselineBounds = new Box3().setFromObject(
      buildGrassFieldBakeGeometry(baseline, contextFor(site, [site])),
    )
    const raisedBounds = new Box3().setFromObject(
      buildGrassFieldBakeGeometry(raised, contextFor(site, [site])),
    )

    expect(raisedBounds.max.y).toBeCloseTo(baselineBounds.max.y * 2, 5)
  })

  test('bakes the painted RGB directly as glTF linear vertex colors', async () => {
    const site = smallSite()
    const node = GrassFieldNode.parse({
      id: 'grass-field_color_bake',
      parentId: site.id,
      bladeHeightVariation: 0,
      bladeTintVariation: 100,
      bladeTipBrightness: 500,
      bladeWidthVariation: 0,
      paintMap: encodeGrassPaintField(
        createGrassPaintField(
          { minX: 0, maxX: 0.2, minZ: 0, maxZ: 0.2 },
          '#204060',
        ),
      ),
    })

    const root = buildGrassFieldBakeGeometry(node, contextFor(site, [site]))
    const blades = root.getObjectByName('grass-field-static-blades')
    expect(blades).toBeInstanceOf(Mesh)
    if (!(blades instanceof Mesh)) return
    expect(blades.material).toBeInstanceOf(MeshStandardMaterial)
    if (!(blades.material instanceof MeshStandardMaterial)) return

    expect(blades.material.color.getHex()).toBe(0xffffff)
    expect(blades.material.emissive.getHex()).toBe(0)
    const colors = blades.geometry.getAttribute('color')
    const expected = new Color('#204060')
    for (let index = 0; index < colors.count; index += 1) {
      expect(colors.getX(index)).toBeCloseTo(expected.r, 6)
      expect(colors.getY(index)).toBeCloseTo(expected.g, 6)
      expect(colors.getZ(index)).toBeCloseTo(expected.b, 6)
    }

    const exported = await exportGltf(root)
    expect(exported.meshes?.[0]?.primitives[0]?.attributes.COLOR_0).toBeNumber()
  })

  test('splits large fields into 16-bit indexed baseline meshes', () => {
    const site = SiteNode.parse({
      id: 'site_large_bake',
      children: [],
      polygon: {
        type: 'polygon',
        points: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
      },
    })
    const node = GrassFieldNode.parse({
      id: 'grass-field_large_bake',
      parentId: site.id,
    })

    const root = buildGrassFieldBakeGeometry(node, contextFor(site, [site]))
    expect(root.children).toHaveLength(4)
    let vertexCount = 0
    for (const child of root.children) {
      expect(child).toBeInstanceOf(Mesh)
      if (!(child instanceof Mesh)) continue
      const positions = child.geometry.getAttribute('position')
      expect(positions.count).toBeLessThanOrEqual(65_535)
      expect(child.geometry.getIndex()?.array).toBeInstanceOf(Uint16Array)
      vertexCount += positions.count
    }
    expect(vertexCount).toBe(218_750)
  })

  test('omits the mesh when effective density is zero', () => {
    const site = smallSite()
    const node = GrassFieldNode.parse({
      id: 'grass-field_empty_bake',
      parentId: site.id,
      density: 0,
    })

    const root = buildGrassFieldBakeGeometry(node, contextFor(site, [site]))
    expect(root.children).toHaveLength(0)
  })

  test('places static blade roots on the persisted terrain field', () => {
    const terrain = createTerrainField({
      origin: [0, 0],
      spacing: 0.1,
      cols: 3,
      rows: 3,
      step: 0.01,
    })
    for (let row = 0; row < terrain.rows; row += 1) {
      for (let column = 0; column < terrain.cols; column += 1) {
        terrain.heights[row * terrain.cols + column] = column * 10 + row * 5
      }
    }
    const site = SiteNode.parse({
      ...smallSite(),
      terrain: encodeTerrainField(terrain),
    })
    const node = GrassFieldNode.parse({
      id: 'grass-field_terrain_bake',
      parentId: site.id,
      bladeWidthVariation: 0,
      bladeHeightVariation: 0,
      obstacleBendStrength: 0,
    })

    const root = buildGrassFieldBakeGeometry(node, contextFor(site, [site]))
    const blades = root.getObjectByName('grass-field-static-blades')
    expect(blades).toBeInstanceOf(Mesh)
    if (!(blades instanceof Mesh)) return

    const positions = blades.geometry.getAttribute('position')
    const bladeRoot = new Vector3(
      (positions.getX(0) + positions.getX(1)) / 2,
      (positions.getY(0) + positions.getY(1)) / 2,
      (positions.getZ(0) + positions.getZ(1)) / 2,
    )
    expect(bladeRoot.y).toBeCloseTo(
      surfaceHeightAt(terrain, bladeRoot.x, bladeRoot.z),
      6,
    )
  })
})

async function exportGltf(root: Object3D): Promise<{
  accessors?: Array<{ count: number }>
  extensionsUsed?: string[]
  materials?: unknown[]
  meshes?: Array<{
    primitives: Array<{ attributes: { COLOR_0?: number; POSITION: number } }>
  }>
}> {
  const globals = globalThis as unknown as Record<string, unknown>
  const nativeFileReader = globals.FileReader
  if (!nativeFileReader) {
    globals.FileReader = class {
      result: string | null = null
      onloadend: (() => void) | null = null

      readAsDataURL(blob: Blob): void {
        void blob.arrayBuffer().then((buffer) => {
          this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`
          this.onloadend?.()
        })
      }
    }
  }

  try {
    return (await new GLTFExporter().parseAsync(root, {
      binary: false,
    })) as {
      accessors?: Array<{ count: number }>
      extensionsUsed?: string[]
      materials?: unknown[]
      meshes?: Array<{
        primitives: Array<{ attributes: { COLOR_0?: number; POSITION: number } }>
      }>
    }
  } finally {
    if (nativeFileReader) globals.FileReader = nativeFileReader
    else delete globals.FileReader
  }
}

function smallSite(): ReturnType<typeof SiteNode.parse> {
  return SiteNode.parse({
    id: 'site_bake',
    children: [],
    polygon: {
      type: 'polygon',
      points: [
        [0, 0],
        [0.2, 0],
        [0.2, 0.2],
        [0, 0.2],
      ],
    },
  })
}

function contextFor(
  site: ReturnType<typeof SiteNode.parse>,
  sceneNodes: AnyNode[],
): GeometryContext {
  const nodes = Object.fromEntries(sceneNodes.map((node) => [node.id, node])) as Record<
    string,
    AnyNode
  >
  return {
    parent: site,
    resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    children: [],
    siblings: [],
  }
}
