import type { GeometryContext } from '@pascal-app/core'
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import {
  createSurfaceExportSampler,
  type SurfaceExportSample,
  type SurfaceExportSampler,
} from '../surface-material/export-sampler'
import { resolveGroundCoverFields, type GroundCoverFields } from './field-context'
import { collectFlowerPlacements } from './flower-scatter'
import { localGrassHeightScaleAt } from './height-field'
import { sampleGrassObstacle } from './obstacle-field'
import { sampleGrassPaintTexture, type GrassPaintTextureSample } from './paint-texture'
import { buildBladeGeometry } from './render/blade-geometry'
import {
  evaluateGrassBladeCurve,
  MAX_GRASS_NORMAL_YAW,
  shapeGrassCoverageValue,
  type GrassBladeCurvePoint,
} from './render/blade-shape'
import { createBakedFlowerBatches } from './render/flower-geometry'
import { visitGrassCandidates } from './scatter'
import type { GrassFieldNode } from './schema'

const MAX_CHUNK_VERTEX_COUNT = 65_535
const MAX_TINT_ROTATION = Math.PI / 6
const PERIPHERAL_TIP_BASE_MIX = 0.3
const SURFACE_ROOT_BLEND_END = 0.35
const SURFACE_GROUND_TEXTURE_MIX = 0.25
const SURFACE_EDGE_TEXTURE_MIX = 0.6

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
  paintAlpha: number
  red: number
  green: number
  blue: number
  variedRed: number
  variedGreen: number
  variedBlue: number
  tipRed: number
  tipGreen: number
  tipBlue: number
}

export function buildGrassFieldBakeGeometry(node: GrassFieldNode, context: GeometryContext): Group {
  const group = new Group()
  group.name = 'grass-field-static'
  const fields = resolveGroundCoverFields(node, context)
  return fields ? buildResolvedGrassFieldBakeGeometry(node, fields, null, group) : group
}

export async function buildGrassFieldBakeGeometryAsync(
  node: GrassFieldNode,
  context: GeometryContext,
): Promise<Group> {
  const group = new Group()
  group.name = 'grass-field-static'
  const fields = resolveGroundCoverFields(node, context)
  if (!fields) return group

  const surfaceSampler = await createSurfaceExportSampler(context)
  try {
    return buildResolvedGrassFieldBakeGeometry(node, fields, surfaceSampler, group)
  } finally {
    surfaceSampler?.dispose()
  }
}

function buildResolvedGrassFieldBakeGeometry(
  node: GrassFieldNode,
  fields: GroundCoverFields,
  surfaceSampler: SurfaceExportSampler | null,
  group: Group,
): Group {
  const flowerPlacements = collectFlowerPlacements(node, fields)
  const paintSample: GrassPaintTextureSample = {
    red: 0,
    green: 0,
    blue: 0,
    alpha: 0,
  }
  const evaluation = emptyAcceptedSample()
  let acceptedCount = 0
  visitGrassCandidates(
    node,
    fields.boundary,
    fields.bounds,
    fields.terrain,
    (x, _y, z, _yaw, _width, heightFactor, threshold) => {
      if (
        evaluateCandidate(node, fields, x, z, threshold, evaluation, paintSample, false) &&
        resolvedBladeHeight(node, heightFactor, evaluation) > 0
      ) {
        acceptedCount += 1
      }
    },
  )
  if (acceptedCount === 0) {
    if (flowerPlacements.length > 0) {
      group.add(createBakedFlowerBatches(flowerPlacements))
    }
    return group
  }

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
    const bladeCount = Math.min(bladesPerChunk, acceptedCount - chunkIndex * bladesPerChunk)
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
      chunkIndex === 0 ? 'grass-field-static-blades' : `grass-field-static-blades-${chunkIndex + 1}`
    group.add(blades)
    chunks.push({ colors, geometry, normals, positions })
  }

  const up = new Vector3(0, 1, 0)
  const yawRotation = new Quaternion()
  const normalVariationRotation = new Quaternion()
  const transformedNormal = new Vector3()
  const restCurve: GrassBladeCurvePoint = { horizontal: 0, vertical: 0 }
  const surfaceSample: SurfaceExportSample = {
    r: 0,
    g: 0,
    b: 0,
    coverage: 0,
  }
  let acceptedIndex = 0

  try {
    visitGrassCandidates(
      node,
      fields.boundary,
      fields.bounds,
      fields.terrain,
      (x, y, z, yaw, widthFactor, heightFactor, threshold, tint) => {
        if (!evaluateCandidate(node, fields, x, z, threshold, evaluation, paintSample, true)) {
          return
        }

        const bladeHeight = resolvedBladeHeight(node, heightFactor, evaluation)
        if (bladeHeight <= 0) return

        resolveBladeIntrinsicColors(node, tint, evaluation)
        yawRotation.setFromAxisAngle(up, yaw)
        normalVariationRotation.setFromAxisAngle(up, -tint * MAX_GRASS_NORMAL_YAW)
        const width = node.bladeWidth * widthFactor
        const widthCosine = Math.cos(yaw) * width
        const widthSine = Math.sin(yaw) * width
        const restDirectionX = widthSine + 1e-6
        const restDirectionZ = widthCosine
        const restDirectionLength = Math.hypot(restDirectionX, restDirectionZ)
        const normalizedRestDirectionX = restDirectionX / restDirectionLength
        const normalizedRestDirectionZ = restDirectionZ / restDirectionLength
        const obstacleOffset =
          (node.obstacleBendStrength ?? 0.12) *
          evaluation.obstacleInfluence *
          clamp01(resolvedBladeHeightScale(node, evaluation))

        const chunkIndex = Math.floor(acceptedIndex / bladesPerChunk)
        const bladeIndex = acceptedIndex - chunkIndex * bladesPerChunk
        const vertexOffset = bladeIndex * verticesPerBlade
        const chunk = chunks[chunkIndex]!

        for (let vertexIndex = 0; vertexIndex < verticesPerBlade; vertexIndex += 1) {
          const outputOffset = (vertexOffset + vertexIndex) * 3
          const sourceX = bladePositions.getX(vertexIndex)
          const sourceY = bladePositions.getY(vertexIndex)
          const sourceZ = bladePositions.getZ(vertexIndex)
          const bladeProgress = clamp01(sourceY)
          const rotatedSourceX = sourceX * widthCosine + sourceZ * widthSine
          const rotatedSourceZ = sourceZ * widthCosine - sourceX * widthSine
          evaluateGrassBladeCurve(
            bladeProgress,
            bladeHeight * bladeProgress,
            node.bladeRestBend ?? 0.22,
            restCurve,
          )
          const contactHeightMask = bladeProgress * bladeProgress
          chunk.positions[outputOffset] =
            x +
            rotatedSourceX +
            normalizedRestDirectionX * restCurve.horizontal +
            evaluation.obstacleDirectionX * obstacleOffset * contactHeightMask
          chunk.positions[outputOffset + 1] = y + restCurve.vertical
          chunk.positions[outputOffset + 2] =
            z +
            rotatedSourceZ +
            normalizedRestDirectionZ * restCurve.horizontal +
            evaluation.obstacleDirectionZ * obstacleOffset * contactHeightMask

          transformedNormal
            .fromBufferAttribute(bladeNormals, vertexIndex)
            .applyQuaternion(yawRotation)
            .applyQuaternion(normalVariationRotation)
          transformedNormal.y = Math.abs(transformedNormal.y) * 0.2 + 0.85
          transformedNormal.normalize().toArray(chunk.normals, outputOffset)

          const groundRootBlend = 1 - smoothstep(0, SURFACE_ROOT_BLEND_END, bladeProgress)
          let groundRed = evaluation.red
          let groundGreen = evaluation.green
          let groundBlue = evaluation.blue
          if (surfaceSampler && groundRootBlend > 0) {
            surfaceSampler.sample(x + rotatedSourceX, z + rotatedSourceZ, surfaceSample)
            const surfaceWeight =
              surfaceSample.coverage *
              mix(SURFACE_EDGE_TEXTURE_MIX, SURFACE_GROUND_TEXTURE_MIX, evaluation.density)
            groundRed = mix(groundRed, surfaceSample.r, surfaceWeight)
            groundGreen = mix(groundGreen, surfaceSample.g, surfaceWeight)
            groundBlue = mix(groundBlue, surfaceSample.b, surfaceWeight)
          }

          const gradientFactor = smoothstep(0.2, 0.85, bladeProgress)
          const rootShade = mix(0.78, 1, bladeProgress ** 0.65)
          chunk.colors[outputOffset] = mix(
            mix(evaluation.variedRed, evaluation.tipRed, gradientFactor) * rootShade,
            groundRed,
            groundRootBlend,
          )
          chunk.colors[outputOffset + 1] = mix(
            mix(evaluation.variedGreen, evaluation.tipGreen, gradientFactor) * rootShade,
            groundGreen,
            groundRootBlend,
          )
          chunk.colors[outputOffset + 2] = mix(
            mix(evaluation.variedBlue, evaluation.tipBlue, gradientFactor) * rootShade,
            groundBlue,
            groundRootBlend,
          )
        }
        acceptedIndex += 1
      },
    )

    if (acceptedIndex !== acceptedCount) {
      throw new Error(
        `Ground Cover bake candidate count changed from ${acceptedCount} to ${acceptedIndex}`,
      )
    }
  } catch (error) {
    for (const chunk of chunks) chunk.geometry.dispose()
    material.dispose()
    throw error
  } finally {
    bladeGeometry.dispose()
  }

  for (const chunk of chunks) {
    chunk.geometry.computeBoundingBox()
    chunk.geometry.computeBoundingSphere()
  }
  if (flowerPlacements.length > 0) {
    group.add(createBakedFlowerBatches(flowerPlacements))
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
  paintSample: GrassPaintTextureSample,
  includeColor: boolean,
): boolean {
  sampleGrassPaintTexture(fields.paint, x, z, paintSample)
  const density = shapeGrassCoverageValue(paintSample.alpha * ((node.density ?? 100) / 100))
  if (density <= 0 || threshold > density) return false

  const obstacle = sampleGrassObstacle(fields.obstacles, x, z)
  if (obstacle.allowed < 0.5) return false

  const bendRadius = node.obstacleBendRadius ?? 0.75
  output.density = density
  output.localHeightScale = localGrassHeightScaleAt(fields.height, x, z)
  output.obstacleInfluence =
    bendRadius > 0 ? 1 - smoothstep(0, Math.max(bendRadius, 0.001), obstacle.distance) : 0
  const directionLength = Math.hypot(obstacle.directionX, obstacle.directionZ)
  output.obstacleDirectionX = directionLength > 1e-6 ? obstacle.directionX / directionLength : 0
  output.obstacleDirectionZ = directionLength > 1e-6 ? obstacle.directionZ / directionLength : 0

  if (includeColor) {
    const unpremultiply = 1 / Math.max(paintSample.alpha, 1 / 255)
    output.paintAlpha = paintSample.alpha
    output.red = paintSample.red * unpremultiply
    output.green = paintSample.green * unpremultiply
    output.blue = paintSample.blue * unpremultiply
  }
  return true
}

function resolvedBladeHeight(
  node: GrassFieldNode,
  heightFactor: number,
  sample: AcceptedGrassSample,
): number {
  return node.bladeHeight * heightFactor * resolvedBladeHeightScale(node, sample)
}

function resolvedBladeHeightScale(node: GrassFieldNode, sample: AcceptedGrassSample): number {
  const densityScale = sample.density * sample.density
  const flattening = clamp01(
    1 - sample.obstacleInfluence * clamp01((node.obstacleFlattening ?? 60) / 100),
  )
  return Math.max(0, sample.localHeightScale * densityScale * flattening)
}

function resolveBladeIntrinsicColors(
  node: GrassFieldNode,
  tint: number,
  output: AcceptedGrassSample,
): void {
  const tintAngle = tint * ((node.bladeTintVariation ?? 20) / 100) * MAX_TINT_ROTATION
  const hueCosine = Math.cos(tintAngle)
  const hueSine = Math.sin(tintAngle)
  const red = output.red
  const green = output.green
  const blue = output.blue
  output.variedRed = clamp01(
    red * (hueCosine * 0.787 - hueSine * 0.213 + 0.213) +
      green * (hueCosine * -0.715 + hueSine * -0.715 + 0.715) +
      blue * (hueCosine * -0.072 + hueSine * 0.928 + 0.072),
  )
  output.variedGreen = clamp01(
    red * (hueCosine * -0.213 + hueSine * 0.143 + 0.213) +
      green * (hueCosine * 0.285 + hueSine * 0.14 + 0.715) +
      blue * (hueCosine * -0.072 + hueSine * -0.283 + 0.072),
  )
  output.variedBlue = clamp01(
    red * (hueCosine * -0.213 + hueSine * -0.787 + 0.213) +
      green * (hueCosine * -0.715 + hueSine * 0.715 + 0.715) +
      blue * (hueCosine * 0.928 + hueSine * 0.072 + 0.072),
  )

  const peripheralBaseMix = (1 - output.paintAlpha) * PERIPHERAL_TIP_BASE_MIX
  const tipScale = mix((node.bladeTipBrightness ?? 300) / 100, 1, peripheralBaseMix)
  output.tipRed = output.variedRed * tipScale
  output.tipGreen = output.variedGreen * tipScale
  output.tipBlue = output.variedBlue * tipScale
}

function emptyAcceptedSample(): AcceptedGrassSample {
  return {
    density: 0,
    localHeightScale: 1,
    obstacleInfluence: 0,
    obstacleDirectionX: 0,
    obstacleDirectionZ: 0,
    paintAlpha: 0,
    red: 0,
    green: 0,
    blue: 0,
    variedRed: 0,
    variedGreen: 0,
    variedBlue: 0,
    tipRed: 0,
    tipGreen: 0,
    tipBlue: 0,
  }
}

function mix(start: number, end: number, amount: number): number {
  return start + (end - start) * amount
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1
  const amount = clamp01((value - edge0) / (edge1 - edge0))
  return amount * amount * (3 - 2 * amount)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
}
