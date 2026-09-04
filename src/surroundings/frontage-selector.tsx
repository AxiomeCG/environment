'use client'

import { useMemo, useState } from 'react'

import {
  DEFAULT_NEIGHBOR_CELL_VARIATION,
  deriveSurroundingsLayout,
  orientedRectangleCorners,
  STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
} from './corridor'
import {
  cameraAzimuthToPreviewRotationDegrees,
  deriveFrontagePreviewViewBox,
  rotatePreviewPoint,
  sitePointToPreviewPoint,
} from './frontage-preview'
import {
  deriveBoundarySegments,
  type FrontageContexts,
  type FrontageSeparator,
  type Point2,
} from './frontages'
import {
  deriveHousePlans,
  deriveNeighborCellClassifications,
  houseGarageFootprint,
  houseOpeningSegment,
  houseRoofRidge,
} from './neighborhood'
import { deriveRuntimeRoadNetwork } from './runtime-road-graph'
import { deriveOuterRoads } from './outer-roads'

const SEPARATOR_PRESENTATION: Record<FrontageSeparator, { label: string; lineClassName: string }> =
  {
    none: {
      label: 'No road',
      lineClassName: 'text-sidebar-foreground/70',
    },
    'secondary-road': {
      label: 'Secondary road',
      lineClassName: 'text-sidebar-foreground',
    },
    'primary-road': {
      label: 'Primary road',
      lineClassName: 'text-primary',
    },
  }

const SEPARATOR_OPTIONS = [
  { label: 'No road', value: 'none' },
  { label: 'Secondary road', value: 'secondary-road' },
  { label: 'Primary road', value: 'primary-road' },
] as const satisfies readonly { label: string; value: FrontageSeparator }[]

type FrontageSelectorProps = {
  cameraAzimuth: number
  contexts: FrontageContexts
  onSeparatorChange: (index: number, separator: FrontageSeparator) => void
  points: readonly Point2[]
  seed: string
}

function svgPoint(point: Point2): Point2 {
  return sitePointToPreviewPoint(point)
}

function svgPolygonPoints(points: readonly Point2[]): string {
  return points.map((point) => svgPoint(point).join(',')).join(' ')
}

export default function FrontageSelector({
  cameraAzimuth,
  contexts,
  onSeparatorChange,
  points,
  seed,
}: FrontageSelectorProps) {
  const [selectedEdge, setSelectedEdge] = useState(0)
  const previewPlan = useMemo(() => {
    try {
      const segments = deriveBoundarySegments({ points, contexts })
      const layout = deriveSurroundingsLayout(
        segments,
        STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
        { ...DEFAULT_NEIGHBOR_CELL_VARIATION, seed },
      )
      try {
        const network = deriveRuntimeRoadNetwork(layout, deriveOuterRoads(layout, { seed }))
        const cells = deriveNeighborCellClassifications(layout, network, seed)
        return {
          status: 'ready' as const,
          segments,
          layout,
          cells,
          houses: deriveHousePlans(cells, seed),
        }
      } catch {
        return {
          status: 'ready' as const,
          segments,
          layout,
          cells: layout.neighborCells.map((cell) => ({
            ...cell,
            lotIndex: 0,
            roadCoverage: 0,
            use: 'residual' as const,
          })),
          houses: [],
        }
      }
    } catch (error) {
      return {
        status: 'error' as const,
        message: error instanceof Error ? error.message : 'The Site boundary is unavailable.',
      }
    }
  }, [contexts, points, seed])

  const diagram = useMemo(() => {
    if (previewPlan.status === 'error') return null
    const { cells, houses, layout, segments } = previewPlan
    const cellShapes = cells.map((cell) => ({
      id: cell.id,
      kind: cell.kind,
      points: cell.polygon,
      use: cell.use,
    }))
    const corridorShapes = layout.corridors.map((corridor) => ({
      id: corridor.id,
      road: orientedRectangleCorners(corridor.road, corridor.frame),
    }))
    const junctionShapes = layout.roadJunctions.map((junction) => ({
      id: junction.id,
      points: junction.corners,
    }))
    const houseShapes = houses.map((house) => ({
      access: house.access.point,
      footprint: house.footprint,
      garage: houseGarageFootprint(house),
      id: house.id,
      openings: house.facades.flatMap((facade) =>
        facade.openings
          .filter((opening) => opening.bottom < 2.5)
          .map((opening) => ({
            kind: opening.kind,
            segment: houseOpeningSegment(house, facade, opening),
          })),
      ),
      ridge: houseRoofRidge(house),
    }))
    const siteXValues = points.map(([x]) => x)
    const siteZValues = points.map(([, z]) => z)
    const siteExtent = Math.max(
      Math.max(...siteXValues) - Math.min(...siteXValues),
      Math.max(...siteZValues) - Math.min(...siteZValues),
      1,
    )
    const arrowLength = siteExtent * 0.12
    const segmentShapes = segments.map((segment) => {
      const start = svgPoint(segment.start)
      const end = svgPoint(segment.end)
      const midpoint: Point2 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
      const arrowEnd: Point2 = [
        midpoint[0] + segment.outwardNormal[0] * arrowLength,
        midpoint[1] + segment.outwardNormal[1] * arrowLength,
      ]

      return {
        arrowEnd,
        end,
        midpoint,
        presentation: SEPARATOR_PRESENTATION[segment.context.separator],
        segment,
        start,
      }
    })

    // Frame the editable Site, not the distant lots. Road changes must not move
    // the controls or shrink the property to an unreadable dot.
    const previewViewBox = deriveFrontagePreviewViewBox(points, siteExtent * 0.35)
    const viewBox = [
      previewViewBox.x,
      previewViewBox.y,
      previewViewBox.width,
      previewViewBox.height,
    ].join(' ')
    return {
      cellShapes,
      corridorShapes,
      junctionShapes,
      houseShapes,
      segmentShapes,
      previewViewBox,
      viewBox,
    }
  }, [points, previewPlan])

  if (!diagram || previewPlan.status === 'error') {
    return (
      <p className="text-destructive text-xs" role="alert">
        {previewPlan.status === 'error' ? previewPlan.message : 'The Site boundary is unavailable.'}
      </p>
    )
  }

  const {
    cellShapes,
    corridorShapes,
    junctionShapes,
    houseShapes,
    segmentShapes,
    previewViewBox,
    viewBox,
  } = diagram
  const activeSegment =
    previewPlan.segments.find((segment) => segment.index === selectedEdge) ??
    previewPlan.segments[0]!
  const rotationDegrees = cameraAzimuthToPreviewRotationDegrees(cameraAzimuth)
  const sceneTransform =
    rotationDegrees === 0
      ? undefined
      : `rotate(${rotationDegrees} ${previewViewBox.center[0]} ${previewViewBox.center[1]})`
  const polygonPoints = svgPolygonPoints(points)

  return (
    <div className="overflow-hidden rounded-lg border border-sidebar-border bg-sidebar-accent/20">
      <div className="flex items-center justify-between gap-2 px-3 pt-3 text-xs">
        <span className="font-medium">Road layout</span>
        <span className="text-sidebar-foreground/60">Camera aligned</span>
      </div>
      <div className="relative aspect-square overflow-hidden">
        <svg
          aria-hidden="true"
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="xMidYMid meet"
          viewBox={viewBox}
        >
          <g transform={sceneTransform}>
            {cellShapes.map((shape) => {
              const color =
                shape.use === 'transport'
                  ? 'var(--sidebar-foreground)'
                  : shape.use === 'residual'
                    ? '#f59e0b'
                    : '#10b981'
              const fillOpacity = shape.use === 'transport' ? 0.08 : 0.12
              const strokeOpacity =
                shape.use === 'transport' ? 0.25 : shape.kind === 'corner' ? 0.55 : 0.45

              return (
                <polygon
                  fill={color}
                  fillOpacity={fillOpacity}
                  key={shape.id}
                  points={svgPolygonPoints(shape.points)}
                  stroke={color}
                  strokeOpacity={strokeOpacity}
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}

            {corridorShapes.map((shape) => (
              <polygon
                fill="var(--sidebar-foreground)"
                fillOpacity="0.16"
                key={shape.id}
                points={svgPolygonPoints(shape.road)}
                stroke="var(--sidebar-foreground)"
                strokeOpacity="0.45"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {junctionShapes.map((shape) => (
              <polygon
                fill="var(--sidebar-foreground)"
                fillOpacity="0.16"
                key={shape.id}
                points={svgPolygonPoints(shape.points)}
                stroke="var(--sidebar-foreground)"
                strokeOpacity="0.45"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {houseShapes.map((house) => (
              <g key={house.id}>
                <polygon
                  fill="var(--sidebar-foreground)"
                  fillOpacity="0.32"
                  points={svgPolygonPoints(house.footprint)}
                  stroke="var(--sidebar-foreground)"
                  strokeLinejoin="round"
                  strokeOpacity="0.8"
                  strokeWidth="1.25"
                  vectorEffect="non-scaling-stroke"
                />
                {house.garage && (
                  <polygon
                    fill="var(--sidebar-foreground)"
                    fillOpacity="0.16"
                    points={svgPolygonPoints(house.garage)}
                    stroke="var(--sidebar-foreground)"
                    strokeLinejoin="round"
                    strokeOpacity="0.6"
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                <line
                  stroke="var(--sidebar-foreground)"
                  strokeDasharray="3 2"
                  strokeOpacity="0.55"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                  x1={svgPoint(house.ridge[0])[0]}
                  x2={svgPoint(house.ridge[1])[0]}
                  y1={svgPoint(house.ridge[0])[1]}
                  y2={svgPoint(house.ridge[1])[1]}
                />
                {house.openings.map((opening, index) => {
                  const start = svgPoint(opening.segment[0])
                  const end = svgPoint(opening.segment[1])
                  return (
                    <line
                      key={`${opening.kind}-${index}`}
                      stroke={opening.kind === 'door' ? '#d97706' : '#0ea5e9'}
                      strokeLinecap="round"
                      strokeWidth={opening.kind === 'door' ? 2.5 : 2}
                      vectorEffect="non-scaling-stroke"
                      x1={start[0]}
                      x2={end[0]}
                      y1={start[1]}
                      y2={end[1]}
                    />
                  )
                })}
              </g>
            ))}

            <polygon
              fill="var(--sidebar-accent)"
              fillOpacity="0.7"
              points={polygonPoints}
              stroke="var(--sidebar-border)"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
            {segmentShapes.map(({ arrowEnd, end, midpoint, presentation, segment, start }) => (
              <g className={presentation.lineClassName} key={segment.index}>
                {segment.index === activeSegment.index && (
                  <line
                    stroke="currentColor"
                    strokeOpacity="0.18"
                    strokeWidth="12"
                    vectorEffect="non-scaling-stroke"
                    x1={start[0]}
                    x2={end[0]}
                    y1={start[1]}
                    y2={end[1]}
                  />
                )}
                <line
                  pointerEvents="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth={segment.context.separator === 'primary-road' ? 5 : 2}
                  vectorEffect="non-scaling-stroke"
                  x1={start[0]}
                  x2={end[0]}
                  y1={start[1]}
                  y2={end[1]}
                  strokeDasharray={segment.context.separator === 'none' ? '3 5' : undefined}
                />
                <line
                  pointerEvents="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                  x1={midpoint[0]}
                  x2={arrowEnd[0]}
                  y1={midpoint[1]}
                  y2={arrowEnd[1]}
                />
                <circle
                  cx={arrowEnd[0]}
                  cy={arrowEnd[1]}
                  fill="currentColor"
                  pointerEvents="none"
                  r="2.5"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  className="cursor-pointer"
                  onClick={() => setSelectedEdge(segment.index)}
                  stroke="transparent"
                  strokeWidth="24"
                  vectorEffect="non-scaling-stroke"
                  x1={start[0]}
                  x2={end[0]}
                  y1={start[1]}
                  y2={end[1]}
                />
              </g>
            ))}
          </g>
        </svg>
        <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-xs font-medium text-sidebar-foreground/60">
          Site
        </span>

        <div aria-label="Property edges" role="group">
          {segmentShapes.map(({ arrowEnd, presentation, segment }) => {
            const position = rotatePreviewPoint(arrowEnd, rotationDegrees, previewViewBox.center)
            const selected = segment.index === activeSegment.index
            return (
              <button
                aria-label={`Edge ${segment.index + 1}: ${presentation.label}`}
                aria-pressed={selected}
                className={`absolute flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring ${presentation.lineClassName}`}
                key={segment.index}
                onClick={() => setSelectedEdge(segment.index)}
                style={{
                  left: `${((position[0] - previewViewBox.x) / previewViewBox.width) * 100}%`,
                  top: `${((position[1] - previewViewBox.y) / previewViewBox.height) * 100}%`,
                }}
                title={`Edge ${segment.index + 1} · ${presentation.label}`}
                type="button"
              >
                <span
                  className={`flex size-6 items-center justify-center rounded-full border bg-sidebar text-xs font-semibold tabular-nums transition-colors ${selected ? 'border-current ring-2 ring-current' : 'border-sidebar-border hover:border-current'}`}
                >
                  {segment.index + 1}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-sidebar-border bg-sidebar px-3 py-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">Edge {activeSegment.index + 1}</span>
          <span className="text-sidebar-foreground/60">Select an edge on the map</span>
        </div>
        <div
          aria-label={`Edge ${activeSegment.index + 1} road type`}
          className="grid grid-cols-3 gap-1 rounded-md bg-sidebar-accent/40 p-1"
          role="group"
        >
          {SEPARATOR_OPTIONS.map((option) => (
            <button
              aria-label={option.label}
              aria-pressed={activeSegment.context.separator === option.value}
              className={`min-h-10 rounded px-1 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${activeSegment.context.separator === option.value ? 'bg-sidebar font-medium text-sidebar-foreground shadow-sm' : 'text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground'}`}
              key={option.value}
              onClick={() => onSeparatorChange(activeSegment.index, option.value)}
              type="button"
            >
              {option.value === 'none'
                ? 'No road'
                : option.value === 'secondary-road'
                  ? 'Secondary'
                  : 'Primary'}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
