'use client'

import { type AnyNode, type AnyNodeId, type SiteNode, useScene } from '@pascal-app/core'
import { SegmentedControl, SliderControl, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import EnvironmentSelector, { type EnvironmentTool } from './environment-selector'
import {
  CLEARED_GRASS_PAINT_COLOR,
  createGrassPaintField,
  encodeGrassPaintField,
  siteBounds,
} from './ground-cover/paint-field'
import type { PaintMode } from './ground-cover/paint-stroke'
import { updateGrassPaintTexture } from './ground-cover/paint-texture'
import { getMissingGrassFieldDefaults, GrassFieldNode } from './ground-cover/schema'
import { activatePascalShortcut } from './pascal-tool-actions'
import { useEnvironmentStore } from './store'

const GROUND_COVER_TOOL = 'environment:ground-cover'
const DISABLED_ENVIRONMENT_TOOLS = [
  'atmosphere',
  'surroundings',
  'path',
  'water',
] as const satisfies readonly EnvironmentTool[]
const GROUND_COVER_INSTRUCTIONS: Record<PaintMode, string> = {
  paint: 'Drag on the ground to paint grass. Press Esc to stop.',
  erase: 'Drag on the ground to erase grass. Press Esc to stop.',
  smooth: 'Drag on the ground to smooth grass. Press Esc to stop.',
}

const setPluginTool = (tool: string) => {
  const setTool = useEditor.getState().setTool as (value: string) => void
  setTool(tool)
}

export default function EnvironmentPanel() {
  const activeTool = useEditor((state) => state.tool) as string | null
  const activeSection = useEnvironmentStore((state) => state.activeSection)
  const setActiveSection = useEnvironmentStore((state) => state.setActiveSection)
  const paintMode = useEnvironmentStore((state) => state.groundCoverBrush.mode)
  const layerCount = useScene(
    (state) =>
      Object.values(state.nodes).filter((node) => (node.type as string) === GROUND_COVER_TOOL)
        .length,
  )
  const groundCoverActive = activeTool === GROUND_COVER_TOOL

  const activateGroundCover = () => {
    const field = getOrCreateGroundCover()
    if (!field) return

    useViewer.getState().setSelection({ selectedIds: [field.id as AnyNodeId] })
    setPluginTool(GROUND_COVER_TOOL)
    useEditor.getState().setMode('build')
  }

  const selectEnvironmentTool = (tool: EnvironmentTool) => {
    if (tool === 'ground-cover') {
      setActiveSection(tool)
      activateGroundCover()
      return
    }
    activatePascalShortcut(tool)
  }

  if (activeSection === 'ground-cover') {
    return (
      <div className="flex flex-col gap-4 p-4 text-sidebar-foreground">
        <button
          className="self-start text-sidebar-foreground/60 text-xs transition-colors hover:text-sidebar-foreground"
          onClick={() => setActiveSection(undefined)}
          type="button"
        >
          ← Environment
        </button>
        <header className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-base">Ground Cover</h2>
            <span className="rounded-full bg-sidebar-accent px-2 py-0.5 text-sidebar-foreground/70 text-xs">
              {layerCount} layer{layerCount === 1 ? '' : 's'}
            </span>
          </div>
          <p className="text-sidebar-foreground/50 text-xs">
            {groundCoverActive
              ? GROUND_COVER_INSTRUCTIONS[paintMode]
              : 'Painting is paused. Return to the map to arm Ground Cover again.'}
          </p>
        </header>
        <GroundCoverPaintControls />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-sidebar-foreground">
      <header className="flex flex-col gap-2 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base">Environment</h2>
          <span className="rounded-full bg-sidebar-accent px-2 py-0.5 text-sidebar-foreground/70 text-xs">
            {layerCount} layer{layerCount === 1 ? '' : 's'}
          </span>
        </div>
        <p className="text-sidebar-foreground/50 text-xs">
          Choose an area of the environment to work on.
        </p>
      </header>

      <EnvironmentSelector
        className="flex min-h-0 w-full flex-1 flex-col justify-center"
        disabledTools={DISABLED_ENVIRONMENT_TOOLS}
        onSelect={selectEnvironmentTool}
      />
    </div>
  )
}

function GroundCoverPaintControls() {
  const brush = useEnvironmentStore((state) => state.groundCoverBrush)
  const setBrush = useEnvironmentStore((state) => state.setGroundCoverBrush)

  const replaceField = (density: number, color = brush.color) => {
    const field = getOrCreateGroundCover()
    if (!field?.parentId) return

    const scene = useScene.getState()
    const parent = scene.nodes[field.parentId as AnyNodeId]
    if (parent?.type !== 'site') return

    const site = parent as SiteNode
    const paintField = createGrassPaintField(siteBounds(site.polygon.points), color, density)
    updateGrassPaintTexture(field.id as string, paintField)
    scene.updateNode(field.id as AnyNodeId, {
      paintMap: encodeGrassPaintField(paintField),
    } as Partial<AnyNode>)
  }

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        onChange={(mode) => setBrush({ mode })}
        options={[
          { label: 'Paint', value: 'paint' },
          { label: 'Erase', value: 'erase' },
          { label: 'Smooth', value: 'smooth' },
        ]}
        value={brush.mode}
      />

      <div className="flex flex-col gap-1.5">
        <SliderControl
          label="Size"
          max={20}
          min={0.25}
          onChange={(radius) => setBrush({ radius })}
          precision={2}
          step={0.25}
          unit="m"
          value={brush.radius}
        />
        <SliderControl
          label="Strength"
          max={1}
          min={0.05}
          onChange={(strength) => setBrush({ strength })}
          precision={2}
          step={0.05}
          value={brush.strength}
        />
        <SliderControl
          label="Softness"
          max={1}
          min={0}
          onChange={(falloff) => setBrush({ falloff })}
          precision={2}
          step={0.05}
          value={brush.falloff}
        />
        <SegmentedControl
          onChange={(shape) => setBrush({ shape })}
          options={[
            { label: 'Round', value: 'round' },
            { label: 'Square', value: 'square' },
          ]}
          value={brush.shape}
        />
      </div>

      <div className="flex flex-col gap-1.5 border-sidebar-border/60 border-t pt-3">
        <label className="flex items-center justify-between gap-3 px-1 text-xs">
          <span>Color</span>
          <input
            aria-label="Ground Cover paint color"
            className="h-7 w-12 cursor-pointer rounded border border-sidebar-border bg-transparent p-0.5"
            onChange={(event) => setBrush({ color: event.currentTarget.value })}
            type="color"
            value={brush.color}
          />
        </label>
        <SliderControl
          label="Target density"
          max={1}
          min={0}
          onChange={(targetDensity) => setBrush({ targetDensity })}
          precision={2}
          step={0.05}
          value={brush.targetDensity}
        />
        <SliderControl
          label="Noise amount"
          max={1}
          min={0}
          onChange={(noiseAmount) => setBrush({ noiseAmount })}
          precision={2}
          step={0.05}
          value={brush.noiseAmount}
        />
        <SliderControl
          label="Noise scale"
          max={20}
          min={0.25}
          onChange={(noiseScale) => setBrush({ noiseScale })}
          precision={2}
          step={0.25}
          unit="m"
          value={brush.noiseScale}
        />
      </div>

      <div className="flex items-center gap-2 border-sidebar-border/60 border-t pt-3">
        <button
          className="h-8 flex-1 rounded-md border border-sidebar-border px-3 font-medium text-xs transition-colors hover:bg-sidebar-accent"
          onClick={() => replaceField(0, CLEARED_GRASS_PAINT_COLOR)}
          type="button"
        >
          Clear
        </button>
        <button
          className="h-8 flex-1 rounded-md border border-sidebar-border px-3 font-medium text-xs transition-colors hover:bg-sidebar-accent"
          onClick={() => replaceField(brush.targetDensity)}
          type="button"
        >
          Fill
        </button>
      </div>
    </div>
  )
}

function getOrCreateGroundCover(): AnyNode | null {
  const scene = useScene.getState()
  let field = Object.values(scene.nodes).find(
    (node) => (node.type as string) === GROUND_COVER_TOOL,
  )

  if (!field) {
    const siteId = scene.rootNodeIds.find(
      (id) => (scene.nodes[id]?.type as string | undefined) === 'site',
    )
    if (!siteId) return null

    field = GrassFieldNode.parse({ parentId: siteId }) as unknown as AnyNode
    scene.createNode(field, siteId as AnyNodeId)
  }

  const patch = getMissingGrassFieldDefaults(field)
  if (Object.keys(patch).length > 0) {
    scene.updateNode(field.id as AnyNodeId, patch as Partial<AnyNode>)
    field = { ...field, ...patch } as AnyNode
  }

  return field
}
