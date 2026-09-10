'use client'

import { Moon, Sun } from 'lucide-react'
import { useId, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { formatSkyTime, skyPeriod, wrap } from './settings'
import type { SolarState } from './solar'

const STARS = [
  [70, 59, 1],
  [111, 42, 0.8],
  [162, 38, 1],
  [196, 64, 1.2],
  [47, 99, 0.8],
  [85, 91, 1.3],
  [135, 69, 0.8],
  [174, 88, 0.9],
  [222, 103, 1.1],
  [115, 117, 0.7],
  [151, 104, 1.2],
  [202, 127, 0.7],
  [67, 128, 1],
  [107, 77, 0.6],
  [155, 58, 0.6],
  [188, 111, 0.7],
] as const
const HOUR_MARKS = Array.from({ length: 24 }, (_, hour) => hour)
const ORBIT = 'M40 148 A100 100 0 0 1 240 148'

type Drag = {
  pointer: number
  initial: number
  hours: number
  last: number | null
  lastAngle: number
  lastX: number
  lastY: number
  bounds: DOMRect
}

/** A continuously turnable 24-hour half-disk; numeric time remains the shared source of truth. */
export default function TimeOrbit({
  value,
  solar,
  cloudCoverage,
  disabled,
  onChange,
}: {
  value: number
  solar: SolarState
  cloudCoverage: number
  disabled: boolean
  onChange: (hours: number) => void
}) {
  const id = useId()
  const drag = useRef<Drag | null>(null)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  valueRef.current = value
  onChangeRef.current = onChange

  const normalized = wrap(value, 24)
  const daytime = normalized >= 6 && normalized < 18
  const sunAngle = Math.PI - ((normalized - 6) / 12) * Math.PI
  const sun = {
    x: 140 + Math.cos(sunAngle) * 100,
    y: 148 - Math.sin(sunAngle) * 100,
  }
  const moon = {
    x: 140 - Math.cos(sunAngle) * 100,
    y: 148 + Math.sin(sunAngle) * 100,
  }
  const time = formatSkyTime(normalized)

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (disabled || !active || event.pointerId !== active.pointer) return

    const centerX = active.bounds.left + active.bounds.width / 2
    const centerY = active.bounds.top + active.bounds.height * (148 / 180)
    const x = event.clientX - centerX
    const y = event.clientY - centerY
    const previousX = active.lastX - centerX
    const previousY = active.lastY - centerY
    const centerRadius = active.bounds.width * (24 / 280)
    const angle = Math.atan2(y, x)

    let deltaHours: number
    if (
      Math.min(Math.hypot(x, y), Math.hypot(previousX, previousY)) < centerRadius ||
      x * previousX + y * previousY < 0
    ) {
      // A horizontal scrub keeps the hub responsive when angular direction is ambiguous.
      deltaHours = ((event.clientX - active.lastX) / active.bounds.width) * 24
    } else {
      let deltaAngle = angle - active.lastAngle
      if (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2
      if (deltaAngle < -Math.PI) deltaAngle += Math.PI * 2
      deltaHours = deltaAngle * (12 / Math.PI)
    }
    active.lastAngle = angle

    active.lastX = event.clientX
    active.lastY = event.clientY
    active.hours += deltaHours
    const minute = Math.round(active.hours * 60)
    if (minute === active.last) return
    active.last = minute
    onChangeRef.current(wrap(minute / 60, 24))
  }

  const end = (element: HTMLDivElement, cancel: boolean) => {
    const active = drag.current
    if (!active) return
    drag.current = null
    if (element.hasPointerCapture(active.pointer)) element.releasePointerCapture(active.pointer)
    if (cancel) onChangeRef.current(active.initial)
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
      case 'ArrowRight':
      case 'ArrowUp':
        next = valueRef.current + step
        break
      case 'ArrowLeft':
      case 'ArrowDown':
        next = valueRef.current - step
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = 24 - 1 / 60
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
    onChangeRef.current(wrap(next, 24))
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
        <div className="flex shrink-0 gap-1" role="group" aria-label="Time shortcuts">
          <button
            type="button"
            aria-label="Switch to daytime counterpart"
            aria-pressed={daytime}
            title="Daytime counterpart · 12 hours apart"
            disabled={disabled}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-sidebar-foreground/50 hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-foreground disabled:cursor-not-allowed"
            onClick={() => {
              if (!daytime) onChange(wrap(value + 12, 24))
            }}
          >
            <Sun size={18} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Switch to nighttime counterpart"
            aria-pressed={!daytime}
            title="Nighttime counterpart · 12 hours apart"
            disabled={disabled}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-sidebar-foreground/50 hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-foreground disabled:cursor-not-allowed"
            onClick={() => {
              if (daytime) onChange(wrap(value + 12, 24))
            }}
          >
            <Moon size={18} aria-hidden />
          </button>
        </div>
      </div>
      <div
        role="slider"
        aria-label="Continuous 24-hour time disk"
        aria-valuemin={0}
        aria-valuemax={24}
        aria-valuenow={Math.round(normalized * 60) / 60}
        aria-valuetext={`${time}, ${skyPeriod(solar.elevation)}`}
        aria-describedby={`${id}-hint`}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        className={`touch-none select-none rounded-lg focus-visible:outline-2 focus-visible:outline-ring ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing'}`}
        onKeyDown={keyDown}
        onBlur={(event) => {
          if (drag.current) end(event.currentTarget, true)
        }}
        onPointerDown={(event) => {
          event.stopPropagation()
          if (disabled || event.button !== 0 || drag.current) return
          event.preventDefault()
          event.currentTarget.focus({ preventScroll: true })
          const bounds = event.currentTarget.getBoundingClientRect()
          const centerX = bounds.left + bounds.width / 2
          const centerY = bounds.top + bounds.height * (148 / 180)
          drag.current = {
            pointer: event.pointerId,
            initial: wrap(valueRef.current, 24),
            hours: wrap(valueRef.current, 24),
            last: null,
            lastAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
            lastX: event.clientX,
            lastY: event.clientY,
            bounds,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={move}
        onPointerUp={(event) => {
          if (event.pointerId === drag.current?.pointer) end(event.currentTarget, false)
        }}
        onPointerCancel={(event) => {
          if (event.pointerId === drag.current?.pointer) end(event.currentTarget, true)
        }}
        onLostPointerCapture={(event) => {
          if (event.pointerId === drag.current?.pointer) end(event.currentTarget, true)
        }}
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
            <linearGradient id={`${id}-rim`} x2="0" y2="1">
              <stop stopColor="#ffffff" stopOpacity="0.52" />
              <stop offset="0.55" stopColor="#ffffff" stopOpacity="0.16" />
              <stop offset="1" stopColor="#07101f" stopOpacity="0.54" />
            </linearGradient>
            <radialGradient id={`${id}-sun-glow`}>
              <stop stopColor="#ffefb1" stopOpacity="0.5" />
              <stop offset="1" stopColor="#ffefb1" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${id}-moon-glow`}>
              <stop stopColor="#e3f0ff" stopOpacity="0.5" />
              <stop offset="1" stopColor="#e3f0ff" stopOpacity="0" />
            </radialGradient>
          </defs>

          <path d="M16 151 A124 124 0 0 1 264 151Z" fill="#020711" opacity="0.34" />
          <g clipPath={`url(#${id}-sky)`}>
            <path d="M16 148 A124 124 0 0 1 264 148Z" fill={`url(#${id}-night)`} />
            <rect
              x="16"
              y="24"
              width="248"
              height="124"
              fill={`url(#${id}-day)`}
              opacity={solar.daylight}
            />
            <rect
              x="16"
              y="24"
              width="248"
              height="124"
              fill={`url(#${id}-dusk)`}
              opacity={solar.twilight}
            />
            <g fill="#f3f6ff" opacity={solar.night * (1 - cloudCoverage * 0.75)}>
              {STARS.map(([sx, sy, radius], index) => (
                <circle key={index} cx={sx} cy={sy} r={radius} />
              ))}
              <path d="M179 47v6m-3-3h6M92 110v5m-2.5-2.5h5" stroke="#eef4ff" strokeWidth="0.8" />
            </g>
            <g fill={`url(#${id}-cloud)`} opacity={cloudCoverage * (0.75 - solar.night * 0.4)}>
              <path d="M27 109c5-7 12-8 20-5 1-12 11-18 21-14 6-13 25-10 28 3 12-4 23 4 24 12 13-1 22 3 27 9H27Z" />
              <path d="M162 77c6-9 16-10 24-5 6-12 23-13 31-2 8-4 22 2 24 11 11-1 19 4 24 10H151c1-7 5-11 11-14Z" />
              <path
                d="M136 139c8-8 18-9 27-5 6-12 22-12 29-2 11-4 23 0 30 10H128Z"
                opacity="0.65"
              />
            </g>

            <g transform={`rotate(${normalized * 15} 140 148)`} stroke="#ffffff">
              {HOUR_MARKS.map((hour) => (
                <line
                  key={hour}
                  x1="140"
                  y1={hour % 6 === 0 ? 27 : 30}
                  x2="140"
                  y2="35"
                  strokeWidth={hour % 6 === 0 ? 1.5 : 1}
                  strokeOpacity={hour % 6 === 0 ? 0.62 : 0.28}
                  transform={`rotate(${hour * 15} 140 148)`}
                />
              ))}
            </g>

            <circle cx={sun.x} cy={sun.y} r="42" fill={`url(#${id}-sun-glow)`} />
            <circle cx={moon.x} cy={moon.y} r="42" fill={`url(#${id}-moon-glow)`} />
            <g transform={`translate(${sun.x} ${sun.y})`}>
              <circle r="14" fill="#c68538" stroke="#f5f7ff" strokeOpacity="0.7" />
              <Sun
                x="-10"
                y="-10"
                width="20"
                height="20"
                stroke="#fff4c9"
                fill="#ffe6a0"
                strokeWidth="1.5"
              />
            </g>
            <g transform={`translate(${moon.x} ${moon.y})`}>
              <circle r="14" fill="#263b62" stroke="#f5f7ff" strokeOpacity="0.7" />
              <Moon
                x="-10"
                y="-10"
                width="20"
                height="20"
                stroke="#e6f0ff"
                fill="#e6f0ff"
                strokeWidth="1.5"
              />
            </g>
          </g>

          <path
            d="M16 148 A124 124 0 0 1 264 148"
            fill="none"
            stroke={`url(#${id}-rim)`}
            strokeWidth="8"
          />
          <path
            d="M20 148 A120 120 0 0 1 260 148"
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.2"
          />
          <path d={ORBIT} fill="none" stroke="#ffffff" strokeOpacity="0.35" strokeDasharray="2 5" />
          <path d="M16 148H264" stroke="#020711" strokeOpacity="0.58" strokeWidth="5" />
          <path d="M18 146.5H262" stroke="#ffffff" strokeOpacity="0.2" />
          <path
            d="M128 148 A12 12 0 0 1 152 148Z"
            fill="currentColor"
            fillOpacity="0.11"
            stroke="#ffffff"
            strokeOpacity="0.2"
          />
          <path
            d="M134 143H146M136 139H144"
            stroke="currentColor"
            strokeOpacity="0.32"
            strokeLinecap="round"
          />

          <g
            fill="currentColor"
            className="font-mono text-sidebar-foreground/60"
            fontSize="10"
            textAnchor="middle"
          >
            <text x="40" y="176">
              {daytime ? '06:00' : '18:00'}
            </text>
            <text x="140" y="176">
              {daytime ? '12:00' : '00:00'}
            </text>
            <text x="240" y="176">
              {daytime ? '18:00' : '06:00'}
            </text>
          </g>
        </svg>
      </div>
      <div className="min-w-0 space-y-1 px-3 pb-3 pt-2 text-center">
        <p className="text-balance text-xs font-medium leading-5 text-sidebar-foreground/80">
          {skyPeriod(solar.elevation)}
        </p>
        <p
          id={`${id}-hint`}
          className="text-pretty text-[11px] leading-4 text-sidebar-foreground/60"
        >
          Drag to change time.
          <span className="sr-only">
            {' '}
            All 24 hours are continuous. Arrow keys adjust five minutes; Shift adjusts thirty.
            Escape cancels a drag.
          </span>
        </p>
      </div>
    </div>
  )
}
