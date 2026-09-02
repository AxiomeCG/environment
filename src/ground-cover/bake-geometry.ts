import type { GeometryContext } from '@pascal-app/core'
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Matrix3,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { resolveGroundCoverFields, type GroundCoverFields } from './field-context'
import { localGrassHeightScaleAt } from './height-field'
import { sampleGrassObstacle } from './obstacle-field'
import { paintAt } from './paint-field'
import { buildBladeGeometry } from './render/blade-geometry'
import { visitGrassCandidates } from './scatter'
import type { GrassFieldNode } from './schema'

const MAX_CHUNK_VERTEX_COUNT = 65_535

type BakedGrassChunk = {
  colors: Float32Array
  geometry: BufferGeometry
  normals: Float32Array
  positions: Float32Array
}

type AcceptedGrassSample = {
  density: number
  localHeightScale: number
  obstacleInfluence: number
  obstacleDirectionX: number
  obstacleDirectionZ: number
  red: number
  green: number
  blue: number
}

export function buildGrassFieldBakeGeometry(
  node: GrassFieldNode,
  context: GeometryContext,
): Group {
  const group = new Group()
  group.name = 'grass-field-static'
  const fields = resolveGroundCoverFields(node, context)
  if (!fields) return group

  const evaluation = emptyAcceptedSample()
  let acceptedCount = 0
  visitGrassCandidates(
    node,
    fields.boundary,
    fields.bounds,
    fields.terrain,
    (x, _y, z, _yaw, _width, heightFactor, threshold) => {
      if (
        evaluateCandidate(node, fields, x, z, threshold, evaluation, false) &&
        resolvedBladeHeight(node, heightFactor, evaluation) > 0
      ) {
        acceptedCount += 1
      }
    },
  )
  if (acceptedCount === 0) return group

  const bladeGeometry = buildBladeGeometry({
    width: node.bladeWidth,
    height: node.bladeHeight,
  })
  const bladePositions = bladeGeometry.getAttribute('position')
  const bladeNormals = bladeGeometry.getAttribute('normal')
  const bladeIndices = bladeGeometry.getIndex()
  if (!bladeIndices) {
    bladeGeometry.dispose()
    throw new Error('Ground Cover blade geometry must be indexed')
  }

  const verticesPerBlade = bladePositions.count
  const indicesPerBlade = bladeIndices.count
  const bladesPerChunk = Math.floor(MAX_CHUNK_VERTEX_COUNT / verticesPerBlade)
  const chunkCount = Math.ceil(acceptedCount / bladesPerChunk)
  const material = new MeshStandardMaterial({
    color: '#ffffff',
    metalness: 0,
    roughness: 1,
    side: DoubleSide,
    vertexColors: true,
  })
  const chunks: BakedGrassChunk[] = []

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const bladeCount = Math.min(
      bladesPerChunk,
      acceptedCount - chunkIndex * bladesPerChunk,
    )
    const positions = new Float32Array(bladeCount * verticesPerBlade * 3)
    const normals = new Float32Array(bladeCount * verticesPerBlade * 3)
    const colors = new Float32Array(bladeCount * verticesPerBlade * 3)
    const indices = new Uint16Array(bladeCount * indicesPerBlade)

    for (let bladeIndex = 0; bladeIndex < bladeCount; bladeIndex += 1) {
      const vertexOffset = bladeIndex * verticesPerBlade
      const indexOffset = bladeIndex * indicesPerBlade
      for (let index = 0; index < indicesPerBlade; index += 1) {
        indices[indexOffset + index] = bladeIndices.getX(index) + vertexOffset
      }
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new BufferAttribute(normals, 3))
    geometry.setAttribute('color', new BufferAttribute(colors, 3))
    geometry.setIndex(new BufferAttribute(indices, 1))
    const blades = new Mesh(geometry, material)
    blades.name =
      chunkIndex === 0
        ? 'grass-field-static-blades'
        : `grass-field-static-blades-${chunkIndex + 1}`
    group.add(blades)
    chunks.push({ colors, geometry, normals, positions })
  }

  const matrix = new Matrix4()
  const normalMatrix = new Matrix3()
  const position = new Vector3()
  const scale = new Vector3()
  const up = new Vector3(0, 1, 0)
  const yawRotation = new Quaternion()
  const bendRotation = new Quaternion()
  const rotation = new Quaternion()
  const bentUp = new Vector3()
  const transformedPosition = new Vector3()
  const transformedNormal = new Vector3()
  let acceptedIndex = 0

  visitGrassCandidates(
    node,
    fields.boundary,
    fields.bounds,
    fields.terrain,
    (x, y, z, yaw, widthFactor, heightFactor, threshold) => {
      if (!evaluateCandidate(node, fields, x, z, threshold, evaluation, true)) return

      const bladeHeight = resolvedBladeHeight(node, heightFactor, evaluation)
      if (bladeHeight <= 0) return

      yawRotation.setFromAxisAngle(up, yaw)
      const bendOffset = (node.obstacleBendStrength ?? 0.12) * evaluation.obstacleInfluence
      if (bendOffset > 0) {
        bentUp
          .set(
            evaluation.obstacleDirectionX * bendOffset,
            bladeHeight,
            evaluation.obstacleDirectionZ * bendOffset,
          )
          .normalize()
        bendRotation.setFromUnitVectors(up, bentUp)
        rotation.copy(bendRotation).multiply(yawRotation)
      } else {
        rotation.copy(yawRotation)
      }

      position.set(x, y, z)
      scale.set(node.bladeWidth * widthFactor, bladeHeight, 1)
      matrix.compose(position, rotation, scale)
      normalMatrix.getNormalMatrix(matrix)

      const chunkIndex = Math.floor(acceptedIndex / bladesPerChunk)
      const bladeIndex = acceptedIndex - chunkIndex * bladesPerChunk
      const vertexOffset = bladeIndex * verticesPerBlade
      const chunk = chunks[chunkIndex]!
      const red = evaluation.red
      const green = evaluation.green
      const blue = evaluation.blue

      for (let vertexIndex = 0; vertexIndex < verticesPerBlade; vertexIndex += 1) {
        const outputOffset = (vertexOffset + vertexIndex) * 3
        transformedPosition
          .fromBufferAttribute(bladePositions, vertexIndex)
          .applyMatrix4(matrix)
          .toArray(chunk.positions, outputOffset)
        transformedNormal
          .fromBufferAttribute(bladeNormals, vertexIndex)
          .applyNormalMatrix(normalMatrix)
          .toArray(chunk.normals, outputOffset)
        chunk.colors[outputOffset] = red
        chunk.colors[outputOffset + 1] = green
        chunk.colors[outputOffset + 2] = blue
      }
      acceptedIndex += 1
    },
  )

  bladeGeometry.dispose()
  if (acceptedIndex !== acceptedCount) {
    throw new Error(
      `Ground Cover bake candidate count changed from ${acceptedCount} to ${acceptedIndex}`,
    )
  }
  for (const chunk of chunks) {
    chunk.geometry.computeBoundingBox()
    chunk.geometry.computeBoundingSphere()
  }
  return group
}

function evaluateCandidate(
  node: GrassFieldNode,
  fields: GroundCoverFields,
  x: number,
  z: number,
  threshold: number,
  output: AcceptedGrassSample,
  includeColor: boolean,
): boolean {
  const painted = paintAt(fields.paint, x, z)
  const density = clamp01(painted.a * ((node.density ?? 100) / 100))
  if (density <= 0 || threshold > density) return false

  const obstacle = sampleGrassObstacle(fields.obstacles, x, z)
  if (obstacle.allowed < 0.5) return false

  const bendRadius = node.obstacleBendRadius ?? 0.75
  output.density = density
  output.localHeightScale = localGrassHeightScaleAt(fields.height, x, z)
  output.obstacleInfluence =
    bendRadius > 0
      ? 1 - smoothstep(0, Math.max(bendRadius, 0.001), obstacle.distance)
      : 0
  const directionLength = Math.hypot(obstacle.directionX, obstacle.directionZ)
  output.obstacleDirectionX =
    directionLength > 1e-6 ? obstacle.directionX / directionLength : 0
  output.obstacleDirectionZ =
    directionLength > 1e-6 ? obstacle.directionZ / directionLength : 0

  if (includeColor) {
    output.red = srgbToLinear(painted.r)
    output.green = srgbToLinear(painted.g)
    output.blue = srgbToLinear(painted.b)
  }
  return true
}

function resolvedBladeHeight(
  node: GrassFieldNode,
  heightFactor: number,
  sample: AcceptedGrassSample,
): number {
  const heightScale = sample.density * sample.density
  const flattening =
    1 - sample.obstacleInfluence * ((node.obstacleFlattening ?? 60) / 100)
  return (
    node.bladeHeight *
    heightFactor *
    sample.localHeightScale *
    heightScale *
    flattening
  )
}


function srgbToLinear(value: number): number {
  const channel = clamp01(value)
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4
}


function emptyAcceptedSample(): AcceptedGrassSample {
  return {
    density: 0,
    localHeightScale: 1,
    obstacleInfluence: 0,
    obstacleDirectionX: 0,
    obstacleDirectionZ: 0,
    red: 0,
    green: 0,
    blue: 0,
  }
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1
  const amount = clamp01((value - edge0) / (edge1 - edge0))
  return amount * amount * (3 - 2 * amount)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
}
