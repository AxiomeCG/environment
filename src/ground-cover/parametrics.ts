import type { ParametricDescriptor } from '@pascal-app/core'
import { paintTilesDeletedWith } from '../paint-tiles/compose'
import type { GrassFieldNode } from './schema'
import { GROUND_COVER_STYLE, type GroundCoverStyleKey } from './style'

function styleField(key: GroundCoverStyleKey) {
  const { min, max, step, unit } = GROUND_COVER_STYLE[key]
  return { key, kind: 'number' as const, min, max, step, unit }
}

export const grassFieldParametrics: ParametricDescriptor<GrassFieldNode> = {
  onDeleteCascade: paintTilesDeletedWith,
  groups: [
    {
      label: 'Ground cover appearance (global)',
      fields: [
        styleField('density'),
        styleField('flowerDensity'),
        styleField('bladeHeight'),
        styleField('bladeRestBend'),
        styleField('bladeWidth'),
        styleField('bladeTipBrightness'),
      ],
    },
    {
      label: 'Natural variation',
      fields: [
        styleField('bladeHeightVariation'),
        styleField('bladeWidthVariation'),
        styleField('bladeTintVariation'),
      ],
    },
    {
      label: 'Wind',
      fields: [
        styleField('windStrength'),
        styleField('grassWindInfluence'),
      ],
    },
    {
      label: 'Obstacle interaction',
      fields: [
        styleField('obstacleBendRadius'),
        styleField('obstacleBendStrength'),
        styleField('obstacleFlattening'),
      ],
    },
    {
      label: 'Transform',
      fields: [{ key: 'position', kind: 'vec3' }],
    },
  ],
}
