import type { Object3D } from 'three'

export type SceneWeatherSignal = { flash: number }

const signals = new WeakMap<Object3D, SceneWeatherSignal>()

export function getSceneWeatherSignal(scene: Object3D): SceneWeatherSignal {
  let signal = signals.get(scene)
  if (!signal) {
    signal = { flash: 0 }
    signals.set(scene, signal)
  }
  return signal
}
