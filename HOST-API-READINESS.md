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
