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
- focused source research and the pinned local Streetscape presentation port, including repetitive schema and rendering adapters;
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

The natural curriculum remains the production path, but the 2 September evening demo may temporarily bring forward one disposable suburb tracer bullet. This fast track reuses Lesson 1 and must not silently solve the later terrain or PLU lessons with ad hoc production code. Streetscape is the road visual reference. Because the plugins intentionally have no runtime interconnection, Environment carries a pinned local port of the required pure presentation algorithms instead of patching or deep-importing Streetscape; this is agent-authored compatibility work, not learner evidence.

### Fast track E0 — Close the current visual gate

Restore the touched build/test baseline, then visually accept the frontage selector: explicit non-cycling selectors, outward arrows, one-edge-only state changes, keyboard parity, shared camera-relative floorplan orientation and paint-tool cancellation. Do not expand scope while the editor cannot render the probe reliably.

Status: automated gate green (`112/112` Environment tests; Environment and Editor host typechecks pass). The explicit-selector and camera-orientation correction is implemented with focused pure contracts. Human visual acceptance remains open.

### Fast track E1 — Disposable presentation root

Mount one obvious diagnostic object through `viewerSceneSlot`, structurally outside Pascal's authoring root. Toggle it and confirm that node count, serialization and export inputs do not change.

Status: implemented in both Editor entry paths under `environment-surroundings-root`; the disposable cube has now been replaced by E2. Human confirmation of outliner/history/export isolation remains open.

Human decision: identify visually which geometry belongs to the authored Site and which geometry may disappear without data loss.

### Fast track E2 — One street and neighbor band

From one selected frontage, derive a straight diagnostic road strip and a shallow band of neighboring property descriptors. Keep elevation flat for this proof and render the property boundaries before houses.

Status: implemented test-first as one pure 2D layout derived from `Site.polygon`, then consumed by both the SVG selector and 3D scene. Tangent and outward normal orient each road/property band. The agent-authored `6 m / 9 m` rectangles remain covered as **diagnostic topology**. The miter/bevel junction polygon remains a 2D topology representation, while retained 3D presentation uses a tangent centerline and Streetscape-compatible bands. The neighboring band remains `22 m` deep with approximately `8 m` target property frontage. Explicit selectors and Pascal’s camera-relative, `-Z`-up floorplan convention are implemented. Focused contracts and typechecks are green.

Streetscape is the canonical road grammar. E2 remains valuable because it proves where a road belongs and which neighboring cells depend on it; it must not become a second road system.

Human decision: choose the visible road side and verify that the same frontage drives both 2D and 3D. No unaided polygon-math exercise is required.

### Fast track E2A — Read one Streetscape cross-section

Place or inspect one authored Streetscape `local-street` road and identify its visible bands from center outward: carriageway, optional gutter/curb, verge and sidewalk. Toggle only one official style variable or compare it with `collector` so each band's ownership is visible.

Agent scaffold: expose the relevant preset data in a small diagnostic table and prepare the authored-road comparison fixture. No Environment production code in this session.

Human decision: accept `local-street` as the secondary-road mapping and judge whether `collector` has the right primary-road mood. The goal is visual vocabulary, not memorizing dimensions.

### Fast track E2B — Pinned local road presentation kernel

Port the pure subset needed for the bounded road proof from Streetscape commit `1c04ec9ccb3fa8124ec56dfc1026567cbbc51aef`: `local-street` and `collector` values, ordered cross-sections, transition profiles, degree-three/four junction boundaries, nested side bands, regional packs, markings and pure surface geometry. Keep the Environment-owned copy provenance-pinned and free of React editor/store/registry behavior. Do not patch `node_modules` or deep-import Streetscape at runtime.

Agent scaffold: isolated types/functions, parity tests for `10.4 m` and `15.7 m`, graph/descriptor plumbing and dependency guards. This is explicitly agent-authored infrastructure and does not count as procedural learner evidence.

Status: implemented. The pinned pure kernel now feeds an Environment-owned runtime graph and descriptor adapter for straight roads, preserved degree-two secondary curves, degree-three primary/secondary T junctions and degree-four primary crossings. The copied algorithm files remain byte-identical to the pinned commit; the adapter's intentional clipped-carriageway rule is documented under E2E-B. Visual acceptance of the corrected junction remains open.

Human mechanism, deferred in low-energy mode: visually compare one Environment T/crossing with the reference Streetscape intersection and request concrete adjustments.

### Fast track E2C — One frontage, one matching road

Convert one frontage frame into a two-point centerline and feed it to the pinned local builder. Render carriageway, gutter, curb, verge and sidewalk under `environment-surroundings-root`. Move the neighbor cells outward using the copied complete cross-section width instead of `6 m / 9 m`.

Agent scaffold: one red parity contract, R3F descriptor rendering and scene-mutation snapshots.

Status: implemented. The 2D preview and neighboring-cell offsets use the complete `10.4 m / 15.7 m` widths. The 3D layer renders carriageway, gutter, curb, verge and sidewalk under `environment-surroundings-root`, disables road raycasting and releases transient resources through R3F's deferred object lifecycle. `secondary-road` maps to `local-street`; `collector` remains a provisional primary-road candidate.

Human decision: compare the derived road beside the authored Streetscape road and accept or reject width, band order, material rhythm and orientation. Only one straight secondary road is in scope.

### Fast track E2D — Adjacent frontages and one degree-two bend

Connect two adjacent same-style selected frontages with a tangent 11-point centerline, then merge straight → bend → straight into one presentation alignment before the pinned renderer generates every cross-section band. The old miter/bevel polygon stays a 2D topology representation and is never the retained 3D road. The later graph slice preserves this degree-two behavior while adding copied Streetscape degree-three/four junction boundaries, transitions and markings.

Agent-authored status: implemented in low-energy mode with a red regression contract reproducing the separate-ribbon seam. Focused road tests pass `13/13`; the complete Environment suite passes `116/116`, both Environment/Editor typechecks pass, and the Next/Turbopack production build completes with only the known MCP dynamic-filesystem tracing warning. This implementation does not count as learner mastery.

Human decision: select two adjacent edges with the same road type and verify that every band remains closed through both joins. Then inspect one mixed primary/secondary corner only to decide whether its provisional primary connector is acceptable. This is visual acceptance, not a derivation quiz.

### Fast track E2E — Road-first neighboring cells

Build the neighborhood substrate before extending roads or placing houses.

#### E2E-A — Visible candidate-cell ring

Generate one deterministic row of quadrilateral cells from every Site frontage and one explicit bounded cell at every convex corner. The ring exists even when every separator is `none`; its depth reserves the widest supported road plus the neighbor depth. Road selection must not move cell IDs or polygons. Render the same cell polygons in the camera-relative SVG preview and as flat, non-raycastable meshes under `environment-surroundings-root`.

Agent-authored status: implemented. The old road-dependent property rectangles were removed. Focused Surroundings tests pass `15/15`, the full Environment suite passes `119/119`, Environment typecheck passes and project diagnostics report no errors or warnings. Human visual acceptance remains open.

Human decision: verify that the result reads as one complete first ring with distinct frontage and corner cells, and that selecting a road overlays the same cells rather than replacing or moving them.

#### E2E-B — Through-road occupation and access

After E2E-A, extend primary road axes in both tangent directions to the bounded surroundings extent. Adjacent independent primary and secondary axes create shared graph nodes rather than default bends. Feed the in-memory graph to the pinned local Streetscape presentation kernel for real junction footprints, curb returns, trimming and markings. Cell transport/residual/buildable classification follows after this visual road-parity gate.

Agent-authored road-parity status: implemented with shared degree-three/four nodes, primary approach selection, preserved three-frontage secondary curves and geometry-derived feeder extension that remains valid at acute Site corners. Following visual rejection of black fan artifacts and depth flicker, Environment intentionally differs from Streetscape's current carriageway underlap: every approach carriageway is built from clipped transition samples and stops at its approach cut, leaving the junction footprint as the sole carriageway surface inside the intersection. Indexed normals follow the actual triangle winding. A later all-secondary visual pass exposed a diagonal closure wedge where the duplicate loop endpoint used two one-sided tangents; the local ribbon adapter now uses one canonical endpoint and cyclic seam tangent for all closed carriageway/side-band ribbons. A close mixed-T inspection then confirmed the copied maximum-width junction bands carried the collector bike lane `1.6 m` beyond the local carriageway edge. The local adapter now builds each component from class-aware side paths: its width and cumulative offset match each incident road at that road's cut and interpolate around the curb return, tapering absent components to zero. These bounded host corrections are covered by deterministic tests and do not modify the pinned copied files. Human visual acceptance remains open.

Human decision: recheck the same primary/secondary two-T view after hot reload. Verify that black fans and triangular depth flicker are gone, the junction patch matches the primary carriageway, each feeder stops cleanly at the T, curb returns plus crosswalks remain intact, and the green collector bike lane tapers into each mixed curb return instead of wrapping around the secondary mouth.

After that visual gate is accepted, classify cells crossed by a primary continuation as transport/residual space and derive access relationships for usable cells on both signed sides.

### Fast track E3 — Blocky suburban shells

Turn a small number of buildable E2E cell descriptors into seeded, low-poly shells using footprint, body height, simple roof direction and restrained color variation. No doors, windows, interiors, PLU, imported assets or author nodes.

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

### Extension S1 — Frontage-driven Streetscape-parity corridor

Promote the pinned local presentation kernel without changing runtime ownership: selected frontages remain Environment boundary conditions, and the copied Streetscape algorithms remain the visual reference for road cross-sections, materials, junctions and markings. No runtime deep import and no author `RoadNetworkNode` are allowed.

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

Run the low-energy visual recheck of both corrected cases: the primary/secondary two-T view and the current polygon with every frontage set to `Secondary road`. For the T view, verify that black fans and triangular depth flicker are gone, the junction patch matches the primary carriageway, feeders stop cleanly at their cuts, and curb returns, centerlines, arrows, stop lines and crosswalks remain intact. For the closed secondary loop, verify that the previously marked lower-left seam no longer sends a diagonal side-band strip across the road. For the mixed T, verify that the collector bike lane narrows into the curb return and no longer creates the large green/diagonal patch at the secondary mouth. Confirm that all generated meshes remain non-interactive and absent from outliner/history/export. Keep visual acceptance open until both corrected views pass, then accept the road-parity gate before cell classification or shells.
