import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
import { PondNode } from '../pond/schema'

export const RIVER_KIND = 'environment:river'
export type RiverFlowDirection = 'forward' | 'reverse'
export type RiverSource = 'rounded' | 'mountain'
export type RiverOutlet = 'rounded' | 'sea'
export type RiverPoint = readonly [number, number]

export const RiverNode = BaseNode.extend({
  id: objectId('river'),
  type: nodeType(RIVER_KIND),
  name: z.string().default('River'),
  points: z
    .array(z.tuple([z.number().finite(), z.number().finite()]))
    .min(2)
    .max(128),
  width: z.number().finite().min(1).max(24).default(4),
  depth: z.number().finite().min(0.1).max(8).default(1),
  source: z.enum(['rounded', 'mountain']).default('rounded'),
  outlet: z.enum(['rounded', 'sea']).default('rounded'),
  flowDirection: z.enum(['forward', 'reverse']).default('forward'),
  flowSpeed: z.number().finite().min(0).max(3).default(0.6),
  quality: PondNode.shape.quality,
  shoreline: PondNode.shape.shoreline,
}).describe('An editable watercourse with a terrain-carved channel and directional surface flow')

export type RiverNode = z.infer<typeof RiverNode>
