import { type AnyNode, SiteNode } from '@pascal-app/core'
import { beforeEach, describe, expect, test } from 'bun:test'
import {
  environmentPresentation,
  exportEnvironmentConfiguration,
  importEnvironmentConfiguration,
} from './presentation'
import { useEnvironmentStore } from './store'

describe('Environment presentation configuration', () => {
  beforeEach(() => {
    useEnvironmentStore.setState(useEnvironmentStore.getInitialState(), true)
  })

  test('exports the canonical version 2 configuration for a fresh project', () => {
    expect(exportEnvironmentConfiguration()).toMatchObject({
      version: 2,
      visibility: { sky: true },
    })
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

  test('migrates a valid persisted version 1 configuration without losing other settings', () => {
    const current = exportEnvironmentConfiguration()
    const expectedSky: typeof current.sky = {
      ...current.sky,
      provider: 'gradient',
      timeOfDay: 9.5,
      debug: 'mie',
    }
    const legacy = {
      ...current,
      version: 1,
      preset: 'woodland-edge',
      seed: 'legacy-environment',
      frontages: {
        2: {
          separator: 'primary-road',
          access: 'driveway',
          roadStyleId: 'legacy-road',
        },
      },
      sky: {
        ...expectedSky,
        godRays: 0.75,
      },
      visibility: { surroundings: false, sky: true },
      weather: { rain: 0.35, snow: 0, wind: 0.65, storm: false },
    } as const

    const restored = importEnvironmentConfiguration(legacy)

    expect(restored).toEqual({
      ...legacy,
      version: 2,
      sky: expectedSky,
    })
    expect(restored.sky).not.toHaveProperty('godRays')
    expect(exportEnvironmentConfiguration()).toEqual(restored)
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

  test('rejects malformed legacy settings before mutating the store', () => {
    const before = exportEnvironmentConfiguration()

    expect(() =>
      importEnvironmentConfiguration({
        ...before,
        version: 1,
        sky: { ...before.sky, godRays: 0.75, fogStart: 500, fogEnd: 100 },
      }),
    ).toThrow()
    expect(exportEnvironmentConfiguration()).toEqual(before)
  })

  test('rejects the removed setting in version 2 before mutating the store', () => {
    const before = exportEnvironmentConfiguration()

    expect(() =>
      importEnvironmentConfiguration({
        ...before,
        sky: { ...before.sky, godRays: 0.75 },
      }),
    ).toThrow()
    expect(exportEnvironmentConfiguration()).toEqual(before)
  })

  test('omits static surroundings when presentation visibility is disabled', async () => {
    const build = environmentPresentation.staticExport?.build
    if (!build) throw new Error('Environment presentation has no static export contribution')
    const configuration = exportEnvironmentConfiguration()

    const output = await build({
      nodes: {},
      configuration: {
        ...configuration,
        visibility: { ...configuration.visibility, surroundings: false },
      },
      onlyVisible: true,
      excludedNodeTypes: [],
    })

    expect(output).toBeNull()
  })

  test('does not resurrect an excluded or hidden Site through static surroundings', async () => {
    const build = environmentPresentation.staticExport?.build
    if (!build) throw new Error('Environment presentation has no static export contribution')
    const site = SiteNode.parse({
      id: 'site_static_export_selection',
      children: [],
      polygon: {
        type: 'polygon',
        points: [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
        ],
      },
    })
    const nodes = { [site.id]: site as unknown as AnyNode }
    const configuration = exportEnvironmentConfiguration()

    expect(
      await build({
        nodes,
        configuration,
        onlyVisible: true,
        excludedNodeTypes: ['site'],
      }),
    ).toBeNull()
    expect(
      await build({
        nodes: {
          [site.id]: { ...site, visible: false } as unknown as AnyNode,
        },
        configuration,
        onlyVisible: true,
        excludedNodeTypes: [],
      }),
    ).toBeNull()
  })
})
