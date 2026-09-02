# Lesson 01 — Polygon Frontages

> Scope: one pure TypeScript mechanism. No Three.js, React, Terrain, Streetscape geometry, neighboring houses or seeds.

## Why this is first

The Site polygon is already the exact authored property boundary. A selected segment can therefore become a local frontage frame for a road, path, hedge or direct neighboring property without replacing the polygon with a square-cell approximation.

The lesson establishes only the trustworthy geometric frame:

```text
segment endpoints → tangent + polygon winding → outward normal → frontage context
```

The later road corridor, terrain transition and nearby-property band all consume this result.

## Learning objective

Given a simple Site polygon and a context selected for one of its segments, derive every ordered boundary segment with a normalized tangent, a geometrically outward normal and its own frontage classification.

At the end, you should be able to:

- explain how polygon winding changes which side of a directed edge is outside;
- derive a segment tangent and outward normal in the XZ ground plane;
- preserve the original segment index while handling clockwise and counter-clockwise polygons;
- explain why a road separator and an access crossing are different properties;
- predict the local frame of a fresh edge on a concave Site.

## Cold prediction

Before opening the implementation, use the default square:

```text
(-15,-15) → (15,-15) → (15,15) → (-15,15)
```

Answer on paper:

1. Is this ordering clockwise or counter-clockwise in the XZ plane?
2. For the segment `(15,15) → (-15,15)`, what are its normalized tangent and outward normal?
3. If the point order is reversed, which part of the normal calculation must change?
4. Why should choosing `primary-road` on that segment leave all other segments unchanged?
5. Can a road run along a frontage while no driveway crosses it?

Do not add distance fields or road meshes yet. A transparent local-frame oracle is the goal.

## Contract

Proposed interface:

```ts
type Point2 = readonly [x: number, z: number]

type FrontageSeparator = 'none' | 'secondary-road' | 'primary-road'
type FrontageAccess = 'none' | 'driveway' | 'pedestrian-path'

type FrontageContext = Readonly<{
  separator: FrontageSeparator
  access: FrontageAccess
  roadStyleId?: string
}>

type BoundarySegment = Readonly<{
  index: number
  start: Point2
  end: Point2
  length: number
  tangent: Point2
  outwardNormal: Point2
  context: FrontageContext
}>

function deriveBoundarySegments(input: {
  points: readonly Point2[]
  contexts?: Readonly<Record<number, FrontageContext>>
}): BoundarySegment[]
```

Behavior:

- segment `i` runs from `points[i]` to `points[(i + 1) % points.length]`;
- output retains this original segment order and index;
- omitted context defaults to `{ separator: 'none', access: 'none' }`;
- changing one context does not change another segment;
- tangent and normal have unit length;
- the outward normal points outside for either polygon winding;
- fewer than three points, non-finite coordinates, zero area or zero-length edges are rejected;
- the function does not reorder or mutate the input points.

Segment indices are snapshot-local. `SiteNode.polygon.points` has no stable vertex or edge IDs, so this lesson does not claim that an index survives a later polygon edit.

## Fixtures prepared by the agent

### Default square, counter-clockwise

```text
(-15,-15) → (15,-15) → (15,15) → (-15,15)
```

Expected outward directions:

```text
bottom → -Z
right  → +X
top    → +Z
left   → -X
```

### Same square, reversed winding

The points are reversed while the physical square remains identical. Matched geometric edges must still point outward even though their direction and segment index differ.

### Concave transfer

Use an L-shaped simple polygon. The local normal of each edge still depends on winding, not on a vector from the polygon center. A center-based solution must fail this fixture.

### Context isolation

Select one frontage as:

```ts
{
  separator: 'secondary-road',
  access: 'driveway',
  roadStyleId: 'residential-local'
}
```

Only that segment receives the context.

### Degenerate cases

- fewer than three points;
- three collinear points;
- repeated consecutive point;
- `NaN` or infinite coordinate.

## Human-authored mechanism

You own the consequential body of `deriveBoundarySegments`:

1. calculate signed polygon area or an equivalent winding signal;
2. visit each original edge, including the closing edge;
3. calculate and normalize its tangent;
4. choose the outward perpendicular from the winding;
5. attach only that edge's context.

The key decision remains yours:

```text
given tangent (dx, dz) and polygon winding,
which perpendicular points outside?
```

Do not reorder the polygon merely to make every input counter-clockwise. Reordering would make a UI selection keyed by the original segment index refer to a different frontage.

## Adaptive hints

Use only the first hint that unblocks you.

### Hint 1 — invariant

For a consistently wound simple polygon, the interior remains on the same side of every directed boundary edge.

### Hint 2 — counterexample

A normal based on `edge midpoint - polygon center` can point the wrong way in the interior notch of an L-shaped polygon.

### Hint 3 — narrowed problem

For the top edge of the default square:

```text
start = (15, 15)
end   = (-15, 15)
tangent before normalization = (-30, 0)
```

Draw both perpendiculars and select the one outside the square.

### Hint 4 — winding probe

Compute the signed-area contribution of each consecutive point pair. You need only the sign to decide whether the interior lies to the left or right of directed edges.

### Hint 5 — control-flow skeleton

```text
validate polygon
winding = ???
for each original segment index
  start = points[index]
  end = points[next index, wrapping to zero]
  tangent = normalize(end - start)
  outward = perpendicular selected from winding
  emit original index, frame and isolated context
```

## Red-green command

The focused command will be:

```sh
bun test src/surroundings/frontages.test.ts
```

The whole suite is run only after the focused contracts pass.

## Explain-back gate

Without opening the file:

> Explain why reversing point order reverses every directed tangent but must not make any matched geometric edge point inward.

Then derive the tangent and outward normal for one fresh edge of a rotated or concave polygon selected during the session.

## Visual bridge after green

The agent may wire a presentation-only `FrontageDebugLayer` and a small 2D selector:

- Site polygon: neutral fill;
- `none`: muted boundary;
- `secondary-road`: one distinct frontage color;
- `primary-road`: a stronger frontage color;
- access: a separate marker at a provisional station;
- outward normal: short arrow from the edge midpoint.

No road geometry is created. You predict the arrows and selected segment before the probe runs. The screenshot validates the mapping but does not replace the pure tests.

## Transfer toward the Sims-like extension

After this lesson is green, the first later road exercise can consume one segment frame:

```text
frontage tangent       → road direction
frontage outwardNormal → road exterior side
Streetscape width      → corridor depth
```

If the road occupies width `W` outside the active property and a future neighbor has front setback `S`, its build line begins at `W + S`. No house is generated in Lesson 1.

## Evidence record

After the session, update the Vaulty concept note for polygon frontages with:

- highest hint used;
- which winding and concave fixtures passed unaided;
- your own explanation of the outward-normal rule;
- any misconception found;
- next cold probe;
- status `gap`, `shaky` or `solid` based on live evidence only.
