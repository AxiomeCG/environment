import {
  createTerrainField,
  encodeTerrainField,
  type GeometryContext,
  SiteNode,
  surfaceHeightAt,
} from '@pascal-app/core'
import { expect, test } from 'bun:test'
import {
  FrontSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Raycaster,
  Vector3,
} from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import {
  buildGrassFieldGeometry,
  updateGrassFieldTerrain,
  updateGrassFieldUniforms,
} from './geometry'
import { createGrassPaintField, encodeGrassPaintField } from './paint-field'
import { getGrassPaintRuntime } from './paint-texture'
import { getMissingGrassFieldDefaults, GrassFieldNode } from './schema'
import { grassFieldGeometryInputsEqual, grassFieldSiteChanges } from './system'
import { buildDrapedGroundGeometry } from './terrain-drape'

const context: GeometryContext = {
  resolve: () => undefined,
  children: [],
  siblings: [],
  parent: SiteNode.parse({
    id: 'site_test',
    type: 'site',
    polygon: {
      type: 'polygon',
      points: [
        [0, 0],
        [0.2, 0],
        [0.2, 0.2],
        [0, 0.2],
      ],
    },
  }),
}

function expectFlowerResourcesUnchanged(
  flowers: readonly InstancedMesh[],
  geometries: readonly InstancedMesh['geometry'][],
  materials: readonly InstancedMesh['material'][],
) {
  expect(flowers).toHaveLength(geometries.length)
  for (let index = 0; index < flowers.length; index += 1) {
    const flower = flowers[index]
    const geometry = geometries[index]
    const material = materials[index]
    if (!flower || !geometry || !material) {
      throw new Error(`Missing expected flower resource at index ${index}`)
    }
    expect(flower.geometry).toBe(geometry)
    expect(flower.material).toBe(material)
  }
}

test('missing controls receive defaults without replacing explicit zeroes', () => {
  expect(
    getMissingGrassFieldDefaults({
      bladeWidth: 0.06,
      bladeHeight: 0.25,
    }),
  ).toMatchObject({
    bladeWidth: 0.035,
    bladeHeight: 0.15,
  })
  expect(
    getMissingGrassFieldDefaults({
      bladeWidth: 0.04,
      bladeHeight: 0.2,
    }),
  ).not.toMatchObject({
    bladeWidth: expect.anything(),
    bladeHeight: expect.anything(),
  })

  expect(
    getMissingGrassFieldDefaults({
      bladeWidth: 0.04,
      bladeHeight: 0.2,
      bladeWidthVariation: 0,
      bladeHeightVariation: 0,
      bladeRestBend: 0,
      bladeTintVariation: 0,
      bladeTipBrightness: 0,
      density: 0,
      flowerDensity: 0,
      windStrength: 0,
      grassWindInfluence: 0,
      obstacleBendRadius: 0,
      obstacleBendStrength: 0,
      obstacleFlattening: 0,
    }),
  ).toEqual({})
})

test('shader-only controls update mounted uniforms without replacing resources', () => {
  const field = GrassFieldNode.parse({})
  const group = buildGrassFieldGeometry(field, context)
  const blade = group.getObjectByName('grass-field-blade')

  expect(blade).toBeInstanceOf(InstancedMesh)
  if (!(blade instanceof InstancedMesh)) return
  const geometry = blade.geometry
  const material = blade.material
  const updated = GrassFieldNode.parse({
    ...field,
    bladeRestBend: 0.7,
    bladeTintVariation: 75,
    bladeTipBrightness: 180,
    density: 35,
    windStrength: 60,
    grassWindInfluence: 140,
    obstacleBendRadius: 1.25,
    obstacleBendStrength: 0.55,
    obstacleFlattening: 80,
  })

  expect(updateGrassFieldUniforms(group, updated)).toBe(true)
  const mountedBlade = group.getObjectByName('grass-field-blade')
  expect(mountedBlade).toBeInstanceOf(InstancedMesh)
  if (!(mountedBlade instanceof InstancedMesh)) {
    throw new Error('Expected a mounted blade after the uniform update')
  }
  expect(mountedBlade).toBe(blade)
  expect(mountedBlade.geometry).toBe(geometry)
  expect(mountedBlade.material).toBe(material)
})

test('keeps live blade and flower wind resources node-local across sibling updates and removal', () => {
  const fieldA = GrassFieldNode.parse({
    id: 'grass-field_a',
    flowerDensity: 100,
    windStrength: 20,
    grassWindInfluence: 100,
  })
  const fieldB = GrassFieldNode.parse({
    id: 'grass-field_b',
    flowerDensity: 100,
    windStrength: 80,
    grassWindInfluence: 100,
  })
  const groupA = buildGrassFieldGeometry(fieldA, context)
  const groupB = buildGrassFieldGeometry(fieldB, context)
  const bladeA = groupA.getObjectByName('grass-field-blade')
  const bladeB = groupB.getObjectByName('grass-field-blade')
  const flowersB = groupB
    .getObjectByName('grass-field-flowers')
    ?.children.filter((child): child is InstancedMesh => child instanceof InstancedMesh)

  expect(bladeA).toBeInstanceOf(InstancedMesh)
  expect(bladeB).toBeInstanceOf(InstancedMesh)
  expect(flowersB?.length).toBeGreaterThan(0)
  if (!(bladeA instanceof InstancedMesh) || !(bladeB instanceof InstancedMesh) || !flowersB) {
    throw new Error('Expected populated blade and flower batches')
  }

  const bladeBGeometry = bladeB.geometry
  const bladeBMaterial = bladeB.material
  const flowerBGeometries = flowersB.map(({ geometry }) => geometry)
  const flowerBMaterials = flowersB.map(({ material }) => material)

  expect(
    updateGrassFieldUniforms(
      groupA,
      GrassFieldNode.parse({ ...fieldA, windStrength: 150, grassWindInfluence: 250 }),
    ),
  ).toBe(true)
  expect(bladeB.geometry).toBe(bladeBGeometry)
  expect(bladeB.material).toBe(bladeBMaterial)
  expectFlowerResourcesUnchanged(flowersB, flowerBGeometries, flowerBMaterials)

  groupA.clear()
  expect(groupB.getObjectByName('grass-field-blade')).toBe(bladeB)
  const mountedFlowersB = groupB.getObjectByName('grass-field-flowers')?.children
  expect(mountedFlowersB).toHaveLength(flowersB.length)
  for (let index = 0; index < flowersB.length; index += 1) {
    expect(mountedFlowersB?.[index]).toBe(flowersB[index])
  }

  expect(
    updateGrassFieldUniforms(
      groupB,
      GrassFieldNode.parse({ ...fieldB, windStrength: 40, grassWindInfluence: 175 }),
    ),
  ).toBe(true)
  const mountedBladeAfterOwnUpdate = groupB.getObjectByName('grass-field-blade')
  const mountedFlowersAfterOwnUpdate = groupB
    .getObjectByName('grass-field-flowers')
    ?.children.filter((child): child is InstancedMesh => child instanceof InstancedMesh)
  expect(mountedBladeAfterOwnUpdate).toBeInstanceOf(InstancedMesh)
  expect(mountedFlowersAfterOwnUpdate).toHaveLength(flowersB.length)
  if (
    !(mountedBladeAfterOwnUpdate instanceof InstancedMesh) ||
    !mountedFlowersAfterOwnUpdate
  ) {
    throw new Error('Expected mounted blade and flower batches after the uniform update')
  }
  expect(mountedBladeAfterOwnUpdate).toBe(bladeB)
  expect(mountedBladeAfterOwnUpdate.geometry).toBe(bladeBGeometry)
  expect(mountedBladeAfterOwnUpdate.material).toBe(bladeBMaterial)
  for (let index = 0; index < flowersB.length; index += 1) {
    expect(mountedFlowersAfterOwnUpdate[index]).toBe(flowersB[index])
  }
  expectFlowerResourcesUnchanged(
    mountedFlowersAfterOwnUpdate,
    flowerBGeometries,
    flowerBMaterials,
  )
})

test('separates shader-only controls from geometry inputs', () => {
  const paintMap = encodeGrassPaintField(
    createGrassPaintField({ minX: 0, maxX: 0.2, minZ: 0, maxZ: 0.2 }, '#204060'),
  )
  const field = GrassFieldNode.parse({ paintMap })
  const shaderOnlyUpdate = GrassFieldNode.parse({
    ...field,
    bladeRestBend: 0.65,
    bladeTintVariation: 90,
    bladeTipBrightness: 125,
    density: 40,
    windStrength: 80,
    grassWindInfluence: 160,
    obstacleBendRadius: 1.1,
    obstacleBendStrength: 0.45,
    obstacleFlattening: 35,
  })
  const geometryUpdate = GrassFieldNode.parse({
    ...field,
    bladeWidth: field.bladeWidth * 2,
  })
  const paintUpdate = GrassFieldNode.parse({
    ...field,
    paintMap: { ...paintMap, values: paintMap.values.replace(/^./, 'A') },
  })
  const flowerUpdate = GrassFieldNode.parse({
    ...field,
    flowerDensity: 20,
  })
  const populatedDensityUpdate = GrassFieldNode.parse({
    ...flowerUpdate,
    density: 40,
  })

  expect(shaderOnlyUpdate.paintMap).not.toBe(field.paintMap)
  expect(grassFieldGeometryInputsEqual(field, shaderOnlyUpdate)).toBe(true)
  expect(grassFieldGeometryInputsEqual(field, geometryUpdate)).toBe(false)
  expect(grassFieldGeometryInputsEqual(field, paintUpdate)).toBe(false)
  expect(grassFieldGeometryInputsEqual(field, flowerUpdate)).toBe(false)
  expect(grassFieldGeometryInputsEqual(flowerUpdate, populatedDensityUpdate)).toBe(false)
})

test('full density scatters one candidate per site cell', () => {
  const field = GrassFieldNode.parse({
    bladeWidth: 0.06,
    bladeWidthVariation: 0,
    bladeHeight: 0.25,
    bladeHeightVariation: 0,
    density: 100,
  })
  const group = buildGrassFieldGeometry(field, context)
  const blade = group.getObjectByName('grass-field-blade')

  expect(blade).toBeInstanceOf(InstancedMesh)
  if (!(blade instanceof InstancedMesh)) return
  expect(blade.instanceMatrix.count).toBe(9)
  expect(blade.count).toBe(9)
  expect(blade.material).toBeInstanceOf(MeshStandardNodeMaterial)

  const roots = blade.geometry.getAttribute('grassRoot')
  const thresholds = blade.geometry.getAttribute('grassDensityThreshold')
  const tints = blade.geometry.getAttribute('grassTintVariation')
  const surfaceSampleBases = blade.geometry.getAttribute('grassSurfaceSampleBasis')
  expect(roots).toBeInstanceOf(InstancedBufferAttribute)
  expect(thresholds).toBeInstanceOf(InstancedBufferAttribute)
  expect(tints).toBeInstanceOf(InstancedBufferAttribute)
  expect(surfaceSampleBases).toBeInstanceOf(InstancedBufferAttribute)
  expect(roots.count).toBe(blade.count)
  expect(thresholds.count).toBe(blade.count)
  expect(tints.count).toBe(blade.count)
  expect(surfaceSampleBases.count).toBe(blade.count)
  expect(
    Array.from(thresholds.array as ArrayLike<number>).every((value) => value >= 0 && value < 1),
  ).toBe(true)
  expect(
    Array.from(tints.array as ArrayLike<number>).every((value) => value >= -1 && value < 1),
  ).toBe(true)

  const matrix = new Matrix4()
  const scale = new Vector3()
  blade.getMatrixAt(0, matrix)
  matrix.decompose(new Vector3(), new Quaternion(), scale)

  expect(scale.x).toBeCloseTo(field.bladeWidth)
  expect(scale.y).toBeCloseTo(field.bladeHeight)
  expect(scale.z).toBeCloseTo(field.bladeWidth)
  expect(surfaceSampleBases.getX(0)).toBeCloseTo(matrix.elements[0] as number)
  expect(surfaceSampleBases.getY(0)).toBeCloseTo(-(matrix.elements[2] as number))
})

test('drapes roots and painted ground over slopes while blades remain upright', () => {
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

  const slopedContext: GeometryContext = {
    ...context,
    parent: SiteNode.parse({
      ...context.parent,
      terrain: encodeTerrainField(terrain),
    }),
  }
  const group = buildGrassFieldGeometry(GrassFieldNode.parse({ flowerDensity: 100 }), slopedContext)
  const blade = group.getObjectByName('grass-field-blade')
  const ground = group.getObjectByName('grass-field-ground')
  const flower = group.getObjectByName('grass-field-flowers')?.children[0]

  expect(blade).toBeInstanceOf(InstancedMesh)
  expect(ground).toBeInstanceOf(Mesh)
  expect(flower).toBeInstanceOf(InstancedMesh)
  if (
    !(blade instanceof InstancedMesh) ||
    !(ground instanceof Mesh) ||
    !(flower instanceof InstancedMesh)
  )
    return

  const roots = blade.geometry.getAttribute('grassRoot')
  for (let index = 0; index < roots.count; index += 1) {
    expect(roots.getY(index)).toBeCloseTo(
      surfaceHeightAt(terrain, roots.getX(index), roots.getZ(index)),
      6,
    )
  }
  const flowerRoots = flower.geometry.getAttribute('flowerRoot')
  for (let index = 0; index < flowerRoots.count; index += 1) {
    expect(flowerRoots.getY(index)).toBeCloseTo(
      surfaceHeightAt(terrain, flowerRoots.getX(index), flowerRoots.getZ(index)),
      6,
    )
  }

  const matrix = new Matrix4()
  const rotation = new Quaternion()
  blade.getMatrixAt(0, matrix)
  matrix.decompose(new Vector3(), rotation, new Vector3())
  expect(new Vector3(0, 1, 0).applyQuaternion(rotation).toArray()).toEqual([0, 1, 0])

  const positions = ground.geometry.getAttribute('position')
  const normals = ground.geometry.getAttribute('normal')
  expect(positions.count).toBeGreaterThan(3)
  for (let index = 0; index < positions.count; index += 1) {
    expect(positions.getY(index)).toBeCloseTo(
      surfaceHeightAt(terrain, positions.getX(index), positions.getZ(index)) + 0.005,
      6,
    )
  }
  expect(
    Array.from({ length: normals.count }, (_, index) => normals.getY(index)).some(
      (normalY) => normalY < 0.999,
    ),
  ).toBe(true)

  const raisedTerrain = createTerrainField({
    origin: [0, 0],
    spacing: 0.1,
    cols: 3,
    rows: 3,
    step: 0.01,
  })
  raisedTerrain.heights.fill(100)
  const raisedSite = SiteNode.parse({
    ...slopedContext.parent,
    terrain: encodeTerrainField(raisedTerrain),
  })
  const bladeMaterial = blade.material
  const groundMaterial = ground.material
  const groundGeometry = ground.geometry

  expect(updateGrassFieldTerrain(group, raisedSite)).toBe(true)
  expect(blade.material).toBe(bladeMaterial)
  expect(ground.material).toBe(groundMaterial)
  expect(ground.geometry).toBe(groundGeometry)
  for (let index = 0; index < roots.count; index += 1) {
    expect(roots.getY(index)).toBeCloseTo(1, 6)
  }
  for (let index = 0; index < flowerRoots.count; index += 1) {
    expect(flowerRoots.getY(index)).toBeCloseTo(1, 6)
  }
  for (let index = 0; index < positions.count; index += 1) {
    expect(positions.getY(index)).toBeCloseTo(1.005, 6)
  }
})

test('width variation changes blade widths within the selected range', () => {
  const field = GrassFieldNode.parse({
    bladeWidth: 0.06,
    bladeWidthVariation: 20,
    bladeHeightVariation: 0,
    density: 100,
  })
  const group = buildGrassFieldGeometry(field, context)
  const blade = group.getObjectByName('grass-field-blade')

  expect(blade).toBeInstanceOf(InstancedMesh)
  if (!(blade instanceof InstancedMesh)) return

  const matrix = new Matrix4()
  const scale = new Vector3()
  const widths: number[] = []

  for (let index = 0; index < blade.count; index += 1) {
    blade.getMatrixAt(index, matrix)
    matrix.decompose(new Vector3(), new Quaternion(), scale)
    widths.push(scale.x)
  }

  expect(widths.every((width) => width >= 0.048 && width <= 0.072)).toBe(true)
  expect(widths.some((width) => Math.abs(width - field.bladeWidth) > 0.000_001)).toBe(true)
})

test('density is GPU-gated without changing candidate instances', () => {
  const emptyField = GrassFieldNode.parse({ density: 0 })
  const fullField = GrassFieldNode.parse({ density: 100 })
  const emptyBlade = buildGrassFieldGeometry(emptyField, context).getObjectByName(
    'grass-field-blade',
  )
  const fullBlade = buildGrassFieldGeometry(fullField, context).getObjectByName('grass-field-blade')

  expect(emptyBlade).toBeInstanceOf(InstancedMesh)
  expect(fullBlade).toBeInstanceOf(InstancedMesh)
  if (!(emptyBlade instanceof InstancedMesh) || !(fullBlade instanceof InstancedMesh)) return
  expect(emptyBlade.instanceMatrix.count).toBe(9)
  expect(emptyBlade.count).toBe(9)
  expect(fullBlade.count).toBe(emptyBlade.count)
  expect(
    Array.from(
      emptyBlade.geometry.getAttribute('grassDensityThreshold').array as ArrayLike<number>,
    ),
  ).toEqual(
    Array.from(fullBlade.geometry.getAttribute('grassDensityThreshold').array as ArrayLike<number>),
  )
})

test('uses painted RGB and density alpha for the ground material', () => {
  const paintField = createGrassPaintField(
    { minX: 0, maxX: 0.2, minZ: 0, maxZ: 0.2 },
    '#204060',
    0.25,
  )
  const field = GrassFieldNode.parse({
    paintMap: encodeGrassPaintField(paintField),
  })
  const group = buildGrassFieldGeometry(field, context)
  const runtime = getGrassPaintRuntime(field.id)
  const ground = group.getObjectByName('grass-field-ground')

  expect(runtime?.field.values.slice(0, 4)).toEqual(Uint8Array.from([0x20, 0x40, 0x60, 64]))
  const textureValues = runtime?.texture.image.data
  expect(textureValues).toBeInstanceOf(Uint8Array)
  if (textureValues instanceof Uint8Array) {
    expect(textureValues.slice(0, 4)).toEqual(Uint8Array.from([0x0c, 0x1e, 0x30, 64]))
  }
  expect(runtime?.texture.image.width).toBe(paintField.cols)
  expect(runtime?.texture.image.height).toBe(paintField.rows)
  expect(ground).toBeInstanceOf(Mesh)
})

test('site boundary and terrain edits invalidate their ground cover', () => {
  const field = GrassFieldNode.parse({ parentId: 'site_test' })
  const originalSite = context.parent
  if (originalSite?.type !== 'site') throw new Error('Expected the test parent to be a site')

  const resizedSite = SiteNode.parse({
    ...originalSite,
    polygon: {
      type: 'polygon',
      points: [
        [0, 0],
        [0.3, 0],
        [0.3, 0.2],
        [0, 0.2],
      ],
    },
  })
  const terrain = createTerrainField({
    origin: [0, 0],
    spacing: 0.1,
    cols: 3,
    rows: 3,
  })
  const sculptedSite = {
    ...originalSite,
    terrain: encodeTerrainField(terrain),
  }
  const originalNodes = {
    [field.id]: field,
    [originalSite.id]: originalSite,
  } as never

  expect(
    grassFieldSiteChanges(
      {
        [field.id]: field,
        [resizedSite.id]: resizedSite,
      } as never,
      originalNodes,
    ),
  ).toEqual([{ id: field.id, boundaryChanged: true, terrainChanged: false }])
  expect(
    grassFieldSiteChanges(
      {
        [field.id]: field,
        [sculptedSite.id]: sculptedSite,
      } as never,
      originalNodes,
    ),
  ).toEqual([{ id: field.id, boundaryChanged: false, terrainChanged: true }])
})

test('painted ground faces overhead light on flat and sculpted sites', () => {
  const boundary = [
    [0, 0],
    [0.2, 0],
    [0.2, 0.2],
    [0, 0.2],
  ] as const
  const terrain = createTerrainField({
    origin: [0, 0],
    spacing: 0.1,
    cols: 3,
    rows: 3,
    step: 0.01,
  })
  terrain.heights.set([0, 10, 20, 5, 15, 25, 10, 20, 30])
  const material = new MeshStandardNodeMaterial({ side: FrontSide })
  const ray = new Raycaster(new Vector3(0.077, 1, 0.137), new Vector3(0, -1, 0))
  try {
    for (const field of [null, terrain]) {
      const geometry = buildDrapedGroundGeometry(boundary, field)
      try {
        const hit = ray.intersectObject(new Mesh(geometry, material))[0]
        expect(hit?.point.y).toBeCloseTo(
          (field ? surfaceHeightAt(field, 0.077, 0.137) : 0) + 0.005,
          6,
        )
        expect(hit?.normal?.y).toBeGreaterThan(0)
      } finally {
        geometry.dispose()
      }
    }
  } finally {
    material.dispose()
  }
})
