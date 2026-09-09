import type { AnyNodeId, GeometryContext } from '@pascal-app/core'
import { PlaneGeometry } from 'three'
import { siteBounds } from '../ground-cover/paint-field'
import { GrassFieldNode } from '../ground-cover/schema'
import { bakeSurfaceMaterialMaps, type BakedSurfaceMaterialMaps } from './bake-geometry'
import { resolveSurfaceMaterial, surfaceMaterialNodeOfSite } from './field-context'

export type SurfaceExportSample = {
  r: number
  g: number
  b: number
  coverage: number
}

export type SurfaceExportSampler = {
  sample: (x: number, z: number, out: SurfaceExportSample) => void
  dispose: () => void
}

export async function createSurfaceExportSampler(
  ctx: GeometryContext,
): Promise<SurfaceExportSampler | null> {
  const site = ctx.parent
  if (!site || site.type !== 'site') return null
  const node = surfaceMaterialNodeOfSite(site, ctx)
  if (!node) return null
  const resolved = resolveSurfaceMaterial(node, ctx)
  if (!resolved) return null

  const bounds = siteBounds(site.polygon.points)
  const sampleHalo = surfaceSampleHalo(site.children, ctx)
  const geometry = new PlaneGeometry(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)
  geometry.rotateX(-Math.PI * 0.5)
  geometry.translate((bounds.minX + bounds.maxX) * 0.5, 0, (bounds.minZ + bounds.maxZ) * 0.5)
  let baked: BakedSurfaceMaterialMaps
  try {
    baked = await bakeSurfaceMaterialMaps(node, resolved, geometry, ['base'], sampleHalo)
  } finally {
    geometry.dispose()
  }

  const { bounds: bakedBounds, width, height } = baked
  let basePixels: Uint8ClampedArray | null = baked.basePixels
  baked.base.dispose()
  return {
    sample(x, z, out) {
      const pixels = basePixels
      if (!pixels) throw new Error('Surface export sampler has been disposed')
      if (!Number.isFinite(x) || !Number.isFinite(z)) {
        out.r = 0
        out.g = 0
        out.b = 0
        out.coverage = 0
        return
      }

      if (
        x < bounds.minX - sampleHalo ||
        x > bounds.maxX + sampleHalo ||
        z < bounds.minZ - sampleHalo ||
        z > bounds.maxZ + sampleHalo
      ) {
        throw new Error(
          `Surface export sample (${x}, ${z}) exceeds its ${sampleHalo}m grass-blade halo`,
        )
      }
      const pixelX = ((x - bakedBounds.minX) / (bakedBounds.maxX - bakedBounds.minX)) * width - 0.5
      const pixelY = ((z - bakedBounds.minZ) / (bakedBounds.maxZ - bakedBounds.minZ)) * height - 0.5
      const sourceX = Math.floor(pixelX)
      const sourceY = Math.floor(pixelY)
      const x0 = Math.max(0, Math.min(width - 1, sourceX))
      const y0 = Math.max(0, Math.min(height - 1, sourceY))
      const x1 = Math.max(0, Math.min(width - 1, sourceX + 1))
      const y1 = Math.max(0, Math.min(height - 1, sourceY + 1))
      const tx = pixelX - sourceX
      const ty = pixelY - sourceY
      const topLeft = (y0 * width + x0) * 4
      const topRight = (y0 * width + x1) * 4
      const bottomLeft = (y1 * width + x0) * 4
      const bottomRight = (y1 * width + x1) * 4
      const coverageTop = pixels[topLeft + 3]! * (1 - tx) + pixels[topRight + 3]! * tx
      const coverageBottom = pixels[bottomLeft + 3]! * (1 - tx) + pixels[bottomRight + 3]! * tx
      out.r = sampleLinearChannel(pixels, topLeft, topRight, bottomLeft, bottomRight, tx, ty, 0)
      out.g = sampleLinearChannel(pixels, topLeft, topRight, bottomLeft, bottomRight, tx, ty, 1)
      out.b = sampleLinearChannel(pixels, topLeft, topRight, bottomLeft, bottomRight, tx, ty, 2)
      out.coverage = (coverageTop * (1 - ty) + coverageBottom * ty) / 255
    },
    dispose() {
      basePixels = null
    },
  }
}

function surfaceSampleHalo(childIds: readonly string[], ctx: GeometryContext): number {
  let halo = 0
  for (const childId of childIds) {
    const parsed = GrassFieldNode.safeParse(ctx.resolve(childId as AnyNodeId))
    if (!parsed.success) continue
    halo = Math.max(
      halo,
      0.625 * parsed.data.bladeWidth * (1 + parsed.data.bladeWidthVariation / 100),
    )
  }
  return halo
}

function sampleLinearChannel(
  pixels: Uint8ClampedArray,
  topLeft: number,
  topRight: number,
  bottomLeft: number,
  bottomRight: number,
  tx: number,
  ty: number,
  channel: number,
): number {
  const top =
    decodeSrgbByte(pixels[topLeft + channel]!) * (1 - tx) +
    decodeSrgbByte(pixels[topRight + channel]!) * tx
  const bottom =
    decodeSrgbByte(pixels[bottomLeft + channel]!) * (1 - tx) +
    decodeSrgbByte(pixels[bottomRight + channel]!) * tx
  return top * (1 - ty) + bottom * ty
}

function decodeSrgbByte(value: number): number {
  const encoded = value / 255
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4
}
