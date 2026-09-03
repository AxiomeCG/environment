import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
import { GrassPaintFieldData } from './paint-field'

export const DEFAULT_GRASS_BLADE_WIDTH = 0.035
export const DEFAULT_GRASS_BLADE_HEIGHT = 0.15

export const GrassFieldNode = BaseNode.extend({
  id: objectId('grass-field'),
  type: nodeType('environment:ground-cover'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  bladeWidth: z.number().positive().default(DEFAULT_GRASS_BLADE_WIDTH),
  bladeWidthVariation: z.number().min(0).max(100).default(20),
  bladeHeight: z.number().positive().default(DEFAULT_GRASS_BLADE_HEIGHT),
  bladeHeightVariation: z.number().min(0).max(100).default(20),
  bladeTintVariation: z.number().min(0).max(100).default(20),
  bladeTipBrightness: z.number().min(0).max(500).default(300),
  density: z.number().min(0).max(100).default(100),
  windStrength: z.number().min(0).max(200).default(100),
  grassWindInfluence: z.number().min(0).max(300).default(100),
  obstacleBendRadius: z.number().min(0).max(3).default(0.75),
  obstacleBendStrength: z.number().min(0).max(2).default(0.12),
  obstacleFlattening: z.number().min(0).max(100).default(60),
  paintMap: GrassPaintFieldData.optional(),
  heightMap: GrassPaintFieldData.optional(),
})

export type GrassFieldNode = z.infer<typeof GrassFieldNode>

type GrassFieldDefaultsPatch = Pick<
  GrassFieldNode,
  | 'bladeWidth'
  | 'bladeHeight'
  | 'bladeWidthVariation'
  | 'bladeHeightVariation'
  | 'bladeTintVariation'
  | 'bladeTipBrightness'
  | 'density'
  | 'windStrength'
  | 'grassWindInfluence'
  | 'obstacleBendRadius'
  | 'obstacleBendStrength'
  | 'obstacleFlattening'
>

export function getMissingGrassFieldDefaults(node: unknown): Partial<GrassFieldDefaultsPatch> {
  const parsed = GrassFieldNode.parse(node)
  const source = node as Partial<GrassFieldDefaultsPatch>
  const patch: Partial<GrassFieldDefaultsPatch> = {}
  const usesLegacyScale = source.bladeWidth === 0.06 && source.bladeHeight === 0.25

  if (source.bladeWidth === undefined || usesLegacyScale) {
    patch.bladeWidth = DEFAULT_GRASS_BLADE_WIDTH
  }
  if (source.bladeHeight === undefined || usesLegacyScale) {
    patch.bladeHeight = DEFAULT_GRASS_BLADE_HEIGHT
  }

  if (source.bladeWidthVariation === undefined) {
    patch.bladeWidthVariation = parsed.bladeWidthVariation
  }
  if (source.bladeHeightVariation === undefined) {
    patch.bladeHeightVariation = parsed.bladeHeightVariation
  }
  if (source.bladeTintVariation === undefined) {
    patch.bladeTintVariation = parsed.bladeTintVariation
  }
  if (source.bladeTipBrightness === undefined) {
    patch.bladeTipBrightness = parsed.bladeTipBrightness
  }
  if (source.density === undefined) patch.density = parsed.density
  if (source.windStrength === undefined) patch.windStrength = parsed.windStrength
  if (source.grassWindInfluence === undefined) {
    patch.grassWindInfluence = parsed.grassWindInfluence
  }
  if (source.obstacleBendRadius === undefined) {
    patch.obstacleBendRadius = parsed.obstacleBendRadius
  }
  if (source.obstacleBendStrength === undefined) {
    patch.obstacleBendStrength = parsed.obstacleBendStrength
  }
  if (source.obstacleFlattening === undefined) {
    patch.obstacleFlattening = parsed.obstacleFlattening
  }

  return patch
}
