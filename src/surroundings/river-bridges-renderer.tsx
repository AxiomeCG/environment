import { useEffect, useMemo } from 'react'
import { Matrix4, Vector3 } from 'three'
import { disposePrimitiveInstances, PrimitiveInstances } from './primitive-instances'
import type { BridgeSpan } from './river-bridges'

const CONCRETE = '#777873'
const STEEL = '#44484b'
const GIRDER_HEIGHT = 0.34
const GIRDER_WIDTH = 0.2
const RAIL_HEIGHT = 0.78
const RAIL_WIDTH = 0.09
const ABUTMENT_THICKNESS = 0.65
const MAXIMUM_ABUTMENT_HEIGHT = 4

const xAxis = new Vector3()
const yAxis = new Vector3()
const zAxis = new Vector3()
const center = new Vector3()
const scale = new Vector3()

function segmentMatrix(
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  height: number,
  depth: number,
): Matrix4 | null {
  xAxis.set(end[0] - start[0], end[1] - start[1], end[2] - start[2])
  const length = xAxis.length()
  if (length < 1e-6) return null
  xAxis.multiplyScalar(1 / length)
  zAxis.set(-xAxis.z, 0, xAxis.x)
  if (zAxis.lengthSq() < 1e-9) zAxis.set(0, 0, 1)
  else zAxis.normalize()
  yAxis.crossVectors(zAxis, xAxis).normalize()
  center.set((start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2)
  scale.set(length, height, depth)
  return new Matrix4().makeBasis(xAxis, yAxis, zAxis).scale(scale).setPosition(center)
}

function shiftedSegment(
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  lateral: number,
  vertical: number,
): readonly [readonly [number, number, number], readonly [number, number, number]] {
  const dx = end[0] - start[0]
  const dz = end[2] - start[2]
  const length = Math.max(1e-6, Math.hypot(dx, dz))
  const offsetX = (-dz / length) * lateral
  const offsetZ = (dx / length) * lateral
  return [
    [start[0] + offsetX, start[1] + vertical, start[2] + offsetZ],
    [end[0] + offsetX, end[1] + vertical, end[2] + offsetZ],
  ]
}

function addSpan(instances: PrimitiveInstances, span: BridgeSpan): void {
  const halfWidth = span.width / 2
  const stations = [0]
  for (let index = 1; index < span.points.length; index += 1) {
    const a = span.points[index - 1]!,
      b = span.points[index]!
    stations.push(stations[index - 1]! + Math.hypot(b[0] - a[0], b[2] - a[2]))
  }
  const railStart = span.abutmentGroundHeights[0] === null ? halfWidth + 0.5 : 0
  const railEnd = stations.at(-1)! - (span.abutmentGroundHeights[1] === null ? halfWidth + 0.5 : 0)
  for (let index = 1; index < span.points.length; index += 1) {
    const start = span.points[index - 1]!
    const end = span.points[index]!
    for (const lateral of [-span.width * 0.28, span.width * 0.28]) {
      const [beamStart, beamEnd] = shiftedSegment(start, end, lateral, -GIRDER_HEIGHT * 0.7)
      const matrix = segmentMatrix(beamStart, beamEnd, GIRDER_HEIGHT, GIRDER_WIDTH)
      if (matrix) instances.add('box', 'paint', STEEL, matrix)
    }
    if (stations[index - 1]! < railStart || stations[index]! > railEnd) continue
    for (const lateral of [-halfWidth + RAIL_WIDTH, halfWidth - RAIL_WIDTH]) {
      const [railStart, railEnd] = shiftedSegment(start, end, lateral, RAIL_HEIGHT)
      const matrix = segmentMatrix(railStart, railEnd, RAIL_WIDTH, RAIL_WIDTH)
      if (matrix) instances.add('box', 'paint', STEEL, matrix)
    }
  }

  for (let index = 0; index < span.points.length; index += 1) {
    if (stations[index]! < railStart || stations[index]! > railEnd) continue
    const point = span.points[index]!
    const neighbor =
      index === span.points.length - 1
        ? span.points[Math.max(0, index - 1)]!
        : span.points[index + 1]!
    const dx = index === span.points.length - 1 ? point[0] - neighbor[0] : neighbor[0] - point[0]
    const dz = index === span.points.length - 1 ? point[2] - neighbor[2] : neighbor[2] - point[2]
    const length = Math.max(1e-6, Math.hypot(dx, dz))
    const lateralX = -dz / length
    const lateralZ = dx / length
    for (const lateral of [-halfWidth + RAIL_WIDTH, halfWidth - RAIL_WIDTH]) {
      instances.add(
        'box',
        'paint',
        STEEL,
        new Matrix4()
          .makeScale(RAIL_WIDTH, RAIL_HEIGHT, RAIL_WIDTH)
          .setPosition(
            point[0] + lateralX * lateral,
            point[1] + RAIL_HEIGHT / 2,
            point[2] + lateralZ * lateral,
          ),
      )
    }
  }

  for (const index of [0, span.points.length - 1]) {
    const ground = span.abutmentGroundHeights[index === 0 ? 0 : 1]
    if (ground === null) continue
    const point = span.points[index]!
    const neighbor = index === 0 ? span.points[1]! : span.points[index - 1]!
    const direction =
      index === 0
        ? ([neighbor[0] - point[0], neighbor[2] - point[2]] as const)
        : ([point[0] - neighbor[0], point[2] - neighbor[2]] as const)
    const length = Math.max(1e-6, Math.hypot(direction[0], direction[1]))
    xAxis.set(direction[0] / length, 0, direction[1] / length)
    yAxis.set(0, 1, 0)
    zAxis.set(-xAxis.z, 0, xAxis.x)
    const height = Math.max(0.45, Math.min(MAXIMUM_ABUTMENT_HEIGHT, point[1] - ground))
    center.set(point[0], point[1] - height / 2 - 0.12, point[2])
    scale.set(ABUTMENT_THICKNESS, height, span.width + 0.5)
    const matrix = new Matrix4().makeBasis(xAxis, yAxis, zAxis).scale(scale).setPosition(center)
    instances.add('box', 'paint', CONCRETE, matrix)
  }
}

function buildBridgeInstances(spans: readonly BridgeSpan[]) {
  const instances = new PrimitiveInstances()
  for (const span of spans) {
    if (span.points.length >= 2) addSpan(instances, span)
  }
  return instances.build('environment-river-bridges')
}

/** Static presentation structure; Streetscape owns and renders the road deck. */
export function RiverBridges({ spans }: { spans: readonly BridgeSpan[] }) {
  const root = useMemo(() => buildBridgeInstances(spans), [spans])
  useEffect(
    () => () => {
      disposePrimitiveInstances(root)
    },
    [root],
  )
  if (spans.length === 0) return null
  return <primitive object={root} dispose={null} />
}
