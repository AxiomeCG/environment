import { pondSurfaceDepthAt, type PondSurface } from './basin'
import { koiFootprintFitsSurface } from './koi-motion'
import type { PondProp } from './schema'

export const MAX_POND_PROPS = 128
export const MAX_KOI = 32
const MIN_LILY_DEPTH = 0.015
const MAX_PROP_SCALE = 2.5

/** A prop's scale as the renderer draws it. */
export function renderedPropScale(prop: PondProp): number {
  return Math.min(MAX_PROP_SCALE, Math.max(0.2, prop.scale))
}

/**
 * Water-only placement predicate shared by the renderer and authoring actions.
 * It checks the actual yawed footprint, not only the prop's center, and scales
 * the koi depth requirement with its body height.
 */
export function pondPropFitsSurface(surface: PondSurface, prop: PondProp): boolean {
  if (
    surface.level === null
    || surface.positions.length === 0
    || !Number.isFinite(prop.position[0])
    || !Number.isFinite(prop.position[1])
    || !Number.isFinite(prop.scale)
    || prop.scale <= 0
  ) {
    return false
  }
  const scale = renderedPropScale(prop)
  const yaw = Number.isFinite(prop.yaw) ? prop.yaw : 0
  if (prop.kind === 'koi') {
    return koiFootprintFitsSurface(
      surface,
      prop.position[0],
      prop.position[1],
      yaw,
      scale,
    )
  }
  if (pondSurfaceDepthAt(surface, prop.position[0], prop.position[1]) < MIN_LILY_DEPTH) {
    return false
  }

  const radius = 0.3 * scale
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2 + yaw
    const x = prop.position[0] + Math.cos(angle) * radius
    const z = prop.position[1] - Math.sin(angle) * radius
    if (pondSurfaceDepthAt(surface, x, z) < MIN_LILY_DEPTH) return false
  }
  return true
}

/** The props the renderer draws on this surface, in order: those that fit, koi capped. */
export function renderablePondProps(
  props: readonly PondProp[],
  surface: PondSurface,
): PondProp[] {
  if (surface.level === null || surface.positions.length === 0) return []
  const accepted: PondProp[] = []
  let koiCount = 0
  for (const prop of props.slice(0, MAX_POND_PROPS)) {
    if (!pondPropFitsSurface(surface, prop)) continue
    if (prop.kind === 'koi') {
      if (koiCount >= MAX_KOI) continue
      koiCount += 1
    }
    accepted.push(prop)
  }
  return accepted
}
