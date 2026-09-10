'use client'

import type { AnyNode, AnyNodeId, BuildingNode, SiteNode } from '@pascal-app/core'
import type { FloorplanToolContext } from '@pascal-app/editor'
import { useMemo } from 'react'
import {
  FloorplanPaintToolLayer,
  type FloorplanPaintSession,
} from '../ground-cover/floorplan-paint-tool'
import { rgbToHex, siteBounds } from '../ground-cover/paint-field'
import { beginPaintStroke } from '../ground-cover/paint-stroke'
import { resolveActivePaintSite } from '../ground-cover/paint-target'
import { useEnvironmentStore } from '../store'
import { useSceneApiNodes } from '../use-scene-api-nodes'
import {
  encodeSurfaceMaterialField,
  resolveSurfaceMaterialField,
} from './field'
import {
  SURFACE_MATERIAL_AVERAGE_COLOR,
  SURFACE_MATERIAL_PAINT_COLOR,
} from './material-types'
import { SURFACE_MATERIAL_KIND, type SurfaceMaterialNode } from './schema'
import { updateSurfacePaintTextures } from './texture'

type SurfacePaintTarget = {
  building: BuildingNode
  site: SiteNode
  surface: SurfaceMaterialNode
}

function resolveSurfacePaintTarget(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  activeLevelId: AnyNodeId | null,
): SurfacePaintTarget | null {
  const activeSite = resolveActivePaintSite(nodes, activeLevelId)
  if (!activeSite) return null
  const fields = (Object.values(nodes) as unknown as SurfaceMaterialNode[]).filter(
    (node) => node.type === SURFACE_MATERIAL_KIND && node.parentId === activeSite.site.id,
  )
  return fields.length === 1
    ? { building: activeSite.building, site: activeSite.site, surface: fields[0]! }
    : null
}

export default function SurfaceMaterialFloorplanTool({
  activeLevelId,
  finishTool,
  sceneApi,
}: FloorplanToolContext) {
  const nodes = useSceneApiNodes(sceneApi)
  const brush = useEnvironmentStore((state) => state.surfaceBrush)
  const material = useEnvironmentStore((state) => state.surfaceMaterial)
  const target = useMemo(
    () => resolveSurfacePaintTarget(nodes, activeLevelId),
    [activeLevelId, nodes],
  )
  const settings = useMemo(
    () => ({
      ...brush,
      color: rgbToHex(SURFACE_MATERIAL_PAINT_COLOR[material]),
      premultiplyColorByDensity: true,
      clipToBoundary: false,
      targetDensity: 1,
    }),
    [brush, material],
  )

  if (!target) return null

  const start = (): FloorplanPaintSession => {
    const stroke = beginPaintStroke({
      field: resolveSurfaceMaterialField(
        target.surface.paintMap,
        siteBounds(target.site.polygon.points),
      ),
      boundary: target.site.polygon.points,
      settings,
    })
    return {
      stroke,
      preview: (field) => {
        updateSurfacePaintTextures(target.surface.id, field)
      },
      commit: (field) => {
        sceneApi.update(
          target.surface.id as AnyNodeId,
          { paintMap: encodeSurfaceMaterialField(field) } as unknown as Partial<AnyNode>,
        )
      },
      cancel: () => {
        updateSurfacePaintTextures(target.surface.id, stroke.snapshot)
      },
    }
  }

  const [red, green, blue] = SURFACE_MATERIAL_AVERAGE_COLOR[material]
  const cursorColor =
    settings.mode === 'erase'
      ? '#ef4444'
      : settings.mode === 'smooth'
        ? '#38bdf8'
        : `rgb(${red * 255} ${green * 255} ${blue * 255})`
  return (
    <FloorplanPaintToolLayer
      building={target.building}
      cursorColor={cursorColor}
      finishTool={finishTool}
      settings={settings}
      targetKey={target.surface.id}
      site={target.site}
      start={start}
    />
  )
}
