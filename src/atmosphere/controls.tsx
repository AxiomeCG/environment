'use client'

import { Pause, Play, RotateCcw } from 'lucide-react'
import { useMemo } from 'react'
import { ParameterRange } from '../parameter-range'
import { useEnvironmentStore } from '../store'
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

const SELECT_CLASS =
  'min-h-9 w-full rounded-md border border-sidebar-border bg-sidebar px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring'
const BUTTON_CLASS =
  'flex min-h-9 items-center justify-center gap-2 rounded-md border border-sidebar-border px-3 text-xs hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50'

export default function AtmosphereControls() {
  const settings = useEnvironmentStore((state) => state.skySettings)
  const enabled = useEnvironmentStore((state) => state.skyEnabled)
  const playing = useEnvironmentStore((state) => state.skyPlaying)
  const motion = useEnvironmentStore((state) => state.skyMotion)
  const setEnabled = useEnvironmentStore((state) => state.setSkyEnabled)
  const setSettings = useEnvironmentStore((state) => state.setSkySettings)
  const setPlaying = useEnvironmentStore((state) => state.setSkyPlaying)
  const setMotion = useEnvironmentStore((state) => state.setSkyMotion)
  const solar = useMemo(() => {
    const value = createSolarState()
    updateSolarState(settings, value)
    return value
  }, [settings])
  const presetId =
    SKY_PRESETS.find((preset) => {
      const expected = {
        ...DEFAULT_SKY_SETTINGS,
        ...preset.settings,
        northOffset: settings.northOffset,
      }
      return (Object.keys(expected) as (keyof SkySettings)[]).every(
        (key) => settings[key] === expected[key],
      )
    })?.id ?? ''

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <label className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-sidebar-border px-3 py-2 text-xs">
        <span>Use environment sky</span>
        <input
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          type="checkbox"
        />
      </label>
      <label className="flex flex-col gap-2 text-xs">
        <span className="font-medium">Ambiance</span>
        <select
          className={SELECT_CLASS}
          value={presetId}
          onChange={(event) => {
            const preset = SKY_PRESETS.find((entry) => entry.id === event.target.value)
            if (!preset) return
            setSettings({
              ...DEFAULT_SKY_SETTINGS,
              ...preset.settings,
              northOffset: settings.northOffset,
            })
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
      {!enabled && (
        <p className="text-xs text-sidebar-foreground/60">
          Pascal’s scene theme is active. Choose an ambiance or enable the sky to preview it.
        </p>
      )}

      <fieldset disabled={!enabled} className="flex min-w-0 flex-col gap-4 disabled:opacity-50">
        <legend className="sr-only">Sky settings</legend>
        <section className="flex flex-col gap-2" aria-label="Sun and time">
          <div className="flex items-center justify-between gap-3">
            <div>
              {settings.sunMode === 'time' ? (
                <h3 className="text-xs font-semibold">Sun &amp; moon</h3>
              ) : (
                <>
                  <p className="font-mono text-2xl font-medium tabular-nums">
                    {solar.elevation.toFixed(1)}°
                  </p>
                  <p className="text-xs text-sidebar-foreground/60">{skyPeriod(solar.elevation)}</p>
                </>
              )}
            </div>
            <button
              className={BUTTON_CLASS}
              type="button"
              disabled={settings.sunMode !== 'time'}
              aria-pressed={playing}
              onClick={() => setPlaying(!playing)}
            >
              {playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
              {playing ? 'Pause day' : 'Play day'}
            </button>
          </div>
          <label className="flex flex-col gap-2 text-xs">
            <span>Sun position</span>
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
            <>
              <TimeOrbit
                value={settings.timeOfDay}
                solar={solar}
                cloudCoverage={settings.cloudCoverage}
                disabled={!enabled}
                onChange={(timeOfDay) => setSettings({ timeOfDay })}
              />
              <ParameterRange
                label="North offset"
                value={settings.northOffset}
                min={0}
                max={359}
                step={1}
                unit="°"
                onChange={(northOffset) => setSettings({ northOffset })}
              />
              <p className="text-[11px] text-sidebar-foreground/60">
                Artistic 24-hour orbit, north = −Z. Playback takes two minutes; not a geolocated
                solar study.
              </p>
            </>
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
              <p className="text-[11px] text-sidebar-foreground/60">
                0° north · 90° east · 180° south · 270° west.
              </p>
            </>
          )}
        </section>

        <section
          className="flex flex-col gap-2 border-t border-sidebar-border pt-3"
          aria-label="Clouds and visibility"
        >
          <h3 className="text-xs font-semibold">Clouds &amp; visibility</h3>
          <ParameterRange
            label="Cloud cover"
            value={settings.cloudCoverage * 100}
            min={0}
            max={100}
            step={1}
            onChange={(value) => setSettings({ cloudCoverage: value / 100 })}
          />
          <label className="flex min-h-9 items-center justify-between gap-3 text-xs">
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
        </section>

        <details className="border-t border-sidebar-border pt-3">
          <summary className="min-h-9 cursor-pointer text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">
            Atmosphere model
          </summary>
          <div className="flex flex-col gap-2 pt-2">
            <label className="flex flex-col gap-2 text-xs">
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
            <ParameterRange
              label="Moon phase"
              value={settings.moonPhase * 100}
              min={0}
              max={100}
              step={1}
              onChange={(value) => setSettings({ moonPhase: value / 100 })}
            />
            <p className="text-[11px] text-sidebar-foreground/60">
              Simplified scattering and three-octave directional clouds. Moon phase is artistic: 0%
              new, 100% full.
            </p>
          </div>
        </details>

        <details className="border-t border-sidebar-border pt-3">
          <summary className="min-h-9 cursor-pointer text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">
            Diagnostics
          </summary>
          <label className="flex flex-col gap-2 pt-2 text-xs">
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
            <span className="text-[11px] text-sidebar-foreground/60">
              Background only. Reflections, fog and lighting keep the full sky.
            </span>
          </label>
        </details>
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
      </fieldset>
      <p className="text-[11px] leading-relaxed text-sidebar-foreground/60">
        Runtime only — sky settings are not saved to the project or included in geometry exports.
        The sky stays active when you return to other tools.
      </p>
    </div>
  )
}
