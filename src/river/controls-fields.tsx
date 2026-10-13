'use client'

import type { Plus } from 'lucide-react'
import type { ReactNode } from 'react'

export function RiverButton({
  label,
  icon: Icon,
  disabled = false,
  disabledReason,
  destructive = false,
  emphasized = false,
  onClick,
}: {
  label: string
  icon: typeof Plus
  disabled?: boolean
  disabledReason?: string
  destructive?: boolean
  emphasized?: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-md border px-2 font-medium text-xs disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-ring ${
        destructive
          ? 'border-sidebar-border bg-destructive/10 text-destructive enabled:hover:bg-destructive/20'
          : emphasized
            ? 'border-primary bg-primary/15 text-primary enabled:hover:bg-primary/20'
            : 'border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground enabled:hover:bg-sidebar-accent'
      }`}
      disabled={disabled}
      onClick={onClick}
      title={disabled ? disabledReason : undefined}
      type="button"
    >
      <Icon aria-hidden size={15} />
      {label}
    </button>
  )
}

export type RiverSelectOption<Value extends string> = Readonly<{
  value: Value
  label: string
  disabled?: boolean
}>

/** A labelled select row, as every choice in the river panel is laid out. */
export function RiverSelectField<Value extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value: Value
  options: readonly RiverSelectOption<Value>[]
  disabled?: boolean
  onChange: (value: Value) => void
}) {
  return (
    <label className="flex min-h-10 items-center justify-between gap-3 text-xs">
      <span>{label}</span>
      <select
        className="h-9 rounded-md border border-sidebar-border bg-transparent px-3 text-sidebar-foreground text-xs focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-45"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as Value)}
        value={value}
      >
        {options.map((option) => (
          <option disabled={option.disabled} key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** A short explanatory line under a group of controls. */
export function RiverHint({ children }: { children: ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-sidebar-foreground/60">{children}</p>
}

/** A titled group of controls in the river panel. */
export function RiverPanelGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold">{title}</h3>
      {children}
    </section>
  )
}
