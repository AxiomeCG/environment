'use client'

import { linearUnitToMeters, metersToLinearUnit } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useId, useState } from 'react'

export function ParameterRange({
  label,
  value,
  min,
  max,
  step,
  unit = '%',
  precision = 0,
  commitOnRelease = false,
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
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <label id={`${id}-label`} htmlFor={id} className="text-xs text-sidebar-foreground/80">
          {label}
        </label>
        <div className="flex h-8 items-center gap-1 rounded-md border border-sidebar-border bg-sidebar px-2 focus-within:ring-1 focus-within:ring-ring">
          <input
            aria-label={`${label} value (${displayUnit})`}
            className="w-14 bg-transparent text-right font-mono text-xs tabular-nums outline-none"
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
