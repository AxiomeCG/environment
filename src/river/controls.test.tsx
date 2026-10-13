import { createTerrainField, encodeTerrainField, SiteNode } from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import 'three'
import { RiverNode } from './schema'

// The panel reaches CommonJS builds that require three; load it only once
// three's ES module has been evaluated above (see system.test.tsx).
const { RiverPlanReadout } = await import('./controls-sections')
const { endRiverLiveTerrain, previewTerrainForRiver } = await import('./tool')

/** The 20 m test lot on ground falling 10 % toward +x. */
function fallingSite() {
  const terrain = createTerrainField({ origin: [-10, -10], spacing: 0.5, cols: 41, rows: 41, step: 0.01 })
  for (let row = 0; row < terrain.rows; row += 1) {
    for (let col = 0; col < terrain.cols; col += 1) {
      const x = terrain.origin[0] + col * terrain.spacing
      terrain.heights[row * terrain.cols + col] = Math.round((2 - 0.1 * x) / terrain.step)
    }
  }
  return SiteNode.parse({
    id: 'site_river_panel',
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
  })
}

function downhillRiver(points: readonly (readonly [number, number])[]) {
  return RiverNode.parse({ id: 'river_panel', parentId: 'site_river_panel', points, flow: 'downhill' })
}

describe('river plan readout', () => {
  test('a river meeting itself at two water levels is reported as not built', () => {
    // Review round 2 input: the crossing path on ground falling 10 %.
    const crossing = downhillRiver([
      [-8, -8],
      [8, 8],
      [-8, 8],
      [8, -8],
    ])

    const markup = renderToStaticMarkup(<RiverPlanReadout river={crossing} siblings={[]} site={fallingSite()} />)

    expect(markup).toContain('Not built: A downhill river cannot cross or touch itself')
    expect(markup).not.toContain('Mean slope')
  })

  test('a buildable river shows its facts', () => {
    const straight = downhillRiver([
      [-8, 0],
      [8, 0],
    ])

    const markup = renderToStaticMarkup(<RiverPlanReadout river={straight} siblings={[]} site={fallingSite()} />)

    expect(markup).toContain('Mean slope')
    expect(markup).not.toContain('Not built')
  })
})

describe('river plan readout during a live preview', () => {
  test('a draft on a Site never carved before reports the plan on its flat ground, before and after the preview carves it', () => {
    // Review round 3 input: no persisted terrain, a 4 m wide, 1 m deep
    // downhill draft; the review measured 44 m³ planned against flat ground.
    const site = SiteNode.parse({
      id: 'site_river_panel',
      polygon: {
        type: 'polygon',
        points: [
          [-10, -10],
          [10, -10],
          [10, 10],
          [-10, 10],
        ],
      },
    })
    const draft = downhillRiver([
      [-8, 0],
      [8, 0],
    ])
    try {
      const beforePreview = renderToStaticMarkup(<RiverPlanReadout river={draft} siblings={[]} site={site} />)
      previewTerrainForRiver(site, draft, { [site.id]: site })
      const duringPreview = renderToStaticMarkup(<RiverPlanReadout river={draft} siblings={[]} site={site} />)

      expect(beforePreview).toContain('44 m³')
      expect(duringPreview).toEqual(beforePreview)
    } finally {
      endRiverLiveTerrain(site.id)
    }
  })
})

describe('river plan readout: what the river tool does not solve yet', () => {
  test('two rivers meeting at different water levels are flagged as an unsolved junction', () => {
    // Review round 4 input: on ground falling 10 % toward +x, a river along x
    // has its water at 2.532 m at the origin, one along z at 1.892 m (both
    // with the 12 mm render clearance); neither is refused.
    const alongX = downhillRiver([
      [-8, 0],
      [8, 0],
    ])
    const alongZ = RiverNode.parse({ ...downhillRiver([[0, -8], [0, 8]]), id: 'river_panel_z' })

    const markup = renderToStaticMarkup(
      <RiverPlanReadout river={alongX} site={fallingSite()} siblings={[alongZ]} />,
    )

    expect(markup).toContain('Mean slope')
    // The largest gap anywhere the two channels overlap: at least the 0.64 m
    // between their centrelines at the origin.
    const gap = /meets another river at a different water level \(([0-9.]+) m apart\)/.exec(markup)
    expect(Number(gap?.[1])).toBeGreaterThanOrEqual(0.64)
  })

  test('an embanked sea outlet is flagged: its continuation outside the Site is not embanked', () => {
    // Review round 4 input: a sea outlet on ground 2 − 0.1(x + 10), held up at
    // a 2 % maximum slope, reaches the boundary on an embankment.
    const seaRiver = RiverNode.parse({
      ...downhillRiver([
        [-8, 0],
        [8, 0],
      ]),
      outlet: 'sea',
    })

    const markup = renderToStaticMarkup(
      <RiverPlanReadout river={seaRiver} site={fallingSite()} siblings={[]} />,
    )

    expect(markup).toContain('Not supported: outside the Site the sea outlet is not embanked')
  })

  test('a river with neither limit shows no notice', () => {
    const straight = downhillRiver([
      [-8, 0],
      [8, 0],
    ])

    const markup = renderToStaticMarkup(
      <RiverPlanReadout river={straight} site={fallingSite()} siblings={[]} />,
    )

    expect(markup).not.toContain('Not supported')
  })
})
