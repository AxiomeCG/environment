import { type GeometryContext, SiteNode } from '@pascal-app/core'
import { expect, test } from 'bun:test'
import { InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { GLOBAL_WIND_STRENGTH } from '../wind-node'
import {
  buildGrassFieldGeometry,
  GRASS_FIELD_WIND_INFLUENCE,
  updateGrassFieldUniforms,
} from './geometry'
import { createGrassPaintField, encodeGrassPaintField } from './paint-field'
import { getGrassPaintRuntime } from './paint-texture'
import { getMissingGrassFieldDefaults, GrassFieldNode } from './schema'
import { grassFieldGeometryInputsEqual } from './system'

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

test('grass-field percentage controls have stable defaults', () => {
  const field = GrassFieldNode.parse({})

  expect(field.bladeWidthVariation).toBe(20)
  expect(field.bladeHeightVariation).toBe(20)
  expect(field.bladeTintVariation).toBe(20)
  expect(field.bladeTipBrightness).toBe(300)
  expect(field.density).toBe(100)
  expect(field.windStrength).toBe(100)
  expect(field.grassWindInfluence).toBe(100)
  expect(field.paintMap).toBeUndefined()
})

test('missing controls receive defaults without replacing explicit zeroes', () => {
  expect(getMissingGrassFieldDefaults({})).toEqual({
    bladeWidthVariation: 20,
    bladeHeightVariation: 20,
    bladeTintVariation: 20,
    bladeTipBrightness: 300,
    density: 100,
    windStrength: 100,
    grassWindInfluence: 100,
  })

  expect(
    getMissingGrassFieldDefaults({
      bladeWidthVariation: 0,
      bladeHeightVariation: 0,
      bladeTintVariation: 0,
      bladeTipBrightness: 0,
      density: 0,
      windStrength: 0,
      grassWindInfluence: 0,
    }),
  ).toEqual({})
})

test('global strength and grass influence update independently', () => {
  const field = GrassFieldNode.parse({ windStrength: 40, grassWindInfluence: 175 })

  buildGrassFieldGeometry(field, context)

  expect(GLOBAL_WIND_STRENGTH.value).toBeCloseTo(0.4)
  expect(GRASS_FIELD_WIND_INFLUENCE.value).toBeCloseTo(1.75)
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
    bladeTintVariation: 75,
    bladeTipBrightness: 180,
    density: 35,
    windStrength: 60,
    grassWindInfluence: 140,
  })

  expect(updateGrassFieldUniforms(group, updated)).toBe(true)
  const uniforms = blade.userData.grassFieldUniforms as {
    density: { value: number }
    tintVariation: { value: number }
    tipBrightness: { value: number }
  }
  expect(uniforms.density.value).toBeCloseTo(0.35)
  expect(uniforms.tintVariation.value).toBeCloseTo(0.75)
  expect(uniforms.tipBrightness.value).toBeCloseTo(1.8)
  expect(GLOBAL_WIND_STRENGTH.value).toBeCloseTo(0.6)
  expect(GRASS_FIELD_WIND_INFLUENCE.value).toBeCloseTo(1.4)
  expect(blade.geometry).toBe(geometry)
  expect(blade.material).toBe(material)
})

test('separates shader-only controls from geometry inputs', () => {
  const paintMap = encodeGrassPaintField(
    createGrassPaintField({ minX: 0, maxX: 0.2, minZ: 0, maxZ: 0.2 }, '#204060'),
  )
  const field = GrassFieldNode.parse({ paintMap })
  const shaderOnlyUpdate = GrassFieldNode.parse({
    ...field,
    bladeTintVariation: 90,
    bladeTipBrightness: 125,
    density: 40,
    windStrength: 80,
    grassWindInfluence: 160,
  })
  const geometryUpdate = GrassFieldNode.parse({ ...field, bladeWidth: field.bladeWidth * 2 })
  const paintUpdate = GrassFieldNode.parse({
    ...field,
    paintMap: { ...paintMap, values: paintMap.values.replace(/^./, 'A') },
  })

  expect(shaderOnlyUpdate.paintMap).not.toBe(field.paintMap)
  expect(grassFieldGeometryInputsEqual(field, shaderOnlyUpdate)).toBe(true)
  expect(grassFieldGeometryInputsEqual(field, geometryUpdate)).toBe(false)
  expect(grassFieldGeometryInputsEqual(field, paintUpdate)).toBe(false)
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
  expect(blade.instanceMatrix.count).toBe(4)
  expect(blade.count).toBe(4)
  expect(blade.material).toBeInstanceOf(MeshStandardNodeMaterial)
  if (blade.material instanceof MeshStandardNodeMaterial) {
    expect(blade.material.positionNode).not.toBeNull()
    expect(blade.material.opacityNode).toBeNull()
    expect(blade.material.transparent).toBe(false)
  }

  const roots = blade.geometry.getAttribute('grassRoot')
  const thresholds = blade.geometry.getAttribute('grassDensityThreshold')
  const tints = blade.geometry.getAttribute('grassTintVariation')
  expect(roots).toBeInstanceOf(InstancedBufferAttribute)
  expect(thresholds).toBeInstanceOf(InstancedBufferAttribute)
  expect(tints).toBeInstanceOf(InstancedBufferAttribute)
  expect(roots.count).toBe(blade.count)
  expect(thresholds.count).toBe(blade.count)
  expect(tints.count).toBe(blade.count)
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
  expect(scale.z).toBeCloseTo(1)
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
  const fullBlade = buildGrassFieldGeometry(fullField, context).getObjectByName(
    'grass-field-blade',
  )

  expect(emptyBlade).toBeInstanceOf(InstancedMesh)
  expect(fullBlade).toBeInstanceOf(InstancedMesh)
  if (!(emptyBlade instanceof InstancedMesh) || !(fullBlade instanceof InstancedMesh)) return
  expect(emptyBlade.instanceMatrix.count).toBe(4)
  expect(emptyBlade.count).toBe(4)
  expect(fullBlade.count).toBe(emptyBlade.count)
  expect(
    Array.from(
      emptyBlade.geometry.getAttribute('grassDensityThreshold').array as ArrayLike<number>,
    ),
  ).toEqual(
    Array.from(
      fullBlade.geometry.getAttribute('grassDensityThreshold').array as ArrayLike<number>,
    ),
  )
})

test('uses painted RGB and density alpha for the ground material', () => {
  const paintField = createGrassPaintField(
    { minX: 0, maxX: 0.2, minZ: 0, maxZ: 0.2 },
    '#204060',
    0.25,
  )
  const field = GrassFieldNode.parse({ paintMap: encodeGrassPaintField(paintField) })
  const group = buildGrassFieldGeometry(field, context)
  const runtime = getGrassPaintRuntime(field.id)
  const ground = group.getObjectByName('grass-field-ground')

  expect(runtime?.field.values.slice(0, 4)).toEqual(Uint8Array.from([0x20, 0x40, 0x60, 64]))
  expect(runtime?.texture.image.width).toBe(paintField.cols)
  expect(runtime?.texture.image.height).toBe(paintField.rows)
  expect(ground).toBeInstanceOf(Mesh)
  if (!(ground instanceof Mesh) || !(ground.material instanceof MeshStandardNodeMaterial)) return
  expect(ground.material.colorNode).not.toBeNull()
  expect(ground.material.opacityNode).not.toBeNull()
  expect(ground.material.maskNode).not.toBeNull()
  expect(ground.material.transparent).toBe(true)
  expect(ground.material.depthWrite).toBe(false)
})
