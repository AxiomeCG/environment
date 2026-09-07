import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { POND_WATER_APPEARANCE } from './appearance'
import { resolvePond } from './geometry'
import type { PondNode, WaterQuality } from './schema'

type BoundaryEdge = {
  first: readonly [number, number]
  second: readonly [number, number]
  count: number
}

export function buildPondFloorplan(
  node: PondNode,
  context: GeometryContext,
): FloorplanGeometry | null {
  const resolved = resolvePond(node, context)
  if (!resolved || resolved.surface.level === null || resolved.surface.positions.length === 0) {
    return null
  }

  const quality: WaterQuality = node.quality in POND_WATER_APPEARANCE ? node.quality : 'clear'
  const appearance = POND_WATER_APPEARANCE[quality]
  const view = context.viewState
  const active = view?.selected === true || view?.highlighted === true
  const stroke = active && view?.palette ? view.palette.selectedStroke : appearance.deepColor
  const fillPath: string[] = []
  const edges = new Map<string, BoundaryEdge>()
  const positions = resolved.surface.positions

  for (let offset = 0; offset < positions.length; offset += 9) {
    const first = [positions[offset]!, positions[offset + 2]!] as const
    const second = [positions[offset + 3]!, positions[offset + 5]!] as const
    const third = [positions[offset + 6]!, positions[offset + 8]!] as const
    fillPath.push(
      `M ${first[0]} ${first[1]} L ${second[0]} ${second[1]} L ${third[0]} ${third[1]} Z`,
    )
    countEdge(edges, first, second)
    countEdge(edges, second, third)
    countEdge(edges, third, first)
  }

  const shoreline = [...edges.values()]
    .filter(({ count }) => count === 1)
    .map(({ first, second }) => `M ${first[0]} ${first[1]} L ${second[0]} ${second[1]}`)
    .join(' ')

  const children: FloorplanGeometry[] = [
    {
      kind: 'path',
      d: fillPath.join(' '),
      fill: appearance.floorplanColor,
      fillOpacity: active ? 0.62 : 0.48,
      stroke: 'none',
      metadata: {
        pondArea: resolved.surface.area,
        pondLevel: resolved.surface.level,
      },
    },
  ]
  if (shoreline.length > 0) {
    children.push({
      kind: 'path',
      d: shoreline,
      fill: 'none',
      stroke,
      strokeOpacity: active ? 0.95 : 0.64,
      strokeWidth: active ? 2 : 1,
      vectorEffect: 'non-scaling-stroke',
      pointerEvents: 'none',
    })
  }
  return { kind: 'group', children }
}

function countEdge(
  edges: Map<string, BoundaryEdge>,
  first: readonly [number, number],
  second: readonly [number, number],
): void {
  const firstKey = pointKey(first)
  const secondKey = pointKey(second)
  const key = firstKey < secondKey ? `${firstKey}|${secondKey}` : `${secondKey}|${firstKey}`
  const current = edges.get(key)
  if (current) current.count += 1
  else edges.set(key, { first, second, count: 1 })
}

function pointKey(point: readonly [number, number]): string {
  return `${Math.round(point[0] * 1e7)}:${Math.round(point[1] * 1e7)}`
}
