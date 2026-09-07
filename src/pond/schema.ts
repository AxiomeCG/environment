import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

export const POND_KIND = 'environment:pond'
export const POND_LEVEL_STEP = 0.25

export type WaterQuality = 'pure' | 'clear' | 'deep' | 'swampy'
export type PondShoreline = 'soft' | 'rocky'
export type PondProp = {
  id: string
  kind: 'water-lily' | 'koi'
  position: [number, number]
  yaw: number
  scale: number
}

const WaterQualitySchema = z.enum(['pure', 'clear', 'deep', 'swampy'])
const PondPropSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['water-lily', 'koi']),
  position: z.tuple([z.number().finite(), z.number().finite()]),
  yaw: z.number().finite(),
  scale: z.number().finite().positive(),
})

export const PondNode = BaseNode.extend({
  id: objectId('pond'),
  type: nodeType(POND_KIND),
  name: z.string().default('Pond'),
  seed: z.tuple([z.number().finite(), z.number().finite()]).default([0, 0]),
  waterLevel: z.number().finite().nullable().default(null),
  quality: WaterQualitySchema.default('clear'),
  shoreline: z.enum(['soft', 'rocky']).default('soft'),
  props: z.array(PondPropSchema).max(128).default([]),
}).describe('A terrain-dependent pond occupying the depression around its seed')

export type PondNode = z.infer<typeof PondNode>
