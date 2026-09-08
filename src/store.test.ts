import { beforeEach, describe, expect, test } from 'bun:test'
import { useEnvironmentStore } from './store'

describe('Surroundings visibility', () => {
  beforeEach(() => {
    useEnvironmentStore.setState(useEnvironmentStore.getInitialState(), true)
  })

  test('remains enabled when the Environment panel leaves Surroundings', () => {
    const state = useEnvironmentStore.getState()

    expect(state.surroundingsEnabled).toBe(true)
    state.setActiveSection('surroundings')
    state.setActiveSection(undefined)

    expect(useEnvironmentStore.getState().activeSection).toBeUndefined()
    expect(useEnvironmentStore.getState().surroundingsEnabled).toBe(true)
  })

  test('keeps an explicit disabled state while navigating the panel', () => {
    const state = useEnvironmentStore.getState()

    state.setSurroundingsEnabled(false)
    state.setActiveSection('surroundings')
    state.setActiveSection(undefined)

    expect(useEnvironmentStore.getState().surroundingsEnabled).toBe(false)
  })
})

describe('Surroundings presets', () => {
  beforeEach(() => {
    useEnvironmentStore.setState(useEnvironmentStore.getInitialState(), true)
  })

  test('defaults to Regional and retains frontage settings across natural presets', () => {
    const state = useEnvironmentStore.getState()
    state.setFrontageSeparator(2, 'primary-road')

    expect(useEnvironmentStore.getState().surroundingsPreset).toBe('regional')
    state.setSurroundingsPreset('open-meadow')
    state.setSurroundingsPreset('woodland-edge')

    expect(useEnvironmentStore.getState().frontageContexts).toEqual({
      2: { separator: 'primary-road', access: 'none' },
    })
  })

  test('copies restored frontage configuration at the store boundary', () => {
    const context: {
      separator: 'secondary-road'
      access: 'driveway'
      roadStyleId: string
    } = {
      separator: 'secondary-road',
      access: 'driveway',
      roadStyleId: 'country-lane',
    }

    useEnvironmentStore.getState().setFrontageContexts({ 1: context })
    context.roadStyleId = 'changed-outside-store'

    expect(useEnvironmentStore.getState().frontageContexts[1]).toEqual({
      separator: 'secondary-road',
      access: 'driveway',
      roadStyleId: 'country-lane',
    })
  })
})

describe('Weather settings', () => {
  beforeEach(() => {
    useEnvironmentStore.setState(useEnvironmentStore.getInitialState(), true)
  })

  test('clamps intensity inputs without resetting independent settings', () => {
    const state = useEnvironmentStore.getState()
    state.setWeatherSettings({ storm: true, rain: 2, snow: 1.3 })
    state.setWeatherSettings({ wind: -1 })

    expect(useEnvironmentStore.getState().weatherSettings).toEqual({
      rain: 1,
      snow: 1,
      wind: 0,
      storm: true,
      thunderAudio: false,
    })
  })
})

describe('Pond tool state', () => {
  beforeEach(() => {
    useEnvironmentStore.setState(useEnvironmentStore.getInitialState(), true)
  })

  test('clears the ephemeral basin while retaining the chosen water quality', () => {
    const state = useEnvironmentStore.getState()
    state.setPondToolMode('koi')
    state.setPondTarget({
      siteId: 'site-one',
      seed: [2, 3],
      pondId: null,
    })
    state.setPondQuality('swampy')
    state.setPondFeedback('Place koi')

    state.resetPondTool()

    expect(useEnvironmentStore.getState()).toMatchObject({
      pondToolMode: 'select-basin',
      pondTarget: null,
      pondQuality: 'swampy',
      pondFeedback: '',
    })
  })
})
