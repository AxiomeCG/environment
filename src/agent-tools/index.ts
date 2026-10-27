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
import { groundCoverStylePatch } from '../ground-cover/style'

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
    'Read what is on the ground of the site and where water could go, over `area` (a polygon of [x, z] metres in site coordinates, default the site polygon). Only the lot is read: areaM2 is the polygon\'s area and onLotM2 the area it shares with the lot (exact), and every ground figure below covers that part only. Returns groundCover {present, coveredM2, coverageOfAreaPct, meanHeightScale, flowerDensity, style (all global inspector fields, or null when absent), units {bladeHeightM, bladeWidthM, candidateCellM, maxBladesPerM2, bladesPerM2, densityHeightScale, unvariedHeightM, meaning} (nominal full-paint flat unobstructed full-detail LOD; not visible counts; null when absent), cellM, coverageMeaning, terrain, steepPaintM2, flowerSteepPaintM2, renderingSlopeLimitsDeg}, surface {present, byMaterialM2 for flowered-grass/road-path/desert-ground/paved-road, cellM}, ponds [{id, atM, levelM, spillLevelM, bottomM, maxDepthM, areaM2, quality, bank, koi, lilies, hiddenProps}] (koi and lilies as the pond shows them at its level, hiddenProps kept but out of the water), rivers [{id, widthM, depthM, flow, waterProfile, drawn, notBuilt, lengthM, start, end, dropM, risesM}] lists the rivers whose centreline passes through the area, each with the facts of its whole course, the one carved and drawn (a mountain source or sea outlet runs it on to the lot edge); flow is forward or reverse along the authored points, waterProfile downhill or as_drawn, start and end are {atM, waterM (the drawn water surface), bedM (carved ground)} in flow order, dropM the water\'s fall and risesM the metres where the water climbs downstream; drawn is false (and the course facts absent) while the site has no persisted terrain, or when the river is not built, with the reason in notBuilt. hollows [{atM, bottomM, spillLevelM, maxDepthM, areaM2}] are labelled approximate (one per flat bottom, at most hollowsLimit, lowest first), with hollowsTruncated true when the scan stopped before finding them all. presentation is "browser": sky, weather and surroundings are not scene data and cannot be read here. Areas are sampled at the stated cellM lattice spacing. Ground-cover coverage means sampled paint alpha, not actual plant counts or rendered planting density; flowerDensity is a configured value. steepPaintM2 and flowerSteepPaintM2 are paint-alpha-weighted sampled areas at or above the grass (70 degrees) and flower (55 degrees) rendering cutoff, not plant counts; the flower area is reported regardless of configured flowerDensity. renderingSlopeLimitsDeg states these cutoffs. groundCover.terrain reports {sampleCount, cellM, sampleAt, heightRangeM, slopeRangeDeg}, sampled only at covered paint-cell centres inside the area and lot; ranges are [min,max], or null with no covered samples. Terrain reads use the persisted heightfield only, never an unfinished sculpt stroke; absent terrain is flat at 0 m. No botanical suitability or sun/shade is inferred. Changes nothing. Refusals: no_site, ambiguous_site (more than one site), invalid_polygon, footprint_empty, outside_property (the area shares no ground with the lot; touching its edges is not enough), sampling_limit.',
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
    .describe('Soft edge width in metres (default 0.3, and 0 for the whole site); 0 is a hard edge.'),
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
    'Lay grass and ground surfaces over 1-20 areas of the lot in one call (one undo step). Each area is a polygon, a path {points, widthM} or the whole site, with a ground kind; areas apply in order, so a path laid after a lawn cuts through it. Painting is raster, blended exactly as the Environment brushes blend: it paints the ground-cover and surface maps clipped to the lot, at the maps\' cell size, and the painted shape keeps no editable outline. Grass is not painted under buildings or water, as with the brush. Grass requests also skip slope >=70 degrees on all painted maps; this is a rendering limit, not a botanical suitability claim. Creates the site\'s Ground cover and Surface nodes when missing, as the panel creates them (nothing painted yet). An area that is the whole site (`site`) is also the lot\'s ground, kept on both nodes: land the lot grows into later (set_site_lot, or dragging the property line) reads as that ground, with its grass tint and height, and the result names it as lotGround. Ground laid over part of the lot is not carried onto new land, and a project laid before this was kept has to lay the whole site again. Only the 64-cell paint tiles that changed are written. Returns per area {index, areaM2, grassM2, surface, blockedM2, excludedSteepM2, terrain} (blockedM2 is under buildings or water, where grass paint is skipped; excludedSteepM2 is brush-strength-weighted steep area, which may overlap blockedM2). terrain is {sampleCount, cellM, sampleAt, heightRangeM, slopeRangeDeg}: [min,max] extrema over on-lot paint-lattice points touched by the brush, including excluded points, or null ranges without samples. Uses persisted terrain only, absent terrain flat at 0 m, and never writes terrain. Also returns the lot grassCoveragePct (paint coverage, not actual plants), grassCellM and surfaceCellM, and tilesChanged, largestTileChangeBytes (old and new of the largest tile change) and changeBytes next to collaborationCapBytes (65536). Coordinates are [x, z] metres in site coordinates. Refusals: no_site, ambiguous_site, invalid_polygon (with index), area_empty, outside_property, path_too_short, too_many_areas, slope_too_steep (no sampled grass point below 70 degrees; entire call refused with no changes).',
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

export const setGroundCoverStyleTool = {
  name: 'set_ground_cover_style',
  title: 'Set ground-cover style',
  description:
    'Set the site ground cover’s global inspector style, not a local paint scale. Provide one or more fields; omitted fields keep their current values. Creates an unpainted ground-cover node with inspector defaults when missing. Returns {groundCoverId, created, style (all current fields), units {bladeHeightM, bladeWidthM, candidateCellM, maxBladesPerM2, bladesPerM2, densityHeightScale, unvariedHeightM, meaning}}. Density 100 is capped at 156.25 blade instances/m² on full-paint, flat, unobstructed ground at full-detail LOD (8 cm jittered candidate cells); lower density uses smoothstep, not a linear percentage, and also shortens blades by effective density squared. Each instance is crossed blade planes, not a botanical blade count. Paint, slopes, obstacles and distance LOD reduce counts. Wider blades look fuller but do not move roots closer; spacing is not editable. bladeHeight is straight length in metres, further scaled by variation, density, local lay_ground grassHeight and obstacle flattening; bend changes tip height. Refuses invalid_ground_cover_style for empty, unknown, non-finite or out-of-inspector-range fields; no clamping. Transform and paint are unchanged.',
  input: groundCoverStylePatch.shape,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  runsIn: 'operation',
} as const satisfies EnvironmentAgentTool

/** Glossary facts for the agent: what the words mean, never which tool to call first. */
const ENVIRONMENT_GLOSSARY = [
  'Environment owns the living ground of a site: ground cover, surfaces, ponds and rivers.',
  'Ground cover is the grass itself: a painted raster of coverage and tint, plus blade settings and one flowerDensity for the whole node (flowers cannot be placed per area).',
  'Ground-cover style is global, using the inspector fields and units. read_environment reports groundCover.style and groundCover.units. Nominal bladesPerM2 assumes full paint, flat ground, no obstacles and full-detail LOD; it is not a measured visible count. Density 100 caps the fixed 8 cm candidate grid at 156.25 crossed-plane blade instances/m²; wider blades increase visual fullness, not root count. Local grassHeight multiplies the global bladeHeight.',
  'A surface is what the ground is made of under the grass: one of flowered-grass, road-path, desert-ground or paved-road, also a painted raster. Unpainted surface reads as flowered-grass.',
  'A hollow is a terrain depression whose water cannot drain off the lot. Its bottom is its lowest point; its spill level is the highest water level it holds before water escapes; maxDepthM is level minus bottom.',
  'A pond is water held in a hollow at a level, with a quality (pure, clear, deep, swampy), a bank (soft or rocky shoreline) and props (koi, water lilies). Koi need at least 0.20 m of depth.',
  'A river is a watercourse along a centreline with a width, a depth and a flow direction, carved into the terrain; its course is the drawn one, which a mountain source or a sea outlet extends to the lot edge. Its water profile is downhill (the water never rises downstream: it cuts through rises and crosses dips on an embankment, and runs from its higher end) or as_drawn (the water lies a little below the uncarved ground, as placed). Its bed is the carved ground. risesM is the length along which the water climbs downstream. A downhill river that would cross or touch itself at two water levels is not built.',
  'All areas, coverages and per-material figures are sampled on a square lattice; cellM states its spacing in metres, so a figure is only as fine as its cellM.',
  'Painted ground has no outline: laying grass writes pixels the person can repaint but cannot drag as a shape.',
  'Sky, weather and surroundings are presentation kept in the browser, not scene data; read_environment reports them as presentation: "browser".',
].join('\n')

export const ENVIRONMENT_AGENT_TOOLS = {
  pluginId: 'pascal:environment',
  apiVersion: 1,
  version: '1',
  tools: [readEnvironmentTool, layGroundTool, fillPondTool, setGroundCoverStyleTool],
  instructions: ENVIRONMENT_GLOSSARY,
} as const satisfies EnvironmentAgentTools
