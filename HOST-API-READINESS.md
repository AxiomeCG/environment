# Pascal host API readiness

This living register records every Environment feature that cannot be implemented safely through Pascal's published plugin API alone. It is a deployment gate: the plugin must not rely on untracked host patches, timing workarounds, internal imports, or unchecked casts.

## Status vocabulary

- **Blocked** — the feature must remain disabled in the shipped selector.
- **Host change required** — a Pascal Editor change is identified but not released.
- **Accepted workaround** — a temporary workaround has an explicit owner and removal version.
- **Resolved** — the host change is released, the minimum peer version is updated, and acceptance checks pass against installed packages.

## Open gaps

### ENV-HOST-001 — Build panel must preserve an already-active Terrain mode

| Field | Value |
|---|---|
| Status | **Host change required — implemented locally; release blocker while the Terrain zone is enabled** |
| Observed | 2026-09-01; source rechecked 2026-09-08 |
| Host repository | `pascalorg/editor` |
| Local implementation | Current local checkout (unreleased) |
| Host issue / PR | TBD |
| Required Pascal version | First published Pascal release containing the `BuildTab` preservation fix; version not assigned |
| Plugin evidence | `src/pascal-tool-actions.ts` |
| Host evidence | `apps/editor/components/build-tab.tsx` |

Environment opens the native Terrain surface through the published editor store:

```ts
editor.setMode('terrain-sculpt')
editor.setActiveSidebarPanel('build')
```

The current local `BuildTab` mount initializer now returns early for
`terrain-sculpt` and `material-paint`, so it no longer replaces the requested
mode with the first construction tool. This is implemented source behavior,
not published-package evidence. Environment must not add a timer, duplicate
Terrain controls, or import Editor internals.

Deployment must use the first Pascal release containing this fix or keep the
Terrain hotspot disabled.

Acceptance checks:

- Clicking the mound opens the existing Build panel.
- `useEditor.getState().mode` remains `terrain-sculpt` after `BuildTab` mounts.
- The native `TerrainSculptPanel` is visible; Environment does not render a copy.
- The Terrain tile is active and the default construction tool is not armed.
- The flow works after a cold load and after switching from Ground Cover.

### ENV-HOST-002 — Plugin-owned tool identifiers need an extensible public type

| Field | Value |
|---|---|
| Status | **Host change required — open-string typing implemented locally; release prerequisite, with unknown-id validation still open** |
| Observed | 2026-09-01; source rechecked 2026-09-08 |
| Host repository | `pascalorg/editor` |
| Local implementation | Current local checkout (unreleased) |
| Host issue / PR | TBD |
| Required Pascal version | First published Pascal release whose public `Tool` type includes plugin-owned string identifiers; version not assigned |
| Plugin evidence | `src/pascal-tool-actions.ts` |
| Host evidence | `packages/editor/src/store/use-editor.tsx` |

The current local public type is no longer a closed built-in union:

```ts
export type KnownTool = SiteTool | StructureTool | FurnishTool
export type Tool = KnownTool | (string & {})
```

`setTool('environment:ground-cover')` therefore compiles without widening the
setter and mounts through the normal registry-backed `ToolManager` lifecycle.
This satisfies Environment's typing requirement. It is not yet released, and
the host still accepts an unknown string without validating it against the
loaded registry. Explicit unknown-id failure remains desirable API hardening,
but Environment only supplies registered identifiers.

Acceptance checks:

- Environment activates `environment:ground-cover` without casting `setTool` or importing internals.
- The registered plugin tool mounts through the normal `ToolManager` lifecycle.
- Escape/cancel behavior remains identical to built-in tools.
- The published host declaration contains the open `Tool` identifier type.
- Follow-up hardening makes an unknown plugin tool identifier fail explicitly.

### ENV-HOST-003 — Floorplan discovery has no Site scope

| Field | Value |
|---|---|
| Status | **Host change required — implemented locally; release blocker for Ground Cover display in Editor 2D** |
| Observed | 2026-09-02; source rechecked 2026-09-08 |
| Host repository | `pascalorg/editor` |
| Local implementation | Current local checkout (unreleased) |
| Host issue / PR | TBD |
| Required Pascal version | First published Pascal release containing `floorplanScope: 'site'`, even-odd floorplan fills, and inline PDF image support; version not assigned |
| Plugin evidence | `src/ground-cover/definition.ts`, `src/ground-cover/floorplan.ts`, `src/ground-cover/floorplan.test.ts` |
| Host evidence | `packages/core/src/registry/types.ts`, `packages/core/src/registry/registry.ts`, `packages/core/src/registry/registry.test.ts`, `packages/editor/src/components/editor-2d/renderers/floorplan-registry-layer.tsx`, `packages/editor/src/components/editor-2d/renderers/floorplan-registry-layer.test.ts`, `packages/editor/src/components/editor-2d/renderers/floorplan-geometry-renderer.tsx`, `packages/editor/src/lib/floorplan/floorplan-pdfkit-renderer.ts` |

The published `@pascal-app/core@1.0.0-beta.5` package used by Environment accepts only `'level' | 'building'` in `floorplanScope`, so a Site child remains unreachable through an installed release. The local Pascal Editor source now adds `'site'` to the public type and registry query.

The local registry layer collects direct site-scoped children from the active level's Site, supplies the real Site as `ctx.parent`, exposes the Site subtree through `ctx.resolve`, invalidates the entry when any Site descendant changes, and projects Site-local output into the active building's plan coordinates. Site entries receive an earlier scope rank so they render below building and level architecture. Environment declares Ground Cover with `floorplanScope: 'site'` and emits one bounded raster image (at most $64 \\times 64$ cells), one selectable boundary, and an optional selection hatch rather than one SVG primitive per blade.

The projection also needs two generic renderer corrections. Compound mask contours require `FloorplanStyle.fillRule: 'evenodd'` to reach both SVG and PDFKit, otherwise holes are filled. Its bounded RGBA raster is a `data:image/png` URL; the PDF renderer must pass that source directly to PDFKit instead of treating it as an asset identifier for `loadAssetUrl()`.

Until the host change is released and Environment's minimum peer version is updated, Ground Cover's 2D representation is available only with the local Pascal checkout; published-host deployment remains blocked.

Acceptance checks:

- A registered site-scoped fixture is discovered from every level of its Site and from no level of another Site.
- `ctx.parent` passed to its builder is the semantic Site node; `ctx.resolve` can traverse the Site subtree.
- One Ground Cover node yields one floorplan entry, not one persisted clone per level.
- The entry responds to normal visibility, selection and hover state.
- Existing level- and building-scoped fixtures keep their discovery and ordering behavior.
- No `environment:ground-cover` kind string is added to the host.
- Compound `evenodd` contours retain their holes in interactive SVG and PDF output.
- Inline `data:image/png` floorplan images render in PDF without an asset lookup.

### ENV-HOST-004 — No bake-only geometry hook for a portable Ground Cover snapshot

| Field | Value |
|---|---|
| Status | **Host change required — implemented locally; release blocker for faithful generic-GLB output** |
| Observed | 2026-09-02; source rechecked 2026-09-08 |
| Host repository | `pascalorg/editor` |
| Local implementation | Current local checkout (unreleased) |
| Host issue / PR | TBD |
| Required Pascal version | First published Pascal release containing the `bakeGeometry` node-definition hook and replace-bake viewer path; version not assigned |
| Plugin evidence | `src/ground-cover/definition.ts`, `src/ground-cover/bake-geometry.ts`, `src/ground-cover/bake-geometry.test.ts`, `src/ground-cover/static-renderer.tsx` |
| Host evidence | `packages/core/src/registry/types.ts`, `packages/editor/src/lib/glb-export.ts`, `packages/editor/src/lib/glb-export.test.ts`, `wiki/architecture/node-definitions.md` |

The published `@pascal-app/core@1.0.0-beta.5` package has no bake-only geometry builder. Ground Cover's live `InstancedMesh` contains the maximum candidate population and lets its TSL material reject candidates from paint alpha, global density and obstacle inputs, so cloning and material conversion alone cannot produce a faithful portable snapshot.

The local Pascal Editor source now exposes the pure `bakeGeometry(node, context)` definition hook. `prepareSceneForExport()` invokes it against persisted semantic nodes after clone-only visibility pruning and before generic mesh/material sanitization. The returned detached Object3D replaces only the export clone; the host preserves the registered node transform, visibility, layers, sibling order and identity mapping and rejects builders that return live or already-parented objects. Kinds without the hook retain the existing clone-and-convert path.

Environment's bake builder shares the deterministic candidate scatter and Site/Terrain/paint/obstacle resolution used by the live field, emits only accepted blades, and bakes them into baseline glTF mesh primitives with one shared `MeshStandardMaterial`. The output is split below 65,535 vertices per mesh so every chunk uses portable 16-bit indices and does not depend on `EXT_mesh_gpu_instancing`. Ground Cover also declares `bake: 'replace'` and a Pascal replacement renderer that rebuilds the live TSL geometry from the current scene store, so Pascal hides the static snapshot without duplicating grass.

Until the host change is released and Environment's minimum peer version is updated, the portable snapshot path is available only with the local Pascal checkout and published-host deployment must not claim GLB parity.

Acceptance checks:

- The hook receives the semantic node and read-only scene context, produces local-space export geometry, and never mutates the live registered object.
- The exported Ground Cover contains only blades accepted by mask, density, Site boundary, obstacles and Terrain sampling.
- Three.js `GLTFExporter` writes ordinary indexed mesh primitives containing the accepted blade positions, normals and colors without a required instancing extension.
- A generic glTF viewer shows the static Ground Cover with no Pascal or TSL runtime.
- Pascal's GLB viewer hides that snapshot and mounts `bakeReplaceRenderer` once, without duplicate grass.
- Kinds without the hook retain the current clone-and-convert behavior.

### ENV-HOST-005 — Selection highlighting cannot preserve plugin-authored materials

| Field | Value |
|---|---|
| Status | **Host change required — implemented locally; release blocker for faithful Ground Cover and Surface editing** |
| Observed | 2026-09-02; source rechecked 2026-09-08 |
| Host repository | `pascalorg/editor` |
| Local implementation | Current local checkout (unreleased) |
| Host issue / PR | TBD |
| Required Pascal version | First published Pascal release containing `capabilities.selectionHighlight`; version not assigned |
| Plugin evidence | `src/ground-cover/definition.ts`, `src/surface-material/definition.ts` |
| Host evidence | `packages/core/src/registry/types.ts`, `packages/core/src/registry/registry.ts`, `packages/core/src/registry/registry.test.ts`, `packages/editor/src/components/editor/selection-manager.tsx` |

The published beta.5 Editor highlights selection and hover by replacing materials in a registered node's rendered subtree. That is unsafe for Environment paint layers: Ground Cover and Surface use authored NodeMaterial graphs, textures, masks and opacity whose meaning is lost when the host substitutes a generic selection material. The node must remain selected so its panel and tool lifecycle work, but its rendered material must remain owned by the plugin.

The local host adds `capabilities.selectionHighlight?: boolean`, defaulting to `true` for compatibility. The registry exposes a generic query and the selection manager honors it for both committed selection and hover/outliner synchronization. Environment sets the capability to `false`; no Environment kind is named by the host.

Until the capability is released, selecting these paint layers may obscure the result being edited. Published-host deployment must not claim faithful interactive material preview.

Acceptance checks:

- A registered kind with `selectionHighlight: false` remains semantically selected without material substitution.
- Hover and outliner synchronization also preserve its authored materials.
- Its inspector, plugin tool activation, Escape behavior and deletion policy remain unchanged.
- Existing and unregistered kinds retain selection highlighting by default.
- Loading or unloading a plugin refreshes the registry-driven behavior without a hardcoded kind check.

### ENV-HOST-006 — Public viewer presentation contributions

| Field | Value |
|---|---|
| Status | **Host change required — implemented locally; release blocker for published Surroundings, Atmosphere, and Weather presentation** |
| Observed | 2026-09-02; source rechecked 2026-09-08 |
| Host repository | `pascalorg/editor` |
| Local implementation | Current local checkout (unreleased) |
| Host issue / PR | TBD |
| Required Pascal version | First published Pascal release containing the viewer presentation interface and Editor mount described below; version not assigned |
| Plugin evidence | `src/presentation.tsx`, `src/surroundings/layer.tsx`, `src/atmosphere/layer.tsx`, `src/index.ts` |
| Host evidence | `packages/viewer/src/components/viewer/viewer-presentations.tsx`, `packages/viewer/src/index.ts`, `packages/editor/src/components/editor/index.tsx`, `apps/editor/lib/bootstrap.ts` |

The current local viewer now owns this rendering interface:

```ts
type ViewerPresentationContribution = {
  id: string
  pluginId?: string
  component: LazyComponent
}

registerViewerPresentation(contribution)
```

Hosts mount `<ViewerPresentations />` once inside each `<Viewer>` that should
show registered presentation. The reusable Editor does this in its normal and
preview compositions. `apps/editor/lib/bootstrap.ts` registers
`environmentPresentation` beside Environment's plugin and host panel; the
blank and saved-scene routes no longer import or mount Environment layers.
A host composing raw Viewer opts in with the same public mount.

`pluginId` is gated by the project `installedPlugins` list. Uninstall releases
the subtree, reinstall remounts it, and two Viewer scenes receive independent
instances. Each lazy contribution has its own Suspense and error boundary.
Plugin code remains session-loaded because core plugin loading is add-only.

Environment's contribution composes `AtmosphereLayer` and `SurroundingsLayer`
with the viewer's `SceneAtmosphere` and `SceneGroundReplacement` adapters.
Those adapters retain ownership per R3F Scene, so releasing one viewer cannot
change another viewer's fog, environment, fallback ground, or camera range.

The mount is a sibling of `scene-renderer`. Editor model export is rooted at
`scene-renderer`, so presentation is not authored or exported and cannot gain
a `pascalId`, selection target, query result, history entry, or serialized
scene node. Raw Viewer snapshots include it only when the host explicitly
mounts `<ViewerPresentations />`.

This source implementation does not make the gap released. Environment's
published peer range must move to the first Pascal release that contains the
interface and reusable Editor mount; no release number has been assigned.

Acceptance checks:

- Bootstrap registration is the only application-level Environment presentation integration.
- Blank-scene and saved-scene routes contain no direct Environment layer mount.
- Project uninstall removes the contribution; reinstall remounts it without re-registering code.
- Two simultaneous viewer scenes keep atmosphere and ground ownership independent.
- The contribution creates no authored node or scene persistence entry.
- Geometry export stays rooted at `scene-renderer` and excludes the contribution.
- A failing lazy contribution leaves authored rendering and healthy contributions mounted.

### ENV-HOST-007 — Project persistence for Environment configuration

| Field | Value |
|---|---|
| Status | **Host change required — local per-project persistence implemented; cloud/share sync and host release remain unassigned** |
| Observed | 2026-09-08 |
| Host repository | `pascalorg/editor` |
| Local implementation | Current local checkout (unreleased), local browser sidecar only |
| Host issue / PR | TBD |
| Required Pascal version | First published host release containing presentation configuration contributions and Editor sidecar ownership; version not assigned |
| Plugin evidence | `src/presentation.tsx`, `src/store.ts` |
| Host evidence | `packages/viewer/src/components/viewer/viewer-presentations.tsx`, `packages/editor/src/components/editor/index.tsx`, `packages/editor/src/lib/local-project-presentation-persistence.ts` |

Environment still exposes the explicit, standalone handoff:
`EnvironmentConfigurationSchema`, `exportEnvironmentConfiguration()`, and
`importEnvironmentConfiguration(unknown)`. Version 1 is strict and contains
preset, seed, complete frontage contexts, complete sky settings (including god
rays and time of day), surroundings and sky visibility, and rain, snow, wind,
and storm state. Import validates the complete snapshot before mutation.

The public viewer contribution now optionally exposes:

```ts
type ViewerPresentationConfiguration = {
  getSnapshot(): unknown
  restore(snapshot: unknown): void
  reset(): void
  subscribe(onChange: () => void): () => void
}
```

Environment implements that interface with its validated export/import
functions. Missing or invalid configuration resets from
`useEnvironmentStore.getInitialState()` rather than cloning the current
project. Restore and reset explicitly disable thunder audio consent, sky
playback, and sky motion, so loading a project never autoplays project-authored
time animation or audio. Ambient surroundings motion is not part of the
project sidecar and retains its current host preference.

The reusable Editor owns one persistence manager outside all React Three Fiber
scenes. Normal, split, 2D, preview, and capture compositions therefore share one
writer. Registered presentation configuration is stored under the exact key
`pascal:project-presentation:v1:${encodeURIComponent(projectId)}` in this
versioned local sidecar:

```ts
{
  version: 1,
  projectId,
  contributions: {
    "pascal:environment:presentation": EnvironmentConfigurationV1
  }
}
```

On a project change the manager flushes the old key before reading the new key,
then restores that project's snapshot or resets to initial defaults before
revealing registered presentation. Writes from sliders are coalesced and
pending state is flushed on `pagehide`, Editor unmount, and project switch.
Malformed JSON, an unknown sidecar version, invalid plugin configuration,
unavailable storage, or quota failure cannot affect semantic scene storage or
crash the Editor. Registry changes preserve detached snapshots, so HMR and
plugin unregister/re-register cycles retain the saved configuration.

This is deliberately local browser persistence, not cloud or share
persistence. The Editor's `onLoad`/`onSave` scene contract and `SceneGraph`
remain unchanged, and no server project field has been assigned. A cloud host
must continue to call `exportEnvironmentConfiguration()` and
`importEnvironmentConfiguration(unknown)` through its own versioned project
sidecar. No published Pascal release containing this interface has been
assigned.

Acceptance checks:

- A new project starts with atmosphere enabled.
- Version 1 round-trips preset, seed, frontages, sky/time/god rays, visibility, rain, snow, wind, and storm.
- Reload restores the matching local project; another project restores its own value or initial defaults.
- A project switch flushes the old project before resetting or restoring the next project.
- Corrupted presentation storage recovers without changing scene JSON.
- HMR and plugin unregister/re-register retain the saved project configuration.
- One Editor owns persistence even when it mounts multiple Viewer scenes.
- Restore disables thunder audio consent, sky playback, and sky motion.
- Standalone hosts retain the explicit validated export/import handoff.
- Scene graph JSON, authored nodes, history, and geometry export remain unchanged.

## Deployment gate

Before publishing or deploying Environment:

- [ ] Every host API gap discovered during development has an entry in this register.
- [ ] Every enabled feature has no open **Blocked** or **Host change required** entry.
- [ ] Every required Editor change has a linked issue/PR and released Pascal version.
- [ ] `peerDependencies` reflects the first Pascal version containing all required host changes.
- [ ] Validation runs against installed `@pascal-app/*` packages, not only a locally patched Editor checkout.
- [ ] Hosts claiming saved Environment presentation persist the versioned configuration in a project sidecar and restore it through the public import.
- [ ] No Environment source imports Editor internals or coordinates host behavior with timers.
- [ ] Unsupported selector zones remain visibly marked **Coming soon** and cannot activate.
- [ ] Build, Terrain, keyboard focus, hover, and panel transitions pass an end-to-end smoke test.
- [ ] The plugin works without any uncommitted change in the host repository.

## Adding an entry

Record a gap as soon as one of these occurs:

- a public API call cannot express the intended transition;
- correct behavior requires changing Pascal Editor;
- plugin code needs a cast around a host-owned identifier;
- an internal host module would need to be imported;
- multiple public store writes race a host mount/effect;
- a local host patch is required for validation.

Each entry must include user impact, current public calls, why the plugin cannot own the fix, the smallest acceptable host evolution, a safe deployment fallback, and executable acceptance checks.
