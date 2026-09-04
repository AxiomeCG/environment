import { expect, test } from 'bun:test'
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import {
  createMailboxPresentationGeometry,
  createParkedCarPresentationGeometry,
  createStreetLightPresentationGeometry,
} from './streetscape-prop-geometry'

test('preserves the full mailbox and street light in their merged presentation geometry', () => {
  const mailbox = createMailboxPresentationGeometry()
  const lamp = createStreetLightPresentationGeometry()
  try {
    expect(mailbox.body.boundingBox!.min.y).toBeCloseTo(0, 5)
    expect(mailbox.body.boundingBox!.max.y).toBeGreaterThan(1.6)
    expect(mailbox.body.boundingBox!.max.x).toBeGreaterThan(0.2)
    expect(mailbox.accent.boundingBox!.max.y).toBeGreaterThan(mailbox.body.boundingBox!.max.y)
    const mailboxTriangles = Object.values(mailbox).reduce((total, geometry) =>
      total + (geometry.index?.count ?? geometry.getAttribute('position').count) / 3, 0)
    expect(mailboxTriangles).toBeLessThanOrEqual(250)
    expect(lamp.body.boundingBox!.min.y).toBeCloseTo(0, 5)
    expect(lamp.body.boundingBox!.max.y).toBeGreaterThan(4.6)
    expect(lamp.body.boundingBox!.max.x).toBeGreaterThan(2)
    for (const geometry of [...Object.values(mailbox), ...Object.values(lamp)]) {
      const positions = geometry.getAttribute('position')
      for (const index of geometry.index!.array) {
        expect(index).toBeLessThan(positions.count)
        expect(Number.isFinite(positions.getX(index) + positions.getY(index) + positions.getZ(index))).toBe(true)
      }
    }
  } finally {
    for (const geometry of [...Object.values(mailbox), ...Object.values(lamp)]) geometry.dispose()
  }
})


test('presents the front windshield to an outside viewer', () => {
  const car = createParkedCarPresentationGeometry()
  const material = new MeshBasicMaterial()
  try {
    const glass = new Mesh(car.accent, material)
    glass.updateMatrixWorld(true)
    const ray = new Raycaster(new Vector3(0, 1.2, 4), new Vector3(0, 0, -1))
    expect(ray.intersectObject(glass)[0]?.point.z).toBeGreaterThan(0)
  } finally {
    material.dispose()
    for (const geometry of Object.values(car)) geometry.dispose()
  }
})
