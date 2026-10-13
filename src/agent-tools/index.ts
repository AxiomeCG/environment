/**
 * `@pascal-app/plugin-environment/agent-tools`: Environment's agent tools as pure contracts
 * (name, description, zod input, where each runs). Zod only, so a host can import them
 * wherever it declares its tools (purity.test.ts); the planners live in `./agent-operations`.
 *
 * The contract types mirror `@pascal-app/core/agent-tools`, which the published core does not
 * expose to external plugins yet; they are structural, so a host's typecheck rejects this
 * export the moment the shapes drift apart.
 */
import { z } from 'zod'

export type EnvironmentAgentToolAnnotations = {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export type EnvironmentAgentTool = {
  name: string
  title: string
  description: string
  input: Record<string, z.ZodType>
  annotations?: EnvironmentAgentToolAnnotations
  runsIn: 'operation' | 'editor'
  rendersView?: boolean
  timeoutMs?: number
  chatOnly?: boolean
}

export type EnvironmentAgentTools = {
  pluginId: string
  apiVersion: 1
  version: string
  tools: readonly EnvironmentAgentTool[]
  instructions?: string
}

// Arrays avoid tuple-form JSON schemas that some MCP clients cannot call.
const point = z.array(z.number().finite()).length(2)
const polygon = z.array(point).min(3).max(200)

export const readEnvironmentTool = {
  name: 'read_environment',
  title: 'Read the environment',
  description:
    'Read what is on the ground of the site and where water could go, over `area` (a polygon of [x, z] metres in site coordinates, default the site polygon). Only the lot is read: areaM2 is the polygon\'s area and onLotM2 its part on the lot (sampled at the centres of onLotCellM cells), and every ground figure below covers that part only. Returns groundCover {present, coveredM2, coverageOfAreaPct, meanHeightScale, flowerDensity, cellM}, surface {present, byMaterialM2 for flowered-grass/road-path/desert-ground/paved-road, cellM}, ponds [{id, atM, levelM, spillLevelM, bottomM, maxDepthM, areaM2, quality, bank, koi, lilies, hiddenProps}] (koi and lilies as the pond shows them at its level, hiddenProps kept but out of the water), rivers [{id, widthM, depthM, flow, drawn, lengthM, start, end, dropM, risesM}] lists the rivers whose centreline passes through the area, each with the facts of its whole course, the one carved and drawn (a mountain source or sea outlet runs it on to the lot edge), start and end are {atM, waterM (the drawn water surface), bedM (carved ground)} in flow order, dropM the water\'s fall and risesM the metres where the water climbs downstream; drawn is false (and the course facts absent) while the site has no persisted terrain. hollows [{atM, bottomM, spillLevelM, maxDepthM, areaM2}] are labelled approximate (one per flat bottom, at most hollowsLimit, lowest first), with hollowsTruncated true when the scan stopped before finding them all. presentation is "browser": sky, weather and surroundings are not scene data and cannot be read here. Areas are sampled at the stated cellM lattice spacing. Terrain reads use the persisted heightfield only, never an unfinished sculpt stroke. Changes nothing. Refusals: no_site, ambiguous_site (more than one site), invalid_polygon, footprint_empty, outside_property (the area shares no ground with the lot; touching its edge is not enough), sampling_limit.',
  input: {
    area: polygon.optional().describe('Polygon of [x, z] points in metres; default the site polygon.'),
    hollowsLimit: z
      .number()
      .int()
      .min(0)
      .max(20)
      .optional()
      .describe('How many hollows to report at most (default 5).'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  runsIn: 'operation',
} as const satisfies EnvironmentAgentTool

const layGroundArea = z.object({
  polygon: polygon.optional().describe('The area outline: [x, z] points in metres, in order.'),
  path: z
    .object({
      points: z.array(point).min(2).max(64),
      widthM: z.number().positive().max(20),
    })
    .optional()
    .describe('A centreline of [x, z] points, laid widthM metres wide.'),
  site: z.literal(true).optional().describe('The whole lot.'),
  ground: z
    .enum(['grass', 'earth', 'path', 'paving', 'none'])
    .describe(
      'grass: full grass cover on a flowered-grass surface. earth: no grass, desert-ground surface. path: no grass, road-path surface. paving: no grass, paved-road surface. none: clears grass and surface paint.',
    ),
  featherM: z
    .number()
    .min(0)
    .max(3)
    .optional()
    .describe('Soft edge width in metres (default 0.3); 0 is a hard edge.'),
  grassHeight: z
    .number()
    .min(0.5)
    .max(2)
    .optional()
    .describe('Local grass height scale painted with this area (1 is the node default).'),
  tint: z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/)
    .optional()
    .describe('Grass tint hex colour painted with this area.'),
})

export const layGroundTool = {
  name: 'lay_ground',
  title: 'Lay ground cover and surfaces',
  description:
    'Lay grass and ground surfaces over 1-20 areas of the lot in one call (one undo step). Each area is a polygon, a path {points, widthM} or the whole site, with a ground kind; areas apply in order, so a path laid after a lawn cuts through it. Painting is raster, blended exactly as the Environment brushes blend: it paints the ground-cover and surface maps clipped to the lot, at the maps\' cell size, and the painted shape keeps no editable outline. Grass is not painted under buildings or water, as with the brush. Creates the site\'s Ground cover and Surface nodes when missing, as the panel creates them (nothing painted yet). Only the 64-cell paint tiles that changed are written. Returns per area {index, areaM2, grassM2, surface, blockedM2} (blockedM2 is under buildings or water, where grass will not grow), the lot grassCoveragePct, grassCellM and surfaceCellM, and tilesChanged, largestTileChangeBytes (old and new of the largest tile change) and changeBytes next to collaborationCapBytes (65536). Coordinates are [x, z] metres in site coordinates. Refusals: no_site, ambiguous_site, invalid_polygon (with index), area_empty, outside_property, path_too_short, too_many_areas.',
  input: {
    areas: z.array(layGroundArea).min(1).max(64).describe('The areas to lay, in order (at most 20 apply).'),
  },
  // Not idempotent: a feathered edge blends toward its target again on every call.
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  runsIn: 'operation',
} as const satisfies EnvironmentAgentTool

export const fillPondTool = {
  name: 'fill_pond',
  title: 'Fill a pond in a hollow',
  description:
    'Put water in the hollow that the point `at` ([x, z] metres, site coordinates) drains into, using the persisted terrain only. level is metres above datum, "spill" (default: the highest level the hollow holds) or "empty"; a numeric level is quantised to the basin\'s 0.25 m steps and the applied levelM is returned. Ponds the water joins, each at its own level, are merged into one record as the Environment panel merges them (mergedPondIds, their props kept). koi (0-12) and lilies (0-40) set how many the pond shows; new props are placed with a fixed seed only where the whole prop sits in water, koi where it is at least 0.20 m deep. Returns {pondId, created, levelM, spillLevelM, bottomM, maxDepthM, areaM2, perimeterM, koi, lilies, hiddenProps, mergedPondIds}: koi and lilies are the counts shown at this level, hiddenProps the props kept that the water no longer reaches (lowering and emptying keep props). This cannot make a pond on flat ground: that needs a hollow in the terrain first. Refusals: no_site, ambiguous_site, no_terrain (no persisted terrain, or flat), no_hollow (the point drains off the lot), level_above_spill (with spillLevelM), level_below_bottom (with bottomM), too_shallow_for_koi (with maxDepthM), outside_property, no_pond (emptying a hollow with no pond), pond_empty (lilies asked of an emptied pond).',
  input: {
    at: point.describe('A point [x, z] in metres inside the hollow.'),
    level: z
      .union([z.number().finite(), z.enum(['spill', 'empty'])])
      .optional()
      .describe('Water level in metres, "spill" (default) or "empty".'),
    quality: z.enum(['pure', 'clear', 'deep', 'swampy']).optional(),
    bank: z.enum(['soft', 'rocky']).optional().describe('Shoreline treatment.'),
    koi: z.number().int().min(0).max(12).optional(),
    lilies: z.number().int().min(0).max(40).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  runsIn: 'operation',
} as const satisfies EnvironmentAgentTool

/** Glossary facts for the agent: what the words mean, never which tool to call first. */
const ENVIRONMENT_GLOSSARY = [
  'Environment owns the living ground of a site: ground cover, surfaces, ponds and rivers.',
  'Ground cover is the grass itself: a painted raster of coverage and tint, plus blade settings and one flowerDensity for the whole node (flowers cannot be placed per area).',
  'A surface is what the ground is made of under the grass: one of flowered-grass, road-path, desert-ground or paved-road, also a painted raster. Unpainted surface reads as flowered-grass.',
  'A hollow is a terrain depression whose water cannot drain off the lot. Its bottom is its lowest point; its spill level is the highest water level it holds before water escapes; maxDepthM is level minus bottom.',
  'A pond is water held in a hollow at a level, with a quality (pure, clear, deep, swampy), a bank (soft or rocky shoreline) and props (koi, water lilies). Koi need at least 0.20 m of depth.',
  'A river is a watercourse along a centreline with a width, a depth and a flow direction, carved into the terrain; its course is the drawn one, which a mountain source or a sea outlet extends to the lot edge. Its water surface lies a little below the uncarved ground; its bed is the carved ground. risesM is the length along which the water climbs downstream.',
  'All areas, coverages and per-material figures are sampled on a square lattice; cellM states its spacing in metres, so a figure is only as fine as its cellM.',
  'Painted ground has no outline: laying grass writes pixels the person can repaint but cannot drag as a shape.',
  'Sky, weather and surroundings are presentation kept in the browser, not scene data; read_environment reports them as presentation: "browser".',
].join('\n')

export const ENVIRONMENT_AGENT_TOOLS = {
  pluginId: 'pascal:environment',
  apiVersion: 1,
  version: '1',
  tools: [readEnvironmentTool, layGroundTool, fillPondTool],
  instructions: ENVIRONMENT_GLOSSARY,
} as const satisfies EnvironmentAgentTools
