'use client'

import { Pause, Play, RotateCcw } from 'lucide-react'
import { useId, useMemo, useState, useSyncExternalStore } from 'react'
import { ParameterRange } from '../parameter-range'
import { useEnvironmentStore, type WeatherSettings } from '../store'
import {
  createSolarState,
  DEFAULT_SKY_SETTINGS,
  SKY_PRESETS,
  skyPeriod,
  updateSolarState,
  type SkyDebug,
  type SkySettings,
} from './settings'
import TimeOrbit from './time-orbit'
import {
  enableThunderAudioFromGesture,
  isThunderAudioConsented,
  resetThunderAudioSession,
  subscribeThunderAudioConsent,
} from './weather-audio'
import { useReducedMotionPreference } from './weather-preferences'

const SELECT_CLASS =
  'min-h-9 w-full min-w-0 rounded-md border border-sidebar-border bg-sidebar px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring'
const BUTTON_CLASS =
  'flex min-h-9 min-w-0 items-center justify-center gap-2 rounded-md border border-sidebar-border px-3 text-xs hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50'
const PRESET_BUTTON_CLASS =
  'min-h-10 min-w-0 rounded-md border px-2 py-2 text-left text-xs leading-tight focus-visible:outline-2 focus-visible:outline-ring'
const SECTION_CLASS = 'flex min-w-0 flex-col gap-3 border-t border-sidebar-border pt-3'
const META_CLASS = 'text-[11px] leading-relaxed text-sidebar-foreground/60'

const WEATHER_PRESETS = [
  {
    id: 'clear',
    label: 'Clear',
    settings: { rain: 0, snow: 0, wind: 0.35, storm: false, thunderAudio: false },
  },
  {
    id: 'light-rain',
    label: 'Light rain',
    settings: { rain: 0.35, snow: 0, wind: 0.35, storm: false, thunderAudio: false },
  },
  {
    id: 'rain',
    label: 'Rain',
    settings: { rain: 0.7, snow: 0, wind: 0.55, storm: false, thunderAudio: false },
  },
  {
    id: 'storm',
    label: 'Storm',
    settings: { rain: 1, snow: 0, wind: 0.85, storm: true, thunderAudio: false },
  },
  {
    id: 'snow',
    label: 'Snow',
    settings: { rain: 0, snow: 0.65, wind: 0.3, storm: false, thunderAudio: false },
  },
] as const satisfies readonly {
  id: string
  label: string
  settings: WeatherSettings
}[]

const WEATHER_PRESET_KEYS = ['rain', 'snow', 'wind', 'storm'] as const

export default function AtmosphereControls() {
  const settings = useEnvironmentStore((state) => state.skySettings)
  const enabled = useEnvironmentStore((state) => state.skyEnabled)
  const playing = useEnvironmentStore((state) => state.skyPlaying)
  const motion = useEnvironmentStore((state) => state.skyMotion)
  const setEnabled = useEnvironmentStore((state) => state.setSkyEnabled)
  const setSettings = useEnvironmentStore((state) => state.setSkySettings)
  const setPlaying = useEnvironmentStore((state) => state.setSkyPlaying)
  const setMotion = useEnvironmentStore((state) => state.setSkyMotion)
  const weather = useEnvironmentStore((state) => state.weatherSettings)
  const setWeather = useEnvironmentStore((state) => state.setWeatherSettings)
  const controlId = useId()
  const reducedMotion = useReducedMotionPreference()
  const thunderConsented = useSyncExternalStore(
    subscribeThunderAudioConsent,
    isThunderAudioConsented,
    () => false,
  )
  const [audioFeedback, setAudioFeedback] = useState('')
  const solar = useMemo(() => {
    const value = createSolarState()
    updateSolarState(settings, value)
    return value
  }, [settings])
  const skyPresetId =
    SKY_PRESETS.find((preset) =>
      Object.entries(preset.settings).every(
        ([key, value]) => settings[key as keyof SkySettings] === value,
      ),
    )?.id ?? ''
  const weatherPreset = WEATHER_PRESETS.find((preset) =>
    WEATHER_PRESET_KEYS.every((key) => weather[key] === preset.settings[key]),
  )
  const precipitationActive = weather.rain > 0 || weather.snow > 0
  const skyAvailable = enabled || precipitationActive
  const weatherStateLabel =
    weatherPreset?.label ?? (weather.rain > 0 && weather.snow > 0 ? 'Mixed' : 'Custom')
  const atmosphereStatus = enabled
    ? 'Environment sky active'
    : precipitationActive
      ? 'Weather sky active'
      : 'Scene theme active'
  const thunderHint = audioFeedback
    ? audioFeedback
    : reducedMotion
      ? 'Unavailable while reduced motion is enabled.'
      : !weather.storm
        ? 'Enable storm lightning first. Sound never starts automatically.'
        : weather.thunderAudio && !thunderConsented
          ? 'Muted after restore. Turn this control on to give audio consent again.'
          : thunderConsented
            ? 'On for this weather session.'
            : 'Off until you explicitly turn it on.'

  const applyWeatherPreset = (preset: (typeof WEATHER_PRESETS)[number]) => {
    resetThunderAudioSession()
    setAudioFeedback('')
    setWeather(preset.settings)
  }

  const clearThunder = () => {
    resetThunderAudioSession()
    setAudioFeedback('')
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section
        className="flex min-w-0 flex-col gap-2"
        aria-labelledby={`${controlId}-status-heading`}
      >
        <h2 id={`${controlId}-status-heading`} className="sr-only">
          Atmosphere status
        </h2>
        <label className="flex min-h-11 min-w-0 items-center justify-between gap-3 rounded-md border border-sidebar-border px-3 py-2 text-xs">
          <span className="min-w-0">
            <span className="block font-medium">Environment sky</span>
            <span
              id={`${controlId}-sky-status`}
              className="block text-[11px] text-sidebar-foreground/60"
              role="status"
            >
              {atmosphereStatus}
            </span>
          </span>
          <input
            aria-describedby={`${controlId}-sky-status`}
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            type="checkbox"
          />
        </label>
        {!enabled ? (
          <p className={META_CLASS}>
            {precipitationActive
              ? 'Precipitation temporarily supplies its weather sky; the environment sky toggle stays off.'
              : 'Pascal’s scene theme currently supplies the background.'}
          </p>
        ) : null}
      </section>

      <section className={SECTION_CLASS} aria-labelledby={`${controlId}-weather-heading`}>
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 id={`${controlId}-weather-heading`} className="text-xs font-semibold">
              Weather
            </h3>
            <p className="mt-0.5 text-[11px] text-sidebar-foreground/60" aria-live="polite">
              {weatherStateLabel}
            </p>
          </div>
          <button
            className={`${BUTTON_CLASS} shrink-0 px-2`}
            type="button"
            onClick={() => applyWeatherPreset(WEATHER_PRESETS[0])}
          >
            <RotateCcw size={13} aria-hidden /> Reset
          </button>
        </div>

        <fieldset className="min-w-0">
          <legend className="mb-2 text-xs text-sidebar-foreground/80">Preset</legend>
          <div className="grid min-w-0 grid-cols-2 gap-2">
            {WEATHER_PRESETS.map((preset) => {
              const selected = weatherPreset?.id === preset.id
              return (
                <button
                  aria-pressed={selected}
                  className={`${PRESET_BUTTON_CLASS} ${
                    selected
                      ? 'border-primary bg-primary/10 font-medium text-sidebar-foreground ring-1 ring-primary/30'
                      : 'border-sidebar-border text-sidebar-foreground/80 hover:border-sidebar-foreground/40 hover:bg-sidebar-accent'
                  }`}
                  key={preset.id}
                  type="button"
                  onClick={() => applyWeatherPreset(preset)}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>
          {!weatherPreset ? (
            <p className={`mt-2 ${META_CLASS}`}>
              Custom and mixed rain–snow combinations remain fully supported.
            </p>
          ) : null}
        </fieldset>

        <ParameterRange
          label="Rain intensity"
          value={weather.rain * 100}
          min={0}
          max={100}
          step={1}
          onChange={(value) => {
            const rain = value / 100
            if (rain === 0 && weather.snow === 0) {
              clearThunder()
              setWeather({ rain, storm: false, thunderAudio: false })
              return
            }
            setWeather({ rain })
          }}
        />
        <ParameterRange
          label="Snow intensity"
          value={weather.snow * 100}
          min={0}
          max={100}
          step={1}
          onChange={(value) => {
            const snow = value / 100
            if (snow === 0 && weather.rain === 0) {
              clearThunder()
              setWeather({ snow, storm: false, thunderAudio: false })
              return
            }
            setWeather({ snow })
          }}
        />
        <ParameterRange
          label="Wind"
          value={weather.wind * 100}
          min={0}
          max={100}
          step={1}
          onChange={(value) => setWeather({ wind: value / 100 })}
        />

        <label className="flex min-h-9 min-w-0 items-center justify-between gap-3 text-xs">
          <span className="min-w-0">
            <span className="block">Storm lightning</span>
            <span className="block text-[11px] text-sidebar-foreground/60">
              Adds rain when needed
            </span>
          </span>
          <input
            checked={weather.storm}
            onChange={(event) => {
              const storm = event.target.checked
              clearThunder()
              setWeather(
                storm
                  ? { storm: true, rain: Math.max(0.7, weather.rain), thunderAudio: false }
                  : { storm: false, thunderAudio: false },
              )
            }}
            type="checkbox"
          />
        </label>

        <label className="flex min-h-9 min-w-0 items-center justify-between gap-3 text-xs">
          <span>Thunder sound</span>
          <input
            aria-describedby={`${controlId}-thunder-hint`}
            checked={weather.thunderAudio && thunderConsented}
            disabled={!weather.storm || reducedMotion}
            onChange={(event) => {
              if (!event.target.checked) {
                resetThunderAudioSession()
                setWeather({ thunderAudio: false })
                setAudioFeedback('Thunder sound is off.')
                return
              }
              setAudioFeedback('Requesting audio permission…')
              void enableThunderAudioFromGesture().then((enabledAudio) => {
                setWeather({ thunderAudio: enabledAudio })
                setAudioFeedback(
                  enabledAudio
                    ? 'Thunder sound is on for this weather session.'
                    : 'Thunder sound could not start in this browser.',
                )
              })
            }}
            type="checkbox"
          />
        </label>
        <p id={`${controlId}-thunder-hint`} className={META_CLASS} role="status" aria-live="polite">
          {thunderHint}
        </p>

        <fieldset disabled={!skyAvailable} className="min-w-0 disabled:opacity-50">
          <legend className="sr-only">Weather cloud response</legend>
          <ParameterRange
            label="Base cloud cover"
            value={settings.cloudCoverage * 100}
            min={0}
            max={100}
            step={1}
            onChange={(value) => setSettings({ cloudCoverage: value / 100 })}
          />
        </fieldset>
        <p className={META_CLASS}>
          Rain thickens and darkens the base clouds; snow cools the sky for a softer winter
          ambience.
        </p>
        <p className={META_CLASS}>
          Rain wets surfaces; snow adds cover to ground and roof-facing surfaces. Falling
          precipitation does not detect indoor shelter.
        </p>
        {reducedMotion ? (
          <p className="text-[11px] leading-relaxed text-sidebar-foreground/70" role="status">
            Reduced motion is on: animated precipitation and lightning are paused, and thunder is
            unavailable.
          </p>
        ) : null}
      </section>

      <fieldset
        disabled={!skyAvailable}
        className="flex min-w-0 flex-col gap-4 disabled:opacity-50"
      >
        <legend className="sr-only">Sky controls</legend>
        <section className={SECTION_CLASS} aria-labelledby={`${controlId}-sun-heading`}>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 id={`${controlId}-sun-heading`} className="text-xs font-semibold">
                Sun &amp; time
              </h3>
              {settings.sunMode === 'manual' ? (
                <p className="mt-0.5 font-mono text-sm tabular-nums text-sidebar-foreground/70">
                  {solar.elevation.toFixed(1)}° · {skyPeriod(solar.elevation)}
                </p>
              ) : null}
            </div>
            {settings.sunMode === 'time' ? (
              <button
                aria-describedby={`${controlId}-playback-hint`}
                aria-pressed={playing}
                className={`${BUTTON_CLASS} shrink-0 px-2`}
                type="button"
                disabled={!enabled}
                onClick={() => setPlaying(!playing)}
              >
                {playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                {playing ? 'Pause' : 'Play day'}
              </button>
            ) : null}
          </div>
          <label className="flex min-w-0 flex-col gap-2 text-xs">
            <span className="font-medium">Sky mood</span>
            <select
              className={SELECT_CLASS}
              value={skyPresetId}
              onChange={(event) => {
                const preset = SKY_PRESETS.find((entry) => entry.id === event.target.value)
                if (!preset) return
                setSettings(preset.settings)
                setEnabled(true)
              }}
            >
              <option value="" disabled>
                Custom sky
              </option>
              {SKY_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          {settings.sunMode === 'time' ? (
            <TimeOrbit
              value={settings.timeOfDay}
              solar={solar}
              cloudCoverage={settings.cloudCoverage}
              disabled={!skyAvailable}
              onChange={(timeOfDay) => setSettings({ timeOfDay })}
            />
          ) : (
            <p className={META_CLASS}>Manual sun angles are available in Advanced.</p>
          )}
          <p id={`${controlId}-playback-hint`} className={META_CLASS}>
            Artistic 24-hour orbit; playback takes two minutes. It is not a geolocated solar study.
            {!enabled && precipitationActive
              ? ' Enable the environment sky to use day playback.'
              : ''}
          </p>
        </section>

        <section className={SECTION_CLASS} aria-labelledby={`${controlId}-rays-heading`}>
          <div>
            <h3 id={`${controlId}-rays-heading`} className="text-xs font-semibold">
              Sunlight
            </h3>
            <p className={`mt-1 ${META_CLASS}`}>
              God rays appear when clouds partially interrupt direct sun.
            </p>
          </div>
          <ParameterRange
            label="God rays"
            value={settings.godRays * 100}
            min={0}
            max={100}
            step={1}
            onChange={(value) => setSettings({ godRays: value / 100 })}
          />
        </section>

        <details className="border-t border-sidebar-border pt-3">
          <summary className="flex min-h-10 cursor-pointer items-center text-xs font-semibold focus-visible:outline-2 focus-visible:outline-ring">
            Advanced
          </summary>
          <div className="flex min-w-0 flex-col gap-4 pb-1 pt-2">
            <section
              className="flex min-w-0 flex-col gap-2"
              aria-labelledby={`${controlId}-position-heading`}
            >
              <h4 id={`${controlId}-position-heading`} className="text-xs font-medium">
                Sun positioning
              </h4>
              <label className="flex min-w-0 flex-col gap-2 text-xs">
                <span>Sun control</span>
                <select
                  className={SELECT_CLASS}
                  value={settings.sunMode}
                  onChange={(event) => {
                    if (event.target.value === 'manual') {
                      setSettings({
                        sunMode: 'manual',
                        sunElevation: solar.elevation,
                        sunAzimuth:
                          (Math.atan2(solar.sunDirection.x, -solar.sunDirection.z) * 180) / Math.PI,
                      })
                    } else {
                      setSettings({ sunMode: 'time' })
                    }
                  }}
                >
                  <option value="time">Time of day</option>
                  <option value="manual">Manual angles</option>
                </select>
              </label>
              {settings.sunMode === 'time' ? (
                <ParameterRange
                  label="North offset"
                  value={settings.northOffset}
                  min={0}
                  max={359}
                  step={1}
                  unit="°"
                  onChange={(northOffset) => setSettings({ northOffset })}
                />
              ) : (
                <>
                  <ParameterRange
                    label="Sun elevation"
                    value={settings.sunElevation}
                    min={-90}
                    max={90}
                    step={0.1}
                    precision={1}
                    unit="°"
                    onChange={(sunElevation) => setSettings({ sunElevation })}
                  />
                  <ParameterRange
                    label="Sun azimuth"
                    value={settings.sunAzimuth}
                    min={0}
                    max={359}
                    step={1}
                    unit="°"
                    onChange={(sunAzimuth) => setSettings({ sunAzimuth })}
                  />
                  <p className={META_CLASS}>0° north · 90° east · 180° south · 270° west.</p>
                </>
              )}
            </section>

            <section
              className="flex min-w-0 flex-col gap-2 border-t border-sidebar-border pt-3"
              aria-labelledby={`${controlId}-cloud-heading`}
            >
              <h4 id={`${controlId}-cloud-heading`} className="text-xs font-medium">
                Clouds &amp; visibility
              </h4>
              <label className="flex min-h-9 min-w-0 items-center justify-between gap-3 text-xs">
                <span>Animate clouds</span>
                <input
                  checked={motion}
                  onChange={(event) => setMotion(event.target.checked)}
                  type="checkbox"
                />
              </label>
              <ParameterRange
                label="Haze"
                value={settings.turbidity}
                min={1}
                max={10}
                step={0.1}
                precision={1}
                unit=""
                onChange={(turbidity) => setSettings({ turbidity })}
              />
              <ParameterRange
                label="Fog starts"
                value={settings.fogStart}
                min={0}
                max={2000}
                step={10}
                unit="m"
                onChange={(fogStart) => setSettings({ fogStart })}
              />
              <ParameterRange
                label="Fog distance"
                value={settings.fogEnd}
                min={settings.fogStart + 20}
                max={5000}
                step={10}
                unit="m"
                onChange={(fogEnd) => setSettings({ fogEnd })}
              />
              <ParameterRange
                label="Exposure"
                value={settings.exposureCompensation}
                min={-3}
                max={3}
                step={0.1}
                precision={1}
                unit="EV"
                onChange={(exposureCompensation) => setSettings({ exposureCompensation })}
              />
              <ParameterRange
                label="Cloud scale"
                value={settings.cloudScale}
                min={0.25}
                max={4}
                step={0.05}
                precision={2}
                unit="×"
                onChange={(cloudScale) => setSettings({ cloudScale })}
              />
              <ParameterRange
                label="Cloud softness"
                value={settings.cloudSoftness * 100}
                min={2}
                max={40}
                step={1}
                onChange={(value) => setSettings({ cloudSoftness: value / 100 })}
              />
              <ParameterRange
                label="Cloud drift"
                value={settings.cloudSpeed * 1000}
                min={0}
                max={40}
                step={1}
                unit=""
                onChange={(value) => setSettings({ cloudSpeed: value / 1000 })}
              />
            </section>

            <section
              className="flex min-w-0 flex-col gap-2 border-t border-sidebar-border pt-3"
              aria-labelledby={`${controlId}-model-heading`}
            >
              <h4 id={`${controlId}-model-heading`} className="text-xs font-medium">
                Atmosphere model
              </h4>
              <label className="flex min-w-0 flex-col gap-2 text-xs">
                <span>Sky model</span>
                <select
                  className={SELECT_CLASS}
                  value={settings.provider}
                  onChange={(event) =>
                    setSettings({ provider: event.target.value as SkySettings['provider'] })
                  }
                >
                  <option value="procedural">Atmosphere · Rayleigh + Mie</option>
                  <option value="gradient">Gradient · low cost</option>
                </select>
              </label>
              <ParameterRange
                label="Rayleigh scattering"
                value={settings.rayleigh}
                min={0}
                max={2}
                step={0.05}
                precision={2}
                unit=""
                onChange={(rayleigh) => setSettings({ rayleigh })}
              />
              <ParameterRange
                label="Mie scattering"
                value={settings.mie}
                min={0}
                max={0.02}
                step={0.001}
                precision={3}
                unit=""
                onChange={(mie) => setSettings({ mie })}
              />
              <ParameterRange
                label="Mie anisotropy"
                value={settings.mieG}
                min={0}
                max={0.9}
                step={0.01}
                precision={2}
                unit=""
                onChange={(mieG) => setSettings({ mieG })}
              />
              <ParameterRange
                label="Sun angular radius"
                value={(settings.sunRadius * 180) / Math.PI}
                min={(0.00465 * 180) / Math.PI}
                max={(0.03 * 180) / Math.PI}
                step={0.01}
                precision={2}
                unit="°"
                onChange={(value) => setSettings({ sunRadius: (value * Math.PI) / 180 })}
              />
              <ParameterRange
                label="Sun radiance"
                value={settings.sunRadiance}
                min={1}
                max={100}
                step={1}
                unit="HDR"
                onChange={(sunRadiance) => setSettings({ sunRadiance })}
              />
              <ParameterRange
                label="Moon phase"
                value={settings.moonPhase * 100}
                min={0}
                max={100}
                step={1}
                onChange={(value) => setSettings({ moonPhase: value / 100 })}
              />
              <p className={META_CLASS}>
                Simplified scattering and three-octave directional clouds. Moon phase is artistic:
                0% new, 100% full.
              </p>
            </section>

            <section
              className="flex min-w-0 flex-col gap-2 border-t border-sidebar-border pt-3"
              aria-labelledby={`${controlId}-diagnostics-heading`}
            >
              <h4 id={`${controlId}-diagnostics-heading`} className="text-xs font-medium">
                Diagnostics
              </h4>
              <label className="flex min-w-0 flex-col gap-2 text-xs">
                <span>Sky output</span>
                <select
                  className={SELECT_CLASS}
                  value={settings.debug}
                  onChange={(event) => setSettings({ debug: event.target.value as SkyDebug })}
                >
                  <option value="none">Composite HDR</option>
                  <option value="direction">World direction</option>
                  <option value="rayleigh">Rayleigh only</option>
                  <option value="mie">Mie only</option>
                  <option value="haze">Horizon haze</option>
                  <option value="sun">Sun mask</option>
                  <option value="clouds">Cloud density</option>
                  <option value="luminance">Log luminance</option>
                </select>
              </label>
              <p className={META_CLASS}>
                Background only. Reflections, fog, and lighting keep the full sky.
              </p>
            </section>

            <button
              className={BUTTON_CLASS}
              type="button"
              onClick={() => {
                setSettings({ ...DEFAULT_SKY_SETTINGS })
                setMotion(false)
              }}
            >
              <RotateCcw size={14} aria-hidden /> Reset sky
            </button>
          </div>
        </details>
      </fieldset>

      <p className={META_CLASS}>
        Project appearance is saved in this browser, not in exported geometry. It stays active when
        you return to other tools.
      </p>
    </div>
  )
}
