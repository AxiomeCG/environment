# Lesson 01 — Chebyshev Rings

> Scope: one pure TypeScript mechanism. No Three.js, React, terrain, houses or seeds.

## Terminology

“Chebyshev ring” is project shorthand, not the most common textbook phrase. Search for `Chebyshev distance`, `L∞ distance`, `chessboard distance`, `king's move distance`, `Moore neighborhood`, or `morphological dilation with a square structuring element`.

For one active cell, ring 1 is the Moore neighborhood of radius 1 with the center removed. A ring of index `r` is the discrete shell whose minimum Chebyshev distance to the active footprint is exactly `r`.

The chessboard intuition is the shortest path of a king, which may move horizontally, vertically or diagonally:

```text
2 2 2 2 2
2 1 1 1 2
2 1 0 1 2
2 1 1 1 2
2 2 2 2 2
```

This is why diagonal and axial neighbors both belong to ring 1.

## Learning objective

Given an arbitrary set of active integer cells, enumerate every non-active cell up to a configured Chebyshev distance and attach its ring number.

At the end, you should be able to:

- explain why Chebyshev distance matches square-neighborhood rings;
- derive the 1×1 and 4×2 expected counts;
- implement the generator without relying on a rectangular active footprint;
- predict the ring of a cell around an L-shaped footprint;
- explain why canonical output order matters for later determinism.

## Cold prediction

Before opening the implementation, answer on paper:

1. What are the eight ring-1 coordinates around `(0, 0)`?
2. Why does `max(abs(dx), abs(dy))` classify diagonal neighbors as ring 1?
3. A 4×2 rectangle dilates to 6×4 at ring 1. Why does that imply 16 surrounding cells?
4. For an arbitrary footprint, why must the distance take a minimum over every active cell?

Do not optimize yet. A correct transparent implementation is the goal.

## Contract

Proposed interface:

```ts
type Cell = Readonly<{ x: number; y: number }>
type RingCell = Cell & Readonly<{ ring: number }>

function generateRingCells(input: {
  footprint: readonly Cell[]
  ringCount: number
}): RingCell[]
```

Behavior:

- active cells are never returned;
- duplicate active coordinates behave as one cell;
- `ringCount = 0` returns `[]`;
- an empty footprint returns `[]`;
- non-integer or negative `ringCount` is rejected;
- output includes every cell in rings `1…ringCount`;
- output order is canonical and independent of footprint input order.

Canonical order for Lesson 1:

```text
ring ascending → y ascending → x ascending
```

This order is a contract, not the only mathematically valid choice. It makes snapshots and later chunk diffs readable.

## Fixtures prepared by the agent

### Normal case: one active cell

```text
(-1,-1) (0,-1) (1,-1)
(-1, 0) [0, 0] (1, 0)
(-1, 1) (0, 1) (1, 1)
```

Expected ring-1 count: `8`.

### Rectangular transfer: 4×2

```text
active x = 0…3
active y = 0…1
```

The ring-1 envelope has area `6 × 4 = 24`; active area is `4 × 2 = 8`; result is `16`.

### Boundary case: two rings

For one active cell:

- ring 1: `8`;
- ring 2: `16`;
- total: `24`.

### Degenerate cases

- empty footprint;
- zero rings;
- duplicate active coordinates;
- invalid ring count.

## Human-authored mechanism

You own the body of `generateRingCells`.

A straightforward approach is sufficient:

1. normalize active cells into a membership set;
2. compute the active bounds;
3. expand those bounds by `ringCount`;
4. visit every candidate in the expanded bounds;
5. compute the minimum Chebyshev distance to the active cells;
6. keep distances in `1…ringCount`;
7. sort canonically.

The consequential expression remains yours:

```text
min( max(abs(candidate.x - active.x), abs(candidate.y - active.y)) )
```

Do not introduce chunk caches or spatial indices in Lesson 1. We first need a trusted oracle; optimization comes after profiling with larger footprints.

## Adaptive hints

Use only the first hint that unblocks you.

### Hint 1 — invariant

A candidate belongs to ring `r` when its nearest active cell is exactly `r` king moves away on a chessboard.

### Hint 2 — counterexample

If you measure only from the footprint’s center, test the cell immediately beside one end of a 4×2 footprint. Its distance to the center and to the footprint are different.

### Hint 3 — narrowed problem

For candidate `(4, 2)` and active cells `(0,0)`, `(1,0)`, `(2,0)`, `(3,0)`, compute the four Chebyshev distances separately, then take the minimum.

### Hint 4 — control-flow skeleton

```text
for each candidate in expanded bounds
  nearest = infinity
  for each active cell
    distance = ???
    nearest = min(nearest, distance)
  if nearest is in the requested range
    emit candidate with nearest as ring
```

### Hint 5 — neighboring worked example

For candidate `(2, 2)` around active cells `(0,0)` and `(1,0)`:

```text
to (0,0): max(2,2) = 2
to (1,0): max(1,2) = 2
nearest = 2
```

It belongs to ring 2.

## Red-green command

The focused command will be:

```sh
bun test src/surroundings/rings.test.ts
```

The whole suite is run only after the focused contracts pass.

## Explain-back gate

Without opening the file:

> Explain why adding a disconnected active cell can only keep or reduce the ring number of every candidate, never increase it.

Then solve one fresh L-shaped footprint cell chosen during the session.

## Visual bridge after green

The agent may then wire a `RingDebugLayer` through `viewerSceneSlot`:

- active footprint: neutral surface;
- ring 1: strongest color;
- intermediate rings: progressively lighter colors;
- no terrain or procedural style yet.

You will predict the shape before the application runs. The screenshot is evidence of the mapping, not a replacement for the pure tests.

## Evidence record

After the session, update the Vaulty note `[[Couronnes de Chebyshev autour d'une empreinte]]` with:

- highest hint used;
- which fixtures passed unaided;
- your own explanation;
- any misconception found;
- next cold probe;
- status `gap`, `shaky` or `solid` based on live evidence only.
