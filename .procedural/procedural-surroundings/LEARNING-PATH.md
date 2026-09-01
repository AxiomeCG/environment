# Procedural Surroundings — Craftsman Learning Path

> Goal: understand and own the implementation from footprint topology to TSL enrichment. Sessions are short, code-backed and evidence-driven.

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

- ring-distance and topology reasoning;
- deterministic spatial hashing decisions;
- terrain field and transfer curves;
- parcel/PLU rules;
- shell silhouette and geometry assembly;
- batching strategy decisions;
- TSL variation, wind and LOD behavior;
- perceptual acceptance.

### Agent ownership

The agent may prepare:

- file scaffolds and type signatures;
- fixtures and red tests;
- R3F wiring that carries no hidden procedural decision;
- test commands, diagnostics and profiling harnesses;
- focused source research;
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

## Curriculum

### Lesson 0 — Trusted seams

Question: where does Pascal-specific knowledge stop?

Evidence:

- draw the dependency graph from memory;
- explain why the surroundings root is structurally outside the author root;
- identify the exact proof required before changing Pascal upstream.

Production outcome: none. This is a read-only architecture lesson.

### Lesson 1 — Chebyshev rings around an arbitrary footprint

Question: how do we classify every surrounding cell without assuming a square parcel?

Human mechanism:

```text
min over active cells of max(abs(dx), abs(dy))
```

Agent scaffold: types, normal/boundary fixtures and red tests.

Evidence:

- 1×1 → 8 ring-1 cells;
- 4×2 → 16 ring-1 cells;
- explain why a bounding rectangle alone is insufficient for an arbitrary footprint;
- transfer to an L-shaped footprint without reopening the implementation.

Visual probe: colored debug tiles mounted through `viewerSceneSlot`.

### Lesson 2 — Spatial determinism

Question: why must the seed depend on world coordinates rather than traversal order?

Human mechanism: stable integer hash over semantic seed domain and cell coordinates.

Agent scaffold: permutation and ring-expansion fixtures.

Evidence:

- reordering input cells does not change output;
- adding an outer ring does not move inner samples;
- changing `styleSeed` preserves topology checksums.

Visual probe: per-cell colors remain attached while ring count changes.

### Lesson 3 — Continuous CPU terrain

Question: how can independently regenerated chunks share exact borders?

Human mechanism: world-coordinate height field and footprint-relative amplitude transfer.

Agent scaffold: adjacent-chunk edge fixtures and profile plot.

Evidence:

- shared edge samples are bit-identical;
- amplitude joins softly near the active footprint;
- no radial center assumption appears in the transfer function.

Visual probe: two terrain chunks rendered with wireframe seam diagnostics.

### Lesson 4 — Forest population and `InstancedMesh`

Question: which data varies per tree and which geometry is genuinely identical?

Human mechanism: deterministic candidates, density acceptance and archetype choice.

Agent scaffold: simple runtime trunk/canopy archetypes, instance upload and counters.

Evidence:

- clearings cross chunk borders;
- matrices remain stable when the visible chunk window changes;
- explain geometry ownership and disposal.

Visual probe: first completely filled forest surrounding.

### Lesson 5 — Roads, blocks and contiguous lots

Question: how do constraints produce a coherent neighborhood before houses exist?

Human mechanism: road graph and deterministic lot partition under a small PLU.

Agent scaffold: plan-view fixtures and overlap/hole tests.

Evidence:

- lots are contiguous and non-overlapping;
- a lot may span several cells;
- every empty region is intentional and classified.

Visual probe: colored roads/lots on the terrain, no shells yet.

### Lesson 6 — One lightweight house shell

Question: how does one descriptor become walls, slab and roof without nodes?

Human mechanism: footprint extrusion, facade rhythm and roof-family assembly.

Agent scaffold: public Pascal primitive research, geometry validation and debug normals.

Evidence:

- one descriptor produces one disposable shell geometry;
- bounds and triangle counts are explainable;
- no Pascal node or scene mutation occurs.

Visual probe: one enlarged neighboring house, then a small family.

### Lesson 7 — Geometry signatures and `BatchedMesh`

Question: when are two shells reusable, and when are they genuinely different?

Human mechanism: quantized stable signature and archetype budget behavior.

Agent scaffold: cache lifecycle tests, batch upload and metrics.

Evidence:

- palette-only changes do not create geometry;
- unique shell count stays within 12–16;
- repeated regeneration preserves unaffected resource identity.

Visual probe: coherent urban neighborhood under the draw-call budget.

### Lesson 8 — TSL facade variation

Question: which variety belongs in material attributes rather than topology?

Human mechanism: facade coordinate system, palette lookup and analytic windows/doors.

Agent scaffold: NodeMaterial wiring and fixed-camera capture harness.

Evidence:

- style changes do not move lots or shells;
- explain which attributes are per batch, geometry or instance;
- bounds remain valid because displacement is absent or bounded.

Visual probe: Sims-like related houses without detail meshes.

### Lesson 9 — Wind, micro-relief and visual LOD transitions

Question: how can GPU motion enrich CPU-known structure without becoming authoritative?

Human mechanism: bounded displacement and transition envelope.

Agent scaffold: diagnostic uniforms, bounds checks and GPU timing.

Evidence:

- maximum displacement is stated and tested;
- macro terrain and placement remain unchanged;
- reduced-motion or static fallback remains legible.

Visual probe: living forest and progressive distant representation.

### Lesson 10 — Isolation and production validation

Question: can the complete layer disappear without leaving evidence in the author asset?

Agent scaffold: bake/export/serialization snapshots, disposal loops and perf capture.

Human evidence:

- predict which root each object belongs to;
- diagnose a deliberately misplaced mesh;
- interpret draw calls, triangle count, buffers and regeneration timings.

Acceptance:

- nodes unchanged;
- author serialization unchanged;
- bake/export unchanged;
- no resource leak;
- visual and performance budgets accepted by the human.

## Lesson gates

A lesson advances only when:

1. the focused tests are green;
2. the visible probe matches the lesson invariant;
3. Adam can explain the mechanism without reading its code;
4. one fresh transfer case succeeds;
5. the Vaulty concept note records evidence honestly.

## Anti-slop rules

- No full generator before the ring tests are understood.
- No TSL before the CPU geometry and bounds are inspectable.
- No optimization before a measurement names the current cost.
- No new public parameter without an intentional artist use.
- No upstream Pascal change without a failing tracer bullet.
- No `solid` status from code generated entirely by the agent.

## Immediate next step

Open `LESSON-01-RINGS.md`. The agent creates the red tests and function shell; Adam implements only the ring mechanism. The first target is pure TypeScript and requires no unresolved visual choice.
