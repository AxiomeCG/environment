'use client'

import { Check } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { HexColorPicker } from 'react-colorful'

const GRASS_PALETTE = [
  { label: 'Meadow', color: '#527a3b' },
  { label: 'Woodland', color: '#35543b' },
  { label: 'Sage', color: '#718268' },
  { label: 'Dry straw', color: '#9b8558' },
] as const

function normalizeHex(value: string) {
  const digits = value.trim().replace(/^#/, '')
  if (/^[\da-f]{3}$/i.test(digits)) {
    return `#${digits
      .split('')
      .map((digit) => `${digit}${digit}`)
      .join('')}`.toLowerCase()
  }
  return /^[\da-f]{6}$/i.test(digits) ? `#${digits.toLowerCase()}` : null
}

export function BrushColorPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (hex: string) => void
}) {
  const inputId = useId()
  const errorId = `${inputId}-error`
  const externalColor = value
  const [draft, setDraft] = useState(externalColor.toUpperCase())
  const [error, setError] = useState<string | null>(null)
  const cancelBlur = useRef(false)

  useEffect(() => {
    setDraft(externalColor.toUpperCase())
    setError(null)
  }, [externalColor])

  const updateColor = (next: string) => {
    const normalized = normalizeHex(next)
    if (!normalized) return
    setDraft(normalized.toUpperCase())
    setError(null)
    if (normalized !== externalColor.toLowerCase()) onChange(normalized)
  }

  const commitDraft = (next: string) => {
    const normalized = normalizeHex(next)
    if (!normalized) {
      setError('Use three or six hexadecimal digits, for example #527A3B.')
      return
    }
    updateColor(normalized)
  }

  return (
    <div
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-sidebar-border bg-sidebar p-3"
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden
          className="size-10 shrink-0 rounded-lg border border-sidebar-border shadow-sm"
          style={{ backgroundColor: externalColor }}
        />
        <div className="min-w-0">
          <p className="text-[11px] text-sidebar-foreground/60">Grass color</p>
          <p className="truncate font-mono text-xs font-medium uppercase tabular-nums">
            {externalColor}
          </p>
        </div>
      </div>

      <HexColorPicker
        aria-label="Grass color"
        className="!h-44 !w-full [&_.react-colorful__hue]:!h-6 [&_.react-colorful__hue]:!rounded-md [&_.react-colorful__pointer]:!size-5 [&_.react-colorful__saturation]:!rounded-lg"
        color={externalColor}
        onChange={updateColor}
      />

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-sidebar-foreground/70" htmlFor={inputId}>
          Hex
        </label>
        <input
          id={inputId}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          autoCapitalize="characters"
          className="h-9 w-full rounded-md border border-sidebar-border bg-sidebar-accent/30 px-2.5 font-mono text-xs uppercase tabular-nums outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-destructive"
          maxLength={7}
          onBlur={(event) => {
            if (cancelBlur.current) {
              cancelBlur.current = false
              return
            }
            commitDraft(event.currentTarget.value)
          }}
          onChange={(event) => {
            setDraft(event.currentTarget.value)
            if (error) setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              cancelBlur.current = true
              setDraft(externalColor.toUpperCase())
              setError(null)
              event.currentTarget.blur()
            }
          }}
          spellCheck={false}
          type="text"
          value={draft}
        />
        {error && (
          <p id={errorId} className="text-[11px] leading-snug text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>

      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-[11px] font-medium text-sidebar-foreground/70">
          Natural palette
        </legend>
        <div className="grid grid-cols-2 gap-1.5">
          {GRASS_PALETTE.map((option) => {
            const selected = externalColor.toLowerCase() === option.color
            return (
              <button
                aria-pressed={selected}
                className="flex min-h-10 min-w-0 items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/30 px-2 text-left text-[11px] text-sidebar-foreground/80 hover:bg-sidebar-accent/60 active:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                key={option.color}
                onClick={() => updateColor(option.color)}
                style={
                  selected
                    ? {
                        borderColor: 'color-mix(in srgb, var(--primary) 60%, transparent)',
                        color: 'var(--primary)',
                      }
                    : undefined
                }
                type="button"
              >
                <span
                  aria-hidden
                  className="relative flex size-4 shrink-0 items-center justify-center rounded-full border border-sidebar-border"
                  style={{ backgroundColor: option.color }}
                >
                  {selected && (
                    <Check
                      size={11}
                      strokeWidth={3}
                      style={{
                        color: '#fff',
                        filter: 'drop-shadow(0 1px 1px rgb(0 0 0 / 0.8))',
                      }}
                    />
                  )}
                </span>
                <span className="truncate">{option.label}</span>
              </button>
            )
          })}
        </div>
      </fieldset>
    </div>
  )
}
