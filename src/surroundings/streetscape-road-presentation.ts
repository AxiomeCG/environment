import type { FrontageSeparator } from './frontages'

// Temporary compatibility snapshot of the road cross-section grammar at this commit.
// Delete this module when Streetscape exposes an equivalent public pure builder.
export const STREETSCAPE_ROAD_SNAPSHOT_SOURCE =
  'sudhir9297/streetscape-pascal-plugin@1c04ec9ccb3fa8124ec56dfc1026567cbbc51aef'

export type StreetscapeRoadStyleId = 'local-street' | 'collector'
export type RoadFrontageSeparator = Exclude<FrontageSeparator, 'none'>
export type RoadPresentationPoint = readonly [x: number, y: number, z: number]
export type RoadSide = 'left' | 'right'
export type RoadSideComponentKind =
  | 'parking-lane'
  | 'bike-lane'
  | 'gutter'
  | 'curb'
  | 'verge'
  | 'sidewalk'

type RoadSideComponents = Readonly<{
  parkingLaneWidth: number
  bikeLaneWidth: number
  gutterWidth: number
  curbWidth: number
  vergeWidth: number
  sidewalkWidth: number
}>

type RoadSideComponentWidthKey = keyof RoadSideComponents

type StreetscapeRoadStyleSnapshot = Readonly<{
  id: StreetscapeRoadStyleId
  laneCount: number
  laneWidth: number
  shoulderWidth: number
  medianWidth: number
  surfaceThickness: number
  surfaceColor: string
  leftSide: RoadSideComponents
  rightSide: RoadSideComponents
}>

export type RoadSurfaceGeometryData = Readonly<{
  indices: readonly number[]
  positions: readonly number[]
}>

type RoadSideStrip = Readonly<{
  color: string
  elevationOffset: number
  kind: RoadSideComponentKind
  lateralOffset: number
  side: RoadSide
  width: number
}>

type RoadCrossSectionSide = Readonly<{
  components: readonly RoadSideStrip[]
  outerOffset: number
}>

export type RoadPresentationSurface = Readonly<{
  id: string
  kind: 'carriageway' | RoadSideComponentKind
  side?: RoadSide
  color: string
  roughness: number
  metalness: number
  doubleSided: boolean
  castShadow: boolean
  receiveShadow: boolean
  width: number
  geometry: RoadSurfaceGeometryData
}>

export type RoadPresentationPlan = Readonly<{
  id: string
  styleId: StreetscapeRoadStyleId
  totalWidth: number
  surfaces: readonly RoadPresentationSurface[]
}>

const ROAD_SIDE_COMPONENT_SPECS: ReadonlyArray<Readonly<{
  color: string
  elevationOffset: number
  kind: RoadSideComponentKind
  widthKey: RoadSideComponentWidthKey
}>> = [
  {
    kind: 'parking-lane',
    widthKey: 'parkingLaneWidth',
    color: '#44484c',
    elevationOffset: 0.004,
  },
  {
    kind: 'bike-lane',
    widthKey: 'bikeLaneWidth',
    color: '#517665',
    elevationOffset: 0.008,
  },
  {
    kind: 'gutter',
    widthKey: 'gutterWidth',
    color: '#85888a',
    elevationOffset: 0.018,
  },
  {
    kind: 'curb',
    widthKey: 'curbWidth',
    color: '#d8d5cd',
    elevationOffset: 0.105,
  },
  {
    kind: 'verge',
    widthKey: 'vergeWidth',
    color: '#748166',
    elevationOffset: 0.06,
  },
  {
    kind: 'sidewalk',
    widthKey: 'sidewalkWidth',
    color: '#b9b7b0',
    elevationOffset: 0.055,
  },
]

const ROAD_STYLES: Readonly<Record<StreetscapeRoadStyleId, StreetscapeRoadStyleSnapshot>> = {
  'local-street': {
    id: 'local-street',
    laneCount: 2,
    laneWidth: 3.25,
    shoulderWidth: 0.5,
    medianWidth: 0,
    surfaceThickness: 0.14,
    surfaceColor: '#3f4246',
    leftSide: {
      parkingLaneWidth: 0,
      bikeLaneWidth: 0,
      gutterWidth: 0.35,
      curbWidth: 0.15,
      vergeWidth: 0.45,
      sidewalkWidth: 0.5,
    },
    rightSide: {
      parkingLaneWidth: 0,
      bikeLaneWidth: 0,
      gutterWidth: 0.35,
      curbWidth: 0.15,
      vergeWidth: 0.45,
      sidewalkWidth: 0.5,
    },
  },
  collector: {
    id: 'collector',
    laneCount: 2,
    laneWidth: 3.5,
    shoulderWidth: 1,
    medianWidth: 0,
    surfaceThickness: 0.18,
    surfaceColor: '#393c40',
    leftSide: {
      parkingLaneWidth: 0,
      bikeLaneWidth: 1.6,
      gutterWidth: 0.4,
      curbWidth: 0.15,
      vergeWidth: 0.6,
      sidewalkWidth: 0.6,
    },
    rightSide: {
      parkingLaneWidth: 0,
      bikeLaneWidth: 1.6,
      gutterWidth: 0.4,
      curbWidth: 0.15,
      vergeWidth: 0.6,
      sidewalkWidth: 0.6,
    },
  },
}

const STYLE_BY_SEPARATOR: Readonly<Record<RoadFrontageSeparator, StreetscapeRoadStyleId>> = {
  'secondary-road': 'local-street',
  'primary-road': 'collector',
}

function buildRoadCrossSection(style: StreetscapeRoadStyleSnapshot) {
  const carriagewayWidth =
    style.laneCount * style.laneWidth + style.shoulderWidth * 2 + style.medianWidth
  const carriagewayHalfWidth = carriagewayWidth / 2
  const buildSide = (side: RoadSide): RoadCrossSectionSide => {
    const config = side === 'left' ? style.leftSide : style.rightSide
    const sign = side === 'left' ? 1 : -1
    let cursor = carriagewayHalfWidth
    const components: RoadSideStrip[] = []

    for (const spec of ROAD_SIDE_COMPONENT_SPECS) {
      const width = config[spec.widthKey]
      if (width <= 0) continue
      components.push({
        color: spec.color,
        elevationOffset: spec.elevationOffset,
        kind: spec.kind,
        lateralOffset: sign * (cursor + width / 2),
        side,
        width,
      })
      cursor += width
    }

    return { components, outerOffset: cursor }
  }
  const sides: Record<RoadSide, RoadCrossSectionSide> = {
    left: buildSide('left'),
    right: buildSide('right'),
  }

  return {
    carriagewayWidth,
    sides,
    totalWidth: sides.left.outerOffset + sides.right.outerOffset,
  }
}

function buildRoadRibbonGeometry(
  points: readonly RoadPresentationPoint[],
  options: Readonly<{
    elevationOffset?: number
    lateralOffset?: number
    surfaceThickness: number
    width: number
  }>,
): RoadSurfaceGeometryData {
  if (points.length < 2) return { indices: [], positions: [] }

  const halfWidth = options.width / 2
  const lateralOffset = options.lateralOffset ?? 0
  const elevationOffset = options.elevationOffset ?? 0
  const positions: number[] = []

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!
    const previous = points[Math.max(0, index - 1)]!
    const next = points[Math.min(points.length - 1, index + 1)]!
    const deltaX = next[0] - previous[0]
    const deltaZ = next[2] - previous[2]
    const length = Math.max(Math.hypot(deltaX, deltaZ), 1e-6)
    const normalX = -deltaZ / length
    const normalZ = deltaX / length
    const centerX = point[0] + normalX * lateralOffset
    const centerZ = point[2] + normalZ * lateralOffset
    const y = point[1] + options.surfaceThickness + elevationOffset

    positions.push(
      centerX + normalX * halfWidth,
      y,
      centerZ + normalZ * halfWidth,
      centerX - normalX * halfWidth,
      y,
      centerZ - normalZ * halfWidth,
    )
  }

  const indices: number[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const left = index * 2
    const right = left + 1
    const nextLeft = left + 2
    const nextRight = left + 3
    indices.push(left, nextLeft, right, nextLeft, nextRight, right)
  }

  return { indices, positions }
}

function styleForSeparator(
  separator: RoadFrontageSeparator,
): StreetscapeRoadStyleSnapshot {
  return ROAD_STYLES[STYLE_BY_SEPARATOR[separator]]
}

export const STREETSCAPE_COMPATIBLE_ROAD_WIDTHS = Object.freeze({
  'secondary-road': buildRoadCrossSection(ROAD_STYLES['local-street']).totalWidth,
  'primary-road': buildRoadCrossSection(ROAD_STYLES.collector).totalWidth,
} satisfies Record<RoadFrontageSeparator, number>)

export function buildRoadPresentationPlan(
  id: string,
  separator: RoadFrontageSeparator,
  points: readonly RoadPresentationPoint[],
): RoadPresentationPlan {
  const style = styleForSeparator(separator)
  const crossSection = buildRoadCrossSection(style)
  const material = {
    roughness: 0.94,
    metalness: 0.02,
    doubleSided: true,
    castShadow: false,
    receiveShadow: true,
  } as const
  const carriagewayGeometry = buildRoadRibbonGeometry(points, {
    surfaceThickness: style.surfaceThickness,
    width: crossSection.carriagewayWidth,
  })
  const surfaces: RoadPresentationSurface[] = carriagewayGeometry.positions.length > 0
    ? [{
        id: `${id}:carriageway`,
        kind: 'carriageway',
        color: style.surfaceColor,
        width: crossSection.carriagewayWidth,
        geometry: carriagewayGeometry,
        ...material,
      }]
    : []

  for (const side of ['left', 'right'] as const) {
    for (const component of crossSection.sides[side].components) {
      const geometry = buildRoadRibbonGeometry(points, {
        elevationOffset: component.elevationOffset,
        lateralOffset: component.lateralOffset,
        surfaceThickness: style.surfaceThickness,
        width: component.width,
      })
      if (geometry.positions.length === 0) continue
      surfaces.push({
        id: `${id}:${side}:${component.kind}`,
        kind: component.kind,
        side,
        color: component.color,
        width: component.width,
        geometry,
        ...material,
      })
    }
  }

  return {
    id,
    styleId: style.id,
    totalWidth: crossSection.totalWidth,
    surfaces,
  }
}
