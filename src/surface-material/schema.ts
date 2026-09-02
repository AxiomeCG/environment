import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
import { SurfaceMaterialFieldData } from './field'

export const SURFACE_MATERIAL_KIND = 'environment:surface-material'

export const SurfaceMaterialNode = BaseNode.extend({
  id: objectId('surface-material'),
  type: nodeType(SURFACE_MATERIAL_KIND),
  name: z.string().default('Surface'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  textureSize: z.number().min(25).max(200).default(100),
  paintMap: SurfaceMaterialFieldData.optional(),
})

export type SurfaceMaterialNode = z.infer<typeof SurfaceMaterialNode>
