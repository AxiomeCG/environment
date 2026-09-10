export type EnvironmentLabCamera = {
  position: [number, number, number]
  target: [number, number, number]
}

export type EnvironmentLabFeature = {
  id: string
  title: string
  description: string
}

export type EnvironmentLabCase = {
  id: string
  version: number
  kind: 'gym' | 'zoo' | 'museum'
  title: string
  summary: string
  featureIds: readonly string[]
  reviewSteps: readonly { id: string; action: string; expectation: string }[]
  sources: readonly { label: string; url: string }[]
  camera: EnvironmentLabCamera
  stations: readonly {
    id: string
    title: string
    description: string
    camera: EnvironmentLabCamera
  }[]
  variants: readonly { id: string; label: string; description: string }[]
}

const SOURCE_ROOT = 'https://github.com/AxiomeCG/environment/blob/main/src'
const source = (label: string, path: string) => ({
  label,
  url: `${SOURCE_ROOT}/${path}`,
})
const camera = (
  position: [number, number, number],
  target: [number, number, number],
): EnvironmentLabCamera => ({ position, target })

export const ENVIRONMENT_LAB_FEATURES = [
  {
    id: 'surface-materials',
    title: 'Surface materials',
    description:
      'Four terrain-draped PBR paint channels, texture scale, feathered Site transitions and current-production GLB inspection.',
  },
  {
    id: 'surface-authoring',
    title: 'Surface authoring',
    description:
      'Paint, blend, fill and clear operations in the real Surface tool and Site floorplan.',
  },
  {
    id: 'ground-cover-authoring',
    title: 'Ground Cover authoring',
    description:
      'Coverage and local-height paint, erase, smooth, shape, variation, fill, clear and reset controls.',
  },
  {
    id: 'ground-cover-appearance',
    title: 'Ground Cover appearance',
    description:
      'Blade dimensions and variation, bend, tint, tip brightness, density, flowers and wind response.',
  },
  {
    id: 'ground-cover-obstacles',
    title: 'Ground Cover obstacles',
    description:
      'Terrain sampling plus building, structure, prop-like solid and resolved wet-water exclusion without erasing paint.',
  },
  {
    id: 'pond-basins',
    title: 'Pond basins and levels',
    description:
      'Terrain-derived basins, connected seeds, stepped levels, spill limits, emptying and retained authored state.',
  },
  {
    id: 'pond-appearance',
    title: 'Pond appearance',
    description: 'Pure, clear, deep and swampy water with soft or deterministic rocky shorelines.',
  },
  {
    id: 'pond-life',
    title: 'Pond life',
    description: 'Wet-footprint placement, removal and clearing for lilies and pause-aware koi.',
  },
  {
    id: 'river-authoring',
    title: 'River authoring',
    description:
      'Draw, edit, cancel, undo and delete flows with width, depth, source and outlet controls.',
  },
  {
    id: 'river-terrain',
    title: 'River terrain grading',
    description:
      'Native Site terrain grading from preserved source metadata, including regrade and final restoration.',
  },
  {
    id: 'river-flow',
    title: 'River flow and endpoints',
    description:
      'Directional visual current, speed, qualities, shores and rounded, mountain or sea connections.',
  },
  {
    id: 'surroundings-regional',
    title: 'Regional surroundings',
    description:
      'Exterior terrain, frontage roads and access, houses, trees, shadows, water, fields, commerce and skyline.',
  },
  {
    id: 'surroundings-natural',
    title: 'Natural surroundings',
    description:
      'Open Meadow and Woodland Edge grass, flowers, trees, clearings and distant forest without built context.',
  },
  {
    id: 'surroundings-motion',
    title: 'Surroundings motion and night',
    description:
      'Bird controls, pause-aware lighthouse beacon, solar night factor, windows and streetlights.',
  },
  {
    id: 'atmosphere-sky',
    title: 'Sky and solar lighting',
    description:
      'Procedural or gradient sky, time/manual sun, presets, scattering, clouds, fog, moon, exposure and debug views.',
  },
  {
    id: 'atmosphere-weather',
    title: 'Weather',
    description:
      'Rain, snow, wind, lightning, wetness, snow cover and explicit-session thunder audio.',
  },
  {
    id: 'portability',
    title: 'Configuration and portability',
    description:
      'Versioned presentation sidecar, semantic nodes, live/static/bake distinctions and authored export boundaries.',
  },
  {
    id: 'combined-landscape',
    title: 'Combined living landscape',
    description:
      'Terrain, painted surfaces, vegetation, authored water, surroundings, atmosphere and weather in one guided scene.',
  },
] as const satisfies readonly EnvironmentLabFeature[]

export const ENVIRONMENT_LAB_CASES = [
  {
    id: 'surface-materials',
    version: 1,
    kind: 'zoo',
    title: 'Surface material field',
    summary:
      'A true-scale 16 m field compares every current material channel, a blended cross, terrain drape and the six-metre Site-edge transition.',
    featureIds: ['surface-materials', 'surface-authoring'],
    reviewSteps: [
      {
        id: 'compare-swatches',
        action: 'Visit each quadrant at the swatch stations.',
        expectation:
          'Flowered grass, road path, desert ground and paved road remain distinct under one sky and scale.',
      },
      {
        id: 'blend-boundary',
        action: 'Inspect the centre cross, then use Surface → Blend across one edge.',
        expectation:
          'The persisted channel weights soften continuously rather than substituting another material.',
      },
      {
        id: 'real-tools',
        action: 'Use Paint, Fill site, Clear surface and Undo in the real editor.',
        expectation:
          'The semantic Surface node changes and undo restores it; Ground Cover paint is unaffected.',
      },
      {
        id: 'floorplan-export',
        action: 'Compare 2D, 3D and the current production model export.',
        expectation:
          '2D shows authored colors; inspect the exporter’s actual material-baked GLB separately from the editable Review JSON rather than assuming live/export visual equivalence.',
      },
    ],
    sources: [
      source('Surface schema', 'surface-material/schema.ts'),
      source('Surface paint field', 'surface-material/field.ts'),
      source('Live PBR materials', 'surface-material/materials.ts'),
      source('Surface definition and bake', 'surface-material/definition.ts'),
    ],
    camera: camera([21, 17, 22], [8, 0, 8]),
    stations: [
      {
        id: 'flowered-grass',
        title: '1 · Flowered grass',
        description: 'Red persisted channel; true-scale eight-metre quadrant.',
        camera: camera([3, 6, 3], [3, 0, 3]),
      },
      {
        id: 'road-path',
        title: '2 · Road path',
        description: 'Green persisted channel.',
        camera: camera([13, 6, 3], [13, 0, 3]),
      },
      {
        id: 'desert-ground',
        title: '3 · Desert ground',
        description: 'Blue persisted channel.',
        camera: camera([3, 6, 13], [3, 0, 13]),
      },
      {
        id: 'paved-road',
        title: '4 · Paved road',
        description: 'White persisted channel.',
        camera: camera([13, 6, 13], [13, 0, 13]),
      },
      {
        id: 'blend',
        title: '5 · Blend cross',
        description: 'Equal channel weights reveal feathering without a new renderer.',
        camera: camera([12, 9, 12], [8, 0, 8]),
      },
    ],
    variants: [
      {
        id: 'standard-scale',
        label: '100% texture size',
        description: 'Canonical production texture scale.',
      },
      {
        id: 'fine-scale',
        label: '25% texture size',
        description: 'Smallest accepted pattern scale on the same measured field.',
      },
      {
        id: 'coarse-scale',
        label: '200% texture size',
        description: 'Largest accepted pattern scale on the same measured field.',
      },
    ],
  },
  {
    id: 'ground-cover-brushes',
    version: 1,
    kind: 'gym',
    title: 'Ground Cover brush gym',
    summary:
      'A partially painted, flowered field is the starting state for every real coverage, height and appearance control.',
    featureIds: ['ground-cover-authoring', 'ground-cover-appearance'],
    reviewSteps: [
      {
        id: 'coverage-tools',
        action:
          'Open Environment → Ground Cover; paint, erase and smooth the boundary between full and sparse coverage.',
        expectation:
          'The saved RGBA field changes beneath a live brush cursor and the rendered density follows it.',
      },
      {
        id: 'height-tools',
        action: 'Raise, lower and smooth local grass height with round and square brushes.',
        expectation: 'Blade height changes locally without sculpting the Site terrain.',
      },
      {
        id: 'undo',
        action: 'Make one brush stroke, invoke the editor Undo command, then Redo.',
        expectation: 'The real editor history restores and reapplies the authored paint field.',
      },
      {
        id: 'appearance',
        action:
          'Select the Grass Field node and vary density, blade size, variation, bend, tint, tip brightness, flowers and wind.',
        expectation: 'Each inspector control affects its named live geometry or shading property.',
      },
      {
        id: 'whole-site',
        action: 'Try Fill site, Clear grass and Reset height, including their confirmation UI.',
        expectation:
          'Only the named persisted field is replaced; reset returns to the canonical fixture.',
      },
    ],
    sources: [
      source('Ground Cover schema', 'ground-cover/schema.ts'),
      source('Paint and height panel', 'panel.tsx'),
      source('Paint stroke operations', 'ground-cover/paint-stroke.ts'),
      source('GPU geometry and flowers', 'ground-cover/geometry.ts'),
    ],
    camera: camera([19, 12, 21], [8, 0, 8]),
    stations: [
      {
        id: 'coverage-edge',
        title: '1 · Coverage edge',
        description: 'Paint, erase and smooth this deliberate density transition.',
        camera: camera([10, 5, 10], [8, 0, 8]),
      },
      {
        id: 'height-patch',
        title: '2 · Height patch',
        description: 'Compare lowered, neutral and raised saved height samples.',
        camera: camera([5, 3, 14], [7, 0, 11]),
      },
      {
        id: 'flowers-wind',
        title: '3 · Flowers and wind',
        description: 'Observe all generated flower silhouettes and live blade wind.',
        camera: camera([13, 3, 8], [10, 0.5, 8]),
      },
    ],
    variants: [
      {
        id: 'authored-patches',
        label: 'Authored patches',
        description: 'Canonical mixed-density, mixed-height, flowered field.',
      },
      {
        id: 'low-density',
        label: 'Low density',
        description: 'Real node density reduced to reveal distribution and flower roots.',
      },
      {
        id: 'high-wind',
        label: 'High wind',
        description: 'Real wind strength and influence increased without changing paint.',
      },
    ],
  },
  {
    id: 'grass-obstacles',
    version: 1,
    kind: 'zoo',
    title: 'Ground Cover exclusions',
    summary:
      'A true-scale obstacle field combines a building slab, freestanding solid, pond, broad low dry island, bank and carved river without destructively erasing grass paint.',
    featureIds: [
      'ground-cover-obstacles',
      'ground-cover-appearance',
      'pond-basins',
      'river-terrain',
    ],
    reviewSteps: [
      {
        id: 'solid-exclusion',
        action:
          'Compare grass beneath the slab, beside the freestanding block and in unobstructed paint.',
        expectation:
          'Interiors are excluded; near-solid blades bend or flatten according to the node controls.',
      },
      {
        id: 'water-boundary',
        action: 'Inspect pond water, its dry bank and broad low island, then the river channel.',
        expectation: 'Resolved wet triangles exclude roots while dry terrain remains paintable.',
      },
      {
        id: 'reappearance',
        action:
          'Switch to Drained water, or use the real Water tools to empty/delete water, then undo.',
        expectation: 'Grass returns from unchanged paint where wet exclusion disappears.',
      },
      {
        id: 'terrain',
        action: 'Inspect grass roots along the raised bank and graded channel.',
        expectation: 'Roots sample the persisted/live Site terrain rather than a flat lab plane.',
      },
    ],
    sources: [
      source('Obstacle adapter', 'ground-cover/obstacle-adapter.ts'),
      source('Ground fields and terrain sampling', 'ground-cover/field-context.ts'),
      source('Pond surface resolver', 'pond/geometry.ts'),
      source('River surface resolver', 'river/geometry.ts'),
    ],
    camera: camera([23, 16, 23], [8, 2, 8]),
    stations: [
      {
        id: 'building',
        title: '1 · Building interior',
        description: 'Proper Site → Building → Level → Slab hierarchy.',
        camera: camera([11, 7, 17], [10, 1, 11]),
      },
      {
        id: 'prop',
        title: '2 · Freestanding solid',
        description: 'A procedural block is a floor-placed obstacle with no network asset.',
        camera: camera([13, 4, 6], [11, 1, 8]),
      },
      {
        id: 'pond-island',
        title: '3 · Pond, bank and island',
        description: 'A genuine wet basin surrounds a broad low dry island in one painted grass field.',
        camera: camera([10, 11, 18], [4, 4.4, 11]),
      },
      {
        id: 'river',
        title: '4 · Carved river',
        description: 'Exclusion follows the actual graded and resolved water surface.',
        camera: camera([17, 6, 9], [9, 2, 4]),
      },
    ],
    variants: [
      { id: 'wet-water', label: 'Wet water', description: 'Canonical pond and river exclusions.' },
      {
        id: 'drained-pond',
        label: 'Drained pond',
        description: 'Retains the pond node with a null level so paint can reappear; this fixture has no Pond props.',
      },
      {
        id: 'water-removed',
        label: 'Water removed',
        description: 'Removes both authored water nodes and restores source terrain.',
      },
    ],
  },
  {
    id: 'pond-basins',
    version: 1,
    kind: 'gym',
    title: 'Pond basin and level gym',
    summary:
      'The production basin resolver receives an established deterministic 4 m × 4 m sample span, never a decorative water plane.',
    featureIds: ['pond-basins'],
    reviewSteps: [
      {
        id: 'select',
        action: 'Use Environment → Water → Pond and click inside the depression.',
        expectation:
          'The real resolver selects the connected terrain basin and reports bottom, spill and maximum depth.',
      },
      {
        id: 'levels',
        action: 'Raise and lower by the displayed step; then Fill to spill and Empty.',
        expectation: 'Levels stay on the terrain-derived ladder and never exceed the spill level.',
      },
      {
        id: 'connected',
        action: 'Open Connected seeds and select either authored pond.',
        expectation:
          'Sibling seeds in one basin merge into one effective body without duplicate rendering.',
      },
      {
        id: 'dry-state',
        action: 'Open Dry retained, fill the basin, empty it and undo.',
        expectation:
          'A dry pond retains its semantic node and props; undo uses normal scene history.',
      },
    ],
    sources: [
      source('Basin analysis', 'pond/basin.ts'),
      source('Level and merge actions', 'pond/actions.ts'),
      source('Pond tool', 'pond/tool.tsx'),
      source('Pond schema', 'pond/schema.ts'),
    ],
    camera: camera([7, 12, 8], [2, 4, 2]),
    stations: [
      {
        id: 'basin',
        title: '1 · Known bowl',
        description: 'Five-by-five one-metre terrain samples with a contained zero-metre bottom.',
        camera: camera([7, 12, 8], [2, 4, 2]),
      },
      {
        id: 'spill',
        title: '2 · Spill boundary',
        description: 'The lowest rim sample sets the actual four-metre spill level.',
        camera: camera([6, 11, -5], [2, 4, 1]),
      },
    ],
    variants: [
      {
        id: 'filled',
        label: 'Filled to spill',
        description: 'Canonical single pond at the resolver’s spill level.',
      },
      {
        id: 'stepped',
        label: 'Stepped level',
        description: 'Single pond on a valid intermediate basin level.',
      },
      {
        id: 'dry-retained',
        label: 'Dry retained',
        description: 'Null water level with retained authored props.',
      },
      {
        id: 'connected-seeds',
        label: 'Connected seeds',
        description: 'Two sibling pond records resolving to one connected basin.',
      },
    ],
  },
  {
    id: 'pond-life',
    version: 1,
    kind: 'zoo',
    title: 'Pond water and life',
    summary:
      'True-scale variants keep one proven basin and camera fixed while comparing every water quality, both banks, lilies and koi.',
    featureIds: ['pond-appearance', 'pond-life'],
    reviewSteps: [
      {
        id: 'quality',
        action: 'Cycle the four variants under the same camera and Environment sky.',
        expectation: 'Pure, clear, deep and swampy use their production appearance parameters.',
      },
      {
        id: 'shore',
        action: 'Compare Soft with each Rocky variant.',
        expectation:
          'Soft water fades against real terrain; deterministic stones follow the resolved shoreline.',
      },
      {
        id: 'props',
        action: 'Use Lilies, Koi, Remove and Clear props on the actual wet footprint.',
        expectation:
          'Placement respects shoreline and koi depth; authored prop records change through scene actions.',
      },
      {
        id: 'motion',
        action: 'Pause and resume rendering with koi visible.',
        expectation:
          'Koi stop while paused; this is independent of the distant-bird ambientMotion preference.',
      },
    ],
    sources: [
      source('Water appearance', 'pond/appearance.ts'),
      source('Shoreline rocks', 'pond/shoreline.ts'),
      source('Prop fit rules', 'pond/props.ts'),
      source('Koi motion', 'pond/koi-motion.ts'),
    ],
    camera: camera([7, 12, 8], [2, 4, 2]),
    stations: [
      {
        id: 'shoreline',
        title: '1 · Shoreline',
        description: 'Inspect the real terrain intersection and optional stones from above the rim.',
        camera: camera([6, 10, 7], [2, 4, 2]),
      },
      {
        id: 'lilies',
        title: '2 · Lilies',
        description: 'Surface props must fit entirely inside the wet outline.',
        camera: camera([5, 10, 5], [2, 4, 2]),
      },
      {
        id: 'koi',
        title: '3 · Koi',
        description: 'Animated props require at least 0.20 m of resolved depth.',
        camera: camera([5, 10, 5.5], [2.2, 3.4, 2.1]),
      },
    ],
    variants: [
      {
        id: 'pure-soft',
        label: 'Pure · soft bank',
        description: 'Bright pale water and a soft terrain transition.',
      },
      {
        id: 'clear-rocky',
        label: 'Clear · rocky bank',
        description: 'Natural blue-green water with deterministic shore stones.',
      },
      {
        id: 'deep-life',
        label: 'Deep · lilies and koi',
        description: 'Dark depth treatment with both current prop kinds.',
      },
      {
        id: 'swampy-life',
        label: 'Swampy · rocky life',
        description: 'Muted green-brown water, stones, lilies and koi.',
      },
    ],
  },
  {
    id: 'river-authoring',
    version: 1,
    kind: 'gym',
    title: 'River authoring gym',
    summary:
      'A real graded river and untouched source metadata support draw, edit, regrade, cancel, undo and complete terrain restoration exercises.',
    featureIds: ['river-authoring', 'river-terrain', 'river-flow'],
    reviewSteps: [
      {
        id: 'draw-cancel',
        action:
          'Start Draw new river, place points, Remove last point, then Cancel or press Escape.',
        expectation:
          'The live channel preview clears and the saved terrain/history remain unchanged.',
      },
      {
        id: 'draw-commit',
        action: 'Draw a new path with at least two points and Finish; undo and redo once.',
        expectation: 'River and channel commit together as one real editor history step.',
      },
      {
        id: 'edit',
        action: 'Select the authored river, choose Edit path and drag a control point.',
        expectation:
          'The existing water surface moves with the regraded channel; no duplicate preview remains.',
      },
      {
        id: 'regrade',
        action: 'Change width and depth repeatedly, then reverse direction and vary speed.',
        expectation:
          'Excavation always rebuilds from source terrain; flow-only changes do not reshape it.',
      },
      {
        id: 'restore',
        action: 'Delete the river, then undo.',
        expectation:
          'Deletion restores its terrain footprint while undo recovers the exact graded river state.',
      },
    ],
    sources: [
      source('River actions', 'river/actions.ts'),
      source('River terrain grading', 'river/terrain.ts'),
      source('River authoring tool', 'river/tool.tsx'),
      source('River controls', 'river/controls.tsx'),
    ],
    camera: camera([22, 13, 20], [8, 1, 8]),
    stations: [
      {
        id: 'source',
        title: '1 · Source',
        description: 'Start cap and first editable control point.',
        camera: camera([7, 5, 7], [2, 1, 2]),
      },
      {
        id: 'bend',
        title: '2 · Bend',
        description: 'Curved centerline shares samples with terrain grading and water geometry.',
        camera: camera([13, 6, 12], [8, 0, 7]),
      },
      {
        id: 'outlet',
        title: '3 · Outlet',
        description: 'Rounded end remains inside this Site.',
        camera: camera([18, 5, 18], [14, 0, 13]),
      },
    ],
    variants: [
      {
        id: 'authored',
        label: 'Authored river',
        description: 'Canonical 4 m × 1 m curved forward-flow river.',
      },
      {
        id: 'narrow-shallow',
        label: 'Narrow and shallow',
        description: 'Minimum-oriented comparison using real 1.5 m width and 0.25 m depth.',
      },
      {
        id: 'wide-deep',
        label: 'Wide and deep',
        description: '10 m width and 3 m depth rebuilt from the same source field.',
      },
      {
        id: 'reverse-fast',
        label: 'Reverse fast flow',
        description: 'Same channel with reversed 2.4× visual flow.',
      },
    ],
  },
  {
    id: 'river-endpoints',
    version: 1,
    kind: 'museum',
    title: 'River endpoints and landscape continuation',
    summary:
      'Endpoint variants explain rounded caps, mountain sources, conditional sea outlets, bridge continuation and why visible current is not hydraulic simulation.',
    featureIds: ['river-flow', 'river-terrain', 'surroundings-regional'],
    reviewSteps: [
      {
        id: 'rounded',
        action: 'Open Inland rounded and inspect both ends.',
        expectation:
          'Compact rounded caps remain authored inside the Site without landscape connection.',
      },
      {
        id: 'mountain',
        action: 'Open Coastal mountain → rounded.',
        expectation:
          'The source extends to the Site boundary and regional presentation continues it toward high ground.',
      },
      {
        id: 'sea',
        action: 'Open Coastal mountain → sea and inspect the outlet and bridge station.',
        expectation:
          'The proven coastal seed permits sea connection; surroundings stay enabled and continue water beyond the Site.',
      },
      {
        id: 'condition',
        action: 'Return to Inland rounded and try choosing Sea in the real controls.',
        expectation:
          'The control refuses a seed whose deriveLandscapeRegion result has no coast rather than manufacturing ocean water.',
      },
      {
        id: 'flow-note',
        action: 'Reverse current without changing the endpoint geometry.',
        expectation:
          'Only visible flow changes; Environment does not claim hydraulic elevation or drainage simulation.',
      },
    ],
    sources: [
      source('Endpoint controls and coast gate', 'river/controls.tsx'),
      source('Shared river path sampling', 'river/terrain.ts'),
      source('Landscape continuation', 'surroundings/river-landscape.ts'),
      source('Bridge derivation', 'surroundings/river-bridges.ts'),
    ],
    camera: camera([28, 18, 28], [8, 1, 8]),
    stations: [
      {
        id: 'source',
        title: '1 · Source contract',
        description: 'Rounded caps stay internal; mountain sources reach the south boundary.',
        camera: camera([8, 6, 7], [2, 1, 0]),
      },
      {
        id: 'bridge',
        title: '2 · Source continuation bridge',
        description:
          'The fixed primary frontage crosses the production mountain continuation outside the Site.',
        camera: camera([17, 12, 9], [-0.7, 0.5, -7.85]),
      },
      {
        id: 'outlet',
        title: '3 · Sea outlet and bridge',
        description:
          'The coastal rounded-to-sea variant continues to a real bridge beyond the east frontage.',
        camera: camera([45, 18, 55], [23.85, 0.5, 35]),
      },
    ],
    variants: [
      {
        id: 'inland-rounded',
        label: 'Inland rounded → rounded',
        description: 'Inland seed with both compact caps and no coast.',
      },
      {
        id: 'coastal-mountain-rounded',
        label: 'Coastal mountain → rounded',
        description: 'Boundary-connected source with an internal outlet.',
      },
      {
        id: 'coastal-mountain-sea',
        label: 'Coastal mountain → sea',
        description: 'Both endpoint connections under the proven pascal-suburbs coast.',
      },
      {
        id: 'coastal-rounded-sea',
        label: 'Coastal rounded → sea',
        description: 'Internal source and boundary-connected sea outlet.',
      },
    ],
  },
  {
    id: 'regional-surroundings',
    version: 1,
    kind: 'museum',
    title: 'Regional surroundings',
    summary:
      'A concave Site combines authored river continuation, boundary clipping, frontage policies and seeded presentation context while the Site remains editable.',
    featureIds: ['surroundings-regional', 'surface-materials', 'river-terrain', 'river-flow'],
    reviewSteps: [
      {
        id: 'boundary',
        action: 'Follow the property boundary and the narrow transition skirt.',
        expectation:
          'Exterior terrain clips to the concave polygon instead of dropping whole intersecting cells.',
      },
      {
        id: 'frontages',
        action: 'Use the camera-aligned edge map to compare No road, Secondary and Primary edges.',
        expectation:
          'Roads respond to per-edge separator settings without moving the Site framing.',
      },
      {
        id: 'access-style',
        action:
          'Inspect the station whose sidecar has driveway, pedestrian access and explicit roadStyleId values.',
        expectation:
          'The versioned configuration retains production-compatible access/style metadata even where the current panel edits separators only.',
      },
      {
        id: 'context',
        action:
          'Inspect roads, homes, trees, shared shadows and authored river continuation; edit the Surface or Site.',
        expectation:
          'Presentation context is derived from the semantic Site and River while both authored nodes and the painted transition remain editable.',
      },
    ],
    sources: [
      source('Surroundings composition', 'surroundings/layer.tsx'),
      source('Boundary/frontage model', 'surroundings/frontages.ts'),
      source('Runtime roads', 'surroundings/runtime-road-graph.ts'),
      source('Neighborhood shadows', 'surroundings/neighborhood-shadows.tsx'),
      source('River continuation', 'surroundings/river-landscape.ts'),
    ],
    camera: camera([33, 24, 34], [12, 1, 12]),
    stations: [
      {
        id: 'boundary',
        title: '1 · Concave Site boundary',
        description: 'Property clipping and painted Surface feathering meet here.',
        camera: camera([17, 8, 24], [11, 0, 14]),
      },
      {
        id: 'frontages',
        title: '2 · Mixed frontage',
        description: 'No-road, secondary and primary edges share one sidecar.',
        camera: camera([29, 13, 12], [16, 0, 8]),
      },
      {
        id: 'river',
        title: '3 · Authored river continuation',
        description:
          'Mountain and sea endpoints continue across the regional terrain and road graph.',
        camera: camera([44, 15, 29], [30, 1, 15]),
      },
      {
        id: 'neighborhood',
        title: '4 · Houses, trees and shadows',
        description: 'Seeded regional context uses production instancing and terrain sampling.',
        camera: camera([42, 15, 28], [22, 2, 17]),
      },
      {
        id: 'transition',
        title: '5 · Surface transition',
        description: 'Only painted Surface material feathers six metres beyond the boundary.',
        camera: camera([10, 7, 31], [10, 0, 20]),
      },
    ],
    variants: [
      {
        id: 'mixed-frontages',
        label: 'Mixed frontages',
        description: 'Canonical no-road, secondary and primary edges with access/style metadata.',
      },
      {
        id: 'no-roads',
        label: 'No property roads',
        description: 'Every Site edge uses no-road while regional distant context remains.',
      },
      {
        id: 'primary-access',
        label: 'Primary with access',
        description: 'Primary frontage plus driveway and pedestrian metadata on adjacent edges.',
      },
    ],
  },
  {
    id: 'natural-presets',
    version: 1,
    kind: 'zoo',
    title: 'Natural surroundings',
    summary:
      'True-scale preset variants compare Open Meadow and Woodland Edge from the same Site and seed, including birds and intentional built-context suppression.',
    featureIds: ['surroundings-natural', 'surroundings-motion'],
    reviewSteps: [
      {
        id: 'compare',
        action: 'Switch between Open Meadow and Woodland Edge without changing the seed or camera.',
        expectation:
          'Meadow stays open and flower-rich; woodland has dense nearby and distant tree layers.',
      },
      {
        id: 'populations',
        action:
          'Visit low vegetation, flowers, detailed trees, distant forest and clearing stations.',
        expectation:
          'Every population stays at production world scale and within the preset budgets.',
      },
      {
        id: 'absence',
        action: 'Search the natural variants for roads, homes, regional rivers and coast.',
        expectation:
          'They are intentionally absent because natural presets force inland context and suppress built presentation.',
      },
      {
        id: 'birds',
        action: 'Toggle Show distant birds and Animate distant birds; pause the viewer.',
        expectation:
          'Visibility and ambient motion are separate; bird flight also stops while rendering is paused.',
      },
    ],
    sources: [
      source('Preset policies', 'surroundings/presets.ts'),
      source('Natural vegetation', 'surroundings/natural-vegetation.tsx'),
      source('Natural grass', 'surroundings/natural-grass.tsx'),
      source('Distant birds', 'surroundings/distant-birds.tsx'),
    ],
    camera: camera([36, 20, 37], [12, 1, 12]),
    stations: [
      {
        id: 'clearing',
        title: '1 · Protected clearing',
        description: 'Natural vegetation respects the editable Site and water exclusions.',
        camera: camera([23, 11, 24], [12, 0, 12]),
      },
      {
        id: 'low-cover',
        title: '2 · Grass and flowers',
        description: 'Production GPU blades and flower accents retain metre scale.',
        camera: camera([28, 5, 17], [20, 0, 15]),
      },
      {
        id: 'forest',
        title: '3 · Detailed to distant trees',
        description: 'Nearby EZ Trees transition to shared distant atlases.',
        camera: camera([42, 15, 35], [28, 5, 25]),
      },
      {
        id: 'birds',
        title: '4 · Distant birds',
        description: 'Visibility, ambient motion and viewer pause are separate controls.',
        camera: camera([20, 18, 30], [12, 9, 12]),
      },
    ],
    variants: [
      {
        id: 'open-meadow',
        label: 'Open Meadow',
        description: 'Flower-rich low cover, sparse copses and a long horizon.',
      },
      {
        id: 'woodland-edge',
        label: 'Woodland Edge',
        description: 'Dense layered woodland and shaded understory.',
      },
      {
        id: 'meadow-still',
        label: 'Open Meadow · birds still',
        description: 'Same true-scale meadow with ambient bird animation disabled.',
      },
    ],
  },
  {
    id: 'night-landmarks',
    version: 1,
    kind: 'museum',
    title: 'Regional landmarks after dark',
    summary:
      'The fixed environment-lab-night-2295 coastal seed frames day/night windows, streetlights, gas and supermarket lots, a parked car, skyline, boulders, fields and a pause-aware lighthouse.',
    featureIds: ['surroundings-regional', 'surroundings-motion', 'atmosphere-sky'],
    reviewSteps: [
      {
        id: 'day-night',
        action: 'Compare Day and Night at the same bookmarks.',
        expectation:
          'One solar night factor fades windows, streetlights and the lighthouse without rebuilding regional geometry.',
      },
      {
        id: 'landmarks',
        action: 'Visit the commerce, distant landscape and lighthouse stations.',
        expectation:
          'The fixed plan supplies gas station, supermarket, parked cars, fields, skyline, boulders and the coastal landmark as presentation context rather than editable nodes.',
      },
      {
        id: 'pause',
        action: 'At Night, pause and resume the viewer while watching the beacon and birds.',
        expectation:
          'The beacon and bird flight stop on viewer pause; static night emissive state remains visible.',
      },
      {
        id: 'sky-off',
        action: 'Open Sky disabled.',
        expectation:
          'Artificial night factor becomes zero when Environment Sky is disabled; it does not infer night from the theme.',
      },
    ],
    sources: [
      source('Landscape region derivation', 'surroundings/landscape-region.ts'),
      source('Third-ring plan', 'surroundings/third-ring.ts'),
      source('Night lighting', 'surroundings/night-lighting.ts'),
      source('Lighthouse beacon', 'surroundings/lighthouse-beacon.tsx'),
    ],
    camera: camera([182.536, 121.559, 218.666], [20.678, 5.022, 56.808]),
    stations: [
      {
        id: 'commerce',
        title: '1 · Gas station and supermarket',
        description:
          'One framed production streetscape contains both viable lots and its parked-car context.',
        camera: camera([182.536, 121.559, 218.666], [20.678, 5.022, 56.808]),
      },
      {
        id: 'distant-landscape',
        title: '2 · Fields, skyline and boulders',
        description:
          'One production view frames a woodland field together with real skyline and boulder instances.',
        camera: camera([45.302, 182.362, 494.431], [-145.826, 44.75, 303.303]),
      },
      {
        id: 'lighthouse',
        title: '3 · Coastal lighthouse',
        description:
          'The 24.0 m landmark carries a rotating 20-second beacon with solar and pause gating.',
        camera: camera([140.514, 40.286, 363.951], [111.084, 16.153, 334.521]),
      },
    ],
    variants: [
      { id: 'day', label: 'Day', description: 'Canonical coastal regional scene at 14:00.' },
      {
        id: 'night',
        label: 'Night',
        description: 'Same seed and geometry at midnight with moonlight.',
      },
      {
        id: 'sky-disabled',
        label: 'Sky disabled',
        description: 'Same night settings with Environment Sky disabled.',
      },
    ],
  },
  {
    id: 'sky-and-sun',
    version: 1,
    kind: 'museum',
    title: 'Sky, sun and atmospheric optics',
    summary:
      'Named variants expose both providers, every shipped sky preset, time/manual sun, scattering, clouds, fog, moon, exposure and diagnostics.',
    featureIds: ['atmosphere-sky'],
    reviewSteps: [
      {
        id: 'providers',
        action: 'Compare Procedural noon with Gradient.',
        expectation:
          'Both use the installed Atmosphere presentation path; gradient is not a standalone lab backdrop.',
      },
      {
        id: 'presets',
        action: 'Visit Clear, Cloudy, Golden hour, Blue hour and Moonlit variants.',
        expectation: 'Each variant applies the exact real preset state under a fixed camera.',
      },
      {
        id: 'manual',
        action:
          'Open Manual sun; compare the non-geolocated display clock, elevation, azimuth and north offset in the real controls.',
        expectation:
          'Manual and time modes drive the same solar lighting state; changing settings pauses time playback.',
      },
      {
        id: 'advanced',
        action: 'Inspect Physical light, Clouds & fog and Debug view controls.',
        expectation:
          'Rayleigh/Mie/turbidity, cloud parameters, fog, moon phase, exposure and diagnostics remain discoverable without fake shaders.',
      },
      {
        id: 'playback',
        action: 'Start day playback and cloud motion, then pause the viewer.',
        expectation:
          'The panel’s playback flags remain honest: sky time/cloud advancement is not claimed to share every system’s viewer-pause contract.',
      },
    ],
    sources: [
      source('Sky settings and presets', 'atmosphere/settings.ts'),
      source('Sky provider', 'atmosphere/sky-provider.ts'),
      source('Atmosphere controls', 'atmosphere/controls.tsx'),
    ],
    camera: camera([25, 12, 25], [8, 4, 8]),
    stations: [
      {
        id: 'horizon',
        title: '1 · Horizon and fog',
        description: 'Background, reflection and fog share normalized world directions.',
        camera: camera([18, 4, 18], [8, 4, 8]),
      },
      {
        id: 'sun',
        title: '2 · Sun and shadows',
        description: 'One solar state drives the celestial disc and scene lights.',
        camera: camera([22, 13, 16], [8, 1, 8]),
      },
      {
        id: 'clouds',
        title: '3 · Clouds and diagnostics',
        description: 'Real cloud radiance and atmospheric debug views.',
        camera: camera([18, 8, 18], [8, 11, 8]),
      },
    ],
    variants: [
      {
        id: 'procedural-noon',
        label: 'Clear day · procedural',
        description: 'Canonical clear preset at 14:00.',
      },
      {
        id: 'gradient',
        label: 'Gradient provider',
        description: 'Gradient sky with the same scene and solar time.',
      },
      { id: 'cloudy', label: 'Cloudy', description: 'Exact shipped Cloudy preset.' },
      { id: 'golden-hour', label: 'Golden hour', description: 'Exact shipped Golden hour preset.' },
      { id: 'blue-hour', label: 'Blue hour', description: 'Exact shipped Blue hour preset.' },
      {
        id: 'moonlit',
        label: 'Moonlit',
        description: 'Exact shipped Moonlit preset with visible moon controls.',
      },
      {
        id: 'manual-sun',
        label: 'Manual sun',
        description: 'Manual 18° elevation and 135° azimuth.',
      },
      {
        id: 'luminance-debug',
        label: 'Luminance debug',
        description: 'Cloud, fog and log-luminance diagnostic settings.',
      },
    ],
  },
  {
    id: 'weather',
    version: 1,
    kind: 'gym',
    title: 'Weather gym',
    summary:
      'Rain, snow, wind and storm run over real authored and presentation meshes, with explicit audio consent and honest motion/export limits.',
    featureIds: [
      'atmosphere-weather',
      'surface-materials',
      'pond-appearance',
      'river-flow',
      'surroundings-regional',
    ],
    reviewSteps: [
      {
        id: 'presets',
        action: 'Compare Clear, Light rain, Rain, Snow, Wind and Storm variants.',
        expectation:
          'Precipitation, cloud/fog response and wind use the real sidecar settings rather than exhibit-only particles.',
      },
      {
        id: 'surfaces',
        action:
          'Inspect Site, Surface, structure, pond/river banks and surroundings in Rain, Snow and Mixed.',
        expectation:
          'Eligible real meshes receive immediate wetness or upward-facing snow cover; effects are not accumulation or runoff simulation.',
      },
      {
        id: 'storm',
        action:
          'Open Storm and watch lightning with reduced motion off, then pause or hide the page.',
        expectation:
          'Lightning and weather visuals respect their actual visibility, reduced-motion and viewer-pause gates.',
      },
      {
        id: 'audio',
        action:
          'Explicitly enable thunder in the real panel after a user gesture, then reset the case.',
        expectation:
          'Audio never starts automatically; reset closes the session and returns consent and thunderAudio to off.',
      },
      {
        id: 'export',
        action: 'Review a model export while weather is active.',
        expectation:
          'Weather overlays are presentation meshes tagged for stripping, not authored model geometry.',
      },
    ],
    sources: [
      source('Weather particles', 'atmosphere/weather.tsx'),
      source('Wet and snow overlays', 'atmosphere/weather-surfaces.tsx'),
      source('Thunder session', 'atmosphere/weather-audio.ts'),
      source('Reduced-motion preference', 'atmosphere/weather-preferences.ts'),
    ],
    camera: camera([25, 14, 24], [8, 2, 8]),
    stations: [
      {
        id: 'eligible-surfaces',
        title: '1 · Eligible surfaces',
        description: 'Editable and presentation meshes share the production overlay path.',
        camera: camera([18, 8, 18], [8, 1, 8]),
      },
      {
        id: 'precipitation',
        title: '2 · Precipitation volume',
        description: 'Rain follows the camera; snow uses stable world cells.',
        camera: camera([15, 7, 15], [8, 5, 8]),
      },
      {
        id: 'lightning',
        title: '3 · Lightning and thunder',
        description:
          'Visual storm and gesture-gated synthesized audio have separate lifecycle rules.',
        camera: camera([22, 10, 18], [8, 8, 8]),
      },
    ],
    variants: [
      { id: 'clear', label: 'Clear', description: 'Canonical dry reset state.' },
      { id: 'light-rain', label: 'Light rain', description: '0.35 rain with ordinary wind.' },
      { id: 'rain', label: 'Rain', description: '0.70 rain and stronger wind.' },
      { id: 'snow', label: 'Snow', description: '0.65 snow and no rain.' },
      {
        id: 'wind',
        label: 'Wind',
        description: 'Dry maximum wind to isolate vegetation response.',
      },
      {
        id: 'storm',
        label: 'Storm',
        description: 'Maximum rain, strong wind and lightning; audio remains off.',
      },
      {
        id: 'mixed',
        label: 'Mixed rain and snow',
        description: 'Supported custom combination over the same meshes.',
      },
    ],
  },
  {
    id: 'portability',
    version: 1,
    kind: 'museum',
    title: 'Semantic graph, sidecar and export',
    summary:
      'One Site owns all four authored Environment node kinds while a separate versioned sidecar drives surroundings and atmosphere.',
    featureIds: [
      'portability',
      'surface-materials',
      'ground-cover-appearance',
      'pond-appearance',
      'river-terrain',
    ],
    reviewSteps: [
      {
        id: 'semantic',
        action: 'Inspect or download the live SceneGraph.',
        expectation:
          'Site, Ground Cover, Surface, Pond and River remain semantic nodes with serializable paint/terrain data and the installed plugin id.',
      },
      {
        id: 'sidecar',
        action: 'Compare the downloaded Environment configuration with the graph.',
        expectation:
          'Surroundings, sky and weather are versioned presentation state; thunder consent, playback, brushes and authoring drafts are absent.',
      },
      {
        id: 'bake',
        action: 'Run the current production model exporter and inspect its GLB beside the live scene.',
        expectation:
          'The exporter currently emits material-baked static geometry. Inspect its actual inclusions and limits; live motion or visual equivalence is not promised, and the separate Review JSON retains the editable graph and Environment configuration.',
      },
      {
        id: 'presentation',
        action: 'Open Presentation hidden.',
        expectation:
          'Sidecar visibility hides surroundings/sky without deleting any semantic node.',
      },
      {
        id: 'review-record',
        action: 'Download the lab review record after a live edit.',
        expectation:
          'The host record includes current graph, sidecar, camera/render profile and notes; it is review evidence, not an accepted baseline.',
      },
    ],
    sources: [
      source('Plugin definitions', 'index.ts'),
      source('Versioned presentation sidecar', 'presentation-configuration.ts'),
      source('Ground Cover bake', 'ground-cover/bake-geometry.ts'),
      source('Water static renderer', 'river/static-renderer.tsx'),
    ],
    camera: camera([23, 15, 23], [8, 2, 8]),
    stations: [
      {
        id: 'authored',
        title: '1 · Authored nodes',
        description: 'All four node kinds are direct Site children with fixed semantic IDs.',
        camera: camera([18, 9, 18], [8, 1, 8]),
      },
      {
        id: 'presentation',
        title: '2 · Presentation context',
        description: 'Generated surroundings and atmosphere never masquerade as graph nodes.',
        camera: camera([31, 15, 31], [8, 2, 8]),
      },
      {
        id: 'export',
        title: '3 · Production export result',
        description: 'Inspect the current material-baked GLB without treating its encoding as a stable contract.',
        camera: camera([18, 12, 15], [8, 2, 8]),
      },
    ],
    variants: [
      {
        id: 'live-presentation',
        label: 'Live presentation',
        description: 'Canonical maximal sidecar plus all four semantic node kinds.',
      },
      {
        id: 'presentation-hidden',
        label: 'Presentation hidden',
        description: 'Same graph with surroundings and sky visibility disabled.',
      },
      {
        id: 'dry-authored-water',
        label: 'Dry authored pond',
        description: 'Same portable graph with the pond retained but empty.',
      },
    ],
  },
  {
    id: 'living-landscape',
    version: 1,
    kind: 'museum',
    title: 'Living landscape',
    summary:
      'A compact combined museum connects a concave/sloped Site, painted Surface, flowered grass, a genuine basin with koi and a broad low island, rocky curved river, regional context, sky, weather and night.',
    featureIds: [
      'combined-landscape',
      'surface-materials',
      'ground-cover-appearance',
      'ground-cover-obstacles',
      'pond-basins',
      'pond-life',
      'river-terrain',
      'river-flow',
      'surroundings-regional',
      'surroundings-motion',
      'atmosphere-sky',
      'atmosphere-weather',
    ],
    reviewSteps: [
      {
        id: 'site',
        action: 'Start at Authored Site and follow the terrain and Surface boundary.',
        expectation:
          'The graph stays editable and the presentation transition follows its actual polygon and paint.',
      },
      {
        id: 'water',
        action: 'Jump to Pond and River, then inspect nearby grass.',
        expectation:
          'Pond uses a resolved basin, river uses graded source metadata, and only wet footprints exclude painted grass.',
      },
      {
        id: 'context',
        action: 'Jump beyond the boundary to the regional road/water/vegetation station.',
        expectation:
          'Derived context consumes the same Site, river, Surface and sidecar without adding semantic nodes.',
      },
      {
        id: 'weather-night',
        action: 'Compare Daylight, Storm and Night variants at fixed bookmarks.',
        expectation:
          'Atmosphere and weather alter the same production scene; audio remains off and motion contracts remain system-specific.',
      },
      {
        id: 'reset',
        action: 'Edit paint or water with real tools, change a sidecar control, then reset.',
        expectation:
          'The host restores graph, configuration, camera and plugin session controls without crossing into another scratch case.',
      },
    ],
    sources: [
      source('Plugin presentation composition', 'presentation-runtime.tsx'),
      source('Ground Cover field context', 'ground-cover/field-context.ts'),
      source('River landscape bridge', 'surroundings/river-landscape.ts'),
      source('Atmosphere layer', 'atmosphere/layer.tsx'),
    ],
    camera: camera([39, 24, 38], [15, 3, 14]),
    stations: [
      {
        id: 'site',
        title: '1 · Authored Site',
        description:
          'Concave boundary, sloped terrain, painted material and proper building hierarchy.',
        camera: camera([26, 13, 27], [13, 2, 13]),
      },
      {
        id: 'pond',
        title: '2 · Basin, koi and island',
        description: 'A broad low dry island and viable pond life sit inside a genuine surrounding wet depression.',
        camera: camera([14, 16, 25], [7, 4.5, 18]),
      },
      {
        id: 'river',
        title: '3 · Rocky river',
        description: 'Curved channel, source baseline and visual current.',
        camera: camera([30, 10, 16], [23, 2, 9]),
      },
      {
        id: 'boundary',
        title: '4 · Regional transition',
        description:
          'Road, Surface feather, terrain, water and vegetation meet at the property edge.',
        camera: camera([37, 15, 27], [25, 2, 18]),
      },
      {
        id: 'sky',
        title: '5 · Atmosphere and weather',
        description: 'Shared lighting, fog, precipitation surfaces and night response.',
        camera: camera([32, 17, 31], [15, 8, 14]),
      },
    ],
    variants: [
      {
        id: 'daylight',
        label: 'Daylight',
        description: 'Canonical clear afternoon combined scene.',
      },
      {
        id: 'storm',
        label: 'Storm',
        description: 'Rain, strong wind and lightning over every eligible family; thunder off.',
      },
      {
        id: 'night',
        label: 'Night',
        description: 'Moonlit regional scene with night landmarks and still-safe audio.',
      },
      {
        id: 'dry-pond',
        label: 'Dry pond',
        description: 'Retains pond life records while exposing grass reappearance on dry terrain.',
      },
    ],
  },
] as const satisfies readonly EnvironmentLabCase[]

export function getEnvironmentLabCase(id: string): EnvironmentLabCase | undefined {
  return ENVIRONMENT_LAB_CASES.find((entry) => entry.id === id)
}
