import { describe, expect, test } from 'bun:test'
import {
  cameraAzimuthToPreviewRotationDegrees,
  deriveFrontagePreviewViewBox,
  rotatePreviewPoint,
  sitePointToPreviewPoint,
} from './frontage-preview'
import type { Point2 } from './frontages'

function expectPoint(actual: Point2, expected: Point2): void {
  expect(actual[0]).toBeCloseTo(expected[0], 10)
  expect(actual[1]).toBeCloseTo(expected[1], 10)
}

describe('frontage preview orientation', () => {
  test('uses the Pascal floorplan convention where world -Z is screen-up', () => {
    expect(sitePointToPreviewPoint([4, -10])).toEqual([4, -10])
    expect(sitePointToPreviewPoint([4, 10])).toEqual([4, 10])
  })

  test('rotates the preview by the public camera azimuth', () => {
    const rotationDegrees = cameraAzimuthToPreviewRotationDegrees(Math.PI / 2)

    expect(rotationDegrees).toBeCloseTo(90, 10)
    expectPoint(rotatePreviewPoint([0, -10], rotationDegrees), [10, 0])
  })

  test('keeps the complete diagram inside its diagonal overscan near 45 degrees', () => {
    const corners = [
      [-20, -10],
      [20, -10],
      [20, 10],
      [-20, 10],
    ] as const satisfies readonly Point2[]
    const viewBox = deriveFrontagePreviewViewBox(corners, 2)
    const rotatedCorners = corners.map((point) =>
      rotatePreviewPoint(point, 45, viewBox.center),
    )

    expect(viewBox.width).toBe(viewBox.height)
    for (const [x, y] of rotatedCorners) {
      expect(x).toBeGreaterThanOrEqual(viewBox.x)
      expect(x).toBeLessThanOrEqual(viewBox.x + viewBox.width)
      expect(y).toBeGreaterThanOrEqual(viewBox.y)
      expect(y).toBeLessThanOrEqual(viewBox.y + viewBox.height)
    }
  })
})
