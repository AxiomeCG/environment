import { DataTexture, LinearFilter, RGBAFormat } from 'three'
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js'
import type { FieldPatch } from './third-ring'

const noise = new ImprovedNoise()
type RootGrid = { minX: number; minZ: number; columns: number; rows: number; heads: Int32Array; next: Int32Array }
const rootGrids = new WeakMap<FieldPatch, RootGrid>()

function rootCoverage(x: number, z: number, patch: FieldPatch): number {
  const roots = patch.roots
  if (!roots?.length) return 0
  let grid = rootGrids.get(patch)
  if (!grid) {
    const minX = patch.center[0] - patch.width / 2, minZ = patch.center[1] - patch.depth / 2
    const columns = Math.ceil(patch.width / 8) + 1, rows = Math.ceil(patch.depth / 8) + 1
    const heads = new Int32Array(columns * rows).fill(-1), next = new Int32Array(roots.length)
    for (let index = 0; index < roots.length; index++) {
      const root = roots[index]!
      const cell = Math.floor((root[1] - minZ) / 8) * columns + Math.floor((root[0] - minX) / 8)
      next[index] = heads[cell]!
      heads[cell] = index
    }
    grid = { minX, minZ, columns, rows, heads, next }
    rootGrids.set(patch, grid)
  }
  const column = Math.floor((x - grid.minX) / 8), row = Math.floor((z - grid.minZ) / 8)
  let distanceSquared = 4.5 ** 2
  for (let r = Math.max(0, row - 1); r <= Math.min(grid.rows - 1, row + 1); r++) {
    for (let c = Math.max(0, column - 1); c <= Math.min(grid.columns - 1, column + 1); c++) {
      for (let index = grid.heads[r * grid.columns + c]!; index !== -1; index = grid.next[index]!) {
        const root = roots[index]!
        distanceSquared = Math.min(distanceSquared, (x - root[0]) ** 2 + (z - root[1]) ** 2)
      }
    }
  }
  return 1 - smooth(1.5 ** 2, 4.5 ** 2, distanceSquared)
}

function smooth(low: number, high: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}

/** Broken, world-space coverage for the terrain tint, without rectangular patch edges. */
export function fieldCoverage(x: number, z: number, patch: FieldPatch): number {
  const cosine = Math.cos(patch.rotationY), sine = Math.sin(patch.rotationY)
  const dx = x - patch.center[0], dz = z - patch.center[1]
  const u = (dx * cosine - dz * sine) * 2 / patch.width
  const v = (dx * sine + dz * cosine) * 2 / patch.depth
  const edge = 1 - Math.max(Math.abs(u), Math.abs(v))
  if (edge <= 0) return 0
  const roots = patch.roots ? rootCoverage(x, z, patch) : 1
  if (roots === 0) return 0
  const domain = (patch.seed >>> 0) / 0x100000000 * 251
  // World-space octaves make broad clumps, ragged edges and small gaps, not round islands.
  const warpX = noise.noise(x * 0.035, z * 0.035, domain) * 5
  const warpZ = noise.noise(x * 0.035 + 43, z * 0.035 - 19, domain) * 5
  const px = x + warpX, pz = z + warpZ
  const growth = noise.noise(px * 0.075, pz * 0.075, domain + 3) * 0.6
    + noise.noise(px * 0.19, pz * 0.19, domain + 17) * 0.28
    + noise.noise(px * 0.43, pz * 0.43, domain + 29) * 0.12
  if (patch.kind === 'wheat') return smooth(0, 0.14, edge) * smooth(-0.45, -0.12, growth)
  if (patch.roots) return roots * smooth(-0.32, 0.14, growth)
  const brokenEdge = growth + 0.27 - (1 - edge) ** 3 * 0.48
  return smooth(0, 0.22, edge) * smooth(-0.12, 0.25, brokenEdge)
}

/** Coverage is baked once into the existing terrain pass; no overlapping ground meshes. */
export function buildFieldCoverageTexture(plans: readonly FieldPatch[]) {
  const resolution = plans.length ? 512 : 1
  let minX = 0, minZ = 0, maxX = 1, maxZ = 1
  if (plans.length) {
    minX = minZ = Infinity; maxX = maxZ = -Infinity
    for (const patch of plans) {
      const radius = Math.hypot(patch.width, patch.depth) / 2 + 8
      minX = Math.min(minX, patch.center[0] - radius); maxX = Math.max(maxX, patch.center[0] + radius)
      minZ = Math.min(minZ, patch.center[1] - radius); maxZ = Math.max(maxZ, patch.center[1] + radius)
    }
  }
  const width = maxX - minX, depth = maxZ - minZ
  const data = new Uint8Array(resolution * resolution * 4)
  for (const patch of plans) {
    const radius = Math.hypot(patch.width, patch.depth) / 2
    const firstX = Math.max(0, Math.floor((patch.center[0] - radius - minX) / width * resolution))
    const lastX = Math.min(resolution - 1, Math.ceil((patch.center[0] + radius - minX) / width * resolution))
    const firstZ = Math.max(0, Math.floor((patch.center[1] - radius - minZ) / depth * resolution))
    const lastZ = Math.min(resolution - 1, Math.ceil((patch.center[1] + radius - minZ) / depth * resolution))
    for (let row = firstZ; row <= lastZ; row += 1) for (let column = firstX; column <= lastX; column += 1) {
      const coverage = fieldCoverage(minX + (column + 0.5) / resolution * width, minZ + (row + 0.5) / resolution * depth, patch)
      const channel = patch.kind === 'wheat' ? 0 : patch.kind === 'woodland' ? 1 : 2
      const offset = (row * resolution + column) * 4 + channel
      data[offset] = Math.max(data[offset]!, Math.round(coverage * 255))
    }
  }
  const texture = new DataTexture(data, resolution, resolution, RGBAFormat)
  texture.magFilter = texture.minFilter = LinearFilter
  texture.needsUpdate = true
  return { texture, origin: [minX, minZ] as const, width, depth }
}
