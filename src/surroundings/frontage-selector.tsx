'use client'

import {
  deriveSurroundingsLayout,
  orientedRectangleCorners,
  STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
} from './corridor'
import {
  cameraAzimuthToPreviewRotationDegrees,
  deriveFrontagePreviewViewBox,
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

const SEPARATOR_PRESENTATION: Record<
  FrontageSeparator,
  { label: string; lineClassName: string }
> = {
  none: {
    label: 'No road',
    lineClassName: 'text-sidebar-foreground/40',
  },
  'secondary-road': {
    label: 'Secondary road',
    lineClassName: 'text-amber-500',
  },
  'primary-road': {
    label: 'Primary road',
    lineClassName: 'text-sky-500',
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
}: FrontageSelectorProps) {
  let segments
  try {
    segments = deriveBoundarySegments({ points, contexts })
  } catch (error) {
    return (
      <p className="text-destructive text-xs" role="alert">
        {error instanceof Error ? error.message : 'The Site boundary is unavailable.'}
      </p>
    )
  }

  const layout = deriveSurroundingsLayout(
    segments,
    STREETSCAPE_SURROUNDINGS_CORRIDOR_DIMENSIONS,
  )
  const neighborhood = (() => {
    try {
      const network = deriveRuntimeRoadNetwork(layout)
      const cells = deriveNeighborCellClassifications(segments, layout, network)
      return { cells, houses: deriveHousePlans(cells) }
    } catch {
      return {
        cells: layout.neighborCells.map((cell) => ({
          ...cell,
          lotIndex: 0,
          roadCoverage: 0,
          use: 'residual' as const,
        })),
        houses: [],
      }
    }
  })()
  const cellShapes = neighborhood.cells.map((cell) => ({
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
  const houseShapes = neighborhood.houses.map((house) => ({
    access: house.access.point,
    footprint: house.footprint,
    garage: houseGarageFootprint(house),
    id: house.id,
    openings: house.facades.flatMap((facade) => facade.openings
      .filter((opening) => opening.bottom < 2.5)
      .map((opening) => ({
        kind: opening.kind,
        segment: houseOpeningSegment(house, facade, opening),
      }))),
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
    const midpoint: Point2 = [
      (start[0] + end[0]) / 2,
      (start[1] + end[1]) / 2,
    ]
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
  const diagramPoints: Point2[] = [...points]
  for (const shape of cellShapes) {
    diagramPoints.push(...shape.points)
  }

  for (const shape of corridorShapes) {
    diagramPoints.push(...shape.road)
  }

  for (const shape of junctionShapes) {
    diagramPoints.push(...shape.points)
  }

  for (const shape of houseShapes) {
    diagramPoints.push(...shape.footprint, ...shape.ridge, shape.access)
  }

  for (const shape of segmentShapes) {
    diagramPoints.push(shape.arrowEnd)
  }

  const previewViewBox = deriveFrontagePreviewViewBox(
    diagramPoints,
    siteExtent * 0.15,
  )
  const viewBox = [
    previewViewBox.x,
    previewViewBox.y,
    previewViewBox.width,
    previewViewBox.height,
  ].join(' ')
  const rotationDegrees = cameraAzimuthToPreviewRotationDegrees(cameraAzimuth)
  const sceneTransform = rotationDegrees === 0
    ? undefined
    : `rotate(${rotationDegrees} ${previewViewBox.center[0]} ${previewViewBox.center[1]})`
  const polygonPoints = svgPolygonPoints(points)

  return (
    <div className="flex flex-col gap-3">
      <svg
        aria-hidden="true"
        className="h-48 w-full rounded-md border border-sidebar-border bg-sidebar-accent/20"
        preserveAspectRatio="xMidYMid meet"
        viewBox={viewBox}
      >
        <g transform={sceneTransform}>
          {cellShapes.map((shape) => {
            const color = shape.use === 'transport'
              ? 'var(--sidebar-foreground)'
              : shape.use === 'residual'
                ? '#f59e0b'
                : '#10b981'
            const fillOpacity = shape.use === 'transport' ? 0.08 : 0.12
            const strokeOpacity = shape.use === 'transport'
              ? 0.25
              : shape.kind === 'corner'
                ? 0.55
                : 0.45

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
              <line
                pointerEvents="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="4"
                vectorEffect="non-scaling-stroke"
                x1={start[0]}
                x2={end[0]}
                y1={start[1]}
                y2={end[1]}
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
            </g>
          ))}
        </g>
      </svg>

      <div aria-label="Property edge road types" className="flex flex-col gap-2" role="group">
        {segments.map((segment) => (
          <label
            className="grid grid-cols-[4.5rem_1fr] items-center gap-2 text-xs"
            key={segment.index}
          >
            <span className="text-sidebar-foreground/60">Edge {segment.index + 1}</span>
            <select
              aria-label={`Edge ${segment.index + 1} road type`}
              className="h-9 w-full rounded-md border border-sidebar-border bg-transparent px-3 text-sidebar-foreground text-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onChange={(event) => onSeparatorChange(
                segment.index,
                event.target.value as FrontageSeparator,
              )}
              value={segment.context.separator}
            >
              {SEPARATOR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  )
}
