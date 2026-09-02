import { describe, expect, test } from 'bun:test'
import {
  buildRoadPresentationPlan,
  STREETSCAPE_COMPATIBLE_ROAD_WIDTHS,
  STREETSCAPE_ROAD_SNAPSHOT_SOURCE,
} from './streetscape-road-presentation'

const POINTS = [
  [0, 0, 0],
  [20, 0, 0],
] as const

describe('temporary Streetscape road-presentation snapshot', () => {
  test('records the exact inspected Streetscape source commit', () => {
    expect(STREETSCAPE_ROAD_SNAPSHOT_SOURCE).toBe(
      'sudhir9297/streetscape-pascal-plugin@1c04ec9ccb3fa8124ec56dfc1026567cbbc51aef',
    )
  })

  test('keeps the local-street width and ordered bands observed in Streetscape', () => {
    const plan = buildRoadPresentationPlan(
      'frontage-2',
      'secondary-road',
      POINTS,
    )

    expect(plan.styleId).toBe('local-street')
    expect(plan.totalWidth).toBeCloseTo(10.4)
    expect(STREETSCAPE_COMPATIBLE_ROAD_WIDTHS['secondary-road']).toBeCloseTo(10.4)
    expect(plan.surfaces.map(({ id, width }) => [id, width])).toEqual([
      ['frontage-2:carriageway', 7.5],
      ['frontage-2:left:gutter', 0.35],
      ['frontage-2:left:curb', 0.15],
      ['frontage-2:left:verge', 0.45],
      ['frontage-2:left:sidewalk', 0.5],
      ['frontage-2:right:gutter', 0.35],
      ['frontage-2:right:curb', 0.15],
      ['frontage-2:right:verge', 0.45],
      ['frontage-2:right:sidewalk', 0.5],
    ])
    expect(plan.surfaces.every((surface) => surface.roughness === 0.94)).toBe(true)
    expect(plan.surfaces.every((surface) => surface.metalness === 0.02)).toBe(true)
    expect(plan.surfaces.every((surface) => surface.geometry.indices.length === 6)).toBe(true)
  })

  test('keeps the collector width observed in Streetscape', () => {
    const plan = buildRoadPresentationPlan(
      'frontage-1',
      'primary-road',
      POINTS,
    )

    expect(plan.styleId).toBe('collector')
    expect(plan.totalWidth).toBeCloseTo(15.7)
    expect(STREETSCAPE_COMPATIBLE_ROAD_WIDTHS['primary-road']).toBeCloseTo(15.7)
    expect(plan.surfaces.map(({ kind }) => kind)).toEqual([
      'carriageway',
      'bike-lane',
      'gutter',
      'curb',
      'verge',
      'sidewalk',
      'bike-lane',
      'gutter',
      'curb',
      'verge',
      'sidewalk',
    ])
  })

  test('returns no surfaces for an unusable one-point alignment', () => {
    const plan = buildRoadPresentationPlan(
      'frontage-2',
      'secondary-road',
      [[0, 0, 0]],
    )

    expect(plan.surfaces).toEqual([])
  })
})
