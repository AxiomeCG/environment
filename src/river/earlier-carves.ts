import { readFileSync } from 'node:fs'
import {
  createTerrainField,
  encodeTerrainField,
  SiteNode,
  type SiteNode as SiteNodeType,
  type TerrainField,
} from '@pascal-app/core'

/**
 * Rivers carved or saved by earlier versions of this plugin, frozen in
 * `fixtures/earlier-carves.json` so the acceptance tests need no git history.
 * `historical-differential.test.ts` rebuilds that file from these cases with
 * the real earlier code, extracted from git, when explicitly asked to.
 */

/** The carver before river v3: what a migrated as-drawn river must reproduce. */
export const PRE_V3_COMMIT = '1aa0bc3'
/** The first carver to stamp a fingerprint, and the last before planner refusals. */
export const FIRST_FINGERPRINT_COMMIT = '1436490'

export const EARLIER_CARVES_FIXTURE = new URL('./fixtures/earlier-carves.json', import.meta.url)

export type EarlierCarveInput = Readonly<{
  site: SiteNodeType
  /** River nodes as the earlier version parsed and saved them. */
  rivers: readonly Record<string, unknown>[]
}>

export type EarlierCarveFixtures = Readonly<{
  provenance: string
  /** Inputs and the pre-v3 carver's terrain for each case. */
  preV3Carves: Readonly<Record<string, EarlierCarveInput & { carvedTerrain: SiteNodeType['terrain'] }>>
  /** Sites exactly as the first-fingerprint carver saved them: carved terrain and stamp. */
  savedSites: Readonly<Record<string, EarlierCarveInput>>
}>

export function readEarlierCarveFixtures(): EarlierCarveFixtures {
  return JSON.parse(readFileSync(EARLIER_CARVES_FIXTURE, 'utf8')) as EarlierCarveFixtures
}

/** The review fixture: a 20 m lot at 0.5 m spacing and 1 cm height steps. */
export function terrainFrom(heightAt: (x: number, z: number) => number): TerrainField {
  const terrain = createTerrainField({
    origin: [-10, -10],
    spacing: 0.5,
    cols: 41,
    rows: 41,
    step: 0.01,
  })
  for (let row = 0; row < terrain.rows; row += 1) {
    for (let col = 0; col < terrain.cols; col += 1) {
      const x = terrain.origin[0] + col * terrain.spacing
      const z = terrain.origin[1] + row * terrain.spacing
      terrain.heights[row * terrain.cols + col] = Math.round(heightAt(x, z) / terrain.step)
    }
  }
  return terrain
}

function siteOn(id: string, terrain: TerrainField): SiteNodeType {
  return SiteNode.parse({
    id,
    polygon: {
      type: 'polygon',
      points: [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ],
    },
    terrain: encodeTerrainField(terrain),
    children: [],
  })
}

function river(id: string, siteId: string, fields: Record<string, unknown>) {
  return {
    id,
    type: 'environment:river',
    parentId: siteId,
    points: [
      [-8, 0],
      [8, 0],
    ],
    width: 4,
    depth: 1,
    source: 'rounded',
    outlet: 'rounded',
    ...fields,
  }
}

/** Raw river fields as a pre-v3 scene stored them; the pre-v3 schema parses them. */
export function preV3Cases(): Readonly<Record<string, Readonly<{ site: SiteNodeType; rivers: object[] }>>> {
  const site = (terrain: TerrainField) => siteOn('site_pre_v3', terrain)
  const uneven = (x: number, z: number) => 0.6 * Math.sin(x * 0.7) + 0.4 * Math.cos(z * 0.5)
  return {
    flatStraight: { site: site(terrainFrom(() => 0)), rivers: [river('river_flat', 'site_pre_v3', {})] },
    slopingStraight: {
      site: site(terrainFrom((x) => -0.3 * x)),
      rivers: [river('river_slope', 'site_pre_v3', {})],
    },
    bentUneven: {
      site: site(terrainFrom(uneven)),
      rivers: [
        river('river_bent', 'site_pre_v3', {
          points: [
            [-8, -6],
            [-3, 2],
            [3, -2],
            [8, 5],
          ],
          width: 3,
          depth: 1.5,
        }),
      ],
    },
    connected: {
      site: site(terrainFrom((x) => -0.3 * x)),
      rivers: [river('river_connected', 'site_pre_v3', { source: 'mountain', outlet: 'sea' })],
    },
    overlapping: {
      site: site(terrainFrom(() => 1)),
      rivers: [
        river('river_across', 'site_pre_v3', { width: 3, depth: 0.6 }),
        river('river_along', 'site_pre_v3', {
          points: [
            [0, -7],
            [0.5, 0],
            [0, 7],
          ],
          width: 6,
          depth: 2,
        }),
      ],
    },
  }
}

/** The Site of the saved-scene cases; the system tests mount it under this id. */
export const SAVED_SITE_ID = 'site_river_system'

/**
 * Round 3 and 4 review inputs, on ground falling 10 % toward +x: a downhill
 * river crossing itself (refused today, carved and stamped by 1436490), and
 * a straight as-drawn river whose carve has not changed since.
 */
export function savedSiteCases(): Readonly<
  Record<string, Readonly<{ site: SiteNodeType; rivers: object[] }>>
> {
  const site = siteOn(SAVED_SITE_ID, terrainFrom((x) => 2 - 0.1 * x))
  return {
    downhillCrossing: {
      site,
      rivers: [
        river('river_saved_crossing', SAVED_SITE_ID, {
          flow: 'downhill',
          points: [
            [-8, -8],
            [8, 8],
            [-8, 8],
            [8, -8],
          ],
        }),
      ],
    },
    asDrawnStraight: {
      site,
      rivers: [river('river_saved_straight', SAVED_SITE_ID, { flow: 'as_drawn' })],
    },
  }
}
