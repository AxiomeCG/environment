import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
import { LotGround } from '../paint-tiles/lot-ground-schema'
import { GrassPaintFieldData } from './paint-field'
import { groundCoverStyleDefaults as defaults } from './style'
export const GRASS_FIELD_KIND = 'environment:ground-cover'


export const DEFAULT_GRASS_BLADE_WIDTH = defaults.bladeWidth
export const DEFAULT_GRASS_BLADE_HEIGHT = defaults.bladeHeight
export const DEFAULT_GRASS_BLADE_REST_BEND = defaults.bladeRestBend
export const DEFAULT_GRASS_TIP_BRIGHTNESS = defaults.bladeTipBrightness

export const GrassFieldNode = BaseNode.extend({
  id: objectId('grass-field'),
  type: nodeType(GRASS_FIELD_KIND),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  bladeWidth: z.number().positive().default(DEFAULT_GRASS_BLADE_WIDTH),
  bladeWidthVariation: z.number().min(0).max(100).default(defaults.bladeWidthVariation),
  bladeHeight: z.number().positive().default(DEFAULT_GRASS_BLADE_HEIGHT),
  bladeHeightVariation: z.number().min(0).max(100).default(defaults.bladeHeightVariation),
  bladeRestBend: z.number().min(0).max(1).default(DEFAULT_GRASS_BLADE_REST_BEND),
  bladeTintVariation: z.number().min(0).max(100).default(defaults.bladeTintVariation),
  bladeTipBrightness: z.number().min(0).max(500).default(defaults.bladeTipBrightness),
  density: z.number().min(0).max(100).default(defaults.density),
  flowerDensity: z.number().min(0).max(100).default(defaults.flowerDensity),
  windStrength: z.number().min(0).max(200).default(defaults.windStrength),
  grassWindInfluence: z.number().min(0).max(300).default(defaults.grassWindInfluence),
  obstacleBendRadius: z.number().min(0).max(3).default(defaults.obstacleBendRadius),
  obstacleBendStrength: z.number().min(0).max(2).default(defaults.obstacleBendStrength),
  obstacleFlattening: z.number().min(0).max(100).default(defaults.obstacleFlattening),
  paintMap: GrassPaintFieldData.optional(),
  heightMap: GrassPaintFieldData.optional(),
  /**
   * Coverage (0-1) of ground that neither the paint map nor a paint tile covers. Nodes saved before
   * paint tiles have none, which reads as full coverage; new ones start at 0, with no grass.
   */
  unpaintedCoverage: z.number().min(0).max(1).optional(),
  /** The ground the whole lot was laid with: land the lot grows into reads as it. */
  lotGround: LotGround.optional(),
})

export type GrassFieldNode = z.infer<typeof GrassFieldNode>

type GrassFieldDefaultsPatch = Pick<
  GrassFieldNode,
  | 'bladeWidth'
  | 'bladeHeight'
  | 'bladeWidthVariation'
  | 'bladeHeightVariation'
  | 'bladeRestBend'
  | 'bladeTintVariation'
  | 'bladeTipBrightness'
  | 'density'
  | 'flowerDensity'
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
  if (source.bladeRestBend === undefined) {
    patch.bladeRestBend = parsed.bladeRestBend
  }
  if (source.bladeTintVariation === undefined) {
    patch.bladeTintVariation = parsed.bladeTintVariation
  }
  if (source.bladeTipBrightness === undefined) {
    patch.bladeTipBrightness = parsed.bladeTipBrightness
  }
  if (source.density === undefined) patch.density = parsed.density
  if (source.flowerDensity === undefined) {
    patch.flowerDensity = parsed.flowerDensity
  }
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
