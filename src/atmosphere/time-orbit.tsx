'use client'

import { Moon, Sun } from 'lucide-react'
import { useId, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { formatSkyTime, skyPeriod, wrap, type SolarState } from './settings'

const STARS = [
  [70, 59, 1], [111, 42, 0.8], [162, 38, 1], [196, 64, 1.2],
  [47, 99, 0.8], [85, 91, 1.3], [135, 69, 0.8], [174, 88, 0.9],
  [222, 103, 1.1], [115, 117, 0.7], [151, 104, 1.2], [202, 127, 0.7],
  [67, 128, 1], [107, 77, 0.6], [155, 58, 0.6], [188, 111, 0.7],
] as const
const ORBIT = 'M40 148 A100 100 0 0 1 240 148'

type Drag = {
  pointer: number
  start: number
  initial: number
  last: number | null
  bounds: DOMRect
}

/** A daylight or nighttime half-orbit; the numeric time remains the shared source of truth. */
export default function TimeOrbit({ value, solar, cloudCoverage, disabled, onChange }: {
  value: number
  solar: SolarState
  cloudCoverage: number
  disabled: boolean
  onChange: (hours: number) => void
}) {
  const id = useId()
  const drag = useRef<Drag | null>(null)
  const daytime = value >= 6 && value < 18
  const progress = wrap(value - (daytime ? 6 : 18), 24) / 12
  const angle = (1 - progress) * Math.PI
  const x = 140 + Math.cos(angle) * 100
  const y = 148 - Math.sin(angle) * 100
  const time = formatSkyTime(value)

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (!active || event.pointerId !== active.pointer) return
    const px = ((event.clientX - active.bounds.left) / active.bounds.width) * 280 - 140
    const py = Math.max(0, 148 - ((event.clientY - active.bounds.top) / active.bounds.height) * 180)
    if (px * px + py * py < 64) return
    const fraction = 1 - Math.atan2(py, px) / Math.PI
    // Keep the grabbed body on its half-orbit until release, including at the horizon.
    const minute = Math.max(0, Math.min(719, Math.round(fraction * 720)))
    if (minute === active.last) return
    active.last = minute
    onChange(wrap(active.start + minute / 60, 24))
  }

  const end = (element: HTMLDivElement, cancel: boolean) => {
    const active = drag.current
    if (!active) return
    drag.current = null
    if (element.hasPointerCapture(active.pointer)) element.releasePointerCapture(active.pointer)
    if (cancel) onChange(active.initial)
  }

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    if (event.key === 'Escape') {
      if (!drag.current) return
      event.preventDefault()
      event.stopPropagation()
      end(event.currentTarget, true)
      return
    }
    const step = (event.shiftKey ? 30 : 5) / 60
    let next: number
    switch (event.key) {
      case 'ArrowRight': case 'ArrowUp': next = value + step; break
      case 'ArrowLeft': case 'ArrowDown': next = value - step; break
      case 'Home': next = 0; break
      case 'End': next = 24 - 1 / 60; break
      default: return
    }
    event.preventDefault()
    event.stopPropagation()
    onChange(wrap(next, 24))
  }

  return (
    <div className="min-w-0 rounded-xl border border-sidebar-border bg-sidebar">
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <div className="min-w-0">
          <label htmlFor={`${id}-time`} className="block text-[11px] text-sidebar-foreground/60">
            Time of day
          </label>
          <input
            id={`${id}-time`}
            type="time"
            step={60}
            value={time}
            disabled={disabled}
            className="min-h-11 w-32 max-w-full rounded bg-transparent font-mono text-xl font-medium tabular-nums focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-calendar-picker-indicator]:hidden"
            onChange={(event) => {
              const milliseconds = event.currentTarget.valueAsNumber
              if (Number.isFinite(milliseconds)) onChange(milliseconds / 3_600_000)
            }}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </div>
        <div className="flex shrink-0 gap-1" role="group" aria-label="Visible orbit">
          <button
            type="button"
            aria-label="Day orbit"
            aria-pressed={daytime}
            title="Day orbit · 06:00–18:00"
            disabled={disabled}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-sidebar-foreground/50 hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-foreground disabled:cursor-not-allowed"
            onClick={() => { if (!daytime) onChange(wrap(value + 12, 24)) }}
          >
            <Sun size={18} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Night orbit"
            aria-pressed={!daytime}
            title="Night orbit · 18:00–06:00"
            disabled={disabled}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-sidebar-foreground/50 hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-foreground disabled:cursor-not-allowed"
            onClick={() => { if (daytime) onChange(wrap(value + 12, 24)) }}
          >
            <Moon size={18} aria-hidden />
          </button>
        </div>
      </div>
      <div
        role="slider"
        aria-label="Sun and moon time orbit"
        aria-valuemin={0}
        aria-valuemax={24}
        aria-valuenow={Math.round(value * 60) / 60}
        aria-valuetext={`${time}, ${skyPeriod(solar.elevation)}`}
        aria-describedby={`${id}-hint`}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        className={`touch-none select-none rounded-lg focus-visible:outline-2 focus-visible:outline-ring ${disabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}
        onKeyDown={keyDown}
        onPointerDown={(event) => {
          event.stopPropagation()
          if (disabled || event.button !== 0 || drag.current) return
          event.preventDefault()
          event.currentTarget.focus({ preventScroll: true })
          drag.current = {
            pointer: event.pointerId,
            start: daytime ? 6 : 18,
            initial: value,
            last: null,
            bounds: event.currentTarget.getBoundingClientRect(),
          }
          event.currentTarget.setPointerCapture(event.pointerId)
          move(event)
        }}
        onPointerMove={move}
        onPointerUp={(event) => { if (event.pointerId === drag.current?.pointer) end(event.currentTarget, false) }}
        onPointerCancel={(event) => { if (event.pointerId === drag.current?.pointer) end(event.currentTarget, true) }}
        onLostPointerCapture={(event) => { if (event.pointerId === drag.current?.pointer) end(event.currentTarget, true) }}
      >
        <svg viewBox="0 0 280 180" className="block w-full" aria-hidden="true">
          <defs>
            <clipPath id={`${id}-sky`}>
              <path d="M16 148 A124 124 0 0 1 264 148Z" />
            </clipPath>
            <linearGradient id={`${id}-night`} x2="0" y2="1">
              <stop stopColor="#0b1836" />
              <stop offset="1" stopColor="#365477" />
            </linearGradient>
            <linearGradient id={`${id}-day`} x2="0" y2="1">
              <stop stopColor="#4d99c8" />
              <stop offset="0.65" stopColor="#99d5e5" />
              <stop offset="1" stopColor="#e4e8ce" />
            </linearGradient>
            <linearGradient id={`${id}-dusk`} x2="0" y2="1">
              <stop stopColor="#344975" />
              <stop offset="0.6" stopColor="#ba7896" />
              <stop offset="1" stopColor="#f7bc83" />
            </linearGradient>
            <linearGradient id={`${id}-cloud`} x2="0" y2="1">
              <stop stopColor="#f5fbff" stopOpacity="0.9" />
              <stop offset="1" stopColor="#e4eef7" stopOpacity="0.12" />
            </linearGradient>
            <radialGradient id={`${id}-glow`}>
              <stop stopColor={daytime ? '#ffefb1' : '#e3f0ff'} stopOpacity="0.5" />
              <stop offset="1" stopColor={daytime ? '#ffefb1' : '#e3f0ff'} stopOpacity="0" />
            </radialGradient>
          </defs>
          <g clipPath={`url(#${id}-sky)`}>
            <path d="M16 148 A124 124 0 0 1 264 148Z" fill={`url(#${id}-night)`} />
            <rect x="16" y="24" width="248" height="124" fill={`url(#${id}-day)`} opacity={solar.daylight} />
            <rect x="16" y="24" width="248" height="124" fill={`url(#${id}-dusk)`} opacity={solar.twilight} />
            <g fill="#f3f6ff" opacity={solar.night * (1 - cloudCoverage * 0.75)}>
              {STARS.map(([sx, sy, radius], index) => <circle key={index} cx={sx} cy={sy} r={radius} />)}
              <path d="M179 47v6m-3-3h6M92 110v5m-2.5-2.5h5" stroke="#eef4ff" strokeWidth="0.8" />
            </g>
            <g fill={`url(#${id}-cloud)`} opacity={cloudCoverage * (0.75 - solar.night * 0.4)}>
              <path d="M27 109c5-7 12-8 20-5 1-12 11-18 21-14 6-13 25-10 28 3 12-4 23 4 24 12 13-1 22 3 27 9H27Z" />
              <path d="M162 77c6-9 16-10 24-5 6-12 23-13 31-2 8-4 22 2 24 11 11-1 19 4 24 10H151c1-7 5-11 11-14Z" />
              <path d="M136 139c8-8 18-9 27-5 6-12 22-12 29-2 11-4 23 0 30 10H128Z" opacity="0.65" />
            </g>
            <circle cx={x} cy={y} r="42" fill={`url(#${id}-glow)`} />
          </g>
          <path d="M16 148H264" stroke="currentColor" strokeOpacity="0.15" />
          <path d={ORBIT} fill="none" stroke="#ffffff" strokeOpacity="0.45" strokeDasharray="2 5" />
          <path d={ORBIT} fill="none" stroke="#fff7dc" strokeOpacity="0.8" strokeWidth="1.5" pathLength="1" strokeDasharray={`${progress} 1`} />
          <g transform={`translate(${x} ${y})`}>
            <circle r="22" fill={`url(#${id}-glow)`} />
            <circle r="14" fill={daytime ? '#c68538' : '#263b62'} stroke="#f5f7ff" strokeOpacity="0.7" />
            {daytime
              ? <Sun x="-10" y="-10" width="20" height="20" stroke="#fff4c9" fill="#ffe6a0" strokeWidth="1.5" />
              : <Moon x="-10" y="-10" width="20" height="20" stroke="#e6f0ff" fill="#e6f0ff" strokeWidth="1.5" />}
          </g>
          <g fill="currentColor" className="font-mono text-sidebar-foreground/60" fontSize="10" textAnchor="middle">
            <text x="40" y="176">{daytime ? '06:00' : '18:00'}</text>
            <text x="140" y="176">{daytime ? '12:00' : '00:00'}</text>
            <text x="240" y="176">{daytime ? '18:00' : '06:00'}</text>
          </g>
        </svg>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-3 text-[11px] text-sidebar-foreground/60">
        <p id={`${id}-hint`}>
          Drag the {daytime ? 'sun' : 'moon'} along the arc.
          <span className="sr-only"> Arrow keys adjust five minutes; Shift adjusts thirty. Escape cancels a drag.</span>
        </p>
        <span className="shrink-0">{skyPeriod(solar.elevation)}</span>
      </div>
    </div>
  )
}
