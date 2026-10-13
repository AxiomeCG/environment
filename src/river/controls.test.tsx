import { createTerrainField, encodeTerrainField, SiteNode } from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import 'three'
import { RiverNode } from './schema'

// The panel reaches CommonJS builds that require three; load it only once
// three's ES module has been evaluated above (see system.test.tsx).
const { RiverPlanReadout } = await import('./controls')

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

    const markup = renderToStaticMarkup(<RiverPlanReadout river={crossing} site={fallingSite()} />)

    expect(markup).toContain('Not built: A downhill river cannot cross or touch itself')
    expect(markup).not.toContain('Mean slope')
  })

  test('a buildable river shows its facts', () => {
    const straight = downhillRiver([
      [-8, 0],
      [8, 0],
    ])

    const markup = renderToStaticMarkup(<RiverPlanReadout river={straight} site={fallingSite()} />)

    expect(markup).toContain('Mean slope')
    expect(markup).not.toContain('Not built')
  })
})
