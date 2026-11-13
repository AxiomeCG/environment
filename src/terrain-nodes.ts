/**
 * Node kinds the host keeps authored ground in, under the Site, beside the legacy `site.terrain`:
 * its terrain tools and its sculpt brush write tiles, a retaining edge is a break.
 */
const TERRAIN_NODE_KINDS: ReadonlySet<string> = new Set(['terrain-tile', 'terrain-break'])

type SceneNode = { type?: unknown; parentId?: unknown }

/**
 * Sites whose ground changed through those nodes: one added, removed or replaced. Such an edit
 * leaves the Site node itself untouched, so `site.terrain !== previous.terrain` never sees it and
 * whatever stands on the ground (grass roots, the draped surface, a pond's shore) would keep the
 * old relief. `changedIds`, when the store gives them, bound the scan.
 */
export function sitesWithChangedTerrainNodes(
  current: Readonly<Record<string, unknown>>,
  previous: Readonly<Record<string, unknown>>,
  changedIds?: Iterable<string>,
): Set<string> {
  const siteIds = new Set<string>()
  const ids = changedIds ?? new Set([...Object.keys(current), ...Object.keys(previous)])
  for (const id of ids) {
    const now = current[id] as SceneNode | undefined
    const then = previous[id] as SceneNode | undefined
    if (now === then) continue
    for (const node of [now, then]) {
      if (node && TERRAIN_NODE_KINDS.has(String(node.type)) && typeof node.parentId === 'string') {
        siteIds.add(node.parentId)
      }
    }
  }
  return siteIds
}
