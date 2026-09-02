type Point = readonly [x: number, z: number]

type Segment = {
  a: Point
  b: Point
}

export type MaskContourOptions = {
  values: Float32Array
  columns: number
  rows: number
  origin: Point
  spacing: number
  threshold?: number
  erosionStrength?: number
  blur?: boolean
  minimumArea?: number
}

const MASK_EROSION_RADIUS = 1
const MASK_EROSION_STRENGTH = 0.5
const KAWASE_OFFSETS = [1, 2] as const

export function buildSmoothMaskPath(options: MaskContourOptions): string {
  const { columns, rows, values } = options
  const smoothed =
    options.blur === false
      ? erodeMask(
          values,
          columns,
          rows,
          MASK_EROSION_RADIUS,
          options.erosionStrength ?? MASK_EROSION_STRENGTH,
        )
      : prepareSmoothMask(
          values,
          columns,
          rows,
          options.erosionStrength ?? MASK_EROSION_STRENGTH,
        )
  const segments = marchingSquares(smoothed, columns, rows, options.threshold ?? 0.35)
  const minimumGridArea = Math.max(0, options.minimumArea ?? 0) / options.spacing ** 2
  const loops = connectSegments(segments).filter(
    (loop) => Math.abs(signedLoopArea(loop)) >= minimumGridArea,
  )
  return loops
    .map((loop) => smoothLoop(loop, options.origin, options.spacing))
    .filter(Boolean)
    .join('')
}
export function prepareSmoothMask(
  values: Float32Array,
  columns: number,
  rows: number,
  erosionStrength = MASK_EROSION_STRENGTH,
): Float32Array {
  return kawaseBlur(
    erodeMask(values, columns, rows, MASK_EROSION_RADIUS, erosionStrength),
    columns,
    rows,
  )
}

export function erodeMask(
  values: Float32Array,
  columns: number,
  rows: number,
  radius = MASK_EROSION_RADIUS,
  strength = MASK_EROSION_STRENGTH,
): Float32Array {
  const eroded = new Float32Array(values.length)
  const safeRadius = Math.max(0, Math.floor(radius))
  const safeStrength = Math.min(1, Math.max(0, strength))

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let minimum = 1
      for (let offsetZ = -safeRadius; offsetZ <= safeRadius; offsetZ += 1) {
        for (let offsetX = -safeRadius; offsetX <= safeRadius; offsetX += 1) {
          minimum = Math.min(
            minimum,
            sample(values, columns, rows, column + offsetX, row + offsetZ),
          )
        }
      }
      const original = sample(values, columns, rows, column, row)
      eroded[row * columns + column] =
        original + (minimum - original) * safeStrength
    }
  }

  return eroded
}


function kawaseBlur(values: Float32Array, columns: number, rows: number): Float32Array {
  let source = new Float32Array(values)
  let target = new Float32Array(values.length)

  for (const offset of KAWASE_OFFSETS) {
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const center = sample(source, columns, rows, column, row)
        const diagonalSum =
          sample(source, columns, rows, column - offset, row - offset) +
          sample(source, columns, rows, column + offset, row - offset) +
          sample(source, columns, rows, column + offset, row + offset) +
          sample(source, columns, rows, column - offset, row + offset)
        target[row * columns + column] = (center * 4 + diagonalSum) / 8
      }
    }
    const previous = source
    source = target
    target = previous
  }

  return source
}

function sample(
  values: Float32Array,
  columns: number,
  rows: number,
  column: number,
  row: number,
): number {
  if (column < 0 || row < 0 || column >= columns || row >= rows) return 0
  return values[row * columns + column] ?? 0
}

function marchingSquares(
  values: Float32Array,
  columns: number,
  rows: number,
  threshold: number,
): Segment[] {
  const segments: Segment[] = []

  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const topLeft = values[row * columns + column] ?? 0
      const topRight = values[row * columns + column + 1] ?? 0
      const bottomRight = values[(row + 1) * columns + column + 1] ?? 0
      const bottomLeft = values[(row + 1) * columns + column] ?? 0
      const state =
        (topLeft >= threshold ? 1 : 0) |
        (topRight >= threshold ? 2 : 0) |
        (bottomRight >= threshold ? 4 : 0) |
        (bottomLeft >= threshold ? 8 : 0)
      if (state === 0 || state === 15) continue

      const edge = (index: number): Point => {
        switch (index) {
          case 0:
            return [column + crossing(topLeft, topRight, threshold), row]
          case 1:
            return [column + 1, row + crossing(topRight, bottomRight, threshold)]
          case 2:
            return [column + crossing(bottomLeft, bottomRight, threshold), row + 1]
          default:
            return [column, row + crossing(topLeft, bottomLeft, threshold)]
        }
      }
      const add = (first: number, second: number) => {
        segments.push({ a: edge(first), b: edge(second) })
      }

      switch (state) {
        case 1:
          add(3, 0)
          break
        case 2:
          add(0, 1)
          break
        case 3:
          add(3, 1)
          break
        case 4:
          add(1, 2)
          break
        case 5:
          if ((topLeft + topRight + bottomRight + bottomLeft) / 4 >= threshold) {
            add(0, 1)
            add(2, 3)
          } else {
            add(3, 0)
            add(1, 2)
          }
          break
        case 6:
          add(0, 2)
          break
        case 7:
          add(2, 3)
          break
        case 8:
          add(2, 3)
          break
        case 9:
          add(0, 2)
          break
        case 10:
          if ((topLeft + topRight + bottomRight + bottomLeft) / 4 >= threshold) {
            add(3, 0)
            add(1, 2)
          } else {
            add(0, 1)
            add(2, 3)
          }
          break
        case 11:
          add(1, 2)
          break
        case 12:
          add(3, 1)
          break
        case 13:
          add(0, 1)
          break
        case 14:
          add(3, 0)
          break
      }
    }
  }

  return segments
}

function crossing(from: number, to: number, threshold: number): number {
  const span = to - from
  if (Math.abs(span) < 1e-8) return 0.5
  return Math.min(1, Math.max(0, (threshold - from) / span))
}

function connectSegments(segments: readonly Segment[]): Point[][] {
  const adjacency = new Map<string, number[]>()
  segments.forEach((segment, index) => {
    appendIndex(adjacency, pointKey(segment.a), index)
    appendIndex(adjacency, pointKey(segment.b), index)
  })

  const unused = new Set(segments.map((_, index) => index))
  const loops: Point[][] = []
  for (let startIndex = 0; startIndex < segments.length; startIndex += 1) {
    if (!unused.delete(startIndex)) continue
    const segment = segments[startIndex]
    if (!segment) continue

    const loop: Point[] = [segment.a, segment.b]
    const startKey = pointKey(segment.a)
    let endKey = pointKey(segment.b)
    while (endKey !== startKey) {
      const nextIndex = adjacency.get(endKey)?.find((index) => unused.has(index))
      if (nextIndex === undefined) break
      unused.delete(nextIndex)
      const next = segments[nextIndex]
      if (!next) break
      const nextPoint = pointKey(next.a) === endKey ? next.b : next.a
      loop.push(nextPoint)
      endKey = pointKey(nextPoint)
    }

    if (endKey === startKey && loop.length >= 4) loops.push(loop.slice(0, -1))
  }
  return loops
}

function appendIndex(map: Map<string, number[]>, key: string, index: number): void {
  const entries = map.get(key)
  if (entries) entries.push(index)
  else map.set(key, [index])
}

function signedLoopArea(points: readonly Point[]): number {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    area += current[0] * next[1] - next[0] * current[1]
  }
  return area / 2
}

function pointKey([x, z]: Point): string {
  return `${x.toFixed(6)},${z.toFixed(6)}`
}

function smoothLoop(points: readonly Point[], origin: Point, spacing: number): string {
  if (points.length < 3) return ''
  const worldPoint = ([x, z]: Point): Point => [origin[0] + x * spacing, origin[1] + z * spacing]
  const world = points.map(worldPoint)
  const first = midpoint(world.at(-1)!, world[0]!)
  let path = `M${format(first[0])},${format(first[1])}`
  for (let index = 0; index < world.length; index += 1) {
    const point = world[index]!
    const next = world[(index + 1) % world.length]!
    const middle = midpoint(point, next)
    path += `Q${format(point[0])},${format(point[1])},${format(middle[0])},${format(middle[1])}`
  }
  return `${path}Z`
}

function midpoint(a: Point, b: Point): Point {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

function format(value: number): string {
  const rounded = Math.round(value * 10_000) / 10_000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}
