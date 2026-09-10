'use client'

import { emitter } from '@pascal-app/core'
import type { SceneGraph, SidebarTab } from '@pascal-app/editor'
import { Editor, useEditor } from '@pascal-app/editor'
import { environmentPlugin, exportEnvironmentConfiguration } from '@pascal-app/plugin-environment'
import type { EnvironmentLabFixture } from '@pascal-app/plugin-environment/lab'
import {
  createEnvironmentLabFixture,
  initializeEnvironmentLabFixture,
} from '@pascal-app/plugin-environment/lab'
import type {
  EnvironmentLabCamera,
  EnvironmentLabCase,
  EnvironmentLabFeature,
} from '@pascal-app/plugin-environment/lab/catalog'
import {
  ENVIRONMENT_LAB_CASES,
  ENVIRONMENT_LAB_FEATURES,
} from '@pascal-app/plugin-environment/lab/catalog'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  ExternalLink,
  Hammer,
  Layers,
  MapPin,
  RefreshCcw,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { BuildTab } from '@/components/build-tab'
import {
  CommunityViewerToolbarLeft,
  CommunityViewerToolbarRight,
} from '@/components/viewer-toolbar'
import { waitForEnvironmentRegistry } from '@/lib/environment-lab/registry'
import type {
  EnvironmentLabRendererProfile,
  EnvironmentLabReviewRecord,
} from '@/lib/environment-lab/review'
import {
  downloadEnvironmentLabReview,
  readLiveEnvironmentLabScene,
} from '@/lib/environment-lab/review'
import { EnvironmentLabRendererProfileSlot } from './renderer-profile-slot'

type RendererProfileReader = () => EnvironmentLabRendererProfile

type EnvironmentLabEditorProps = {
  activeVariantId: string
  labCase: EnvironmentLabCase
}

type LoadedFixture = {
  camera: EnvironmentLabCamera
  rootNodeIds: SceneGraph['rootNodeIds']
}

type ReviewContextValue = {
  activeVariantId: string
  applyCamera: (camera: EnvironmentLabCamera) => void
  downloadReview: (checks: Record<string, boolean>, notes: string) => void
  labCase: EnvironmentLabCase
  rendererProfile: EnvironmentLabRendererProfile | null
  resetCase: () => void
  sceneMounted: boolean
  scratchSavedAt: string | null
  setupError: string | null
}

const ReviewContext = createContext<ReviewContextValue | null>(null)

function useReviewContext(): ReviewContextValue {
  const value = useContext(ReviewContext)
  if (!value) throw new Error('Environment lab review panel must be mounted inside its host')
  return value
}

function ScenePanelPlaceholder() {
  return null
}

function EnvironmentLabReviewPanel() {
  const {
    activeVariantId,
    applyCamera,
    downloadReview,
    labCase,
    rendererProfile,
    resetCase,
    sceneMounted,
    scratchSavedAt,
    setupError,
  } = useReviewContext()
  const modelExport = useEditor((state) => state.modelExport)
  const [checks, setChecks] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(labCase.reviewSteps.map((step) => [step.id, false])),
  )
  const [notes, setNotes] = useState('')
  const [actionStatus, setActionStatus] = useState<string | null>(null)
  const featureById = useMemo<Record<string, EnvironmentLabFeature>>(
    () => Object.fromEntries(ENVIRONMENT_LAB_FEATURES.map((feature) => [feature.id, feature])),
    [],
  )

  const handleModelExport = useCallback(async () => {
    if (!modelExport) return
    setActionStatus('Preparing the production GLB export…')
    try {
      const artifact = await modelExport('glb', { download: true })
      setActionStatus(artifact ? 'Model export downloaded.' : 'Model export was unavailable.')
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Model export failed.')
    }
  }, [modelExport])
  const handleReviewDownload = useCallback(() => {
    try {
      downloadReview(checks, notes)
      setActionStatus('Review JSON downloaded.')
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Review export failed.')
    }
  }, [checks, downloadReview, notes])

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="border-sidebar-border/70 border-b px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.14em]">
              {labCase.kind} · v{labCase.version}
            </p>
            <h2 className="mt-1 text-pretty font-semibold text-sm leading-5">{labCase.title}</h2>
          </div>
          <span className="shrink-0 rounded-sm bg-accent px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {activeVariantId}
          </span>
        </div>
        <p className="mt-2 text-pretty text-muted-foreground text-xs leading-5">
          {labCase.summary}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <section aria-labelledby="lab-runtime-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-semibold text-xs" id="lab-runtime-heading">
              Runtime observation
            </h3>
            <span
              className="font-mono text-[10px] text-muted-foreground tabular-nums"
              title="This reports mounted scene state, not independent verification"
            >
              {setupError
                ? 'load error'
                : sceneMounted
                  ? rendererProfile?.status === 'ready'
                    ? rendererProfile.backend
                    : (rendererProfile?.status ?? 'renderer loading')
                  : 'scene loading'}
            </span>
          </div>
          {setupError ? (
            <p aria-live="assertive" className="mt-2 text-destructive text-xs leading-5">
              {setupError}
            </p>
          ) : (
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px]">
              <dt className="text-muted-foreground">Scene</dt>
              <dd>
                {sceneMounted
                  ? 'Graph mounted and initial camera requested'
                  : 'Loading fixture graph'}
              </dd>
              <dt className="text-muted-foreground">Renderer</dt>
              <dd className="truncate font-mono">
                {rendererProfile
                  ? `${rendererProfile.backendClass} / ${rendererProfile.rendererClass}`
                  : 'Waiting for viewerSceneSlot'}
              </dd>
              <dt className="text-muted-foreground">Viewport</dt>
              <dd className="font-mono tabular-nums">
                {rendererProfile
                  ? `${rendererProfile.viewport.cssWidth}×${rendererProfile.viewport.cssHeight} @ ${rendererProfile.viewport.dpr.toFixed(2)}×`
                  : 'unknown'}
              </dd>
              <dt className="text-muted-foreground">Scratch</dt>
              <dd>
                {scratchSavedAt ? `Saved in memory at ${scratchSavedAt}` : 'Canonical fixture'}
              </dd>
            </dl>
          )}
          <p className="mt-2 text-pretty text-[11px] text-muted-foreground leading-4">
            Fixed fixture state does not freeze every live animation. Weather, koi, birds and beacon
            have owned pause behavior; sky playback and shader clocks are not one universal
            timeline.
          </p>
        </section>

        <section aria-labelledby="lab-coverage-heading" className="mt-5">
          <h3 className="font-semibold text-xs" id="lab-coverage-heading">
            Feature coverage
          </h3>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {labCase.featureIds.map((id) => (
              <li className="rounded-sm border border-border/70 px-1.5 py-1 text-[10px]" key={id}>
                {featureById[id]?.title ?? id}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="lab-steps-heading" className="mt-5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-semibold text-xs" id="lab-steps-heading">
              Review steps
            </h3>
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
              {Object.values(checks).filter(Boolean).length}/{labCase.reviewSteps.length}
            </span>
          </div>
          <ol className="mt-2 divide-y divide-border/60 border-border/60 border-y">
            {labCase.reviewSteps.map((step, index) => {
              const checked = checks[step.id] === true
              const inputId = `environment-lab-check-${step.id}`
              return (
                <li className="py-3" key={step.id}>
                  <label
                    className="grid cursor-pointer grid-cols-[1.25rem_minmax(0,1fr)] gap-2"
                    htmlFor={inputId}
                  >
                    <input
                      checked={checked}
                      className="peer sr-only"
                      id={inputId}
                      onChange={(event) =>
                        setChecks((current) => ({
                          ...current,
                          [step.id]: event.target.checked,
                        }))
                      }
                      type="checkbox"
                    />
                    <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-sm border border-input bg-muted peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                      {checked ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : null}
                    </span>
                    <span>
                      <span className="block font-medium text-xs leading-5">
                        <span className="mr-1 font-mono text-[10px] text-muted-foreground tabular-nums">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        {step.action}
                      </span>
                      <span className="mt-0.5 block text-pretty text-[11px] text-muted-foreground leading-4">
                        {step.expectation}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ol>
        </section>

        {labCase.stations.length > 0 ? (
          <section aria-labelledby="lab-stations-heading" className="mt-5">
            <h3 className="font-semibold text-xs" id="lab-stations-heading">
              Camera stations
            </h3>
            <ul className="mt-2 space-y-1">
              {labCase.stations.map((station) => (
                <li key={station.id}>
                  <button
                    className="group flex min-h-10 w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => applyCamera(station.camera)}
                    title={station.description}
                    type="button"
                  >
                    <MapPin
                      aria-hidden="true"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground"
                    />
                    <span>
                      <span className="block font-medium text-xs">{station.title}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground leading-4">
                        {station.description}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="lab-variants-heading" className="mt-5">
          <h3 className="font-semibold text-xs" id="lab-variants-heading">
            Comparison variants
          </h3>
          <ul className="mt-2 space-y-1">
            {labCase.variants.map((variant) => {
              const active = variant.id === activeVariantId
              return (
                <li key={variant.id}>
                  <a
                    aria-current={active ? 'page' : undefined}
                    className={`block min-h-10 rounded-md px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      active ? 'bg-accent text-foreground' : 'hover:bg-accent/50'
                    }`}
                    href={`/environment-lab/${encodeURIComponent(labCase.id)}?variant=${encodeURIComponent(variant.id)}`}
                  >
                    <span className="block font-medium text-xs">{variant.label}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground leading-4">
                      {variant.description}
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground leading-4">
            Opening a variant loads a fresh document and intentionally discards this scratch
            session.
          </p>
        </section>

        <section aria-labelledby="lab-notes-heading" className="mt-5">
          <label className="block" htmlFor="environment-lab-notes">
            <span className="font-semibold text-xs" id="lab-notes-heading">
              Review notes
            </span>
            <textarea
              className="mt-2 min-h-28 w-full resize-y rounded-md border border-input bg-muted/50 p-2.5 text-xs leading-5 outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring"
              id="environment-lab-notes"
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Record visual differences, interactions, and limitations…"
              value={notes}
            />
          </label>
        </section>

        <section aria-labelledby="lab-sources-heading" className="mt-5">
          <h3 className="font-semibold text-xs" id="lab-sources-heading">
            Source documentation
          </h3>
          <ul className="mt-2 space-y-1">
            {labCase.sources.map((source) => (
              <li key={source.url}>
                <a
                  className="flex min-h-10 items-center justify-between gap-3 rounded-md px-2 py-2 text-xs hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  href={source.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span>{source.label}</span>
                  <ExternalLink
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  />
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="border-sidebar-border/70 border-t px-4 py-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            className="flex min-h-10 items-center justify-center gap-2 rounded-md bg-primary px-3 font-medium text-primary-foreground text-xs hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!sceneMounted || Boolean(setupError)}
            onClick={handleReviewDownload}
            type="button"
          >
            <Download aria-hidden="true" className="h-3.5 w-3.5" />
            Review JSON
          </button>
          <button
            className="flex min-h-10 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 font-medium text-xs hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={resetCase}
            type="button"
          >
            <RefreshCcw aria-hidden="true" className="h-3.5 w-3.5" />
            Reset case
          </button>
        </div>
        {modelExport ? (
          <button
            className="mt-2 flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-3 font-medium text-xs hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!sceneMounted}
            onClick={handleModelExport}
            type="button"
          >
            <Download aria-hidden="true" className="h-3.5 w-3.5" />
            Export current model (GLB)
          </button>
        ) : (
          <p className="mt-2 text-center text-[10px] text-muted-foreground">
            Model export is loading with the production scene.
          </p>
        )}
        <p className="mt-2 text-pretty text-center text-[10px] text-muted-foreground leading-4">
          GLB uses the production model exporter. Review JSON retains the editable scene,
          Environment configuration and observed runtime profile.
        </p>
        <p
          aria-live="polite"
          className="mt-2 min-h-4 text-center text-[10px] text-muted-foreground"
        >
          {actionStatus ?? 'Reset discards all current scratch edits, checks, and notes.'}
        </p>
      </div>
    </div>
  )
}

const SIDEBAR_TABS: (SidebarTab & { component: ComponentType })[] = [
  {
    id: 'site',
    label: 'Scene',
    component: ScenePanelPlaceholder,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Layers className="h-5 w-5" />,
    icon: <Layers className="h-5 w-5" />,
  },
  {
    id: 'build',
    label: 'Build',
    component: BuildTab,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Hammer className="h-5 w-5" />,
    icon: <Hammer className="h-5 w-5" />,
  },
]

export function EnvironmentLabEditor({ activeVariantId, labCase }: EnvironmentLabEditorProps) {
  const scratchSceneRef = useRef<SceneGraph | null>(null)
  const rendererProfileReaderRef = useRef<RendererProfileReader | null>(null)
  const [loadedFixture, setLoadedFixture] = useState<LoadedFixture | null>(null)
  const [rendererProfile, setRendererProfile] = useState<EnvironmentLabRendererProfile | null>(null)
  const [sceneMounted, setSceneMounted] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [scratchSavedAt, setScratchSavedAt] = useState<string | null>(null)

  const projectId = `environment-lab:${labCase.id}:v${labCase.version}:${activeVariantId}`
  const currentIndex = ENVIRONMENT_LAB_CASES.findIndex((candidate) => candidate.id === labCase.id)
  const previousCase = currentIndex > 0 ? ENVIRONMENT_LAB_CASES[currentIndex - 1] : null
  const nextCase =
    currentIndex >= 0 && currentIndex < ENVIRONMENT_LAB_CASES.length - 1
      ? ENVIRONMENT_LAB_CASES[currentIndex + 1]
      : null

  const handleLoad = useCallback(async (): Promise<SceneGraph> => {
    setSetupError(null)
    setSceneMounted(false)
    setRendererProfile(null)
    setScratchSavedAt(null)
    try {
      await waitForEnvironmentRegistry()
      const fixture: EnvironmentLabFixture = createEnvironmentLabFixture(
        labCase.id,
        activeVariantId,
      )
      initializeEnvironmentLabFixture(labCase.id, fixture)
      const canonicalScene = structuredClone(fixture.scene)
      scratchSceneRef.current = canonicalScene
      setLoadedFixture({
        camera: fixture.camera,
        rootNodeIds: fixture.scene.rootNodeIds,
      })
      return structuredClone(canonicalScene)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Environment lab fixture failed to load'
      setSetupError(message)
      throw error
    }
  }, [activeVariantId, labCase.id])

  const handleSave = useCallback(async (scene: SceneGraph): Promise<void> => {
    scratchSceneRef.current = structuredClone(scene)
    setScratchSavedAt(
      new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date()),
    )
  }, [])

  const applyCamera = useCallback((camera: EnvironmentLabCamera) => {
    emitter.emit('camera-controls:apply-pose', {
      position: [...camera.position],
      target: [...camera.target],
      projection: 'perspective',
    })
  }, [])

  const resetCase = useCallback(() => {
    window.location.assign(`/environment-lab/${encodeURIComponent(labCase.id)}`)
  }, [labCase.id])

  const handleProfileReaderChange = useCallback((reader: RendererProfileReader | null) => {
    rendererProfileReaderRef.current = reader
  }, [])

  const handleSceneMounted = useCallback(() => {
    setSceneMounted(true)
  }, [])

  const downloadReview = useCallback(
    (checks: Record<string, boolean>, notes: string) => {
      const profile = rendererProfileReaderRef.current?.() ?? null
      const record: EnvironmentLabReviewRecord = {
        schema: 'pascal-environment-lab-review',
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        case: {
          id: labCase.id,
          version: labCase.version,
          variantId: activeVariantId,
          kind: labCase.kind,
          featureIds: labCase.featureIds,
        },
        review: { checks, notes },
        scene: readLiveEnvironmentLabScene(),
        environment: exportEnvironmentConfiguration(),
        renderer: profile ?? { status: 'loading' },
        reproductionCopy: {
          executionClass: 'live-observation',
          fixtureInputs: 'fixed by the case and variant descriptor',
          animation:
            'Live animation is intentionally nonuniform. This record does not claim a globally frozen shader clock or deterministic simulation.',
          acceptance:
            'NOT-RUN — this local review record is an observation, not a normative baseline',
        },
      }
      downloadEnvironmentLabReview(
        record,
        `environment-lab_${labCase.id}_${activeVariantId}_v${labCase.version}.json`,
      )
    },
    [activeVariantId, labCase],
  )

  const reviewContext = useMemo<ReviewContextValue>(
    () => ({
      activeVariantId,
      applyCamera,
      downloadReview,
      labCase,
      rendererProfile,
      resetCase,
      sceneMounted,
      scratchSavedAt,
      setupError,
    }),
    [
      activeVariantId,
      applyCamera,
      downloadReview,
      labCase,
      rendererProfile,
      resetCase,
      sceneMounted,
      scratchSavedAt,
      setupError,
    ],
  )

  return (
    <ReviewContext.Provider value={reviewContext}>
      <div className="dark relative flex h-dvh w-screen flex-col overflow-hidden bg-background text-foreground md:flex-row">
        <div className="relative min-h-0 min-w-0 flex-1">
          <Editor
            layoutVersion="v2"
            navbarSlot={
              <nav
                aria-label="Environment lab case navigation"
                className="flex h-11 shrink-0 items-center justify-between gap-3 border-border/70 border-b bg-sidebar px-3 text-sidebar-foreground"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <a
                    aria-label="Back to Environment lab catalog"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href="/environment-lab"
                  >
                    <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                  </a>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-xs">{labCase.title}</p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      scratch · {activeVariantId} · {environmentPlugin.id}
                    </p>
                  </div>
                </div>
                <p className="hidden text-muted-foreground text-[11px] md:block">
                  Disposable scene — case navigation discards changes
                </p>
                <div className="flex shrink-0 items-center gap-1">
                  {previousCase ? (
                    <a
                      aria-label={`Previous case: ${previousCase.title}`}
                      className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      href={`/environment-lab/${encodeURIComponent(previousCase.id)}`}
                    >
                      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                    </a>
                  ) : null}
                  {nextCase ? (
                    <a
                      aria-label={`Next case: ${nextCase.title}`}
                      className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      href={`/environment-lab/${encodeURIComponent(nextCase.id)}`}
                    >
                      <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>
              </nav>
            }
            onLoad={handleLoad}
            onSave={handleSave}
            projectId={projectId}
            sidebarTabs={SIDEBAR_TABS}
            viewerSceneSlot={
              loadedFixture ? (
                <EnvironmentLabRendererProfileSlot
                  camera={loadedFixture.camera}
                  expectedRootNodeIds={loadedFixture.rootNodeIds}
                  onProfileChange={setRendererProfile}
                  onProfileReaderChange={handleProfileReaderChange}
                  onSceneMounted={handleSceneMounted}
                />
              ) : null
            }
            viewerToolbarLeft={<CommunityViewerToolbarLeft />}
            viewerToolbarRight={<CommunityViewerToolbarRight />}
          />
        </div>
        <aside
          aria-label="Environment lab review"
          className="h-[45dvh] w-full shrink-0 border-sidebar-border border-t md:h-full md:w-88 md:border-t-0 md:border-l"
        >
          <EnvironmentLabReviewPanel />
        </aside>
      </div>
    </ReviewContext.Provider>
  )
}
