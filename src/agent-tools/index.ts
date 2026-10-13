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
    'Read what is on the ground of the site and where water could go, over `area` (a polygon of [x, z] metres in site coordinates, default the site polygon). Returns groundCover {present, coveredM2, coverageOfAreaPct, meanHeightScale, flowerDensity, cellM}, surface {present, byMaterialM2 for flowered-grass/road-path/desert-ground/paved-road, cellM}, ponds [{id, atM, levelM, spillLevelM, bottomM, maxDepthM, areaM2, quality, bank, koi, lilies}], rivers [{id, lengthM, widthM, depthM, startM, endM, dropM, risesM (metres of river whose ground climbs downstream), flow}], hollows [{atM, bottomM, spillLevelM, maxDepthM, areaM2}] labelled approximate (terrain local minima, at most hollowsLimit), and presentation: "browser" (sky, weather and surroundings are not scene data and cannot be read here). Areas are sampled at the stated cellM lattice spacing. Terrain reads use the persisted heightfield only, never an unfinished sculpt stroke. Changes nothing. Refusals: no_site, ambiguous_site (more than one site), invalid_polygon, footprint_empty, sampling_limit.',
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
    'Lay grass and ground surfaces over 1-20 areas of the lot in one call (one undo step). Each area is a polygon, a path {points, widthM} or the whole site, with a ground kind; areas apply in order, so a path laid after a lawn cuts through it. Painting is raster: it writes the ground-cover and surface paint maps clipped to the lot, at the maps\' cell size, and the painted shape keeps no editable outline. Creates the site\'s Ground cover and Surface nodes when missing; only their paint maps change. Returns per area {index, areaM2, grassM2, surface, blockedM2} (blockedM2 is under buildings or water, where grass will not grow), the lot grassCoveragePct, grassCellM and surfaceCellM, and updateBytes (the size of the node update) next to collaborationCapBytes (65536): a fact, not a refusal. Coordinates are [x, z] metres in site coordinates. Refusals: no_site, ambiguous_site, invalid_polygon (with index), area_empty, outside_property, path_too_short, too_many_areas.',
  input: {
    areas: z.array(layGroundArea).min(1).max(64).describe('The areas to lay, in order (at most 20 apply).'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  runsIn: 'operation',
} as const satisfies EnvironmentAgentTool

export const fillPondTool = {
  name: 'fill_pond',
  title: 'Fill a pond in a hollow',
  description:
    'Put water in the hollow that the point `at` ([x, z] metres, site coordinates) drains into, using the persisted terrain only. level is metres above datum, "spill" (default: the highest level the hollow holds) or "empty"; a numeric level is quantised to the basin\'s 0.25 m steps and the applied levelM is returned. Ponds the new water connects are merged into one (mergedPondIds, their props kept). koi (0-12) and lilies (0-40) set the stocking counts; new props are placed with a fixed seed inside the wet surface, koi only where the water is at least 0.20 m deep. Returns {pondId, created, levelM, spillLevelM, bottomM, maxDepthM, areaM2, perimeterM, koi, lilies, mergedPondIds} with the counts actually in the pond. This cannot make a pond on flat ground: that needs a hollow in the terrain first. Refusals: no_site, ambiguous_site, no_terrain (no persisted terrain, or flat), no_hollow (the point drains off the lot), level_above_spill (with spillLevelM), level_below_bottom (with bottomM), too_shallow_for_koi (with maxDepthM), outside_property, no_pond (emptying a hollow with no pond), pond_empty (lilies asked of an emptied pond).',
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
  'A river is a watercourse along a centreline with a width, a depth and a flow direction; risesM reports how much of its length climbs downstream over the current terrain.',
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
