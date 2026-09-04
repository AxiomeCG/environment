# Pascal Environment

`@pascal-app/plugin-environment` is a standalone Pascal plugin for terrain-dependent environment creation.

## Current state

This repository currently contains a mechanical transfer of the GPU Ground Cover prototype that was developed in Pascal Nature. Its public identities are:

- plugin: `pascal:environment`
- package: `@pascal-app/plugin-environment`
- node kind: `environment:ground-cover`

The transfer preserves the prototype's internal `GrassFieldNode` naming and tests to keep this planning pass focused. `GroundCoverNode` is exported as a public alias.

The prototype already provides a persistent RGBA paint field, paint/erase/smooth brushes, deterministic instanced blades, color and density sampling, blade variation, and shader-driven wind. It is not yet integrated into the Pascal editor repository and must not be considered fully compatible with sculpted Terrain or the baked GLB viewer.

## Exports

```ts
import {
  environmentHostPanel,
  environmentPlugin,
  groundCoverDefinition,
  GroundCoverNode,
} from '@pascal-app/plugin-environment'
```

A Pascal host loads `environmentPlugin` through the plugin discovery contract and registers `environmentHostPanel` separately through the editor host-panel registry.

## Development

```sh
bun install
bun test
bun run check-types
```

The package targets Pascal `1.0.0-beta.5` or newer within the `1.x` plugin API.

The local Editor consumes built host packages from `dist/`, not their `src/`.
Rebuild changed host packages before visual verification. For Site ground-renderer
changes, run `bun run build` in `../editor/packages/nodes`. `sync:pascal` copies
Environment source only; typechecking with `--noEmit` does not refresh host builds.

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

Parked cars use one shared 486-triangle sedan with chamfered bodywork, wheel arches,
outward-facing inset glazing, rims, and unlit head/tail lamps. All cars remain two
instanced draws: paint plus one vertex-colored batch with separate glass, rubber,
and metal roughness. No textures, transparent glass, or additional material groups
are required.

### Local surface water

Coastal seas and rivers share one opaque, merged surface with animated ripple
normals, depth-dependent color, and a restrained shoreline wash. Water uses the
scene's environment lighting and fog; it adds no reflection/refraction render
target, wave simulation, or underwater rendering. A coarse offshore apron carries
coastal water beyond the sampled terrain window without extending river-only
surfaces to infinity.

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

## Host API readiness

[`HOST-API-READINESS.md`](./HOST-API-READINESS.md) tracks every feature that requires a Pascal Editor evolution beyond the published plugin API. Its open entries and deployment checklist must be reviewed before enabling selector zones or releasing the plugin.

## Scope

Environment is intended to own large-scale brushes, masks, distributions, terrain-dependent water, atmosphere, surroundings, and environmental LOD. Nature remains responsible for procedural individual vegetation and EZ-Tree-specific behavior. The implementation sequence beyond the transferred Ground Cover prototype is intentionally deferred until the six-day mission plan is approved.

## License

MIT
