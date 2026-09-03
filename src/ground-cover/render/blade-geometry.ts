import { BufferGeometry, Float32BufferAttribute } from 'three'

export type BladeGeometryOptions = {
  width: number
  height: number
}

export function buildBladeGeometry(_options: BladeGeometryOptions): BufferGeometry {
  const vertices = [
    -0.625, 0, 0,
    0.625, 0, 0,
    -0.375, 0.333, 0,
    0.375, 0.333, 0,
    -0.167, 0.667, 0,
    0.167, 0.667, 0,
    0, 1, 0,
    0, 0, -0.625,
    0, 0, 0.625,
    0, 0.333, -0.375,
    0, 0.333, 0.375,
    0, 0.667, -0.167,
    0, 0.667, 0.167,
    0, 1, 0,
  ]

  const indices = [
    0, 1, 2,
    1, 3, 2,
    2, 3, 4,
    3, 5, 4,
    4, 5, 6,
    7, 8, 9,
    8, 10, 9,
    9, 10, 11,
    10, 12, 11,
    11, 12, 13,
  ]

  const bufferGeometry = new BufferGeometry()
  bufferGeometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  bufferGeometry.setIndex(indices)
  bufferGeometry.computeVertexNormals()
  return bufferGeometry
}
