export const MAX_GRASS_NORMAL_YAW = 0.25

export type GrassBladeCurvePoint = {
  horizontal: number
  vertical: number
}

/**
 * Evaluates a circular-arc blade centerline without an unstable zero-angle
 * division. The bend angle is authored in the schema's 0..1 radian range.
 */
export function evaluateGrassBladeCurve(
  normalizedHeight: number,
  straightHeight: number,
  bend: number,
  output: GrassBladeCurvePoint,
): void {
  const height = clamp(normalizedHeight, 0, 1)
  const angle = clamp(bend, 0, 1) * height
  if (Math.abs(angle) < 1e-5) {
    output.horizontal = 0
    output.vertical = straightHeight
    return
  }

  output.horizontal = (straightHeight * (1 - Math.cos(angle))) / angle
  output.vertical = (straightHeight * Math.sin(angle)) / angle
}

export function shapeGrassCoverageValue(coverage: number): number {
  const amount = clamp(coverage, 0, 1)
  const normalized = clamp((amount - 0.05) / 0.95, 0, 1)
  return normalized * normalized * (3 - 2 * normalized)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}
