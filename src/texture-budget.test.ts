import { type AnyNode, type AnyNodeId, type GeometryContext, SiteNode } from '@pascal-app/core'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Mesh, type Object3D } from 'three'
import { buildGrassFieldGeometry } from './ground-cover/geometry'
import { GrassFieldNode } from './ground-cover/schema'
import { buildSurfaceMaterialGeometry } from './surface-material/geometry'
import { SurfaceMaterialNode } from './surface-material/schema'

/**
 * A fragment stage may sample 16 textures on the adapters this must run on (WebGPU's default
 * `maxSampledTexturesPerShaderStage`; WebGL2 guarantees 16 units). One over and the pipeline is
 * refused: the material is not drawn at all. The host's lighting adds its own to every lit
 * material (three on the build this was measured against: 13 of the surface's own was drawn, 14
 * was refused as 17), so what each Environment material samples itself is pinned here.
 */
const FRAGMENT_TEXTURE_LIMIT = 16
const HOST_LIGHTING_TEXTURES = 3
/** What each lawn material reads on a lot that also has a painted surface under it. */
const LAWN_TEXTURES = {
  'grass-field-blade': 7,
  'grass-field-ground': 7,
  'grass-field-flower-daisy': 0,
  'grass-field-flower-cup': 0,
  'grass-field-flower-spike': 0,
}

type TextureReader = { isTextureNode?: boolean; value?: unknown; traverse(visit: (node: TextureReader) => void): void }

/** The slots a lit node material reads in its fragment stage; `positionNode` is the vertex's. */
const FRAGMENT_SLOTS = [
  'colorNode', 'normalNode', 'roughnessNode', 'metalnessNode', 'aoNode', 'opacityNode', 'maskNode',
  'emissiveNode', 'alphaTestNode', 'fragmentNode', 'outputNode', 'backdropNode', 'backdropAlphaNode',
] as const

/**
 * The distinct textures a mesh's material reads in its fragment stage, lighting aside: every
 * texture reachable from its fragment slots. A texture read in the vertex stage and handed on as
 * a varying is counted too, so this never undercounts. (Compiling the material without lights
 * would: the surface's roughness and occlusion maps are only read by the lighting.)
 */
function fragmentTextures(mesh: Mesh): number {
  const material = mesh.material as unknown as Record<string, TextureReader | null | undefined>
  const textures = new Set<unknown>()
  for (const slot of FRAGMENT_SLOTS) {
    material[slot]?.traverse((node) => {
      if (node.isTextureNode && node.value) textures.add(node.value)
    })
  }
  return textures.size
}

// The PBR maps are images: three's loader asks the page for an element and waits for it.
const page = globalThis as { document?: unknown }
const hadDocument = 'document' in page
const realDocument = page.document
beforeAll(() => {
  page.document = {
    createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_value: string) {} }),
  }
})
afterAll(() => {
  if (hadDocument) page.document = realDocument
  else delete page.document
})

const site = SiteNode.parse({
  id: 'site_textures',
  children: ['surface-material_textures', 'grass-field_textures'],
  polygon: { type: 'polygon', points: [[0, 0], [2, 0], [2, 2], [0, 2]] },
})
const surface = SurfaceMaterialNode.parse({ id: 'surface-material_textures', parentId: site.id })
const lawn = GrassFieldNode.parse({ id: 'grass-field_textures', parentId: site.id, flowerDensity: 40 })
const nodes: Record<string, unknown> = { [site.id]: site, [surface.id]: surface, [lawn.id]: lawn }
const context: GeometryContext = {
  parent: site,
  children: [],
  siblings: [],
  resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
}

function meshesOf(root: Object3D): Mesh[] {
  const meshes: Mesh[] = []
  root.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object)
  })
  return meshes
}

test('the painted surface samples its twelve maps and its paint, and nothing more', () => {
  const [sheet] = meshesOf(buildSurfaceMaterialGeometry(surface, context))
  if (!sheet) throw new Error('no surface sheet')
  const own = fragmentTextures(sheet)
  expect(own).toBe(13)
  expect(own + HOST_LIGHTING_TEXTURES).toBeLessThanOrEqual(FRAGMENT_TEXTURE_LIMIT)
})

test('every lawn material on a surfaced lot stays under the limit with the host\'s lighting', () => {
  const own: Record<string, number> = {}
  for (const mesh of meshesOf(buildGrassFieldGeometry(lawn, context))) {
    own[mesh.name || 'mesh'] = Math.max(own[mesh.name || 'mesh'] ?? 0, fragmentTextures(mesh))
  }
  for (const [name, count] of Object.entries(own)) {
    expect(count + HOST_LIGHTING_TEXTURES, `${name} reads ${count} textures of its own`).toBeLessThanOrEqual(
      FRAGMENT_TEXTURE_LIMIT,
    )
  }
  // Pinned, so one more texture on a lawn material is a decision, not an accident.
  expect(own).toEqual(LAWN_TEXTURES)
})
