'use client'

import { linearUnitToMeters, metersToLinearUnit } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useId, useRef, useState } from 'react'

function RadialSlider({
  id,
  value,
  min,
  max,
  step,
  valueText,
  displayValue,
  displayUnit,
  visual,
  layout,
  onChange,
  onCommit,
  onCancel,
}: {
  id: string
  value: number
  min: number
  max: number
  step: number
  valueText: string
  displayValue: string
  displayUnit: string
  visual: 'radius' | 'amount'
  layout: 'row' | 'tile'
  onChange: (value: number) => void
  onCommit: () => void
  onCancel: (value: number) => void
}) {
  const drag = useRef<{
    pointerId: number
    startValue: number
    centerX: number
    centerY: number
    angle: number
    sweep: number
  } | null>(null)
  const fraction = Math.max(0, Math.min(1, (value - min) / (max - min)))
  const angle = ((135 + fraction * 270) * Math.PI) / 180
  const previewRadius = 8 + fraction * 15
  const changeSweep = (sweep: number) => {
    const next = min + Math.round(((sweep / 270) * (max - min)) / step) * step
    onChange(Math.max(min, Math.min(max, next)))
  }

  return (
    <div
      id={id}
      role="slider"
      tabIndex={0}
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-hint`}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      className={`${layout === 'tile' ? 'col-start-1 row-start-2 size-20' : 'col-start-1 row-start-1 size-22'} touch-none select-none rounded-full text-primary cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0 || drag.current) return
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.focus({ preventScroll: true })
        const rect = event.currentTarget.getBoundingClientRect()
        const centerX = rect.left + rect.width / 2
        const centerY = rect.top + rect.height / 2
        const pointerAngle =
          (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) / Math.PI
        const rawSweep = (pointerAngle - 135 + 360) % 360
        const sweep = rawSweep <= 270 ? rawSweep : rawSweep < 315 ? 270 : 0
        drag.current = {
          pointerId: event.pointerId,
          startValue: value,
          centerX,
          centerY,
          angle: pointerAngle,
          sweep,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        changeSweep(sweep)
      }}
      onPointerMove={(event) => {
        const gesture = drag.current
        if (!gesture || gesture.pointerId !== event.pointerId) return
        event.stopPropagation()
        const pointerAngle =
          (Math.atan2(event.clientY - gesture.centerY, event.clientX - gesture.centerX) * 180) /
          Math.PI
        const delta = ((pointerAngle - gesture.angle + 540) % 360) - 180
        gesture.sweep = Math.max(0, Math.min(270, gesture.sweep + delta))
        gesture.angle = pointerAngle
        changeSweep(gesture.sweep)
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return
        event.stopPropagation()
        drag.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
        onCommit()
      }}
      onLostPointerCapture={() => {
        if (!drag.current) return
        const startValue = drag.current.startValue
        drag.current = null
        onCancel(startValue)
      }}
      onPointerCancel={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return
        const startValue = drag.current.startValue
        drag.current = null
        onCancel(startValue)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && drag.current) {
          event.preventDefault()
          event.stopPropagation()
          const gesture = drag.current
          drag.current = null
          event.currentTarget.releasePointerCapture(gesture.pointerId)
          onCancel(gesture.startValue)
          return
        }
        const increment = step * (event.shiftKey ? 10 : 1)
        let next: number
        switch (event.key) {
          case 'ArrowUp':
          case 'ArrowRight':
            next = value + increment
            break
          case 'ArrowDown':
          case 'ArrowLeft':
            next = value - increment
            break
          case 'PageUp':
            next = value + step * 10
            break
          case 'PageDown':
            next = value - step * 10
            break
          case 'Home':
            next = min
            break
          case 'End':
            next = max
            break
          default:
            return
        }
        event.preventDefault()
        event.stopPropagation()
        onChange(Math.max(min, Math.min(max, next)))
      }}
      onKeyUp={onCommit}
      onBlur={onCommit}
    >
      <svg aria-hidden="true" viewBox="0 0 100 100" className="size-full">
        <circle
          cx="50"
          cy="50"
          r="38"
          fill="none"
          pathLength="100"
          stroke="currentColor"
          strokeOpacity="0.15"
          strokeWidth="4"
          strokeDasharray="75 100"
          strokeLinecap="round"
          transform="rotate(135 50 50)"
        />
        <circle
          cx="50"
          cy="50"
          r="38"
          fill="none"
          pathLength="100"
          stroke="currentColor"
          strokeWidth="4"
          strokeDasharray={`${fraction * 75} 100`}
          strokeLinecap="round"
          transform="rotate(135 50 50)"
        />
        {visual === 'radius' ? (
          <>
            <circle
              cx="50"
              cy="50"
              r={previewRadius}
              fill="currentColor"
              fillOpacity="0.08"
              stroke="currentColor"
              strokeOpacity="0.4"
              strokeDasharray="2 3"
            />
            <circle cx="50" cy="50" r="2" fill="currentColor" />
            <path
              d={`M 50 50 h ${previewRadius} m 0 -3 v 6`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <text x="50" y="92" textAnchor="middle" fill="currentColor" fontSize="9">
              RADIUS
            </text>
          </>
        ) : (
          <text
            x="50"
            y="50"
            textAnchor="middle"
            dominantBaseline="central"
            fill="currentColor"
            fontSize="14"
            fontWeight="600"
          >
            {displayValue}
            {displayUnit}
          </text>
        )}
        <circle
          cx={50 + Math.cos(angle) * 38}
          cy={50 + Math.sin(angle) * 38}
          r="5"
          fill="currentColor"
          stroke="var(--sidebar)"
          strokeWidth="2"
        />
      </svg>
    </div>
  )
}

export function ParameterRange({
  label,
  value,
  min,
  max,
  step,
  unit = '%',
  precision = 0,
  commitOnRelease = false,
  presentation = 'linear',
  radialVisual = 'amount',
  radialLayout = 'row',
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  precision?: number
  commitOnRelease?: boolean
  presentation?: 'linear' | 'radial'
  radialVisual?: 'radius' | 'amount'
  radialLayout?: 'row' | 'tile'
  onChange: (value: number) => void
}) {
  const id = useId()
  const viewerUnit = useViewer((state) => state.unit)
  const imperial = viewerUnit === 'imperial' && unit === 'm'
  const display = (stored: number) => (imperial ? metersToLinearUnit(stored, 'imperial') : stored)
  const stored = (shown: number) => (imperial ? linearUnitToMeters(shown, 'imperial') : shown)
  const displayUnit = imperial ? 'ft' : unit
  const [draft, setDraft] = useState<string | null>(null)
  const [rangeDraft, setRangeDraft] = useState<number | null>(null)
  const shown = display(rangeDraft ?? value).toFixed(precision)
  const commitRange = () => {
    if (rangeDraft === null) return
    onChange(rangeDraft)
    setRangeDraft(null)
  }
  const commit = (raw: string) => {
    const next = raw.trim() === '' ? NaN : Number(raw)
    if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, stored(next))))
    setDraft(null)
  }
  const labelControl = (
    <label
      id={`${id}-label`}
      htmlFor={id}
      className={`text-xs text-sidebar-foreground/80 ${presentation === 'radial' && radialLayout === 'tile' ? 'w-full' : ''}`}
    >
      {label}
    </label>
  )
  const exactEntry = (
    <div className="flex h-8 max-w-full items-center gap-1 rounded-md border border-sidebar-border bg-sidebar px-2 focus-within:ring-1 focus-within:ring-ring">
      <input
        aria-label={`${label} value (${displayUnit})`}
        className="w-14 min-w-0 bg-transparent text-right font-mono text-xs tabular-nums outline-none"
        type="number"
        min={display(min)}
        max={display(max)}
        step={step}
        value={draft ?? shown}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            event.stopPropagation()
            event.currentTarget.value = shown
            setDraft(null)
            event.currentTarget.blur()
          }
        }}
      />
      <span aria-hidden className="text-[11px] text-sidebar-foreground/60">
        {displayUnit}
      </span>
    </div>
  )

  if (presentation === 'radial') {
    const slider = (
      <RadialSlider
        id={id}
        value={display(rangeDraft ?? value)}
        min={display(min)}
        max={display(max)}
        step={step}
        valueText={`${shown} ${displayUnit}`}
        displayValue={shown}
        displayUnit={displayUnit}
        visual={radialVisual}
        layout={radialLayout}
        onChange={(next) => {
          setDraft(null)
          const nextStored = Math.max(min, Math.min(max, stored(next)))
          if (commitOnRelease) setRangeDraft(nextStored)
          else onChange(nextStored)
        }}
        onCommit={commitRange}
        onCancel={(startValue) => {
          setRangeDraft(null)
          if (!commitOnRelease) onChange(stored(startValue))
        }}
      />
    )
    const hint = (
      <p
        id={`${id}-hint`}
        className={
          radialLayout === 'tile'
            ? 'sr-only'
            : 'text-[11px] leading-relaxed text-sidebar-foreground/60'
        }
      >
        Drag the arc or use arrow keys.
      </p>
    )

    if (radialLayout === 'tile') {
      return (
        <div className="grid min-w-0 grid-cols-1 justify-items-center gap-y-2 rounded-xl bg-muted/30 p-3">
          {labelControl}
          {slider}
          {exactEntry}
          {hint}
        </div>
      )
    }

    return (
      <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 rounded-xl bg-muted/30 p-3">
        <div className="col-start-2 row-start-1 flex min-w-0 flex-col items-start gap-2">
          {labelControl}
          {exactEntry}
          {hint}
        </div>
        {slider}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-9 items-center justify-between gap-3">
        {labelControl}
        {exactEntry}
      </div>
      <input
        id={id}
        className="h-6 w-full cursor-pointer focus-visible:outline-2 focus-visible:outline-ring"
        style={{ accentColor: 'var(--primary)' }}
        type="range"
        min={display(min)}
        max={display(max)}
        step={step}
        value={display(rangeDraft ?? value)}
        aria-valuetext={`${shown} ${displayUnit}`}
        onChange={(event) => {
          setDraft(null)
          const next = Math.max(min, Math.min(max, stored(event.target.valueAsNumber)))
          if (commitOnRelease) setRangeDraft(next)
          else onChange(next)
        }}
        onPointerUp={commitRange}
        onPointerCancel={() => setRangeDraft(null)}
        onKeyUp={commitRange}
        onBlur={commitRange}
      />
    </div>
  )
}
