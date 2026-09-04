import * as TSL from 'three/tsl'
import type { Node } from 'three/webgpu'

export const GLOBAL_WIND_STRENGTH = TSL.uniform(1)

export function setGlobalWindStrength(strength: number): void {
  GLOBAL_WIND_STRENGTH.value = Math.max(0, strength)
}

export const PLANT_WIND_FREQUENCY = 1.3
export const PLANT_WIND_STRENGTH = 0.05

const WIND_DIRECTION_WORLD = TSL.normalize(TSL.vec2(0.8, 0.6))

/** Shared GPU grass motion. Positions are mesh-local after instancing in r185.
 * Callers supply root-relative height for elevated presentation vegetation. */
export function grassWindPosition(
  localPosition: Node<'vec3'>,
  height: Node<'float'>,
  heightMask: Node<'float'>,
  influence: Node<'float'>,
): Node<'vec3'> {
  // Wave composition adapted from Cortiz Dev's MIT grass-field reference:
  // https://github.com/cortiz2894/stylized-components
  return TSL.Fn(() => {
    const displacedPosition = localPosition.toVar()
    const windTime = TSL.time.mul(PLANT_WIND_FREQUENCY)
    const worldPosition = TSL.modelWorldMatrix.mul(displacedPosition).xyz
    const alongWind = TSL.dot(worldPosition.xz, WIND_DIRECTION_WORLD)
    const primaryWave = TSL.sin(alongWind.mul(0.8).add(windTime))
    const secondaryWave = TSL.sin(alongWind.mul(0.8 * 2.6).add(windTime.mul(1.8)).add(1.3)).mul(0.35)
    const organicNoise = TSL.mx_noise_float(TSL.vec3(
      worldPosition.x.mul(0.35), worldPosition.z.mul(0.35), windTime.mul(0.18),
    ))
    const gustEnvelope = organicNoise.mul(0.35).add(0.9)
    const turbulence = organicNoise.mul(0.2)
    const displacement = height.mul(PLANT_WIND_STRENGTH).mul(GLOBAL_WIND_STRENGTH)
      .mul(influence).mul(heightMask)
      .mul(primaryWave.mul(gustEnvelope).add(secondaryWave).add(turbulence))
    const windDirection = TSL.normalize(TSL.transformDirection(
      TSL.vec3(WIND_DIRECTION_WORLD.x, 0, WIND_DIRECTION_WORLD.y), TSL.modelWorldMatrixInverse,
    ))
    displacedPosition.addAssign(windDirection.mul(displacement))
    return displacedPosition
  })()
}
