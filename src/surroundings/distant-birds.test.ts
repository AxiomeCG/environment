import { describe, expect, test } from 'bun:test'
import { create } from '@react-three/test-renderer'
import { Activity, createElement } from 'react'
import type { InstancedMesh } from 'three'
import { Mesh, Vector3 } from 'three'
import {
  buildDistantBirdFlightPlan,
  createDistantBirdInstances,
  createDistantBirdUpdateContext,
  disposeDistantBirdInstances,
  DistantBirds,
  DISTANT_BIRD_COUNT,
  DISTANT_BIRD_TRIANGLES,
  evaluateDistantBirdFlight,
  updateDistantBirdInstances,
} from './distant-birds'

const BOUNDARY = [
  [-18, -14],
  [18, -14],
  [18, 14],
  [-18, 14],
] as const
const heightAt = (x: number, z: number) => 18
  + Math.sin(x / 72) * 14
  + Math.cos(z / 83) * 11

describe('distant bird flight', () => {
  test('derives deterministic seeded paths which close exactly after one orbit', () => {
    const first = buildDistantBirdFlightPlan({ boundary: BOUNDARY, heightAt, seed: 'bird-proof' })
    const repeated = buildDistantBirdFlightPlan({ boundary: BOUNDARY, heightAt, seed: 'bird-proof' })
    const changed = buildDistantBirdFlightPlan({ boundary: BOUNDARY, heightAt, seed: 'bird-proof-2' })

    expect(first).toEqual(repeated)
    expect(first).not.toEqual(changed)
    expect(first.birds).toHaveLength(DISTANT_BIRD_COUNT)
    for (const bird of first.birds) {
      const start = evaluateDistantBirdFlight(bird, 0)
      const end = evaluateDistantBirdFlight(bird, bird.duration)
      for (let axis = 0; axis < 3; axis += 1) {
        expect(end.position[axis]!).toBeCloseTo(start.position[axis]!, 9)
        expect(end.rotation[axis]!).toBeCloseTo(start.rotation[axis]!, 9)
      }
      expect(end.wingLift).toBeCloseTo(start.wingLift, 9)
    }
  })

  test('followers remain on two trailing arms through turns without rigid wing synchrony', () => {
    for (const seed of ['flock-turns', 'flock-wide', 'flock-return']) {
      const plan = buildDistantBirdFlightPlan({ boundary: BOUNDARY, heightAt, seed })
      const leader = plan.birds[0]!
      const followers = plan.birds.filter(bird => bird.formation?.rank)
      expect(followers.length).toBeGreaterThanOrEqual(6)
      expect(followers.length).toBeLessThanOrEqual(8)
      expect(plan.birds.some(bird => !bird.formation)).toBe(true)
      for (let sample = 0; sample < 128; sample++) {
        const time = leader.duration * sample / 128
        const lead = evaluateDistantBirdFlight(leader, time)
        const forwardX = Math.sin(lead.rotation[1]), forwardZ = Math.cos(lead.rotation[1])
        const poses = followers.map(bird => evaluateDistantBirdFlight(bird, time))
        for (let index = 0; index < followers.length; index++) {
          const bird = followers[index]!, pose = poses[index]!, formation = bird.formation!
          const dx = pose.position[0] - lead.position[0], dz = pose.position[2] - lead.position[2]
          expect(dx * forwardX + dz * forwardZ).toBeLessThan(-formation.rank)
          expect((dx * forwardZ - dz * forwardX) * formation.side).toBeGreaterThan(formation.rank * 2)
          // Heading follows each offset curve rather than just copying the leader's yaw.
          const before = evaluateDistantBirdFlight(bird, time - 0.001)
          const after = evaluateDistantBirdFlight(bird, time + 0.001)
          const vx = after.position[0] - before.position[0], vz = after.position[2] - before.position[2]
          expect((vx * Math.sin(pose.rotation[1]) + vz * Math.cos(pose.rotation[1])) / Math.hypot(vx, vz)).toBeGreaterThan(0.99999)
          for (let other = 0; other < index; other++) {
            expect(Math.hypot(pose.position[0] - poses[other]!.position[0], pose.position[2] - poses[other]!.position[2])).toBeGreaterThan(3)
          }
        }
      }
      const wings = followers.map(bird => evaluateDistantBirdFlight(bird, 2).wingLift)
      expect(Math.max(...wings) - Math.min(...wings)).toBeGreaterThan(0.05)
    }
  })

  test('keeps every silhouette inside whole-path bounds and above sampled terrain', () => {
    const plan = buildDistantBirdFlightPlan({ boundary: BOUNDARY, heightAt, seed: 'clearance-proof' })
    const mesh = createDistantBirdInstances(plan)
    const silhouetteRadius = mesh.geometry.boundingSphere!.radius

    try {
      for (const bird of plan.birds) {
        for (let sample = 0; sample < 256; sample += 1) {
          const pose = evaluateDistantBirdFlight(bird, bird.duration * sample / 256)
          const radius = silhouetteRadius * pose.scale
          expect(pose.position[0] - radius).toBeGreaterThanOrEqual(plan.bounds.min[0])
          expect(pose.position[1] - radius).toBeGreaterThanOrEqual(plan.bounds.min[1])
          expect(pose.position[2] - radius).toBeGreaterThanOrEqual(plan.bounds.min[2])
          expect(pose.position[0] + radius).toBeLessThanOrEqual(plan.bounds.max[0])
          expect(pose.position[1] + radius).toBeLessThanOrEqual(plan.bounds.max[1])
          expect(pose.position[2] + radius).toBeLessThanOrEqual(plan.bounds.max[2])
          expect(pose.position[1] - radius - heightAt(pose.position[0], pose.position[2]))
            .toBeGreaterThanOrEqual(bird.minimumClearance - 0.1)
        }
      }
    } finally {
      disposeDistantBirdInstances(mesh)
    }
  })

  test('uses one bounded opaque batch and repeated fixed-time seeks do not drift', () => {
    const plan = buildDistantBirdFlightPlan({ boundary: BOUNDARY, heightAt, seed: 'seek-proof' })
    const mesh = createDistantBirdInstances(plan)
    const context = createDistantBirdUpdateContext(mesh)

    try {
      expect(mesh.count).toBe(DISTANT_BIRD_COUNT)
      expect(mesh.geometry.getAttribute('position').count / 3).toBe(DISTANT_BIRD_TRIANGLES)
      expect(mesh.geometry.morphAttributes.position).toHaveLength(1)
      if (Array.isArray(mesh.material)) throw new Error('Birds must share one material')
      expect(mesh.material.transparent).toBe(false)
      expect(mesh.castShadow).toBe(false)
      expect(mesh.receiveShadow).toBe(false)
      expect(mesh.boundingSphere).not.toBeNull()
      expect(mesh.userData.pascalExport).toBe('strip')

      updateDistantBirdInstances(mesh, plan, 12.5, context)
      const movingMatrices = Array.from(mesh.instanceMatrix.array)
      const movingWings = Array.from(mesh.morphTexture!.source.data.data!)
      updateDistantBirdInstances(mesh, plan, 12.5, context)
      expect(Array.from(mesh.instanceMatrix.array)).toEqual(movingMatrices)
      expect(Array.from(mesh.morphTexture!.source.data.data!)).toEqual(movingWings)

      updateDistantBirdInstances(mesh, plan, 13.5, context)
      expect(Array.from(mesh.instanceMatrix.array)).not.toEqual(movingMatrices)
    } finally {
      disposeDistantBirdInstances(mesh)
    }
  })
  test('preserves the paused wing pose after effect cleanup and reactivation', async () => {
    const props = { boundary: BOUNDARY, heightAt, seed: 'reactivation-proof', moving: false }
    const birds = createElement(DistantBirds, props)
    const content = (mode: 'visible' | 'hidden') => createElement(Activity, { mode, children: birds })
    const renderer = await create(content('visible'))
    try {
      const mesh = renderer.scene.find(
        node => node.instance.name === 'environment-distant-bird-instances',
      ).instance as InstancedMesh
      const posedBird = new Mesh(mesh.geometry, mesh.material)
      mesh.getMorphAt(0, posedBird)
      const initial = [...posedBird.morphTargetInfluences!]

      await renderer.update(content('hidden'))
      await renderer.update(content('visible'))
      await renderer.advanceFrames(1, 1)

      mesh.getMorphAt(0, posedBird)
      expect(posedBird.morphTargetInfluences).toEqual(initial)
    } finally {
      await renderer.unmount()
    }
  })

  test('raises the wings without stretching the silhouette in its ground plane', () => {
    const plan = buildDistantBirdFlightPlan({ boundary: BOUNDARY, heightAt, seed: 'wing-shape-proof' })
    const mesh = createDistantBirdInstances(plan)
    const posedBird = new Mesh(mesh.geometry, mesh.material)
    const position = mesh.geometry.getAttribute('position')
    const vertex = new Vector3()
    let maximumLift = 0
    try {
      posedBird.morphTargetInfluences![0] = 1
      for (let index = 0; index < position.count; index += 1) {
        posedBird.getVertexPosition(index, vertex)
        expect(vertex.x).toBeCloseTo(position.getX(index), 6)
        expect(vertex.z).toBeCloseTo(position.getZ(index), 6)
        maximumLift = Math.max(maximumLift, vertex.y - position.getY(index))
      }
      expect(maximumLift).toBeCloseTo(0.64, 6)
    } finally {
      disposeDistantBirdInstances(mesh)
    }
  })


  test('keeps the mounted batch still whenever presentation motion is paused', async () => {
    const props = { boundary: BOUNDARY, heightAt, seed: 'pause-proof' }
    const renderer = await create(createElement(DistantBirds, { ...props, moving: false }))
    try {
      const mesh = renderer.scene.find(
        node => node.instance.name === 'environment-distant-bird-instances',
      ).instance as InstancedMesh
      const initial = Array.from(mesh.instanceMatrix.array)
      await renderer.advanceFrames(3, 1)
      expect(Array.from(mesh.instanceMatrix.array)).toEqual(initial)

      await renderer.update(createElement(DistantBirds, { ...props, moving: true }))
      await renderer.advanceFrames(1, 1)
      expect(Array.from(mesh.instanceMatrix.array)).not.toEqual(initial)

      await renderer.update(createElement(DistantBirds, { ...props, moving: false }))
      const paused = Array.from(mesh.instanceMatrix.array)
      await renderer.advanceFrames(3, 1)
      expect(Array.from(mesh.instanceMatrix.array)).toEqual(paused)
    } finally {
      await renderer.unmount()
    }
  })
})
