// Next emits imported images as StaticImageData. Keep this declaration local so
// the plugin can bundle artwork without depending on Next's types.
declare module '*.webp' {
  const asset: string | { src: string; height: number; width: number; blurDataURL?: string }
  export default asset
}
