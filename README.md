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
| Surroundings | Site data plus runtime seed and frontage settings | Exterior terrain, roads, houses, vegetation, and coastal/river water; presentation-only, outside authored geometry exports |
| Atmosphere | Runtime sky settings | Sky radiance supplied to the host's background, lighting, reflections, and fog; no authored node |

Ground Cover, Surface, Pond, and River are registered as nodes in
[`src/index.ts`](./src/index.ts). Sky, neighborhood settings, and brush controls
live in [`src/store.ts`](./src/store.ts) and are not saved with the scene.
Painted results and authored water parameters belong to nodes, not transient tool
stores. Surroundings' sea and rivers remain separate, presentation-only water.

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
| What does the plugin expose? | [`src/index.ts`](./src/index.ts) |
| What grass data is saved, and how does it reach each representation? | [`ground-cover/schema.ts`](./src/ground-cover/schema.ts), then [`definition.ts`](./src/ground-cover/definition.ts) |
| Where does a grass root get its height? | [`field-context.ts`](./src/ground-cover/field-context.ts) → [`scatter.ts`](./src/ground-cover/scatter.ts) → `buildGrassFieldGeometry` in [`geometry.ts`](./src/ground-cover/geometry.ts) |
| What updates grass after a scene or Terrain change? | [`ground-cover/system.tsx`](./src/ground-cover/system.tsx) |
| How is Surface connected to rendering, tools, and export? | [`surface-material/definition.ts`](./src/surface-material/definition.ts) |
| How do ponds follow terrain and animate koi? | [`pond/basin.ts`](./src/pond/basin.ts), [`geometry.ts`](./src/pond/geometry.ts), and [`koi-motion.ts`](./src/pond/koi-motion.ts) |
| How do rivers preview, commit, and restore terrain? | [`river/tool.tsx`](./src/river/tool.tsx), [`actions.ts`](./src/river/actions.ts), and [`terrain.ts`](./src/river/terrain.ts) |
| Where are the exterior world and sky composed? | [`surroundings/layer.tsx`](./src/surroundings/layer.tsx), [`atmosphere/layer.tsx`](./src/atmosphere/layer.tsx) |
| Where are the controls and temporary settings? | [`panel.tsx`](./src/panel.tsx), [`store.ts`](./src/store.ts) |

For the first grass walkthrough, follow only the Terrain input to a root's Y
coordinate. Leave wind, paint sampling, obstacles, and export for separate steps.

## Integration and host API readiness

A host loads `environmentPlugin` through plugin discovery and registers
`environmentHostPanel` separately through the editor host-panel registry. The local
Editor does both. `SurroundingsLayer` and `AtmosphereLayer` are separate exports:
local application routes mount them through `viewerSceneSlot`, supplying
`SceneGroundReplacement` and `SceneAtmosphere`. Registering the plugin alone does
not install those presentation layers.

The declared peer range starts at Pascal `1.0.0-beta.5`, but that is **not sufficient
to guarantee all current features**. Site-scoped floorplan output, bake-only geometry,
selection-material preservation, and presentation contributions have host release
requirements tracked in [`HOST-API-READINESS.md`](./HOST-API-READINESS.md).
That register also covers Terrain/tool activation and the deployment checklist.
Local direct mounts are not a published presentation API; project-scoped persistence
for sky and surroundings remains unresolved. Do not infer release readiness from a
local demo or package typecheck.

## Development

From this repository:

```sh
bun install
bun test
bun run check-types
```

For a focused grass check, use `bun test src/ground-cover/geometry.test.ts`.
Tests and typechecking do not establish GPU appearance, host integration, or export
parity; check the affected path in the host as well. Dated validation results belong
in the [baseline](./docs/mission/VERIFIED-BASELINE.md), not a permanent green badge here.

### Local Editor synchronization

With Environment already installed in the sibling `editor` checkout:

- `bun run sync:pascal` refreshes the installed package manifest and replaces its
  source under `editor/apps/editor/node_modules/@pascal-app/plugin-environment`.
- `bun run dev:pascal` performs the same synchronization and keeps watching for
  source changes. `PASCAL_EDITOR_ROOT` can select another host checkout.

The local Editor consumes built host packages from `dist/`, not their `src/`.
Rebuild changed host packages before visual verification. For Site ground-renderer
changes, run `bun run build` in `../editor/packages/nodes`. Synchronization does not
build host packages; typechecking with `--noEmit` does not refresh host builds.

## Local usage and rendering notes

These details are reference material; they are not prerequisites for the source
walkthrough above.

### Browsing Environment

The Environment panel opens with the illustrated **Site View**. Use **Browse → Catalogue**
for the compact tool list; both views open the same tools. Unavailable tools
remain disabled and are marked **Coming soon** in the Catalogue.

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

Live Surface shading uses sRGB base colors and linear-data normal/ARM maps.
Packed red supplies ambient occlusion and green supplies roughness; these
nonmetallic surfaces leave metalness at zero. Tangent-space normals use a
negative Y scale to match the supplied maps.
The draped ground triangles face upward on both flat and sculpted Sites, so
double-sided shading does not invert their lighting normals under Atmosphere.

### Authored ponds and rivers

Open **Environment → Water** and choose the **Pond** or **River** tab.

- **Pond:** place water in an existing terrain depression. Pure, Clear, Deep, and
  Swampy have distinct appearances. The soft shoreline fades against the actual
  terrain; **Rocky bank** adds deterministic, terrain-following stones. Pond koi
  swim within the wet footprint, independently of the ambient bird-motion toggle.
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

In the development host, open **Environment → Surroundings**. Select a numbered
property edge directly on the 2D map, then choose **No road**, **Secondary**, or
**Primary** in the map card. Edge markers and road choices support keyboard
navigation and activation.

The map follows the live camera bearing while keeping labels upright. Its framing
stays centered on the Site when road types change. Neighborhood visibility and
road assignments are runtime-only and are not saved with the scene.

Dry neighborhood terrain defaults to grass with sparse soil patches. Its broad
color variation and soil pattern follow the surroundings seed: replaying a seed
reproduces them, while changing it changes the pattern. Sand is limited to low
ground near sea level in coastal or river regions; flat ground at the property's
elevation is not treated as a beach. The material reuses the shared noise texture
without adding a terrain pass or per-seed textures.
Surroundings meadow and woodland coverage is baked into the terrain tint.
Automatic grass blades and their camera-driven LOD are not rendered; authored
Ground Cover keeps its separate painted blade renderer.
Only painted Surface materials feather beyond the property boundary, over six
metres. Unpainted areas retain the surrounding terrain; the editor theme's plain
ground color is not extended into the neighborhood.
Terrain clips to the actual property polygon rather than dropping whole
intersecting cells. A narrow boundary skirt closes the road-clearance offset
without covering the editable Site.

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
the fallback. This is presentation-only water, not an authored or baked Water body.

### Local Sky tool

In the development host, open **Environment → Catalogue → Atmosphere**, then
enable **Use environment sky**. Choose an ambiance or adjust time of day, north,
cloud cover, haze, fog distance, and exposure. Manual sun angles, scattering
controls, and diagnostic views are available underneath. Day playback takes two
minutes; cloud animation is separately opt-in.

The time widget shows a daylight or nighttime semicircle. Drag the sun or moon,
switch orbit with the two celestial buttons, or enter an exact time. Arrow keys
move five minutes; Shift moves thirty; Escape cancels a drag. The gradient, stars,
and clouds follow the current sky state. Adjusting time pauses playback. The
widget uses SVG and introduces no viewer render pass or idle animation loop.

The procedural provider shares a normalized world-direction, linear-HDR contract
between the background, reflections, and fog. One solar state drives the visible
sun and scene lights. Fog omits celestial discs, stars, cloud detail, and the dark
ground hemisphere: downward views receive atmospheric airlight rather than ground
bounce. Rough and diffuse environment lighting also avoid cloud detail. Disabling
Sky restores Pascal's normal theme lighting and environment.

The model uses wavelength-dependent Rayleigh scattering, a Henyey–Greenstein Mie
phase, and Beer–Lambert attenuation with approximate atmospheric columns. Twilight,
cloud shading, the moon phase, and the 24-hour orbit are artistic approximations,
not a geolocated or photometrically calibrated solar study. There is no volumetric
raymarch or continuously regenerated environment map.

The goal is an independently designed, credible sky for architectural scenes—not
visual parity with Three.js Water Pro. The Vaulty notes have Water Pro study
provenance; product-specific code, presets, and appearance are not specifications
to reproduce. Public atmospheric-rendering references include
[Hillaire's atmosphere paper](https://sebh.github.io/publications/egsr2020.pdf) and
[Bruneton's reference implementation](https://ebruneton.github.io/precomputed_atmospheric_scattering/);
this lightweight approximation does not implement their full scattering solvers.

Sky settings are runtime-only, start disabled, and do not create scene nodes or
history entries. The local host mounts `AtmosphereLayer` through `viewerSceneSlot`
and supplies the viewer's `SceneAtmosphere` adapter. This remains a local
integration, subject to `ENV-HOST-006`, not a published plugin-presentation API.

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
