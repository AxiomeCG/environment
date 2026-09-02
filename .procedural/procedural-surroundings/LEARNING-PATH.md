# Procedural Surroundings — Craftsman Learning Path

> Goal: understand and own the implementation from Site-polygon frontages to deterministic terrain, vegetation, horizon masking and bounded TSL enrichment. Sessions are short, code-backed and evidence-driven.

## Working agreement

Each lesson follows the same loop:

```text
cold prediction
→ one red contract
→ smallest human-authored mechanism
→ green test
→ visual probe
→ explain-back
→ evidence note
```

### Human ownership

Adam writes or dictates the consequential mechanism:

- polygon winding, frontages and outward-normal reasoning;
- deterministic spatial hashing decisions;
- terrain field and boundary-transfer curves;
- meadow and woodland population grammar;
- horizon masking and LOD decisions;
- optional road-frontage semantics, visual cross-section reading and neighbor build-line reasoning;
- TSL variation and wind behavior;
- perceptual acceptance.

### Agent ownership

The agent may prepare:

- file scaffolds and type signatures;
- fixtures and red tests;
- R3F wiring that carries no hidden procedural decision;
- test commands, diagnostics and profiling harnesses;
- focused source research and the repetitive upstream wiring for a pure Streetscape presentation seam;
- session notes and evidence status.

A complete solution is not revealed while a smaller hint can unblock the learner.

## Adaptive hint ladder

Every exercise uses the smallest effective intervention:

1. **Cold probe** — no hints; explain or sketch from memory.
2. **Constraint reminder** — restate an invariant, not the algorithm.
3. **Counterexample** — provide an input that breaks the current model.
4. **Narrowed problem** — solve one candidate cell or one edge.
5. **Pseudocode skeleton** — expose control flow, leave the consequential expression blank.
6. **Worked neighboring example** — solve a different input completely.
7. **Pair implementation** — only after the learner explains the mechanism back.

The manifest records the highest scaffold required. Status cannot become `solid` from agent-authored code.

## Evidence levels

| Status | Meaning |
|---|---|
| `gap` | not yet probed or no usable model |
| `shaky` | partial model; succeeds with hints or fails transfer |
| `solid` | succeeds live on the target mechanism and a fresh variant |
| `durable` | succeeds again after a delay without reopening the note |
| `false-confidence` | fluent explanation contradicted by code or evidence |

Operational success—build, Git, wiring—does not count as conceptual mastery unless it exercises the target mechanism.

## Session shape

Target duration: 25–40 minutes.

- 3–5 min: cold probe and prediction.
- 10–15 min: one mechanism.
- 5–10 min: test and visual probe.
- 3–5 min: explain-back and note update.
- Stop while the next step is obvious.

A lesson may span several sessions. No lesson is marked complete because a large diff exists.

### Mode pairing à faible énergie

Quand Adam indique qu’il est en fin de soirée ou qu’il ne souhaite pas apprendre activement, la boucle pédagogique est suspendue sans bloquer l’implémentation :

- aucun cold probe, quiz mathématique ou explain-back n’est demandé ;
- l’agent implémente une slice bornée, tests et wiring compris, puis résume le mécanisme en quelques lignes ;
- Adam ne porte qu’une validation visuelle simple ou demande un ajustement concret ;
- chaque slice doit rester petite, réversible et observable avant la suivante ;
- le code agent-authored est signalé comme tel et ne compte pas comme preuve de maîtrise ;
- une future session peut reprendre le mécanisme à froid, sans refaire le travail de production.

Ce mode est actif pour la fin de soirée du 2 septembre 2026 : progression accompagnée, pas exercice.

## Curriculum

### Lesson 0 — Authoring and presentation roots

Question: where does Pascal-specific authoring stop and disposable presentation begin?

Evidence:

- draw the dependency graph from memory;
- explain why `SurroundingsRoot` is structurally outside `AuthoringRoot`;
- toggle a diagnostic object without changing nodes, serialization or export;
- identify the exact failing tracer bullet required before changing Pascal upstream.

Production outcome: none beyond a removable diagnostic root.

### Lesson 1 — Polygon frontages and outward normals

Question: how does one selected Site-polygon segment become a stable local frame for neighboring context?

Human mechanism:

- preserve the polygon's segment identity and detect its winding;
- derive tangent and outward normal without assuming a rectangle;
- attach `none`, `secondary-road` or `primary-road` to a selected frontage;
- keep access across the frontage separate from the separator along it.

Agent scaffold: types, clockwise/counter-clockwise, concave and degenerate fixtures, plus red tests.

Evidence:

- reversing polygon winding keeps every geometric normal pointing outward;
- selecting one segment changes no other segment;
- a concave Site produces the expected local frame on a fresh edge;
- explain why segment indices are snapshot-local rather than durable project IDs.

Visual probe: a small 2D Site selector with color-coded frontages, outward arrows and one explicit native separator selector per edge. At azimuth zero, world `-Z` is screen-up; rotating the 3D camera rotates the complete diagram exactly like Pascal’s floorplan relationship.

### Lesson 2 — World-coordinate spatial determinism

Question: why must a sample depend on world coordinates rather than traversal order?

Human mechanism: a stable integer hash over semantic seed domain and chunk/sample coordinates.

Agent scaffold: permutation, window-expansion and negative-coordinate fixtures.

Evidence:

- reordering chunks does not change output;
- expanding the visible window does not move existing samples;
- changing a style seed preserves terrain and topology checksums;
- a fresh negative-coordinate case succeeds without reopening the implementation.

Visual probe: debug colors remain attached while the chunk window changes.

### Lesson 3 — Continuous exterior terrain

Question: how can independently regenerated chunks share exact borders?

Human mechanism: one world-coordinate height function sampled by every chunk.

Agent scaffold: adjacent-chunk edge fixtures, a profile plot and seam diagnostics.

Evidence:

- shared edge samples are bit-identical;
- chunk traversal and regeneration order do not affect height;
- no radial center assumption appears in the field.

Visual probe: two terrain chunks rendered with wireframe seam diagnostics.

### Lesson 4 — Site-to-exterior transition band

Question: how does the exterior preserve the real Terrain edge and gradually become procedural?

Human mechanism: nearest-boundary projection, distance-to-contour and an intentional transfer curve.

Agent scaffold: flat, sloped, concave and corner fixtures plus profile comparison.

Evidence:

- distance zero reproduces the Pascal edge sample;
- influence decreases monotonically across the approved blend distance;
- corners do not produce a radial or center-based artifact;
- the transfer curve can be explained and redrawn from memory.

Visual probe: an ugly but continuous exterior surface with the blend contribution colorized.

### Lesson 5 — Deterministic open meadow

Question: how do we populate exterior ground without creating author nodes or order-dependent randomness?

Human mechanism: world-space candidates, density acceptance and instance transforms.

Agent scaffold: one shared grass/flower archetype, `InstancedMesh` upload, counters and disposal wiring.

Evidence:

- matrices remain stable when the visible chunk window changes;
- flowers remain sparse and deterministic;
- accepted instances respect terrain height and the Site exclusion;
- geometry ownership is explainable.

Visual probe: the first `Prairie ouverte` preset.

### Lesson 6 — Woodland density, clearings and archetypes

Question: how can a field produce masses and clearings rather than uniform noise?

Human mechanism: continuous density field, threshold shaping and deterministic archetype choice.

Agent scaffold: lightweight trunk/canopy fixtures and cross-chunk clearing tests.

Evidence:

- clearings cross chunk borders;
- archetype choice is stable under LOD-window changes;
- Nature's editable trees are not duplicated or imported;
- density parameters have intentional visual meaning.

Visual probe: the first `Lisière boisée` preset.

### Lesson 7 — Horizon and outer-boundary masking

Question: how do we hide the finite generated window without drawing a square, circle or tree wall?

Human mechanism: combine asymmetric relief, vegetation density, silhouettes and horizon softness.

Agent scaffold: fixed-camera capture matrix and overlays showing the actual outer boundary.

Evidence:

- the last chunk row is not legible from approved cameras;
- multiple Site shapes and seeds avoid a repeated ring silhouette;
- disabling each masking contribution reveals what it owns.

Visual probe: A/B captures from low, normal and elevated cameras.

### Lesson 8 — LOD and stable chunk residency

Question: which representations exist at each distance and how can they change without moving the world?

Human mechanism: explicit near/mid/far representation policy and hysteresis thresholds.

Agent scaffold: residency controller, identity counters and camera-path replay.

Evidence:

- the same world sample keeps the same identity across LOD changes;
- camera oscillation near a threshold does not thrash resources;
- reduced representations keep the horizon filled;
- costs are measured before adding complexity.

Visual probe: slow camera traversal with active LOD and chunk keys displayed.

### Lesson 9 — TSL wind and bounded visual enrichment

Question: how can GPU motion enrich CPU-known placement without becoming authoritative?

Human mechanism: root-preserving sway, per-instance phase and a bounded displacement envelope.

Agent scaffold: diagnostic uniforms, bounds checks, reduced-motion fallback and GPU timing.

Evidence:

- maximum displacement is stated and covered by bounds;
- roots remain visually stable;
- macro terrain, density and placement checksums remain unchanged;
- distant vegetation uses a deliberately simpler response.

Visual probe: wind/color A/B with synchronized-motion diagnostics.

### Lesson 10 — Isolation, export identity and production validation

Question: can the complete layer disappear without leaving evidence in the author asset?

Agent scaffold: bake/export/serialization snapshots, disposal loops and performance capture.

Human evidence:

- predict which root each object belongs to;
- diagnose a deliberately misplaced mesh;
- interpret draw calls, triangle count, buffers and regeneration timings;
- accept or reject the two presets perceptually.

Acceptance:

- nodes and author serialization unchanged;
- bake/export unchanged;
- no `pascalId` or registry entry outside the Site;
- no resource leak;
- visual and performance budgets accepted by the human.

## Time-boxed evening fast track — blocky suburb

The natural curriculum remains the production path, but the 2 September evening demo may temporarily bring forward one disposable suburb tracer bullet. This fast track reuses Lesson 1 and must not silently solve the later terrain or PLU lessons with ad hoc production code. Streetscape is now the approved road grammar, so the fast track includes a few small Streetscape parity sessions before any house shell.

### Fast track E0 — Close the current visual gate

Restore the touched build/test baseline, then visually accept the frontage selector: explicit non-cycling selectors, outward arrows, one-edge-only state changes, keyboard parity, shared camera-relative floorplan orientation and paint-tool cancellation. Do not expand scope while the editor cannot render the probe reliably.

Status: automated gate green (`107/107` Environment tests; Environment and Editor host typechecks pass). The explicit-selector and camera-orientation correction is implemented with focused pure contracts. Human visual acceptance remains open.

### Fast track E1 — Disposable presentation root

Mount one obvious diagnostic object through `viewerSceneSlot`, structurally outside Pascal's authoring root. Toggle it and confirm that node count, serialization and export inputs do not change.

Status: implemented in both Editor entry paths under `environment-surroundings-root`; the disposable cube has now been replaced by E2. Human confirmation of outliner/history/export isolation remains open.

Human decision: identify visually which geometry belongs to the authored Site and which geometry may disappear without data loss.

### Fast track E2 — One street and neighbor band

From one selected frontage, derive a straight diagnostic road strip and a shallow band of neighboring property descriptors. Keep elevation flat for this proof and render the property boundaries before houses.

Status: implemented test-first as one pure 2D layout derived from `Site.polygon`, then projected in both the SVG selector and 3D scene. Tangent and outward normal orient each road/property band. Adjacent road frontages at convex vertices receive an explicit mitered junction patch with a bevel limit; concave vertices rely on the existing overlap. The current agent-authored calibration is `6 m` secondary / `9 m` primary road width, `22 m` neighbor depth and approximately `8 m` target property frontage. The E2 correction now replaces cycling controls with explicit selectors and aligns the SVG scene with Pascal’s camera-relative, `-Z`-up floorplan convention. Focused contracts and typechecks are green.

The road widths, colors and custom junction patches are now frozen as **diagnostic topology**, not a visual calibration target. Streetscape is the canonical road grammar. E2 remains valuable because it proves where a road belongs and which neighboring cells depend on it; it must not become a second road system.

Human decision: choose the visible road side and verify that the same frontage drives both 2D and 3D. No unaided polygon-math exercise is required.

### Fast track E2A — Read one Streetscape cross-section

Place or inspect one authored Streetscape `local-street` road and identify its visible bands from center outward: carriageway, optional gutter/curb, verge and sidewalk. Toggle only one official style variable or compare it with `collector` so each band's ownership is visible.

Agent scaffold: expose the relevant preset data in a small diagnostic table and prepare the authored-road comparison fixture. No Environment production code in this session.

Human decision: accept `local-street` as the secondary-road mapping and judge whether `collector` has the right primary-road mood. The goal is visual vocabulary, not memorizing dimensions.

### Fast track E2B — Pure Streetscape presentation seam

Add the smallest public module that turns one style plus one straight alignment into disposable surface descriptors by composing Streetscape's existing pure mechanisms. It must import no React, editor store, registry, selection or persisted node behavior.

Agent scaffold: API shell, dependency guard tests, compatibility probe against Pascal `1.0.0-beta.5`, exports and repetitive descriptor plumbing. This is explicitly agent-authored infrastructure and does not count as procedural learner evidence.

Human mechanism: explain the boundary in one sentence—Environment says **where the road goes**; Streetscape says **what the road is made of**—and review the descriptor sequence in the diagnostic table.

### Fast track E2C — One frontage, one matching road

Convert one frontage frame into a two-point centerline and feed it to the public Streetscape builder. Render carriageway, gutter, curb, verge and sidewalk under `environment-surroundings-root`. Move the neighbor cells outward using `roadStyleWidth(style)` instead of `6 m / 9 m`.

Agent scaffold: one red parity contract, R3F descriptor rendering and scene-mutation snapshots.

Human decision: compare the derived road beside the authored Streetscape road and accept or reject width, band order, material rhythm and orientation. Only one straight secondary road is in scope.

### Fast track E2D — Adjacent frontages and one junction

Turn two adjacent selected frontages into a small runtime road graph. Replace Environment's custom rectangle patch with Streetscape's junction-boundary result. Add markings only after the road surfaces and curbs match.

Agent scaffold: deterministic graph IDs, convex/concave fixtures and an A/B overlay for the old diagnostic patch versus the Streetscape junction.

Human decision: inspect the corner from the shared 2D/3D view and accept the continuity. This is a shape-reading session, not a derivation quiz.

### Fast track E3 — Blocky suburban shells

Turn a small number of neighbor descriptors into seeded, low-poly shells using footprint, body height, simple roof direction and restrained color variation. No doors, windows, interiors, PLU, imported assets or author nodes.

Human decision: approve the rhythm—spacing, scale and silhouette variation—before increasing shell count.

### Fast track E4 — Concealment, then optional DOF

First soften the distant blockout through haze, lower contrast and simpler silhouettes. Then spend one strict capability spike on viewer-owned DOF or selective blur. A normal depth-based DOF is not accepted as “Site-safe” merely because its focus target is near the active house.

Acceptance:

- the active Site, author geometry, gizmos and overlays remain crisp;
- the suburb loses distracting detail without becoming an unreadable fog bank;
- the effect has an explicit off state;
- if no clean selective seam exists inside the timebox, keep the haze fallback and defer DOF.

### Deferred elevation refinement

After the blockout reads, build elevation in visible layers: exact Site-edge match, transition collar, broad deterministic landform noise, road profile and gentle per-property levels. A spline/NURBS is a candidate for the road's vertical profile, not the default terrain surface.

## Optional production suburb extension

The approved topology leaves a Sims-like production extension open without treating the evening blockout as completed architecture.

### Extension S1 — Frontage-driven Streetscape corridor

Promote the proven E2A–E2D tracer into the optional production suburb extension without changing its ownership: selected frontages remain Environment boundary conditions, and Streetscape remains the sole source for road cross-sections, materials, junctions and markings. No deep import and no author `RoadNetworkNode` are allowed.

### Extension S2 — Neighbor property and build line

Derive the near neighboring-property band across the road. For total road width `W`, neighbor front setback `S` and house depth `D`, predict and test:

```text
neighbor build line = W + S
neighbor house center = W + S + D / 2
```

Render only property cells and build-line diagnostics first. Road separation, driveway/path access and house orientation remain independent concepts.

### Extension S3 — One suburban shell

Only after S1–S2 and explicit scope approval, turn one neighbor descriptor into a disposable presentation shell. PLU, a full neighborhood and shell batching become separate later lessons rather than hidden parts of Surroundings core.

## Lesson gates

A lesson advances only when:

1. the focused tests are green;
2. the visible probe matches the lesson invariant;
3. Adam can explain the mechanism without reading its code;
4. one fresh transfer case succeeds;
5. the Vaulty concept note records evidence honestly.

## Anti-slop rules

- No full generator before polygon winding, frontage selection and outward normals are understood.
- No TSL before the CPU geometry and bounds are inspectable.
- No optimization before a measurement names the current cost.
- No new public parameter without an intentional artist use.
- No upstream Pascal change without a failing tracer bullet.
- No `solid` status from code generated entirely by the agent.

## Immediate next step

In low-energy pairing mode, the agent now scaffolds fast track E2B: the smallest upstream pure Streetscape presentation API plus dependency guards and the Pascal `1.0.0-beta.5` compatibility probe. It then wires one `local-street` frontage in E2C and presents a simple visual A/B for Adam to accept or adjust. No cold probe or cross-section quiz is required. Do not tune Environment's `6 m / 9 m` rectangles, start E3 shells, terrain elevation or DOF until that one straight road matches its authored Streetscape reference.
