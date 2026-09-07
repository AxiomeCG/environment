import { Color, Vector3 } from 'three'
import * as TSL from 'three/tsl'
import type { Node } from 'three/webgpu'

import { getActiveSolarUniforms } from '../../atmosphere/active-solar'
import { grassWindBend } from '../../wind-node'
import { MAX_GRASS_NORMAL_YAW } from './blade-shape'

type GrassBladePositionOptions = {
  readonly heightScale: Node<'float'>
  readonly restBend: Node<'float'>
  readonly windInfluence: Node<'float'>
  readonly obstacleInfluence?: Node<'float'>
  readonly obstacleDirection?: Node<'vec3'>
  readonly obstacleBendStrength?: Node<'float'>
}

export type GrassBladeShading = {
  readonly normal: Node<'vec3'>
  readonly transmission: Node<'vec3'>
  readonly rootShade: Node<'float'>
}

export const GRASS_BLADE_PROGRESS = TSL.clamp(TSL.positionGeometry.y, 0, 1)

export function createGrassBladePosition(
  options: GrassBladePositionOptions,
): Node<'vec3'> {
  const grassRoot = TSL.attribute<'vec3'>('grassRoot', 'vec3')
  const surfaceSampleBasis = TSL.attribute<'vec2'>(
    'grassSurfaceSampleBasis',
    'vec2',
  )
  const rootRelativePosition = TSL.positionLocal.sub(grassRoot)
  const straightHeight = rootRelativePosition.y.mul(options.heightScale)
  const restBendDirection = TSL.normalize(
    TSL.vec3(surfaceSampleBasis.y.add(1e-6), 0, surfaceSampleBasis.x),
  )

  const windBend = grassWindBend(grassRoot, options.windInfluence).mul(2)
  const obstacleInfluence = options.obstacleInfluence
  const effectiveWindBend = obstacleInfluence
    ? windBend.mul(TSL.sub(1, obstacleInfluence.mul(0.75)))
    : windBend
  const bendVector = restBendDirection
    .mul(options.restBend)
    .add(effectiveWindBend)
  const bendAngle = TSL.length(bendVector)
  const bendDirection = bendVector.div(TSL.max(bendAngle, 1e-5))
  const vertexBendAngle = bendAngle.mul(GRASS_BLADE_PROGRESS)
  const safeVertexBendAngle = TSL.max(vertexBendAngle, 1e-5)
  const curvedHorizontal = straightHeight.mul(
    TSL.sub(1, TSL.cos(vertexBendAngle)).div(safeVertexBendAngle),
  )
  const curvedHeight = TSL.mix(
    straightHeight,
    straightHeight.mul(TSL.sin(vertexBendAngle).div(safeVertexBendAngle)),
    TSL.step(1e-5, bendAngle),
  )

  const obstacleOffset = obstacleInfluence
    ? (options.obstacleDirection ?? TSL.vec3(0, 0, 0))
        .mul(options.obstacleBendStrength ?? TSL.float(0))
        .mul(obstacleInfluence)
        .mul(GRASS_BLADE_PROGRESS.mul(GRASS_BLADE_PROGRESS))
        .mul(TSL.clamp(options.heightScale, 0, 1))
    : TSL.vec3(0, 0, 0)

  return grassRoot.add(
    TSL.vec3(
      rootRelativePosition.x
        .add(bendDirection.x.mul(curvedHorizontal))
        .add(obstacleOffset.x),
      curvedHeight,
      rootRelativePosition.z
        .add(bendDirection.z.mul(curvedHorizontal))
        .add(obstacleOffset.z),
    ),
  )
}

export function createGrassBladeShading(
  tintRandom: Node<'float'>,
): GrassBladeShading {
  const solarDirectionUniform = TSL.uniform(new Vector3(0, 1, 0)).onRenderUpdate(
    ({ scene }) =>
      scene ? getActiveSolarUniforms(scene).direction.value : undefined,
  )
  const solarColor = TSL.uniform(new Color(1, 1, 1)).onRenderUpdate(
    ({ scene }) => (scene ? getActiveSolarUniforms(scene).color.value : undefined),
  )
  const solarIntensity = TSL.uniform(0).onRenderUpdate(({ scene }) =>
    scene ? getActiveSolarUniforms(scene).intensity.value : 0,
  )

  const normalVariationAngle = tintRandom.mul(MAX_GRASS_NORMAL_YAW)
  const normalVariationCos = TSL.cos(normalVariationAngle)
  const normalVariationSin = TSL.sin(normalVariationAngle)
  const variedNormalWorld = TSL.normalize(
    TSL.vec3(
      TSL.normalWorldGeometry.x
        .mul(normalVariationCos)
        .sub(TSL.normalWorldGeometry.z.mul(normalVariationSin)),
      TSL.abs(TSL.normalWorldGeometry.y).mul(0.2).add(0.85),
      TSL.normalWorldGeometry.x
        .mul(normalVariationSin)
        .add(TSL.normalWorldGeometry.z.mul(normalVariationCos)),
    ),
  )

  const solarDirection = TSL.normalize(solarDirectionUniform)
  const bladeFacingSun = TSL.abs(TSL.dot(variedNormalWorld, solarDirection))
  const edgeFactor = TSL.sub(1, bladeFacingSun)
  const viewDirection = TSL.normalize(TSL.sub(TSL.cameraPosition, TSL.positionWorld))
  const lookingTowardSun = TSL.max(
    TSL.dot(viewDirection.negate(), solarDirection),
    0,
  )
  const backFactor = TSL.pow(lookingTowardSun, 6.4)
  const tipBiasedTransmission = TSL.mul(
    TSL.mul(edgeFactor, backFactor),
    TSL.smoothstep(0.15, 1, GRASS_BLADE_PROGRESS),
  )
  const restrainedSolarIntensity = TSL.clamp(solarIntensity.mul(0.25), 0, 1)

  return {
    normal: TSL.transformDirection(variedNormalWorld, TSL.cameraViewMatrix),
    transmission: solarColor
      .mul(tipBiasedTransmission)
      .mul(restrainedSolarIntensity)
      .mul(0.3),
    rootShade: TSL.mix(0.78, 1, TSL.pow(GRASS_BLADE_PROGRESS, 0.65)),
  }
}
