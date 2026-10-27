import { z } from 'zod'

export const LOT_GROUND_KINDS = ['grass', 'earth', 'path', 'paving', 'none'] as const
export type LotGroundKind = (typeof LOT_GROUND_KINDS)[number]

/**
 * The ground a whole lot was laid with (`lay_ground` with `site: true`), kept on the Ground cover
 * and the Surface: land the lot grows into afterwards reads as it, whoever grows the lot. `lot` is
 * the lot as it was laid; inside it the paint tiles stay as they are.
 */
export const LotGround = z.object({
  lot: z.array(z.tuple([z.number(), z.number()])).min(3).max(256),
  ground: z.enum(LOT_GROUND_KINDS),
  /** The grass colour, `#rrggbb`, when the ground is grass and one was given. */
  tint: z.string().regex(/^#[0-9a-f]{6}$/).optional(),
  /** The local grass height scale laid with it, when one was given. */
  grassHeight: z.number().min(0.5).max(2).optional(),
})

export type LotGround = z.infer<typeof LotGround>
