import { beforeEach, describe, expect, test } from 'bun:test'
import { exportEnvironmentConfiguration, importEnvironmentConfiguration } from './presentation'
import { useEnvironmentStore } from './store'

describe('Environment presentation configuration', () => {
  beforeEach(() => {
    useEnvironmentStore.setState(useEnvironmentStore.getInitialState(), true)
  })

  test('uses the initial atmosphere-on state for a fresh project', () => {
    expect(exportEnvironmentConfiguration().visibility.sky).toBe(true)
  })

  test('restores persisted presentation without audio consent or sky playback state', () => {
    const saved = exportEnvironmentConfiguration()
    const environment = useEnvironmentStore.getState()
    environment.setSkyPlaying(true)
    environment.setSkyMotion(true)
    environment.setAmbientMotion(false)
    environment.setWeatherSettings({ thunderAudio: true })

    importEnvironmentConfiguration(saved)

    expect(useEnvironmentStore.getState()).toMatchObject({
      skyEnabled: true,
      skyPlaying: false,
      skyMotion: false,
      ambientMotion: false,
      weatherSettings: { thunderAudio: false },
    })
  })

  test('rejects malformed configuration before mutating the store', () => {
    const before = exportEnvironmentConfiguration()

    expect(() =>
      importEnvironmentConfiguration({
        ...before,
        weather: { ...before.weather, snow: 2 },
      }),
    ).toThrow()
    expect(exportEnvironmentConfiguration()).toEqual(before)
  })
})
