import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
import { PondNode } from '../pond/schema'

export const RIVER_KIND = 'environment:river'
export type RiverFlowDirection = 'forward' | 'reverse'
export type RiverSource = 'rounded' | 'mountain'
export type RiverOutlet = 'rounded' | 'sea'
export type RiverPoint = readonly [number, number]
/** How the water surface is determined: solved downhill, or following the ground as drawn. */
export type RiverFlowMode = 'downhill' | 'as_drawn'
export type RiverSectionShape = 'curved' | 'trapezoid'
export type RiverStartEnd = 'taper' | 'rounded' | 'spring'
export type RiverEndEnd = 'taper' | 'rounded' | 'fan'

/** Cross-section of the carved channel, shared by every station along the river. */
export const RiverSection = z.object({
  shape: z.enum(['curved', 'trapezoid']).default('curved'),
  /** Horizontal run per unit of rise on the banks (2 = a gentle 2:1 slope). */
  bankSlope: z.number().finite().min(0.25).max(10).default(2),
  /** 0 keeps the deepest line centred; higher values push it to the outside of bends. */
  bendAsymmetry: z.number().finite().min(0).max(1).default(0),
  /** Flat bench width kept at bank-top height on each side of the channel, in metres. */
  bermM: z.number().finite().min(0).max(10).default(0),
  /** Distance over which cut/fill banks feather back into the existing ground, in metres. */
  blendM: z.number().finite().min(0).max(20).default(2),
})
export type RiverSection = z.infer<typeof RiverSection>

/** Cap shapes where the authored path ends inside the Site (connected ends ignore these). */
export const RiverEnds = z.object({
  // `rounded` is the pre-v3 semicircle cap, so it is the migration default.
  start: z.enum(['taper', 'rounded', 'spring']).default('rounded'),
  end: z.enum(['taper', 'rounded', 'fan']).default('rounded'),
})
export type RiverEnds = z.infer<typeof RiverEnds>

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
  /**
   * Optional per-point width overrides, aligned by index with `points`. A null
   * (or missing) entry interpolates between the nearest set neighbours, then
   * falls back to `width`. Same for `pointDepths` against `depth`.
   */
  pointWidths: z.array(z.number().finite().min(1).max(24).nullable()).max(128).default([]),
  pointDepths: z.array(z.number().finite().min(0.1).max(8).nullable()).max(128).default([]),
  source: z.enum(['rounded', 'mountain']).default('rounded'),
  outlet: z.enum(['rounded', 'sea']).default('rounded'),
  flowDirection: z.enum(['forward', 'reverse']).default('forward'),
  flowSpeed: z.number().finite().min(0).max(3).default(0.6),
  quality: PondNode.shape.quality,
  shoreline: PondNode.shape.shoreline,
  /**
   * Water-surface model. Rivers saved before this field existed parse as
   * `as_drawn`, which reproduces the original ground-following carve exactly;
   * newly drawn rivers default to `downhill` (see the definition defaults).
   */
  flow: z.enum(['downhill', 'as_drawn']).default('as_drawn'),
  /** Steepest allowed water slope in downhill mode, in percent. */
  maxSlopePct: z.number().finite().min(0).max(50).default(2),
  section: RiverSection.default({ shape: 'curved', bankSlope: 2, bendAsymmetry: 0, bermM: 0, blendM: 2 }),
  ends: RiverEnds.default({ start: 'rounded', end: 'rounded' }),
}).describe('An editable watercourse with a terrain-carved channel and directional surface flow')

export type RiverNode = z.infer<typeof RiverNode>
