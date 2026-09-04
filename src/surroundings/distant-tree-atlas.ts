import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three'
import { hashString } from './seeded-random'

export const DISTANT_TREE_VARIANTS = 4
export const DISTANT_TREE_VIEWS = 4
export const DISTANT_TREE_TILE_SIZE = 128

const ATLAS_SIZE = DISTANT_TREE_TILE_SIZE * DISTANT_TREE_VARIANTS
const CARD_WIDTH = 0.85
const RASTER_SCALE = 2
const RASTER_SIZE = DISTANT_TREE_TILE_SIZE * RASTER_SCALE
const SIDE_LIMIT = 0.397
const TOP_LIMIT = 0.968
const BLEED_RADIUS = 4
const EMPTY_DEPTH = Number.NEGATIVE_INFINITY
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

type Point3 = readonly [x: number, y: number, z: number]

type Random = () => number

interface Ellipsoid {
  center: Point3
  radii: Point3
  yaw: number
  luminance: number
}

interface Branch {
  start: Point3
  end: Point3
  radius: number
  luminance: number
}

interface TreeShape {
  foliage: Ellipsoid[]
  branches: Branch[]
}

interface RasterWorkspace {
  depth: Float32Array
  luminance: Uint8Array
  normals: Int8Array
  colorTile: Uint8Array
  normalTile: Uint8Array
  bleedMask: Uint8Array
  nextBleedMask: Uint8Array
}

type DistantTreeAtlas = {
  color: DataTexture
  normal: DataTexture
}

const cachedAtlases: [DistantTreeAtlas | undefined, DistantTreeAtlas | undefined] = [
  undefined,
  undefined,
]

function createRandom(seed: string): Random {
  let state = hashString(seed)
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_00_00_00_00
  }
}

function range(random: Random, minimum: number, maximum: number): number {
  return minimum + (maximum - minimum) * random()
}

function addEllipsoid(
  shape: TreeShape,
  center: Point3,
  radii: Point3,
  yaw: number,
  luminance: number,
): void {
  const requestedRadiusX = radii[0]
  const requestedRadiusZ = radii[2]
  const yawSin = Math.sin(yaw)
  const yawCos = Math.cos(yaw)
  const worldExtentX = Math.hypot(requestedRadiusX * yawCos, requestedRadiusZ * yawSin)
  const worldExtentZ = Math.hypot(requestedRadiusX * yawSin, requestedRadiusZ * yawCos)
  const horizontalScale = Math.max(0, Math.min(
    1,
    (SIDE_LIMIT - Math.abs(center[0])) / worldExtentX,
    (SIDE_LIMIT - Math.abs(center[2])) / worldExtentZ,
  ))
  const radiusX = requestedRadiusX * horizontalScale
  const radiusY = Math.min(radii[1], TOP_LIMIT - center[1], center[1])
  const radiusZ = requestedRadiusZ * horizontalScale
  if (radiusX <= 0.012 || radiusY <= 0.012 || radiusZ <= 0.012) return
  shape.foliage.push({
    center,
    radii: [radiusX, radiusY, radiusZ],
    yaw,
    luminance: Math.round(luminance),
  })
}

function addTaperedBranch(
  shape: TreeShape,
  start: Point3,
  end: Point3,
  startRadius: number,
  endRadius: number,
  subdivisions: number,
  luminance: number,
): void {
  for (let index = 0; index < subdivisions; index += 1) {
    const from = index / subdivisions
    const to = (index + 1) / subdivisions
    const segmentStart: Point3 = [
      start[0] + (end[0] - start[0]) * from,
      start[1] + (end[1] - start[1]) * from,
      start[2] + (end[2] - start[2]) * from,
    ]
    const segmentEnd: Point3 = [
      start[0] + (end[0] - start[0]) * to,
      start[1] + (end[1] - start[1]) * to,
      start[2] + (end[2] - start[2]) * to,
    ]
    shape.branches.push({
      start: segmentStart,
      end: segmentEnd,
      radius: startRadius + (endRadius - startRadius) * (from + to) * 0.5,
      luminance,
    })
  }
}

const BROADLEAF_FORMS = [
  { spreadX: 0.35, spreadZ: 0.29, base: 0.43, middle: 0.69, leanX: -0.015, leanZ: 0.012 },
  { spreadX: 0.28, spreadZ: 0.35, base: 0.39, middle: 0.68, leanX: 0.025, leanZ: -0.018 },
  { spreadX: 0.35, spreadZ: 0.27, base: 0.46, middle: 0.72, leanX: 0.055, leanZ: 0.018 },
  { spreadX: 0.31, spreadZ: 0.36, base: 0.41, middle: 0.67, leanX: -0.032, leanZ: -0.028 },
] as const

function broadleafShape(variant: number): TreeShape {
  const form = BROADLEAF_FORMS[variant]!
  const random = createRandom(`distant-broadleaf-${variant}`)
  const shape: TreeShape = { foliage: [], branches: [] }
  const fork: Point3 = [form.leanX * 0.44, 0.49, form.leanZ * 0.44]

  // The lower trunk is vertical so its finite cylinder terminates exactly on y=0.
  addTaperedBranch(shape, [0, 0, 0], [0, 0.2, 0], 0.027, 0.024, 2, 120)
  addTaperedBranch(shape, [0, 0.18, 0], fork, 0.025, 0.017, 3, 124)

  const branchTargets: Point3[] = []
  const branchCount = 5 + (variant & 1)
  const branchPhase = range(random, -Math.PI, Math.PI)
  for (let index = 0; index < branchCount; index += 1) {
    const angle = branchPhase + index * Math.PI * 2 / branchCount + range(random, -0.24, 0.24)
    const reach = range(random, 0.42, 0.7)
    const height = range(random, 0.61, 0.79)
    const target: Point3 = [
      form.leanX * 0.72 + Math.cos(angle) * form.spreadX * reach,
      height,
      form.leanZ * 0.72 + Math.sin(angle) * form.spreadZ * reach,
    ]
    branchTargets.push(target)
    addTaperedBranch(
      shape,
      [fork[0], fork[1] - range(random, 0, 0.045), fork[2]],
      target,
      range(random, 0.012, 0.016),
      range(random, 0.0045, 0.007),
      3,
      128 + variant * 2,
    )
  }

  // Overlapping unequal cores keep the crown connected without reducing it to
  // a handful of smooth discs.
  const coreCenters: Point3[] = [
    [form.leanX * 0.7, form.middle - 0.055, form.leanZ * 0.7],
    [-form.spreadX * 0.22 + form.leanX, form.middle - 0.015, form.spreadZ * 0.12],
    [form.spreadX * 0.23 + form.leanX, form.middle + 0.035, -form.spreadZ * 0.14],
    [form.leanX * 1.15, form.middle + 0.145, form.spreadZ * 0.08 + form.leanZ],
    [-form.spreadX * 0.08 + form.leanX, form.middle + 0.205, -form.spreadZ * 0.11],
  ]
  for (let index = 0; index < coreCenters.length; index += 1) {
    const center = coreCenters[index]!
    addEllipsoid(
      shape,
      center,
      [
        range(random, 0.105, 0.15) * (index === 0 ? 1.1 : 1),
        range(random, 0.09, 0.135),
        range(random, 0.105, 0.15),
      ],
      range(random, -Math.PI, Math.PI),
      range(random, 193, 215) + center[1] * 8,
    )
  }

  // Small three-dimensional lobes form a broken edge. Their golden-angle
  // distribution leaves narrow gaps while avoiding a repeated scallop rhythm.
  const lobeCount = 18 + variant
  const verticalSpan = 0.45
  const lobePhase = range(random, -Math.PI, Math.PI)
  for (let index = 0; index < lobeCount; index += 1) {
    const heightT = (index + range(random, 0.15, 0.85)) / lobeCount
    const height = form.base + 0.025 + heightT * verticalSpan
    const crownT = Math.max(-1, Math.min(1, (height - form.middle) / 0.285))
    const profile = Math.sqrt(Math.max(0.12, 1 - crownT * crownT))
    const angle = lobePhase + index * GOLDEN_ANGLE + range(random, -0.2, 0.2)
    const radial = range(random, 0.45, 0.83)
    const leanT = Math.max(0, Math.min(1, (height - form.base) / verticalSpan))
    const center: Point3 = [
      form.leanX * leanT + Math.cos(angle) * form.spreadX * profile * radial,
      height,
      form.leanZ * leanT + Math.sin(angle) * form.spreadZ * profile * radial,
    ]
    addEllipsoid(
      shape,
      center,
      [range(random, 0.06, 0.105), range(random, 0.048, 0.09), range(random, 0.06, 0.105)],
      angle + range(random, -0.5, 0.5),
      range(random, 188, 221) + height * 7,
    )
  }

  // A few detached-looking edge tufts remain connected in depth and give the
  // orthogonal views distinct silhouettes and depth ordering.
  for (let index = 0; index < branchTargets.length; index += 1) {
    const target = branchTargets[index]!
    addEllipsoid(
      shape,
      [target[0], target[1] + range(random, 0.005, 0.04), target[2]],
      [range(random, 0.055, 0.085), range(random, 0.045, 0.075), range(random, 0.055, 0.085)],
      range(random, -Math.PI, Math.PI),
      range(random, 188, 211),
    )
  }

  return shape
}

const PINE_FORMS = [
  { width: 0.335, base: 0.25, top: 0.95, tiers: 7, leanX: 0.008, leanZ: -0.012 },
  { width: 0.275, base: 0.2, top: 0.962, tiers: 8, leanX: -0.018, leanZ: 0.02 },
  { width: 0.36, base: 0.3, top: 0.915, tiers: 6, leanX: -0.035, leanZ: -0.012 },
  { width: 0.305, base: 0.235, top: 0.945, tiers: 7, leanX: 0.028, leanZ: 0.024 },
] as const

function pineShape(variant: number): TreeShape {
  const form = PINE_FORMS[variant]!
  const random = createRandom(`distant-pine-${variant}`)
  const shape: TreeShape = { foliage: [], branches: [] }

  addTaperedBranch(shape, [0, 0, 0], [0, 0.2, 0], 0.024, 0.021, 2, 113)
  addTaperedBranch(
    shape,
    [0, 0.18, 0],
    [form.leanX, form.top, form.leanZ],
    0.021,
    0.0045,
    8,
    118,
  )

  const phase = range(random, -Math.PI, Math.PI)
  for (let tier = 0; tier < form.tiers; tier += 1) {
    const tierT = tier / Math.max(1, form.tiers - 1)
    const height = form.base + tierT * (form.top - form.base - 0.095) + range(random, -0.012, 0.012)
    const trunkT = height / form.top
    const trunkX = form.leanX * trunkT
    const trunkZ = form.leanZ * trunkT
    const taper = Math.pow(1 - tierT * 0.82, 0.72)
    const tierReach = form.width * taper * range(random, 0.86, 1)
    const sprayCount = 3 + ((tier + variant) % 3)
    const tierPhase = phase + tier * 1.31 + range(random, -0.25, 0.25)

    for (let spray = 0; spray < sprayCount; spray += 1) {
      const angle = tierPhase + spray * Math.PI * 2 / sprayCount + range(random, -0.18, 0.18)
      const directionX = Math.cos(angle)
      const directionZ = Math.sin(angle)
      const reach = tierReach * range(random, 0.74, 1)
      const endpoint: Point3 = [
        trunkX + directionX * reach * 0.9,
        height - range(random, 0.002, 0.024),
        trunkZ + directionZ * reach * 0.9,
      ]
      addTaperedBranch(
        shape,
        [trunkX, height, trunkZ],
        endpoint,
        range(random, 0.006, 0.009),
        range(random, 0.0025, 0.004),
        2,
        119 + tier * 2,
      )

      const center: Point3 = [
        trunkX + directionX * reach * 0.68,
        height + range(random, -0.006, 0.018),
        trunkZ + directionZ * reach * 0.68,
      ]
      addEllipsoid(
        shape,
        center,
        [
          Math.max(0.045, reach * range(random, 0.28, 0.36)),
          range(random, 0.025, 0.047) * (1 - tierT * 0.18),
          range(random, 0.035, 0.061),
        ],
        -angle,
        range(random, 184, 211) + tierT * 10,
      )
    }

    // Split inner masses let branch tiers read through the crown rather than
    // forming a single triangular fill.
    const innerAngle = tierPhase + range(random, 0.4, 1.1)
    const innerOffset = tierReach * range(random, 0.08, 0.18)
    addEllipsoid(
      shape,
      [
        trunkX + Math.cos(innerAngle) * innerOffset,
        height + range(random, 0.004, 0.026),
        trunkZ + Math.sin(innerAngle) * innerOffset,
      ],
      [
        Math.max(0.035, tierReach * range(random, 0.22, 0.31)),
        range(random, 0.028, 0.052),
        Math.max(0.035, tierReach * range(random, 0.2, 0.29)),
      ],
      range(random, -Math.PI, Math.PI),
      range(random, 179, 204) + tierT * 12,
    )
  }

  // Narrow, offset leader clumps finish the taper without a geometric apex.
  for (let index = 0; index < 4; index += 1) {
    const height = form.top - 0.11 + index * 0.028
    const trunkT = height / form.top
    const angle = phase + index * GOLDEN_ANGLE
    const radius = 0.055 - index * 0.008
    addEllipsoid(
      shape,
      [
        form.leanX * trunkT + Math.cos(angle) * radius * 0.2,
        height,
        form.leanZ * trunkT + Math.sin(angle) * radius * 0.2,
      ],
      [radius, 0.042 - index * 0.004, radius * range(random, 0.78, 1.05)],
      angle,
      199 + index * 5,
    )
  }

  return shape
}

function pixelBounds(minimum: number, maximum: number, vertical: boolean): readonly [number, number] {
  const scaledMinimum = vertical
    ? minimum * RASTER_SIZE
    : (minimum / CARD_WIDTH + 0.5) * RASTER_SIZE
  const scaledMaximum = vertical
    ? maximum * RASTER_SIZE
    : (maximum / CARD_WIDTH + 0.5) * RASTER_SIZE
  return [
    Math.max(0, Math.floor(scaledMinimum)),
    Math.min(RASTER_SIZE - 1, Math.ceil(scaledMaximum) - 1),
  ]
}

function rasterizeEllipsoid(
  ellipsoid: Ellipsoid,
  viewSin: number,
  viewCos: number,
  workspace: RasterWorkspace,
): void {
  const centerX = ellipsoid.center[0]
  const centerY = ellipsoid.center[1]
  const centerZ = ellipsoid.center[2]
  const radiusX = ellipsoid.radii[0]
  const radiusY = ellipsoid.radii[1]
  const radiusZ = ellipsoid.radii[2]
  const yawSin = Math.sin(ellipsoid.yaw)
  const yawCos = Math.cos(ellipsoid.yaw)
  const tangentDotX = viewCos * yawCos + viewSin * yawSin
  const tangentDotZ = viewCos * yawSin - viewSin * yawCos
  const horizontalRadius = Math.hypot(radiusX * tangentDotX, radiusZ * tangentDotZ)
  const centerHorizontal = centerX * viewCos - centerZ * viewSin
  const [minimumX, maximumX] = pixelBounds(
    centerHorizontal - horizontalRadius,
    centerHorizontal + horizontalRadius,
    false,
  )
  const [minimumY, maximumY] = pixelBounds(centerY - radiusY, centerY + radiusY, true)
  if (minimumX > maximumX || minimumY > maximumY) return

  const inverseRadiusX2 = 1 / (radiusX * radiusX)
  const inverseRadiusY2 = 1 / (radiusY * radiusY)
  const inverseRadiusZ2 = 1 / (radiusZ * radiusZ)
  const rayLocalX = yawCos * viewSin - yawSin * viewCos
  const rayLocalZ = yawSin * viewSin + yawCos * viewCos
  const quadraticA = rayLocalX * rayLocalX * inverseRadiusX2
    + rayLocalZ * rayLocalZ * inverseRadiusZ2

  for (let pixelY = minimumY; pixelY <= maximumY; pixelY += 1) {
    const worldY = (pixelY + 0.5) / RASTER_SIZE
    const localY = worldY - centerY
    const yTerm = localY * localY * inverseRadiusY2
    for (let pixelX = minimumX; pixelX <= maximumX; pixelX += 1) {
      const horizontal = ((pixelX + 0.5) / RASTER_SIZE - 0.5) * CARD_WIDTH
      const originX = horizontal * viewCos - centerX
      const originZ = -horizontal * viewSin - centerZ
      const localX = yawCos * originX - yawSin * originZ
      const localZ = yawSin * originX + yawCos * originZ
      const quadraticB = 2 * (
        localX * rayLocalX * inverseRadiusX2
        + localZ * rayLocalZ * inverseRadiusZ2
      )
      const quadraticC = localX * localX * inverseRadiusX2
        + localZ * localZ * inverseRadiusZ2
        + yTerm - 1
      const discriminant = quadraticB * quadraticB - 4 * quadraticA * quadraticC
      if (discriminant < 0) continue
      const hitDepth = (-quadraticB + Math.sqrt(discriminant)) / (2 * quadraticA)
      const offset = pixelY * RASTER_SIZE + pixelX
      if (hitDepth <= workspace.depth[offset]!) continue

      const hitLocalX = localX + rayLocalX * hitDepth
      const hitLocalZ = localZ + rayLocalZ * hitDepth
      let normalLocalX = hitLocalX * inverseRadiusX2
      let normalY = localY * inverseRadiusY2
      let normalLocalZ = hitLocalZ * inverseRadiusZ2
      const inverseNormalLength = 1 / Math.hypot(normalLocalX, normalY, normalLocalZ)
      normalLocalX *= inverseNormalLength
      normalY *= inverseNormalLength
      normalLocalZ *= inverseNormalLength
      const normalX = yawCos * normalLocalX + yawSin * normalLocalZ
      const normalZ = -yawSin * normalLocalX + yawCos * normalLocalZ
      const frontness = Math.max(0, normalX * viewSin + normalZ * viewCos)
      const value = ellipsoid.luminance + Math.max(0, normalY) * 17 + frontness * 5

      workspace.depth[offset] = hitDepth
      workspace.luminance[offset] = Math.max(0, Math.min(255, Math.round(value)))
      const normalOffset = offset * 3
      workspace.normals[normalOffset] = Math.round(normalX * 127)
      workspace.normals[normalOffset + 1] = Math.round(normalY * 127)
      workspace.normals[normalOffset + 2] = Math.round(normalZ * 127)
    }
  }
}

function rasterizeBranch(
  branch: Branch,
  viewSin: number,
  viewCos: number,
  workspace: RasterWorkspace,
): void {
  const axisX = branch.end[0] - branch.start[0]
  const axisY = branch.end[1] - branch.start[1]
  const axisZ = branch.end[2] - branch.start[2]
  const length = Math.hypot(axisX, axisY, axisZ)
  const unitX = axisX / length
  const unitY = axisY / length
  const unitZ = axisZ / length
  const startHorizontal = branch.start[0] * viewCos - branch.start[2] * viewSin
  const endHorizontal = branch.end[0] * viewCos - branch.end[2] * viewSin
  const [minimumX, maximumX] = pixelBounds(
    Math.min(startHorizontal, endHorizontal) - branch.radius,
    Math.max(startHorizontal, endHorizontal) + branch.radius,
    false,
  )
  const [minimumY, maximumY] = pixelBounds(
    Math.min(branch.start[1], branch.end[1]) - branch.radius,
    Math.max(branch.start[1], branch.end[1]) + branch.radius,
    true,
  )
  if (minimumX > maximumX || minimumY > maximumY) return

  const rayAxis = viewSin * unitX + viewCos * unitZ
  const projectedRayX = viewSin - unitX * rayAxis
  const projectedRayY = -unitY * rayAxis
  const projectedRayZ = viewCos - unitZ * rayAxis
  const quadraticA = projectedRayX * projectedRayX
    + projectedRayY * projectedRayY
    + projectedRayZ * projectedRayZ
  const radiusSquared = branch.radius * branch.radius

  for (let pixelY = minimumY; pixelY <= maximumY; pixelY += 1) {
    const worldY = (pixelY + 0.5) / RASTER_SIZE
    for (let pixelX = minimumX; pixelX <= maximumX; pixelX += 1) {
      const horizontal = ((pixelX + 0.5) / RASTER_SIZE - 0.5) * CARD_WIDTH
      const originX = horizontal * viewCos
      const originZ = -horizontal * viewSin
      const relativeX = originX - branch.start[0]
      const relativeY = worldY - branch.start[1]
      const relativeZ = originZ - branch.start[2]
      const originAxis = relativeX * unitX + relativeY * unitY + relativeZ * unitZ
      const projectedOriginX = relativeX - unitX * originAxis
      const projectedOriginY = relativeY - unitY * originAxis
      const projectedOriginZ = relativeZ - unitZ * originAxis
      let hitDepth = EMPTY_DEPTH
      let normalX = 0
      let normalY = 1
      let normalZ = 0

      if (quadraticA > 1e-8) {
        const quadraticB = projectedRayX * projectedOriginX
          + projectedRayY * projectedOriginY
          + projectedRayZ * projectedOriginZ
        const quadraticC = projectedOriginX * projectedOriginX
          + projectedOriginY * projectedOriginY
          + projectedOriginZ * projectedOriginZ
          - radiusSquared
        const discriminant = quadraticB * quadraticB - quadraticA * quadraticC
        if (discriminant >= 0) {
          const root = Math.sqrt(discriminant)
          const farther = (-quadraticB + root) / quadraticA
          const nearer = (-quadraticB - root) / quadraticA
          const fartherAxis = originAxis + farther * rayAxis
          const nearerAxis = originAxis + nearer * rayAxis
          const sideDepth = fartherAxis >= 0 && fartherAxis <= length
            ? farther
            : nearerAxis >= 0 && nearerAxis <= length ? nearer : EMPTY_DEPTH
          if (sideDepth !== EMPTY_DEPTH) {
            hitDepth = sideDepth
            const normalDepthAxis = originAxis + sideDepth * rayAxis
            const hitX = relativeX + viewSin * sideDepth - unitX * normalDepthAxis
            const hitY = relativeY - unitY * normalDepthAxis
            const hitZ = relativeZ + viewCos * sideDepth - unitZ * normalDepthAxis
            const inverseNormalLength = 1 / Math.hypot(hitX, hitY, hitZ)
            normalX = hitX * inverseNormalLength
            normalY = hitY * inverseNormalLength
            normalZ = hitZ * inverseNormalLength
          }
        }
      }

      if (Math.abs(rayAxis) > 1e-8) {
        const startCapDepth = -originAxis / rayAxis
        if (startCapDepth > hitDepth) {
          const capX = relativeX + viewSin * startCapDepth
          const capY = relativeY
          const capZ = relativeZ + viewCos * startCapDepth
          const capAxis = capX * unitX + capY * unitY + capZ * unitZ
          const radialX = capX - unitX * capAxis
          const radialY = capY - unitY * capAxis
          const radialZ = capZ - unitZ * capAxis
          if (radialX * radialX + radialY * radialY + radialZ * radialZ <= radiusSquared) {
            hitDepth = startCapDepth
            normalX = -unitX
            normalY = -unitY
            normalZ = -unitZ
          }
        }

        const endCapDepth = (length - originAxis) / rayAxis
        if (endCapDepth > hitDepth) {
          const capX = relativeX + viewSin * endCapDepth
          const capY = relativeY
          const capZ = relativeZ + viewCos * endCapDepth
          const capAxis = capX * unitX + capY * unitY + capZ * unitZ
          const radialX = capX - unitX * capAxis
          const radialY = capY - unitY * capAxis
          const radialZ = capZ - unitZ * capAxis
          if (radialX * radialX + radialY * radialY + radialZ * radialZ <= radiusSquared) {
            hitDepth = endCapDepth
            normalX = unitX
            normalY = unitY
            normalZ = unitZ
          }
        }
      }

      const offset = pixelY * RASTER_SIZE + pixelX
      if (hitDepth <= workspace.depth[offset]!) continue
      const value = branch.luminance + Math.max(0, normalY) * 12
      workspace.depth[offset] = hitDepth
      workspace.luminance[offset] = Math.max(0, Math.min(255, Math.round(value)))
      const normalOffset = offset * 3
      workspace.normals[normalOffset] = Math.round(normalX * 127)
      workspace.normals[normalOffset + 1] = Math.round(normalY * 127)
      workspace.normals[normalOffset + 2] = Math.round(normalZ * 127)
    }
  }
}

function downsampleTile(view: number, workspace: RasterWorkspace): void {
  const defaultNormalX = Math.sin(view * Math.PI / 2)
  const defaultNormalZ = Math.cos(view * Math.PI / 2)
  workspace.colorTile.fill(0)
  workspace.normalTile.fill(0)
  workspace.bleedMask.fill(0)
  workspace.nextBleedMask.fill(0)

  for (let tileY = 0; tileY < DISTANT_TREE_TILE_SIZE; tileY += 1) {
    for (let tileX = 0; tileX < DISTANT_TREE_TILE_SIZE; tileX += 1) {
      let coverage = 0
      let luminance = 0
      let normalX = 0
      let normalY = 0
      let normalZ = 0
      for (let sampleY = 0; sampleY < RASTER_SCALE; sampleY += 1) {
        const rasterY = tileY * RASTER_SCALE + sampleY
        for (let sampleX = 0; sampleX < RASTER_SCALE; sampleX += 1) {
          const rasterX = tileX * RASTER_SCALE + sampleX
          const sampleOffset = rasterY * RASTER_SIZE + rasterX
          if (workspace.depth[sampleOffset] === EMPTY_DEPTH) continue
          coverage += 1
          luminance += workspace.luminance[sampleOffset]!
          const sampleNormalOffset = sampleOffset * 3
          normalX += workspace.normals[sampleNormalOffset]! / 127
          normalY += workspace.normals[sampleNormalOffset + 1]! / 127
          normalZ += workspace.normals[sampleNormalOffset + 2]! / 127
        }
      }

      const tilePixel = tileY * DISTANT_TREE_TILE_SIZE + tileX
      const tileOffset = tilePixel * 4
      if (coverage > 0) {
        const inverseNormalLength = 1 / Math.hypot(normalX, normalY, normalZ)
        normalX *= inverseNormalLength
        normalY *= inverseNormalLength
        normalZ *= inverseNormalLength
        const value = Math.round(luminance / coverage)
        const alpha = Math.round(255 * coverage / (RASTER_SCALE * RASTER_SCALE))
        workspace.colorTile[tileOffset] = value
        workspace.colorTile[tileOffset + 1] = value
        workspace.colorTile[tileOffset + 2] = value
        workspace.colorTile[tileOffset + 3] = alpha
        workspace.normalTile[tileOffset] = Math.round((normalX * 0.5 + 0.5) * 255)
        workspace.normalTile[tileOffset + 1] = Math.round((normalY * 0.5 + 0.5) * 255)
        workspace.normalTile[tileOffset + 2] = Math.round((normalZ * 0.5 + 0.5) * 255)
        workspace.normalTile[tileOffset + 3] = alpha
        workspace.bleedMask[tilePixel] = 1
      } else {
        workspace.colorTile[tileOffset] = 208
        workspace.colorTile[tileOffset + 1] = 208
        workspace.colorTile[tileOffset + 2] = 208
        workspace.normalTile[tileOffset] = Math.round((defaultNormalX * 0.5 + 0.5) * 255)
        workspace.normalTile[tileOffset + 1] = 128
        workspace.normalTile[tileOffset + 2] = Math.round((defaultNormalZ * 0.5 + 0.5) * 255)
      }
    }
  }
}

function bleedTransparentPixels(workspace: RasterWorkspace): void {
  for (let iteration = 0; iteration < BLEED_RADIUS; iteration += 1) {
    workspace.nextBleedMask.set(workspace.bleedMask)
    for (let y = 0; y < DISTANT_TREE_TILE_SIZE; y += 1) {
      for (let x = 0; x < DISTANT_TREE_TILE_SIZE; x += 1) {
        const pixel = y * DISTANT_TREE_TILE_SIZE + x
        if (workspace.bleedMask[pixel]) continue
        let source = -1
        for (let offsetY = -1; offsetY <= 1 && source < 0; offsetY += 1) {
          const neighborY = y + offsetY
          if (neighborY < 0 || neighborY >= DISTANT_TREE_TILE_SIZE) continue
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (offsetX === 0 && offsetY === 0) continue
            const neighborX = x + offsetX
            if (neighborX < 0 || neighborX >= DISTANT_TREE_TILE_SIZE) continue
            const neighbor = neighborY * DISTANT_TREE_TILE_SIZE + neighborX
            if (workspace.bleedMask[neighbor]) {
              source = neighbor
              break
            }
          }
        }
        if (source < 0) continue
        const targetOffset = pixel * 4
        const sourceOffset = source * 4
        workspace.colorTile[targetOffset] = workspace.colorTile[sourceOffset]!
        workspace.colorTile[targetOffset + 1] = workspace.colorTile[sourceOffset + 1]!
        workspace.colorTile[targetOffset + 2] = workspace.colorTile[sourceOffset + 2]!
        workspace.normalTile[targetOffset] = workspace.normalTile[sourceOffset]!
        workspace.normalTile[targetOffset + 1] = workspace.normalTile[sourceOffset + 1]!
        workspace.normalTile[targetOffset + 2] = workspace.normalTile[sourceOffset + 2]!
        workspace.nextBleedMask[pixel] = 1
      }
    }
    const current = workspace.bleedMask
    workspace.bleedMask = workspace.nextBleedMask
    workspace.nextBleedMask = current
  }
}

function copyTile(
  targetColor: Uint8Array,
  targetNormal: Uint8Array,
  variant: number,
  view: number,
  workspace: RasterWorkspace,
): void {
  const atlasX = variant * DISTANT_TREE_TILE_SIZE
  const atlasY = view * DISTANT_TREE_TILE_SIZE
  for (let tileY = 0; tileY < DISTANT_TREE_TILE_SIZE; tileY += 1) {
    const sourceStart = tileY * DISTANT_TREE_TILE_SIZE * 4
    const targetStart = ((atlasY + tileY) * ATLAS_SIZE + atlasX) * 4
    targetColor.set(
      workspace.colorTile.subarray(sourceStart, sourceStart + DISTANT_TREE_TILE_SIZE * 4),
      targetStart,
    )
    targetNormal.set(
      workspace.normalTile.subarray(sourceStart, sourceStart + DISTANT_TREE_TILE_SIZE * 4),
      targetStart,
    )
  }
}

function createAtlas(pine: boolean): DistantTreeAtlas {
  const colorData = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4)
  const normalData = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4)
  const rasterPixels = RASTER_SIZE * RASTER_SIZE
  const tilePixels = DISTANT_TREE_TILE_SIZE * DISTANT_TREE_TILE_SIZE
  const workspace: RasterWorkspace = {
    depth: new Float32Array(rasterPixels),
    luminance: new Uint8Array(rasterPixels),
    normals: new Int8Array(rasterPixels * 3),
    colorTile: new Uint8Array(tilePixels * 4),
    normalTile: new Uint8Array(tilePixels * 4),
    bleedMask: new Uint8Array(tilePixels),
    nextBleedMask: new Uint8Array(tilePixels),
  }

  for (let variant = 0; variant < DISTANT_TREE_VARIANTS; variant += 1) {
    const shape = pine ? pineShape(variant) : broadleafShape(variant)
    for (let view = 0; view < DISTANT_TREE_VIEWS; view += 1) {
      const angle = view * Math.PI / 2
      const viewSin = Math.sin(angle)
      const viewCos = Math.cos(angle)
      workspace.depth.fill(EMPTY_DEPTH)
      for (const branch of shape.branches) rasterizeBranch(branch, viewSin, viewCos, workspace)
      for (const ellipsoid of shape.foliage) rasterizeEllipsoid(ellipsoid, viewSin, viewCos, workspace)
      downsampleTile(view, workspace)
      bleedTransparentPixels(workspace)
      copyTile(colorData, normalData, variant, view, workspace)
    }
  }

  const color = new DataTexture(colorData, ATLAS_SIZE, ATLAS_SIZE, RGBAFormat, UnsignedByteType)
  color.name = `surroundings-distant-tree-${pine ? 'pine' : 'broadleaf'}-color-atlas`
  color.colorSpace = SRGBColorSpace
  color.flipY = false
  color.wrapS = color.wrapT = ClampToEdgeWrapping
  color.magFilter = LinearFilter
  color.minFilter = LinearMipmapLinearFilter
  color.generateMipmaps = true
  color.needsUpdate = true

  const normal = new DataTexture(normalData, ATLAS_SIZE, ATLAS_SIZE, RGBAFormat, UnsignedByteType)
  normal.name = `surroundings-distant-tree-${pine ? 'pine' : 'broadleaf'}-normal-atlas`
  normal.flipY = false
  normal.wrapS = normal.wrapT = ClampToEdgeWrapping
  normal.magFilter = LinearFilter
  normal.minFilter = LinearMipmapLinearFilter
  normal.generateMipmaps = true
  normal.needsUpdate = true

  return { color, normal }
}

export function getDistantTreeAtlas(pine: boolean): { color: DataTexture; normal: DataTexture } {
  const cacheIndex = pine ? 1 : 0
  const cached = cachedAtlases[cacheIndex]
  if (cached) return cached
  const atlas = createAtlas(pine)
  cachedAtlases[cacheIndex] = atlas
  return atlas
}
