import { describe, expect, test } from 'bun:test'
import { decodeTerrainField, SiteNode } from '@pascal-app/core'
import { PRE_V3_COMMIT, readEarlierCarveFixtures } from './earlier-carves'
import { RiverNode } from './schema'
import { rebuildRiverTerrain } from './terrain'

/**
 * Rivers saved before v3 must carve exactly as the pre-v3 carver did. The
 * oracle is that carver's own output, frozen in fixtures/earlier-carves.json
 * (see earlier-carves.ts for its provenance and how to rebuild it from git).
 */
const { preV3Carves } = readEarlierCarveFixtures()

const CASES: Readonly<Record<string, string>> = {
  flatStraight: 'straight river with rounded caps on flat ground',
  slopingStraight: 'straight river on ground falling 0.3 m per metre',
  bentUneven: 'bending river on uneven ground',
  connected: 'mountain source and sea outlet run to the boundary',
  overlapping: 'overlapping rivers keep the deepest cut',
}

function cellsCarvedDifferently(name: string): string[] {
  const fixture = preV3Carves[name]
  const expected = decodeTerrainField(fixture?.carvedTerrain)
  if (!fixture || !expected) throw new Error(`Missing pre-v3 fixture ${name}.`)
  const site = SiteNode.parse(fixture.site)
  const actual = rebuildRiverTerrain(
    site,
    fixture.rivers.map((saved) => RiverNode.parse(saved)),
  ).terrain.heights
  const differences: string[] = []
  for (let index = 0; index < expected.heights.length; index += 1) {
    if (expected.heights[index] === actual[index]) continue
    const col = index % expected.cols
    const row = Math.floor(index / expected.cols)
    differences.push(`(${col}, ${row}): pre-v3 ${expected.heights[index]}, now ${actual[index]}`)
  }
  return differences
}

describe(`rivers saved before v3 carve exactly as the ${PRE_V3_COMMIT} carver did`, () => {
  test('every frozen case is covered', () => {
    expect(Object.keys(preV3Carves).sort()).toEqual(Object.keys(CASES).sort())
  })

  for (const [name, behaviour] of Object.entries(CASES)) {
    test(behaviour, () => {
      expect(cellsCarvedDifferently(name)).toEqual([])
    })
  }
})
