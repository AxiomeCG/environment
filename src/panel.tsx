"use client"

import {
  type AnyNode,
  type AnyNodeId,
  type SiteNode,
  useScene,
} from "@pascal-app/core"
import {
  ActionButton,
  subscribeCameraPose,
  useEditor,
} from "@pascal-app/editor"
import { useViewer } from "@pascal-app/viewer"
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  Blend,
  Brush,
  Circle,
  Check,
  ChevronDown,
  Eraser,
  PaintBucket,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import AtmosphereControls from "./atmosphere/controls"
import { ParameterRange } from "./parameter-range"
import EnvironmentSelector, {
  EnvironmentCatalogue,
  type EnvironmentTool,
} from "./environment-selector"
import FrontageSelector from "./surroundings/frontage-selector"
import { createGrassHeightField } from "./ground-cover/height-field"
import { updateGrassHeightTexture } from "./ground-cover/height-texture"
import {
  CLEARED_GRASS_PAINT_COLOR,
  createGrassPaintField,
  encodeGrassPaintField,
  siteBounds,
} from "./ground-cover/paint-field"
import { updateGrassPaintTexture } from "./ground-cover/paint-texture"
import {
  getMissingGrassFieldDefaults,
  GrassFieldNode,
} from "./ground-cover/schema"
import {
  activatePondTool,
  activateGroundCoverTool,
  activatePascalShortcut,
  activateSurfaceMaterialTool,
  activateRiverTool,
  GROUND_COVER_TOOL,
  POND_TOOL,
  RIVER_TOOL,
  SURFACE_MATERIAL_TOOL,
  type GroundCoverToolActionTarget,
} from "./pascal-tool-actions"
import PondControls from "./pond/controls"
import RiverControls from "./river/controls"
import { type GroundCoverBrushTool, useEnvironmentStore } from "./store"
import {
  createSurfaceMaterialField,
  encodeSurfaceMaterialField,
} from "./surface-material/field"
import { SURFACE_MATERIAL_PRESENTATION } from "./surface-material/materials"
import { SurfaceMaterialNode } from "./surface-material/schema"
import { updateSurfacePaintTextures } from "./surface-material/texture"
import {
  SURFACE_MATERIAL_PAINT_COLOR,
  type SurfaceMaterialId,
} from "./surface-material/material-types"


function WaterTabs({
  value,
  onChange,
  children,
}: {
  value: "pond" | "river"
  onChange: (tab: "pond" | "river") => void
  children: ReactNode
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Water type"
        className="grid grid-cols-2 gap-1 rounded-lg border border-sidebar-border p-1"
        onKeyDown={(event) => {
          let next: "pond" | "river"
          if (event.key === "Home") next = "pond"
          else if (event.key === "End") next = "river"
          else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            next = value === "pond" ? "river" : "pond"
          } else return
          event.preventDefault()
          onChange(next)
          event.currentTarget.querySelector<HTMLButtonElement>(`[data-water-tab="${next}"]`)?.focus()
        }}
      >
        {(["pond", "river"] as const).map((tab) => (
          <button
            key={tab}
            id={`${id}-${tab}-tab`}
            type="button"
            role="tab"
            data-water-tab={tab}
            aria-selected={value === tab}
            aria-controls={value === tab ? `${id}-panel` : undefined}
            tabIndex={value === tab ? 0 : -1}
            onClick={() => onChange(tab)}
            className={`rounded-md px-3 py-2 font-medium text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring ${
              value === tab
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            }`}
          >
            {tab === "pond" ? "Pond" : "River"}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${value}-tab`}>
        {children}
      </div>
    </div>
  )
}

const GROUND_COVER_INSTRUCTIONS: Record<GroundCoverBrushTool, string> = {
  "paint-density": "Drag on the ground to paint grass. Press Esc to stop.",
  "erase-density": "Drag on the ground to erase grass. Press Esc to stop.",
  "smooth-density": "Drag on the ground to smooth density. Press Esc to stop.",
  "raise-height": "Drag to raise grass locally. Press Esc to stop.",
  "lower-height": "Drag to lower grass locally. Press Esc to stop.",
  "smooth-height": "Drag to smooth local grass height. Press Esc to stop.",
}

export default function EnvironmentPanel() {
  const activeTool = useEditor((state) => state.tool) as string | null
  const editorMode = useEditor((state) => state.mode)
  const activeSection = useEnvironmentStore((state) => state.activeSection)
  const setActiveSection = useEnvironmentStore(
    (state) => state.setActiveSection,
  )
  const catalogueView = useEnvironmentStore((state) => state.catalogueView)
  const setCatalogueView = useEnvironmentStore(
    (state) => state.setCatalogueView,
  )
  const waterTab = useEnvironmentStore((state) => state.waterTab)
  const setWaterTab = useEnvironmentStore((state) => state.setWaterTab)
  const nodes = useScene((state) => state.nodes)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const layerCount = useScene(
    (state) =>
      Object.values(state.nodes).filter(
        (node) => (node.type as string) === GROUND_COVER_TOOL,
      ).length,
  )
  const groundCoverActive =
    activeTool === GROUND_COVER_TOOL && editorMode === "build"
  const groundCoverSelected = selectedIds.some(
    (id) =>
      (nodes[id as AnyNodeId]?.type as string | undefined) ===
      GROUND_COVER_TOOL,
  )
  const surfaceActive =
    activeTool === SURFACE_MATERIAL_TOOL && editorMode === "build"
  const surfaceSelected = selectedIds.some(
    (id) =>
      (nodes[id as AnyNodeId]?.type as string | undefined) ===
      SURFACE_MATERIAL_TOOL,
  )
  const pondActive = activeTool === POND_TOOL && editorMode === "build"
  const pondSelected = selectedIds.some(
    (id) => (nodes[id as AnyNodeId]?.type as string | undefined) === POND_TOOL,
  )
  const riverActive = activeTool === RIVER_TOOL && editorMode === "build"
  const riverSelected = selectedIds.some(
    (id) => (nodes[id as AnyNodeId]?.type as string | undefined) === RIVER_TOOL,
  )
  useEffect(() => {
    if (activeTool === RIVER_TOOL || (!pondActive && riverSelected)) {
      setWaterTab("river")
    } else if (activeTool === POND_TOOL || (!riverActive && pondSelected)) {
      setWaterTab("pond")
    }
  }, [activeTool, pondActive, pondSelected, riverActive, riverSelected, setWaterTab])
  const siteAvailable = Object.values(nodes).some(
    (node) => node.type === "site",
  )
  const activateGroundCover = () => {
    const field = getOrCreateGroundCover()
    if (!field) return
    useViewer.getState().setSelection({ selectedIds: [field.id as AnyNodeId] })
    activateGroundCoverTool(
      useEditor.getState() as unknown as GroundCoverToolActionTarget,
    )
  }
  const activateSurface = () => {
    const surface = getOrCreateSurfaceMaterial()
    if (!surface) return
    useViewer
      .getState()
      .setSelection({ selectedIds: [surface.id as AnyNodeId] })
    activateSurfaceMaterialTool(
      useEditor.getState() as unknown as GroundCoverToolActionTarget,
    )
  }
  const activatePond = () => {
    activatePondTool(
      useEditor.getState() as unknown as GroundCoverToolActionTarget,
    )
  }
  const activateRiver = () => {
    activateRiverTool(
      useEditor.getState() as unknown as GroundCoverToolActionTarget,
    )
  }
  const activateWater = () => {
    if (waterTab === "river") activateRiver()
    else activatePond()
  }
  const changeWaterTab = (tab: "pond" | "river") => {
    if (tab === waterTab) return
    setWaterTab(tab)
    useViewer.getState().setSelection({ selectedIds: [] })
    if (tab === "river") activateRiver()
    else activatePond()
  }
  const leaveWater = () => {
    const editor = useEditor.getState()
    if ([POND_TOOL, RIVER_TOOL].includes(editor.tool as string)) {
      editor.setTool(null)
      editor.setMode("select")
    }
    useEnvironmentStore.getState().resetPondTool()
    setActiveSection(undefined)
  }
  const sculptPondTerrain = () => {
    useEnvironmentStore.getState().resetPondTool()
    useEditor.getState().setTool(null)
    activatePascalShortcut("terrain")
  }
  const selectEnvironmentTool = (tool: EnvironmentTool) => {
    if (tool === "ground-cover") {
      setActiveSection(tool)
      activateGroundCover()
    } else if (tool === "path") {
      setActiveSection(tool)
      activateSurface()
    } else if (tool === "water") {
      setActiveSection(tool)
      activateWater()
    } else if (tool === "surroundings" || tool === "atmosphere") {
      setActiveSection(tool)
      const editor = useEditor.getState()
      editor.setTool(null)
      editor.setMode("select")
    } else {
      activatePascalShortcut(tool)
    }
  }
  if (activeSection === "ground-cover") {
    return (
      <PaintPanel
        title="Ground Cover"
        description="Paint coverage, then shape the grass."
        active={groundCoverActive && groundCoverSelected}
        available={siteAvailable}
        onBack={() => setActiveSection(undefined)}
        onResume={activateGroundCover}
      >
        <GroundCoverPaintControls />
      </PaintPanel>
    )
  }
  if (activeSection === "path") {
    return (
      <PaintPanel
        title="Surface"
        description="Paint materials that follow your terrain."
        active={surfaceActive && surfaceSelected}
        available={siteAvailable}
        onBack={() => setActiveSection(undefined)}
        onResume={activateSurface}
      >
        <SurfacePaintControls />
      </PaintPanel>
    )
  }
  if (activeSection === "water") {
    return (
      <PaintPanel
        title="Water"
        description={waterTab === "pond"
          ? "Fill terrain depressions in contour steps, then dress the water."
          : "Draw a watercourse and carve its channel into the terrain."}
        active={waterTab === "pond" ? pondActive : riverActive}
        available={siteAvailable}
        activeLabel={waterTab === "pond" ? "Pond tool active" : "River tool active"}
        resumeLabel={waterTab === "pond"
          ? (pondSelected ? "Resume selected pond" : "Resume pond tool")
          : (riverSelected ? "Resume selected river" : "Resume river tool")}
        unavailableMessage="Add a Site before creating water."
        onBack={leaveWater}
        onResume={activateWater}
      >
        <WaterTabs value={waterTab} onChange={changeWaterTab}>
          {waterTab === "pond"
            ? <PondControls onSculptTerrain={sculptPondTerrain} />
            : <RiverControls />}
        </WaterTabs>
      </PaintPanel>
    )
  }
  if (activeSection === "atmosphere") {
    return (
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4 text-sidebar-foreground">
        <BackButton onClick={() => setActiveSection(undefined)} />
        <header className="flex flex-col gap-2">
          <h2 className="font-semibold text-base">Sky &amp; atmosphere</h2>
          <p className="text-sidebar-foreground/60 text-xs">
            Shape the daylight and the world beyond the Site.
          </p>
        </header>
        <AtmosphereControls />
      </div>
    )
  }
  if (activeSection === "surroundings") {
    return (
      <div className="flex flex-col gap-4 p-4 text-sidebar-foreground">
        <BackButton onClick={() => setActiveSection(undefined)} />
        <header className="flex flex-col gap-2">
          <h2 className="font-semibold text-base">Surroundings</h2>
          <p className="text-sidebar-foreground/50 text-xs">
            Choose what lies directly beyond each property edge.
          </p>
        </header>
        <SurroundingsControls />
      </div>
    )
  }
  return (
    <div className="flex h-full min-h-0 flex-col text-sidebar-foreground">
      <header className="flex flex-col gap-2 px-4 pt-4 pb-3">
        <h2 className="font-semibold text-base">Environment</h2>
        <p className="text-sidebar-foreground/50 text-xs">
          Choose an area of the environment to work on.
        </p>
      </header>
      <label className="flex items-center justify-between gap-3 px-4 pb-3 text-xs">
        <span className="text-sidebar-foreground/60">Browse</span>
        <select
          aria-label="Environment view"
          className="h-9 rounded-md border border-sidebar-border bg-transparent px-3 text-sidebar-foreground text-xs"
          onChange={(event) =>
            setCatalogueView(
              event.target.value === "site" ? "site" : "catalogue",
            )
          }
          value={catalogueView}
        >
          <option value="catalogue">Catalogue</option>
          <option value="site">Site View</option>
        </select>
      </label>
      {layerCount > 0 && (
        <div className="px-4 pb-3">
          <ResumeButton
            label={
              groundCoverSelected
                ? "Ground Cover · Selected"
                : "Ground Cover · Select layer"
            }
            onClick={() => selectEnvironmentTool("ground-cover")}
          />
        </div>
      )}
      {catalogueView === "catalogue" ? (
        <EnvironmentCatalogue
          className="min-h-0 flex-1 overflow-y-auto px-4 pb-4"
          onSelect={selectEnvironmentTool}
        />
      ) : (
        <EnvironmentSelector
          className="flex min-h-0 w-full flex-1 flex-col justify-center"
          onSelect={selectEnvironmentTool}
        />
      )}
    </div>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="flex min-h-9 self-start items-center gap-1.5 rounded-md text-sidebar-foreground/70 text-xs hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-ring"
      style={{ minHeight: 36 }}
      onClick={onClick}
      type="button"
    >
      <ArrowLeft aria-hidden size={14} />
      Environment
    </button>
  )
}

function ResumeButton({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <ActionButton
      className="min-h-10 flex-none focus-visible:outline-2 focus-visible:outline-ring"
      style={{ minHeight: 40 }}
      icon={<Brush aria-hidden size={15} />}
      label={label}
      onClick={onClick}
      type="button"
    />
  )
}

function PaintPanel({
  title,
  description,
  active,
  available,
  onBack,
  onResume,
  activeLabel = "Brush active",
  resumeLabel = "Resume painting",
  unavailableMessage = "Add a Site before painting the environment.",
  children,
}: {
  title: string
  description: string
  active: boolean
  available: boolean
  onBack: () => void
  onResume: () => void
  activeLabel?: string
  resumeLabel?: string
  unavailableMessage?: string
  children: ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden text-sidebar-foreground">
      <header className="flex shrink-0 flex-col gap-2 px-4 pt-4">
        <BackButton onClick={onBack} />
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-base">{title}</h2>
          <span
            className={`rounded-full px-2 py-1 font-medium text-[11px] ${active ? "bg-primary/15 text-primary" : "bg-sidebar-accent text-sidebar-foreground/70"}`}
          >
            {active ? activeLabel : "Paused"}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-sidebar-foreground/70">
          {description}
        </p>
        {available && !active && (
          <ResumeButton label={resumeLabel} onClick={onResume} />
        )}
      </header>
      <div
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "var(--sidebar-border) transparent",
        }}
      >
        {!available ? (
          <p
            role="status"
            className="rounded-md border border-sidebar-border p-3 text-xs"
          >
            {unavailableMessage}
          </p>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

function GroundCoverPaintControls() {
  const brush = useEnvironmentStore((state) => state.groundCoverBrush)
  const tool = useEnvironmentStore((state) => state.groundCoverTool)
  const heightAmount = useEnvironmentStore(
    (state) => state.groundCoverHeightAmount,
  )
  const setBrush = useEnvironmentStore((state) => state.setGroundCoverBrush)
  const setTool = useEnvironmentStore((state) => state.setGroundCoverTool)
  const setHeightAmount = useEnvironmentStore(
    (state) => state.setGroundCoverHeightAmount,
  )
  const isHeightTool = tool.endsWith("-height")

  const resolveGroundCover = () => {
    const field = getOrCreateGroundCover()
    if (!field?.parentId) return null
    const scene = useScene.getState()
    const parent = scene.nodes[field.parentId as AnyNodeId]
    if (parent?.type !== "site") return null
    return { field, scene, site: parent as SiteNode }
  }

  const replaceField = (density: number, color = brush.color) => {
    const target = resolveGroundCover()
    if (!target) return
    const paintField = createGrassPaintField(
      siteBounds(target.site.polygon.points),
      color,
      density,
    )
    updateGrassPaintTexture(target.field.id as string, paintField)
    target.scene.updateNode(
      target.field.id as AnyNodeId,
      { paintMap: encodeGrassPaintField(paintField) } as Partial<AnyNode>,
    )
  }

  const resetHeight = () => {
    const target = resolveGroundCover()
    if (!target) return
    const heightField = createGrassHeightField(
      siteBounds(target.site.polygon.points),
    )
    updateGrassHeightTexture(target.field.id as string, heightField)
    target.scene.updateNode(
      target.field.id as AnyNodeId,
      { heightMap: encodeGrassPaintField(heightField) } as Partial<AnyNode>,
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <BrushChoices
          label="Coverage"
          value={tool}
          onChange={setTool}
          options={[
            {
              value: "paint-density",
              label: "Paint",
              icon: <Brush aria-hidden size={15} />,
            },
            {
              value: "erase-density",
              label: "Erase",
              icon: <Eraser aria-hidden size={15} />,
            },
            {
              value: "smooth-density",
              label: "Smooth",
              icon: <Blend aria-hidden size={15} />,
            },
          ]}
        />
        <BrushChoices
          label="Local height"
          value={tool}
          onChange={setTool}
          options={[
            {
              value: "raise-height",
              label: "Raise",
              icon: <ArrowUpFromLine aria-hidden size={15} />,
            },
            {
              value: "lower-height",
              label: "Lower",
              icon: <ArrowDownToLine aria-hidden size={15} />,
            },
            {
              value: "smooth-height",
              label: "Smooth",
              icon: <Blend aria-hidden size={15} />,
            },
          ]}
        />
        <p className="min-h-8 text-xs leading-relaxed text-sidebar-foreground/70">
          {GROUND_COVER_INSTRUCTIONS[tool]}
        </p>
      </div>
      <BrushSection title="Brush">
        <ParameterRange label="Radius"
        min={0.25}
        max={20}
        step={0.25}
        unit="m"
        precision={2}
        value={brush.radius}
        onChange={(radius) => setBrush({ radius })} />
        <ParameterRange label="Strength"
        min={1}
        max={100}
        step={1}
        unit="%"
        value={Math.round(brush.strength * 100)}
        onChange={(strength) => setBrush({ strength: strength / 100 })} />
        <ParameterRange label="Edge softness"
        min={0}
        max={100}
        step={1}
        unit="%"
        value={Math.round(brush.falloff * 100)}
        onChange={(falloff) => setBrush({ falloff: falloff / 100 })} />
      </BrushSection>
      {tool === "paint-density" && (
        <BrushSection title="Paint result">
          <ParameterRange label="Target coverage"
          min={0}
          max={100}
          step={1}
          unit="%"
          value={Math.round(brush.targetDensity * 100)}
          onChange={(targetDensity) =>
            setBrush({ targetDensity: targetDensity / 100 })
          } />
          <label className="flex min-h-10 items-center justify-between gap-3 text-xs">
            <span>Grass color</span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-sidebar-foreground/70">
                {brush.color.toUpperCase()}
              </span>
              <input
                aria-label="Grass paint color"
                className="h-9 w-10 cursor-pointer rounded-md border border-sidebar-border bg-transparent p-1 focus-visible:outline-2 focus-visible:outline-ring"
                onChange={(event) => setBrush({ color: event.target.value })}
                type="color"
                value={brush.color}
              />
            </span>
          </label>
          <p className="text-xs leading-relaxed text-sidebar-foreground/60">
            Coverage controls where grass grows. Blade size and overall density
            are in the Grass Field inspector.
          </p>
        </BrushSection>
      )}
      {isHeightTool && tool !== "smooth-height" && (
        <BrushSection title="Height adjustment">
          <ParameterRange label="Height change"
          min={5}
          max={100}
          step={5}
          unit="%"
          value={heightAmount}
          onChange={setHeightAmount} />
          <p className="text-xs leading-relaxed text-sidebar-foreground/60">
            Changes grass height under the brush, not the terrain.
          </p>
        </BrushSection>
      )}
      <details className="group rounded-lg border border-sidebar-border">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between rounded-lg px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">
          Brush details
          <ChevronDown
            aria-hidden
            size={14}
            className="group-open:rotate-180"
          />
        </summary>
        <div className="flex flex-col gap-3 px-3 pb-3">
          <BrushChoices
            label="Shape"
            value={brush.shape}
            onChange={(shape) => setBrush({ shape })}
            options={[
              {
                value: "round",
                label: "Round",
                icon: <Circle aria-hidden size={14} />,
              },
              {
                value: "square",
                label: "Square",
                icon: <Square aria-hidden size={14} />,
              },
            ]}
          />
          <ParameterRange label="Stroke variation"
          min={0}
          max={100}
          step={1}
          unit="%"
          value={Math.round(brush.noiseAmount * 100)}
          onChange={(noiseAmount) =>
            setBrush({ noiseAmount: noiseAmount / 100 })
          } />
          <p className="text-xs leading-relaxed text-sidebar-foreground/60">
            Higher variation breaks up the stroke for a less uniform result.
          </p>
        </div>
      </details>
      <WholeSiteActions
        key={isHeightTool ? "height" : "coverage"}
        actions={
          isHeightTool
            ? [
                {
                  label: "Reset height",
                  icon: <RotateCcw aria-hidden size={15} />,
                  description:
                    "Reset all locally painted grass heights across the Site.",
                  onConfirm: resetHeight,
                },
              ]
            : [
                {
                  label: "Fill site",
                  icon: <PaintBucket aria-hidden size={15} />,
                  description:
                    "Replace all grass coverage with full coverage in the current grass color.",
                  onConfirm: () => replaceField(1),
                },
                {
                  label: "Clear grass",
                  icon: <Trash2 aria-hidden size={15} />,
                  description:
                    "Remove all painted grass from this Site. Local height adjustments are kept.",
                  onConfirm: () => replaceField(0, CLEARED_GRASS_PAINT_COLOR),
                },
              ]
        }
      />
    </div>
  )
}

function BrushSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function BrushChoices<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string; icon?: ReactNode }[]
  onChange: (value: T) => void
}) {
  const name = useId()
  const [focused, setFocused] = useState<T | null>(null)
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-xs font-medium text-sidebar-foreground/70">
        {label}
      </legend>
      <div className="flex gap-1 rounded-lg bg-sidebar-accent/50 p-1">
        {options.map((option) => (
          <label
            className="relative min-w-0 flex-1 cursor-pointer"
            key={option.value}
          >
            <input
              className="sr-only"
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              onFocus={() => setFocused(option.value)}
              onBlur={() => setFocused(null)}
            />
            <span
              className="flex min-h-9 items-center justify-center gap-1.5 rounded-md px-1 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent"
              style={{
                minHeight: 36,
                backgroundColor:
                  value === option.value ? "var(--sidebar-accent)" : undefined,
                color: value === option.value ? "var(--primary)" : undefined,
                boxShadow:
                  value === option.value
                    ? "inset 0 0 0 1px var(--sidebar-border)"
                    : undefined,
                outline:
                  focused === option.value
                    ? "2px solid var(--ring)"
                    : undefined,
                outlineOffset: 2,
              }}
            >
              {option.icon}
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}


function WholeSiteActions({
  actions,
}: {
  actions: {
    label: string
    icon: ReactNode
    description: string
    onConfirm: () => void
  }[]
}) {
  const [pending, setPending] = useState<number | null>(null)
  const [notice, setNotice] = useState("")
  const container = useRef<HTMLDivElement>(null)
  const returnIndex = useRef<number | null>(null)
  useEffect(() => {
    if (pending !== null)
      container.current
        ?.querySelector<HTMLButtonElement>("[data-site-cancel]")
        ?.focus()
    else if (returnIndex.current !== null)
      container.current
        ?.querySelectorAll<HTMLButtonElement>("[data-site-action]")
        [returnIndex.current]?.focus()
  }, [pending])
  const action = pending === null ? null : actions[pending]
  return (
    <div
      className="flex flex-col gap-2 border-t border-sidebar-border pt-4"
      ref={container}
    >
      <h3 className="text-xs font-semibold">Whole site</h3>
      {action ? (
        <div
          className="flex flex-col gap-3 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation()
              setPending(null)
            }
          }}
        >
          <p className="text-xs leading-relaxed">{action.description}</p>
          <div className="flex gap-2">
            <ActionButton
              className="min-h-10 focus-visible:outline-2 focus-visible:outline-ring"
              label="Cancel"
              data-site-cancel=""
              onClick={() => setPending(null)}
              type="button"
            />
            <ActionButton
              className="min-h-10 focus-visible:outline-2 focus-visible:outline-ring"
              label="Confirm"
              onClick={() => {
                action.onConfirm()
                setPending(null)
                setNotice(`${action.label} applied.`)
              }}
              type="button"
            />
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          {actions.map((item, index) => (
            <ActionButton
              className="min-h-10 focus-visible:outline-2 focus-visible:outline-ring"
              data-site-action=""
              icon={item.icon}
              key={item.label}
              label={item.label}
              onClick={() => {
                returnIndex.current = index
                setNotice("")
                setPending(index)
              }}
              type="button"
            />
          ))}
        </div>
      )}
      <p
        className="text-[11px] leading-relaxed text-sidebar-foreground/60"
        role="status"
      >
        {notice || "Applies across the Site, not just under the brush."}
      </p>
    </div>
  )
}

function SurroundingsControls() {
  const site = useScene((state) => {
    const siteId = state.rootNodeIds.find(
      (id) => (state.nodes[id]?.type as string | undefined) === "site",
    )
    return siteId ? (state.nodes[siteId] as SiteNode) : undefined
  })
  const [cameraAzimuth, setCameraAzimuth] = useState(
    () => useEditor.getState().navigationSyncPose?.azimuth ?? 0,
  )
  useEffect(() => {
    const unsubscribeCamera = subscribeCameraPose((pose) => {
      const x = pose.position[0] - pose.target[0]
      const z = pose.position[2] - pose.target[2]
      // At a vertical view the horizontal bearing is undefined; keep the last one.
      if (Math.hypot(x, z) > 1e-6) setCameraAzimuth(Math.atan2(x, z))
    })
    const unsubscribeNavigation = useEditor.subscribe((state, previous) => {
      const pose = state.navigationSyncPose
      if (pose !== previous.navigationSyncPose && pose?.source === "2d") {
        setCameraAzimuth(pose.azimuth)
      }
    })
    return () => {
      unsubscribeCamera()
      unsubscribeNavigation()
    }
  }, [])
  const contexts = useEnvironmentStore((state) => state.frontageContexts)
  const enabled = useEnvironmentStore((state) => state.surroundingsEnabled)
  const setFrontageSeparator = useEnvironmentStore(
    (state) => state.setFrontageSeparator,
  )
  const setEnabled = useEnvironmentStore(
    (state) => state.setSurroundingsEnabled,
  )
  const seed = useEnvironmentStore((state) => state.surroundingsSeed)
  const setSeed = useEnvironmentStore((state) => state.setSurroundingsSeed)
  const birdsEnabled = useEnvironmentStore((state) => state.birdsEnabled)
  const setBirdsEnabled = useEnvironmentStore((state) => state.setBirdsEnabled)
  const ambientMotion = useEnvironmentStore((state) => state.ambientMotion)
  const setAmbientMotion = useEnvironmentStore((state) => state.setAmbientMotion)

  if (!site) {
    return (
      <p className="text-destructive text-xs" role="alert">
        A root Site is required to configure surroundings.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center justify-between gap-3 rounded-md border border-sidebar-border px-3 py-2 text-xs">
        <span>Show neighborhood</span>
        <input
          aria-label="Show neighborhood"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          type="checkbox"
        />
      </label>
      <label className="flex items-center justify-between gap-3 rounded-md border border-sidebar-border px-3 py-2 text-xs">
        <span>Show distant birds</span>
        <input
          checked={birdsEnabled}
          disabled={!enabled}
          onChange={(event) => setBirdsEnabled(event.target.checked)}
          type="checkbox"
        />
      </label>
      <label className="flex items-center justify-between gap-3 rounded-md border border-sidebar-border px-3 py-2 text-xs">
        <span>Animate distant birds</span>
        <input
          checked={ambientMotion}
          disabled={!enabled || !birdsEnabled}
          onChange={(event) => setAmbientMotion(event.target.checked)}
          type="checkbox"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span>Neighborhood seed</span>
        <input
          className="rounded-md border border-sidebar-border bg-sidebar px-3 py-2"
          key={seed}
          defaultValue={seed}
          maxLength={80}
          onBlur={(event) =>
            setSeed(event.currentTarget.value.trim() || "pascal-suburbs")
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur()
          }}
          type="text"
        />
      </label>
      <FrontageSelector
        cameraAzimuth={cameraAzimuth}
        contexts={contexts}
        onSeparatorChange={setFrontageSeparator}
        points={site.polygon.points}
        seed={seed}
      />
      <p className="text-sidebar-foreground/50 text-xs">
        Runtime only — seed, visibility, motion and frontage settings remain in
        memory and are not saved yet.
      </p>
    </div>
  )
}

function SurfacePaintControls() {
  const brush = useEnvironmentStore((state) => state.surfaceBrush)
  const material = useEnvironmentStore((state) => state.surfaceMaterial)
  const setBrush = useEnvironmentStore((state) => state.setSurfaceBrush)
  const setMaterial = useEnvironmentStore((state) => state.setSurfaceMaterial)
  const textureSize = useScene((state) => {
    const surface = Object.values(state.nodes).find(
      (node) => (node.type as string) === SURFACE_MATERIAL_TOOL,
    ) as unknown as SurfaceMaterialNode | undefined
    return surface?.textureSize ?? 100
  })
  const setTextureSize = (value: number) => {
    const surface = getOrCreateSurfaceMaterial()
    if (!surface) return
    useScene
      .getState()
      .updateNode(
        surface.id as AnyNodeId,
        { textureSize: value } as Partial<AnyNode>,
      )
  }
  const replaceSurface = (fillMaterial?: SurfaceMaterialId) => {
    const surface = getOrCreateSurfaceMaterial()
    if (!surface?.parentId) return
    const site = useScene.getState().nodes[surface.parentId as AnyNodeId]
    if (site?.type !== "site") return
    const field = createSurfaceMaterialField(siteBounds(site.polygon.points))
    const color = fillMaterial
      ? SURFACE_MATERIAL_PAINT_COLOR[fillMaterial]
      : null
    if (color) {
      for (let index = 0; index < field.values.length; index += 4) {
        field.values[index] = color.r
        field.values[index + 1] = color.g
        field.values[index + 2] = color.b
        field.values[index + 3] = 255
      }
    }
    updateSurfacePaintTextures(surface.id, field)
    useScene
      .getState()
      .updateNode(
        surface.id as AnyNodeId,
        { paintMap: encodeSurfaceMaterialField(field) } as Partial<AnyNode>,
      )
  }
  const presentation = SURFACE_MATERIAL_PRESENTATION.find(
    (item) => item.id === material,
  )!
  return (
    <div className="flex flex-col gap-5">
      <BrushSection title="Material">
        <div
          aria-label="Surface material"
          className="grid grid-cols-2 gap-2"
          role="group"
        >
          {SURFACE_MATERIAL_PRESENTATION.map((item) => (
            <button
              aria-pressed={material === item.id}
              className={`overflow-hidden rounded-lg border text-left text-xs focus-visible:outline-2 focus-visible:outline-ring ${material === item.id ? "border-primary bg-primary/10 ring-1 ring-primary/30" : "border-sidebar-border hover:border-sidebar-foreground/40 hover:bg-sidebar-accent"}`}
              key={item.id}
              onClick={() => {
                setMaterial(item.id)
                setBrush({ mode: "paint" })
              }}
              type="button"
            >
              <img
                alt=""
                className="h-16 w-full object-cover"
                src={item.preview}
              />
              <span className="flex min-h-9 items-center justify-between gap-1 px-2 py-1.5 font-medium">
                {item.label}
                {material === item.id && (
                  <Check
                    aria-hidden
                    size={14}
                    className="shrink-0 text-primary"
                  />
                )}
              </span>
            </button>
          ))}
        </div>
        <p className="min-h-8 text-xs leading-relaxed text-sidebar-foreground/70">
          {presentation.description}
        </p>
      </BrushSection>
      <div className="flex flex-col gap-2">
        <BrushChoices
          label="Operation"
          value={brush.mode === "smooth" ? "smooth" : "paint"}
          onChange={(mode) => setBrush({ mode })}
          options={[
            {
              value: "paint",
              label: "Paint",
              icon: <Brush aria-hidden size={15} />,
            },
            {
              value: "smooth",
              label: "Blend",
              icon: <Blend aria-hidden size={15} />,
            },
          ]}
        />
        <p className="text-xs leading-relaxed text-sidebar-foreground/70">
          {brush.mode === "smooth"
            ? "Drag across material edges to soften the transition."
            : `Drag on the terrain to paint ${presentation.label.toLowerCase()}.`}{" "}
          Press Esc to stop.
        </p>
      </div>
      <BrushSection title="Brush">
        <ParameterRange label="Radius"
        min={0.25}
        max={20}
        step={0.25}
        unit="m"
        precision={2}
        value={brush.radius}
        onChange={(radius) => setBrush({ radius })} />
        <ParameterRange label="Strength"
        min={5}
        max={100}
        step={5}
        value={Math.round(brush.strength * 100)}
        onChange={(strength) => setBrush({ strength: strength / 100 })} />
        <ParameterRange label="Edge softness"
        min={0}
        max={100}
        step={5}
        value={Math.round(brush.falloff * 100)}
        onChange={(falloff) => setBrush({ falloff: falloff / 100 })} />
      </BrushSection>
      <details className="group rounded-lg border border-sidebar-border">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between rounded-lg px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">
          Material scale
          <ChevronDown
            aria-hidden
            size={14}
            className="group-open:rotate-180"
          />
        </summary>
        <div className="flex flex-col gap-2 px-3 pb-3">
          <ParameterRange label="Texture size"
          min={25}
          max={200}
          step={5}
          value={textureSize}
          onChange={setTextureSize}
          commitOnRelease />
          <p className="text-xs leading-relaxed text-sidebar-foreground/60">
            Larger values enlarge the pattern on all painted materials. Release
            the slider to apply.
          </p>
        </div>
      </details>
      <WholeSiteActions
        key={material}
        actions={[
          {
            label: "Fill site",
            icon: <PaintBucket aria-hidden size={15} />,
            description: `Replace every painted surface with ${presentation.label.toLowerCase()}.`,
            onConfirm: () => replaceSurface(material),
          },
          {
            label: "Clear surface",
            icon: <Trash2 aria-hidden size={15} />,
            description:
              "Remove all painted surface materials from this Site. Grass coverage is kept.",
            onConfirm: () => replaceSurface(),
          },
        ]}
      />
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
      (id) => (scene.nodes[id]?.type as string | undefined) === "site",
    )
    if (!siteId) return null
    const site = scene.nodes[siteId] as SiteNode
    const paint = createGrassPaintField(
      siteBounds(site.polygon.points),
      CLEARED_GRASS_PAINT_COLOR,
      0,
    )
    const height = createGrassHeightField(siteBounds(site.polygon.points))
    field = GrassFieldNode.parse({
      parentId: siteId,
      paintMap: encodeGrassPaintField(paint),
      heightMap: encodeGrassPaintField(height),
    }) as unknown as AnyNode
    scene.createNode(field, siteId as AnyNodeId)
  }

  const patch = getMissingGrassFieldDefaults(field)
  if (Object.keys(patch).length > 0) {
    scene.updateNode(field.id as AnyNodeId, patch as Partial<AnyNode>)
    field = { ...field, ...patch } as AnyNode
  }

  return field
}

function getOrCreateSurfaceMaterial(): AnyNode | null {
  const scene = useScene.getState()
  let surface = Object.values(scene.nodes).find(
    (node) => (node.type as string) === SURFACE_MATERIAL_TOOL,
  )
  if (surface) return surface
  const siteId = scene.rootNodeIds.find(
    (id) => (scene.nodes[id]?.type as string | undefined) === "site",
  )
  if (!siteId) return null
  const site = scene.nodes[siteId] as SiteNode
  const field = createSurfaceMaterialField(siteBounds(site.polygon.points))
  surface = SurfaceMaterialNode.parse({
    parentId: siteId,
    paintMap: encodeSurfaceMaterialField(field),
  }) as unknown as AnyNode
  scene.createNode(surface, siteId as AnyNodeId)
  updateSurfacePaintTextures(surface.id as string, field)
  return surface
}
