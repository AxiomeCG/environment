'use client'

import { useEffect, useRef, useState } from 'react'

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
  surroundings: 'Configure forests and distant scenery.',
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

export default function EnvironmentSelector({
  className,
  disabledTools = [],
  onSelect,
}: EnvironmentSelectorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [markup, setMarkup] = useState('')
  const [loadError, setLoadError] = useState<string>()

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
    if (!svg) return

    svg.style.display = 'block'
    svg.style.height = 'auto'
    svg.style.maxHeight = '100%'
    svg.style.objectFit = 'contain'
    svg.style.width = '100%'

    const mapTitle = svg.querySelector('#map-title')
    const mapDescription = svg.querySelector('#map-description')
    if (mapTitle) mapTitle.textContent = 'Pascal Environment tools'
    if (mapDescription) {
      mapDescription.textContent =
        'An interactive site map for Ground Cover, Atmosphere, Surroundings, Build, Terrain, Surface, and Water.'
    }

    const activate = (target: EventTarget | null) => {
      const zone = target instanceof Element ? target.closest<SVGGElement>('[data-tool]') : null
      const tool = zone?.dataset.tool
      if (isEnvironmentTool(tool) && zone?.getAttribute('aria-disabled') !== 'true') onSelect(tool)
    }
    const handleClick = (event: MouseEvent) => activate(event.target)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      activate(event.target)
    }

    svg.addEventListener('click', handleClick)
    svg.addEventListener('keydown', handleKeyDown)
    return () => {
      svg.removeEventListener('click', handleClick)
      svg.removeEventListener('keydown', handleKeyDown)
    }
  }, [markup, onSelect])

  useEffect(() => {
    rootRef.current?.querySelectorAll<SVGGElement>('[data-tool]').forEach((zone) => {
      const tool = zone.dataset.tool
      const disabled = !isEnvironmentTool(tool) || disabledTools.includes(tool)
      zone.setAttribute('aria-disabled', String(disabled))
      zone.removeAttribute('aria-pressed')
      zone.setAttribute('tabindex', disabled ? '-1' : '0')
      zone.style.opacity = '1'
      zone.querySelector<SVGElement>('.hit')?.style.setProperty('pointer-events', 'fill')
      zone
        .querySelectorAll<SVGElement>('.sprite-color, .sprite-outline')
        .forEach((sprite) => {
          sprite.style.filter = disabled ? 'grayscale(1)' : ''
        })

      if (isEnvironmentTool(tool)) {
        const label = ENVIRONMENT_TOOL_LABELS[tool]
        const title = zone.querySelector('title')
        const description = zone.querySelector('desc')
        zone.setAttribute('aria-label', disabled ? `${label} — Coming soon` : label)
        if (title) title.textContent = disabled ? `${label} — Coming soon` : label
        if (description) {
          description.textContent = disabled
            ? `Coming soon. ${ENVIRONMENT_TOOL_DESCRIPTIONS[tool]}`
            : ENVIRONMENT_TOOL_DESCRIPTIONS[tool]
        }
      }
    })
  }, [disabledTools, markup])

  return (
    <div aria-busy={!markup && !loadError} className={className}>
      {loadError ? (
        <EnvironmentSelectorFallback
          disabledTools={disabledTools}
          error={loadError}
          onSelect={onSelect}
        />
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
    </div>
  )
}

function EnvironmentSelectorFallback({
  disabledTools,
  error,
  onSelect,
}: {
  disabledTools: readonly EnvironmentTool[]
  error: string
  onSelect: (tool: EnvironmentTool) => void
}) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-sidebar-foreground/60 text-xs" role="alert">
        {error}
      </p>
      <div aria-label="Environment tools" className="grid grid-cols-2 gap-2" role="group">
        {ENVIRONMENT_TOOLS.map((tool) => (
          <button
            className="min-h-10 rounded-md border border-sidebar-border px-2 text-xs transition-colors enabled:hover:bg-sidebar-accent disabled:cursor-not-allowed disabled:text-sidebar-foreground/50"
            disabled={disabledTools.includes(tool)}
            key={tool}
            title={disabledTools.includes(tool) ? 'Coming soon' : undefined}
            onClick={() => onSelect(tool)}
            type="button"
          >
            {ENVIRONMENT_TOOL_LABELS[tool]}
          </button>
        ))}
      </div>
    </div>
  )
}
