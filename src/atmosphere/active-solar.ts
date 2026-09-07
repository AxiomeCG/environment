import { Color, Vector3, type Scene, type UniformNode } from 'three/webgpu'
import { uniform } from 'three/tsl'

import type { SkyProvider } from './sky-provider'

export type ActiveSolarUniforms = {
  /** World-space direction from the scene toward the sun. */
  direction: UniformNode<'vec3', Vector3>
  color: UniformNode<'color', Color>
  /** The active provider's directional-sun intensity; zero with no owner. */
  intensity: UniformNode<'float', number>
}

type SolarSource = Pick<SkyProvider, 'sunDirection' | 'sunColor' | 'sunIntensity'>
type SolarOwner = { source: SolarSource }
type SceneSolarState = {
  uniforms: ActiveSolarUniforms
  owners: SolarOwner[]
}

const sceneSolarStates = new WeakMap<Scene, SceneSolarState>()

function stateFor(scene: Scene): SceneSolarState {
  let state = sceneSolarStates.get(scene)
  if (!state) {
    state = {
      uniforms: {
        direction: uniform(new Vector3(0, 1, 0)),
        color: uniform(new Color(1, 1, 1)),
        intensity: uniform(0),
      },
      owners: [],
    }
    sceneSolarStates.set(scene, state)
  }
  return state
}

function publish(uniforms: ActiveSolarUniforms, source: SolarSource): void {
  uniforms.direction.value.copy(source.sunDirection)
  uniforms.color.value.copy(source.sunColor)
  uniforms.intensity.value = source.sunIntensity
}

function applyActiveOwner(state: SceneSolarState): void {
  const active = state.owners.at(-1)
  if (active) {
    publish(state.uniforms, active.source)
    return
  }

  state.uniforms.direction.value.set(0, 1, 0)
  state.uniforms.color.value.setRGB(1, 1, 1)
  state.uniforms.intensity.value = 0
}

/** Stable TSL uniforms for the atmosphere currently owning this scene. */
export function getActiveSolarUniforms(scene: Scene): ActiveSolarUniforms {
  return stateFor(scene).uniforms
}

export type ActiveSolarRegistration = {
  /** Copies the source's current lighting values when this registration is active. */
  publish(): void
  dispose(): void
}

/**
 * Makes an existing atmosphere source the active solar source for a scene.
 * Later registrations take precedence; disposing one restores the previous owner.
 */
export function registerActiveSolar(
  scene: Scene,
  source: SolarSource,
): ActiveSolarRegistration {
  const state = stateFor(scene)
  const owner: SolarOwner = { source }
  let disposed = false

  state.owners.push(owner)
  applyActiveOwner(state)

  return {
    publish() {
      if (!disposed && state.owners.at(-1) === owner) publish(state.uniforms, source)
    },
    dispose() {
      if (disposed) return
      disposed = true
      const index = state.owners.indexOf(owner)
      if (index < 0) return
      const wasActive = index === state.owners.length - 1
      state.owners.splice(index, 1)
      if (wasActive) applyActiveOwner(state)
    },
  }
}
