'use client'

import type {
  EnvironmentLabCase,
  EnvironmentLabFeature,
} from '@pascal-app/plugin-environment/lab/catalog'
import { ArrowUpRight, Search } from 'lucide-react'
import { useDeferredValue, useMemo, useState, useSyncExternalStore } from 'react'

const ALL_KINDS = ['all', 'gym', 'zoo', 'museum'] as const
const subscribeToClientMount = () => () => {}

type EnvironmentLabIndexProps = {
  cases: readonly EnvironmentLabCase[]
  features: readonly EnvironmentLabFeature[]
}

export function EnvironmentLabIndex({ cases, features }: EnvironmentLabIndexProps) {
  const controlsReady = useSyncExternalStore(
    subscribeToClientMount,
    () => true,
    () => false,
  )
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<(typeof ALL_KINDS)[number]>('all')
  const [featureId, setFeatureId] = useState('all')
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase())
  const featureById = useMemo(
    () => new Map(features.map((feature) => [feature.id, feature])),
    [features],
  )

  const visibleCases = useMemo(() => {
    return cases.filter((labCase) => {
      if (kind !== 'all' && labCase.kind !== kind) return false
      if (featureId !== 'all' && !labCase.featureIds.includes(featureId)) return false
      if (!deferredQuery) return true

      const featureText = labCase.featureIds
        .map((id) => {
          const feature = featureById.get(id)
          return feature ? `${feature.title} ${feature.description}` : id
        })
        .join(' ')
      return `${labCase.id} ${labCase.title} ${labCase.summary} ${featureText}`
        .toLocaleLowerCase()
        .includes(deferredQuery)
    })
  }, [cases, deferredQuery, featureById, featureId, kind])

  const coverage = useMemo(
    () =>
      features.map((feature) => ({
        ...feature,
        cases: cases.filter((labCase) => labCase.featureIds.includes(feature.id)).length,
      })),
    [cases, features],
  )

  return (
    <main className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto grid min-h-screen max-w-[88rem] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0 px-4 py-8 sm:px-8 lg:px-12 lg:py-12">
          <header className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground uppercase tracking-[0.16em]">
              <a
                className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href="/"
              >
                Environment
              </a>
              <span aria-hidden="true">/</span>
              <span>Environment lab</span>
            </div>
            <h1 className="mt-4 text-balance font-semibold text-2xl tracking-tight sm:text-3xl">
              Landscape behavior, indexed and executable
            </h1>
            <p className="mt-3 max-w-2xl text-pretty text-muted-foreground text-sm leading-6">
              Open focused gyms, true-scale zoos, and renderer museums in the Environment testbed.
              Every case uses the real Pascal editor and production Environment controls in a
              disposable scene, separate from the main editor application.
            </p>
          </header>

          <div className="mt-8 grid gap-3 border-border/70 border-y py-4 sm:grid-cols-[minmax(14rem,1fr)_10rem_minmax(12rem,16rem)]">
            <label className="grid gap-1.5" htmlFor="environment-lab-search">
              <span className="font-medium text-muted-foreground text-xs">Search cases</span>
              <span className="relative">
                <Search
                  aria-hidden="true"
                  className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  className="h-10 w-full rounded-md border border-input bg-muted/50 pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={!controlsReady}
                  id="environment-lab-search"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Terrain, water, weather…"
                  type="search"
                  value={query}
                />
              </span>
            </label>
            <label className="grid gap-1.5" htmlFor="environment-lab-kind">
              <span className="font-medium text-muted-foreground text-xs">Exhibit mode</span>
              <select
                className="h-10 rounded-md border border-input bg-muted/50 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={!controlsReady}
                id="environment-lab-kind"
                onChange={(event) => setKind(event.target.value as (typeof ALL_KINDS)[number])}
                value={kind}
              >
                {ALL_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {value === 'all' ? 'All modes' : value[0]?.toUpperCase() + value.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5" htmlFor="environment-lab-feature">
              <span className="font-medium text-muted-foreground text-xs">Feature family</span>
              <select
                className="h-10 min-w-0 rounded-md border border-input bg-muted/50 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                id="environment-lab-feature"
                disabled={!controlsReady}
                onChange={(event) => setFeatureId(event.target.value)}
                value={featureId}
              >
                <option value="all">All features</option>
                {features.map((feature) => (
                  <option key={feature.id} value={feature.id}>
                    {feature.title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-5 flex items-baseline justify-between gap-4">
            <h2 className="font-semibold text-sm">Cases</h2>
            <p aria-live="polite" className="font-mono text-muted-foreground text-xs tabular-nums">
              {visibleCases.length} / {cases.length}
            </p>
          </div>

          {visibleCases.length > 0 ? (
            <ol className="mt-2 divide-y divide-border/60 border-border/60 border-y">
              {visibleCases.map((labCase, index) => (
                <li key={labCase.id}>
                  <a
                    className="group grid min-h-24 grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-3 px-1 py-4 outline-none hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:px-3"
                    href={`/environment-lab/${encodeURIComponent(labCase.id)}`}
                  >
                    <span className="pt-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm">{labCase.title}</span>
                        <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground uppercase tracking-wide">
                          {labCase.kind}
                        </span>
                      </span>
                      <span className="mt-1 block max-w-3xl text-pretty text-muted-foreground text-xs leading-5">
                        {labCase.summary}
                      </span>
                      <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                        {labCase.featureIds.map((id) => (
                          <span className="font-mono text-[10px] text-muted-foreground" key={id}>
                            {featureById.get(id)?.title ?? id}
                          </span>
                        ))}
                      </span>
                    </span>
                    <ArrowUpRight
                      aria-hidden="true"
                      className="mt-1 h-4 w-4 text-muted-foreground group-hover:text-foreground"
                    />
                  </a>
                </li>
              ))}
            </ol>
          ) : (
            <div className="mt-2 border-border/60 border-y px-4 py-12 text-center">
              <h2 className="font-medium text-sm">No matching cases</h2>
              <p className="mt-1 text-muted-foreground text-xs">
                Clear a filter or try a broader feature name.
              </p>
              <button
                className="mt-4 h-10 rounded-md border border-border bg-accent px-3 font-medium text-xs hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  setQuery('')
                  setKind('all')
                  setFeatureId('all')
                }}
                type="button"
              >
                Clear filters
              </button>
            </div>
          )}
        </section>

        <aside className="border-border/70 border-t bg-muted/20 px-4 py-6 sm:px-8 lg:border-t-0 lg:border-l lg:px-5 lg:py-12">
          <div className="lg:sticky lg:top-8">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-semibold text-sm">Coverage inventory</h2>
              <span className="font-mono text-[10px] text-muted-foreground uppercase">R02</span>
            </div>
            <p className="mt-2 text-pretty text-muted-foreground text-xs leading-5">
              Source-backed families mapped to runnable cases. Presence here is documentation
              coverage, not a claim of plugin acceptance.
            </p>
            <ul className="mt-4 divide-y divide-border/50 border-border/50 border-y">
              {coverage.map((feature) => (
                <li className="py-3" key={feature.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-xs">{feature.title}</span>
                    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                      {feature.cases} {feature.cases === 1 ? 'case' : 'cases'}
                    </span>
                  </div>
                  <p className="mt-1 text-pretty text-[11px] text-muted-foreground leading-4">
                    {feature.description}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-pretty text-[11px] text-muted-foreground leading-4">
              Live motion is intentionally nonuniform: some owned systems pause while shader clocks
              and sky playback do not share a universal deterministic clock.
            </p>
          </div>
        </aside>
      </div>
    </main>
  )
}
