import { shapeGrassCoverageValue } from '../ground-cover/render/blade-shape'
import { GRASS_CANDIDATE_CELL_SIZE } from '../ground-cover/scatter'
import type { GrassFieldNode } from '../ground-cover/schema'
import { groundCoverStyleDefaults, groundCoverStyleKeys, type GroundCoverStyle } from '../ground-cover/style'

export function groundCoverStyleFacts(node: GrassFieldNode) {
  const style = Object.fromEntries(
    groundCoverStyleKeys.map((key) => [key, node[key] ?? groundCoverStyleDefaults[key]]),
  ) as GroundCoverStyle
  const density = shapeGrassCoverageValue(style.density / 100)
  const maxBladesPerM2 = 1 / GRASS_CANDIDATE_CELL_SIZE ** 2
  return {
    style,
    units: {
      bladeHeightM: style.bladeHeight,
      bladeWidthM: style.bladeWidth,
      candidateCellM: GRASS_CANDIDATE_CELL_SIZE,
      maxBladesPerM2,
      bladesPerM2: maxBladesPerM2 * density,
      densityHeightScale: density ** 2,
      unvariedHeightM: style.bladeHeight * density ** 2,
      meaning: 'Nominal full paint on flat, unobstructed ground at full-detail LOD, not a visible or botanical blade count. Each instance has two crossed planes. One jittered candidate per cell; density uses smoothstep(0.05, 1, density/100). Blade height is the straight, unvaried length: local lay_ground grassHeight (0.5-2), density squared, variation and obstacle flattening scale it; bending changes vertical tip height. Paint, slopes, obstacles and distance LOD reduce counts; finite boundaries and cell rounding change counts per area. Width changes fullness, not root spacing. Density 100 is the cap; candidateCellM is not agent-editable.',
    },
  }
}
