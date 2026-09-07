import {
  terrainFieldOf,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
} from '@pascal-app/core'
import { POND_WATER_APPEARANCE } from '../pond/appearance'
import type { WaterQuality } from '../pond/schema'
import type { RiverNode } from './schema'
import {
  riverPathWidthScale,
  riverTerrainBaseline,
  sampleRiverPath,
  type SampledRiverPath,
} from './terrain'

export function buildRiverFloorplan(
  node: RiverNode,
  context: GeometryContext,
): FloorplanGeometry | null {
  const parent = context.parent
  if (!parent || parent.type !== 'site') return null
  const terrain = riverTerrainBaseline(parent) ?? terrainFieldOf(parent)
  if (!terrain) return null
  const path = sampleRiverPath(terrain, node, parent.polygon.points)
  if (!path) return null
  const points = path.points.map((point): FloorplanPoint => [point[0], point[2]])
  const outline = riverFloorplanOutline(node, path)
  const appearance = POND_WATER_APPEARANCE[waterQuality(node.quality)]
  const active = context.viewState?.selected === true || context.viewState?.highlighted === true
  const stroke =
    active && context.viewState?.palette
      ? context.viewState.palette.selectedStroke
      : appearance.deepColor
  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points: outline,
      fill: appearance.floorplanColor,
      opacity: active ? 0.66 : 0.5,
      metadata: {
        riverWidth: node.width,
        riverDepth: node.depth,
        riverLength: path.length,
      },
    },
    {
      kind: 'polyline',
      points,
      fill: 'none',
      stroke,
      strokeWidth: active ? 2 : 1,
      vectorEffect: 'non-scaling-stroke',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      pointerEvents: 'none',
    },
  ]
  const arrow = flowArrow(
    path.points.map((point) => [point[0], point[2]]),
    node.flowDirection === 'reverse',
  )
  if (arrow) {
    children.push({
      kind: 'polyline',
      points: arrow,
      fill: 'none',
      stroke,
      strokeWidth: active ? 2.5 : 1.7,
      vectorEffect: 'non-scaling-stroke',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      pointerEvents: 'none',
    })
  }
  return { kind: 'group', children }
}

function riverFloorplanOutline(node: RiverNode, path: SampledRiverPath): readonly FloorplanPoint[] {
  const left: FloorplanPoint[] = []
  const right: FloorplanPoint[] = []
  for (let index = 0; index < path.points.length; index += 1) {
    const point = path.points[index]!
    const before = path.points[Math.max(0, index - 1)]!
    const after = path.points[Math.min(path.points.length - 1, index + 1)]!
    let tangentX = after[0] - before[0]
    let tangentZ = after[2] - before[2]
    const tangentLength = Math.hypot(tangentX, tangentZ)
    if (tangentLength <= 1e-8) continue
    tangentX /= tangentLength
    tangentZ /= tangentLength
    const normalX = -tangentZ
    const normalZ = tangentX
    const halfWidth = node.width * 0.5 * riverPathWidthScale(path, node, path.distances[index]!)
    left.push([point[0] + normalX * halfWidth, point[2] + normalZ * halfWidth])
    right.push([point[0] - normalX * halfWidth, point[2] - normalZ * halfWidth])
  }
  right.reverse()
  return [...left, ...right]
}

function flowArrow(
  points: readonly FloorplanPoint[],
  reverse: boolean,
): readonly FloorplanPoint[] | null {
  if (points.length < 2) return null
  const endIndex = Math.max(1, Math.min(points.length - 1, Math.round((points.length - 1) * 0.58)))
  const start = points[endIndex - 1]!
  const end = points[endIndex]!
  let dx = end[0] - start[0]
  let dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length <= 1e-8) return null
  dx /= length
  dz /= length
  if (reverse) {
    dx = -dx
    dz = -dz
  }
  const center = reverse ? start : end
  const size = 0.38
  const wing = 0.22
  return [
    [center[0] - dx * size - dz * wing, center[1] - dz * size + dx * wing],
    center,
    [center[0] - dx * size + dz * wing, center[1] - dz * size - dx * wing],
  ]
}

function waterQuality(value: string): WaterQuality {
  return value === 'pure' || value === 'deep' || value === 'swampy' ? value : 'clear'
}
