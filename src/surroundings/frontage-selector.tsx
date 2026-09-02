'use client'

import {
  deriveSurroundingsLayout,
  orientedRectangleCorners,
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

  const layout = deriveSurroundingsLayout(segments)
  const corridorShapes = layout.corridors.map((corridor) => ({
    id: corridor.id,
    road: orientedRectangleCorners(corridor.road, corridor.frame),
    properties: corridor.properties.map((property) => ({
      id: property.id,
      points: orientedRectangleCorners(
        {
          center: property.center,
          length: property.frontageWidth,
          width: property.depth,
        },
        corridor.frame,
      ),
    })),
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
  for (const shape of corridorShapes) {
    diagramPoints.push(...shape.road)
    for (const property of shape.properties) {
      diagramPoints.push(...property.points)
    }
  }
  for (const junction of layout.roadJunctions) {
    diagramPoints.push(...junction.corners)
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
          {corridorShapes.map((shape) => (
            <g key={shape.id}>
              {shape.properties.map((property) => (
                <polygon
                  className="fill-emerald-500/15 stroke-emerald-500/50"
                  key={property.id}
                  points={svgPolygonPoints(property.points)}
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              <polygon
                className="fill-sidebar-foreground/20 stroke-sidebar-foreground/50"
                points={svgPolygonPoints(shape.road)}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}
          {layout.roadJunctions.map((junction) => (
            <polygon
              className="fill-sidebar-foreground/20"
              key={junction.id}
              points={svgPolygonPoints(junction.corners)}
            />
          ))}
          <polygon
            className="fill-sidebar-accent/70 stroke-sidebar-border"
            points={polygonPoints}
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
