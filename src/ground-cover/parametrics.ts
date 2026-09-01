import type { ParametricDescriptor } from '@pascal-app/core'
import type { GrassFieldNode } from './schema'

export const grassFieldParametrics: ParametricDescriptor<GrassFieldNode> = {
  groups: [
    {
      label: 'Blade',
      fields: [
        {
          key: 'bladeWidth',
          kind: 'number',
          unit: 'm',
          min: 0.005,
          max: 0.2,
          step: 0.005,
        },
        {
          key: 'bladeWidthVariation',
          kind: 'number',
          unit: '%',
          min: 0,
          max: 100,
          step: 1,
        },
        { key: 'bladeHeight', kind: 'number', unit: 'm', min: 0.05, max: 1, step: 0.01 },
        {
          key: 'bladeHeightVariation',
          kind: 'number',
          unit: '%',
          min: 0,
          max: 100,
          step: 1,
        },
        {
          key: 'bladeTintVariation',
          kind: 'number',
          unit: '%',
          min: 0,
          max: 100,
          step: 1,
        },
        {
          key: 'bladeTipBrightness',
          kind: 'number',
          unit: '%',
          min: 0,
          max: 500,
          step: 5,
        },
      ],
    },
    {
      label: 'Field',
      fields: [{ key: 'density', kind: 'number', unit: '%', min: 0, max: 100, step: 1 }],
    },
    {
      label: 'Wind',
      fields: [
        { key: 'windStrength', kind: 'number', unit: '%', min: 0, max: 200, step: 5 },
        {
          key: 'grassWindInfluence',
          kind: 'number',
          unit: '%',
          min: 0,
          max: 300,
          step: 5,
        },
      ],
    },
    {
      label: 'Position',
      fields: [{ key: 'position', kind: 'vec3' }],
    },
  ],
}
