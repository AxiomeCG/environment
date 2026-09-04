import { Color } from 'three'
import { attribute, cameraPosition, cameraViewMatrix, mix, positionWorld, sin, smoothstep, time, vec2, vec3 } from 'three/tsl'
import { PresentationPhysicalMaterial } from './presentation-material'

/** Opaque, normal-only distant water; the scene owns reflection lighting and fog. */
export function createDistantWaterMaterial(color: string): PresentationPhysicalMaterial {
  // IOR gives water F0 ≈ 0.02. Transmission and all extra physical lobes stay off:
  // no scene-color/depth sampling, reflection capture, or additional render pass.
  const material = new PresentationPhysicalMaterial({ color, ior: 1.333, metalness: 0, roughness: 0.28 })
  material.name = 'surroundings-water'
  const depth = attribute<'float'>('waterDepth', 'float').max(0)
  const deep = smoothstep(0.15, 9, depth)
  const distance = positionWorld.sub(cameraPosition).length()
  const far = smoothstep(100, 700, distance)
  const world = positionWorld.xz

  // Independent wavelengths/dispersion, evaluated only in the fragment shader.
  // fwidth removes subpixel waves at grazing angles before specular aliasing.
  const swellDirection = vec2(0.8, 0.6)
  const rippleDirection = vec2(-0.28, 0.96)
  const fineDirection = vec2(0.96, -0.28)
  const swellPhase = world.dot(swellDirection).mul(2 * Math.PI / 22).sub(time.mul(1.67))
  const ripplePhase = world.dot(rippleDirection).mul(2 * Math.PI / 5.5).sub(time.mul(3.35))
  const finePhase = world.dot(fineDirection).mul(2 * Math.PI / 1.6).sub(time.mul(6.21))
  const swell = sin(swellPhase).mul(smoothstep(0.4, 2, swellPhase.fwidth()).oneMinus())
  const ripple = sin(ripplePhase).mul(smoothstep(0.4, 2, ripplePhase.fwidth()).oneMinus())
  const fine = sin(finePhase).mul(smoothstep(0.4, 2, finePhase.fwidth()).oneMinus())
  const tilt = swellDirection.mul(swell.mul(0.055))
    .add(rippleDirection.mul(ripple.mul(0.045)))
    .add(fineDirection.mul(fine.mul(0.022)).mul(far.oneMinus()))
    .mul(mix(0.28, 1, deep))
    .mul(mix(1, 0.18, far))
  // The horizontal mesh is Y-up in world space; normalNode requires view space.
  material.normalNode = vec3(tilt.x, 1, tilt.y).transformDirection(cameraViewMatrix)

  const shallowColor = new Color(color)
  const deepColor = shallowColor.clone().multiplyScalar(0.23)
  const foamColor = new Color('#bbc9bd')
  // Bathymetry tint is an artistic depth cue, not simulated volume absorption.
  const waterColor = mix(vec3(shallowColor.r, shallowColor.g, shallowColor.b), vec3(deepColor.r, deepColor.g, deepColor.b), deep)
  const shore = smoothstep(0.08, 0.65, depth).oneMinus()
  const wash = shore.mul(ripple.mul(0.18).add(0.32)).mul(far.oneMinus())
  material.colorNode = mix(waterColor, vec3(foamColor.r, foamColor.g, foamColor.b), wash)
  material.roughnessNode = mix(far.mul(0.12).add(0.28), 0.8, wash)
  return material
}
