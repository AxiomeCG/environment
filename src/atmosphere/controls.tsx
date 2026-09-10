'use client'

import {
  ChevronRight,
  Cloud,
  CloudLightning,
  CloudRain,
  Eye,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Snowflake,
  Sparkles,
  Sun,
  type LucideIcon,
} from 'lucide-react'
import {
  type KeyboardEvent,
  type ReactNode,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { ParameterRange } from '../parameter-range'
import { useEnvironmentStore, type WeatherSettings } from '../store'
import {
  DEFAULT_SKY_SETTINGS,
  SKY_PRESETS,
  skyPeriod,
  type SkyDebug,
  type SkySettings,
} from './settings'
import { createSolarState, updateSolarState } from './solar'
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
  'flex min-h-14 min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-xs leading-tight transition-transform duration-150 [&:active:not(:focus-visible)]:scale-[0.98] focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transform-none motion-reduce:transition-none'
const SECTION_CLASS = 'flex min-w-0 flex-col gap-3'
const META_CLASS = 'text-[11px] leading-relaxed text-sidebar-foreground/60'

const WEATHER_PRESETS = [
  {
    id: 'clear',
    label: 'Clear',
    settings: { rain: 0, snow: 0, wind: 0.35, storm: false, thunderAudio: false },
  },
  {
    id: 'rain',
    label: 'Rain',
    settings: { rain: 0.7, snow: 0, wind: 0.55, storm: false, thunderAudio: false },
  },
  {
    id: 'snow',
    label: 'Snow',
    settings: { rain: 0, snow: 0.65, wind: 0.3, storm: false, thunderAudio: false },
  },
  {
    id: 'storm',
    label: 'Storm',
    settings: { rain: 1, snow: 0, wind: 0.85, storm: true, thunderAudio: false },
  },
] as const satisfies readonly {
  id: string
  label: string
  settings: WeatherSettings
}[]

const PRECIPITATION_LEVELS = [
  { label: 'Light', value: 0.35, max: 0.4 },
  { label: 'Steady', value: 0.7, max: 0.8 },
  { label: 'Heavy', value: 1, max: 1 },
] as const
const WIND_LEVELS = [
  { label: 'Calm', value: 0, max: 0 },
  { label: 'Breeze', value: 0.35, max: 0.6 },
  { label: 'Strong', value: 0.85, max: 1 },
] as const
type AtmosphereTab = 'sky' | 'weather' | 'advanced'

const WEATHER_PRESET_ICONS = {
  clear: Sun,
  rain: CloudRain,
  storm: CloudLightning,
  snow: Snowflake,
} as const satisfies Record<(typeof WEATHER_PRESETS)[number]['id'], LucideIcon>

const ATMOSPHERE_TABS = [
  { id: 'sky', label: 'Sky', icon: Sun },
  { id: 'weather', label: 'Weather', icon: CloudRain },
  { id: 'advanced', label: 'Advanced', icon: Gauge },
] as const satisfies readonly {
  id: AtmosphereTab
  label: string
  icon: LucideIcon
}[]

function WeatherChoices({
  label,
  value,
  choices,
  onChange,
}: {
  label: string
  value: number
  choices: readonly { label: string; value: number; max: number }[]
  onChange: (value: number) => void
}) {
  // Labels describe bands; exact values stay untouched until a choice is clicked.
  const selected = choices.find((choice) => value <= choice.max)

  return (
    <fieldset className="min-w-0" onKeyDown={(event) => event.stopPropagation()}>
      <legend className="mb-2 text-xs text-sidebar-foreground/80">{label}</legend>
      <div className="grid min-w-0 grid-cols-3 gap-1">
        {choices.map((choice) => (
          <button
            aria-pressed={choice === selected}
            className={`min-h-11 min-w-0 rounded-md border px-1 text-xs leading-tight focus-visible:outline-2 focus-visible:outline-ring ${
              choice === selected
                ? 'border-primary/40 bg-primary/10 font-medium text-sidebar-foreground ring-1 ring-primary/50'
                : 'border-transparent bg-muted/40 text-sidebar-foreground/80 hover:bg-muted/60'
            }`}
            key={choice.label}
            onClick={() => onChange(choice.value)}
            type="button"
          >
            {choice.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

type AdvancedDisclosureProps = {
  children: ReactNode
  description: string
  icon: LucideIcon
  id: string
  title: string
}

function AdvancedDisclosure({
  children,
  description,
  icon: Icon,
  id,
  title,
}: AdvancedDisclosureProps) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <details className="group/disclosure min-w-0 rounded-lg border border-sidebar-border bg-sidebar/40 open:bg-sidebar-accent/20">
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <Icon
            aria-hidden
            className="shrink-0 text-sidebar-foreground/70"
            size={15}
            strokeWidth={1.8}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span id={id} className="text-xs font-medium text-sidebar-foreground">
              {title}
            </span>
            <span className="text-[11px] leading-tight text-sidebar-foreground/60">
              {description}
            </span>
          </span>
          <ChevronRight
            aria-hidden
            className="shrink-0 text-sidebar-foreground/50 group-open/disclosure:rotate-90"
            size={14}
            strokeWidth={1.8}
          />
        </summary>
        <div className="flex min-w-0 flex-col gap-3 border-t border-sidebar-border px-2.5 py-3">
          {children}
        </div>
      </details>
    </section>
  )
}

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
  const [activeTab, setActiveTab] = useState<AtmosphereTab>('sky')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
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
  const mixedWeather = weather.rain > 0 && weather.snow > 0
  const weatherKind = mixedWeather
    ? 'mixed'
    : weather.storm
      ? 'storm'
      : weather.rain > 0
        ? 'rain'
        : weather.snow > 0
          ? 'snow'
          : 'clear'
  const weatherPreset = WEATHER_PRESETS.find((preset) => preset.id === weatherKind)
  const precipitationActive = weather.rain > 0 || weather.snow > 0
  const skyAvailable = enabled || precipitationActive
  const weatherStateLabel =
    weatherPreset?.label ?? (weather.storm ? 'Mixed · lightning' : 'Mixed rain and snow')
  const atmosphereStatus = enabled
    ? 'Environment sky active'
    : precipitationActive
      ? 'Weather sky active'
      : 'Scene theme active'
  const thunderHint = audioFeedback
    ? audioFeedback
    : reducedMotion
      ? 'Unavailable while reduced motion is enabled.'
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

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number

    switch (event.key) {
      case 'ArrowLeft':
        nextIndex = (index - 1 + ATMOSPHERE_TABS.length) % ATMOSPHERE_TABS.length
        break
      case 'ArrowRight':
        nextIndex = (index + 1) % ATMOSPHERE_TABS.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = ATMOSPHERE_TABS.length - 1
        break
      default:
        return
    }

    event.preventDefault()
    event.stopPropagation()
    const nextTab = ATMOSPHERE_TABS[nextIndex]
    if (!nextTab) return
    setActiveTab(nextTab.id)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div
        aria-label="Atmosphere settings"
        aria-orientation="horizontal"
        className="grid min-w-0 grid-cols-3 gap-1.5"
        role="tablist"
        onKeyDownCapture={(event) => {
          if (event.code === 'Space') event.stopPropagation()
        }}
      >
        {ATMOSPHERE_TABS.map((tab, index) => {
          const Icon = tab.icon
          const selected = activeTab === tab.id

          return (
            <button
              aria-controls={`${controlId}-${tab.id}-panel`}
              aria-selected={selected}
              className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border px-1 py-2 text-xs font-medium active:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring ${
                selected
                  ? 'border-primary/40 bg-primary/10 text-sidebar-foreground ring-1 ring-primary/50'
                  : 'border-transparent bg-muted/40 text-sidebar-foreground/70 hover:bg-muted/60 hover:text-sidebar-foreground'
              }`}
              id={`${controlId}-${tab.id}-tab`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              ref={(node) => {
                tabRefs.current[index] = node
              }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <Icon aria-hidden size={14} strokeWidth={1.8} />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      <div
        aria-labelledby={`${controlId}-sky-tab`}
        className={`${activeTab === 'sky' ? 'flex' : 'hidden'} min-w-0 flex-col gap-4`}
        hidden={activeTab !== 'sky'}
        id={`${controlId}-sky-panel`}
        role="tabpanel"
      >
        <section
          className="flex min-w-0 flex-col gap-2"
          aria-labelledby={`${controlId}-status-heading`}
        >
          <h2 id={`${controlId}-status-heading`} className="sr-only">
            Atmosphere status
          </h2>
          <label className="flex min-h-12 min-w-0 items-center justify-between gap-3 rounded-xl border border-sidebar-border bg-muted/40 px-3 py-2 text-xs">
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
              className="h-4 w-4 shrink-0 accent-primary"
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

        <fieldset
          className="flex min-w-0 flex-col gap-4 disabled:opacity-50"
          disabled={!skyAvailable}
        >
          <legend className="sr-only">Sky controls</legend>
          <section className={SECTION_CLASS} aria-labelledby={`${controlId}-sun-heading`}>
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <h3
                  id={`${controlId}-sun-heading`}
                  className="flex items-center gap-1.5 text-xs font-semibold"
                >
                  <Sun aria-hidden size={14} strokeWidth={1.8} />
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
                  disabled={!enabled}
                  onClick={() => setPlaying(!playing)}
                  type="button"
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
                cloudCoverage={settings.cloudCoverage}
                disabled={!skyAvailable}
                onChange={(timeOfDay) => setSettings({ timeOfDay })}
                solar={solar}
                value={settings.timeOfDay}
              />
            ) : (
              <p className={META_CLASS}>Manual sun angles are available in Advanced.</p>
            )}
            <p id={`${controlId}-playback-hint`} className={META_CLASS}>
              Artistic 24-hour orbit; playback takes two minutes. It is not a geolocated solar
              study.
              {!enabled && precipitationActive
                ? ' Enable the environment sky to use day playback.'
                : ''}
            </p>
          </section>
        </fieldset>
        {!skyAvailable ? (
          <p className={META_CLASS} role="status">
            Enable the environment sky to adjust sun and time controls.
          </p>
        ) : null}
      </div>

      <div
        aria-labelledby={`${controlId}-weather-tab`}
        className={`${activeTab === 'weather' ? 'flex' : 'hidden'} min-w-0 flex-col gap-4`}
        hidden={activeTab !== 'weather'}
        id={`${controlId}-weather-panel`}
        role="tabpanel"
      >
        <section className={SECTION_CLASS} aria-labelledby={`${controlId}-weather-heading`}>
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 id={`${controlId}-weather-heading`} className="text-xs font-semibold">
                Weather
              </h2>
              <p className="mt-0.5 text-[11px] text-sidebar-foreground/60" aria-live="polite">
                {weatherStateLabel}
              </p>
            </div>
            <button
              className={`${BUTTON_CLASS} shrink-0 px-2`}
              onClick={() => applyWeatherPreset(WEATHER_PRESETS[0])}
              type="button"
            >
              <RotateCcw size={13} aria-hidden /> Reset
            </button>
          </div>

          <fieldset className="min-w-0">
            <legend className="mb-2 text-xs text-sidebar-foreground/80">Weather type</legend>
            <div className="grid min-w-0 grid-cols-2 gap-2">
              {WEATHER_PRESETS.map((preset) => {
                const Icon = WEATHER_PRESET_ICONS[preset.id]
                const selected = weatherPreset?.id === preset.id

                return (
                  <button
                    aria-pressed={selected}
                    className={`${PRESET_BUTTON_CLASS} ${
                      selected
                        ? 'border-primary/40 bg-primary/10 font-medium text-sidebar-foreground ring-1 ring-primary/50'
                        : 'border-transparent bg-muted/40 text-sidebar-foreground/80 hover:bg-muted/60'
                    }`}
                    key={preset.id}
                    onClick={() => applyWeatherPreset(preset)}
                    type="button"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background/50">
                      <Icon aria-hidden size={16} strokeWidth={1.8} />
                    </span>
                    <span>{preset.label}</span>
                  </button>
                )
              })}
            </div>
            {mixedWeather ? (
              <p className={`mt-2 ${META_CLASS}`}>
                Adjust the rain and snow amounts separately in Fine-tune.
              </p>
            ) : null}
          </fieldset>
          {!mixedWeather && weather.rain > 0 ? (
            <WeatherChoices
              choices={PRECIPITATION_LEVELS}
              label="Rain strength"
              onChange={(rain) => setWeather({ rain })}
              value={weather.rain}
            />
          ) : null}
          {!mixedWeather && weather.snow > 0 ? (
            <WeatherChoices
              choices={PRECIPITATION_LEVELS}
              label="Snow strength"
              onChange={(snow) => setWeather({ snow })}
              value={weather.snow}
            />
          ) : null}
          <WeatherChoices
            choices={WIND_LEVELS}
            label="Wind"
            onChange={(wind) => setWeather({ wind })}
            value={weather.wind}
          />

          {weather.storm ? (
            <div className="flex min-w-0 flex-col gap-1">
              <label className="flex min-h-9 min-w-0 items-center justify-between gap-3 text-xs">
                <span>Thunder sound</span>
                <input
                  aria-describedby={`${controlId}-thunder-hint`}
                  checked={weather.thunderAudio && thunderConsented}
                  className="h-4 w-4 shrink-0 accent-primary"
                  disabled={reducedMotion}
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
              <p
                id={`${controlId}-thunder-hint`}
                className={META_CLASS}
                role="status"
                aria-live="polite"
              >
                {thunderHint}
              </p>
            </div>
          ) : null}

          <AdvancedDisclosure
            description="Exact amounts and mixed weather."
            icon={SlidersHorizontal}
            id={`${controlId}-weather-fine-tune-heading`}
            title="Fine-tune"
          >
            <ParameterRange
              label="Rain intensity"
              max={100}
              min={0}
              onChange={(value) => {
                const rain = value / 100
                if (rain === 0 && weather.snow === 0) {
                  clearThunder()
                  setWeather({ rain, storm: false, thunderAudio: false })
                  return
                }
                setWeather({ rain })
              }}
              step={1}
              value={weather.rain * 100}
            />
            <ParameterRange
              label="Snow intensity"
              max={100}
              min={0}
              onChange={(value) => {
                const snow = value / 100
                if (snow === 0 && weather.rain === 0) {
                  clearThunder()
                  setWeather({ snow, storm: false, thunderAudio: false })
                  return
                }
                setWeather({ snow })
              }}
              step={1}
              value={weather.snow * 100}
            />
            <ParameterRange
              label="Wind"
              max={100}
              min={0}
              onChange={(value) => setWeather({ wind: value / 100 })}
              step={1}
              value={weather.wind * 100}
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
                className="h-4 w-4 shrink-0 accent-primary"
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

            <p className={META_CLASS}>Cloud cover is in Advanced → Clouds.</p>
            <p className={META_CLASS}>
              Rain thickens and darkens the base clouds; snow cools the sky. Rain wets surfaces;
              snow covers ground and roof-facing surfaces. Indoor shelter is not detected.
            </p>
          </AdvancedDisclosure>
          {reducedMotion ? (
            <p className="text-[11px] leading-relaxed text-sidebar-foreground/70" role="status">
              Reduced motion is on: animated precipitation and lightning are paused, and thunder is
              unavailable.
            </p>
          ) : null}
        </section>
      </div>

      <div
        aria-labelledby={`${controlId}-advanced-tab`}
        className={`${activeTab === 'advanced' ? 'flex' : 'hidden'} min-w-0 flex-col gap-4`}
        hidden={activeTab !== 'advanced'}
        id={`${controlId}-advanced-panel`}
        role="tabpanel"
      >
        <h2 className="sr-only">Advanced sky controls</h2>
        {!skyAvailable ? (
          <p className={META_CLASS} role="status">
            Enable the environment sky or precipitation to edit advanced sky controls.
          </p>
        ) : null}
        <fieldset
          className="flex min-w-0 flex-col gap-2 disabled:opacity-50"
          disabled={!skyAvailable}
        >
          <legend className="sr-only">Advanced sky controls</legend>
          <AdvancedDisclosure
            description="Aim the sun by time or manual angles."
            icon={Sun}
            id={`${controlId}-position-heading`}
            title="Sun direction"
          >
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
                max={359}
                min={0}
                onChange={(northOffset) => setSettings({ northOffset })}
                step={1}
                unit="°"
                value={settings.northOffset}
              />
            ) : (
              <>
                <ParameterRange
                  label="Sun elevation"
                  max={90}
                  min={-90}
                  onChange={(sunElevation) => setSettings({ sunElevation })}
                  precision={1}
                  step={0.1}
                  unit="°"
                  value={settings.sunElevation}
                />
                <ParameterRange
                  label="Sun azimuth"
                  max={359}
                  min={0}
                  onChange={(sunAzimuth) => setSettings({ sunAzimuth })}
                  step={1}
                  unit="°"
                  value={settings.sunAzimuth}
                />
                <p className={META_CLASS}>0° north · 90° east · 180° south · 270° west.</p>
              </>
            )}
          </AdvancedDisclosure>

          <AdvancedDisclosure
            description="Shape haze, fog depth, and scene exposure."
            icon={Eye}
            id={`${controlId}-visibility-heading`}
            title="Light & visibility"
          >
            <ParameterRange
              label="Haze"
              max={10}
              min={1}
              onChange={(turbidity) => setSettings({ turbidity })}
              precision={1}
              step={0.1}
              unit=""
              value={settings.turbidity}
            />
            <ParameterRange
              label="Fog starts"
              max={2000}
              min={0}
              onChange={(fogStart) => setSettings({ fogStart })}
              step={10}
              unit="m"
              value={settings.fogStart}
            />
            <ParameterRange
              label="Fog distance"
              max={5000}
              min={settings.fogStart + 20}
              onChange={(fogEnd) => setSettings({ fogEnd })}
              step={10}
              unit="m"
              value={settings.fogEnd}
            />
            <ParameterRange
              label="Exposure"
              max={3}
              min={-3}
              onChange={(exposureCompensation) => setSettings({ exposureCompensation })}
              precision={1}
              step={0.1}
              unit="EV"
              value={settings.exposureCompensation}
            />
          </AdvancedDisclosure>

          <AdvancedDisclosure
            description="Adjust cloud coverage, motion, and appearance."
            icon={Cloud}
            id={`${controlId}-cloud-heading`}
            title="Clouds"
          >
            <ParameterRange
              label="Base cloud cover"
              max={100}
              min={0}
              onChange={(value) => setSettings({ cloudCoverage: value / 100 })}
              step={1}
              value={settings.cloudCoverage * 100}
            />
            <label className="flex min-h-9 min-w-0 items-center justify-between gap-3 text-xs">
              <span>Animate clouds</span>
              <input
                checked={motion}
                className="h-4 w-4 shrink-0 accent-primary"
                onChange={(event) => setMotion(event.target.checked)}
                type="checkbox"
              />
            </label>
            <ParameterRange
              label="Cloud scale"
              max={4}
              min={0.25}
              onChange={(cloudScale) => setSettings({ cloudScale })}
              precision={2}
              step={0.05}
              unit="×"
              value={settings.cloudScale}
            />
            <ParameterRange
              label="Cloud softness"
              max={40}
              min={2}
              onChange={(value) => setSettings({ cloudSoftness: value / 100 })}
              step={1}
              value={settings.cloudSoftness * 100}
            />
            <ParameterRange
              label="Cloud drift"
              max={40}
              min={0}
              onChange={(value) => setSettings({ cloudSpeed: value / 1000 })}
              step={1}
              unit=""
              value={settings.cloudSpeed * 1000}
            />
          </AdvancedDisclosure>

          <AdvancedDisclosure
            description="Choose rendering and tune celestial light."
            icon={Sparkles}
            id={`${controlId}-model-heading`}
            title="Sky model"
          >
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
            <details className="group/physical min-w-0 rounded-md border border-sidebar-border bg-sidebar/40">
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <SlidersHorizontal
                  aria-hidden
                  className="shrink-0 text-sidebar-foreground/60"
                  size={14}
                  strokeWidth={1.8}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[11px] font-medium text-sidebar-foreground/80">
                    Physical scattering
                  </span>
                  <span className="text-[10px] leading-tight text-sidebar-foreground/55">
                    Specialist tuning; defaults usually suffice.
                  </span>
                </span>
                <ChevronRight
                  aria-hidden
                  className="shrink-0 text-sidebar-foreground/50 group-open/physical:rotate-90"
                  size={13}
                  strokeWidth={1.8}
                />
              </summary>
              <div className="flex min-w-0 flex-col gap-3 border-t border-sidebar-border px-2.5 py-3">
                <ParameterRange
                  label="Rayleigh scattering"
                  max={2}
                  min={0}
                  onChange={(rayleigh) => setSettings({ rayleigh })}
                  precision={2}
                  step={0.05}
                  unit=""
                  value={settings.rayleigh}
                />
                <ParameterRange
                  label="Mie scattering"
                  max={0.02}
                  min={0}
                  onChange={(mie) => setSettings({ mie })}
                  precision={3}
                  step={0.001}
                  unit=""
                  value={settings.mie}
                />
                <ParameterRange
                  label="Mie anisotropy"
                  max={0.9}
                  min={0}
                  onChange={(mieG) => setSettings({ mieG })}
                  precision={2}
                  step={0.01}
                  unit=""
                  value={settings.mieG}
                />
                <ParameterRange
                  label="Sun angular radius"
                  max={(0.03 * 180) / Math.PI}
                  min={(0.00465 * 180) / Math.PI}
                  onChange={(value) => setSettings({ sunRadius: (value * Math.PI) / 180 })}
                  precision={2}
                  step={0.01}
                  unit="°"
                  value={(settings.sunRadius * 180) / Math.PI}
                />
                <ParameterRange
                  label="Sun radiance"
                  max={100}
                  min={1}
                  onChange={(sunRadiance) => setSettings({ sunRadiance })}
                  step={1}
                  unit="HDR"
                  value={settings.sunRadiance}
                />
              </div>
            </details>
            <ParameterRange
              label="Moon phase"
              max={100}
              min={0}
              onChange={(value) => setSettings({ moonPhase: value / 100 })}
              step={1}
              value={settings.moonPhase * 100}
            />
            <p className={META_CLASS}>Artistic phase: 0% new, 100% full.</p>
          </AdvancedDisclosure>

          <AdvancedDisclosure
            description="Inspect individual sky rendering passes."
            icon={Gauge}
            id={`${controlId}-diagnostics-heading`}
            title="Diagnostics"
          >
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
          </AdvancedDisclosure>

          <button
            className={`${BUTTON_CLASS} mt-2`}
            onClick={() => {
              setSettings({ ...DEFAULT_SKY_SETTINGS })
              setMotion(useEnvironmentStore.getInitialState().skyMotion)
            }}
            type="button"
          >
            <RotateCcw size={14} aria-hidden /> Reset sky
          </button>
        </fieldset>
      </div>

      <p className={META_CLASS}>
        Project appearance is saved in this browser, not in exported geometry. It stays active when
        you return to other tools.
      </p>
    </div>
  )
}
