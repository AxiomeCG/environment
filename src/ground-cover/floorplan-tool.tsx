'use client'

import type { AnyNode, AnyNodeId, BuildingNode, SiteNode } from '@pascal-app/core'
import type { FloorplanToolContext } from '@pascal-app/editor'
import { useMemo } from 'react'
import { useEnvironmentStore } from '../store'
import { useSceneApiNodes } from '../use-scene-api-nodes'
import { resolveGrassHeightField } from './height-field'
import {
  FloorplanPaintToolLayer,
  type FloorplanPaintSession,
} from './floorplan-paint-tool'
import { getGrassHeightRuntime, updateGrassHeightTexture } from './height-texture'
import { getGrassObstacleRuntime } from './obstacle-texture'
import {
  DEFAULT_GRASS_PAINT_COLOR,
  encodeGrassPaintField,
  resolveGrassPaintField,
  siteBounds,
} from './paint-field'
import { groundCoverCursorColor, groundCoverPaintSettings } from './paint-settings'
import { beginPaintStroke } from './paint-stroke'
import { resolveActivePaintSite } from './paint-target'
import { getGrassPaintRuntime, updateGrassPaintTexture } from './paint-texture'
import { GRASS_FIELD_KIND, type GrassFieldNode } from './schema'

type PaintableGrassFieldNode = GrassFieldNode & {
  heightMap?: unknown
  paintMap?: unknown
}

type GroundCoverPaintTarget = {
  building: BuildingNode
  grassField: PaintableGrassFieldNode
  site: SiteNode
}

function resolveGroundCoverPaintTarget(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  activeLevelId: AnyNodeId | null,
): GroundCoverPaintTarget | null {
  const activeSite = resolveActivePaintSite(nodes, activeLevelId)
  if (!activeSite) return null
  const fields = (Object.values(nodes) as unknown as PaintableGrassFieldNode[]).filter(
    (node) => node.type === GRASS_FIELD_KIND && node.parentId === activeSite.site.id,
  )
  return fields.length === 1
    ? { grassField: fields[0]!, site: activeSite.site, building: activeSite.building }
    : null
}

export default function GroundCoverFloorplanTool({
  activeLevelId,
  finishTool,
  sceneApi,
}: FloorplanToolContext) {
  const nodes = useSceneApiNodes(sceneApi)
  const brush = useEnvironmentStore((state) => state.groundCoverBrush)
  const tool = useEnvironmentStore((state) => state.groundCoverTool)
  const heightAmount = useEnvironmentStore((state) => state.groundCoverHeightAmount)
  const target = useMemo(
    () => resolveGroundCoverPaintTarget(nodes, activeLevelId),
    [activeLevelId, nodes],
  )
  const settings = useMemo(
    () => groundCoverPaintSettings(tool, brush, heightAmount),
    [brush, heightAmount, tool],
  )

  if (!target) return null

  const start = (): FloorplanPaintSession => {
    const heightStroke = tool.endsWith('-height')
    const bounds = siteBounds(target.site.polygon.points)
    const runtime = heightStroke
      ? getGrassHeightRuntime(target.grassField.id)
      : getGrassPaintRuntime(target.grassField.id)
    const field = heightStroke
      ? (runtime?.field ?? resolveGrassHeightField(target.grassField.heightMap, bounds))
      : (runtime?.field ??
        resolveGrassPaintField(target.grassField.paintMap, bounds, DEFAULT_GRASS_PAINT_COLOR))
    const stroke = beginPaintStroke({
      field,
      boundary: target.site.polygon.points,
      obstacleField: heightStroke
        ? undefined
        : (getGrassObstacleRuntime(target.grassField.id)?.field ?? undefined),
      settings,
    })
    const updatePreview = heightStroke ? updateGrassHeightTexture : updateGrassPaintTexture
    return {
      stroke,
      preview: (nextField) => {
        updatePreview(target.grassField.id, nextField)
      },
      commit: (nextField) => {
        sceneApi.update(
          target.grassField.id as AnyNodeId,
          (heightStroke
            ? { heightMap: encodeGrassPaintField(nextField) }
            : { paintMap: encodeGrassPaintField(nextField) }) as unknown as Partial<AnyNode>,
        )
      },
      cancel: () => {
        updatePreview(target.grassField.id, stroke.snapshot)
      },
    }
  }

  return (
    <FloorplanPaintToolLayer
      building={target.building}
      cursorColor={groundCoverCursorColor(tool, settings)}
      finishTool={finishTool}
      settings={settings}
      targetKey={target.grassField.id}
      site={target.site}
      start={start}
    />
  )
}
