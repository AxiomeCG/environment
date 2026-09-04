import { expect, test } from 'bun:test'
import {
  deriveSurroundingsLayout,
  STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
} from './corridor'
import { deriveBoundarySegments, type FrontageContext, type Point2 } from './frontages'
import { buildMeshGeometryBuffers } from './mesh-geometry'
import { deriveRuntimeRoadNetwork } from './runtime-road-graph'
import { buildRoadPresentationPlan } from './streetscape-road-presentation'

const SITE = [
  [-15, -15],
  [15, -15],
  [15, 15],
  [-15, 15],
] as const satisfies readonly Point2[]
const PRIMARY = { separator: 'primary-road', access: 'none' } as const satisfies FrontageContext
const SECONDARY = { separator: 'secondary-road', access: 'none' } as const satisfies FrontageContext

type PlanPoint = readonly [number, number]
type IndexedGeometry = Readonly<{ indices: readonly number[]; positions: readonly number[] }>

function trianglePlanPoints(geometry: IndexedGeometry, offset: number): PlanPoint[] {
  return geometry.indices.slice(offset, offset + 3).map((vertex) => [
    geometry.positions[vertex * 3]!,
    geometry.positions[vertex * 3 + 2]!,
  ] as const)
}

function planCross(first: PlanPoint, second: PlanPoint, point: PlanPoint): number {
  return (second[0] - first[0]) * (point[1] - first[1])
    - (second[1] - first[1]) * (point[0] - first[0])
}

function triangleIntersectionArea(
  subject: readonly PlanPoint[],
  clip: readonly PlanPoint[],
): number {
  let polygon = [...subject]
  const clipOrientation = Math.sign(planCross(clip[0]!, clip[1]!, clip[2]!))
  if (clipOrientation === 0) return 0

  for (let edgeIndex = 0; edgeIndex < clip.length; edgeIndex += 1) {
    const edgeStart = clip[edgeIndex]!
    const edgeEnd = clip[(edgeIndex + 1) % clip.length]!
    const input = polygon
    polygon = []
    if (input.length === 0) break

    let previous = input.at(-1)!
    let previousDistance = clipOrientation * planCross(edgeStart, edgeEnd, previous)
    for (const current of input) {
      const currentDistance = clipOrientation * planCross(edgeStart, edgeEnd, current)
      const previousInside = previousDistance >= -1e-10
      const currentInside = currentDistance >= -1e-10
      if (previousInside !== currentInside) {
        const mix = previousDistance / (previousDistance - currentDistance)
        polygon.push([
          interpolateCoordinate(previous[0], current[0], mix),
          interpolateCoordinate(previous[1], current[1], mix),
        ])
      }
      if (currentInside) polygon.push(current)
      previous = current
      previousDistance = currentDistance
    }
  }

  let doubleArea = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const point = polygon[index]!
    const next = polygon[(index + 1) % polygon.length]!
    doubleArea += point[0] * next[1] - point[1] * next[0]
  }
  return Math.abs(doubleArea) / 2
}

function interpolateCoordinate(first: number, second: number, mix: number): number {
  return first + (second - first) * mix
}

function triangleUpwardDoubleArea(
  geometry: IndexedGeometry,
  offset: number,
): number {
  const first = geometry.indices[offset]! * 3
  const second = geometry.indices[offset + 1]! * 3
  const third = geometry.indices[offset + 2]! * 3
  const firstSecondX = geometry.positions[second]! - geometry.positions[first]!
  const firstSecondZ = geometry.positions[second + 2]! - geometry.positions[first + 2]!
  const firstThirdX = geometry.positions[third]! - geometry.positions[first]!
  const firstThirdZ = geometry.positions[third + 2]! - geometry.positions[first + 2]!
  return firstSecondZ * firstThirdX - firstSecondX * firstThirdZ
}

function triangleNormalAlignment(
  geometry: ReturnType<typeof buildMeshGeometryBuffers>,
  offset: number,
): number {
  const first = geometry.indices[offset]! * 3
  const second = geometry.indices[offset + 1]! * 3
  const third = geometry.indices[offset + 2]! * 3
  const firstSecond = [
    geometry.positions[second]! - geometry.positions[first]!,
    geometry.positions[second + 1]! - geometry.positions[first + 1]!,
    geometry.positions[second + 2]! - geometry.positions[first + 2]!,
  ] as const
  const firstThird = [
    geometry.positions[third]! - geometry.positions[first]!,
    geometry.positions[third + 1]! - geometry.positions[first + 1]!,
    geometry.positions[third + 2]! - geometry.positions[first + 2]!,
  ] as const
  const faceNormal = [
    firstSecond[1] * firstThird[2] - firstSecond[2] * firstThird[1],
    firstSecond[2] * firstThird[0] - firstSecond[0] * firstThird[2],
    firstSecond[0] * firstThird[1] - firstSecond[1] * firstThird[0],
  ] as const
  const vertexNormal = [
    geometry.normals[first]! + geometry.normals[second]! + geometry.normals[third]!,
    geometry.normals[first + 1]! + geometry.normals[second + 1]! + geometry.normals[third + 1]!,
    geometry.normals[first + 2]! + geometry.normals[second + 2]! + geometry.normals[third + 2]!,
  ] as const
  return faceNormal[0] * vertexNormal[0]
    + faceNormal[1] * vertexNormal[1]
    + faceNormal[2] * vertexNormal[2]
}

test('matches declarative vertex normals to the junction triangle winding', () => {
  const fixtures = [
    {
      points: SITE,
      contexts: { 0: SECONDARY, 1: SECONDARY, 2: SECONDARY, 3: PRIMARY },
    },
    ...[20, 21, 35, 45, 60, 90, 120, 145].map((angle) => {
      const radians = angle * Math.PI / 180
      return {
        points: [
          [-100, 0],
          [0, 0],
          [-Math.cos(radians) * 100, Math.sin(radians) * 100],
        ] as const satisfies readonly Point2[],
        contexts: { 0: SECONDARY, 1: PRIMARY },
      }
    }),
    {
      points: [
        [-5, 0],
        [0, 0],
        [-Math.cos(164 * Math.PI / 180) * 5, Math.sin(164 * Math.PI / 180) * 5],
      ] as const satisfies readonly Point2[],
      contexts: { 0: SECONDARY, 1: PRIMARY },
    },
  ]

  const invertedTriangles: Array<{
    alignment: number
    surfaceId: string
    triangle: number
  }> = []
  const zeroAreaTriangles: Array<{ surfaceId: string; triangle: number }> = []
  const nonUpwardBandTriangles: Array<{
    area: number
    surfaceId: string
    triangle: number
  }> = []
  const overlappingBandTriangles: Array<{
    area: number
    firstSurfaceId: string
    secondSurfaceId: string
  }> = []
  for (const fixture of fixtures) {
    const network = deriveRuntimeRoadNetwork(deriveSurroundingsLayout(
      deriveBoundarySegments(fixture),
      STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
    ))
    const roadSurfaces = buildRoadPresentationPlan(network).surfaces.filter(
      ({ name }) => !name.startsWith('road-marking-'),
    )
    const junctionSurfaces = roadSurfaces.filter(({ id }) => id.includes('junction-'))
    const bandSurfaces = junctionSurfaces.filter(
      ({ kind }) => kind !== 'junction-carriageway',
    )

    expect(junctionSurfaces.length).toBeGreaterThan(0)
    for (const surface of roadSurfaces) {
      for (let offset = 0; offset < surface.geometry.indices.length; offset += 3) {
        if (Math.abs(triangleUpwardDoubleArea(surface.geometry, offset)) <= 1e-9) {
          zeroAreaTriangles.push({ surfaceId: surface.id, triangle: offset / 3 })
        }
      }
    }
    for (const surface of junctionSurfaces) {
      const geometry = buildMeshGeometryBuffers(
        surface.geometry.positions,
        surface.geometry.indices,
      )
      for (let offset = 0; offset < geometry.indices.length; offset += 3) {
        const area = triangleUpwardDoubleArea(surface.geometry, offset)
        const triangle = offset / 3
        if (surface.kind !== 'junction-carriageway' && area < -1e-9) {
          nonUpwardBandTriangles.push({ area, surfaceId: surface.id, triangle })
        }

        const alignment = triangleNormalAlignment(geometry, offset)
        if (alignment < -1e-9) {
          invertedTriangles.push({
            alignment,
            surfaceId: surface.id,
            triangle,
          })
        }
      }
    }

    for (let firstIndex = 0; firstIndex < bandSurfaces.length; firstIndex += 1) {
      const firstSurface = bandSurfaces[firstIndex]!
      for (let secondIndex = firstIndex + 1; secondIndex < bandSurfaces.length; secondIndex += 1) {
        const secondSurface = bandSurfaces[secondIndex]!
        let overlapArea = 0
        for (
          let firstOffset = 0;
          firstOffset < firstSurface.geometry.indices.length && overlapArea <= 1e-8;
          firstOffset += 3
        ) {
          const firstTriangle = trianglePlanPoints(firstSurface.geometry, firstOffset)
          for (
            let secondOffset = 0;
            secondOffset < secondSurface.geometry.indices.length;
            secondOffset += 3
          ) {
            overlapArea = triangleIntersectionArea(
              firstTriangle,
              trianglePlanPoints(secondSurface.geometry, secondOffset),
            )
            if (overlapArea > 1e-8) break
          }
        }
        if (overlapArea > 1e-8) {
          overlappingBandTriangles.push({
            area: overlapArea,
            firstSurfaceId: firstSurface.id,
            secondSurfaceId: secondSurface.id,
          })
        }
      }
    }
  }
  expect(zeroAreaTriangles).toEqual([])
  expect(nonUpwardBandTriangles).toEqual([])
  expect(overlappingBandTriangles).toEqual([])
  expect(invertedTriangles).toEqual([])
})
