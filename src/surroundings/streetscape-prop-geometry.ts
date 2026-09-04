/*
 * Presentation geometry derived from @pascal-app/plugin-streetscape at
 * commit 1c04ec9ccb3fa8124ec56dfc1026567cbbc51aef:
 * - src/street-light-geometry.ts and src/street-light-model.tsx
 * - src/street-infrastructure-geometry.ts and src/street-infrastructure-model.tsx
 *
 * This is intentionally a fixed, render-only snapshot. It contains no plugin
 * registry, node model, controls, interaction, animation, or light sources.
 *
 * MIT License
 *
 * Copyright (c) 2026 Pascal
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CubicBezierCurve3,
  CylinderGeometry,
  Float32BufferAttribute,
  Matrix4,
  RingGeometry,
  TubeGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export type StreetscapeGeometryPair = Readonly<{
  accent: BufferGeometry
  body: BufferGeometry
}>

export type FencePresentationStyle = 'slat' | 'rail' | 'horizontal'

export type FencePresentationMember = Readonly<{
  depth: number
  height: number
  width: number
  x: number
  y: number
}>

function transform(
  geometry: BufferGeometry,
  position: readonly [number, number, number],
  rotationZ = 0,
): BufferGeometry {
  const matrix = new Matrix4().makeRotationZ(rotationZ)
  matrix.setPosition(position[0], position[1], position[2])
  geometry.applyMatrix4(matrix)
  return geometry
}

function mergeOwned(parts: BufferGeometry[], preserve: readonly string[] = []): BufferGeometry {
  for (const part of parts) {
    if (!part.index) {
      const count = part.getAttribute('position').count
      const indices = count > 65_535 ? new Uint32Array(count) : new Uint16Array(count)
      for (let index = 0; index < count; index += 1) indices[index] = index
      part.setIndex(new BufferAttribute(indices, 1))
    }
    for (const attribute of Object.keys(part.attributes)) {
      if (attribute !== 'position' && attribute !== 'normal' && !preserve.includes(attribute)) part.deleteAttribute(attribute)
    }
  }
  const merged = mergeGeometries(parts, false)
  for (const part of parts) part.dispose()
  if (!merged) throw new Error('Unable to merge Streetscape presentation prop geometry')
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

type CarPoint = readonly [number, number, number]
type CarFace = readonly [CarPoint, CarPoint, CarPoint, CarPoint]

function carPanel(face: CarFace): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(face.flat(), 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.computeVertexNormals()
  return geometry
}

function carAccent(
  geometry: BufferGeometry,
  color: string,
  roughness: number,
  metalness = 0,
): BufferGeometry {
  const count = geometry.getAttribute('position').count
  const tint = new Color(color)
  const colors = new Float32BufferAttribute(new Float32Array(count * 3), 3)
  const surface = new Float32BufferAttribute(new Float32Array(count * 2), 2)
  for (let index = 0; index < count; index += 1) {
    colors.setXYZ(index, tint.r, tint.g, tint.b)
    surface.setXY(index, roughness, metalness)
  }
  geometry.setAttribute('color', colors)
  geometry.setAttribute('carSurface', surface)
  return geometry
}

function carWindow(face: CarFace, u0 = 0.07, u1 = 0.93): BufferGeometry {
  const [a, b, c, d] = face
  const normal = new Vector3().subVectors(new Vector3(...b), new Vector3(...a))
    .cross(new Vector3().subVectors(new Vector3(...d), new Vector3(...a))).normalize()
  const sample = (u: number, v: number): CarPoint => {
    const point: [number, number, number] = [0, 0, 0]
    for (let axis = 0; axis < 3; axis += 1) {
      point[axis] = (a[axis]! * (1 - u) + b[axis]! * u) * (1 - v)
        + (d[axis]! * (1 - u) + c[axis]! * u) * v + normal.getComponent(axis) * 0.006
    }
    return point
  }
  return carAccent(carPanel([
    sample(u0, 0.13), sample(u1, 0.13), sample(u1, 0.9), sample(u0, 0.9),
  ]), '#344955', 0.22)
}

/** A closed, chamfered sedan with inset glazing and wheel wells.
 * Paint is instanced separately; vertex-colored glass, rubber, metal and lamps
 * share one opaque PBR batch without textures or extra material groups. */
export function createParkedCarPresentationGeometry(): StreetscapeGeometryPair {
  const rearLeft: CarPoint = [-0.79, 0.93, -1.5]
  const rearRight: CarPoint = [0.79, 0.93, -1.5]
  const frontRight: CarPoint = [0.79, 0.93, 0.88]
  const frontLeft: CarPoint = [-0.79, 0.93, 0.88]
  const roofRearLeft: CarPoint = [-0.67, 1.52, -0.94]
  const roofRearRight: CarPoint = [0.67, 1.52, -0.94]
  const roofFrontRight: CarPoint = [0.67, 1.52, 0.28]
  const roofFrontLeft: CarPoint = [-0.67, 1.52, 0.28]
  // Each face winds outward; sharing corner normals would smear the glazing.
  const front: CarFace = [frontLeft, frontRight, roofFrontRight, roofFrontLeft]
  const rear: CarFace = [rearRight, rearLeft, roofRearLeft, roofRearRight]
  const right: CarFace = [frontRight, rearRight, roofRearRight, roofFrontRight]
  const left: CarFace = [rearLeft, frontLeft, roofFrontLeft, roofRearLeft]
  const bodyParts = [
    buildChamferedLoft([
      { x: -2.25, halfWidth: 0.8, bottom: 0.34, top: 0.84 },
      { x: -1.9, halfWidth: 0.91, bottom: 0.74, top: 0.94 },
      { x: 0.85, halfWidth: 0.91, bottom: 0.74, top: 0.94 },
      { x: 1.9, halfWidth: 0.88, bottom: 0.74, top: 0.86 },
      { x: 2.25, halfWidth: 0.79, bottom: 0.34, top: 0.76 },
    ], 0.065).rotateY(-Math.PI / 2),
    transform(new BoxGeometry(1.78, 0.4, 2.02), [0, 0.54, 0]),
    transform(new BoxGeometry(1.6, 0.28, 0.35), [0, 0.5, 2.035]),
    transform(new BoxGeometry(1.6, 0.28, 0.35), [0, 0.5, -2.035]),
    ...[front, rear, right, left,
      [roofFrontLeft, roofFrontRight, roofRearRight, roofRearLeft],
      [rearLeft, rearRight, frontRight, frontLeft],
    ].map((face) => carPanel(face as CarFace)),
  ]
  const accentParts = [
    carWindow(front), carWindow(rear),
    carWindow(right, 0.06, 0.44), carWindow(right, 0.5, 0.94),
    carWindow(left, 0.06, 0.5), carWindow(left, 0.56, 0.94),
  ]
  for (const side of [-1, 1]) {
    for (const z of [-1.42, 1.42]) {
      bodyParts.push(new RingGeometry(0.395, 0.49, 6, 1, 0, Math.PI)
        .rotateY(side * Math.PI / 2).translate(side * 0.915, 0.34, z))
      accentParts.push(carAccent(new CylinderGeometry(0.33, 0.33, 0.24, 12)
        .rotateZ(Math.PI / 2).translate(side * 0.85, 0.34, z), '#202428', 0.88))
      const rim = new CircleGeometry(0.215, 12).toNonIndexed()
        .rotateY(side * Math.PI / 2).translate(side * 0.972, 0.34, z)
      carAccent(rim, '#939da4', 0.36, 0.72)
      const rimColors = rim.getAttribute('color')
      const recess = new Color('#303b43')
      for (let vertex = 3; vertex < rimColors.count; vertex += 6) {
        for (let corner = 0; corner < 3; corner += 1) {
          rimColors.setXYZ(vertex + corner, recess.r, recess.g, recess.b)
        }
      }
      accentParts.push(rim, carAccent(new CircleGeometry(0.062, 4)
        .rotateY(side * Math.PI / 2).translate(side * 0.974, 0.34, z), '#a6aeb2', 0.38, 0.65))
    }
    const x0 = side < 0 ? -0.73 : 0.36
    const x1 = side < 0 ? -0.36 : 0.73
    accentParts.push(
      carAccent(carPanel([[x0, 0.6, 2.255], [x1, 0.6, 2.255],
        [x1, 0.7, 2.255], [x0, 0.7, 2.255]]), '#dbe2dc', 0.3),
      carAccent(carPanel([[x1, 0.64, -2.255], [x0, 0.64, -2.255],
        [x0, 0.75, -2.255], [x1, 0.75, -2.255]]), '#9c2523', 0.34),
      carAccent(transform(new BoxGeometry(0.12, 0.095, 0.18),
        [side * 0.91, 1.03, 0.57]), '#27353d', 0.4),
    )
    for (const z of [-0.63, 0.46]) {
      const a = side > 0 ? z + 0.08 : z - 0.08
      const b = side > 0 ? z - 0.08 : z + 0.08
      accentParts.push(carAccent(carPanel([[side * 0.917, 0.845, a],
        [side * 0.917, 0.845, b], [side * 0.917, 0.875, b],
        [side * 0.917, 0.875, a]]), '#4b5458', 0.45, 0.4))
    }
  }
  accentParts.push(
    carAccent(carPanel([[-0.29, 0.525, 2.256], [0.29, 0.525, 2.256],
      [0.29, 0.575, 2.256], [-0.29, 0.575, 2.256]]), '#232b30', 0.8),
    carAccent(carPanel([[-0.17, 0.41, 2.256], [0.17, 0.41, 2.256],
      [0.17, 0.49, 2.256], [-0.17, 0.49, 2.256]]), '#bcc5c4', 0.65),
    carAccent(carPanel([[0.17, 0.41, -2.256], [-0.17, 0.41, -2.256],
      [-0.17, 0.49, -2.256], [0.17, 0.49, -2.256]]), '#bcc5c4', 0.65),
  )
  return { body: mergeOwned(bodyParts), accent: mergeOwned(accentParts, ['color', 'carSurface']) }
}

type LampHousingSection = Readonly<{
  bottom: number
  halfWidth: number
  top: number
  x: number
}>

function buildChamferedLoft(
  sections: readonly LampHousingSection[],
  bevel: number,
): BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  const ringSize = 8

  for (const section of sections) {
    const corner = Math.min(
      bevel,
      section.halfWidth * 0.35,
      (section.top - section.bottom) * 0.35,
    )
    const ring = [
      [section.top - corner, -section.halfWidth],
      [section.top, -section.halfWidth + corner],
      [section.top, section.halfWidth - corner],
      [section.top - corner, section.halfWidth],
      [section.bottom + corner, section.halfWidth],
      [section.bottom, section.halfWidth - corner],
      [section.bottom, -section.halfWidth + corner],
      [section.bottom + corner, -section.halfWidth],
    ]
    for (const [y, z] of ring) positions.push(section.x, y!, z!)
  }

  for (let sectionIndex = 0; sectionIndex < sections.length - 1; sectionIndex += 1) {
    const current = sectionIndex * ringSize
    const next = current + ringSize
    for (let ringIndex = 0; ringIndex < ringSize; ringIndex += 1) {
      const following = (ringIndex + 1) % ringSize
      indices.push(
        current + ringIndex,
        next + following,
        next + ringIndex,
        current + ringIndex,
        current + following,
        next + following,
      )
    }
  }

  for (let index = 1; index < ringSize - 1; index += 1) {
    indices.push(0, index + 1, index)
    const end = (sections.length - 1) * ringSize
    indices.push(end, end + index, end + index + 1)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** Fixed 4.7 m suburban adaptation of Streetscape's roadway LED street light. */
export function createStreetLightPresentationGeometry(): StreetscapeGeometryPair {
  const height = 4.7
  const armLength = 0.95
  const poleRadius = Math.min(0.125, 0.078 + height * 0.0045)
  const armRadius = Math.max(0.052, poleRadius * 0.62)
  const poleTop = height - 0.68
  const armEndY = height - 0.2
  const fixtureLength = 1.08
  const fixtureWidth = 0.56
  const fixtureStartX = armLength + 0.04
  const socketLength = 0.28
  const socketRadius = armRadius * 1.35
  const armCurve = new CubicBezierCurve3(
    new Vector3(0, poleTop - 0.02, 0),
    new Vector3(0, poleTop + 0.34, 0),
    new Vector3(armLength * 0.24, armEndY, 0),
    new Vector3(armLength, armEndY, 0),
  )
  const housingSections = [
    { x: -0.12, top: 0.075, bottom: -0.045, halfWidth: fixtureWidth * 0.23 },
    { x: 0.07, top: 0.165, bottom: -0.12, halfWidth: fixtureWidth * 0.42 },
    { x: fixtureLength * 0.3, top: 0.13, bottom: -0.1, halfWidth: fixtureWidth * 0.5 },
    { x: fixtureLength * 0.86, top: 0.07, bottom: -0.075, halfWidth: fixtureWidth * 0.48 },
    { x: fixtureLength, top: 0.025, bottom: -0.055, halfWidth: fixtureWidth * 0.36 },
  ] as const
  const body = mergeOwned([
    transform(new CylinderGeometry(0.25 * 0.88, 0.25, 0.08, 20), [0, 0.04, 0]),
    transform(new CylinderGeometry(0.135, 0.18, 0.36, 16), [0, 0.22, 0]),
    transform(new CylinderGeometry(armRadius, poleRadius, poleTop, 16), [0, poleTop / 2, 0]),
    new TubeGeometry(armCurve, 28, armRadius, 10, false),
    transform(new CylinderGeometry(armRadius * 1.08, armRadius * 1.22, 0.28, 14), [0, poleTop - 0.08, 0]),
    transform(
      new CylinderGeometry(socketRadius * 1.3, armRadius, socketLength, 14),
      [armLength, armEndY, 0],
      -Math.PI / 2,
    ),
    transform(buildChamferedLoft(housingSections, 0.025), [fixtureStartX, armEndY, 0]),
  ])
  const accent = transform(buildChamferedLoft([
    { x: fixtureLength * 0.34, top: -0.106, bottom: -0.132, halfWidth: fixtureWidth * 0.34 },
    { x: fixtureLength * 0.4, top: -0.108, bottom: -0.137, halfWidth: fixtureWidth * 0.38 },
    { x: fixtureLength * 0.86, top: -0.078, bottom: -0.108, halfWidth: fixtureWidth * 0.34 },
    { x: fixtureLength * 0.92, top: -0.072, bottom: -0.098, halfWidth: fixtureWidth * 0.28 },
  ], 0.01), [fixtureStartX, armEndY, 0])

  accent.computeBoundingBox()
  accent.computeBoundingSphere()
  return { accent, body }
}

function buildMailboxProfileGeometry(
  width: number,
  height: number,
  length: number,
): BufferGeometry {
  const roofRadius = width / 2
  const shoulderY = Math.max(height * 0.36, height - roofRadius)
  const profile: Array<readonly [number, number]> = [[-width / 2, 0]]
  const roofSegments = 6
  for (let index = 0; index <= roofSegments; index += 1) {
    const angle = Math.PI - Math.PI * index / roofSegments
    profile.push([
      Math.cos(angle) * roofRadius,
      shoulderY + Math.sin(angle) * roofRadius,
    ])
  }
  profile.push([width / 2, 0])

  const positions: number[] = []
  for (const z of [length / 2, -length / 2]) {
    for (const [x, y] of profile) positions.push(x, y, z)
  }
  const indices: number[] = []
  const back = profile.length
  for (let index = 1; index < profile.length - 1; index += 1) {
    indices.push(0, index + 1, index)
    indices.push(back, back + index, back + index + 1)
  }
  for (let index = 0; index < profile.length; index += 1) {
    const next = (index + 1) % profile.length
    indices.push(
      index, next, back + next,
      index, back + next, back + index,
    )
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** Streetscape's black arched curbside mailbox, closed and with its red flag raised. */
export function createMailboxPresentationGeometry(): StreetscapeGeometryPair {
  const width = 0.4
  const length = 0.5
  const height = 1.65
  const bodyHeight = Math.min(height * 0.31, width * 0.88)
  const bodyBottom = height - bodyHeight
  const postRadius = Math.max(0.027, width * 0.065)
  const panelWidth = width * 0.91
  const panelHeight = bodyHeight * 0.91
  const body = mergeOwned([
    transform(new CylinderGeometry(postRadius, postRadius * 1.04, bodyBottom, 8), [0, bodyBottom / 2, 0]),
    transform(new CylinderGeometry(postRadius * 1.45, postRadius * 1.45, 0.07, 8), [0, bodyBottom - 0.035, 0]),
    transform(
      buildMailboxProfileGeometry(width, bodyHeight, length),
      [0, bodyBottom, 0],
    ),
    transform(
      buildMailboxProfileGeometry(panelWidth, panelHeight, 0.012),
      [0, bodyBottom + bodyHeight * 0.045, length / 2 + 0.006],
    ),
    transform(
      buildMailboxProfileGeometry(panelWidth, panelHeight, 0.012),
      [0, bodyBottom + bodyHeight * 0.045, -length / 2 - 0.012],
    ),
    transform(new BoxGeometry(width * 0.38, bodyHeight * 0.045, 0.035), [0, bodyBottom + bodyHeight * 0.625, -length / 2 - 0.046]),
  ])

  const flagX = width / 2 + 0.014
  const pivotY = bodyBottom + bodyHeight * 0.45
  const flagTop = height + bodyHeight * 0.34
  const flagArmHeight = flagTop - pivotY
  const accent = mergeOwned([
    transform(new CylinderGeometry(bodyHeight * 0.055, bodyHeight * 0.055, 0.035, 8), [flagX, pivotY, -length * 0.28], Math.PI / 2),
    transform(new BoxGeometry(0.025, flagArmHeight, 0.025), [flagX, pivotY + flagArmHeight / 2, -length * 0.28]),
    transform(new BoxGeometry(0.027, bodyHeight * 0.15, length * 0.22), [flagX, flagTop - bodyHeight * 0.05, -length * 0.21]),
  ])
  return { accent, body }
}

/**
 * Reduces Streetscape's timber driveway-gate board/rail/stile language to one
 * instanced rectangular primitive. Dimensions are local to the fence run.
 */
export function buildFencePresentationMembers(
  style: FencePresentationStyle,
  length: number,
  height: number,
): FencePresentationMember[] {
  const members: FencePresentationMember[] = []
  const depth = style === 'rail' ? 0.065 : style === 'slat' ? 0.075 : 0.09
  const postWidth = Math.min(0.16, Math.max(0.1, length * 0.018))
  const frameWidth = Math.min(0.12, Math.max(0.075, height * 0.075))
  const postCount = Math.max(2, Math.ceil(length / 2.35) + 1)

  for (let index = 0; index < postCount; index += 1) {
    const x = -length / 2 + length * index / (postCount - 1)
    members.push({ depth: depth * 1.8, height, width: postWidth, x, y: height / 2 })
  }

  if (style === 'rail') {
    for (const y of [height * 0.34, height * 0.76]) {
      members.push({ depth, height: frameWidth, width: length, x: 0, y })
    }
    return members
  }

  if (style === 'horizontal') {
    const boardCount = Math.max(4, Math.floor(height / 0.2))
    const boardHeight = Math.min(0.16, height * 0.13)
    for (let index = 0; index < boardCount; index += 1) {
      const y = height * 0.16 + index * (height * 0.7 / (boardCount - 1))
      members.push({ depth, height: boardHeight, width: length, x: 0, y })
    }
    return members
  }

  for (const y of [height * 0.24, height * 0.7]) {
    members.push({ depth, height: frameWidth, width: length, x: 0, y })
  }
  const slatSpacing = 0.24
  const slatCount = Math.max(2, Math.floor(length / slatSpacing) + 1)
  const slatWidth = Math.min(0.14, length / slatCount * 0.62)
  for (let index = 0; index < slatCount; index += 1) {
    const x = -length / 2 + length * index / (slatCount - 1)
    members.push({ depth: depth * 0.72, height: height * 0.84, width: slatWidth, x, y: height * 0.5 })
  }
  return members
}
