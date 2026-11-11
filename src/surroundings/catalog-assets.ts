/**
 * Pascal catalog models the surroundings place around the property. The values
 * mirror the editor catalog's entries (`CATALOG_ITEMS` in `@pascal-app/editor`)
 * so the presentation renders in read-only viewers that do not load the editor.
 */
export type SurroundingsCatalogAsset = Readonly<{
  src: string
  offset: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
}>

export const HYDRANT_CATALOG_ASSET: SurroundingsCatalogAsset = {
  src: 'https://byrpxoiotywskoojsrzd.supabase.co/storage/v1/object/public/items/system/hydrant/model.glb',
  offset: [-0.0046, 0, -0.0008],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
}
