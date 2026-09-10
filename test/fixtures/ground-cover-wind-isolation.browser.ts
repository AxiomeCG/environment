import { type GeometryContext, SiteNode } from '@pascal-app/core'
import { time as shaderTime } from 'three/tsl'
import {
  AmbientLight,
  Color,
  Group,
  type Material,
  type Object3D,
  OrthographicCamera,
  RenderTarget,
  Scene,
  WebGPURenderer,
} from 'three/webgpu'
import { buildGrassFieldGeometry, updateGrassFieldUniforms } from '../../src/ground-cover/geometry'
import { GrassFieldNode } from '../../src/ground-cover/schema'

const SIZE = 256
const MOTION_PIXEL_THRESHOLD = 12
const SAMPLE_TIMES = [0.25, 0.85] as const

type Subject = 'blade' | 'flower'
type Frame = Record<Subject, Uint8Array>
type Waveform = Record<Subject, readonly [Uint8Array, Uint8Array]>
type WaveformDifference = Record<Subject, readonly [number, number]>

const strengthParameter = new URLSearchParams(window.location.search).get('strength')
const referenceStrength = strengthParameter === null ? 200 : Number(strengthParameter)
if (!Number.isFinite(referenceStrength) || referenceStrength <= 0 || referenceStrength > 200) {
  throw new Error(`Expected strength query parameter in (0, 200], received ${strengthParameter}`)
}

const output = document.querySelector<HTMLPreElement>('#output')
if (!output) throw new Error('Missing replay output element')
if (!('gpu' in navigator)) {
  output.dataset.status = 'unsupported'
  output.textContent = 'UNSUPPORTED: navigator.gpu is unavailable'
  throw new Error('WebGPU is required for the wind-isolation replay')
}

const site = SiteNode.parse({
  id: 'site_wind_replay',
  type: 'site',
  polygon: {
    type: 'polygon',
    points: [
      [-0.2, -0.2],
      [0.2, -0.2],
      [0.2, 0.2],
      [-0.2, 0.2],
    ],
  },
})
const context: GeometryContext = {
  resolve: () => undefined,
  children: [],
  siblings: [],
  parent: site,
}
const staticNode = GrassFieldNode.parse({
  id: 'grass-field_static',
  parentId: site.id,
  density: 100,
  flowerDensity: 100,
  bladeRestBend: 0,
  windStrength: 0,
  grassWindInfluence: 300,
})
const windyNode = GrassFieldNode.parse({
  id: 'grass-field_windy',
  parentId: site.id,
  density: 100,
  flowerDensity: 100,
  bladeRestBend: 0,
  windStrength: referenceStrength,
  grassWindInfluence: 300,
})
const updatedStaticNode = GrassFieldNode.parse({
  ...staticNode,
  windStrength: 150,
  grassWindInfluence: 175,
})

const scene = new Scene()
scene.background = new Color(0xff00ff)
scene.add(new AmbientLight(0xffffff, 4))
const singleNodeReference = buildGrassFieldGeometry(windyNode, context)
const fields: Group[] = [singleNodeReference]
scene.add(singleNodeReference)
let staticField: Group | undefined
let windyField: Group | undefined

const camera = new OrthographicCamera(-0.35, 0.35, 0.5, -0.1, 0.01, 4)
camera.position.set(0, 0, 1)
camera.lookAt(0, 0, 0)
camera.updateMatrixWorld(true)

const renderer = new WebGPURenderer({ antialias: false })
renderer.setPixelRatio(1)
renderer.setSize(SIZE, SIZE, false)
await renderer.init()
const target = new RenderTarget(SIZE, SIZE)
let sampleSeconds = 0
let staticFieldDisposed = false
shaderTime.onRenderUpdate(() => sampleSeconds)

function selectSubject(field: Group, subject: Subject) {
  for (const candidate of fields) candidate.visible = false
  field.visible = true
  const bladeTiles = field.children.filter(({ name }) => name === 'grass-field-tile')
  const flowers = field.getObjectByName('grass-field-flowers')
  const ground = field.getObjectByName('grass-field-ground')
  if (bladeTiles.length === 0 || !flowers || !ground || flowers.children.length === 0) {
    throw new Error('Expected populated blade and flower geometry')
  }
  for (const tile of bladeTiles) tile.visible = subject === 'blade'
  flowers.visible = subject === 'flower'
  ground.visible = false
}

async function capture(field: Group, subject: Subject, atSeconds: number): Promise<Uint8Array> {
  sampleSeconds = atSeconds
  selectSubject(field, subject)
  renderer.setRenderTarget(target)
  await renderer.renderAsync(scene, camera)
  const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE)
  if (!(pixels instanceof Uint8Array)) {
    throw new Error(`Expected RGBA8 readback, received ${pixels.constructor.name}`)
  }
  return pixels
}

async function captureFrame(field: Group, atSeconds: number): Promise<Frame> {
  return {
    blade: await capture(field, 'blade', atSeconds),
    flower: await capture(field, 'flower', atSeconds),
  }
}

async function captureWaveform(field: Group): Promise<Waveform> {
  const first = await captureFrame(field, SAMPLE_TIMES[0])
  const second = await captureFrame(field, SAMPLE_TIMES[1])
  return {
    blade: [first.blade, second.blade],
    flower: [first.flower, second.flower],
  }
}

function changedPixelCount(first: Uint8Array, second: Uint8Array): number {
  let changedPixels = 0
  for (let offset = 0; offset < first.length; offset += 4) {
    const difference =
      Math.abs(first[offset]! - second[offset]!) +
      Math.abs(first[offset + 1]! - second[offset + 1]!) +
      Math.abs(first[offset + 2]! - second[offset + 2]!)
    if (difference > MOTION_PIXEL_THRESHOLD) changedPixels += 1
  }
  return changedPixels
}

function differentByteCount(first: Uint8Array, second: Uint8Array): number {
  let differentBytes = 0
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) differentBytes += 1
  }
  return differentBytes
}

function foregroundPixelCount(pixels: Uint8Array): number {
  const background = [pixels[0]!, pixels[1]!, pixels[2]!] as const
  let foregroundPixels = 0
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const difference =
      Math.abs(pixels[offset]! - background[0]) +
      Math.abs(pixels[offset + 1]! - background[1]) +
      Math.abs(pixels[offset + 2]! - background[2])
    if (difference > MOTION_PIXEL_THRESHOLD) foregroundPixels += 1
  }
  return foregroundPixels
}


function hashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function waveformHashes(waveform: Waveform) {
  return {
    blade: [hashBytes(waveform.blade[0]), hashBytes(waveform.blade[1])],
    flower: [hashBytes(waveform.flower[0]), hashBytes(waveform.flower[1])],
  }
}

function waveformDifference(reference: Waveform, actual: Waveform): WaveformDifference {
  return {
    blade: [
      differentByteCount(reference.blade[0], actual.blade[0]),
      differentByteCount(reference.blade[1], actual.blade[1]),
    ],
    flower: [
      differentByteCount(reference.flower[0], actual.flower[0]),
      differentByteCount(reference.flower[1], actual.flower[1]),
    ],
  }
}

function disposeField(field: Object3D): void {
  scene.remove(field)
  const geometries = new Set<{ dispose(): void }>()
  const materials = new Set<Material>()
  field.traverse((object) => {
    const renderable = object as Object3D & {
      geometry?: { dispose(): void }
      material?: Material | Material[]
    }
    if (renderable.geometry) geometries.add(renderable.geometry)
    const objectMaterials = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material
        ? [renderable.material]
        : []
    for (const material of objectMaterials) materials.add(material)
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
}

try {
  const referenceWaveform = await captureWaveform(singleNodeReference)
  const referenceHashes = waveformHashes(referenceWaveform)
  const referenceCoverage = {
    blade: referenceWaveform.blade.map(foregroundPixelCount),
    flower: referenceWaveform.flower.map(foregroundPixelCount),
  }
  output.dataset.referenceHashes = JSON.stringify(referenceHashes)
  output.dataset.referenceStrength = String(referenceStrength)
  output.dataset.referenceCoverage = JSON.stringify(referenceCoverage)
  output.textContent = `REFERENCE\n${JSON.stringify(
    { sampleTimes: SAMPLE_TIMES, referenceStrength, referenceHashes, referenceCoverage },
    null,
    2,
  )}`
  windyField = buildGrassFieldGeometry(windyNode, context)
  staticField = buildGrassFieldGeometry(staticNode, context)
  fields.push(windyField, staticField)
  scene.add(windyField, staticField)

  const referenceAfterConstruction = await captureWaveform(singleNodeReference)
  const siblingBeforeUpdate = await captureWaveform(windyField)
  const staticBeforeUpdate = await captureWaveform(staticField)

  if (!updateGrassFieldUniforms(staticField, updatedStaticNode)) {
    throw new Error('Unable to update the static sibling in place')
  }
  const staticAfterUpdate = await captureWaveform(staticField)
  const siblingAfterUpdate = await captureWaveform(windyField)

  disposeField(staticField)
  staticFieldDisposed = true
  const siblingAfterDisposal = await captureWaveform(windyField)

  const referenceMotion = {
    blade: changedPixelCount(referenceWaveform.blade[0], referenceWaveform.blade[1]),
    flower: changedPixelCount(referenceWaveform.flower[0], referenceWaveform.flower[1]),
  }
  const staticCoverage = {
    blade: staticBeforeUpdate.blade.map(foregroundPixelCount),
    flower: staticBeforeUpdate.flower.map(foregroundPixelCount),
  }
  const staticStillness = {
    blade: differentByteCount(staticBeforeUpdate.blade[0], staticBeforeUpdate.blade[1]),
    flower: differentByteCount(staticBeforeUpdate.flower[0], staticBeforeUpdate.flower[1]),
  }
  const updatedCoverage = {
    blade: staticAfterUpdate.blade.map(foregroundPixelCount),
    flower: staticAfterUpdate.flower.map(foregroundPixelCount),
  }
  const updatedMotion = {
    blade: changedPixelCount(staticAfterUpdate.blade[0], staticAfterUpdate.blade[1]),
    flower: changedPixelCount(staticAfterUpdate.flower[0], staticAfterUpdate.flower[1]),
  }
  const staticLiveChange = {
    blade: [
      changedPixelCount(staticBeforeUpdate.blade[0], staticAfterUpdate.blade[0]),
      changedPixelCount(staticBeforeUpdate.blade[1], staticAfterUpdate.blade[1]),
    ],
    flower: [
      changedPixelCount(staticBeforeUpdate.flower[0], staticAfterUpdate.flower[0]),
      changedPixelCount(staticBeforeUpdate.flower[1], staticAfterUpdate.flower[1]),
    ],
  }
  const constructionDifference = waveformDifference(
    referenceWaveform,
    referenceAfterConstruction,
  )
  const beforeReferenceDifference = waveformDifference(referenceWaveform, siblingBeforeUpdate)
  const afterUpdateDifference = waveformDifference(referenceWaveform, siblingAfterUpdate)
  const afterDisposalDifference = waveformDifference(referenceWaveform, siblingAfterDisposal)
  const exactWaveformMatches = [
    ...constructionDifference.blade,
    ...constructionDifference.flower,
    ...beforeReferenceDifference.blade,
    ...beforeReferenceDifference.flower,
    ...afterUpdateDifference.blade,
    ...afterUpdateDifference.flower,
    ...afterDisposalDifference.blade,
    ...afterDisposalDifference.flower,
  ].every((difference) => difference === 0)
  const pass =
    referenceCoverage.blade.every((pixels) => pixels > 0) &&
    referenceCoverage.flower.every((pixels) => pixels > 0) &&
    staticCoverage.blade.every((pixels) => pixels > 0) &&
    staticCoverage.flower.every((pixels) => pixels > 0) &&
    updatedCoverage.blade.every((pixels) => pixels > 0) &&
    updatedCoverage.flower.every((pixels) => pixels > 0) &&
    referenceMotion.blade >= 8 &&
    referenceMotion.flower >= 8 &&
    staticStillness.blade === 0 &&
    staticStillness.flower === 0 &&
    updatedMotion.blade >= 8 &&
    updatedMotion.flower >= 8 &&
    staticLiveChange.blade.every((pixels) => pixels >= 8) &&
    staticLiveChange.flower.every((pixels) => pixels >= 8) &&
    exactWaveformMatches

  const evidence = {
    pass,
    backend: renderer.backend.constructor.name,
    sampleTimes: SAMPLE_TIMES,
    referenceStrength,
    referenceHashes,
    referenceCoverage,
    referenceMotion,
    staticStillness,
    staticCoverage,
    updatedCoverage,
    updatedMotion,
    staticLiveChange,
    constructionDifference,
    beforeReferenceDifference,
    afterUpdateDifference,
    afterDisposalDifference,
  }
  output.dataset.status = pass ? 'pass' : 'fail'
  output.textContent = `${pass ? 'PASS' : 'FAIL'}\n${JSON.stringify(evidence, null, 2)}`
  document.title = pass ? 'PASS wind isolation' : 'FAIL wind isolation'
  if (!pass) throw new Error('Ground-cover GPU wind isolation replay failed')
} finally {
  shaderTime.onRenderUpdate(({ time }) => time)
  if (staticField && !staticFieldDisposed) disposeField(staticField)
  if (windyField) disposeField(windyField)
  disposeField(singleNodeReference)
  target.dispose()
  renderer.dispose()
}
