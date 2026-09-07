import { Color } from 'three'
import {
  attribute,
  cameraPosition,
  cameraViewMatrix,
  exp,
  mix,
  mx_noise_float,
  positionWorld,
  sin,
  smoothstep,
  time,
  vec2,
  vec3,
} from 'three/tsl'
import type { Node } from 'three/webgpu'
import { PresentationPhysicalMaterial } from './presentation-material'

// Non-harmonic wavelengths and spread directions avoid a repeating crosshatch.
// Each entry is [direction angle, wavelength in metres, normal slope, phase].
const WAVE_BANDS = [
  [0.42, 21.7, 0.038, 0.3],
  [1.13, 13.1, 0.028, 2.4],
  [0.73, 7.7, 0.024, 4.8],
  [-0.27, 4.3, 0.018, 1.2],
  [1.62, 2.1, 0.012, 3.7],
  [0.16, 1.13, 0.008, 5.6],
] as const

export type WaterMaterialOptions = {
  name: string
  color: string
  deepColor?: string
  foamColor?: string
  foamStrength?: number
  flow?: Readonly<{ speed: number; direction: 1 | -1 }>
  depthRange?: readonly [shallow: number, deep: number]
  roughness?: number
  shoreRoughness?: number
  rippleStrength?: number
  waveScale?: number
  speedScale?: number
  shoreFade?: readonly [distance: number, absorptionDepth: number]
  opacity?: readonly [shallow: number, deep: number]
}

/**
 * Shared single-pass water material. All callers provide `waterDepth`;
 * `shoreFade` additionally reads `shoreDistance`; flowing water reads the
 * world-XZ tangent in `waterFlow` and path-distance/lateral metres in `waterCourse`.
 * No scene-color/depth sampling, reflection capture, CPU animation or extra pass.
 */
export function createWaterMaterial(options: WaterMaterialOptions): PresentationPhysicalMaterial {
  const roughness = options.roughness ?? 0.28
  const shoreRoughness = options.shoreRoughness ?? 0.8
  const rippleStrength = options.rippleStrength ?? 1
  const waveScale = options.waveScale ?? 1
  const speedScale = options.speedScale ?? 1
  const [depthStart, depthEnd] = options.depthRange ?? [0.15, 9]
  const material = new PresentationPhysicalMaterial({
    color: options.color,
    depthWrite: !options.opacity,
    ior: 1.333,
    metalness: 0,
    roughness,
    transparent: Boolean(options.opacity),
  })
  material.name = options.name

  const depth = attribute<'float'>('waterDepth', 'float').max(0)
  const deep = smoothstep(depthStart, depthEnd, depth)
  const distance = positionWorld.sub(cameraPosition).length()
  const far = smoothstep(100, 700, distance)
  const world = positionWorld.xz.mul(waveScale)
  const flowSpeed = options.flow ? Math.max(0, options.flow.speed) * options.flow.direction : 0
  const clock = time.mul(options.flow ? flowSpeed : speedScale)
  const rawFlow = options.flow ? attribute<'vec2'>('waterFlow', 'vec2') : null
  const flowTangent = rawFlow ? rawFlow.div(rawFlow.length().max(1e-4)).toVar() : null
  const advected = options.flow
    ? attribute<'vec2'>('waterCourse', 'vec2')
        .sub(vec2(time.mul(flowSpeed), 0))
        .mul(waveScale)
        .toVar()
    : world

  // Path-space transport stays coherent around bends. Advecting world XZ by
  // a changing tangent can stretch, stall, or reverse the apparent current.
  const drift = vec2(0.8, 0.6).mul(clock)
  const broadNoise = (
    flowTangent
      ? mx_noise_float(advected.mul(0.035))
      : mx_noise_float(world.mul(0.035).sub(drift.mul(0.024)))
  ).toVar()
  const patchNoise = (
    flowTangent
      ? mx_noise_float(advected.mul(0.13).add(vec2(17.2, 9.1)))
      : mx_noise_float(world.mul(0.13).add(vec2(17.2, 9.1)).sub(drift.mul(0.06)))
  ).toVar()
  const patches = smoothstep(-0.55, 0.55, patchNoise)
  const flowNormal = flowTangent ? vec2(flowTangent.y.negate(), flowTangent.x) : null
  let slopes: Node<'vec2'> = vec2(0)
  for (const [angle, wavelength, strength, offset] of WAVE_BANDS) {
    const spread = angle * 0.22
    const direction =
      flowTangent && flowNormal
        ? flowTangent.mul(Math.cos(spread)).add(flowNormal.mul(Math.sin(spread)))
        : vec2(Math.cos(angle), Math.sin(angle))
    const waveNumber = (2 * Math.PI) / wavelength
    const spatialPhase = advected
      .dot(flowTangent ? vec2(Math.cos(spread), Math.sin(spread)) : direction)
      .mul(waveNumber)
    const phase = (
      flowTangent ? spatialPhase : spatialPhase.sub(clock.mul(Math.sqrt(9.81 * waveNumber)))
    )
      .add(offset)
      .add(broadNoise.mul(3.2))
      .add(patchNoise.mul(1.8))
    // Filter the warped phase, not just distance: grazing views undersample first.
    const resolved = smoothstep(0.4, 2, phase.fwidth()).oneMinus()
    const detailFade = wavelength < 5 ? far.oneMinus() : 1
    slopes = slopes.add(direction.mul(sin(phase).mul(strength).mul(resolved).mul(detailFade)))
  }
  const tilt = slopes
    .mul(mix(0.45, 1, patches))
    .mul(mix(0.28, 1, deep))
    .mul(mix(1, 0.18, far))
    .mul(rippleStrength)
  material.normalNode = vec3(tilt.x, 1, tilt.y).transformDirection(cameraViewMatrix)

  const shallowColor = new Color(options.color)
  const deepColor = options.deepColor
    ? new Color(options.deepColor)
    : shallowColor.clone().multiplyScalar(0.23)
  const foamColor = new Color(options.foamColor ?? '#e0e8df')
  const waterColor = mix(
    vec3(shallowColor.r, shallowColor.g, shallowColor.b),
    vec3(deepColor.r, deepColor.g, deepColor.b),
    deep,
  )
  // Visible elongated streaks supplement subtle normal ripples. Only rivers
  // get these transported cues; pond and coastal appearance remain unchanged.
  const current = flowTangent
    ? smoothstep(
        -0.5,
        0.6,
        mx_noise_float(advected.mul(vec2(0.42, 2.2)).add(vec2(3.4, 11.2))),
      ).toVar()
    : null
  const currentColor = current ? waterColor.mul(mix(0.68, 1.08, current)) : waterColor
  const currentFoam = current ? smoothstep(0.6, 0.9, current).mul(0.28) : 0
  const shore = smoothstep(0.08, 0.65, depth).oneMinus()
  const wash = shore.mul(patches.mul(0.28).add(0.16))
  // Shallow depth causes foam; noise only breaks its edge and coverage.
  // The phase moves toward shallower water instead of sliding along the bank.
  const foamPhase = depth.mul(9).add(clock.mul(0.65)).add(broadNoise.mul(2.8))
  const foamBand = smoothstep(0.02, 0.1, depth).mul(smoothstep(0.4, 1.3, depth).oneMinus())
  const foam = smoothstep(0.15, 0.8, sin(foamPhase))
    .mul(smoothstep(0.4, 2, foamPhase.fwidth()).oneMinus())
    .mul(mix(0.25, 1, patches))
    .mul(foamBand)
    .mul(options.foamStrength ?? 0.25)
  const coverage = wash.max(foam).max(currentFoam).mul(far.oneMinus()).clamp(0, 1)
  material.colorNode = mix(currentColor, vec3(foamColor.r, foamColor.g, foamColor.b), coverage)
  material.roughnessNode = mix(far.mul(0.12).add(roughness), shoreRoughness, coverage)
  if (options.opacity) {
    let opacity: Node<'float'> = mix(options.opacity[0], options.opacity[1], deep)
    if (options.shoreFade) {
      const [fadeDistance, absorptionDepth] = options.shoreFade
      const shoreDistance = attribute<'float'>('shoreDistance', 'float').max(0)
      // Optical coverage follows Beer-Lambert absorption through the shallow
      // water column; the distance term antialiases the clipped terrain edge.
      const opticalCoverage = exp(depth.div(Math.max(1e-4, absorptionDepth)).negate()).oneMinus()
      const edgeCoverage = smoothstep(0, Math.max(1e-4, fadeDistance), shoreDistance)
      opacity = opacity.mul(opticalCoverage).mul(edgeCoverage)
    }
    material.opacityNode = opacity
  }
  return material
}

/** Opaque, normal-only distant water; the scene owns reflection lighting and fog. */
export function createDistantWaterMaterial(color: string): PresentationPhysicalMaterial {
  return createWaterMaterial({
    name: 'surroundings-water',
    color,
    depthRange: [0.15, 9],
    roughness: 0.28,
    shoreRoughness: 0.8,
    rippleStrength: 1,
    foamStrength: 1,
  })
}
