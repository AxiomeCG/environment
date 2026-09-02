import type { Point2 } from './frontages'

export type FrontagePreviewViewBox = Readonly<{
  center: Point2
  height: number
  width: number
  x: number
  y: number
}>

// Pascal floorplans use their local Y axis as world Z. With SVG Y increasing
// downward, world -Z therefore appears at the top without negating Z.
export function sitePointToPreviewPoint([x, z]: Point2): Point2 {
  return [x, z]
}

export function cameraAzimuthToPreviewRotationDegrees(azimuth: number): number {
  return (azimuth * 180) / Math.PI
}

export function rotatePreviewPoint(
  point: Point2,
  rotationDegrees: number,
  center: Point2 = [0, 0],
): Point2 {
  if (rotationDegrees === 0) return point

  const radians = (rotationDegrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const localX = point[0] - center[0]
  const localY = point[1] - center[1]

  return [
    center[0] + localX * cos - localY * sin,
    center[1] + localX * sin + localY * cos,
  ]
}

export function deriveFrontagePreviewViewBox(
  points: readonly Point2[],
  padding: number,
): FrontagePreviewViewBox {
  if (points.length === 0) {
    throw new Error('Frontage preview requires at least one point')
  }
  if (!Number.isFinite(padding) || padding < 0) {
    throw new Error('Frontage preview padding must be a finite non-negative value')
  }

  const xValues = points.map(([x]) => x)
  const yValues = points.map(([, y]) => y)
  const minX = Math.min(...xValues)
  const maxX = Math.max(...xValues)
  const minY = Math.min(...yValues)
  const maxY = Math.max(...yValues)
  const center: Point2 = [(minX + maxX) / 2, (minY + maxY) / 2]
  const paddedWidth = Math.max(maxX - minX + padding * 2, 1)
  const paddedHeight = Math.max(maxY - minY + padding * 2, 1)
  const size = Math.hypot(paddedWidth, paddedHeight)

  return {
    center,
    x: center[0] - size / 2,
    y: center[1] - size / 2,
    width: size,
    height: size,
  }
}
