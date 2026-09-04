import type { RoadSideComponents, RoadStylePreset } from './schema'

export type RoadSide = 'left' | 'right'
export type RoadSideComponentKind =
  | 'parking-lane'
  | 'bike-lane'
  | 'gutter'
  | 'curb'
  | 'verge'
  | 'sidewalk'

export type RoadSideComponentWidthKey = keyof RoadSideComponents

export type RoadSideComponentStrip = {
  color: string
  elevationOffset: number
  innerOffset: number
  kind: RoadSideComponentKind
  lateralOffset: number
  outerOffset: number
  side: RoadSide
  width: number
  widthKey: RoadSideComponentWidthKey
}

export type RoadCrossSection = {
  carriagewayWidth: number
  sides: Record<RoadSide, {
    components: RoadSideComponentStrip[]
    outerOffset: number
    width: number
  }>
  totalWidth: number
}

export type RoadSideComponentConfigs = Record<RoadSide, RoadSideComponents>

export type RoadJunctionBand = {
  color: string
  elevationOffset: number
  kind: RoadSideComponentKind
  outerWidth: number
  width: number
}

export const ROAD_SIDE_COMPONENT_SPECS: ReadonlyArray<{
  color: string
  elevationOffset: number
  kind: RoadSideComponentKind
  widthKey: RoadSideComponentWidthKey
}> = [
  { kind: 'parking-lane', widthKey: 'parkingLaneWidth', color: '#44484c', elevationOffset: 0.004 },
  { kind: 'bike-lane', widthKey: 'bikeLaneWidth', color: '#517665', elevationOffset: 0.008 },
  { kind: 'gutter', widthKey: 'gutterWidth', color: '#85888a', elevationOffset: 0.018 },
  { kind: 'curb', widthKey: 'curbWidth', color: '#d8d5cd', elevationOffset: 0.105 },
  { kind: 'verge', widthKey: 'vergeWidth', color: '#748166', elevationOffset: 0.06 },
  { kind: 'sidewalk', widthKey: 'sidewalkWidth', color: '#b9b7b0', elevationOffset: 0.055 },
]

export const ROAD_SIDE_COMPONENT_WIDTH_FIELDS = ROAD_SIDE_COMPONENT_SPECS.map((spec) => ({
  kind: spec.kind,
  widthKey: spec.widthKey,
}))

export function resolveRoadSideComponents(
  style: RoadStylePreset,
  side: RoadSide,
): RoadSideComponents {
  const authored = side === 'left' ? style.leftSide : style.rightSide
  return authored ?? {
    parkingLaneWidth: 0,
    bikeLaneWidth: 0,
    gutterWidth: 0,
    curbWidth: 0,
    vergeWidth: 0,
    sidewalkWidth: style.sidewalkWidth,
  }
}

/** Apply one independently authored configuration to each side of a style. */
export function withRoadSideComponents(
  style: RoadStylePreset,
  sides: RoadSideComponentConfigs,
): RoadStylePreset {
  return {
    ...style,
    leftSide: { ...sides.left },
    rightSide: { ...sides.right },
  }
}

/** Resolve the complete ordered cross-section from one persisted road style. */
export function buildRoadCrossSection(style: RoadStylePreset): RoadCrossSection {
  const carriagewayWidth =
    style.laneCount * style.laneWidth + style.shoulderWidth * 2 + style.medianWidth
  const carriagewayHalfWidth = carriagewayWidth / 2
  const sides = Object.fromEntries((['left', 'right'] as const).map((side) => {
    const config = resolveRoadSideComponents(style, side)
    const sign = side === 'left' ? 1 : -1
    let cursor = carriagewayHalfWidth
    const components: RoadSideComponentStrip[] = []
    for (const spec of ROAD_SIDE_COMPONENT_SPECS) {
      const width = config[spec.widthKey]
      if (width <= 0) continue
      const innerOffset = cursor
      const outerOffset = cursor + width
      components.push({
        ...spec,
        innerOffset,
        lateralOffset: sign * (innerOffset + width / 2),
        outerOffset,
        side,
        width,
      })
      cursor = outerOffset
    }
    return [side, {
      components,
      outerOffset: cursor,
      width: cursor - carriagewayHalfWidth,
    }]
  })) as RoadCrossSection['sides']
  return {
    carriagewayWidth,
    sides,
    totalWidth: sides.left.outerOffset + sides.right.outerOffset,
  }
}

/** Build nested material bands that keep side components continuous around a junction. */
export function buildRoadJunctionBands(styles: RoadStylePreset[]): RoadJunctionBand[] {
  const maximumWidths = Object.fromEntries(
    ROAD_SIDE_COMPONENT_SPECS.map((spec) => [spec.widthKey, 0]),
  ) as Record<RoadSideComponentWidthKey, number>
  for (const style of styles) {
    for (const side of ['left', 'right'] as const) {
      const config = resolveRoadSideComponents(style, side)
      for (const spec of ROAD_SIDE_COMPONENT_SPECS) {
        maximumWidths[spec.widthKey] = Math.max(maximumWidths[spec.widthKey], config[spec.widthKey])
      }
    }
  }
  let outerWidth = 0
  return ROAD_SIDE_COMPONENT_SPECS.flatMap((spec) => {
    const width = maximumWidths[spec.widthKey]
    if (width <= 0) return []
    outerWidth += width
    return [{
      color: spec.color,
      elevationOffset: spec.elevationOffset,
      kind: spec.kind,
      outerWidth,
      width,
    }]
  })
}
