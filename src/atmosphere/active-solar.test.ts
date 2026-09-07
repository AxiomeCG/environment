import { expect, test } from 'bun:test'
import { Color, Scene, Vector3 } from 'three'
import { getActiveSolarUniforms, registerActiveSolar } from './active-solar'

test('overlapping atmospheres restore the surviving owner without lighting other viewers', () => {
  const scene = new Scene()
  const otherScene = new Scene()
  const daylight = { sunDirection: new Vector3(1, 1, 0).normalize(), sunColor: new Color('#ffe6b0'), sunIntensity: 3 }
  const night = { sunDirection: new Vector3(0, -1, 0), sunColor: new Color('#ffffff'), sunIntensity: 0 }
  const first = registerActiveSolar(scene, daylight)
  const second = registerActiveSolar(scene, night)
  const uniforms = getActiveSolarUniforms(scene)
  first.publish()
  expect(uniforms.intensity.value).toBe(0)
  expect(getActiveSolarUniforms(otherScene).intensity.value).toBe(0)
  second.dispose()
  expect(uniforms.direction.value.toArray()).toEqual(daylight.sunDirection.toArray())
  expect(uniforms.intensity.value).toBe(3)
  first.dispose()
  first.publish()
  expect(uniforms.intensity.value).toBe(0)
  const replacement = registerActiveSolar(scene, daylight)
  first.dispose()
  expect(uniforms.intensity.value).toBe(3)
  replacement.dispose()
})
