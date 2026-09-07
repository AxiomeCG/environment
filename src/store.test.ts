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
