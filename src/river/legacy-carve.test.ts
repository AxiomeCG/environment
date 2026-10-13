import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  createTerrainField,
  encodeTerrainField,
  SiteNode,
  type SiteNode as SiteNodeType,
  type TerrainField,
} from '@pascal-app/core'
import { RiverNode } from './schema'
import { rebuildRiverTerrain } from './terrain'

/**
 * The commit before river v3. Its own carver, extracted from git, is the
 * oracle: a river saved before v3 must carve exactly as it did there.
 */
const PRE_V3_COMMIT = '1aa0bc3'
const REPOSITORY_ROOT = resolve(import.meta.dir, '../..')

type PreV3Carver = Readonly<{
  parseRiver: (raw: unknown) => unknown
  carve: (site: SiteNodeType, rivers: readonly unknown[]) => { terrain: TerrainField }
}>

let checkout = ''
let preV3: PreV3Carver | null = null

beforeAll(async () => {
  checkout = mkdtempSync(join(tmpdir(), 'river-pre-v3-'))
  const archive = join(checkout, 'src.tar')
  execFileSync('git', ['-C', REPOSITORY_ROOT, 'archive', `--output=${archive}`, PRE_V3_COMMIT, 'src'])
  execFileSync('tar', ['-x', '-f', archive, '-C', checkout])
  symlinkSync(join(REPOSITORY_ROOT, 'node_modules'), join(checkout, 'node_modules'))
  const terrainModule = await import(join(checkout, 'src/river/terrain.ts'))
  const schemaModule = await import(join(checkout, 'src/river/schema.ts'))
  preV3 = {
    parseRiver: (raw) => schemaModule.RiverNode.parse(raw),
    carve: (site, rivers) => terrainModule.rebuildRiverTerrain(site, rivers),
  }
})

afterAll(() => {
  if (checkout) rmSync(checkout, { recursive: true, force: true })
})

/** The fixture of the review: a 20 m lot at 0.5 m spacing and 1 cm height steps. */
function terrainFrom(heightAt: (x: number, z: number) => number): TerrainField {
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

function siteOn(terrain: TerrainField): SiteNodeType {
  return SiteNode.parse({
    id: 'site_pre_v3',
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

/** A river exactly as a pre-v3 scene stored it: none of the v3 fields. */
function savedRiver(id: string, fields: Record<string, unknown>) {
  return {
    id,
    type: 'environment:river',
    parentId: 'site_pre_v3',
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

function cellsCarvedDifferently(
  terrain: TerrainField,
  saved: readonly Record<string, unknown>[],
): string[] {
  if (!preV3) throw new Error('The pre-v3 carver did not load.')
  const site = siteOn(terrain)
  const expected = preV3.carve(site, saved.map(preV3.parseRiver)).terrain.heights
  const actual = rebuildRiverTerrain(
    site,
    saved.map((raw) => RiverNode.parse(raw)),
  ).terrain.heights
  const differences: string[] = []
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index] === actual[index]) continue
    const col = index % terrain.cols
    const row = Math.floor(index / terrain.cols)
    differences.push(`(${col}, ${row}): pre-v3 ${expected[index]}, now ${actual[index]}`)
  }
  return differences
}

describe('rivers saved before v3 carve exactly as the pre-v3 carver did', () => {
  test('straight river with rounded caps on flat ground', () => {
    expect(cellsCarvedDifferently(terrainFrom(() => 0), [savedRiver('river_flat', {})])).toEqual(
      [],
    )
  })

  test('straight river on ground falling 0.3 m per metre', () => {
    expect(
      cellsCarvedDifferently(terrainFrom((x) => -0.3 * x), [savedRiver('river_slope', {})]),
    ).toEqual([])
  })

  test('bending river on uneven ground', () => {
    const uneven = (x: number, z: number) => 0.6 * Math.sin(x * 0.7) + 0.4 * Math.cos(z * 0.5)
    const bent = savedRiver('river_bent', {
      points: [
        [-8, -6],
        [-3, 2],
        [3, -2],
        [8, 5],
      ],
      width: 3,
      depth: 1.5,
    })
    expect(cellsCarvedDifferently(terrainFrom(uneven), [bent])).toEqual([])
  })

  test('mountain source and sea outlet run to the boundary', () => {
    const connected = savedRiver('river_connected', { source: 'mountain', outlet: 'sea' })
    expect(cellsCarvedDifferently(terrainFrom((x) => -0.3 * x), [connected])).toEqual([])
  })

  test('overlapping rivers keep the deepest cut', () => {
    const across = savedRiver('river_across', { width: 3, depth: 0.6 })
    const along = savedRiver('river_along', {
      points: [
        [0, -7],
        [0.5, 0],
        [0, 7],
      ],
      width: 6,
      depth: 2,
    })
    expect(cellsCarvedDifferently(terrainFrom(() => 1), [across, along])).toEqual([])
  })
})
