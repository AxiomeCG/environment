'use client'

import { useEffect, useLayoutEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Color, type Group } from 'three'
import * as TSL from 'three/tsl'
import type { MeshStandardNodeMaterial, Node } from 'three/webgpu'
import { createGrassBladeMaterial } from '../ground-cover/render/blade-material'
import {
  createGrassBladePosition,
  createGrassBladeShading,
  GRASS_BLADE_PROGRESS,
} from '../ground-cover/render/blade-nodes'
import {
  createGrassTiles,
  getGrassTilesRuntime,
  updateGrassTileLod,
} from '../ground-cover/render/grass-tiles'
import type { GrassCandidateVisitor } from '../ground-cover/scatter'
import type { SiteBounds } from '../ground-cover/paint-field'
import type {
  NaturalLowVegetationPlacement,
  NaturalSurroundingsVegetationProps,
} from './natural-vegetation'
import { dryNaturalHeightAt, signedBoundaryDistance } from './natural-spatial'
import type { NaturalSurroundingsPresetId } from './presets'
import { seededRange, seededUnit } from './seeded-random'

export const NATURAL_GRASS_TILE_SIZE = 64
export const NATURAL_GRASS_BLADES_PER_PATCH = Object.freeze({
  'open-meadow': 30,
  'woodland-edge': 36,
} satisfies Record<NaturalSurroundingsPresetId, number>)
export const NATURAL_GRASS_BLADE_BUDGET = 28_672

const BLADE_DIMENSIONS = Object.freeze({
  bladeWidth: 0.042,
  bladeHeight: 0.3,
  bladeWidthVariation: 32,
  bladeHeightVariation: 38,
})
const varyingFloat = TSL.varying as unknown as (node: Node<'float'>, name: string) => Node<'float'>

export type NaturalGrassCandidateContext = Readonly<{
  boundary: NaturalSurroundingsVegetationProps['boundary']
  heightAt: NaturalSurroundingsVegetationProps['heightAt']
  waterLevelAt: NaturalSurroundingsVegetationProps['waterLevelAt']
  patches: readonly NaturalLowVegetationPlacement[]
  presetId: NaturalSurroundingsPresetId
}>

export function visitNaturalGrassCandidates(
  context: NaturalGrassCandidateContext,
  visitor: GrassCandidateVisitor,
): number {
  const bladesPerPatch = NATURAL_GRASS_BLADES_PER_PATCH[context.presetId]
  let accepted = 0
  for (const patch of context.patches) {
    for (let blade = 0; blade < bladesPerPatch; blade += 1) {
      if (accepted >= NATURAL_GRASS_BLADE_BUDGET) return accepted
      const domain = `${patch.id}:blade:${blade}`
      const angle = seededRange(patch.id, `${domain}:angle`, -Math.PI, Math.PI)
      const radius =
        Math.sqrt(seededUnit(patch.id, `${domain}:radius`)) *
        (context.presetId === 'woodland-edge' ? 0.95 : 1.15) *
        patch.scale
      const x = patch.position[0] + Math.cos(angle) * radius
      const z = patch.position[2] + Math.sin(angle) * radius
      if (signedBoundaryDistance(context.boundary, x, z) < 0.6) continue
      const y = dryNaturalHeightAt(x, z, context.heightAt, context.waterLevelAt)
      if (y === null) continue
      visitor(
        x,
        y,
        z,
        seededRange(patch.id, `${domain}:yaw`, -Math.PI, Math.PI),
        seededRange(patch.id, `${domain}:width`, 0.68, 1.34),
        seededRange(
          patch.id,
          `${domain}:height`,
          context.presetId === 'woodland-edge' ? 0.58 : 0.72,
          context.presetId === 'woodland-edge' ? 1.18 : 1.38,
        ) * patch.scale,
        seededUnit(patch.id, `${domain}:density`),
        seededRange(patch.id, `${domain}:tint`, -1, 1),
      )
      accepted += 1
    }
  }
  return accepted
}

function boundsOfPatches(patches: readonly NaturalLowVegetationPlacement[]): SiteBounds {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const patch of patches) {
    minX = Math.min(minX, patch.position[0])
    maxX = Math.max(maxX, patch.position[0])
    minZ = Math.min(minZ, patch.position[2])
    maxZ = Math.max(maxZ, patch.position[2])
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }
  return { minX: minX - 2, maxX: maxX + 2, minZ: minZ - 2, maxZ: maxZ + 2 }
}

function createNaturalGrassMaterial(
  presetId: NaturalSurroundingsPresetId,
): MeshStandardNodeMaterial {
  const densityThreshold = TSL.attribute<'float'>('grassDensityThreshold', 'float')
  const tintRandom = varyingFloat(
    TSL.attribute<'float'>('grassTintVariation', 'float'),
    'vNaturalGrassTintVariation',
  )
  const heightScale = TSL.uniform(1)
  const windInfluence = TSL.uniform(presetId === 'woodland-edge' ? 0.72 : 1)
  const curvedPosition = createGrassBladePosition({
    heightScale,
    restBend: TSL.uniform(presetId === 'woodland-edge' ? 0.32 : 0.22),
    windStrength: TSL.float(1),
    windInfluence,
  })
  const shading = createGrassBladeShading(tintRandom)
  const base = TSL.uniform(new Color(presetId === 'woodland-edge' ? '#38583a' : '#688343'))
  const tip = TSL.uniform(new Color(presetId === 'woodland-edge' ? '#78905a' : '#a4b965'))
  const tint = TSL.clamp(TSL.float(1).add(tintRandom.mul(0.1)), 0.82, 1.12)
  const tipMix = TSL.smoothstep(0.12, 0.92, GRASS_BLADE_PROGRESS)
  const color = TSL.mix(base, tip, tipMix).mul(tint).mul(shading.rootShade)

  return createGrassBladeMaterial({
    position: curvedPosition,
    visible: TSL.step(densityThreshold, 0.92).greaterThan(0.5),
    color,
    emissive: TSL.vec3(tip.r, tip.g, tip.b).mul(shading.transmission).mul(tipMix),
    normal: shading.normal,
  })
}

function disposeNaturalGrass(group: Group): void {
  const runtime = getGrassTilesRuntime(group)
  if (runtime) {
    for (const tile of runtime.tiles) {
      tile.full.geometry.dispose()
      tile.mid.geometry.dispose()
      tile.far.geometry.dispose()
    }
  }
  group.clear()
}

export function NaturalGrass({
  boundary,
  heightAt,
  waterLevelAt,
  patches,
  presetId,
}: NaturalGrassCandidateContext) {
  const material = useMemo(() => createNaturalGrassMaterial(presetId), [presetId])
  const candidates = useMemo(
    () => (visitor: GrassCandidateVisitor) => {
      visitNaturalGrassCandidates({ boundary, heightAt, waterLevelAt, patches, presetId }, visitor)
    },
    [boundary, heightAt, waterLevelAt, patches, presetId],
  )
  const group = useMemo(() => {
    const next = createGrassTiles(
      BLADE_DIMENSIONS,
      boundary,
      boundsOfPatches(patches),
      null,
      material,
      { candidates, tileSize: NATURAL_GRASS_TILE_SIZE },
    )
    const runtime = getGrassTilesRuntime(next)
    next.name = 'environment-natural-gpu-grass'
    next.userData = {
      bladeCount: runtime?.tiles.reduce((sum, tile) => sum + tile.candidateCount, 0) ?? 0,
      tileCount: runtime?.tiles.length ?? 0,
      maximumVisibleDrawCallCount: runtime?.tiles.length ?? 0,
    }
    return next
  }, [boundary, candidates, material, patches])
  const invalidate = useThree((state) => state.invalidate)

  useLayoutEffect(() => {
    invalidate()
  }, [group, invalidate])
  useEffect(() => () => disposeNaturalGrass(group), [group])
  useEffect(() => () => material.dispose(), [material])
  useFrame(({ camera, size, gl }) => {
    updateGrassTileLod(group, camera, size.height * gl.getPixelRatio())
  }, 1)

  return <primitive object={group} dispose={null} />
}
