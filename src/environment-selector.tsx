'use client'

import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import {
  ChevronRight,
  House,
  type LucideIcon,
  Mountain,
  Route,
  Sprout,
  Sun,
  Trees,
  Waves,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

export const ENVIRONMENT_TOOLS = [
  'ground-cover',
  'atmosphere',
  'surroundings',
  'build',
  'terrain',
  'path',
  'water',
] as const

export type EnvironmentTool = (typeof ENVIRONMENT_TOOLS)[number]
export const ENVIRONMENT_TOOL_ICONS: Record<EnvironmentTool, LucideIcon> = {
  'ground-cover': Sprout,
  atmosphere: Sun,
  surroundings: Trees,
  build: House,
  terrain: Mountain,
  path: Route,
  water: Waves,
}

export const ENVIRONMENT_TOOL_LABELS: Record<EnvironmentTool, string> = {
  'ground-cover': 'Ground Cover',
  atmosphere: 'Atmosphere',
  surroundings: 'Surroundings',
  build: 'Build',
  terrain: 'Terrain',
  path: 'Surface',
  water: 'Water',
}

const ENVIRONMENT_TOOL_DESCRIPTIONS: Record<EnvironmentTool, string> = {
  'ground-cover': 'Paint grass, flowers, and low vegetation.',
  atmosphere: 'Adjust the sky, lighting, and atmosphere.',
  surroundings: 'Configure roads and the neighborhood beyond the site.',
  build: 'Open Pascal building tools.',
  terrain: 'Raise, lower, flatten, and smooth the terrain.',
  path: 'Paint terrain-conforming surface materials.',
  water: 'Create and adjust ponds and water levels.',
}

type EnvironmentSelectorProps = {
  className?: string
  disabledTools?: readonly EnvironmentTool[]
  onSelect: (tool: EnvironmentTool) => void
}

const bundledSelectorUrl = new URL('./environment-selector.svg', import.meta.url).href

function isEnvironmentTool(value: string | undefined): value is EnvironmentTool {
  return ENVIRONMENT_TOOLS.includes(value as EnvironmentTool)
}
type TooltipAnchor = {
  tool: EnvironmentTool
  left: number
  top: number
  width: number
  height: number
  followsPointer: boolean
}

const TOOLTIP_DELAY_MS = 200
const TOOLTIP_SKIP_DELAY_MS = 300
const NO_DISABLED_TOOLS: readonly EnvironmentTool[] = []
type PointerPosition = { x: number; y: number }

function getToolZone(target: EventTarget | null) {
  return target instanceof Element ? target.closest<SVGGElement>('[data-tool]') : null
}

function measureTooltipAnchor(
  zone: SVGGElement,
  container: HTMLDivElement,
  pointer?: PointerPosition,
) {
  if (pointer) {
    return { left: pointer.x, top: pointer.y, width: 0, height: 0, followsPointer: true }
  }
  const zoneRect = (zone.querySelector('.hit') ?? zone).getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  return {
    left: zoneRect.left - containerRect.left,
    top: zoneRect.top - containerRect.top,
    width: zoneRect.width,
    height: zoneRect.height,
    followsPointer: false,
  }
}

export default function EnvironmentSelector({
  className,
  disabledTools = NO_DISABLED_TOOLS,
  onSelect,
}: EnvironmentSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const rootRef = useRef<HTMLDivElement>(null)
  const hoverTimerRef = useRef<number | undefined>(undefined)
  const warmResetTimerRef = useRef<number | undefined>(undefined)
  const tooltipOpenRef = useRef(false)
  const tooltipWarmRef = useRef(false)
  const [markup, setMarkup] = useState('')
  const [loadError, setLoadError] = useState<string>()
  const [tooltip, setTooltip] = useState<TooltipAnchor>()

  const dismissTooltip = useCallback((preserveSkipDelay = false) => {
    if (hoverTimerRef.current !== undefined) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = undefined
    }

    const wasOpen = tooltipOpenRef.current
    tooltipOpenRef.current = false
    setTooltip(undefined)

    if (warmResetTimerRef.current !== undefined) {
      clearTimeout(warmResetTimerRef.current)
      warmResetTimerRef.current = undefined
    }

    if (preserveSkipDelay && wasOpen) {
      tooltipWarmRef.current = true
      warmResetTimerRef.current = window.setTimeout(() => {
        tooltipWarmRef.current = false
        warmResetTimerRef.current = undefined
      }, TOOLTIP_SKIP_DELAY_MS)
    } else {
      tooltipWarmRef.current = false
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoadError(undefined)
    setMarkup('')

    void fetch(bundledSelectorUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Environment selector unavailable (${response.status})`)
        return response.text()
      })
      .then(setMarkup)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setLoadError(error instanceof Error ? error.message : 'Environment selector unavailable')
      })

    return () => controller.abort()
  }, [])

  useEffect(() => {
    const svg = rootRef.current?.querySelector('svg')
    const container = containerRef.current
    if (!svg || !container) return

    svg.style.display = 'block'
    svg.style.height = 'auto'
    svg.style.maxHeight = '100%'
    svg.style.objectFit = 'contain'
    svg.style.width = '100%'
    svg.setAttribute('role', 'group')
    svg.removeAttribute('aria-labelledby')
    svg.setAttribute('aria-label', 'Pascal Environment tools')
    svg.setAttribute('aria-describedby', 'map-description')

    svg.querySelector('#map-title')?.remove()
    const mapDescription = svg.querySelector('#map-description')
    if (mapDescription) {
      mapDescription.textContent =
        'An interactive site map for Ground Cover, Atmosphere, Surroundings, Build, Terrain, Surface, and Water.'
    }

    let pointerPosition: PointerPosition | undefined
    const openTooltip = (zone: SVGGElement, immediate: boolean, pointer?: PointerPosition) => {
      const tool = zone.dataset.tool
      if (!isEnvironmentTool(tool)) return
      pointerPosition = pointer

      if (hoverTimerRef.current !== undefined) {
        clearTimeout(hoverTimerRef.current)
        hoverTimerRef.current = undefined
      }
      if (warmResetTimerRef.current !== undefined) {
        clearTimeout(warmResetTimerRef.current)
        warmResetTimerRef.current = undefined
      }

      const open = () => {
        tooltipOpenRef.current = true
        tooltipWarmRef.current = true
        setTooltip({
          tool,
          ...measureTooltipAnchor(zone, container, pointerPosition),
        })
        hoverTimerRef.current = undefined
      }

      if (immediate || tooltipWarmRef.current) open()
      else hoverTimerRef.current = window.setTimeout(open, TOOLTIP_DELAY_MS)
    }

    const activate = (target: EventTarget | null) => {
      const zone = getToolZone(target)
      const tool = zone?.dataset.tool
      if (isEnvironmentTool(tool) && zone?.getAttribute('aria-disabled') !== 'true') {
        dismissTooltip()
        onSelectRef.current(tool)
      }
    }
    const handleClick = (event: MouseEvent) => activate(event.target)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        (tooltipOpenRef.current || hoverTimerRef.current !== undefined)
      ) {
        event.preventDefault()
        event.stopPropagation()
        dismissTooltip()
        return
      }
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      activate(event.target)
    }
    const handlePointerOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        dismissTooltip()
        return
      }
      const zone = getToolZone(event.target)
      if (!zone || (event.relatedTarget instanceof Node && zone.contains(event.relatedTarget))) {
        return
      }
      openTooltip(zone, false, { x: event.clientX, y: event.clientY })
    }
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const zone = getToolZone(event.target)
      if (!zone) return
      pointerPosition = { x: event.clientX, y: event.clientY }
      if (!tooltipOpenRef.current) return
      setTooltip((current) => {
        if (!current || current.tool !== zone.dataset.tool) return current
        if (
          current.followsPointer &&
          current.left === event.clientX &&
          current.top === event.clientY
        ) {
          return current
        }
        return {
          ...current,
          left: event.clientX,
          top: event.clientY,
          width: 0,
          height: 0,
          followsPointer: true,
        }
      })
    }
    const handlePointerOut = (event: PointerEvent) => {
      const zone = getToolZone(event.target)
      if (!zone || (event.relatedTarget instanceof Node && zone.contains(event.relatedTarget))) {
        return
      }
      dismissTooltip(true)
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') dismissTooltip()
    }
    const handleFocusIn = (event: FocusEvent) => {
      const zone = getToolZone(event.target)
      if (zone) openTooltip(zone, true)
    }
    const handleFocusOut = (event: FocusEvent) => {
      const zone = getToolZone(event.target)
      if (!zone || (event.relatedTarget instanceof Node && zone.contains(event.relatedTarget))) {
        return
      }
      dismissTooltip()
    }

    svg.addEventListener('click', handleClick)
    svg.addEventListener('keydown', handleKeyDown)
    svg.addEventListener('pointerover', handlePointerOver)
    svg.addEventListener('pointermove', handlePointerMove)
    svg.addEventListener('pointerout', handlePointerOut)
    svg.addEventListener('pointerdown', handlePointerDown)
    svg.addEventListener('focusin', handleFocusIn)
    svg.addEventListener('focusout', handleFocusOut)
    return () => {
      svg.removeEventListener('click', handleClick)
      svg.removeEventListener('keydown', handleKeyDown)
      svg.removeEventListener('pointerover', handlePointerOver)
      svg.removeEventListener('pointermove', handlePointerMove)
      svg.removeEventListener('pointerout', handlePointerOut)
      svg.removeEventListener('pointerdown', handlePointerDown)
      svg.removeEventListener('focusin', handleFocusIn)
      svg.removeEventListener('focusout', handleFocusOut)
      dismissTooltip()
    }
  }, [dismissTooltip, markup])
  const tooltipTool = tooltip?.tool
  const tooltipFollowsPointer = tooltip?.followsPointer

  useEffect(() => {
    const container = containerRef.current
    const svg = rootRef.current?.querySelector('svg')
    if (!container || !svg || !tooltipTool || tooltipFollowsPointer) return

    const zone = svg.querySelector<SVGGElement>(`[data-tool="${tooltipTool}"]`)
    if (!zone) return

    const updateAnchor = () => {
      const measured = measureTooltipAnchor(zone, container)
      setTooltip((current) => {
        if (
          !current ||
          (current.left === measured.left &&
            current.top === measured.top &&
            current.width === measured.width &&
            current.height === measured.height)
        ) {
          return current
        }
        return { ...current, ...measured }
      })
    }

    const observer = new ResizeObserver(updateAnchor)
    observer.observe(container)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [tooltipTool, tooltipFollowsPointer])

  useEffect(() => {
    rootRef.current?.querySelectorAll<SVGGElement>('[data-tool]').forEach((zone) => {
      const tool = zone.dataset.tool
      const disabled = !isEnvironmentTool(tool) || disabledTools.includes(tool)
      zone.setAttribute('aria-disabled', String(disabled))
      zone.removeAttribute('aria-pressed')
      zone.setAttribute('tabindex', disabled ? '-1' : '0')
      zone.style.opacity = '1'
      zone.querySelector<SVGElement>('.hit')?.style.setProperty('pointer-events', 'fill')
      zone.querySelectorAll<SVGElement>('.sprite-color, .sprite-outline').forEach((sprite) => {
        sprite.style.filter = disabled ? 'grayscale(1)' : ''
      })

      if (isEnvironmentTool(tool)) {
        const label = ENVIRONMENT_TOOL_LABELS[tool]
        const description = zone.querySelector('desc')
        zone.querySelector('title')?.remove()
        zone.setAttribute('aria-label', disabled ? `${label} — Coming soon` : label)
        if (description) {
          description.id = `environment-${tool}-description`
          description.textContent = disabled
            ? `Coming soon. ${ENVIRONMENT_TOOL_DESCRIPTIONS[tool]}`
            : ENVIRONMENT_TOOL_DESCRIPTIONS[tool]
          zone.setAttribute('aria-describedby', description.id)
        }
      }
    })
  }, [disabledTools, markup])

  return (
    <div
      aria-busy={!markup && !loadError}
      className={['relative', className].filter(Boolean).join(' ')}
      ref={containerRef}
    >
      {loadError ? (
        <div className="flex flex-col gap-3 p-3">
          <p className="text-sidebar-foreground/60 text-xs" role="alert">
            {loadError}
          </p>
          <EnvironmentCatalogue disabledTools={disabledTools} onSelect={onSelect} />
        </div>
      ) : markup ? (
        <div
          className="flex min-h-0 flex-1 items-center"
          dangerouslySetInnerHTML={{ __html: markup }}
          ref={rootRef}
        />
      ) : (
        <p
          className="grid min-h-40 place-items-center text-sidebar-foreground/50 text-xs"
          role="status"
        >
          Loading environment tools…
        </p>
      )}

      {tooltip ? (
        <TooltipPrimitive.Provider
          delayDuration={TOOLTIP_DELAY_MS}
          disableHoverableContent
          skipDelayDuration={TOOLTIP_SKIP_DELAY_MS}
        >
          <TooltipPrimitive.Root
            onOpenChange={(open) => {
              if (!open) dismissTooltip()
            }}
            open
          >
            <TooltipPrimitive.Trigger asChild>
              <span
                aria-hidden="true"
                className="pointer-events-none opacity-0"
                style={{
                  position: tooltip.followsPointer ? 'fixed' : 'absolute',
                  height: tooltip.height,
                  left: tooltip.left,
                  top: tooltip.top,
                  width: tooltip.width,
                }}
              />
            </TooltipPrimitive.Trigger>
            <TooltipPrimitive.Portal>
              <TooltipPrimitive.Content
                className="pointer-events-none z-50 w-fit max-w-64 rounded-md bg-foreground px-3 py-1.5 font-barlow text-background text-xs shadow-md"
                collisionPadding={12}
                align={tooltip.followsPointer ? 'start' : 'center'}
                alignOffset={tooltip.followsPointer ? 12 : 0}
                side="top"
                sideOffset={12}
                updatePositionStrategy={tooltip.followsPointer ? 'always' : 'optimized'}
              >
                {ENVIRONMENT_TOOL_LABELS[tooltip.tool]}
                {disabledTools.includes(tooltip.tool) && ' — Coming soon'}
                {!tooltip.followsPointer && (
                  <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground" />
                )}
              </TooltipPrimitive.Content>
            </TooltipPrimitive.Portal>
          </TooltipPrimitive.Root>
        </TooltipPrimitive.Provider>
      ) : null}
    </div>
  )
}

export function EnvironmentCatalogue({
  className,
  disabledTools = NO_DISABLED_TOOLS,
  onSelect,
}: EnvironmentSelectorProps) {
  return (
    <div className={className}>
      <ul aria-label="Environment tools" className="flex flex-col gap-2">
        {ENVIRONMENT_TOOLS.map((tool) => {
          const disabled = disabledTools.includes(tool)
          const Icon = ENVIRONMENT_TOOL_ICONS[tool]
          return (
            <li key={tool}>
              <button
                className="group flex w-full items-center gap-3 rounded-xl bg-muted/40 px-3 py-2.5 text-left text-xs transition-colors enabled:hover:bg-muted/70 enabled:active:bg-sidebar-accent disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none"
                disabled={disabled}
                onClick={() => onSelect(tool)}
                type="button"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background/70 text-foreground shadow-sm ring-1 ring-border/50">
                  <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-medium text-foreground">
                    {ENVIRONMENT_TOOL_LABELS[tool]}
                  </span>
                  <span className="leading-relaxed text-muted-foreground">
                    {ENVIRONMENT_TOOL_DESCRIPTIONS[tool]}
                  </span>
                </span>
                {disabled ? (
                  <span className="shrink-0 text-muted-foreground">Coming soon</span>
                ) : (
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.75}
                  />
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
