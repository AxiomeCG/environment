# Pascal Environment

`@pascal-app/plugin-environment` is a standalone Pascal plugin for terrain-dependent environment creation.

## Current state

Environment started as a transfer of Nature's GPU grass prototype. It now contains
five implemented families, with two different lifecycles. This is a source map,
not a claim that every path is validated or available in a published Pascal release.

| Family | Authoritative inputs | Derived output and lifetime |
|---|---|---|
| Ground Cover | `environment:ground-cover`: saved paint/height maps and blade parameters; reads Site Terrain and obstacles | GPU grass, a floorplan projection, and a static bake builder with Pascal live replacement |
| Surface | `environment:surface-material`: saved material-blend paint map and texture size; reads Site Terrain | Terrain-draped PBR ground, a floorplan projection, and a bake builder with Pascal live replacement |
| Water | `environment:pond` and `environment:river`: saved water parameters and Site terrain; rivers also grade the authored field | Terrain-clipped water, optional shore rocks, pond koi, floorplan projections, and portable bake builders |
| Surroundings | Site data plus project-local seed, preset, and frontage settings | Exterior terrain, roads, houses, dense meadow/woodland vegetation, and coastal/river water; presentation-only, with explicit opt-in finite GLB/USDZ export |
| Atmosphere | Project-local sky and weather settings | Sky radiance, lighting, reflections, fog, rain, world-anchored snow, surface wetness/snow cover, and lightning/thunder; no authored node |

Ground Cover, Surface, Pond, and River are registered as nodes in
[`src/index.ts`](./src/index.ts). Sky and surroundings configuration is stored
per project in a versioned browser sidecar, outside the semantic scene graph.
Brush controls remain transient. Painted results and authored water parameters
belong to nodes, not the presentation sidecar. Surroundings' sea and rivers
remain separate, presentation-only water.

Ground Cover coverage/color/height painting, Surface painting, pond basin and
prop editing, and river drafting/control-point editing have native 2D tools in
both default and expert modes. Activating a tool preserves the current 2D, 3D,
or Split view. Split panes share gesture ownership; cancelled previews do not
persist, and a river path edit plus its terrain grading is one undoable change.

The plugin ID is `pascal:environment`. `GrassFieldNode` retains its original name;
`GroundCoverNode` is an exported alias, not another node kind.

## Who owns what

- **Terrain / Pascal core:** the authored Site heightfield and terrain operations.
  Environment reads it through `terrainFieldOf` and `surfaceHeightAt`; exterior
  terrain generation does not replace the authored field.
  Authored rivers update it through native live terrain and scene transactions.
- **Environment:** painted layers, authored water, distribution, exterior composition,
  and the sky provider and controls. Rendered blades and generated neighboring
  objects are derived output, not individually saved Pascal nodes.
- **Nature:** individual vegetation and its procedural generation, per the
  [domain decision](./docs/adr/0001-separate-environment-from-nature.md).
  This intended separation is not a completed provider integration: Surroundings
  currently constructs EZ-Tree prototypes directly in
  [`neighborhood-trees.tsx`](./src/surroundings/neighborhood-trees.tsx).
- **Host editor / viewer:** mounts the plugin UI and presentation layers, owns
  selection and export infrastructure, and installs/restores scene atmosphere and
  fallback ground through viewer adapters.

Surroundings also uses local Streetscape-derived code under
[`src/surroundings/streetscape`](./src/surroundings/streetscape), not a live
inter-plugin road provider. Keep implementation facts distinct from intended
cross-plugin ownership.

## Where to start reading

Read the module for your current question, not the whole repository.

| Question | Entry point |
|---|---|
| What does the plugin expose without loading presentation runtime? | [`src/index.ts`](./src/index.ts), [`presentation.ts`](./src/presentation.ts), and [`presentation-configuration.ts`](./src/presentation-configuration.ts) |
| What grass data is saved, and how does it reach each representation? | [`ground-cover/schema.ts`](./src/ground-cover/schema.ts), then [`definition.ts`](./src/ground-cover/definition.ts) |
| Where does a grass root get its height? | [`field-context.ts`](./src/ground-cover/field-context.ts) → [`scatter.ts`](./src/ground-cover/scatter.ts) → `buildGrassFieldGeometry` in [`geometry.ts`](./src/ground-cover/geometry.ts) |
| What updates grass after a scene or Terrain change? | [`ground-cover/system.tsx`](./src/ground-cover/system.tsx) |
| How is Surface connected to rendering, tools, and export? | [`surface-material/definition.ts`](./src/surface-material/definition.ts) |
| How do ponds follow terrain and animate koi? | [`pond/basin.ts`](./src/pond/basin.ts), [`geometry.ts`](./src/pond/geometry.ts), and [`koi-motion.ts`](./src/pond/koi-motion.ts) |
| How do rivers preview, commit, and restore terrain? | [`river/tool.tsx`](./src/river/tool.tsx), [`actions.ts`](./src/river/actions.ts), and [`terrain.ts`](./src/river/terrain.ts) |
| Where are the exterior world and sky composed? | [`surroundings/layer.tsx`](./src/surroundings/layer.tsx), [`atmosphere/layer.tsx`](./src/atmosphere/layer.tsx) |
| Where are the controls and temporary settings? | [`panel.tsx`](./src/panel.tsx), [`store.ts`](./src/store.ts) |
| What mounts the live presentation? | [`presentation-runtime.tsx`](./src/presentation-runtime.tsx) |
| What runs only for an explicit static surroundings export? | [`presentation-static-export.ts`](./src/presentation-static-export.ts), then [`surroundings/static-export.ts`](./src/surroundings/static-export.ts) |

For the first grass walkthrough, follow only the Terrain input to a root's Y
coordinate. Leave wind, paint sampling, obstacles, and export for separate steps.

## Integration and host API readiness

A host loads `environmentPlugin` through plugin discovery, registers
`environmentHostPanel` through the editor host-panel registry, and registers
the metadata-only `environmentPresentation` through the viewer presentation
registry. Importing the package entry point does not load the live Environment
layers, sky provider, or static surroundings builder. The viewer calls the
presentation's component loader when an installed project mounts registered
presentations; the host calls its separate static-export loader only after the
user includes Surroundings in a GLB or USDZ export. The reusable Editor mounts
registered presentations once in its normal and preview viewers. Direct live
layer and sky-provider factory exports are intentionally not part of the
package entry point; safe sky constants and types remain available.

The candidate peer range starts at Pascal `1.0.0-beta.6`. Beta.5 does not provide
the host APIs required by the current plugin. Site-scoped floorplan output,
asynchronous bake context, selection-material preservation, and live/static presentation contributions
have release requirements tracked in [`HOST-API-READINESS.md`](./HOST-API-READINESS.md).
That register also covers Terrain/tool activation and the deployment checklist.
`bun run check:release`, also run by `prepublishOnly`, requires a matching published
host version, matching installed host packages, and a successful standalone typecheck.
Until those requirements are met, use the local Editor workflow below; do not infer
publication readiness from a local demo or typecheck.
Presentation configuration remains versioned and project-local in browser storage.
Cloud/share synchronization remains out of scope.

## External assets and network requests

Environment has no analytics, telemetry endpoint, cloud account, or implicit
project upload. Its project-side presentation configuration remains in the
host-owned browser sidecar. Thunder is synthesized with the Web Audio API and
does not download an audio file.

The following requests can occur:

- The panel, live presentation, and static-export implementations are separate
  JavaScript chunks served by the host's deployment asset origin. They are
  requested only when the panel opens, a registered Environment presentation
  mounts, or an explicitly selected static surroundings export starts,
  respectively.
- The plugin logo, illustrated selector, and Surface material WebP files ship
  in this package. The bundler resolves their final URLs against the deployment
  asset origin. The logo is used when the host displays plugin metadata; the
  selector SVG is fetched when the Site View mounts; Surface preview and PBR
  images load when their panel, live material, live surroundings, or an
  applicable export first needs them. The selector's raster artwork is embedded
  as `data:` images inside the bundled SVG, so it adds no image origins.
- Live Surroundings loads the Pascal catalog's current `hydrant` GLB from
  `https://byrpxoiotywskoojsrzd.supabase.co/storage/v1/object/public/items/system/hydrant/model.glb`.
  The static surroundings builder requests the same GLB only when an opted-in
  regional export contains a hydrant. The host `resolveAssetUrl` contract
  preserves absolute HTTP(S) URLs, resolves `asset://` values from browser
  IndexedDB, and prefixes relative paths with `NEXT_PUBLIC_ASSETS_CDN_URL`
  (falling back to `https://editor.pascal.app`); the current hydrant entry is
  already absolute and is therefore preserved unchanged.
- Both the live GLTF hook and the static export configure Draco decoder version
  1.5.5 at
  `https://www.gstatic.com/draco/versioned/decoders/1.5.5/`. When the GLB
  requires Draco, Three.js requests `draco_wasm_wrapper.js` and
  `draco_decoder.wasm`, or `draco_decoder.js` on the JavaScript fallback. The
  live hook also configures KTX2/Basis support from
  `https://cdn.jsdelivr.net/gh/pmndrs/drei-assets@master/basis/`; a model using
  KTX2 textures causes requests for `basis_transcoder.js` and
  `basis_transcoder.wasm`. Meshopt decoding is bundled and adds no decoder
  origin.
- Plugin-manager links point to `https://github.com/pascalorg` for creator
  information and `https://github.com/AxiomeCG/environment` for source. They
  request GitHub only when followed. Executable-lab source links use the same
  source repository with `rel="noreferrer"` and make no request until followed.

Those origins and the host serving bundled assets receive ordinary connection
and HTTP request metadata when a request is made, such as the client IP,
timestamp, requested URL, TLS and browser headers, and any `Origin` or
`Referer` header allowed by browser policy. A `Referer` can expose the host page
origin or route under that policy. Environment does not control that browser
header, and it does not append scene nodes, presentation settings, project
identifiers, or user identifiers to asset URLs. Hosts, proxies, and the listed
providers may retain their normal access logs; the plugin adds no reporting
request of its own.

## Development

Install dependencies with `bun install`. While the required host APIs are unreleased,
validate against an installed local Editor with its host packages built:

```sh
bun run check-types:pascal
bun run test:pascal
```

For a focused grass check, use `bun run test:pascal src/ground-cover/geometry.test.ts`.
The standalone `bun test` and `bun run check-types` commands use this repository's
installed host packages; the beta.5 development dependencies do not establish
compatibility with the candidate APIs.
Tests and typechecking do not establish GPU appearance or export parity; check the
affected path in the host as well. Dated validation results belong in the
[baseline](./docs/mission/VERIFIED-BASELINE.md), not a permanent green badge here.

### Local Editor synchronization

With Environment already installed in the sibling `editor` checkout:

- `bun run sync:pascal` refreshes the installed package manifest and replaces its
  source under `editor/apps/editor/node_modules/@pascal-app/plugin-environment`.
- `bun run dev:pascal` performs the same synchronization and keeps watching for
  source changes. `PASCAL_EDITOR_ROOT` can select another host checkout.
- `bun run check-types:pascal` and `bun run test:pascal [paths...]` synchronize first,
  then validate against that host's package graph.

The integration candidate uses an archive inside
`editor/apps/editor/vendor/`, not a dependency on the sibling Environment folder.
`bun run pack:pascal` refreshes that archive from the current plugin source.
After packing, run `bun install` in the Editor root and include the archive and
lockfile in the candidate. This prepares a local artifact; it does not publish.
Source synchronization and watching do not modify the tracked archive, app manifest,
or lockfile. Repacking is explicit, so local iteration does not rewrite the submission.

The local Editor consumes built host packages from `dist/`, not their `src/`.
Rebuild changed host packages before visual verification. For Site ground-renderer
changes, run `bun run build` in `../editor/packages/nodes`. Synchronization does not
build host packages; typechecking with `--noEmit` does not refresh host builds.

## Local usage and rendering notes

These details are reference material; they are not prerequisites for the source
walkthrough above.

### Browsing Environment

The Environment panel opens with the illustrated **Site View**. The two **Browse**
icon buttons switch between the map (**Site View**) and list (**Catalogue**).
Each has a tooltip and accessible label, and the active view is marked.
Both views open the same tools. Unavailable tools remain disabled and are marked
**Coming soon** in the Catalogue.

Your chosen view is retained when returning from a tool, but resets on reload.

### Painting Surface and Ground Cover

Both painting panels keep their header visible while expanded settings scroll
inside the sidebar. Brush modes are keyboard-selectable, and each slider has
an exact-value input. **Esc** pauses painting; **Resume painting** stays in the
header. Whole-site fill, clear, and height-reset actions require confirmation.

**Surface** provides material swatches, **Paint** and **Blend** modes, and a
collapsible **Material scale** section. Texture size applies to every painted
material on the Site; dragging its slider commits on release.

**Ground Cover** separates coverage painting from local height adjustment.
**Target coverage** controls where grass grows; the Grass Field inspector
groups global appearance, natural variation, wind, and obstacle interaction.
Opening **Ground Cover** selects its existing layer (or creates one if needed)
and activates painting. Layer selection is part of this tool flow, not a separate
shortcut on the Environment home screen; **Resume painting** restores it after a pause.
Wind strength belongs to each Grass Field; changing one field does not change the
wind of another field or the natural surroundings.
Ground Cover excludes building interiors, colliding props, and the resolved wet
surfaces of authored ponds and rivers. Dry banks and islands remain paintable.
Water edits and live terrain changes refresh the exclusion without erasing saved
grass paint, so grass returns where water is drained or removed.

Live Surface shading uses sRGB base colors and linear-data normal/ARM maps.
Packed red supplies ambient occlusion and green supplies roughness; these
nonmetallic surfaces leave metalness at zero. Tangent-space normals use a
negative Y scale to match the supplied maps.
The draped ground triangles face upward on both flat and sculpted Sites, so
double-sided shading does not invert their lighting normals under Atmosphere.

GLB and USDZ exports freeze procedural geometry and bake intrinsic material
appearance into portable textures, without animation clips. Portable RGB values
outside 0–1 are clipped with a warning; ordinary colors and internal high-range
grass baking are unchanged. OBJ and STL remain geometry-only. Floorplan PDFs
retain vector architecture and water outlines with raster paint layers in Full
mode; Structure only omits those paint layers.

### Authored ponds and rivers

Open **Environment → Water** and choose the **Pond** or **River** tab.

- **Pond:** place water in an existing terrain depression. Pure, Clear, Deep, and
  Swampy have distinct appearances. The soft shoreline fades against the actual
  terrain; **Rocky bank** adds deterministic, terrain-following stones. Pond koi
  swim within the wet footprint, independently of the ambient bird-motion toggle.
  **Fill to spill** uses the enclosing terrain's lowest escape elevation, including
  depressions with multiple low points. Below an internal ridge, ponds stay separate;
  once water overtops it, connected ponds merge and retain their props. Dry islands
  and ground above the water level remain uncovered.
- **River:** choose **Draw new river**, then click terrain to lay out its centerline.
  A cursor marker, visible points, and a live count confirm placement; two points
  are required. **Finish river**, **Remove last point**, and **Cancel** sit beside
  the instructions (**Enter**, **Backspace**, and **Escape** also work).
  The native Site terrain deforms during drawing without changing saved terrain
  until commit. **Edit path** displays the centerline and screen-sized draggable
  points. Release commits the river and its channel together as one undo step.
- Adjust **Width** and **Depth** to reshape the channel. Regrading starts from the
  saved source terrain rather than repeatedly deepening the previous cut.
  Deleting rivers restores their footprints while retaining other rivers and
  subsequent sculpt deltas.
- **Direction** and **Speed** control the visible current. **R** reverses it while
  drawing or editing. Reversal does not change the channel or simulate hydraulics.

Point-drag previews use Pascal's live node overrides, so the existing river
surface moves instead of overlapping a second copy. Cancellation and switching
water tabs discard previews without adding undo history. Animated water and koi
are runtime effects; bake builders produce static, portable geometry.

River tools use Pascal's drafting scope, not its material-paint scope. Their
previews and handles stay in Site/world coordinates rather than following the
selected building's transform; pointer targets use the original terrain surface,
not the excavated bed.

### Local neighborhood preview

In the development host, open **Environment → Surroundings**. Road controls appear
first: select a numbered property edge on the map, then choose **No road**,
**Secondary**, or **Primary** above it. Edge markers and road choices support
keyboard navigation and activation. The heading stays visible while settings
scroll within the panel.

Use **Landscape preset** to switch between Regional, Open Meadow, and Woodland
Edge. Natural presets omit roads and homes; **Use Regional roads** restores the
road controls without losing edge assignments. **Variation & birds** contains the
landscape seed, bird visibility, and bird animation settings.

The map follows the live camera bearing while keeping labels upright. Its framing
stays centered on the Site when road types change. Neighborhood visibility,
landscape preset, seed, and road assignments are saved per project in the
browser-side presentation configuration.

The **Surroundings** switch in model export is off by default. Enabling it adds
finite derived context independently of the live camera's culling and LOD,
including the twelve birds at phase zero when birds are enabled. Sky, weather,
light beams, and the offshore apron are not included. These exports do not create
semantic nodes or replace the separately saved presentation configuration.

Regional terrain retains its seeded material treatment. Open Meadow and Woodland
Edge replace built context with deterministic natural surroundings. Woodland
reuses cached EZ-Tree prototypes for 96 nearby trees, existing impostors for the
distant forest, and the Ground Cover GPU blade/LOD/wind material for a bounded
understory. The natural renderer caps the full tree population at 640 and grass
at 28,672 blades. Meadow keeps sparse tree structure, denser grass, and more
flower accents. Both presets preserve clearings, the Site boundary, and water
exclusions.
Only painted Surface materials feather beyond the property boundary, over six
metres. Unpainted areas retain the surrounding terrain; the editor theme's plain
ground color is not extended into the neighborhood.
Exterior terrain clips to the actual rendered ground footprint rather than
dropping whole intersecting cells: the editable Terrain's full rectangular
sample-grid extent when present, and the Site polygon for flat polygon-only
Sites. A narrow boundary skirt closes the road-clearance offset without covering
either ground. Live terrain grid creation, cancellation, and resizing keep the
cutout coherent; height-only dabs do not rebuild the surrounding landscape.

Compatible road surfaces share batches across color variations using vertex
colors; primary and secondary roads retain their individual colors.

Regional ground uses the same seam-free stochastic sampler as painted Surfaces,
with seeded texture domains instead of regular repeats. Signed cell hashing
preserves variation on both sides of the world origin.

Neighborhood houses, garages, and nearby trees share one instanced ground-shadow
draw call. Soft projected footprints follow the sun and sample the terrain. Their
low-sun extent is capped, and they fade with distance; weak contact shading remains
at night or when the procedural sky is disabled. They do not cast onto buildings or use shadow
maps, render targets, or a blur pass.
Terrain draping preserves each shadow instance's translation, rotation, and scale;
the height offset is added after instancing, rather than replacing its position.

Distant forest trees retain two draw calls and four triangles per tree. Shared
four-variant, four-view canopy atlases provide asymmetric silhouettes and
tree-local normals instead of flat card lighting. The two cached color/normal
atlas pairs use 4 MiB before mipmaps; no per-tree or per-seed textures are created.

Streetlight bases are placed on the rendered sidewalk bands, including rounded
junctions, rather than rectangular road envelopes. Placement keeps a 25 cm margin,
avoids carriageways, bike lanes, crossings, and driveways, and moves blocked
candidates along the approach. No pole is placed where a clear sidewalk cannot be
found; nearby poles retain at least 6 m separation.

Night lighting follows the Sky tool's solar elevation in both clock and manual
modes; disabling Sky disables the artificial lights. A shared uniform fades in
warm window emission without rebuilding neighborhoods. Seeded household and pane
choices leave some houses completely dark and vary the lit panes in the others.
Distant city facades reuse their opaque window grid for the same effect. Road
paint is light-reactive rather than unlit, so arrows and crossings darken at night.
Lamp heads emit light visually, while a single instanced batch adds soft,
terrain-draped ground pools. These are inexpensive lighting approximations: no
per-pole lights, shadow maps, interior lighting, or illumination of nearby walls.

Coastal lighthouses add a rotating spotlight and a soft visible beam at night.
The beacon completes one sweep every 20 seconds, follows the same solar fade,
and stops rotating while the viewer is paused. It remains presentation-only.

Distant birds are visible and animated by default, including after restoring an
environment configuration. **Animate distant birds** pauses their flight; the
viewer-wide rendering pause freezes both birds and the lighthouse beacon.

Parked cars use one shared 486-triangle sedan with chamfered bodywork, wheel arches,
outward-facing inset glazing, rims, and unlit head/tail lamps. All cars remain two
instanced draws: paint plus one vertex-colored batch with separate glass, rubber,
and metal roughness. No textures, transparent glass, or additional material groups
are required.

The outer neighborhood attempts one gas station and one supermarket, preferring
nearby viable road frontage with seeded placement variation. Stations have a
colored canopy, pumps, shop, and elevated sign; supermarkets have a full-width
fascia, glazed shopfronts, parking marks, and a cart shelter.
Both reuse the existing primitive/material instance batches. Their plots and
access aprons are reserved before houses and planting, kept outside the Site,
and rejected on flooded or excessively uneven ground. They remain presentation
context, not editable commercial building nodes.

Road markings share the rendered junction's solved approach cuts. Bent marking
ribbons share clamped-miter edges instead of overlapping independent square caps.

### Local surface water

Coastal seas and rivers share one opaque, merged surface with six non-harmonic
wave bands. Two shared, moving noise samples bend crests and vary their strength
instead of repeating straight ripple lines. Screen-space filtering and distance
fading suppress unresolved fine waves. Shallow depth drives broken, animated
shoreline foam and roughness; the same material keeps pond foam restrained.
Water uses the scene's environment lighting and fog; it adds no textures,
reflection/refraction render targets, wave simulation, or underwater rendering.
A coarse offshore apron carries coastal water beyond the sampled terrain window
without extending river-only surfaces to infinity.

The local host supplies `SceneGroundReplacement` to `SurroundingsLayer`. While
Surroundings owns the exterior ground, the viewer hides its higher fallback disc
and extends the perspective far plane for the ocean horizon. The orthographic
camera retains its normal depth range. Removing the final replacement restores
the fallback. This water remains separate from authored Water nodes; its finite
surface can be included through the opt-in static surroundings export.

### Local Sky tool

In the development host, open **Environment → Catalogue → Atmosphere**. The
environment sky is active by default. Clear, Light rain, Rain, Storm, and Snow
presets expose the common controls first; sun position follows, while manual
scattering and diagnostics live under **Advanced**. Day playback takes two
minutes and remains opt-in.

The time widget shows a daylight or nighttime semicircle. Drag the sun or moon,
switch orbit with the two celestial buttons, or enter an exact time. Arrow keys
move five minutes; Shift moves thirty; Escape cancels a drag. The gradient, stars,
and clouds follow the current sky state. Adjusting time pauses playback. The
widget uses SVG and introduces no viewer render pass or idle animation loop.

The procedural provider shares a normalized world-direction, linear-HDR contract
between the background, reflections, and fog. One solar state drives the visible
sun and scene lights. Fog omits celestial discs, stars, cloud detail, and the dark
ground hemisphere: downward views receive atmospheric airlight rather than ground
bounce. Disabling Sky restores Pascal's normal theme lighting and environment
when no precipitation requires the weather sky.

Rain monotonically increases cloud coverage and optical density, cools and
darkens the atmosphere, reduces direct light, tightens fog, and adds whole-map
surface wetness. Snow uses a stable world-cell particle field and adds cooler
clouds plus upward-facing cover across editable and surrounding terrain and
structures. Surface effects are immediate visual coverage, not accumulation,
melting, runoff, or indoor collision simulation. Storm lightning responds within
200 ms, illuminates clouds and ambient light without adding a second scene light,
and synthesized thunder requires a fresh user gesture.

The goal is an independently designed, credible sky for architectural scenes—not
visual parity with Three.js Water Pro. The Vaulty notes have Water Pro study
provenance; product-specific code, presets, and appearance are not specifications
to reproduce. Public atmospheric-rendering references include
[Hillaire's atmosphere paper](https://sebh.github.io/publications/egsr2020.pdf) and
[Bruneton's reference implementation](https://ebruneton.github.io/precomputed_atmospheric_scattering/);
this lightweight approximation does not implement their full scattering solvers.

Sky and weather settings are saved per project in the local browser sidecar and
do not create scene nodes or history entries. Bootstrap registers the safe
contribution object from [`presentation.ts`](./src/presentation.ts); a viewer
mount loads [`presentation-runtime.tsx`](./src/presentation-runtime.tsx)
through the public viewer contribution seam. Publication still depends on
`ENV-HOST-006` and `ENV-HOST-007`.
Configuration exports use version 2. Importing a valid version 1 snapshot drops
the removed `godRays` setting while preserving its other environment settings.

## Executable feature lab

The Environment executable lab exercises the production plugin in focused Gyms,
true-scale Zoos, and guided Museums. Its fixtures use current semantic nodes,
terrain/paint codecs, basin analysis, river grading, presentation configuration,
and the real Environment panel—never a parallel exhibit renderer.

```ts
import {
  EnvironmentLabControls,
  createEnvironmentLabFixture,
  initializeEnvironmentLabFixture,
} from '@pascal-app/plugin-environment/lab'
import { ENVIRONMENT_LAB_CASES } from '@pascal-app/plugin-environment/lab/catalog'

const fixture = createEnvironmentLabFixture('living-landscape', 'daylight')
initializeEnvironmentLabFixture('living-landscape', fixture)
```

The standalone testbed lives in [`lab/`](./lab), in this Environment repository—not
in the main Pascal editor app. Install and run it from the Environment root:

```sh
bun install --cwd lab
bun run dev:lab
```

Open the [Environment lab](http://localhost:3011/environment-lab). The dedicated
origin keeps its browser preferences and presentation sidecars separate from the
main editor. Scene saves remain in memory and navigation discards scratch edits.

The lab app owns routes, scratch persistence, scene replacement, camera UI, and
review downloads. It consumes the real Pascal editor/viewer packages and current
Environment source; its app code is not shipped in the plugin package.
Start with the [executable lab guide](./docs/lab/README.md), then use
its [case guide](./docs/lab/cases.md) and
[reproducibility contract](./docs/lab/reproducibility.md). Catalog source links
target the public [`AxiomeCG/environment`](https://github.com/AxiomeCG/environment) repository.

## Documentation map

- **Start here:** this README maps the current implementation and its entry points.
- **Release constraints:** [`HOST-API-READINESS.md`](./HOST-API-READINESS.md).
- **Vocabulary and domain intent:** [`CONTEXT.md`](./CONTEXT.md) and the
  [Environment / Nature decision](./docs/adr/0001-separate-environment-from-nature.md).
- **Product direction and decision history:** [`BRIEF.md`](./docs/mission/BRIEF.md)
  and [`SIX-DAY-PLAN.md`](./docs/mission/SIX-DAY-PLAN.md). These contain plans and
  dated implementation addenda, not a live inventory of completed features.
- **Dated observations and validation evidence:**
  [`VERIFIED-BASELINE.md`](./docs/mission/VERIFIED-BASELINE.md). Read the relevant
  addenda before relying on an older claim; historical test results are not a fresh run.
- **Optional craft sessions:**
  [`LEARNING-PATH.md`](./.procedural/procedural-surroundings/LEARNING-PATH.md).
  It is a learning plan, not evidence that implementation is complete or mastered.

Update this map when responsibilities, persistence, entry points, or integration
requirements change. Keep detailed experiments and dated results in their existing
mission documents rather than making each implementation change a new README section.

## License

MIT
