import { describe, expect, test } from 'bun:test'
import { Float32BufferAttribute, PlaneGeometry } from 'three'
import { bakeWaterMaterial } from './water-material-bake'

const BASE_OPTIONS = {
  name: 'acceptance-water',
  color: '#336699',
}

describe('portable water material requirements', () => {
  test('rejects water geometry without depth data before GPU work', async () => {
    const geometry = new PlaneGeometry(1, 1)

    await expect(bakeWaterMaterial(geometry, BASE_OPTIONS)).rejects.toThrow(
      'cannot bake without waterDepth geometry data',
    )

    geometry.dispose()
  })

  test('rejects shore fading without shore-distance data', async () => {
    const geometry = new PlaneGeometry(1, 1)
    geometry.setAttribute(
      'waterDepth',
      new Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count), 1),
    )

    await expect(
      bakeWaterMaterial(geometry, { ...BASE_OPTIONS, shoreFade: [0.4, 0.2] }),
    ).rejects.toThrow('cannot bake without shoreDistance geometry data')

    geometry.dispose()
  })

  test('rejects flowing water without tangent and course data', async () => {
    const geometry = new PlaneGeometry(1, 1)
    geometry.setAttribute(
      'waterDepth',
      new Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count), 1),
    )

    await expect(
      bakeWaterMaterial(geometry, {
        ...BASE_OPTIONS,
        flow: { speed: 1, direction: 1 },
      }),
    ).rejects.toThrow('cannot bake without flow geometry data')

    geometry.dispose()
  })
})
