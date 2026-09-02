# Pascal host API readiness

This living register records every Environment feature that cannot be implemented safely through Pascal's published plugin API alone. It is a deployment gate: the plugin must not rely on untracked host patches, timing workarounds, internal imports, or unchecked casts.

## Status vocabulary

- **Blocked** — the feature must remain disabled in the shipped selector.
- **Host change required** — a Pascal Editor change is identified but not released.
- **Accepted workaround** — a temporary workaround has an explicit owner and removal version.
- **Resolved** — the host change is released, the minimum peer version is updated, and acceptance checks pass against installed packages.

## Open gaps

### ENV-HOST-001 — Opening Terrain is reset when the Build panel mounts

| Field | Value |
|---|---|
| Status | **Host change required — deployment blocker while the Terrain zone is enabled** |
| Observed | 2026-09-01 |
| Host repository | `pascalorg/editor` |
| Host issue / PR | TBD |
| Required Pascal version | TBD after release |
| Plugin evidence | `src/pascal-tool-actions.ts` |
| Host evidence | `apps/editor/components/build-tab.tsx` |

Environment can call the published editor store methods:

```ts
editor.setMode('terrain-sculpt')
editor.setActiveSidebarPanel('build')
```

The mode transition itself succeeds. The standalone Editor's `BuildTab` then mounts and initializes its first construction tool whenever the current state is not an already-armed `build` tool. That initialization replaces `terrain-sculpt`, so the user lands on the default Build tool instead of the native Terrain controls.

The plugin must not solve this with `setTimeout`, duplicated Terrain controls, or imports from Editor internals. The minimum host evolution is for `BuildTab` initialization to preserve Build-owned special modes that are already active, including `terrain-sculpt` and `material-paint`. A stronger long-term API would expose one atomic public action for opening a built-in editor tool and its owning panel.

Until resolved, deployment must do one of the following:

1. ship against a Pascal release containing the host fix; or
2. keep the Terrain hotspot disabled.

Acceptance checks:

- Clicking the mound opens the existing Build panel.
- `useEditor.getState().mode` remains `terrain-sculpt` after `BuildTab` mounts.
- The native `TerrainSculptPanel` is visible; Environment does not render a copy.
- The Terrain tile is active and the default construction tool is not armed.
- The flow works after a cold load and after switching from Ground Cover.

### ENV-HOST-002 — Plugin-owned tool identifiers require an unchecked cast

| Field | Value |
|---|---|
| Status | **Host change required — API design debt** |
| Observed | 2026-09-01 |
| Host repository | `pascalorg/editor` |
| Host issue / PR | TBD |
| Required Pascal version | TBD after release |
| Plugin evidence | `src/panel.tsx` (`setPluginTool`) |

Ground Cover is registered by a plugin as `environment:ground-cover`, but the public `setTool` function is typed with Editor's closed built-in `Tool` union. Runtime registration supports the plugin tool, while TypeScript requires Environment to widen the setter manually:

```ts
const setTool = useEditor.getState().setTool as (value: string) => void
```

The public contract should support registry-owned plugin tool identifiers without a cast. This can be an extensible tool identifier type or a dedicated plugin-tool activation action that validates the identifier against the loaded registry.

Acceptance checks:

- Environment activates `environment:ground-cover` without `as` or an internal import.
- The registered plugin tool mounts through the normal `ToolManager` lifecycle.
- Escape/cancel behavior remains identical to built-in tools.
- An unknown plugin tool identifier fails explicitly rather than silently arming invalid state.

### ENV-HOST-003 — Floorplan discovery has no Site scope

| Field | Value |
|---|---|
| Status | **Host change required — implemented locally; release blocker for Ground Cover display in Editor 2D** |
| Observed | 2026-09-02 |
| Host repository | `pascalorg/editor` |
| Host issue / PR | TBD |
| Required Pascal version | TBD after release |
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
| Observed | 2026-09-02 |
| Host repository | `pascalorg/editor` |
| Host issue / PR | TBD |
| Required Pascal version | TBD after release |
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
| Observed | 2026-09-02 |
| Host repository | `pascalorg/editor` |
| Host issue / PR | TBD |
| Required Pascal version | TBD after release |
| Plugin evidence | `src/ground-cover/definition.ts`, `src/surface-material/definition.ts` |
| Host evidence | `packages/core/src/registry/types.ts`, `packages/core/src/registry/registry.ts`, `packages/core/src/registry/registry.test.ts`, `packages/editor/src/components/editor/selection-manager.tsx` |

The Editor currently highlights selection and hover by replacing materials in a registered node's rendered subtree. That is unsafe for Environment paint layers: Ground Cover and Surface use authored NodeMaterial graphs, textures, masks and opacity whose meaning is lost when the host substitutes a generic selection material. The node must remain selected so its panel and tool lifecycle work, but its rendered material must remain owned by the plugin.

The local host adds `capabilities.selectionHighlight?: boolean`, defaulting to `true` for compatibility. The registry exposes a generic query and the selection manager honors it for both committed selection and hover/outliner synchronization. Environment sets the capability to `false`; no Environment kind is named by the host.

Until the capability is released, selecting these paint layers may obscure the result being edited. Published-host deployment must not claim faithful interactive material preview.

Acceptance checks:

- A registered kind with `selectionHighlight: false` remains semantically selected without material substitution.
- Hover and outliner synchronization also preserve its authored materials.
- Its inspector, plugin tool activation, Escape behavior and deletion policy remain unchanged.
- Existing and unregistered kinds retain selection highlighting by default.
- Loading or unloading a plugin refreshes the registry-driven behavior without a hardcoded kind check.

### ENV-HOST-006 — Plugins cannot register presentation-only viewer scene layers

| Field | Value |
|---|---|
| Status | **Host change required — local direct mount only; release blocker for Surroundings** |
| Observed | 2026-09-02 |
| Host repository | `pascalorg/editor` |
| Host issue / PR | TBD |
| Required Pascal version | TBD after release |
| Plugin evidence | `src/surroundings/layer.tsx`, `src/index.ts` |
| Host evidence | `packages/editor/src/components/editor/index.tsx` (`viewerSceneSlot`), `apps/editor/app/page.tsx`, `apps/editor/components/scene-loader.tsx` |

`Editor` already accepts a host-owned `viewerSceneSlot`, which proves that a presentation subtree can be mounted inside the React Three Fiber scene but outside the semantic `scene-renderer`. The plugin discovery contract cannot contribute to that slot. The local tracer bullet therefore imports `SurroundingsLayer` directly from Environment in both Editor application entry points. That validates isolation, but it is not a publishable plugin integration: the host application now knows one plugin package and must remember every route that mounts an Editor.

The minimum host evolution is a registry-driven presentation contribution mounted once by every Editor entry point after plugin discovery. Its lifecycle must follow plugin load/unload, and it must remain outside the semantic node registry, authoring root, selection, queries and geometry export. A later persisted Environment preset also needs an explicit project-scoped presentation-state contract; until that contract is designed, the tracer bullet remains runtime-only and must not hide state in node metadata.

Until resolved, Surroundings stays disabled in shipped plugin selectors. Direct application imports are permitted only in the local validation harness and must not be presented as the production integration.

Acceptance checks:

- Loading Environment registers its presentation contribution without importing the plugin from an Editor application route.
- Blank-scene and saved-scene Editor entry points mount the contribution exactly once.
- Unloading or omitting the plugin removes the layer and releases its Three.js resources.
- The contribution creates no semantic node, `pascalId`, selection target, query result, history entry or serialized scene data.
- Geometry/GLB export is byte-for-byte unchanged with the presentation layer enabled or disabled.
- Viewer snapshots may include the layer only through an explicit presentation policy.
- Unknown or failing contributions are isolated without preventing the authored scene from rendering.

## Deployment gate

Before publishing or deploying Environment:

- [ ] Every host API gap discovered during development has an entry in this register.
- [ ] Every enabled feature has no open **Blocked** or **Host change required** entry.
- [ ] Every required Editor change has a linked issue/PR and released Pascal version.
- [ ] `peerDependencies` reflects the first Pascal version containing all required host changes.
- [ ] Validation runs against installed `@pascal-app/*` packages, not only a locally patched Editor checkout.
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
