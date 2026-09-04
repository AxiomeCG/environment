export const DEFAULT_ROAD_STYLE_ID = 'local-street'

const NO_SIDE_COMPONENTS = {
  parkingLaneWidth: 0,
  bikeLaneWidth: 0,
  gutterWidth: 0,
  curbWidth: 0,
  vergeWidth: 0,
  sidewalkWidth: 0,
} as const

const LOCAL_SIDE_COMPONENTS = {
  parkingLaneWidth: 0,
  bikeLaneWidth: 0,
  gutterWidth: 0.35,
  curbWidth: 0.15,
  vergeWidth: 0.45,
  sidewalkWidth: 0.5,
} as const

const COLLECTOR_SIDE_COMPONENTS = {
  parkingLaneWidth: 0,
  bikeLaneWidth: 1.6,
  gutterWidth: 0.4,
  curbWidth: 0.15,
  vergeWidth: 0.6,
  sidewalkWidth: 0.6,
} as const

const ARTERIAL_SIDE_COMPONENTS = {
  parkingLaneWidth: 0,
  bikeLaneWidth: 1.8,
  gutterWidth: 0.45,
  curbWidth: 0.18,
  vergeWidth: 0.8,
  sidewalkWidth: 0.67,
} as const

const HIGHWAY_SIDE_COMPONENTS = {
  parkingLaneWidth: 0,
  bikeLaneWidth: 0,
  gutterWidth: 0,
  curbWidth: 0,
  vergeWidth: 1.2,
  sidewalkWidth: 0,
} as const

/** Real-world-ish starting sections; all dimensions are metres. */
export const DEFAULT_ROAD_STYLE_PRESETS = {
  alley: {
    id: 'alley', name: 'Alley', laneCount: 1, laneWidth: 3.2, shoulderWidth: 0,
    sidewalkWidth: 0, medianWidth: 0, surfaceThickness: 0.1,
    surfaceColor: '#484a4d', markingColor: '#f3f1df', markings: false,
    leftSide: { ...NO_SIDE_COMPONENTS }, rightSide: { ...NO_SIDE_COMPONENTS },
  },
  'local-street': {
    id: 'local-street', name: 'Local street', laneCount: 2, laneWidth: 3.25,
    shoulderWidth: 0.5, sidewalkWidth: 0.5, medianWidth: 0, surfaceThickness: 0.14,
    surfaceColor: '#3f4246', markingColor: '#f3f1df', markings: true,
    leftSide: { ...LOCAL_SIDE_COMPONENTS }, rightSide: { ...LOCAL_SIDE_COMPONENTS },
  },
  collector: {
    id: 'collector', name: 'Collector', laneCount: 2, laneWidth: 3.5,
    shoulderWidth: 1, sidewalkWidth: 0.6, medianWidth: 0, surfaceThickness: 0.18,
    surfaceColor: '#393c40', markingColor: '#f3f1df', markings: true,
    leftSide: { ...COLLECTOR_SIDE_COMPONENTS }, rightSide: { ...COLLECTOR_SIDE_COMPONENTS },
  },
  arterial: {
    id: 'arterial', name: 'Divided arterial', laneCount: 4, laneWidth: 3.5,
    shoulderWidth: 0.75, sidewalkWidth: 0.67, medianWidth: 2.4, surfaceThickness: 0.22,
    surfaceColor: '#35383c', markingColor: '#f3f1df', markings: true,
    leftSide: { ...ARTERIAL_SIDE_COMPONENTS }, rightSide: { ...ARTERIAL_SIDE_COMPONENTS },
  },
  highway: {
    id: 'highway', name: 'Highway', laneCount: 4, laneWidth: 3.65,
    shoulderWidth: 2.5, sidewalkWidth: 0, medianWidth: 3, surfaceThickness: 0.28,
    surfaceColor: '#303338', markingColor: '#f3f1df', markings: true,
    leftSide: { ...HIGHWAY_SIDE_COMPONENTS }, rightSide: { ...HIGHWAY_SIDE_COMPONENTS },
  },
} as const

export const ROAD_STYLE_PRESET_IDS = Object.keys(DEFAULT_ROAD_STYLE_PRESETS) as Array<
  keyof typeof DEFAULT_ROAD_STYLE_PRESETS
>

export type RoadStylePresetId = keyof typeof DEFAULT_ROAD_STYLE_PRESETS
