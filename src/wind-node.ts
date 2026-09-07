import * as TSL from 'three/tsl'
import type { Node } from 'three/webgpu'

export const GLOBAL_WIND_STRENGTH = TSL.uniform(1)

export function setGlobalWindStrength(strength: number): void {
  GLOBAL_WIND_STRENGTH.value = Math.max(0, strength)
}

export const PLANT_WIND_FREQUENCY = 1.3
export const PLANT_WIND_STRENGTH = 0.05

const WIND_DIRECTION_WORLD = TSL.normalize(TSL.vec2(0.8, 0.6))

/**
 * Shared bend vector in mesh-local XZ. The sample position chooses the world
 * phase, allowing an entire blade to share the wave sampled at its root.
 */
export function grassWindBend(
  samplePosition: Node<'vec3'>,
  influence: Node<'float'>,
): Node<'vec3'> {
  return TSL.Fn(() => {
    const windTime = TSL.time.mul(PLANT_WIND_FREQUENCY)
    const worldPosition = TSL.modelWorldMatrix.mul(samplePosition).xyz
    const alongWind = TSL.dot(worldPosition.xz, WIND_DIRECTION_WORLD)
    const primaryWave = TSL.sin(alongWind.mul(0.8).add(windTime))
    const secondaryWave = TSL.sin(
      alongWind.mul(0.8 * 2.6).add(windTime.mul(1.8)).add(1.3),
    ).mul(0.35)
    const organicNoise = TSL.mx_noise_float(
      TSL.vec3(
        worldPosition.x.mul(0.35),
        worldPosition.z.mul(0.35),
        windTime.mul(0.18),
      ),
    )
    const gust = primaryWave
      .mul(organicNoise.mul(0.35).add(0.9))
      .add(secondaryWave)
      .add(organicNoise.mul(0.2))
    const windDirection = TSL.normalize(
      TSL.transformDirection(
        TSL.vec3(WIND_DIRECTION_WORLD.x, 0, WIND_DIRECTION_WORLD.y),
        TSL.modelWorldMatrixInverse,
      ),
    )
    return windDirection
      .mul(PLANT_WIND_STRENGTH)
      .mul(GLOBAL_WIND_STRENGTH)
      .mul(influence)
      .mul(gust)
  })()
}

/** Shared GPU grass motion. Positions are mesh-local after instancing in r185.
 * Callers supply root-relative height for elevated presentation vegetation. */
export function grassWindPosition(
  localPosition: Node<'vec3'>,
  height: Node<'float'>,
  heightMask: Node<'float'>,
  influence: Node<'float'>,
): Node<'vec3'> {
  return TSL.Fn(() => {
    const displacedPosition = localPosition.toVar()
    displacedPosition.addAssign(
      grassWindBend(localPosition, influence).mul(height).mul(heightMask),
    )
    return displacedPosition
  })()
}
