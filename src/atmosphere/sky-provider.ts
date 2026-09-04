import {
  Color,
  TempNode,
  type CubeTexture,
  type Node,
  type NodeBuilder,
  type UniformNode,
  type Vector3,
} from 'three/webgpu'
import * as TSL from 'three/tsl'

import {
  createSolarState,
  updateSolarState,
  type SkyDebug,
  type SkySettings,
  type SolarState,
} from './settings'

const { float: tslFloat } = TSL

type Vec3Node = Node<'vec3'>
type FloatNode = Node<'float'>
type SkySampler = (direction: Vec3Node) => Vec3Node
type SkySignal = () => Vec3Node
type EnvironmentContext = {
  getUV?: (node: Node, builder: NodeBuilder) => Node
  getTextureLevel?: (node: Node) => Node
}
type ScalarUniform = UniformNode<'float', number>
type DirectionUniform = UniformNode<'vec3', Vector3>
type ShaderUniforms = {
  sunDirection: DirectionUniform
  moonDirection: DirectionUniform
  daylight: ScalarUniform
  twilight: ScalarUniform
  night: ScalarUniform
  sunVisibility: ScalarUniform
  moonVisibility: ScalarUniform
  rayleigh: ScalarUniform
  mie: ScalarUniform
  mieG: ScalarUniform
  turbidity: ScalarUniform
  sunRadius: ScalarUniform
  sunRadiance: ScalarUniform
  cloudCoverage: ScalarUniform
  cloudSoftness: ScalarUniform
  cloudScale: ScalarUniform
  cloudPhase: ScalarUniform
  moonPhase: ScalarUniform
  debugMode: ScalarUniform
}
export type SkyProvider = {
  skyRadiance(direction: Vec3Node): Vec3Node
  reflectionRadiance(direction: Vec3Node): Vec3Node
  fogRadiance(direction: Vec3Node): Vec3Node
  environmentNode: Vec3Node
  sunDirection: Vector3
  sunColor: Color
  sunIntensity: number
  moonDirection: Vector3
  moonColor: Color
  moonIntensity: number
  skyColor: Color
  groundColor: Color
  hemisphereIntensity: number
  ambientIntensity: number
  exposure: number
  fogStart: number
  fogEnd: number
  update(settings: SkySettings, cloudTime: number): void
  dispose?(): void
}
type SkyLightingState = Omit<
  SkyProvider,
  'skyRadiance' | 'reflectionRadiance' | 'fogRadiance' | 'environmentNode' | 'update' | 'dispose'
>

const DEBUG_INDEX: Record<SkyDebug, number> = {
  none: 0,
  direction: 1,
  rayleigh: 2,
  mie: 3,
  haze: 4,
  sun: 5,
  clouds: 6,
  luminance: 7,
}

const TWO_PI = Math.PI * 2

// Three's current TSL declarations only type scalar exp; evaluate the three
// wavelength channels explicitly rather than erasing the vector type.
function beerLambert(opticalDepth: Vec3Node): Vec3Node {
  return TSL.vec3(
    TSL.exp(opticalDepth.x.negate()),
    TSL.exp(opticalDepth.y.negate()),
    TSL.exp(opticalDepth.z.negate()),
  )
}

function bounded(value: number, low: number, high: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback
}

function isDiffuseEnvironmentLevel(node: Node | undefined): boolean {
  const constant = node as (Node & { isConstNode?: boolean; value?: unknown }) | undefined
  return constant?.isConstNode === true && constant.value === 1
}

function chapmanColumn(
  cosZenith: FloatNode,
  scaleHeight: number,
  horizonFactor: number,
): FloatNode {
  const denominator = tslFloat(1).add(tslFloat(horizonFactor - 1).mul(TSL.max(cosZenith, 0)))
  return tslFloat(scaleHeight * horizonFactor).div(denominator) as FloatNode
}

/**
 * Three supplies a roughness-bent reflection direction for radiance and the world
 * normal for irradiance. Specular radiance fades toward the cloud-free atmosphere
 * as roughness rises; diffuse takes that cheap path directly, avoiding a
 * three-octave fBM evaluation for every PBR diffuse sample. This is a bounded
 * analytic convolution approximation, so broad cloud energy is not integrated.
 */
class AnalyticEnvironmentNode extends TempNode<'vec3'> {
  constructor(
    private readonly specularSampler: SkySampler,
    private readonly diffuseSampler: SkySampler,
  ) {
    super('vec3')
  }

  override setup(builder: NodeBuilder): Node {
    const context = builder.getContext() as EnvironmentContext
    const direction = context.getUV?.(this, builder)
    if (!direction) return TSL.vec3(0)

    const level = context.getTextureLevel?.(this)
    const viewDirection = direction as Vec3Node
    if (isDiffuseEnvironmentLevel(level)) return this.diffuseSampler(viewDirection)
    if (!level) return this.specularSampler(viewDirection)

    const filteredRadiance = TSL.Fn<Vec3Node>(() => {
      const roughness = TSL.clamp(level as FloatNode, 0, 1)
      const diffuse = this.diffuseSampler(viewDirection).toVar()
      const radiance = diffuse.toVar()
      TSL.If(roughness.lessThan(0.5), () => {
        const detailWeight = tslFloat(1).sub(TSL.smoothstep(0.32, 0.5, roughness))
        radiance.assign(TSL.mix(diffuse, this.specularSampler(viewDirection), detailWeight))
      })
      return radiance
    })
    return filteredRadiance()
  }
}

function createLightingState(settings: SkySettings): {
  lighting: SkyLightingState
  solar: SolarState
} {
  const solar = createSolarState()
  const lighting: SkyLightingState = {
    sunDirection: solar.sunDirection,
    sunColor: new Color(),
    sunIntensity: 0,
    moonDirection: solar.moonDirection,
    moonColor: new Color(),
    moonIntensity: 0,
    skyColor: new Color(),
    groundColor: new Color(),
    hemisphereIntensity: 0,
    ambientIntensity: 0,
    exposure: 1,
    fogStart: settings.fogStart,
    fogEnd: settings.fogEnd,
  }
  return { lighting, solar }
}

function cpuChapmanColumn(cosZenith: number, scaleHeight: number, horizonFactor: number): number {
  return (scaleHeight * horizonFactor) / (1 + (horizonFactor - 1) * Math.max(cosZenith, 0))
}

function updateLighting(
  lighting: SkyLightingState,
  solar: SolarState,
  settings: SkySettings,
): void {
  updateSolarState(settings, solar)

  const daylight = bounded(solar.daylight, 0, 1, 0)
  const twilight = bounded(solar.twilight, 0, 1, 0)
  const night = bounded(solar.night, 0, 1, 0)
  const sunRadiance = bounded(settings.sunRadiance, 1, 100, 40)
  const moonPhase = bounded(settings.moonPhase, 0, 1, 1)

  const rayleighColumn = cpuChapmanColumn(solar.sunDirection.y, 8000, 35.36)
  const mieColumn = cpuChapmanColumn(solar.sunDirection.y, 1200, 91.25)
  const rayleighScale = bounded(settings.rayleigh, 0, 2, 1)
  const aerosolScale =
    bounded(settings.mie, 0, 0.02, 0.005) * 200 * bounded(settings.turbidity, 1, 10, 2) * 0.5
  const mieOpticalDepth = 4.436e-6 * aerosolScale * mieColumn
  const transmittanceR = Math.exp(-(5.802e-6 * rayleighScale * rayleighColumn + mieOpticalDepth))
  const transmittanceG = Math.exp(-(13.558e-6 * rayleighScale * rayleighColumn + mieOpticalDepth))
  const transmittanceB = Math.exp(-(33.1e-6 * rayleighScale * rayleighColumn + mieOpticalDepth))
  const transmissionPeak = Math.max(transmittanceR, transmittanceG, transmittanceB, 1e-6)
  lighting.sunColor.setRGB(
    transmittanceR / transmissionPeak,
    transmittanceG / transmissionPeak,
    transmittanceB / transmissionPeak,
  )
  const artisticDirectionalScale = 0.025 + daylight * 0.055 + twilight * 0.012
  lighting.sunIntensity =
    solar.sunVisibility * transmissionPeak * sunRadiance * artisticDirectionalScale

  lighting.moonColor.setRGB(0.48, 0.59, 0.82)
  lighting.moonIntensity = solar.moonVisibility * moonPhase * 0.075

  lighting.skyColor.setRGB(
    0.08 * daylight + 0.018 * twilight + 0.006 * night,
    0.24 * daylight + 0.055 * twilight + 0.012 * night,
    0.62 * daylight + 0.16 * twilight + 0.038 * night,
  )
  lighting.groundColor.setRGB(
    0.14 * daylight + 0.025 * twilight + 0.004 * night,
    0.12 * daylight + 0.02 * twilight + 0.005 * night,
    0.1 * daylight + 0.03 * twilight + 0.009 * night,
  )
  lighting.hemisphereIntensity = 0.12 + daylight * 0.58 + twilight * 0.08 + night * 0.03
  lighting.ambientIntensity = 0.025 + daylight * 0.12 + twilight * 0.035 + night * 0.018
  lighting.exposure = bounded(solar.exposure, 0.05, 16, 1)
  lighting.fogStart = bounded(settings.fogStart, 0, 2000, 180)
  lighting.fogEnd = Math.max(lighting.fogStart + 20, bounded(settings.fogEnd, 20, 5000, 1200))
}

function createShaderUniforms(solar: SolarState, settings: SkySettings): ShaderUniforms {
  return {
    sunDirection: TSL.uniform(solar.sunDirection),
    moonDirection: TSL.uniform(solar.moonDirection),
    daylight: TSL.uniform(0),
    twilight: TSL.uniform(0),
    night: TSL.uniform(0),
    sunVisibility: TSL.uniform(0),
    moonVisibility: TSL.uniform(0),
    rayleigh: TSL.uniform(settings.rayleigh),
    mie: TSL.uniform(settings.mie),
    mieG: TSL.uniform(settings.mieG),
    turbidity: TSL.uniform(settings.turbidity),
    sunRadius: TSL.uniform(settings.sunRadius),
    sunRadiance: TSL.uniform(settings.sunRadiance),
    cloudCoverage: TSL.uniform(settings.cloudCoverage),
    cloudSoftness: TSL.uniform(settings.cloudSoftness),
    cloudScale: TSL.uniform(settings.cloudScale),
    cloudPhase: TSL.uniform(0),
    moonPhase: TSL.uniform(settings.moonPhase),
    debugMode: TSL.uniform(DEBUG_INDEX[settings.debug]),
  }
}

function updateShaderUniforms(
  uniforms: ShaderUniforms,
  solar: SolarState,
  settings: SkySettings,
  cloudTime: number,
): void {
  uniforms.daylight.value = bounded(solar.daylight, 0, 1, 0)
  uniforms.twilight.value = bounded(solar.twilight, 0, 1, 0)
  uniforms.night.value = bounded(solar.night, 0, 1, 0)
  uniforms.sunVisibility.value = bounded(solar.sunVisibility, 0, 1, 0)
  uniforms.moonVisibility.value = bounded(solar.moonVisibility, 0, 1, 0)
  uniforms.rayleigh.value = bounded(settings.rayleigh, 0, 2, 1)
  uniforms.mie.value = bounded(settings.mie, 0, 0.02, 0.005)
  uniforms.mieG.value = bounded(settings.mieG, 0, 0.9, 0.76)
  uniforms.turbidity.value = bounded(settings.turbidity, 1, 10, 2)
  uniforms.sunRadius.value = bounded(settings.sunRadius, 0.00465, 0.03, 0.01)
  uniforms.sunRadiance.value = bounded(settings.sunRadiance, 1, 100, 40)
  uniforms.cloudCoverage.value = bounded(settings.cloudCoverage, 0, 1, 0.45)
  uniforms.cloudSoftness.value = bounded(settings.cloudSoftness, 0.02, 0.4, 0.16)
  uniforms.cloudScale.value = bounded(settings.cloudScale, 0.25, 4, 1)
  uniforms.moonPhase.value = bounded(settings.moonPhase, 0, 1, 1)
  uniforms.debugMode.value = DEBUG_INDEX[settings.debug]

  const seconds = Number.isFinite(cloudTime) ? cloudTime : 0
  const speed = bounded(settings.cloudSpeed, 0, 0.04, 0.008)
  uniforms.cloudPhase.value = (((seconds * speed) % TWO_PI) + TWO_PI) % TWO_PI
}

function createAtmosphereSamplers(uniforms: ShaderUniforms) {
  // Sea-level coefficients in m^-1. Aerosol controls scale the physically
  // separate Mie scattering and absorption terms around the default profile.
  const betaRayleigh = TSL.vec3(5.802e-6, 13.558e-6, 33.1e-6).mul(uniforms.rayleigh)
  const aerosolScale = uniforms.mie.mul(200).mul(uniforms.turbidity.mul(0.5))
  const betaMieScatter = TSL.vec3(3.996e-6).mul(aerosolScale)
  const betaMieExtinction = TSL.vec3(4.436e-6).mul(aerosolScale)

  const sunTransmittance = TSL.Fn<Vec3Node>(() => {
    const sunHeight = uniforms.sunDirection.y as FloatNode
    const rayleighColumn = chapmanColumn(sunHeight, 8000, 35.36)
    const mieColumn = chapmanColumn(sunHeight, 1200, 91.25)
    const opticalDepth = betaRayleigh.mul(rayleighColumn).add(betaMieExtinction.mul(mieColumn))
    const aboveHorizon = TSL.smoothstep(
      TSL.sin(uniforms.sunRadius).negate(),
      TSL.sin(uniforms.sunRadius),
      sunHeight,
    )
    return beerLambert(opticalDepth).mul(aboveHorizon)
  })

  const atmosphereRadiance = (rawDirection: Vec3Node, includeGround = true): Vec3Node =>
    TSL.Fn<Vec3Node>(() => {
      const direction = TSL.normalize(rawDirection)
      const altitude = TSL.clamp(direction.y, -1, 1)
      const aboveHorizon = TSL.smoothstep(-0.12, -0.005, altitude)
      const viewHeight = TSL.max(altitude, 0) as FloatNode
      const mu = TSL.clamp(TSL.dot(direction, uniforms.sunDirection), -1, 1)

      // Rational Chapman-inspired columns approximate the different molecular
      // and aerosol scale heights without marching every material pixel.
      const rayleighColumn = chapmanColumn(viewHeight, 8000, 35.36)
      const mieColumn = chapmanColumn(viewHeight, 1200, 91.25)
      const rayleighDepth = betaRayleigh.mul(rayleighColumn)
      const mieScatterDepth = betaMieScatter.mul(mieColumn)
      const opticalDepth = rayleighDepth.add(betaMieExtinction.mul(mieColumn))
      const viewTransmittance = beerLambert(opticalDepth)

      const rayleighPhase = mu.mul(mu).add(1).mul(0.0596831)
      const g = TSL.clamp(uniforms.mieG, 0, 0.9)
      const hgDenominator = TSL.max(tslFloat(1).add(g.mul(g)).sub(g.mul(mu).mul(2)), 0.0001)
      const miePhase = tslFloat(1).sub(g.mul(g)).div(TSL.pow(hgDenominator, 1.5)).mul(0.0795775)
      const weightedScatter = rayleighDepth
        .mul(rayleighPhase)
        .add(mieScatterDepth.mul(miePhase))
        .div(TSL.max(opticalDepth, TSL.vec3(0.0001)))
      const singleScatter = sunTransmittance()
        .mul(TSL.vec3(1).sub(viewTransmittance))
        .mul(weightedScatter)
        .mul(uniforms.sunRadiance.mul(0.3))

      const horizon = TSL.exp(TSL.abs(altitude).mul(uniforms.turbidity.mul(0.22).add(4.4)).negate())
      const solarArc = TSL.pow(TSL.max(mu, 0), 3)
      // Ground-level columns cannot resolve Earth's shadow in the upper air.
      // This is an artistic twilight residual, not computed multiple scattering.
      const twilightScatter = TSL.vec3(0.95, 0.16, 0.025)
        .mul(uniforms.twilight)
        .mul(horizon)
        .mul(solarArc.mul(0.28).add(0.045))
      const haze = TSL.vec3(0.46, 0.43, 0.4)
        .mul(horizon)
        .mul(uniforms.turbidity)
        .mul(0.012)
        .mul(uniforms.daylight.add(uniforms.twilight.mul(0.65)).add(uniforms.night.mul(0.06)))

      const zenith = TSL.pow(viewHeight, 0.4)
      const nightResidual = TSL.mix(
        TSL.vec3(0.017, 0.022, 0.052),
        TSL.vec3(0.0022, 0.0055, 0.021),
        zenith,
      ).mul(uniforms.night)
      const sky = singleScatter.add(twilightScatter).add(haze).add(nightResidual)
      // Fog is in-scattered airlight, not the dark ground hemisphere seen by reflections.
      if (!includeGround) return sky
      const ground = TSL.vec3(0.025, 0.021, 0.019).mul(
        uniforms.daylight.add(uniforms.twilight.mul(0.3)).add(uniforms.night.mul(0.12)),
      )
      return TSL.mix(ground, sky, aboveHorizon)
    })()

  const rayleighDiagnostic: SkySampler = (rawDirection) =>
    TSL.Fn<Vec3Node>(() => {
      const direction = TSL.normalize(rawDirection)
      const viewHeight = TSL.max(direction.y, 0) as FloatNode
      const mu = TSL.clamp(TSL.dot(direction, uniforms.sunDirection), -1, 1)
      const rayleighColumn = chapmanColumn(viewHeight, 8000, 35.36)
      const mieColumn = chapmanColumn(viewHeight, 1200, 91.25)
      const rayleighDepth = betaRayleigh.mul(rayleighColumn)
      const opticalDepth = rayleighDepth.add(betaMieExtinction.mul(mieColumn))
      const phase = mu.mul(mu).add(1).mul(0.0596831)
      return sunTransmittance()
        .mul(TSL.vec3(1).sub(beerLambert(opticalDepth)))
        .mul(rayleighDepth.mul(phase).div(TSL.max(opticalDepth, TSL.vec3(0.0001))))
        .mul(uniforms.sunRadiance.mul(0.3))
    })()

  const mieDiagnostic: SkySampler = (rawDirection) =>
    TSL.Fn<Vec3Node>(() => {
      const direction = TSL.normalize(rawDirection)
      const viewHeight = TSL.max(direction.y, 0) as FloatNode
      const mu = TSL.clamp(TSL.dot(direction, uniforms.sunDirection), -1, 1)
      const rayleighColumn = chapmanColumn(viewHeight, 8000, 35.36)
      const mieColumn = chapmanColumn(viewHeight, 1200, 91.25)
      const mieScatterDepth = betaMieScatter.mul(mieColumn)
      const opticalDepth = betaRayleigh.mul(rayleighColumn).add(betaMieExtinction.mul(mieColumn))
      const g = TSL.clamp(uniforms.mieG, 0, 0.9)
      const denominator = TSL.max(tslFloat(1).add(g.mul(g)).sub(g.mul(mu).mul(2)), 0.0001)
      const phase = tslFloat(1).sub(g.mul(g)).div(TSL.pow(denominator, 1.5)).mul(0.0795775)
      return sunTransmittance()
        .mul(TSL.vec3(1).sub(beerLambert(opticalDepth)))
        .mul(mieScatterDepth.mul(phase).div(TSL.max(opticalDepth, TSL.vec3(0.0001))))
        .mul(uniforms.sunRadiance.mul(0.3))
    })()

  const hazeDiagnostic: SkySampler = (rawDirection) =>
    TSL.Fn<Vec3Node>(() => {
      const altitude = TSL.clamp(TSL.normalize(rawDirection).y, -1, 1)
      const horizon = TSL.exp(TSL.abs(altitude).mul(uniforms.turbidity.mul(0.22).add(4.4)).negate())
      return TSL.vec3(horizon.mul(uniforms.turbidity).mul(0.08))
    })()

  const fogRadiance: SkySampler = (direction) => atmosphereRadiance(direction, false)
  return { atmosphereRadiance, fogRadiance, rayleighDiagnostic, mieDiagnostic, hazeDiagnostic, sunTransmittance }
}

function createCelestialSamplers(uniforms: ShaderUniforms, sunTransmittance?: SkySignal) {
  const cloudOpacity = (rawDirection: Vec3Node): FloatNode => {
    const direction = TSL.normalize(rawDirection)
    const windCos = TSL.cos(uniforms.cloudPhase)
    const windSin = TSL.sin(uniforms.cloudPhase)
    const transportedDirection = TSL.vec3(
      direction.x.mul(windCos).sub(direction.z.mul(windSin)),
      direction.y,
      direction.x.mul(windSin).add(direction.z.mul(windCos)),
    )
    const domain = transportedDirection.mul(uniforms.cloudScale.mul(2.65))
    const fbm = TSL.clamp(TSL.mx_fractal_noise_float(domain, 3, 2.03, 0.52).mul(0.5).add(0.5), 0, 1)
    const threshold = tslFloat(1).sub(uniforms.cloudCoverage)
    const density = TSL.smoothstep(threshold, threshold.add(uniforms.cloudSoftness), fbm)
    const layer = TSL.smoothstep(-0.08, 0.13, direction.y)
    return density.mul(layer)
  }

  const cloudRadiance: SkySampler = (rawDirection) =>
    TSL.Fn<Vec3Node>(() => {
      const direction = TSL.normalize(rawDirection)
      const mu = TSL.clamp(TSL.dot(direction, uniforms.sunDirection), -1, 1)
      const g = tslFloat(0.65)
      const denominator = TSL.max(tslFloat(1).add(g.mul(g)).sub(g.mul(mu).mul(2)), 0.04)
      const phase = tslFloat(1).sub(g.mul(g)).div(TSL.pow(denominator, 1.5)).mul(0.0795775)
      const ambient = TSL.vec3(0.34, 0.38, 0.46)
        .mul(uniforms.daylight)
        .add(TSL.vec3(0.22, 0.11, 0.08).mul(uniforms.twilight))
        .add(TSL.vec3(0.014, 0.019, 0.042).mul(uniforms.night))
      const directColor = sunTransmittance
        ? sunTransmittance()
        : TSL.mix(TSL.vec3(1.0, 0.42, 0.11), TSL.vec3(1.0, 0.94, 0.78), uniforms.daylight)
      const direct = directColor
        .mul(phase)
        .mul(1.4)
        .mul(uniforms.daylight.add(uniforms.twilight.mul(0.45)))
      return ambient.add(direct)
    })()

  const celestialRadiance = (rawDirection: Vec3Node, rawCloudOpacity: FloatNode): Vec3Node => {
    const direction = TSL.normalize(rawDirection)
    const opacity = TSL.clamp(rawCloudOpacity as FloatNode, 0, 1)
    const transmission = tslFloat(1).sub(opacity)

    const sunMu = TSL.clamp(TSL.dot(direction, uniforms.sunDirection), -1, 1)
    const sunInner = TSL.cos(uniforms.sunRadius.mul(0.88))
    const sunOuter = TSL.cos(uniforms.sunRadius.mul(1.12))
    const sunDisk = TSL.smoothstep(sunOuter, sunInner, sunMu)
    const sunColor = sunTransmittance
      ? sunTransmittance()
      : TSL.mix(TSL.vec3(1.0, 0.42, 0.11), TSL.vec3(1.0, 0.94, 0.78), uniforms.daylight)
    const sun = sunColor
      .mul(sunDisk)
      .mul(uniforms.sunRadiance)
      .mul(uniforms.sunVisibility)
      .mul(transmission)

    const moonRadius = TSL.max(uniforms.sunRadius.mul(1.35), 0.008)
    const moonMu = TSL.clamp(TSL.dot(direction, uniforms.moonDirection), -1, 1)
    const moonDisk = TSL.smoothstep(
      TSL.cos(moonRadius.mul(1.1)),
      TSL.cos(moonRadius.mul(0.9)),
      moonMu,
    )
    const discOffset = direction
      .sub(uniforms.moonDirection.mul(moonMu))
      .div(TSL.max(TSL.sin(moonRadius), 0.001))
    const discRadiusSquared = TSL.clamp(TSL.dot(discOffset, discOffset), 0, 1)
    const surfaceNormal = TSL.normalize(
      discOffset.add(
        uniforms.moonDirection.negate().mul(TSL.sqrt(tslFloat(1).sub(discRadiusSquared))),
      ),
    )
    const orbitalTangent = TSL.normalize(
      TSL.cross(TSL.vec3(0, 1, 0), uniforms.moonDirection).add(TSL.vec3(0.0001, 0, 0)),
    )
    const phaseCosine = uniforms.moonPhase.mul(2).sub(1)
    const phaseSine = TSL.sqrt(TSL.max(tslFloat(1).sub(phaseCosine.mul(phaseCosine)), 0))
    const artisticLightDirection = TSL.normalize(
      uniforms.sunDirection.mul(phaseCosine).add(orbitalTangent.mul(phaseSine)),
    )
    const terminator = TSL.smoothstep(-0.035, 0.035, TSL.dot(surfaceNormal, artisticLightDirection))
    const phasePresence = TSL.smoothstep(0, 0.02, uniforms.moonPhase)
    const moon = TSL.vec3(0.72, 0.82, 1.0)
      .mul(2.2)
      .mul(moonDisk)
      .mul(terminator)
      .mul(phasePresence)
      .mul(uniforms.moonVisibility)
      .mul(transmission)

    const starGrid = direction.mul(128)
    const starCell = TSL.floor(starGrid)
    const hashX = TSL.fract(
      TSL.sin(TSL.dot(starCell, TSL.vec3(12.9898, 78.233, 39.425))).mul(43758.5453),
    )
    const hashY = TSL.fract(
      TSL.sin(TSL.dot(starCell, TSL.vec3(63.7264, 10.873, 95.631))).mul(24634.6345),
    )
    const hashZ = TSL.fract(
      TSL.sin(TSL.dot(starCell, TSL.vec3(21.318, 47.117, 17.913))).mul(56445.2341),
    )
    const starDirection = TSL.normalize(starCell.add(TSL.vec3(hashX, hashY, hashZ)))
    const starDistance = direction.sub(starDirection).length().mul(128)
    const footprint = TSL.max(starDistance.fwidth(), 0.025)
    const starPoint = tslFloat(1).sub(
      TSL.smoothstep(tslFloat(0.1).sub(footprint), tslFloat(0.1).add(footprint), starDistance),
    )
    const brightness = TSL.smoothstep(0.989, 0.9996, hashX)
    const starMask = starPoint
      .mul(brightness)
      .mul(TSL.smoothstep(-0.04, 0.12, direction.y))
      .mul(tslFloat(1).sub(moonDisk))
    const starColor = TSL.mix(TSL.vec3(0.58, 0.7, 1), TSL.vec3(1, 0.76, 0.5), hashY)
    const stars = starColor.mul(starMask).mul(uniforms.night).mul(0.9).mul(transmission)

    return sun.add(moon).add(stars)
  }

  return { cloudOpacity, cloudRadiance, celestialRadiance }
}

function debugLuminance(color: Vec3Node): Vec3Node {
  const encoded = TSL.clamp(
    TSL.log2(TSL.max(TSL.luminance(color), 0.00001))
      .add(12)
      .div(16),
    0,
    1,
  )
  return TSL.vec3(encoded, encoded.mul(encoded), tslFloat(1).sub(encoded)) as Vec3Node
}

function selectDebug(
  uniforms: ShaderUniforms,
  physical: Vec3Node,
  direction: Vec3Node,
  rayleigh: Vec3Node,
  mie: Vec3Node,
  haze: Vec3Node,
  sun: Vec3Node,
  clouds: Vec3Node,
): Vec3Node {
  const result = TSL.vec3(physical).toVar()
  TSL.If(uniforms.debugMode.equal(1), () => {
    result.assign(direction.mul(0.5).add(0.5))
  })
  TSL.If(uniforms.debugMode.equal(2), () => {
    result.assign(rayleigh)
  })
  TSL.If(uniforms.debugMode.equal(3), () => {
    result.assign(mie)
  })
  TSL.If(uniforms.debugMode.equal(4), () => {
    result.assign(haze)
  })
  TSL.If(uniforms.debugMode.equal(5), () => {
    result.assign(sun)
  })
  TSL.If(uniforms.debugMode.equal(6), () => {
    result.assign(clouds)
  })
  TSL.If(uniforms.debugMode.equal(7), () => {
    result.assign(debugLuminance(physical))
  })
  return result as Vec3Node
}

function createProceduralProvider(settings: SkySettings): SkyProvider {
  const { lighting, solar } = createLightingState(settings)
  const uniforms = createShaderUniforms(solar, settings)
  const atmosphere = createAtmosphereSamplers(uniforms)
  const celestial = createCelestialSamplers(uniforms, atmosphere.sunTransmittance)

  const reflectionRadiance: SkySampler = (rawDirection) =>
    TSL.Fn<Vec3Node>(() => {
      const direction = TSL.normalize(rawDirection)
      const opacity = celestial.cloudOpacity(direction) as FloatNode
      const transmission = tslFloat(1).sub(opacity)
      const air = atmosphere.atmosphereRadiance(direction)
      const cloud = celestial.cloudRadiance(direction)
      return air
        .mul(transmission)
        .add(cloud.mul(opacity))
        .add(celestial.celestialRadiance(direction, opacity))
    })()

  const skyRadiance: SkySampler = (rawDirection) =>
    TSL.Fn<Vec3Node>(() => {
      const direction = TSL.normalize(rawDirection) as Vec3Node
      const opacity = celestial.cloudOpacity(direction) as FloatNode
      const transmission = tslFloat(1).sub(opacity)
      const air = atmosphere.atmosphereRadiance(direction)
      const cloud = celestial.cloudRadiance(direction)
      const physical = air
        .mul(transmission)
        .add(cloud.mul(opacity))
        .add(celestial.celestialRadiance(direction, opacity)) as Vec3Node
      const sunMask = TSL.smoothstep(
        TSL.cos(uniforms.sunRadius.mul(1.12)),
        TSL.cos(uniforms.sunRadius.mul(0.88)),
        TSL.clamp(TSL.dot(direction, uniforms.sunDirection), -1, 1),
      )
        .mul(uniforms.sunVisibility)
        .mul(transmission)
      return selectDebug(
        uniforms,
        physical,
        direction,
        atmosphere.rayleighDiagnostic(direction),
        atmosphere.mieDiagnostic(direction),
        atmosphere.hazeDiagnostic(direction),
        TSL.vec3(sunMask) as Vec3Node,
        TSL.vec3(opacity) as Vec3Node,
      )
    })()

  const provider: SkyProvider = {
    ...lighting,
    skyRadiance,
    reflectionRadiance,
    fogRadiance: atmosphere.fogRadiance,
    environmentNode: new AnalyticEnvironmentNode(
      reflectionRadiance,
      atmosphere.atmosphereRadiance,
    ) as Vec3Node,
    update(next, cloudTime) {
      updateLighting(provider, solar, next)
      updateShaderUniforms(uniforms, solar, next, cloudTime)
    },
  }
  provider.update(settings, 0)
  return provider
}

function createGradientProvider(settings: SkySettings): SkyProvider {
  const { lighting, solar } = createLightingState(settings)
  const uniforms = createShaderUniforms(solar, settings)
  const celestial = createCelestialSamplers(uniforms)

  const gradientRadiance = (rawDirection: Vec3Node, includeGround = true): Vec3Node =>
    TSL.Fn<Vec3Node>(() => {
      const direction = TSL.normalize(rawDirection)
      const upper = TSL.smoothstep(-0.12, -0.005, direction.y)
      const altitude = TSL.pow(TSL.max(direction.y, 0), 0.45)
      const day = TSL.mix(TSL.vec3(0.55, 0.69, 0.82), TSL.vec3(0.065, 0.22, 0.57), altitude)
      const dusk = TSL.mix(TSL.vec3(0.72, 0.2, 0.075), TSL.vec3(0.07, 0.055, 0.17), altitude)
      const night = TSL.mix(TSL.vec3(0.015, 0.02, 0.045), TSL.vec3(0.002, 0.005, 0.018), altitude)
      const sky = day
        .mul(uniforms.daylight)
        .add(dusk.mul(uniforms.twilight))
        .add(night.mul(uniforms.night))
      if (!includeGround) return sky
      const ground = TSL.vec3(0.025, 0.022, 0.021).mul(
        uniforms.daylight.add(uniforms.night.mul(0.1)),
      )
      return TSL.mix(ground, sky, upper)
    })()

  const reflectionRadiance: SkySampler = (rawDirection) =>
    TSL.Fn<Vec3Node>(() => {
      const direction = TSL.normalize(rawDirection) as Vec3Node
      return gradientRadiance(direction).add(
        celestial.celestialRadiance(direction, tslFloat(0) as FloatNode),
      )
    })()

  const skyRadiance: SkySampler = (rawDirection) =>
    TSL.Fn<Vec3Node>(() => {
      const direction = TSL.normalize(rawDirection) as Vec3Node
      const physical = reflectionRadiance(direction)
      const sunMask = TSL.smoothstep(
        TSL.cos(uniforms.sunRadius.mul(1.12)),
        TSL.cos(uniforms.sunRadius.mul(0.88)),
        TSL.clamp(TSL.dot(direction, uniforms.sunDirection), -1, 1),
      ).mul(uniforms.sunVisibility)
      return selectDebug(
        uniforms,
        physical,
        direction,
        TSL.vec3(0) as Vec3Node,
        TSL.vec3(0) as Vec3Node,
        TSL.vec3(0) as Vec3Node,
        TSL.vec3(sunMask) as Vec3Node,
        TSL.vec3(0) as Vec3Node,
      )
    })()

  const provider: SkyProvider = {
    ...lighting,
    skyRadiance,
    reflectionRadiance,
    fogRadiance: (direction) => gradientRadiance(direction, false),
    environmentNode: new AnalyticEnvironmentNode(reflectionRadiance, gradientRadiance) as Vec3Node,
    update(next, cloudTime) {
      updateLighting(provider, solar, next)
      updateShaderUniforms(uniforms, solar, next, cloudTime)
    },
  }
  provider.update(settings, 0)
  return provider
}

export function createSkyProvider(settings: SkySettings): SkyProvider {
  return settings.provider === 'gradient'
    ? createGradientProvider(settings)
    : createProceduralProvider(settings)
}

/** The caller retains ownership of texture; this provider never disposes it. */
export function createCubemapSkyProvider(texture: CubeTexture, settings: SkySettings): SkyProvider {
  const { lighting, solar } = createLightingState(settings)
  const debugMode = TSL.uniform(DEBUG_INDEX[settings.debug])
  const sample: SkySampler = (rawDirection) =>
    TSL.Fn<Vec3Node>(() => {
      const direction = TSL.normalize(rawDirection) as Vec3Node
      return TSL.cubeTexture(texture, direction).rgb as Vec3Node
    })()
  const skyRadiance: SkySampler = (rawDirection) =>
    TSL.Fn<Vec3Node>(() => {
      const direction = TSL.normalize(rawDirection) as Vec3Node
      const physical = sample(direction)
      const result = TSL.vec3(physical).toVar()
      TSL.If(debugMode.equal(1), () => {
        result.assign(direction.mul(0.5).add(0.5))
      })
      TSL.If(debugMode.greaterThanEqual(2).and(debugMode.lessThanEqual(6)), () => {
        result.assign(TSL.vec3(0))
      })
      TSL.If(debugMode.equal(7), () => {
        result.assign(debugLuminance(physical))
      })
      return result as Vec3Node
    })()

  const provider: SkyProvider = {
    ...lighting,
    skyRadiance,
    reflectionRadiance: sample,
    // A cubemap has no separable baked sun/cloud layers; fog uses the same linear source.
    fogRadiance: sample,
    // Passing the texture node directly lets Three's EnvironmentNode own PMREM caching
    // and provide the correct radiance/irradiance directions and roughness levels.
    environmentNode: TSL.cubeTexture(texture) as unknown as Vec3Node,
    update(next) {
      updateLighting(provider, solar, next)
      debugMode.value = DEBUG_INDEX[next.debug]
    },
  }
  provider.update(settings, 0)
  return provider
}
