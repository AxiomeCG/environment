import { useFrame, useThree } from '@react-three/fiber'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import { AdditiveBlending, CylinderGeometry, DoubleSide, Group, Mesh, Object3D, SphereGeometry, SpotLight } from 'three'
import { normalView, positionView, smoothstep, uv } from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { SURROUNDINGS_NIGHT_FACTOR } from './night-lighting'
import type { LighthousePlan } from './third-ring'

const BEAM_LENGTH = 180
const BEAM_RADIUS = 14
const ROTATION_SPEED = Math.PI / 10

export function LighthouseBeacon({ plan }: { plan: LighthousePlan }) {
  const renderPaused = useViewer((state) => state.renderPaused)
  const getThree = useThree((state) => state.get)
  const resources = useMemo(() => {
    const root = new Group()
    root.name = 'environment-lighthouse-beacon'
    root.position.set(plan.position[0], plan.position[1] + plan.height + 2, plan.position[2])
    root.rotation.y = plan.rotationY
    // Hiding a light ancestor changes Three.js's light cache key and rebuilds scene shaders.
    // Keep the light registered; night uniforms hide the visuals and zero its intensity.
    root.userData.pascalExport = 'strip'

    const head = new Group()
    head.rotation.x = 0.035
    root.add(head)

    const beamMaterial = new MeshBasicNodeMaterial({
      color: '#fff0c5',
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      fog: true,
      toneMapped: false,
    })
    const opacity = normalView.dot(positionView.normalize()).abs().pow(1.5)
      .mul(smoothstep(0, 0.85, uv().y)).mul(SURROUNDINGS_NIGHT_FACTOR).mul(0.28)
    beamMaterial.opacityNode = opacity
    beamMaterial.maskNode = opacity.greaterThan(0.002)
    const beamGeometry = new CylinderGeometry(0.22, BEAM_RADIUS, BEAM_LENGTH, 32, 1, true)
    const beam = new Mesh(beamGeometry, beamMaterial)
    beam.name = 'environment-lighthouse-beam'
    beam.rotation.x = -Math.PI / 2
    beam.position.z = BEAM_LENGTH / 2 + 2
    beam.raycast = () => {}
    head.add(beam)

    const lensGeometry = new SphereGeometry(0.38, 12, 8)
    const lensMaterial = new MeshBasicNodeMaterial({ color: '#fff0c5', toneMapped: false })
    lensMaterial.maskNode = SURROUNDINGS_NIGHT_FACTOR.greaterThan(0)
    const lens = new Mesh(lensGeometry, lensMaterial)
    lens.position.z = 2
    lens.raycast = () => {}
    head.add(lens)

    // The target must share the rotating head's world transform, not sit at the scene origin.
    const target = new Object3D()
    target.position.z = BEAM_LENGTH + 2
    const light = new SpotLight('#fff0c5', 0, BEAM_LENGTH * 2, Math.atan(BEAM_RADIUS / BEAM_LENGTH), 0.6, 2)
    light.name = 'environment-lighthouse-spotlight'
    light.position.z = 2
    light.target = target
    head.add(light, target)
    return { root, light, beamGeometry, beamMaterial, lensGeometry, lensMaterial }
  }, [plan])

  useEffect(() => () => {
    resources.beamGeometry.dispose()
    resources.beamMaterial.dispose()
    resources.lensGeometry.dispose()
    resources.lensMaterial.dispose()
    resources.light.dispose()
  }, [resources])
  useEffect(() => {
    const state = getThree()
    if (state.frameloop === 'demand') state.invalidate()
  }, [getThree, renderPaused, resources])
  useFrame((state, delta) => {
    const night = SURROUNDINGS_NIGHT_FACTOR.value
    resources.light.intensity = 80_000 * night
    if (night <= 0 || renderPaused) return
    resources.root.rotation.y = (resources.root.rotation.y + Math.min(delta, 0.1) * ROTATION_SPEED) % (Math.PI * 2)
    if (state.frameloop === 'demand') state.invalidate()
  })

  return <primitive object={resources.root} dispose={null} />
}
